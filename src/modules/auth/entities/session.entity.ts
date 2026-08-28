import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('user_sessions')
@Index(['tenantId', 'userId'])
@Index(['refreshTokenHash'])
export class SessionEntity extends BaseAuditEntity {
    @Column({ type: 'varchar', length: 36, nullable: false })
    userId!: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user!: UserEntity;

    @Column({ type: 'varchar', length: 255, nullable: false })
    refreshTokenHash!: string;

    @Column({ type: 'varchar', length: 45, nullable: false, name: 'ip_address' })
    ipAddress!: string;

    @Column({ type: 'text', nullable: true, name: 'user_agent' })
    userAgent!: string;

    @Column({ type: 'boolean', default: true, name: 'is_valid' })
    isValid!: boolean;

    @Column({ type: 'datetime', nullable: false, name: 'expires_at' })
    expiresAt!: Date;
}