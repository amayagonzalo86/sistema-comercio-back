import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER',
  WAREHOUSE = 'WAREHOUSE',
}

@Entity('users')
@Unique(['tenantId', 'email'])
@Index(['tenantId', 'status'])
export class UserEntity extends BaseAuditEntity {
  @Column({ type: 'varchar', length: 150, nullable: false })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, select: false })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  fullName!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CASHIER,
  })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  status!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  currentHashedRefreshToken?: string;
}