import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { RequestAuditContext } from '../../../common/http/request-context';
import { nextSequence } from '../../../common/sequences/sequences';
import { cents, formatMoney, formatQuantity, milli } from '../../../common/utils/money';
import { CashMovementDirection, CashMovementEntity, CashMovementType } from '../../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../../cash/entities/cash-session.entity';
import { InventoryMovementType } from '../../inventory/product/entities/inventory-movement.entity';
import { applyStockMovement, lockStockRows } from '../../inventory/stock-ledger';
import { SaleItemEntity } from '../entities/sale-item.entity';
import { SaleEntity, SaleReturnStatus } from '../entities/sale.entity';
import { LineAmounts, refundForLine, totalOf } from './domain/refund';
import { CreateSaleReturnDto } from './dto/sale-return.dto';
import { SaleReturnItemEntity } from './entities/sale-return-item.entity';
import { RefundMethod, SaleReturnEntity } from './entities/sale-return.entity';

export interface ReturnActor {
  id: string;
  branchId: string | null;
}

const ZERO: LineAmounts = { net: 0n, vat: 0n, exempt: 0n, notTaxed: 0n };

/**
 * Devoluciones de ventas (totales o parciales).
 * En una sola transacción: reintegra importes proporcionales, devuelve la mercadería al stock (si corresponde),
 * registra el egreso de caja para reintegros en efectivo y actualiza el estado de la venta.
 */
@Injectable()
export class SaleReturnsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    tenantId: string,
    actor: ReturnActor,
    saleId: string,
    idempotencyKey: string,
    dto: CreateSaleReturnDto,
    context: RequestAuditContext,
  ): Promise<SaleReturnEntity> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (dto.refundMethod === RefundMethod.CASH && !dto.cashSessionId) {
      throw new BadRequestException('Para reintegrar en efectivo indicá cashSessionId (caja abierta).');
    }
    if (dto.refundMethod !== RefundMethod.CASH && dto.cashSessionId) {
      throw new BadRequestException('cashSessionId solo corresponde a reintegros en efectivo.');
    }
    if (dto.lines && new Set(dto.lines.map((line) => line.saleItemId)).size !== dto.lines.length) {
      throw new BadRequestException('Cada ítem debe aparecer una sola vez.');
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          saleId,
          lines: [...(dto.lines ?? [])]
            .map((line) => [line.saleItemId, formatQuantity(milli(line.quantity))])
            .sort(),
          reason: dto.reason.trim(),
          restock: dto.restock,
          refundMethod: dto.refundMethod,
          cashSessionId: dto.cashSessionId ?? null,
        }),
      )
      .digest('hex');

    const prior = await this.dataSource.getRepository(SaleReturnEntity).findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra devolución.');
      }
      return this.findOne(tenantId, prior.id);
    }

    let returnId: string;
    try {
      returnId = await this.dataSource.transaction((manager) =>
        this.createInTransaction(manager, tenantId, actor, saleId, key, fingerprint, dto, context),
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        const winner = await this.dataSource.getRepository(SaleReturnEntity).findOne({ where: { tenantId, idempotencyKey: key } });
        if (winner && winner.requestFingerprint === fingerprint) return this.findOne(tenantId, winner.id);
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra devolución.');
      }
      throw error;
    }
    return this.findOne(tenantId, returnId);
  }

  async listForSale(tenantId: string, saleId: string, branchScope: string | null): Promise<SaleReturnEntity[]> {
    const sale = await this.dataSource.getRepository(SaleEntity).findOne({
      where: { id: saleId, tenantId, ...(branchScope ? { branchId: branchScope } : {}) },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    return this.dataSource.getRepository(SaleReturnEntity).find({
      where: { tenantId, saleId },
      relations: { items: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(tenantId: string, returnId: string): Promise<SaleReturnEntity> {
    const found = await this.dataSource.getRepository(SaleReturnEntity).findOne({
      where: { id: returnId, tenantId },
      relations: { items: true },
    });
    if (!found) throw new NotFoundException('Devolución no encontrada.');
    return found;
  }

  private async createInTransaction(
    manager: EntityManager,
    tenantId: string,
    actor: ReturnActor,
    saleId: string,
    key: string,
    fingerprint: string,
    dto: CreateSaleReturnDto,
    context: RequestAuditContext,
  ): Promise<string> {
    const sale = await manager
      .createQueryBuilder(SaleEntity, 's')
      .setLock('pessimistic_write')
      .where('s.id = :saleId', { saleId })
      .andWhere('s.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    if (actor.branchId && actor.branchId !== sale.branchId) {
      throw new ForbiddenException('Solo se pueden devolver ventas de su sucursal.');
    }
    if (sale.returnStatus === SaleReturnStatus.FULL) {
      throw new ConflictException('La venta ya fue devuelta en su totalidad.');
    }
    if (dto.refundMethod === RefundMethod.STORE_CREDIT && !sale.customerPersonId) {
      throw new BadRequestException('El saldo a favor requiere que la venta tenga un cliente identificado.');
    }

    const items = await manager.find(SaleItemEntity, { where: { tenantId, saleId } });
    const previous = items.length
      ? await manager.find(SaleReturnItemEntity, { where: { tenantId, saleItemId: In(items.map((item) => item.id)) } })
      : [];
    const returnedQty = new Map<string, bigint>();
    const refunded = new Map<string, LineAmounts>();
    for (const row of previous) {
      returnedQty.set(row.saleItemId, (returnedQty.get(row.saleItemId) ?? 0n) + milli(row.quantity));
      const acc = refunded.get(row.saleItemId) ?? { ...ZERO };
      refunded.set(row.saleItemId, {
        net: acc.net + cents(row.netAmount),
        vat: acc.vat + cents(row.taxAmount),
        exempt: acc.exempt + cents(row.exemptAmount),
        notTaxed: acc.notTaxed + cents(row.notTaxedAmount),
      });
    }

    const itemById = new Map(items.map((item) => [item.id, item]));
    const requested = dto.lines
      ? dto.lines.map((line) => ({ saleItemId: line.saleItemId, quantityMilli: milli(line.quantity) }))
      : items
          .map((item) => ({ saleItemId: item.id, quantityMilli: milli(item.quantity) - (returnedQty.get(item.id) ?? 0n) }))
          .filter((line) => line.quantityMilli > 0n);
    if (requested.length === 0) throw new ConflictException('No hay unidades pendientes de devolución.');

    const computed = requested.map((line) => {
      const item = itemById.get(line.saleItemId);
      if (!item) throw new BadRequestException(`El ítem ${line.saleItemId} no pertenece a la venta.`);
      try {
        const amounts = refundForLine(
          {
            soldMilli: milli(item.quantity),
            returnedMilli: returnedQty.get(item.id) ?? 0n,
            original: {
              net: cents(item.netAmount),
              vat: cents(item.taxAmount),
              exempt: cents(item.exemptAmount ?? 0),
              notTaxed: cents(item.notTaxedAmount ?? 0),
            },
            refunded: refunded.get(item.id) ?? ZERO,
          },
          line.quantityMilli,
        );
        return { item, quantityMilli: line.quantityMilli, amounts };
      } catch (error) {
        if (error instanceof RangeError) {
          throw new BadRequestException(`${item.nameSnapshot}: ${error.message}`);
        }
        throw error;
      }
    });

    const totalCents = computed.reduce((sum, line) => sum + totalOf(line.amounts), 0n);
    const taxCents = computed.reduce((sum, line) => sum + line.amounts.vat, 0n);
    if (totalCents <= 0n) throw new BadRequestException('El importe a reintegrar debe ser mayor a cero.');

    const number = await nextSequence(manager, tenantId, 'SALE_RETURN');
    const saleReturn = await manager.save(
      SaleReturnEntity,
      manager.create(SaleReturnEntity, {
        tenantId,
        number,
        saleId,
        branchId: sale.branchId,
        reason: dto.reason.trim(),
        restock: dto.restock,
        refundMethod: dto.refundMethod,
        cashSessionId: dto.cashSessionId ?? null,
        externalReference: dto.externalReference?.trim() || null,
        subtotal: formatMoney(totalCents - taxCents),
        taxTotal: formatMoney(taxCents),
        total: formatMoney(totalCents),
        currency: sale.currency,
        fiscalStatus: 'NOT_ISSUED',
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId: actor.id,
      }),
    );
    await manager.save(
      SaleReturnItemEntity,
      computed.map((line) =>
        manager.create(SaleReturnItemEntity, {
          tenantId,
          saleReturnId: saleReturn.id,
          saleItemId: line.item.id,
          productId: line.item.productId,
          quantity: formatQuantity(line.quantityMilli),
          netAmount: formatMoney(line.amounts.net),
          taxAmount: formatMoney(line.amounts.vat),
          exemptAmount: formatMoney(line.amounts.exempt),
          notTaxedAmount: formatMoney(line.amounts.notTaxed),
          total: formatMoney(totalOf(line.amounts)),
          unitCost: line.item.unitCost ?? '0.00',
        }),
      ),
    );

    if (dto.restock) {
      const rows = await lockStockRows(manager, tenantId, sale.branchId, computed.map((line) => line.item.productId));
      for (const line of [...computed].sort((a, b) => a.item.productId.localeCompare(b.item.productId))) {
        const row = rows.get(line.item.productId);
        if (!row) {
          throw new ConflictException(`${line.item.nameSnapshot} ya no está habilitado en la sucursal; no se puede reingresar.`);
        }
        await applyStockMovement(manager, {
          tenantId,
          row,
          deltaMilli: line.quantityMilli,
          type: InventoryMovementType.RETURN,
          reason: `Devolución #${number}: ${dto.reason.trim()}`,
          referenceType: 'SALE_RETURN',
          referenceId: saleReturn.id,
          idempotencyKey: `sale-return:${saleReturn.id}:${line.item.id}`,
          actorUserId: actor.id,
        });
      }
    }

    if (dto.refundMethod === RefundMethod.CASH) {
      await this.refundCash(manager, tenantId, actor.id, sale, saleReturn, totalCents);
    }

    const soldByItem = new Map(items.map((item) => [item.id, milli(item.quantity)]));
    for (const line of computed) {
      returnedQty.set(line.item.id, (returnedQty.get(line.item.id) ?? 0n) + line.quantityMilli);
    }
    const fullyReturned = [...soldByItem.entries()].every(([id, sold]) => (returnedQty.get(id) ?? 0n) >= sold);
    sale.returnStatus = fullyReturned ? SaleReturnStatus.FULL : SaleReturnStatus.PARTIAL;
    sale.refundedTotal = formatMoney(cents(sale.refundedTotal ?? 0) + totalCents);
    await manager.save(SaleEntity, sale);

    await recordAudit(manager, {
      tenantId,
      actorUserId: actor.id,
      eventType: 'SALE_RETURNED',
      aggregateType: 'SALE',
      aggregateId: sale.id,
      metadata: {
        returnId: saleReturn.id,
        number,
        total: saleReturn.total,
        refundMethod: dto.refundMethod,
        restock: dto.restock,
        returnStatus: sale.returnStatus,
        reason: saleReturn.reason,
      },
      context,
    });
    return saleReturn.id;
  }

  private async refundCash(
    manager: EntityManager,
    tenantId: string,
    actorUserId: string,
    sale: SaleEntity,
    saleReturn: SaleReturnEntity,
    amountCents: bigint,
  ): Promise<void> {
    const session = await manager
      .createQueryBuilder(CashSessionEntity, 'cs')
      .setLock('pessimistic_write')
      .where('cs.id = :id', { id: saleReturn.cashSessionId })
      .andWhere('cs.tenantId = :tenantId', { tenantId })
      .andWhere('cs.branchId = :branchId', { branchId: sale.branchId })
      .andWhere('cs.status = :status', { status: CashSessionStatus.OPEN })
      .getOne();
    if (!session) throw new BadRequestException('La caja indicada no está abierta en la sucursal de la venta.');
    if (session.currency !== sale.currency) throw new BadRequestException('La moneda de la caja no coincide con la venta.');
    const available = cents(session.expectedAmount);
    if (available < amountCents) {
      throw new BadRequestException(`Efectivo insuficiente en caja: disponible ${formatMoney(available)}.`);
    }
    await manager.save(
      CashMovementEntity,
      manager.create(CashMovementEntity, {
        tenantId,
        branchId: sale.branchId,
        cashSessionId: session.id,
        type: CashMovementType.REFUND,
        direction: CashMovementDirection.OUT,
        amount: formatMoney(amountCents),
        currency: sale.currency,
        reason: `Reintegro por devolución #${saleReturn.number}`,
        sourceType: 'SALE_RETURN',
        sourceId: saleReturn.id,
        externalReference: null,
        idempotencyKey: `sale-return:${saleReturn.id}`,
        requestFingerprint: createHash('sha256').update(`${saleReturn.id}:${formatMoney(amountCents)}`).digest('hex'),
        actorUserId,
      }),
    );
    session.expectedAmount = formatMoney(available - amountCents);
    await manager.save(CashSessionEntity, session);
  }
}
