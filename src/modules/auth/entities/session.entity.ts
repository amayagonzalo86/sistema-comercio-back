import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('user_sessions')
export class SessionEntity extends BaseAuditEntity {
  // Uso de 'declare' para notificar al compilador que la propiedad viene de BaseAuditEntity
  @Index()
  @Column({ type: 'varchar', length: 36, nullable: false, name: 'tenant_id' })
  declare tenantId: string;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: false, name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity, (user) => user.sessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: false,
    name: 'refresh_token_hash',
  })
  refreshTokenHash!: string;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'user_agent' })
  userAgent?: string;

  @Column({ type: 'boolean', default: true, name: 'is_valid' })
  isValid!: boolean;

  @Column({ type: 'datetime', nullable: false, name: 'expires_at' })
  expiresAt!: Date;

  constructor(partial?: Partial<SessionEntity>) {
    super(partial);
    if (partial && typeof partial === 'object' && !Array.isArray(partial)) {
      Object.assign(this, partial);
    }
  }
}