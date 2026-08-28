import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseAuditEntity } from '../../../../entities/base-audit.entity';

@Entity('products')
// Evita duplicar SKU dentro de la misma empresa cliente
@Unique(['tenantId', 'sku'])
// Índice compuesto para acelerar búsquedas en MySQL filtrando por inquilino y estado
@Index(['tenantId', 'status'])
export class ProductEntity extends BaseAuditEntity {
  @Column({ type: 'varchar', length: 60, nullable: false })
  sku!: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  priceArs!: number;

  @Column({ type: 'boolean', default: true })
  status!: boolean;
}