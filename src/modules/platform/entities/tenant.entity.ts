import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FiscalProfileEntity } from './fiscal-profile.entity';
import { TenantMembershipEntity } from './tenant-membership.entity';

export enum TenantStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

@Entity('tenants')
@Index('UQ_tenants_slug', ['slug'], { unique: true })
@Index('UQ_tenants_tax_id', ['taxId'], { unique: true })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName!: string;

  @Column({ name: 'trade_name', type: 'varchar', length: 200, nullable: true })
  tradeName?: string | null;

  // CUIT is stored without punctuation. Null is allowed until fiscal onboarding.
  @Column({ name: 'tax_id', type: 'varchar', length: 11, nullable: true })
  taxId?: string | null;

  @Column({
    type: 'enum',
    enum: TenantStatus,
    default: TenantStatus.TRIAL,
  })
  status!: TenantStatus;

  @Column({
    name: 'time_zone',
    type: 'varchar',
    length: 64,
    default: 'America/Argentina/Buenos_Aires',
  })
  timeZone!: string;

  @Column({ name: 'currency_code', type: 'char', length: 3, default: 'ARS' })
  currencyCode!: string;

  @OneToMany(() => TenantMembershipEntity, (membership) => membership.tenant)
  memberships!: TenantMembershipEntity[];

  @OneToMany(() => FiscalProfileEntity, (profile) => profile.tenant)
  fiscalProfiles!: FiscalProfileEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
