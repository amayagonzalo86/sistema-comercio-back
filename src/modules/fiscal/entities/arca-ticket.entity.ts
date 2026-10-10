import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ArcaEnvironment } from '../../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';

/**
 * Ticket de acceso de WSAA (válido ~12 h). Se persiste cifrado porque WSAA no entrega un ticket nuevo
 * mientras el anterior siga vigente: perderlo dejaría a la empresa sin poder facturar hasta que venza.
 */
@Entity('arca_tickets')
@Index('UQ_arca_tickets_tenant_service_env', ['tenantId', 'service', 'environment'], { unique: true })
export class ArcaTicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_arca_tickets_tenant' })
  tenant?: TenantEntity;

  @Column({ type: 'varchar', length: 20 })
  service!: string;

  @Column({ type: 'enum', enum: ArcaEnvironment })
  environment!: ArcaEnvironment;

  @Column({ name: 'sealed_token', type: 'text' })
  sealedToken!: string;

  @Column({ name: 'sealed_sign', type: 'text' })
  sealedSign!: string;

  @Column({ name: 'expires_at', type: 'timestamp', precision: 6 })
  expiresAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
