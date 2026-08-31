import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { SessionEntity } from '../../auth/entities/session.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { PersonEntity } from '../../persons/entities/person.entity';
import { RoleEntity, UserRoleEnum } from '../../roles/entities/role.entity';

// export enum UserRole {
//   SUPER_ADMIN = 'SUPER_ADMIN',
//   ADMIN = 'ADMIN',
//   MANAGER = 'MANAGER',
//   SELLER = 'SELLER',
//   CASHIER = 'CASHIER',
//   STOCK_CLERK = 'STOCK_CLERK',
//   USER = 'USER',
// }

@Entity('users')
export class UserEntity extends BaseAuditEntity {
  @Index('idx_users_username', { unique: true })
  @Column({ type: 'varchar', length: 150, nullable: false })
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, select: false, name: 'password_hash' })
  passwordHash!: string;

  // --- Relación Muchos-a-Muchos con Roles ---
  @ManyToMany(() => RoleEntity, { eager: true })
  @JoinTable({
    name: 'users_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles!: RoleEntity[];

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


  // --- Getters de Compatibilidad ---
  get fullName(): string {
    return this.person ? this.person.fullName : this.username;
  }

  get firstName(): string {
    return this.person?.firstName ?? '';
  }

  get lastName(): string {
    return this.person?.lastName ?? '';
  }
}