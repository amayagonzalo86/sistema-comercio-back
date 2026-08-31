import {
  Column,
  Entity,
  Index,
  OneToOne,
} from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('persons')
export class PersonEntity extends BaseAuditEntity {
  @Column({ type: 'varchar', length: 100, nullable: false, name: 'first_name' })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: false, name: 'last_name' })
  lastName!: string;

  @Index('idx_persons_national_id', { unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'national_id' })
  nationalId?: string | null;

  @Index('idx_persons_email', { unique: true })
  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @OneToOne(() => UserEntity, (user) => user.person)
  user?: UserEntity | null;

  @Column({ type: 'boolean', nullable: false, default: true})
  isActive!: boolean;

  constructor(partial?: Partial<PersonEntity>) {
    super(partial);
    if (partial) {
      Object.assign(this, partial);
    }
  }

  // Getter de dominio para nombre completo
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}