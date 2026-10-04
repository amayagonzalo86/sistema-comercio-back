import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum InventoryMovementType {
  OPENING = 'OPENING',
  ADJUSTMENT = 'ADJUSTMENT',
  PURCHASE = 'PURCHASE',
  SALE = 'SALE',
  RETURN = 'RETURN',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
}

@Entity('inventory_movements')
@Index('UQ_inventory_movements_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_inventory_movements_stock_cursor', ['tenantId', 'productId', 'branchId', 'id'])
@Index('IDX_inventory_movements_tenant_time', ['tenantId', 'createdAt'])
export class InventoryMovementEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 36 })
  productId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'movement_type', type: 'enum', enum: InventoryMovementType })
  movementType!: InventoryMovementType;

  @Column({ name: 'quantity_delta', type: 'decimal', precision: 12, scale: 3 })
  quantityDelta!: string;

  @Column({ name: 'quantity_before', type: 'decimal', precision: 12, scale: 3 })
  quantityBefore!: string;

  @Column({ name: 'quantity_after', type: 'decimal', precision: 12, scale: 3 })
  quantityAfter!: string;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType?: string | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 36, nullable: true })
  referenceId?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36, nullable: true })
  actorUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
