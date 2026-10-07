import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SaleReturnItemEntity } from './sale-return-item.entity';

export enum RefundMethod {
  /** Se entrega efectivo de una caja abierta de la sucursal. */
  CASH = 'CASH',
  /** Reverso en tarjeta, transferencia o billetera (se registra la referencia). */
  ORIGINAL_METHOD = 'ORIGINAL_METHOD',
  /** Queda como saldo a favor del cliente (vale / nota de crédito interna). */
  STORE_CREDIT = 'STORE_CREDIT',
}

@Entity('sale_returns')
@Index('UQ_sale_returns_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('UQ_sale_returns_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sale_returns_sale', ['tenantId', 'saleId'])
@Index('IDX_sale_returns_branch_created', ['tenantId', 'branchId', 'createdAt'])
export class SaleReturnEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'sale_id', type: 'varchar', length: 36 })
  saleId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  /** true: la mercadería vuelve al stock vendible; false: se descarta (fallada, vencida). */
  @Column({ type: 'boolean', default: true })
  restock!: boolean;

  @Column({ name: 'refund_method', type: 'enum', enum: RefundMethod })
  refundMethod!: RefundMethod;

  @Column({ name: 'cash_session_id', type: 'varchar', length: 36, nullable: true })
  cashSessionId?: string | null;

  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  subtotal!: string;

  @Column({ name: 'tax_total', type: 'decimal', precision: 14, scale: 2 })
  taxTotal!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Estado de la nota de crédito fiscal asociada (si la venta fue facturada). */
  @Column({ name: 'fiscal_status', type: 'varchar', length: 20, default: 'NOT_ISSUED' })
  fiscalStatus!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @OneToMany(() => SaleReturnItemEntity, (item) => item.saleReturn)
  items!: SaleReturnItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
