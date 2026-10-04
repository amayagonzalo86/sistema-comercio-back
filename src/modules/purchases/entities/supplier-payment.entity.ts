import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SupplierPaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHECK = 'CHECK',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

@Entity('supplier_payments')
@Index('UQ_supplier_payments_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_supplier_payments_tenant_idempotency', ['tenantId', 'idempotencyKey'], { unique: true })
@Index('IDX_supplier_payments_tenant_supplier_created', ['tenantId', 'supplierPersonId', 'createdAt'])
export class SupplierPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'supplier_person_id', type: 'varchar', length: 36 })
  supplierPersonId!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: SupplierPaymentMethod })
  method!: SupplierPaymentMethod;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
