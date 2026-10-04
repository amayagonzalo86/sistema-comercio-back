import { CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProductPriceListEntity } from './product-price-list.entity';
import { Index, JoinColumn, ManyToOne, Column } from 'typeorm';
import { TenantEntity } from '../../../platform/entities/tenant.entity';

@Entity('price_lists')
@Index('IDX_price_lists_tenant_active', ['tenantId', 'isActive'])
@Index('UQ_price_lists_tenant_id', ['tenantId', 'id'], { unique: true })
export class PriceListEntity {
  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.00,
  })
  percentage!: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ProductPriceListEntity, (ppl) => ppl.priceList, { cascade: true })
  productOverrides!: ProductPriceListEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}