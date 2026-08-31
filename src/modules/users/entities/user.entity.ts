import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { SessionEntity } from '../../auth/entities/session.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { PersonEntity } from '../../persons/entities/person.entity';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  SELLER = 'SELLER',
  CASHIER = 'CASHIER',
  STOCK_CLERK = 'STOCK_CLERK',
  USER = 'USER',
}

@Entity('users')
export class UserEntity extends BaseAuditEntity {
  @Index('idx_users_username', { unique: true })
  @Column({ type: 'varchar', length: 150, nullable: false })
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, select: false, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 500, name: 'current_hashed_refresh_token', nullable: true, select: false })
  currentHashedRefreshToken?: string | null;

  // --- Relación 1-a-1 con Person (Datos Personales) ---
  @Column({ type: 'uuid', nullable: false, name: 'person_id' })
  personId!: string;

  @OneToOne(() => PersonEntity, (person) => person.user, { cascade: ['insert', 'update'], onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'person_id' })
  person!: PersonEntity;

  // --- Relación N-a-1 con Branch (Sucursal asignada) ---
  @Column({ type: 'uuid', nullable: true, name: 'branch_id' })
  branchId?: string | null;

  @ManyToOne(() => BranchEntity, (branch) => branch.users, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: BranchEntity | null;

  // --- Relación 1-a-N con Session (Control de Refresco de Tokens) ---
  @OneToMany(() => SessionEntity, (session) => session.user)
  sessions!: SessionEntity[];

  constructor(partial?: Partial<UserEntity>) {
    super(partial);
    if (partial) {
      Object.assign(this, partial);
    }
  }

  // Getter de dominio delegado a PersonEntity para evitar romper referencias existentes
  get fullName(): string {
    return this.person ? this.person.fullName : this.username;
  }

  // Helper de compatibilidad para evitar breaking changes si la App consumía firstName/lastName
  get firstName(): string {
    return this.person?.firstName ?? '';
  }

  get lastName(): string {
    return this.person?.lastName ?? '';
  }

  // Getter de dominio para permisos de administración
  get isAdmin(): boolean {
    return this.role === UserRole.SUPER_ADMIN || this.role === UserRole.ADMIN;
  }
}