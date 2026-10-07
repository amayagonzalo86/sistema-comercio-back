import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';

export enum ArcaEnvironment {
  HOMOLOGATION = 'HOMOLOGATION',
  PRODUCTION = 'PRODUCTION',
}

@Entity('fiscal_profiles')
@Index('UQ_fiscal_profile_tenant_tax_env', ['tenantId', 'taxId', 'environment'], { unique: true })
@Index('IDX_fiscal_profile_tenant_status', ['tenantId', 'isActive'])
export class FiscalProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 11 })
  taxId!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName!: string;

  // Kept as a catalog code so ARCA/tax catalogs can evolve without schema changes.
  @Column({ name: 'vat_condition_code', type: 'varchar', length: 40 })
  vatConditionCode!: string;

  @Column({
    name: 'gross_income_registration',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  grossIncomeRegistration?: string | null;

  @Column({
    type: 'enum',
    enum: ArcaEnvironment,
    default: ArcaEnvironment.HOMOLOGATION,
  })
  environment!: ArcaEnvironment;

  // References to a secrets manager only; certificate/private-key contents never belong here.
  @Column({ name: 'certificate_secret_ref', type: 'varchar', length: 255, nullable: true })
  certificateSecretRef?: string | null;

  @Column({ name: 'private_key_secret_ref', type: 'varchar', length: 255, nullable: true })
  privateKeySecretRef?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  /** Datos que deben figurar en el comprobante impreso. */
  @Column({ name: 'activity_start_date', type: 'date', nullable: true })
  activityStartDate?: string | null;

  @Column({ name: 'commercial_address', type: 'varchar', length: 255, nullable: true })
  commercialAddress?: string | null;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.fiscalProfiles, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
