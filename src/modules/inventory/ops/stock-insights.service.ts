import { ForbiddenException, Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { likePattern, Paginated, paginated } from '../../../common/dto/page-query.dto';
import { formatQuantity, milli } from '../../../common/utils/money';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { ProductBranchEntity } from '../product/entities/product-branch.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { planReplenishment } from './domain/replenishment';
import { LowStockQueryDto, ReplenishmentQueryDto, StockMatrixQueryDto } from './dto/stock-insights.dto';

export interface StockMatrixRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  totalStock: string;
  branches: Record<string, { stock: string; minStock: string; belowMinimum: boolean }>;
}

export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  branchId: string;
  stock: string;
  minStock: string;
  missing: string;
}

export interface ReplenishmentView {
  targetPercent: number;
  transfers: Array<{ productId: string; sku: string; name: string; fromBranchId: string; toBranchId: string; quantity: string }>;
  purchases: Array<{ productId: string; sku: string; name: string; branchId: string; quantity: string }>;
}

/** Monitoreo de stock entre sucursales para el dueño y los encargados. */
@Injectable()
export class StockInsightsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Matriz producto × sucursal: cuánto hay en cada una y dónde está por debajo del mínimo. */
  async matrix(tenantId: string, query: StockMatrixQueryDto): Promise<Paginated<StockMatrixRow> & { branches: Array<{ id: string; code: string; name: string }> }> {
    const branches = await this.dataSource.getRepository(BranchEntity).find({
      where: { tenantId, status: true },
      select: { id: true, code: true, name: true },
      order: { code: 'ASC' },
    });
    const qb = this.dataSource
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.status = true');
    if (query.category) qb.andWhere('p.category = :category', { category: query.category });
    if (query.search) {
      const pattern = likePattern(query.search);
      qb.andWhere(new Brackets((where) => where.where('p.name LIKE :pattern', { pattern }).orWhere('p.sku LIKE :pattern', { pattern })));
    }
    const [products, total] = await qb
      .orderBy('p.name', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const rows = products.length
      ? await this.dataSource
          .getRepository(ProductBranchEntity)
          .createQueryBuilder('pb')
          .where('pb.tenantId = :tenantId', { tenantId })
          .andWhere('pb.productId IN (:...ids)', { ids: products.map((product) => product.id) })
          .andWhere('pb.isActive = true')
          .getMany()
      : [];

    const items: StockMatrixRow[] = products.map((product) => {
      const perBranch: StockMatrixRow['branches'] = {};
      let totalMilli = 0n;
      for (const row of rows.filter((item) => item.productId === product.id)) {
        const stock = milli(row.stock, true);
        const min = milli(row.minStock);
        totalMilli += stock;
        perBranch[row.branchId] = {
          stock: formatQuantity(stock),
          minStock: formatQuantity(min),
          belowMinimum: min > 0n && stock <= min,
        };
      }
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category ?? null,
        totalStock: formatQuantity(totalMilli),
        branches: perBranch,
      };
    });
    return { ...paginated(items, total, query.page, query.limit), branches };
  }

  /** Productos en o por debajo del stock mínimo, ordenados por mayor faltante. */
  async lowStock(tenantId: string, query: LowStockQueryDto, branchScope: string | null): Promise<Paginated<LowStockRow>> {
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = branchScope ?? query.branchId ?? null;
    const qb = this.dataSource
      .getRepository(ProductBranchEntity)
      .createQueryBuilder('pb')
      .innerJoinAndSelect('pb.product', 'p')
      .where('pb.tenantId = :tenantId', { tenantId })
      .andWhere('pb.isActive = true')
      .andWhere('p.status = true')
      .andWhere('pb.minStock > 0')
      .andWhere('pb.stock <= pb.minStock');
    if (branchId) qb.andWhere('pb.branchId = :branchId', { branchId });
    // Relación muchos-a-uno: offset/limit son seguros (no multiplican filas) y permiten ordenar por expresión.
    const [rows, total] = await qb
      .orderBy('(pb.min_stock - pb.stock)', 'DESC')
      .addOrderBy('p.name', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getManyAndCount();
    return paginated(
      rows.map((row) => {
        const stock = milli(row.stock, true);
        const min = milli(row.minStock);
        return {
          productId: row.productId,
          sku: row.product.sku,
          name: row.product.name,
          branchId: row.branchId,
          stock: formatQuantity(stock),
          minStock: formatQuantity(min),
          missing: formatQuantity(min - stock),
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }

  /** Plan sugerido: qué transferir entre sucursales y qué comprar para volver al objetivo. */
  async replenishment(tenantId: string, query: ReplenishmentQueryDto): Promise<ReplenishmentView> {
    const qb = this.dataSource
      .getRepository(ProductBranchEntity)
      .createQueryBuilder('pb')
      .innerJoinAndSelect('pb.product', 'p')
      .where('pb.tenantId = :tenantId', { tenantId })
      .andWhere('pb.isActive = true')
      .andWhere('p.status = true')
      // Solo productos que tienen al menos una sucursal en falta.
      .andWhere(
        'pb.productId IN (SELECT low.product_id FROM product_branches low WHERE low.tenant_id = :tenantId AND low.is_active = 1 AND low.min_stock > 0 AND low.stock <= low.min_stock)',
      );
    if (query.category) qb.andWhere('p.category = :category', { category: query.category });
    const rows = await qb.limit(20000).getMany();

    const products = new Map(rows.map((row) => [row.productId, row.product]));
    const plan = planReplenishment(
      rows.map((row) => ({
        productId: row.productId,
        branchId: row.branchId,
        stockMilli: milli(row.stock, true),
        minMilli: milli(row.minStock),
      })),
      query.targetPercent,
    );
    const describe = (productId: string) => ({
      sku: products.get(productId)?.sku ?? '',
      name: products.get(productId)?.name ?? '',
    });
    return {
      targetPercent: query.targetPercent,
      transfers: plan.transfers.map((item) => ({
        productId: item.productId,
        ...describe(item.productId),
        fromBranchId: item.fromBranchId,
        toBranchId: item.toBranchId,
        quantity: formatQuantity(item.quantityMilli),
      })),
      purchases: plan.purchases.map((item) => ({
        productId: item.productId,
        ...describe(item.productId),
        branchId: item.branchId,
        quantity: formatQuantity(item.quantityMilli),
      })),
    };
  }
}
