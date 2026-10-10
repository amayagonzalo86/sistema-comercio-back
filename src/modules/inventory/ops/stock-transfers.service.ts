import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { nextSequence } from '../../../common/sequences/sequences';
import { formatQuantity, milli } from '../../../common/utils/money';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { InventoryMovementType } from '../product/entities/inventory-movement.entity';
import { ProductBranchEntity } from '../product/entities/product-branch.entity';
import { applyStockMovement, InsufficientStockError, lockStockRows } from '../stock-ledger';
import {
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  StockTransferQueryDto,
} from './dto/stock-transfer.dto';
import { StockTransferItemEntity } from './entities/stock-transfer-item.entity';
import { StockTransferEntity, StockTransferStatus } from './entities/stock-transfer.entity';

export interface TransferActor {
  id: string;
  /** Sucursal asignada en la membresía; null para titulares/administradores sin sucursal. */
  branchId: string | null;
}

/**
 * Transferencias de mercadería entre sucursales.
 * Al despachar, el stock sale del origen; al recibir, entra al destino. Cada paso es atómico,
 * registra movimientos de inventario y queda auditado.
 */
@Injectable()
export class StockTransfersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    tenantId: string,
    actor: TransferActor,
    idempotencyKey: string,
    dto: CreateStockTransferDto,
    context: RequestAuditContext,
  ): Promise<StockTransferEntity> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (dto.originBranchId === dto.destinationBranchId) {
      throw new BadRequestException('El origen y el destino deben ser sucursales distintas.');
    }
    if (actor.branchId && actor.branchId !== dto.originBranchId) {
      throw new ForbiddenException('Solo puede despachar mercadería desde su sucursal.');
    }
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez.');
    }

    const lines = [...dto.lines]
      .map((line) => ({ productId: line.productId, quantityMilli: milli(line.quantity) }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          origin: dto.originBranchId,
          destination: dto.destinationBranchId,
          lines: lines.map((line) => [line.productId, formatQuantity(line.quantityMilli)]),
        }),
      )
      .digest('hex');

    const existing = await this.dataSource.getRepository(StockTransferEntity).findOne({ where: { tenantId, idempotencyKey: key } });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra transferencia.');
      }
      return this.findOne(tenantId, existing.id, null);
    }

    let transferId: string;
    try {
      transferId = await this.createInTransaction(tenantId, actor, key, fingerprint, dto, lines, context);
    } catch (error) {
      // Dos pedidos simultáneos con la misma clave: el segundo choca con el índice único y devuelve el primero.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        const winner = await this.dataSource.getRepository(StockTransferEntity).findOne({ where: { tenantId, idempotencyKey: key } });
        if (winner && winner.requestFingerprint === fingerprint) return this.findOne(tenantId, winner.id, null);
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra transferencia.');
      }
      throw error;
    }
    return this.findOne(tenantId, transferId, null);
  }

  private async createInTransaction(
    tenantId: string,
    actor: TransferActor,
    key: string,
    fingerprint: string,
    dto: CreateStockTransferDto,
    lines: Array<{ productId: string; quantityMilli: bigint }>,
    context: RequestAuditContext,
  ): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const branches = await manager.find(BranchEntity, {
        where: [
          { id: dto.originBranchId, tenantId, status: true },
          { id: dto.destinationBranchId, tenantId, status: true },
        ],
        select: { id: true },
      });
      if (branches.length !== 2) {
        throw new NotFoundException('El origen o el destino no existen o no están activos en esta empresa.');
      }

      const stockRows = await lockStockRows(manager, tenantId, dto.originBranchId, lines.map((line) => line.productId));
      for (const line of lines) {
        const row = stockRows.get(line.productId);
        if (!row || !row.isActive || !row.product?.status) {
          throw new NotFoundException(`El producto ${line.productId} no está activo en la sucursal de origen.`);
        }
      }

      const number = await nextSequence(manager, tenantId, 'STOCK_TRANSFER');
      const transfer = await manager.save(
        StockTransferEntity,
        manager.create(StockTransferEntity, {
          tenantId,
          number,
          originBranchId: dto.originBranchId,
          destinationBranchId: dto.destinationBranchId,
          status: StockTransferStatus.SENT,
          notes: dto.notes || null,
          sentByUserId: actor.id,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
        }),
      );

      const items: StockTransferItemEntity[] = [];
      for (const line of lines) {
        const row = stockRows.get(line.productId) as ProductBranchEntity;
        try {
          await applyStockMovement(manager, {
            tenantId,
            row,
            deltaMilli: -line.quantityMilli,
            type: InventoryMovementType.TRANSFER_OUT,
            reason: `Transferencia #${number} a otra sucursal`,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            idempotencyKey: `transfer-out:${transfer.id}:${line.productId}`,
            actorUserId: actor.id,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw new BadRequestException(
              `Stock insuficiente de ${row.product.sku}: disponible ${formatQuantity(error.availableMilli)}, solicitado ${formatQuantity(error.requestedMilli)}.`,
            );
          }
          throw error;
        }
        items.push(
          manager.create(StockTransferItemEntity, {
            tenantId,
            transferId: transfer.id,
            productId: line.productId,
            skuSnapshot: row.product.sku,
            nameSnapshot: row.product.name,
            quantitySent: formatQuantity(line.quantityMilli),
            quantityReceived: null,
            unitCost: Number(row.costPrice).toFixed(2),
          }),
        );
      }
      await manager.save(StockTransferItemEntity, items);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'STOCK_TRANSFER_SENT',
        aggregateType: 'STOCK_TRANSFER',
        aggregateId: transfer.id,
        metadata: {
          number,
          originBranchId: dto.originBranchId,
          destinationBranchId: dto.destinationBranchId,
          lineCount: items.length,
        },
        context,
      });
      return transfer.id;
    });
  }

  async receive(
    tenantId: string,
    actor: TransferActor,
    transferId: string,
    dto: ReceiveStockTransferDto,
    context: RequestAuditContext,
  ): Promise<StockTransferEntity> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockTransfer(manager, tenantId, transferId);
      if (actor.branchId && actor.branchId !== transfer.destinationBranchId) {
        throw new ForbiddenException('Solo la sucursal de destino puede recibir la transferencia.');
      }
      if (transfer.status !== StockTransferStatus.SENT) {
        throw new ConflictException('La transferencia ya fue recibida o anulada.');
      }
      const items = await manager.find(StockTransferItemEntity, { where: { tenantId, transferId } });
      const received = new Map<string, bigint>();
      for (const item of items) received.set(item.productId, milli(item.quantitySent));
      for (const line of dto.lines ?? []) {
        if (!received.has(line.productId)) {
          throw new BadRequestException(`El producto ${line.productId} no forma parte de la transferencia.`);
        }
        const quantity = milli(line.quantityReceived);
        if (quantity > (received.get(line.productId) as bigint)) {
          throw new BadRequestException('No se puede recibir más de lo enviado.');
        }
        received.set(line.productId, quantity);
      }

      const destinationRows = await lockStockRows(manager, tenantId, transfer.destinationBranchId, items.map((item) => item.productId));
      const discrepancies: Array<{ productId: string; sent: string; received: string }> = [];
      for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const quantity = received.get(item.productId) as bigint;
        let row = destinationRows.get(item.productId);
        if (!row) {
          // Primera vez que el producto llega a esta sucursal: se habilita con el costo y precio del origen.
          const originRow = await manager.findOne(ProductBranchEntity, {
            where: { tenantId, branchId: transfer.originBranchId, productId: item.productId },
          });
          row = await manager.save(
            ProductBranchEntity,
            manager.create(ProductBranchEntity, {
              tenantId,
              productId: item.productId,
              branchId: transfer.destinationBranchId,
              costPrice: originRow?.costPrice ?? Number(item.unitCost),
              profitMargin: originRow?.profitMargin ?? 0,
              sellingPrice: originRow?.sellingPrice ?? 0,
              stock: 0,
              minStock: 0,
              isActive: true,
            }),
          );
        }
        if (quantity > 0n) {
          await applyStockMovement(manager, {
            tenantId,
            row,
            deltaMilli: quantity,
            type: InventoryMovementType.TRANSFER_IN,
            reason: `Recepción de transferencia #${transfer.number}`,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            idempotencyKey: `transfer-in:${transfer.id}:${item.productId}`,
            actorUserId: actor.id,
          });
        }
        item.quantityReceived = formatQuantity(quantity);
        if (quantity !== milli(item.quantitySent)) {
          discrepancies.push({ productId: item.productId, sent: item.quantitySent, received: item.quantityReceived });
        }
      }
      await manager.save(StockTransferItemEntity, items);

      transfer.status = StockTransferStatus.RECEIVED;
      transfer.receivedByUserId = actor.id;
      transfer.receivedAt = new Date();
      transfer.receiptNotes = dto.notes?.trim() || null;
      await manager.save(StockTransferEntity, transfer);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: discrepancies.length ? 'STOCK_TRANSFER_RECEIVED_WITH_DIFFERENCES' : 'STOCK_TRANSFER_RECEIVED',
        aggregateType: 'STOCK_TRANSFER',
        aggregateId: transfer.id,
        metadata: { number: transfer.number, discrepancies },
        context,
      });
    });
    return this.findOne(tenantId, transferId, null);
  }

  async cancel(
    tenantId: string,
    actor: TransferActor,
    transferId: string,
    dto: CancelStockTransferDto,
    context: RequestAuditContext,
  ): Promise<StockTransferEntity> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockTransfer(manager, tenantId, transferId);
      if (actor.branchId && actor.branchId !== transfer.originBranchId) {
        throw new ForbiddenException('Solo la sucursal de origen puede anular la transferencia.');
      }
      if (transfer.status !== StockTransferStatus.SENT) {
        throw new ConflictException('Solo se pueden anular transferencias en tránsito.');
      }
      const items = await manager.find(StockTransferItemEntity, { where: { tenantId, transferId } });
      const originRows = await lockStockRows(manager, tenantId, transfer.originBranchId, items.map((item) => item.productId));
      for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const row = originRows.get(item.productId);
        if (!row) {
          throw new ConflictException(`El producto ${item.skuSnapshot} ya no existe en la sucursal de origen.`);
        }
        await applyStockMovement(manager, {
          tenantId,
          row,
          deltaMilli: milli(item.quantitySent),
          type: InventoryMovementType.TRANSFER_IN,
          reason: `Anulación de transferencia #${transfer.number}`,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          idempotencyKey: `transfer-cancel:${transfer.id}:${item.productId}`,
          actorUserId: actor.id,
        });
      }
      transfer.status = StockTransferStatus.CANCELLED;
      transfer.cancelledByUserId = actor.id;
      transfer.cancelledAt = new Date();
      transfer.cancelReason = dto.reason.trim();
      await manager.save(StockTransferEntity, transfer);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'STOCK_TRANSFER_CANCELLED',
        aggregateType: 'STOCK_TRANSFER',
        aggregateId: transfer.id,
        metadata: { number: transfer.number, reason: transfer.cancelReason },
        context,
      });
    });
    return this.findOne(tenantId, transferId, null);
  }

  async list(tenantId: string, query: StockTransferQueryDto, branchScope: string | null): Promise<Paginated<StockTransferEntity>> {
    const branchId = branchScope ?? query.branchId ?? null;
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const qb = this.dataSource
      .getRepository(StockTransferEntity)
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (branchId) qb.andWhere('(t.originBranchId = :branchId OR t.destinationBranchId = :branchId)', { branchId });
    const [items, total] = await qb
      .orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(items, total, query.page, query.limit);
  }

  async findOne(tenantId: string, transferId: string, branchScope: string | null): Promise<StockTransferEntity> {
    const transfer = await this.dataSource.getRepository(StockTransferEntity).findOne({
      where: { id: transferId, tenantId },
      relations: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transferencia no encontrada.');
    if (branchScope && branchScope !== transfer.originBranchId && branchScope !== transfer.destinationBranchId) {
      throw new NotFoundException('Transferencia no encontrada.');
    }
    return transfer;
  }

  private async lockTransfer(manager: EntityManager, tenantId: string, transferId: string): Promise<StockTransferEntity> {
    const transfer = await manager
      .createQueryBuilder(StockTransferEntity, 't')
      .setLock('pessimistic_write')
      .where('t.id = :transferId', { transferId })
      .andWhere('t.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!transfer) throw new NotFoundException('Transferencia no encontrada.');
    return transfer;
  }
}
