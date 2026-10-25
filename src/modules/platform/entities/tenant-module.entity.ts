import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { TenantModule } from '../../../common/modules/tenant-modules';

/**
 * Módulo contratado por una empresa. Solo lo activa o desactiva un operador de la plataforma (SUPER_ADMIN).
 * Desactivar un módulo no borra datos: se ocultan y vuelven al reactivarlo.
 */
@Entity('tenant_modules')
@Index('UQ_tenant_modules_tenant_module', ['tenantId', 'module'], { unique: true })
export class TenantModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 40 })
  module!: TenantModule;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Vence al terminar este día (fecha local de la empresa). null = sin vencimiento. */
  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes?: string | null;

  @Column({ name: 'updated_by_user_id', type: 'varchar', length: 36, nullable: true })
  updatedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
