import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Contadores correlativos por empresa (remitos internos, pedidos de compra, devoluciones). */
@Entity('document_sequences')
export class DocumentSequenceEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar', length: 40 })
  name!: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  value!: number;
}
