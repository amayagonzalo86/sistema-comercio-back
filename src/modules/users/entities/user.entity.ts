import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { SessionEntity } from '../../auth/entities/session.entity';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  STOCK_CLERK = 'STOCK_CLERK',
}

@Entity('users')
@Index(['tenantId', 'email'], { unique: true })
export class UserEntity extends BaseAuditEntity {
  @Column({ type: 'varchar', length: 150, nullable: false })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, select: false })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  lastName!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CASHIER,
  })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  status!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false, name: 'current_hashed_refresh_token' })
  currentHashedRefreshToken?: string;

  @OneToMany(() => SessionEntity, (session) => session.user)
  sessions!: SessionEntity[];
}