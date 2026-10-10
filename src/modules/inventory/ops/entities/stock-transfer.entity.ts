import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TenantEntity } from '../../../platform/entities/tenant.entity';
import { BranchEntity } from '../../../branches/entities/branch.entity';
import { StockTransferItemEntity } from './stock-transfer-item.entity';

export enum StockTransferStatus {
  /** Despachada: el stock ya salió del origen y está en tránsito. */
  SENT = 'SENT',
  /** Recibida en destino (total o con faltantes registrados). */
  RECEIVED = 'RECEIVED',
  /** Anulada antes de recibirse: el stock volvió al origen. */
  CANCELLED = 'CANCELLED',
}

@Entity('stock_transfers')
@Index('UQ_stock_transfers_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('UQ_stock_transfers_tenant_number', ['tenantId', 'number'], { unique: true })
@Index('IDX_stock_transfers_origin', ['tenantId', 'originBranchId', 'status', 'createdAt'])
@Index('IDX_stock_transfers_destination', ['tenantId', 'destinationBranchId', 'status', 'createdAt'])
export class StockTransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_stock_transfers_tenant' })
  tenant?: TenantEntity;

  /** Número correlativo legible por empresa (remito interno). */
  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ name: 'origin_branch_id', type: 'varchar', length: 36 })
  originBranchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'origin_branch_id', foreignKeyConstraintName: 'FK_stock_transfers_origin' })
  originBranch?: BranchEntity;

  @Column({ name: 'destination_branch_id', type: 'varchar', length: 36 })
  destinationBranchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'destination_branch_id', foreignKeyConstraintName: 'FK_stock_transfers_destination' })
  destinationBranch?: BranchEntity;

  @Column({ type: 'enum', enum: StockTransferStatus, default: StockTransferStatus.SENT })
  status!: StockTransferStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ name: 'sent_by_user_id', type: 'varchar', length: 36 })
  sentByUserId!: string;

  @Column({ name: 'received_by_user_id', type: 'varchar', length: 36, nullable: true })
  receivedByUserId?: string | null;

  @Column({ name: 'received_at', type: 'timestamp', precision: 6, nullable: true })
  receivedAt?: Date | null;

  @Column({ name: 'receipt_notes', type: 'varchar', length: 500, nullable: true })
  receiptNotes?: string | null;

  @Column({ name: 'cancelled_by_user_id', type: 'varchar', length: 36, nullable: true })
  cancelledByUserId?: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', precision: 6, nullable: true })
  cancelledAt?: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 200, nullable: true })
  cancelReason?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @OneToMany(() => StockTransferItemEntity, (item) => item.transfer)
  items!: StockTransferItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
