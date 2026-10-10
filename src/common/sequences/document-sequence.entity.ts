import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';

/** Contadores correlativos por empresa (remitos internos, pedidos de compra, devoluciones). */
@Entity('document_sequences')
export class DocumentSequenceEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_document_sequences_tenant' })
  tenant?: TenantEntity;

  @PrimaryColumn({ type: 'varchar', length: 40 })
  name!: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  value!: number;
}
