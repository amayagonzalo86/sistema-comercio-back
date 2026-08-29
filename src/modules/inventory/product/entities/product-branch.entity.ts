import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { BranchEntity } from '../../../branches/entities/branch.entity';
import { ProductEntity } from './product.entity';

const columnNumericTransformer = {
    to: (data: number): number => data,
    from: (data: string): number => parseFloat(data),
};

@Entity('product_branches')
@Index(['tenantId', 'productId', 'branchId'], { unique: true })
@Index(['tenantId', 'branchId'])
export class ProductBranchEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
    tenantId!: string;

    @Column({ name: 'product_id', type: 'varchar', length: 36 })
    productId!: string;

    @Column({ name: 'branch_id', type: 'varchar', length: 36 })
    branchId!: string;

    @ManyToOne(() => ProductEntity, (product: ProductEntity) => product.branchSettings, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'product_id' })
    product!: ProductEntity;

    @ManyToOne(() => BranchEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch!: BranchEntity;

    @Column({
        name: 'cost_price',
        type: 'decimal',
        precision: 12,
        scale: 2,
        default: 0.0,
        transformer: columnNumericTransformer,
    })
    costPrice!: number;

    @Column({
        name: 'profit_margin',
        type: 'decimal',
        precision: 5,
        scale: 2,
        default: 30.0,
        transformer: columnNumericTransformer,
    })
    profitMargin!: number;

    @Column({
        name: 'selling_price',
        type: 'decimal',
        precision: 12,
        scale: 2,
        default: 0.0,
        transformer: columnNumericTransformer,
    })
    sellingPrice!: number;

    @Column({
        type: 'decimal',
        precision: 12,
        scale: 3,
        default: 0.0,
        transformer: columnNumericTransformer,
    })
    stock!: number;

    @Column({
        name: 'min_stock',
        type: 'decimal',
        precision: 12,
        scale: 3,
        default: 0.0,
        transformer: columnNumericTransformer,
    })
    minStock!: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive!: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}