import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../../../platform/entities/tenant.entity';
import { ProductPriceListEntity } from './product-price-list.entity';

/** Cuándo se puede usar la lista al cobrar. */
export enum PriceListPaymentCondition {
  /** Cualquier medio de pago. */
  ANY = 'ANY',
  /** Solo si todo se cobra en efectivo (por ejemplo, descuento por pago contado). */
  CASH_ONLY = 'CASH_ONLY',
}

/**
 * Lista de precios: descuento (porcentaje negativo) o recargo (positivo) sobre el precio de la sucursal.
 * Ej.: "Ventas en efectivo" −5 % solo efectivo, "Precio de lista" 0 %, "Lista gobierno" +300 %.
 * Se da de baja de forma lógica: las ventas guardan el nombre y el porcentaje aplicados.
 */
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
  description?: string | null;

  /** Porcentaje sobre el precio de la sucursal: −5 = 5 % de descuento, 300 = 300 % de recargo. */
  @Column({ type: 'decimal', precision: 7, scale: 2, default: 0.0 })
  percentage!: string;

  @Column({ name: 'payment_condition', type: 'enum', enum: PriceListPaymentCondition, default: PriceListPaymentCondition.ANY })
  paymentCondition!: PriceListPaymentCondition;

  /** Lista que se usa cuando la venta no indica otra. */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @OneToMany(() => ProductPriceListEntity, (ppl) => ppl.priceList, { cascade: true })
  productOverrides!: ProductPriceListEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}
