import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { likePattern, paginated, Paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { nextSequence } from '../../../common/sequences/sequences';
import { localDayRange, tenantTimeZone } from '../../../common/time/local-day-range';
import { formatMoney } from '../../../common/utils/money';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { CashMovementDirection, CashMovementEntity, CashMovementType } from '../../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../../cash/entities/cash-session.entity';
import { Letterhead, loadLetterhead, PrintCustomer, printableName, toPrintCustomer } from '../../fiscal/printable';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { PersonEntity } from '../../persons/entities/person.entity';
import { localToday } from '../../reports/domain/period';
import { SaleAdjustmentsService } from '../adjustments/sale-adjustments.service';
import { SaleAdjustmentKind, SaleAdjustmentSettlement, SaleAdjustmentEntity } from '../adjustments/entities/sale-adjustment.entity';
import { CheckStatus, ReceivedCheckEntity } from '../checks/entities/received-check.entity';
import { accountPosition, applyCredit, decimalToCents, lockCustomer, openDebits, postEntry } from './account-ledger';
import { Aging, daysBetween, lateInterestCents, planAllocation } from './domain/account-math';
import {
  AccountSettingsDto,
  CreateCreditAuthorizationDto,
  CreateReceiptDto,
  CustomerAccountQueryDto,
  StatementQueryDto,
  UpdateCreditDto,
} from './dto/customer-account.dto';
import {
  AccountEntryDirection,
  AccountEntryKind,
  CustomerAccountAllocationEntity,
  CustomerAccountEntryEntity,
  CustomerCreditAuthorizationEntity,
} from './entities/customer-account-entry.entity';
import { CustomerReceiptEntity, CustomerReceiptPaymentEntity, ReceiptPaymentMethod } from './entities/customer-receipt.entity';

const MAX_CENTS = 99_999_999_999_999n;

export interface AccountActor {
  id: string;
  branchId: string | null;
}

export interface AgingView {
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
  overdue: string;
}

export interface CustomerAccountRow {
  personId: string;
  accountNumber: number | null;
  name: string;
  nationalId: string | null;
  creditEnabled: boolean;
  creditLimit: string | null;
  creditTermDays: number;
  balance: string;
  overdue: string;
  available: string | null;
  oldestDueDate: string | null;
  lastReceiptAt: string | null;
}

export interface OpenDebitView {
  id: string;
  kind: AccountEntryKind;
  description: string;
  saleId: string | null;
  document: { voucherType: number; pointOfSale: number; number: number | null } | null;
  /** Comprobante ARCA de la factura de la venta (para la nota de débito por intereses). */
  invoiced: boolean;
  createdAt: Date;
  dueDate: string | null;
  amount: string;
  pending: string;
  daysLate: number;
  /** Interés por mora sugerido desde el vencimiento (o desde la última nota de intereses). */
  suggestedInterest: string;
  interestThrough: string | null;
}

export interface StatementLine {
  id: string;
  date: Date;
  kind: AccountEntryKind;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  dueDate: string | null;
  saleId: string | null;
  receiptId: string | null;
}

export interface ReceiptView {
  id: string;
  number: number;
  branchId: string;
  customerPersonId: string;
  total: string;
  currency: string;
  cashSessionId: string | null;
  notes: string | null;
  createdAt: Date;
  actorName: string | null;
  payments: Array<{ method: ReceiptPaymentMethod; amount: string; externalReference: string | null; check: { bank: string; number: string; payDate: string } | null }>;
  allocations: Array<{ entryId: string; description: string; document: OpenDebitView['document']; dueDate: string | null; amount: string }>;
  unapplied: string;
}

const agingView = (aging: Aging): AgingView => ({
  current: formatMoney(aging.currentCents),
  days1to30: formatMoney(aging.days1to30Cents),
  days31to60: formatMoney(aging.days31to60Cents),
  days61to90: formatMoney(aging.days61to90Cents),
  over90: formatMoney(aging.over90Cents),
  overdue: formatMoney(aging.overdueCents),
});

/**
 * Cuentas corrientes de clientes: deudores, resumen de cuenta, recibos de cobranza con imputación,
 * autorizaciones de crédito e intereses por mora (que se cobran con nota de débito asociada a la factura).
 */
@Injectable()
export class CustomerAccountsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adjustments: SaleAdjustmentsService,
  ) {}

  // ── Configuración ─────────────────────────────────────────────────────────

  async settings(tenantId: string): Promise<{ lateInterestMonthly: string }> {
    const tenant = await this.dataSource.manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, lateInterestMonthly: true } });
    return { lateInterestMonthly: Number(tenant?.lateInterestMonthly ?? 0).toFixed(2) };
  }

  async updateSettings(tenantId: string, actorUserId: string, dto: AccountSettingsDto, context: RequestAuditContext) {
    return this.dataSource.transaction(async (manager) => {
      const before = await manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, lateInterestMonthly: true } });
      await manager.update(TenantEntity, { id: tenantId }, { lateInterestMonthly: dto.lateInterestMonthly.toFixed(2) });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'ACCOUNT_SETTINGS_UPDATED',
        aggregateType: 'TENANT',
        aggregateId: tenantId,
        metadata: { before: before?.lateInterestMonthly ?? null, after: dto.lateInterestMonthly.toFixed(2) },
        context,
      });
      return { lateInterestMonthly: dto.lateInterestMonthly.toFixed(2) };
    });
  }

  // ── Deudores ──────────────────────────────────────────────────────────────

  async list(
    tenantId: string,
    query: CustomerAccountQueryDto,
  ): Promise<Paginated<CustomerAccountRow> & { totals: { receivable: string; overdue: string; customers: number; aging: AgingView } }> {
    const today = localToday(await tenantTimeZone(this.dataSource.manager, tenantId));
    const params: unknown[] = [today, tenantId];
    let where = "p.tenant_id = ? AND p.person_type <> 'SUPPLIER'";
    if (query.search) {
      const digits = query.search.replace(/\D/g, '');
      where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.national_id = ?' + (digits ? ' OR p.account_number = ?' : '') + ')';
      params.push(likePattern(query.search), likePattern(query.search), digits || query.search);
      if (digits) params.push(Number(digits));
    }
    const having =
      query.status === 'OVERDUE' ? 'overdue > 0' : query.status === 'WITH_DEBT' ? 'balance > 0' : '(p.credit_enabled = 1 OR balance <> 0)';
    const base = `
      SELECT p.id, p.account_number AS accountNumber, p.first_name AS firstName, p.last_name AS lastName, p.national_id AS nationalId,
             p.credit_enabled AS creditEnabled, p.credit_limit AS creditLimit, p.credit_term_days AS creditTermDays,
             COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount WHEN e.direction = 'CREDIT' THEN -e.amount ELSE 0 END), 0) AS balance,
             COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' AND e.due_date < ? THEN e.amount - e.amount_applied ELSE 0 END), 0) AS overdue,
             MIN(CASE WHEN e.direction = 'DEBIT' AND e.amount_applied < e.amount THEN e.due_date END) AS oldestDueDate,
             MAX(CASE WHEN e.kind = 'RECEIPT' THEN e.created_at END) AS lastReceiptAt
        FROM persons p
        LEFT JOIN customer_account_entries e ON e.tenant_id = p.tenant_id AND e.customer_person_id = p.id
       WHERE ${where}
       GROUP BY p.id
      HAVING ${having}`;
    const [countRow] = (await this.dataSource.query(`SELECT COUNT(*) AS total FROM (${base}) t`, params)) as Array<{ total: string }>;
    const rows = (await this.dataSource.query(`${base} ORDER BY overdue DESC, balance DESC, p.last_name, p.first_name LIMIT ? OFFSET ?`, [
      ...params,
      query.limit,
      (query.page - 1) * query.limit,
    ])) as Array<Record<string, string | number | null>>;

    const items = rows.map((row): CustomerAccountRow => {
      const balance = decimalToCents(row.balance as string);
      const limit = row.creditLimit !== null ? decimalToCents(row.creditLimit as string) : null;
      return {
        personId: String(row.id),
        accountNumber: row.accountNumber !== null ? Number(row.accountNumber) : null,
        name: printableName(String(row.firstName), row.lastName as string | null),
        nationalId: (row.nationalId as string | null) ?? null,
        creditEnabled: Boolean(Number(row.creditEnabled)),
        creditLimit: limit !== null ? formatMoney(limit) : null,
        creditTermDays: Number(row.creditTermDays),
        balance: formatMoney(balance),
        overdue: formatMoney(decimalToCents(row.overdue as string)),
        available: limit !== null ? formatMoney(limit - balance > 0n ? limit - balance : 0n) : null,
        oldestDueDate: row.oldestDueDate ? String(row.oldestDueDate).slice(0, 10) : null,
        lastReceiptAt: row.lastReceiptAt ? new Date(String(row.lastReceiptAt)).toISOString() : null,
      };
    });

    // Totales de la empresa: deuda a cobrar y antigüedad (de lo pendiente de cada factura).
    const [totals] = (await this.dataSource.query(
      `SELECT
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount - amount_applied ELSE 0 END), 0) AS receivable,
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND (due_date IS NULL OR due_date >= ?) THEN amount - amount_applied ELSE 0 END), 0) AS current,
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND DATEDIFF(?, due_date) BETWEEN 1 AND 30 THEN amount - amount_applied ELSE 0 END), 0) AS d30,
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND DATEDIFF(?, due_date) BETWEEN 31 AND 60 THEN amount - amount_applied ELSE 0 END), 0) AS d60,
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND DATEDIFF(?, due_date) BETWEEN 61 AND 90 THEN amount - amount_applied ELSE 0 END), 0) AS d90,
          COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND DATEDIFF(?, due_date) > 90 THEN amount - amount_applied ELSE 0 END), 0) AS over90,
          COUNT(DISTINCT CASE WHEN direction = 'DEBIT' AND amount_applied < amount THEN customer_person_id END) AS customers
         FROM customer_account_entries WHERE tenant_id = ?`,
      [today, today, today, today, today, tenantId],
    )) as Array<Record<string, string>>;
    const aging: Aging = {
      currentCents: decimalToCents(totals.current),
      days1to30Cents: decimalToCents(totals.d30),
      days31to60Cents: decimalToCents(totals.d60),
      days61to90Cents: decimalToCents(totals.d90),
      over90Cents: decimalToCents(totals.over90),
      overdueCents: decimalToCents(totals.d30) + decimalToCents(totals.d60) + decimalToCents(totals.d90) + decimalToCents(totals.over90),
    };
    return {
      ...paginated(items, Number(countRow?.total ?? 0), query.page, query.limit),
      totals: {
        receivable: formatMoney(decimalToCents(totals.receivable)),
        overdue: formatMoney(aging.overdueCents),
        customers: Number(totals.customers ?? 0),
        aging: agingView(aging),
      },
    };
  }

  // ── Cuenta de un cliente ──────────────────────────────────────────────────

  async detail(tenantId: string, personId: string, query: StatementQueryDto) {
    const manager = this.dataSource.manager;
    const person = await manager.findOne(PersonEntity, { where: { id: personId, tenantId } });
    if (!person || person.personType === 'SUPPLIER') throw new NotFoundException('Cliente no encontrado.');
    const timeZone = await tenantTimeZone(manager, tenantId);
    const today = localToday(timeZone);
    const [position, settings] = await Promise.all([accountPosition(manager, tenantId, personId, today), this.settings(tenantId)]);
    const rate = Number(settings.lateInterestMonthly);
    const documents = await this.documentsFor(manager, tenantId, position.debits.map((row) => row.entry));

    const debits: OpenDebitView[] = position.debits.map(({ entry, pendingCents }) => {
      const daysLate = entry.dueDate ? Math.max(0, daysBetween(entry.dueDate, today)) : 0;
      const from = entry.interestThrough && entry.dueDate && entry.interestThrough > entry.dueDate ? entry.interestThrough : entry.dueDate;
      const interestDays = from ? Math.max(0, daysBetween(from, today)) : 0;
      const document = documents.get(entry.id) ?? null;
      return {
        id: entry.id,
        kind: entry.kind,
        description: entry.description,
        saleId: entry.saleId ?? null,
        document: document?.document ?? null,
        invoiced: Boolean(document?.saleInvoiced),
        createdAt: entry.createdAt,
        dueDate: entry.dueDate ?? null,
        amount: formatMoney(decimalToCents(entry.amount)),
        pending: formatMoney(pendingCents),
        daysLate,
        // Solo las ventas a cuenta generan intereses (no las notas de débito, para no cobrar interés sobre interés).
        suggestedInterest: formatMoney(entry.kind === AccountEntryKind.SALE ? lateInterestCents(pendingCents, rate, interestDays) : 0n),
        interestThrough: entry.interestThrough ?? null,
      };
    });

    const limit = person.creditLimit != null ? decimalToCents(person.creditLimit) : null;
    const statement = await this.statement(manager, tenantId, personId, timeZone, query.from ?? null, query.to ?? null, today);
    const receipts = (await manager.find(CustomerReceiptEntity, {
      where: { tenantId, customerPersonId: personId },
      order: { createdAt: 'DESC' },
      take: 20,
    })).map((receipt) => ({ id: receipt.id, number: receipt.number, total: receipt.total, createdAt: receipt.createdAt }));
    const authorizations = await manager
      .createQueryBuilder(CustomerCreditAuthorizationEntity, 'a')
      .where('a.tenantId = :tenantId AND a.customerPersonId = :personId', { tenantId, personId })
      .andWhere('a.usedSaleId IS NULL AND a.expiresAt > :now', { now: new Date() })
      .orderBy('a.createdAt', 'DESC')
      .getMany();

    return {
      customer: toPrintCustomer(person),
      email: person.email ?? null,
      phone: person.phone ?? null,
      credit: {
        creditEnabled: person.creditEnabled,
        creditLimit: limit !== null ? formatMoney(limit) : null,
        creditTermDays: person.creditTermDays,
        available: limit !== null ? formatMoney(limit - position.balanceCents > 0n ? limit - position.balanceCents : 0n) : null,
      },
      balance: formatMoney(position.balanceCents),
      unappliedCredit: formatMoney(position.unappliedCreditCents),
      aging: agingView(position.aging),
      lateInterestMonthly: settings.lateInterestMonthly,
      openDebits: debits,
      statement,
      receipts,
      authorizations: authorizations.map((item) => ({ id: item.id, maxAmount: item.maxAmount, reason: item.reason, expiresAt: item.expiresAt })),
    };
  }

  /** Comprobante ARCA de cada débito: la factura de la venta (SALE) o la nota de débito (DEBIT_NOTE). */
  private async documentsFor(manager: EntityManager, tenantId: string, entries: CustomerAccountEntryEntity[]) {
    const result = new Map<string, { document: OpenDebitView['document']; saleInvoiced: boolean }>();
    const saleIds = [...new Set(entries.map((entry) => entry.saleId).filter((id): id is string => Boolean(id)))];
    const adjustmentIds = entries.filter((entry) => entry.sourceType === 'SALE_ADJUSTMENT').map((entry) => entry.sourceId);
    if (saleIds.length === 0 && adjustmentIds.length === 0) return result;
    const sourceIds = [...saleIds, ...adjustmentIds];
    const rows = (await manager.query(
      `SELECT source_type AS sourceType, source_id AS sourceId, voucher_type AS voucherType, point_of_sale AS pointOfSale, number
         FROM fiscal_documents
        WHERE tenant_id = ? AND status = 'AUTHORIZED' AND source_type IN ('SALE', 'SALE_ADJUSTMENT')
          AND source_id IN (${sourceIds.map(() => '?').join(', ')})`,
      [tenantId, ...sourceIds],
    )) as Array<{ sourceType: string; sourceId: string; voucherType: number; pointOfSale: number; number: number | null }>;
    const key = (type: string, id: string) => `${type}:${id}`;
    const byKey = new Map(rows.map((row) => [key(row.sourceType, String(row.sourceId)), row]));
    for (const entry of entries) {
      const invoice = entry.saleId ? byKey.get(key('SALE', entry.saleId)) : undefined;
      const own = entry.sourceType === 'SALE_ADJUSTMENT' ? byKey.get(key('SALE_ADJUSTMENT', entry.sourceId)) : invoice;
      result.set(entry.id, {
        document: own ? { voucherType: Number(own.voucherType), pointOfSale: Number(own.pointOfSale), number: own.number !== null ? Number(own.number) : null } : null,
        saleInvoiced: Boolean(invoice),
      });
    }
    return result;
  }

  /** Resumen de cuenta: saldo anterior + movimientos del período con saldo acumulado. Por defecto, últimos 90 días. */
  private async statement(
    manager: EntityManager,
    tenantId: string,
    personId: string,
    timeZone: string,
    from: string | null,
    to: string | null,
    today: string,
  ): Promise<{ from: string; to: string; openingBalance: string; closingBalance: string; lines: StatementLine[]; truncated: boolean }> {
    const fromDate = from ?? new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
    const toDate = to ?? today;
    const range = localDayRange(timeZone, fromDate, toDate);
    const [opening] = (await manager.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS balance
         FROM customer_account_entries WHERE tenant_id = ? AND customer_person_id = ? AND created_at < ?`,
      [tenantId, personId, range.start],
    )) as Array<{ balance: string }>;
    const LIMIT = 500;
    const entries = await manager
      .createQueryBuilder(CustomerAccountEntryEntity, 'e')
      .where('e.tenantId = :tenantId AND e.customerPersonId = :personId', { tenantId, personId })
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start: range.start, end: range.end })
      .orderBy('e.createdAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .take(LIMIT + 1)
      .getMany();
    let running = decimalToCents(opening?.balance);
    const openingBalance = running;
    const lines = entries.slice(0, LIMIT).map((entry): StatementLine => {
      const amount = decimalToCents(entry.amount);
      running += entry.direction === AccountEntryDirection.DEBIT ? amount : -amount;
      return {
        id: entry.id,
        date: entry.createdAt,
        kind: entry.kind,
        description: entry.description,
        debit: entry.direction === AccountEntryDirection.DEBIT ? formatMoney(amount) : '0.00',
        credit: entry.direction === AccountEntryDirection.CREDIT ? formatMoney(amount) : '0.00',
        balance: formatMoney(running),
        dueDate: entry.dueDate ?? null,
        saleId: entry.saleId ?? null,
        receiptId: entry.sourceType === 'CUSTOMER_RECEIPT' ? entry.sourceId : null,
      };
    });
    return { from: fromDate, to: toDate, openingBalance: formatMoney(openingBalance), closingBalance: formatMoney(running), lines, truncated: entries.length > LIMIT };
  }

  // ── Crédito y autorizaciones ──────────────────────────────────────────────

  async updateCredit(tenantId: string, actorUserId: string, personId: string, dto: UpdateCreditDto, context: RequestAuditContext) {
    await this.dataSource.transaction(async (manager) => {
      const person = await lockCustomer(manager, tenantId, personId);
      const before = { creditEnabled: person.creditEnabled, creditLimit: person.creditLimit ?? null, creditTermDays: person.creditTermDays };
      person.creditEnabled = dto.creditEnabled;
      person.creditLimit = dto.creditLimit === null || dto.creditLimit === undefined ? null : dto.creditLimit.toFixed(2);
      person.creditTermDays = dto.creditTermDays;
      await manager.save(PersonEntity, person);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CUSTOMER_CREDIT_UPDATED',
        aggregateType: 'PERSON',
        aggregateId: personId,
        metadata: { before, after: { creditEnabled: person.creditEnabled, creditLimit: person.creditLimit, creditTermDays: person.creditTermDays } },
        context,
      });
    });
    return this.detail(tenantId, personId, {});
  }

  async authorize(tenantId: string, actorUserId: string, personId: string, dto: CreateCreditAuthorizationDto, context: RequestAuditContext) {
    return this.dataSource.transaction(async (manager) => {
      const person = await lockCustomer(manager, tenantId, personId);
      if (!person.creditEnabled) throw new BadRequestException('Primero habilitá la cuenta corriente del cliente.');
      const timeZone = await tenantTimeZone(manager, tenantId);
      const today = localToday(timeZone);
      const expiresAt = localDayRange(timeZone, today, today).end as Date;
      const saved = await manager.save(
        CustomerCreditAuthorizationEntity,
        manager.create(CustomerCreditAuthorizationEntity, {
          tenantId,
          customerPersonId: personId,
          maxAmount: dto.maxAmount.toFixed(2),
          reason: dto.reason,
          expiresAt,
          authorizedByUserId: actorUserId,
        }),
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CUSTOMER_CREDIT_AUTHORIZED',
        aggregateType: 'PERSON',
        aggregateId: personId,
        metadata: { authorizationId: saved.id, maxAmount: saved.maxAmount, reason: saved.reason, expiresAt: saved.expiresAt },
        context,
      });
      return { id: saved.id, maxAmount: saved.maxAmount, reason: saved.reason, expiresAt: saved.expiresAt };
    });
  }

  // ── Recibos de cobranza ───────────────────────────────────────────────────

  async createReceipt(
    tenantId: string,
    actor: AccountActor,
    personId: string,
    idempotencyKey: string,
    dto: CreateReceiptDto,
    context: RequestAuditContext,
  ): Promise<ReceiptView> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    if (actor.branchId && actor.branchId !== dto.branchId) throw new ForbiddenException('Solo puede cobrar en su sucursal.');
    if (dto.payments.some((payment) => payment.method === ReceiptPaymentMethod.CHECK && !payment.check)) {
      throw new BadRequestException('Cada pago con cheque debe indicar banco, número y fecha de cobro.');
    }
    if (dto.payments.some((payment) => payment.method !== ReceiptPaymentMethod.CHECK && payment.check)) {
      throw new BadRequestException('Los datos del cheque solo corresponden a pagos con cheque.');
    }
    if (dto.payments.some((payment) => payment.method === ReceiptPaymentMethod.CASH) && !dto.cashSessionId) {
      throw new BadRequestException('Para cobrar en efectivo indicá la caja abierta.');
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          personId,
          branchId: dto.branchId,
          cashSessionId: dto.cashSessionId ?? null,
          payments: dto.payments.map((payment) => [
            payment.method,
            Number(payment.amount).toFixed(2),
            payment.externalReference ?? '',
            payment.check ? [payment.check.bank, payment.check.number, payment.check.payDate, payment.check.drawerName ?? '', payment.check.drawerTaxId ?? ''].join('|') : '',
          ]),
          allocations: (dto.allocations ?? []).map((item) => [item.entryId, Number(item.amount).toFixed(2)]),
          notes: dto.notes ?? null,
        }),
      )
      .digest('hex');
    const repository = this.dataSource.getRepository(CustomerReceiptEntity);
    const prior = await repository.findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key ya fue utilizado para otro recibo.');
      return this.receiptView(this.dataSource.manager, tenantId, prior);
    }
    try {
      const id = await this.dataSource.transaction((manager) => this.receiptInTransaction(manager, tenantId, actor, personId, key, fingerprint, dto, context));
      return this.receipt(tenantId, id, null);
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException(error.message);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        const winner = await repository.findOne({ where: { tenantId, idempotencyKey: key } });
        if (winner && winner.requestFingerprint === fingerprint) return this.receiptView(this.dataSource.manager, tenantId, winner);
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro recibo.');
      }
      throw error;
    }
  }

  private async receiptInTransaction(
    manager: EntityManager,
    tenantId: string,
    actor: AccountActor,
    personId: string,
    key: string,
    fingerprint: string,
    dto: CreateReceiptDto,
    context: RequestAuditContext,
  ): Promise<string> {
    const customer = await lockCustomer(manager, tenantId, personId);
    const [tenant, branch] = await Promise.all([
      manager.findOne(TenantEntity, { where: { id: tenantId } }),
      manager.findOne(BranchEntity, { where: { id: dto.branchId, tenantId, status: true } }),
    ]);
    if (!tenant || !branch) throw new NotFoundException('La sucursal no existe o no está activa.');

    let session: CashSessionEntity | null = null;
    if (dto.cashSessionId) {
      session = await manager
        .createQueryBuilder(CashSessionEntity, 'session')
        .setLock('pessimistic_write')
        .where('session.id = :id AND session.tenantId = :tenantId', { id: dto.cashSessionId, tenantId })
        .andWhere('session.branchId = :branchId AND session.status = :status', { branchId: branch.id, status: CashSessionStatus.OPEN })
        .getOne();
      if (!session) throw new NotFoundException('La caja no está abierta o no corresponde a la sucursal.');
    }

    const amounts = dto.payments.map((payment) => decimalToCents(Number(payment.amount).toFixed(2)));
    const totalCents = amounts.reduce((sum, value) => sum + value, 0n);
    if (totalCents <= 0n || totalCents > MAX_CENTS) throw new BadRequestException('El total del recibo está fuera del rango admitido.');

    // Imputación: la elegida por el cajero o de la factura más vieja a la más nueva. Lo que sobra queda a favor.
    const debits = await openDebits(manager, tenantId, personId);
    const plan = planAllocation(
      totalCents,
      debits,
      dto.allocations?.map((item) => ({ debitId: item.entryId, amountCents: decimalToCents(Number(item.amount).toFixed(2)) })),
    );

    const number = await nextSequence(manager, tenantId, 'CUSTOMER_RECEIPT');
    const receipt = await manager.save(
      CustomerReceiptEntity,
      manager.create(CustomerReceiptEntity, {
        tenantId,
        number,
        branchId: branch.id,
        customerPersonId: personId,
        total: formatMoney(totalCents),
        currency: tenant.currencyCode,
        cashSessionId: session?.id ?? null,
        notes: dto.notes || null,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId: actor.id,
      }),
    );
    const payments = await manager.save(
      CustomerReceiptPaymentEntity,
      dto.payments.map((payment, index) =>
        manager.create(CustomerReceiptPaymentEntity, {
          tenantId,
          receiptId: receipt.id,
          method: payment.method,
          amount: formatMoney(amounts[index]),
          externalReference: payment.externalReference || null,
        }),
      ),
    );

    // Cheques recibidos: a la cartera, con el cliente para reclamarle si se rechaza.
    const checks = dto.payments
      .map((payment, index) => ({ payment, saved: payments[index] }))
      .filter(({ payment }) => payment.method === ReceiptPaymentMethod.CHECK && payment.check);
    if (checks.length > 0) {
      await manager.save(
        ReceivedCheckEntity,
        checks.map(({ payment, saved }) =>
          manager.create(ReceivedCheckEntity, {
            tenantId,
            branchId: branch.id,
            saleId: null,
            salePaymentId: null,
            receiptId: receipt.id,
            receiptPaymentId: saved.id,
            customerPersonId: personId,
            bank: payment.check!.bank,
            number: payment.check!.number,
            payDate: payment.check!.payDate,
            drawerName: payment.check!.drawerName || null,
            drawerTaxId: payment.check!.drawerTaxId || null,
            amount: saved.amount,
            currency: tenant.currencyCode,
            status: CheckStatus.IN_PORTFOLIO,
          }),
        ),
      );
    }

    // Efectivo: entra a la caja como cobranza (el cierre X/Z la muestra aparte de las ventas).
    const cashCents = dto.payments.reduce((sum, payment, index) => (payment.method === ReceiptPaymentMethod.CASH ? sum + amounts[index] : sum), 0n);
    if (session && cashCents > 0n) {
      const next = decimalToCents(session.expectedAmount) + cashCents;
      if (next > MAX_CENTS) throw new BadRequestException('El saldo de caja excede el máximo admitido.');
      await manager.save(
        CashMovementEntity,
        manager.create(CashMovementEntity, {
          tenantId,
          branchId: branch.id,
          cashSessionId: session.id,
          type: CashMovementType.COLLECTION,
          direction: CashMovementDirection.IN,
          amount: formatMoney(cashCents),
          currency: tenant.currencyCode,
          reason: `Recibo N.º ${number} · ${printableName(customer.firstName, customer.lastName)}`.slice(0, 255),
          sourceType: 'CUSTOMER_RECEIPT',
          sourceId: receipt.id,
          idempotencyKey: `customer-receipt:${receipt.id}`,
          requestFingerprint: createHash('sha256').update(JSON.stringify({ receiptId: receipt.id, cash: formatMoney(cashCents) })).digest('hex'),
          actorUserId: actor.id,
        }),
      );
      session.expectedAmount = formatMoney(next);
      await manager.save(CashSessionEntity, session);
    }

    const credit = await postEntry(manager, {
      tenantId,
      branchId: branch.id,
      customerPersonId: personId,
      kind: AccountEntryKind.RECEIPT,
      direction: AccountEntryDirection.CREDIT,
      sourceType: 'CUSTOMER_RECEIPT',
      sourceId: receipt.id,
      description: `Recibo N.º ${number}`,
      amountCents: totalCents,
      currency: tenant.currencyCode,
      actorUserId: actor.id,
    });
    if (plan.items.length > 0) await applyCredit(manager, credit, plan.items, new Map(debits.map((row) => [row.id, row.entry])));

    await recordAudit(manager, {
      tenantId,
      actorUserId: actor.id,
      eventType: 'CUSTOMER_RECEIPT_CREATED',
      aggregateType: 'CUSTOMER_RECEIPT',
      aggregateId: receipt.id,
      metadata: {
        number,
        customerPersonId: personId,
        branchId: branch.id,
        cashSessionId: session?.id ?? null,
        total: receipt.total,
        payments: payments.map((payment) => ({ method: payment.method, amount: payment.amount })),
        allocations: plan.items.map((item) => ({ entryId: item.debitId, amount: formatMoney(item.amountCents) })),
        unapplied: formatMoney(plan.unappliedCents),
      },
      context,
    });
    return receipt.id;
  }

  /** Recibo imprimible: empresa, cliente, medios de pago, facturas canceladas y saldo actual. */
  async receipt(tenantId: string, receiptId: string, branchScope: string | null): Promise<ReceiptView & { letterhead: Letterhead; customer: PrintCustomer | null; balance: string }> {
    const manager = this.dataSource.manager;
    const receipt = await manager.findOne(CustomerReceiptEntity, { where: { id: receiptId, tenantId } });
    if (!receipt || (branchScope && receipt.branchId !== branchScope)) throw new NotFoundException('Recibo no encontrado.');
    const [view, letterhead, person, totals] = await Promise.all([
      this.receiptView(manager, tenantId, receipt),
      loadLetterhead(manager, tenantId, receipt.branchId),
      manager.findOne(PersonEntity, { where: { id: receipt.customerPersonId, tenantId } }),
      manager.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS balance
           FROM customer_account_entries WHERE tenant_id = ? AND customer_person_id = ?`,
        [tenantId, receipt.customerPersonId],
      ) as Promise<Array<{ balance: string }>>,
    ]);
    return { ...view, letterhead, customer: person ? toPrintCustomer(person) : null, balance: formatMoney(decimalToCents(totals[0]?.balance)) };
  }

  private async receiptView(manager: EntityManager, tenantId: string, receipt: CustomerReceiptEntity): Promise<ReceiptView> {
    const [payments, checks, credit, actor] = await Promise.all([
      manager.find(CustomerReceiptPaymentEntity, { where: { tenantId, receiptId: receipt.id } }),
      manager.find(ReceivedCheckEntity, { where: { tenantId, receiptId: receipt.id } }),
      manager.findOne(CustomerAccountEntryEntity, { where: { tenantId, sourceType: 'CUSTOMER_RECEIPT', sourceId: receipt.id } }),
      manager.query(
        `SELECT TRIM(CONCAT_WS(' ', NULLIF(p.last_name, '-'), p.first_name)) AS name, u.username
           FROM users u LEFT JOIN persons p ON p.id = u.person_id WHERE u.id = ? LIMIT 1`,
        [receipt.actorUserId],
      ) as Promise<Array<{ name: string | null; username: string | null }>>,
    ]);
    const checkByPayment = new Map(checks.map((check) => [check.receiptPaymentId ?? '', check]));
    const allocations = credit ? await manager.find(CustomerAccountAllocationEntity, { where: { tenantId, creditEntryId: credit.id } }) : [];
    const debitEntries = allocations.length
      ? await manager.find(CustomerAccountEntryEntity, { where: { tenantId, id: In(allocations.map((item) => item.debitEntryId)) } })
      : [];
    const debitById = new Map(debitEntries.map((entry) => [entry.id, entry]));
    const documents = await this.documentsFor(manager, tenantId, debitEntries);
    const appliedCents = allocations.reduce((sum, item) => sum + decimalToCents(item.amount), 0n);
    return {
      id: receipt.id,
      number: receipt.number,
      branchId: receipt.branchId,
      customerPersonId: receipt.customerPersonId,
      total: receipt.total,
      currency: receipt.currency,
      cashSessionId: receipt.cashSessionId ?? null,
      notes: receipt.notes ?? null,
      createdAt: receipt.createdAt,
      actorName: actor[0]?.name || actor[0]?.username || null,
      payments: payments.map((payment) => {
        const check = checkByPayment.get(payment.id);
        return {
          method: payment.method,
          amount: payment.amount,
          externalReference: payment.externalReference ?? null,
          check: check ? { bank: check.bank, number: check.number, payDate: String(check.payDate).slice(0, 10) } : null,
        };
      }),
      allocations: [...allocations]
        .sort((a, b) => {
          const left = debitById.get(a.debitEntryId);
          const right = debitById.get(b.debitEntryId);
          return (left?.dueDate ?? '').localeCompare(right?.dueDate ?? '') || (left?.createdAt.getTime() ?? 0) - (right?.createdAt.getTime() ?? 0);
        })
        .map((item) => {
        const entry = debitById.get(item.debitEntryId);
        return {
          entryId: item.debitEntryId,
          description: entry?.description ?? '',
          document: documents.get(item.debitEntryId)?.document ?? null,
          dueDate: entry?.dueDate ?? null,
          amount: item.amount,
        };
      }),
      unapplied: formatMoney(decimalToCents(receipt.total) - appliedCents),
    };
  }

  // ── Intereses por mora ────────────────────────────────────────────────────

  /**
   * Genera una nota de débito por intereses (pendiente de cobro, a la cuenta del cliente) por cada factura vencida
   * elegida, desde el vencimiento o desde la última nota de intereses. Cada nota queda asociada a su factura;
   * el comprobante ARCA se emite después con POST /fiscal/adjustments/:id/note.
   */
  async billInterest(
    tenantId: string,
    actor: AccountActor,
    personId: string,
    idempotencyKey: string,
    entryIds: string[] | undefined,
    context: RequestAuditContext,
  ): Promise<{ created: SaleAdjustmentEntity[]; skipped: Array<{ entryId: string; reason: string }> }> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 60) throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 60 caracteres.');
    const manager = this.dataSource.manager;
    const timeZone = await tenantTimeZone(manager, tenantId);
    const today = localToday(timeZone);
    const { lateInterestMonthly } = await this.settings(tenantId);
    const rate = Number(lateInterestMonthly);
    if (!(rate > 0)) throw new BadRequestException('Configurá primero la tasa de interés mensual por mora.');
    const debits = (await openDebits(manager, tenantId, personId)).filter((row) => !entryIds?.length || entryIds.includes(row.id));
    const documents = await this.documentsFor(manager, tenantId, debits.map((row) => row.entry));
    const created: SaleAdjustmentEntity[] = [];
    const skipped: Array<{ entryId: string; reason: string }> = [];
    for (const { entry, pendingCents } of debits) {
      const from = entry.interestThrough && entry.dueDate && entry.interestThrough > entry.dueDate ? entry.interestThrough : entry.dueDate;
      const days = from ? daysBetween(from, today) : 0;
      if (entry.kind !== AccountEntryKind.SALE || !entry.saleId || days <= 0) continue;
      if (!documents.get(entry.id)?.saleInvoiced) {
        skipped.push({ entryId: entry.id, reason: 'La venta no está facturada en ARCA.' });
        continue;
      }
      const interest = lateInterestCents(pendingCents, rate, days);
      if (interest <= 0n) continue;
      const document = documents.get(entry.id)?.document;
      const voucher = document ? ` · comp. ${String(document.pointOfSale).padStart(5, '0')}-${String(document.number ?? 0).padStart(8, '0')}` : '';
      const adjustment = await this.adjustments.create(
        tenantId,
        actor,
        entry.saleId,
        `${key}:${entry.id}`,
        {
          kind: SaleAdjustmentKind.DEBIT,
          concept: `Intereses por mora (${days} días al ${rate.toLocaleString('es-AR')} % mensual)`.slice(0, 150),
          reason: `Saldo vencido $ ${formatMoney(pendingCents)}${voucher}`.slice(0, 200),
          amount: Number(formatMoney(interest)),
          settlement: SaleAdjustmentSettlement.NONE,
        },
        context,
      );
      await manager.update(CustomerAccountEntryEntity, { id: entry.id, tenantId }, { interestThrough: today });
      created.push(adjustment);
    }
    return { created, skipped };
  }
}
