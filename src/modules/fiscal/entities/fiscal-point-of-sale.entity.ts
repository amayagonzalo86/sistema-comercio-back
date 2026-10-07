import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { ArcaEnvironment } from '../../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';

/** Punto de venta de ARCA habilitado para webservice (RECE) y asignado a una sucursal. */
@Entity('fiscal_points_of_sale')
@Index('UQ_fiscal_pos_tenant_env_number', ['tenantId', 'environment', 'number'], { unique: true })
@Index('UQ_fiscal_pos_tenant_env_branch', ['tenantId', 'environment', 'branchId'], { unique: true })
export class FiscalPointOfSaleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_fiscal_pos_tenant' })
  tenant?: TenantEntity;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @ManyToOne(() => BranchEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id', foreignKeyConstraintName: 'FK_fiscal_pos_branch' })
  branch?: BranchEntity;

  /** Número de punto de venta dado de alta en ARCA (1 a 99998). */
  @Column({ type: 'int', unsigned: true })
  number!: number;

  @Column({ type: 'enum', enum: ArcaEnvironment })
  environment!: ArcaEnvironment;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
