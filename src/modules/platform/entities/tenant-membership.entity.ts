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
import { UserEntity } from '../../users/entities/user.entity';
import { TenantEntity } from './tenant.entity';

export enum TenantRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',
  CASHIER = 'CASHIER',
  INVENTORY = 'INVENTORY',
  VIEWER = 'VIEWER',
}

export enum MembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

@Entity('tenant_memberships')
@Index('UQ_tenant_membership_tenant_user', ['tenantId', 'userId'], { unique: true })
@Index('IDX_tenant_membership_user_status', ['userId', 'status'])
export class TenantMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'enum', enum: TenantRole })
  role!: TenantRole;

  @Column({ type: 'enum', enum: MembershipStatus, default: MembershipStatus.INVITED })
  status!: MembershipStatus;

  @Column({ name: 'accepted_at', type: 'timestamp', precision: 6, nullable: true })
  acceptedAt?: Date | null;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.memberships, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
