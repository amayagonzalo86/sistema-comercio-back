import { EntityManager } from 'typeorm';
import { formatQuantity, milli } from '../../common/utils/money';
import { InventoryMovementEntity, InventoryMovementType } from './product/entities/inventory-movement.entity';
import { ProductBranchEntity } from './product/entities/product-branch.entity';

export interface StockMovementInput {
  tenantId: string;
  /** Fila de stock ya bloqueada (SELECT ... FOR UPDATE) dentro de la misma transacción. */
  row: ProductBranchEntity;
  deltaMilli: bigint;
  type: InventoryMovementType;
  reason: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  actorUserId: string | null;
  /** Permite dejar stock negativo (por defecto no). */
  allowNegative?: boolean;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly productId: string,
    readonly branchId: string,
    readonly availableMilli: bigint,
    readonly requestedMilli: bigint,
  ) {
    super(`Stock insuficiente para el producto ${productId} en la sucursal ${branchId}.`);
  }
}

/**
 * Único punto de cambio de stock: actualiza el saldo y registra el movimiento inmutable en la misma transacción.
 * Garantiza que no exista stock sin movimiento que lo explique.
 */
export async function applyStockMovement(manager: EntityManager, input: StockMovementInput): Promise<InventoryMovementEntity> {
  const beforeMilli = milli(input.row.stock, true);
  const afterMilli = beforeMilli + input.deltaMilli;
  if (afterMilli < 0n && !input.allowNegative) {
    throw new InsufficientStockError(input.row.productId, input.row.branchId, beforeMilli, -input.deltaMilli);
  }
  input.row.stock = Number(formatQuantity(afterMilli));
  await manager.save(ProductBranchEntity, input.row);
  return manager.save(
    InventoryMovementEntity,
    manager.create(InventoryMovementEntity, {
      tenantId: input.tenantId,
      productId: input.row.productId,
      branchId: input.row.branchId,
      movementType: input.type,
      quantityDelta: formatQuantity(input.deltaMilli),
      quantityBefore: formatQuantity(beforeMilli),
      quantityAfter: formatQuantity(afterMilli),
      reason: input.reason.slice(0, 255),
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey.slice(0, 100),
      actorUserId: input.actorUserId,
    }),
  );
}

/** Bloquea filas de stock en orden determinístico (evita deadlocks entre transacciones concurrentes). */
export async function lockStockRows(
  manager: EntityManager,
  tenantId: string,
  branchId: string,
  productIds: string[],
): Promise<Map<string, ProductBranchEntity>> {
  const sorted = [...new Set(productIds)].sort();
  const rows = sorted.length
    ? await manager
        .createQueryBuilder(ProductBranchEntity, 'pb')
        .innerJoinAndSelect('pb.product', 'p')
        .setLock('pessimistic_write')
        .where('pb.tenantId = :tenantId', { tenantId })
        .andWhere('pb.branchId = :branchId', { branchId })
        .andWhere('pb.productId IN (:...productIds)', { productIds: sorted })
        .orderBy('pb.productId', 'ASC')
        .getMany()
    : [];
  return new Map(rows.map((row) => [row.productId, row]));
}
