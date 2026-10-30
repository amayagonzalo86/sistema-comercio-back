import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { RequestAuditContext } from '../../../common/http/request-context';
import { nextSequence } from '../../../common/sequences/sequences';
import { cents, formatMoney } from '../../../common/utils/money';
import { CashMovementDirection, CashMovementEntity, CashMovementType } from '../../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../../cash/entities/cash-session.entity';
import { FiscalDocumentEntity, FiscalDocumentStatus, FiscalSourceType } from '../../fiscal/entities/fiscal-document.entity';
import { DEFAULT_VAT_PERCENT } from '../../fiscal/vat/vat';
import { SaleEntity } from '../entities/sale.entity';
import { tenantTimeZone } from '../../../common/time/local-day-range';
import { localToday } from '../../reports/domain/period';
import { autoApply, lockCustomer, postEntry } from '../accounts/account-ledger';
import { addDays } from '../accounts/domain/account-math';
import { AccountEntryDirection, AccountEntryKind } from '../accounts/entities/customer-account-entry.entity';
import { adjustmentAmounts, AdjustmentVatMode } from './domain/adjustment-amounts';
import { CreateSaleAdjustmentDto } from './dto/sale-adjustment.dto';
import { SaleAdjustmentEntity, SaleAdjustmentKind, SaleAdjustmentSettlement } from './entities/sale-adjustment.entity';

export interface AdjustmentActor {
  id: string;
  branchId: string | null;
}

const MAX_CENTS = 99_999_999_999_999n;

/**
 * Notas de crédito y débito por importe sobre una venta facturada (bonificaciones, diferencias de precio,
 * intereses, cheques rechazados). No mueven mercadería: para eso está la devolución.
 * En una transacción: numera, discrimina el IVA, registra el reintegro o cobro en caja si es en efectivo y audita.
 * El comprobante electrónico (ND/NC asociada a la factura) se emite con POST /fiscal/adjustments/:id/note.
 */
@Injectable()
export class SaleAdjustmentsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    tenantId: string,
    actor: AdjustmentActor,
    saleId: string,
    idempotencyKey: string,
    dto: CreateSaleAdjustmentDto,
    context: RequestAuditContext,
  ): Promise<SaleAdjustmentEntity> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    if (dto.settlement === SaleAdjustmentSettlement.CASH && !dto.cashSessionId) {
      throw new BadRequestException('Para liquidar en efectivo indicá la caja abierta (cashSessionId).');
    }
    if (dto.settlement !== SaleAdjustmentSettlement.CASH && dto.cashSessionId) {
      throw new BadRequestException('La caja solo corresponde a notas liquidadas en efectivo.');
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          saleId,
          kind: dto.kind,
          concept: dto.concept,
          reason: dto.reason,
          amount: Number(dto.amount).toFixed(2),
          taxRate: dto.taxRate ?? null,
          settlement: dto.settlement,
          cashSessionId: dto.cashSessionId ?? null,
          externalReference: dto.externalReference ?? null,
        }),
      )
      .digest('hex');

    const repository = this.dataSource.getRepository(SaleAdjustmentEntity);
    const prior = await repository.findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key ya fue utilizado para otra nota.');
      return prior;
    }
    try {
      const id = await this.dataSource.transaction((manager) => this.createInTransaction(manager, tenantId, actor, saleId, key, fingerprint, dto, context));
      return repository.findOneOrFail({ where: { id, tenantId } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        const winner = await repository.findOne({ where: { tenantId, idempotencyKey: key } });
        if (winner && winner.requestFingerprint === fingerprint) return winner;
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra nota.');
      }
      throw error;
    }
  }

  async listForSale(tenantId: string, saleId: string, branchScope: string | null): Promise<Array<SaleAdjustmentEntity & { fiscalDocumentId: string | null }>> {
    const sale = await this.dataSource.getRepository(SaleEntity).findOne({
      where: { id: saleId, tenantId, ...(branchScope ? { branchId: branchScope } : {}) },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    const adjustments = await this.dataSource.getRepository(SaleAdjustmentEntity).find({ where: { tenantId, saleId }, order: { createdAt: 'ASC' } });
    if (adjustments.length === 0) return [];
    const documents = (await this.dataSource.query(
      `SELECT id, source_id AS sourceId FROM fiscal_documents
        WHERE tenant_id = ? AND source_type = 'SALE_ADJUSTMENT' AND source_id IN (${adjustments.map(() => '?').join(', ')})`,
      [tenantId, ...adjustments.map((item) => item.id)],
    )) as Array<{ id: string; sourceId: string }>;
    const byAdjustment = new Map(documents.map((row) => [String(row.sourceId), String(row.id)]));
    return adjustments.map((item) => Object.assign(item, { fiscalDocumentId: byAdjustment.get(item.id) ?? null }));
  }

  private async createInTransaction(
    manager: EntityManager,
    tenantId: string,
    actor: AdjustmentActor,
    saleId: string,
    key: string,
    fingerprint: string,
    dto: CreateSaleAdjustmentDto,
    context: RequestAuditContext,
  ): Promise<string> {
    // La venta se bloquea para que dos notas de crédito simultáneas no superen el total.
    const sale = await manager
      .createQueryBuilder(SaleEntity, 's')
      .setLock('pessimistic_write')
      .where('s.id = :saleId AND s.tenantId = :tenantId', { saleId, tenantId })
      .getOne();
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    if (actor.branchId && actor.branchId !== sale.branchId) throw new ForbiddenException('Solo se pueden emitir notas de ventas de su sucursal.');
    const invoice = await manager.findOne(FiscalDocumentEntity, {
      where: { tenantId, sourceType: FiscalSourceType.SALE, sourceId: sale.id, status: FiscalDocumentStatus.AUTHORIZED },
    });
    if (!invoice) {
      throw new BadRequestException('La venta no tiene una factura autorizada por ARCA: emití primero la factura para poder hacerle notas de crédito o débito.');
    }

    const totalCents = cents(Number(dto.amount).toFixed(2));
    if (totalCents > MAX_CENTS) throw new BadRequestException('El importe excede el máximo admitido.');
    const [sums] = (await manager.query(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'CREDIT' THEN total ELSE 0 END), 0) AS credits,
              COALESCE(SUM(CASE WHEN kind = 'DEBIT' THEN total ELSE 0 END), 0) AS debits
         FROM sale_adjustments WHERE tenant_id = ? AND sale_id = ?`,
      [tenantId, sale.id],
    )) as Array<{ credits: string; debits: string }>;
    if (dto.kind === SaleAdjustmentKind.CREDIT) {
      // Lo que se puede acreditar: total facturado + débitos − devoluciones − créditos anteriores.
      const available = cents(sale.total) + cents(String(sums.debits)) - cents(sale.refundedTotal ?? '0') - cents(String(sums.credits));
      if (totalCents > available) {
        throw new BadRequestException(`La nota de crédito supera el saldo de la venta: se pueden acreditar hasta $ ${formatMoney(available > 0n ? available : 0n)}.`);
      }
    }

    const mode: AdjustmentVatMode = invoice.voucherClass === 'C' ? 'NET_ONLY' : cents(sale.taxTotal) === 0n ? 'EXEMPT' : 'TAXED';
    const ratePercent = dto.taxRate ?? (await this.mainRate(manager, tenantId, sale.id));
    let amounts;
    try {
      amounts = adjustmentAmounts(totalCents, ratePercent, mode);
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException(error.message);
      throw error;
    }

    const number = await nextSequence(manager, tenantId, 'SALE_ADJUSTMENT');
    const adjustment = await manager.save(
      SaleAdjustmentEntity,
      manager.create(SaleAdjustmentEntity, {
        tenantId,
        number,
        saleId: sale.id,
        branchId: sale.branchId,
        kind: dto.kind,
        concept: dto.concept,
        reason: dto.reason,
        taxRate: formatMoney(amounts.rateBasisPoints),
        arcaVatRateId: amounts.arcaVatRateId,
        netAmount: formatMoney(amounts.netCents),
        taxAmount: formatMoney(amounts.vatCents),
        exemptAmount: formatMoney(amounts.exemptCents),
        total: formatMoney(amounts.totalCents),
        currency: sale.currency,
        settlement: dto.settlement,
        cashSessionId: dto.cashSessionId ?? null,
        externalReference: dto.externalReference || null,
        fiscalStatus: 'NOT_ISSUED',
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId: actor.id,
      }),
    );

    if (dto.settlement === SaleAdjustmentSettlement.CASH) {
      await this.settleCash(manager, tenantId, actor.id, sale, adjustment, totalCents);
    }
    // Sin reintegro ni cobro y con cliente identificado: va a su cuenta corriente (débito a cobrar o saldo a favor).
    if (dto.settlement === SaleAdjustmentSettlement.NONE && sale.customerPersonId) {
      const customer = await lockCustomer(manager, tenantId, sale.customerPersonId);
      const today = localToday(await tenantTimeZone(manager, tenantId));
      const isCredit = dto.kind === SaleAdjustmentKind.CREDIT;
      await postEntry(manager, {
        tenantId,
        branchId: sale.branchId,
        customerPersonId: customer.id,
        kind: isCredit ? AccountEntryKind.CREDIT_NOTE : AccountEntryKind.DEBIT_NOTE,
        direction: isCredit ? AccountEntryDirection.CREDIT : AccountEntryDirection.DEBIT,
        sourceType: 'SALE_ADJUSTMENT',
        sourceId: adjustment.id,
        saleId: sale.id,
        description: `${isCredit ? 'Nota de crédito' : 'Nota de débito'}: ${adjustment.concept}`,
        amountCents: totalCents,
        currency: sale.currency,
        dueDate: addDays(today, customer.creditTermDays),
        actorUserId: actor.id,
      });
      await autoApply(manager, tenantId, customer.id);
    }
    if (dto.kind === SaleAdjustmentKind.CREDIT) {
      sale.refundedTotal = formatMoney(cents(sale.refundedTotal ?? '0') + totalCents);
      await manager.save(SaleEntity, sale);
    }

    await recordAudit(manager, {
      tenantId,
      actorUserId: actor.id,
      eventType: dto.kind === SaleAdjustmentKind.CREDIT ? 'SALE_CREDIT_NOTE_CREATED' : 'SALE_DEBIT_NOTE_CREATED',
      aggregateType: 'SALE',
      aggregateId: sale.id,
      metadata: {
        adjustmentId: adjustment.id,
        number,
        concept: adjustment.concept,
        reason: adjustment.reason,
        total: adjustment.total,
        taxRate: adjustment.taxRate,
        settlement: adjustment.settlement,
        invoice: { voucherType: invoice.voucherType, pointOfSale: invoice.pointOfSale, number: invoice.number },
      },
      context,
    });
    return adjustment.id;
  }

  /** Alícuota principal de la venta (la de mayor base imponible); 21 % si no hay ítems gravados. */
  private async mainRate(manager: EntityManager, tenantId: string, saleId: string): Promise<number> {
    const [row] = (await manager.query(
      `SELECT tax_rate AS rate FROM sale_items WHERE tenant_id = ? AND sale_id = ? AND arca_vat_rate_id IS NOT NULL
        GROUP BY tax_rate ORDER BY SUM(net_amount) DESC LIMIT 1`,
      [tenantId, saleId],
    )) as Array<{ rate: string }>;
    return row ? Number(row.rate) : DEFAULT_VAT_PERCENT;
  }

  private async settleCash(
    manager: EntityManager,
    tenantId: string,
    actorUserId: string,
    sale: SaleEntity,
    adjustment: SaleAdjustmentEntity,
    amountCents: bigint,
  ): Promise<void> {
    const session = await manager
      .createQueryBuilder(CashSessionEntity, 'cs')
      .setLock('pessimistic_write')
      .where('cs.id = :id AND cs.tenantId = :tenantId AND cs.branchId = :branchId AND cs.status = :status', {
        id: adjustment.cashSessionId,
        tenantId,
        branchId: sale.branchId,
        status: CashSessionStatus.OPEN,
      })
      .getOne();
    if (!session) throw new BadRequestException('La caja indicada no está abierta en la sucursal de la venta.');
    if (session.currency !== sale.currency) throw new BadRequestException('La moneda de la caja no coincide con la venta.');
    const available = cents(session.expectedAmount);
    const credit = adjustment.kind === SaleAdjustmentKind.CREDIT;
    if (credit && available < amountCents) {
      throw new BadRequestException(`Efectivo insuficiente en caja: disponible $ ${formatMoney(available)}.`);
    }
    const label = credit ? 'Reintegro por nota de crédito' : 'Cobro de nota de débito';
    await manager.save(
      CashMovementEntity,
      manager.create(CashMovementEntity, {
        tenantId,
        branchId: sale.branchId,
        cashSessionId: session.id,
        type: credit ? CashMovementType.REFUND : CashMovementType.SALE,
        direction: credit ? CashMovementDirection.OUT : CashMovementDirection.IN,
        amount: formatMoney(amountCents),
        currency: sale.currency,
        reason: `${label} #${adjustment.number}: ${adjustment.concept}`.slice(0, 200),
        sourceType: 'SALE_ADJUSTMENT',
        sourceId: adjustment.id,
        externalReference: null,
        idempotencyKey: `sale-adjustment:${adjustment.id}`,
        requestFingerprint: createHash('sha256').update(`${adjustment.id}:${formatMoney(amountCents)}`).digest('hex'),
        actorUserId,
      }),
    );
    session.expectedAmount = formatMoney(credit ? available - amountCents : available + amountCents);
    await manager.save(CashSessionEntity, session);
  }
}
