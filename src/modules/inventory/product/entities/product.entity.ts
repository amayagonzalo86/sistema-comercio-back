import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductPriceListEntity } from '../../../sales/price-list/entities/product-price-list.entity';
import { ProductBranchEntity } from './product-branch.entity';

export enum UnitOfMeasure {
  UNIT = 'UNIT',
  KG = 'KG',
  LITER = 'LITER',
  METER = 'METER',
  PACK = 'PACK',
}

// Transformador numérico para TypeORM decimal -> number
const columnNumericTransformer = {
  to: (data: number): number => data,
  from: (data: string): number => parseFloat(data),
};

@Entity('products')
@Index(['sku'], { unique: true })
@Index(['barcode'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  sku!: string;

  @Column({ name: 'barcode', type: 'varchar', length: 100, nullable: true })
  barcode?: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  brand?: string | null;

  @Column({ name: 'unit_of_measure', type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  unitOfMeasure!: UnitOfMeasure;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 21.0, transformer: columnNumericTransformer })
  taxRate!: number;

  @Column({ type: 'boolean', default: true })
  status!: boolean;

  @OneToMany(() => ProductBranchEntity, (pb) => pb.product, { cascade: true })
  branchSettings!: ProductBranchEntity[];

  @OneToMany(() => ProductPriceListEntity, (ppl) => ppl.product)
  priceOverrides!: ProductPriceListEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}