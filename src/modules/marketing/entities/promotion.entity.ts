import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PromotionType } from '../domain/promotions';

/** Promoción automática aplicada en las ventas (no acumulable: gana la mejor para cada línea). */
@Entity('promotions')
@Index('IDX_promotions_tenant_active', ['tenantId', 'isActive', 'startsAt', 'endsAt'])
export class PromotionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'enum', enum: PromotionType })
  type!: PromotionType;

  /** Solo PERCENTAGE: puntos básicos (15 % = 1500). */
  @Column({ name: 'percent_basis_points', type: 'int', unsigned: true, nullable: true })
  percentBasisPoints?: number | null;

  @Column({ name: 'buy_quantity', type: 'int', unsigned: true, nullable: true })
  buyQuantity?: number | null;

  @Column({ name: 'pay_quantity', type: 'int', unsigned: true, nullable: true })
  payQuantity?: number | null;

  @Column({ name: 'product_ids', type: 'json', nullable: true })
  productIds?: string[] | null;

  @Column({ type: 'json', nullable: true })
  categories?: string[] | null;

  @Column({ type: 'json', nullable: true })
  brands?: string[] | null;

  @Column({ name: 'branch_ids', type: 'json', nullable: true })
  branchIds?: string[] | null;

  /** 0 = domingo ... 6 = sábado. */
  @Column({ type: 'json', nullable: true })
  weekdays?: number[] | null;

  @Column({ name: 'min_quantity', type: 'decimal', precision: 12, scale: 3, nullable: true })
  minQuantity?: string | null;

  /** Vigencia en fechas locales (inclusive). Null = sin límite. */
  @Column({ name: 'starts_at', type: 'date', nullable: true })
  startsAt?: string | null;

  @Column({ name: 'ends_at', type: 'date', nullable: true })
  endsAt?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36 })
  createdByUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
