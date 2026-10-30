import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { likePattern, Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { CheckQueryDto, UpdateCheckStatusDto } from './dto/check.dto';
import { CheckStatus, ReceivedCheckEntity } from './entities/received-check.entity';
import { cents } from '../../../common/utils/money';
import { tenantTimeZone } from '../../../common/time/local-day-range';
import { localToday } from '../../reports/domain/period';
import { autoApply, lockCustomer, postEntry } from '../accounts/account-ledger';
import { AccountEntryDirection, AccountEntryKind } from '../accounts/entities/customer-account-entry.entity';

export interface ReceivedCheckView extends ReceivedCheckEntity {
  customerName: string | null;
  branchName: string | null;
  /** N.º de recibo si el cheque llegó en una cobranza de cuenta corriente. */
  receiptNumber: number | null;
}

/** Cambios de estado permitidos: en cartera → depositado → acreditado; rechazado desde cartera o depositado. */
const TRANSITIONS: Record<CheckStatus, CheckStatus[]> = {
  [CheckStatus.IN_PORTFOLIO]: [CheckStatus.DEPOSITED, CheckStatus.CASHED, CheckStatus.REJECTED],
  [CheckStatus.DEPOSITED]: [CheckStatus.CASHED, CheckStatus.REJECTED],
  [CheckStatus.CASHED]: [],
  [CheckStatus.REJECTED]: [],
};

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  [CheckStatus.IN_PORTFOLIO]: 'en cartera',
  [CheckStatus.DEPOSITED]: 'depositado',
  [CheckStatus.CASHED]: 'acreditado',
  [CheckStatus.REJECTED]: 'rechazado',
};

/** Cartera de cheques recibidos en cobros: listado, vencimientos y seguimiento hasta la acreditación. */
@Injectable()
export class ChecksService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string, query: CheckQueryDto, branchScope: string | null): Promise<Paginated<ReceivedCheckView> & { totals: Record<CheckStatus, string> }> {
    const qb = this.dataSource.getRepository(ReceivedCheckEntity).createQueryBuilder('c').where('c.tenantId = :tenantId', { tenantId });
    if (branchScope) qb.andWhere('c.branchId = :branchId', { branchId: branchScope });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.from) qb.andWhere('c.payDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('c.payDate <= :to', { to: query.to });
    if (query.search) {
      qb.andWhere('(c.number LIKE :term OR c.bank LIKE :term OR c.drawerName LIKE :term OR c.drawerTaxId = :digits)', {
        term: likePattern(query.search),
        digits: query.search.replace(/\D/g, ''),
      });
    }
    const [rows, total] = await qb
      .orderBy('c.payDate', 'ASC')
      .addOrderBy('c.createdAt', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const sums = (await this.dataSource.query(
      `SELECT status, COALESCE(SUM(amount), 0) AS amount FROM received_checks
        WHERE tenant_id = ? ${branchScope ? 'AND branch_id = ?' : ''} GROUP BY status`,
      branchScope ? [tenantId, branchScope] : [tenantId],
    )) as Array<{ status: CheckStatus; amount: string }>;
    const totals = Object.fromEntries(Object.values(CheckStatus).map((status) => [status, '0.00'])) as Record<CheckStatus, string>;
    for (const row of sums) totals[row.status] = Number(row.amount).toFixed(2);

    const names = rows.length
      ? ((await this.dataSource.query(
          `SELECT c.id, TRIM(CONCAT_WS(' ', NULLIF(p.last_name, '-'), p.first_name)) AS customerName, b.name AS branchName, r.number AS receiptNumber
             FROM received_checks c
             LEFT JOIN sales s ON s.id = c.sale_id AND s.tenant_id = c.tenant_id
             LEFT JOIN customer_receipts r ON r.id = c.receipt_id AND r.tenant_id = c.tenant_id
             LEFT JOIN persons p ON p.id = COALESCE(c.customer_person_id, s.customer_person_id) AND p.tenant_id = c.tenant_id
             LEFT JOIN branches b ON b.id = c.branch_id AND b.tenant_id = c.tenant_id
            WHERE c.tenant_id = ? AND c.id IN (${rows.map(() => '?').join(', ')})`,
          [tenantId, ...rows.map((row) => row.id)],
        )) as Array<{ id: string; customerName: string | null; branchName: string | null; receiptNumber: number | null }>)
      : [];
    const byId = new Map(names.map((row) => [String(row.id), row]));
    const items = rows.map((row) =>
      Object.assign(row, {
        customerName: byId.get(row.id)?.customerName || null,
        branchName: byId.get(row.id)?.branchName ?? null,
        receiptNumber: byId.get(row.id)?.receiptNumber != null ? Number(byId.get(row.id)?.receiptNumber) : null,
      }),
    );
    return { ...paginated(items, total, query.page, query.limit), totals };
  }

  async updateStatus(
    tenantId: string,
    actorUserId: string,
    checkId: string,
    dto: UpdateCheckStatusDto,
    branchScope: string | null,
    context: RequestAuditContext,
  ): Promise<ReceivedCheckEntity> {
    return this.dataSource.transaction(async (manager) => {
      const check = await manager
        .createQueryBuilder(ReceivedCheckEntity, 'c')
        .setLock('pessimistic_write')
        .where('c.id = :id AND c.tenantId = :tenantId', { id: checkId, tenantId })
        .getOne();
      if (!check || (branchScope && check.branchId !== branchScope)) throw new NotFoundException('Cheque no encontrado.');
      if (check.status === dto.status) return check;
      if (!TRANSITIONS[check.status].includes(dto.status)) {
        throw new BadRequestException(`Un cheque ${CHECK_STATUS_LABEL[check.status]} no puede pasar a ${CHECK_STATUS_LABEL[dto.status]}.`);
      }
      if (dto.status === CheckStatus.REJECTED && !dto.note) {
        throw new BadRequestException('Indicá el motivo del rechazo (por ejemplo, «sin fondos»).');
      }
      const before = check.status;
      check.status = dto.status;
      check.statusNote = dto.note || null;
      check.statusChangedAt = new Date();
      check.statusChangedByUserId = actorUserId;
      const saved = await manager.save(ReceivedCheckEntity, check);
      // Cheque de un recibo de cuenta corriente rechazado: la deuda vuelve a la cuenta del cliente (vence hoy).
      if (dto.status === CheckStatus.REJECTED && check.receiptId && check.customerPersonId) {
        await lockCustomer(manager, tenantId, check.customerPersonId);
        await postEntry(manager, {
          tenantId,
          branchId: check.branchId,
          customerPersonId: check.customerPersonId,
          kind: AccountEntryKind.REJECTED_CHECK,
          direction: AccountEntryDirection.DEBIT,
          sourceType: 'RECEIVED_CHECK',
          sourceId: check.id,
          description: `Cheque rechazado N.º ${check.number} (${check.bank}): ${dto.note ?? ''}`.trim(),
          amountCents: cents(check.amount),
          currency: check.currency,
          dueDate: localToday(await tenantTimeZone(manager, tenantId)),
          actorUserId,
        });
        await autoApply(manager, tenantId, check.customerPersonId);
      }
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CHECK_STATUS_CHANGED',
        aggregateType: 'RECEIVED_CHECK',
        aggregateId: check.id,
        metadata: { saleId: check.saleId ?? null, receiptId: check.receiptId ?? null, bank: check.bank, number: check.number, amount: check.amount, before, after: dto.status, note: dto.note ?? null },
        context,
      });
      return saved;
    });
  }
}
