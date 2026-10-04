import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cash_registers')
@Index('UQ_cash_register_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_cash_register_tenant_branch_code', ['tenantId', 'branchId', 'code'], { unique: true })
@Index('UQ_cash_register_tenant_branch_id', ['tenantId', 'branchId', 'id'], { unique: true })
@Index('IDX_cash_register_tenant_branch_active', ['tenantId', 'branchId', 'isActive'])
export class CashRegisterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36 })
  createdByUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
