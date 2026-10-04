import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SaleFiscalStatus {
  NOT_ISSUED = 'NOT_ISSUED',
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

@Entity('sales')
@Index('UQ_sales_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_sales_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_sales_tenant_branch_created', ['tenantId', 'branchId', 'createdAt'])
export class SaleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'customer_person_id', type: 'varchar', length: 36, nullable: true })
  customerPersonId?: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  subtotal!: string;

  @Column({ name: 'tax_total', type: 'decimal', precision: 14, scale: 2 })
  taxTotal!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ name: 'fiscal_status', type: 'enum', enum: SaleFiscalStatus, default: SaleFiscalStatus.NOT_ISSUED })
  fiscalStatus!: SaleFiscalStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
