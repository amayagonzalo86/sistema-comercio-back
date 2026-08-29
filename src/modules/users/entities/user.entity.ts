import {
  Entity,
  Column,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { SessionEntity } from '../../auth/entities/session.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  STOCK_CLERK = 'STOCK_CLERK',
  USER = 'USER',
}

@Entity('users')
@Index(['tenantId', 'email'], { unique: true })
export class UserEntity extends BaseAuditEntity {
  @Column({ type: 'varchar', length: 150, nullable: false })
  email!: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: false,
    select: false,
    name: 'password_hash',
  })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100, nullable: false, name: 'first_name' })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: false, name: 'last_name' })
  lastName!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  status!: boolean;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'current_hashed_refresh_token',
    nullable: true,
    select: false,
  })
  currentHashedRefreshToken?: string;

  @Column({ type: 'uuid', nullable: true, name: 'branch_id' })
  branchId?: string;

  @ManyToOne(() => BranchEntity, (branch) => branch.users, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'branch_id' })
  branch?: BranchEntity;

  @OneToMany(() => SessionEntity, (session) => session.user)
  sessions!: SessionEntity[];

  constructor(partial?: Partial<UserEntity>) {
    super(partial);
    if (partial) {
      Object.assign(this, partial);
    }
  }

  // Getter de dominio para obtener el nombre completo
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  // Getter de dominio para verificar si el usuario posee privilegios administrativos
  get isAdmin(): boolean {
    return this.role === UserRole.SUPER_ADMIN || this.role === UserRole.ADMIN;
  }
}