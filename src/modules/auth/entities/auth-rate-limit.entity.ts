import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('auth_rate_limits')
@Index('IDX_auth_rate_limit_window', ['windowStartedAt'])
export class AuthRateLimitEntity {
  @PrimaryColumn({ name: 'scope_hash', type: 'char', length: 64 })
  scopeHash!: string;

  @Column({ name: 'attempt_count', type: 'int', unsigned: true, default: 0 })
  attemptCount!: number;

  @Column({ name: 'window_started_at', type: 'timestamp', precision: 6 })
  windowStartedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
