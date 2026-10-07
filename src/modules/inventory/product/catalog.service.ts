import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Brackets, DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { likePattern, Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { cents, formatMoney, milli } from '../../../common/utils/money';
import { BranchEntity } from '../../branches/entities/branch.entity';
import {
  adjustPrices,
  marginBasisPoints,
  MAX_PRICE_CENTS,
  priceFromMargin,
  PriceRounding,
  PriceSnapshot,
} from './domain/pricing';
import {
  BulkPriceUpdateDto,
  EditProductDto,
  PriceHistoryQueryDto,
  ProductListQueryDto,
  ProductSort,
  ProductStatusFilter,
  UpdateProductStatusDto,
  UpsertBranchPriceDto,
} from './dto/catalog.dto';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductPriceHistoryEntity } from './entities/product-price-history.entity';
import { ProductEntity } from './entities/product.entity';

export const MAX_BULK_PRICE_ROWS = 5000;

export interface BranchPriceView {
  branchId: string;
  stock: number;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  profitMargin: number;
  isActive: boolean;
  belowMinimum: boolean;
}

export interface ProductListItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  brand: string | null;
  unitOfMeasure: string;
  taxRate: number;
  vatTreatment: string;
  priceIncludesVat: boolean;
  status: boolean;
  /** Presente cuando se filtra por sucursal. */
  branch?: BranchPriceView;
  /** Presente sin filtro de sucursal: stock sumado de todas las sucursales activas. */
  totalStock?: number;
}

export interface BulkPriceRowPreview {
  productId: string;
  sku: string;
  name: string;
  branchId: string;
  oldCostPrice: string;
  newCostPrice: string;
  oldSellingPrice: string;
  newSellingPrice: string;
  newProfitMargin: string;
}

export interface BulkPriceResult {
  dryRun: boolean;
  batchId: string | null;
  affectedRows: number;
  unchangedRows: number;
  preview: BulkPriceRowPreview[];
}

/** Gestión del catálogo: búsqueda, edición, precios por sucursal y ajustes masivos con historial. */
@Injectable()
export class CatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    tenantId: string,
    query: ProductListQueryDto,
    branchScope: string | null,
  ): Promise<Paginated<ProductListItem>> {
    const branchId = branchScope ?? query.branchId ?? null;
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const skip = (query.page - 1) * query.limit;

    if (branchId) {
      const qb = this.dataSource
        .getRepository(ProductBranchEntity)
        .createQueryBuilder('pb')
        .innerJoinAndSelect('pb.product', 'p')
        .where('pb.tenantId = :tenantId', { tenantId })
        .andWhere('pb.branchId = :branchId', { branchId })
        .andWhere('p.deletedAt IS NULL');
      this.applyProductFilters(qb, query);
      if (query.status === ProductStatusFilter.ACTIVE) qb.andWhere('pb.isActive = true');
      if (query.lowStock) qb.andWhere('pb.stock <= pb.minStock');
      this.applySort(qb, query.sort, true);
      const [rows, total] = await qb.skip(skip).take(query.limit).getManyAndCount();
      return paginated(
        rows.map((row) => ({ ...this.toListItem(row.product), branch: this.toBranchView(row) })),
        total,
        query.page,
        query.limit,
      );
    }

    const qb = this.dataSource
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .where('p.tenantId = :tenantId', { tenantId });
    this.applyProductFilters(qb, query);
    if (query.lowStock) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM product_branches lb WHERE lb.tenant_id = p.tenant_id AND lb.product_id = p.id AND lb.is_active = 1 AND lb.stock <= lb.min_stock)',
      );
    }
    this.applySort(qb, query.sort === ProductSort.STOCK ? ProductSort.NAME : query.sort, false);
    const [products, total] = await qb.skip(skip).take(query.limit).getManyAndCount();

    const stockByProduct = new Map<string, number>();
    if (products.length > 0) {
      const sums = await this.dataSource
        .getRepository(ProductBranchEntity)
        .createQueryBuilder('pb')
        .select('pb.productId', 'productId')
        .addSelect('COALESCE(SUM(pb.stock), 0)', 'stock')
        .where('pb.tenantId = :tenantId', { tenantId })
        .andWhere('pb.productId IN (:...ids)', { ids: products.map((product) => product.id) })
        .andWhere('pb.isActive = true')
        .groupBy('pb.productId')
        .getRawMany<{ productId: string; stock: string }>();
      for (const row of sums) stockByProduct.set(row.productId, Number(row.stock));
    }

    return paginated(
      products.map((product) => ({ ...this.toListItem(product), totalStock: stockByProduct.get(product.id) ?? 0 })),
      total,
      query.page,
      query.limit,
    );
  }

  /** Categorías y marcas existentes, para los filtros del frontend. */
  async facets(tenantId: string): Promise<{ categories: Array<{ name: string; count: number }>; brands: Array<{ name: string; count: number }> }> {
    const load = async (column: 'category' | 'brand') =>
      (
        await this.dataSource
          .getRepository(ProductEntity)
          .createQueryBuilder('p')
          .select(`p.${column}`, 'name')
          .addSelect('COUNT(*)', 'count')
          .where('p.tenantId = :tenantId', { tenantId })
          .andWhere(`p.${column} IS NOT NULL AND p.${column} <> ''`)
          .andWhere('p.status = true')
          .groupBy(`p.${column}`)
          .orderBy('name', 'ASC')
          .limit(500)
          .getRawMany<{ name: string; count: string }>()
      ).map((row) => ({ name: row.name, count: Number(row.count) }));
    const [categories, brands] = await Promise.all([load('category'), load('brand')]);
    return { categories, brands };
  }

  async edit(
    tenantId: string,
    actorUserId: string,
    productId: string,
    dto: EditProductDto,
    context: RequestAuditContext,
  ): Promise<ProductEntity> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.lockProduct(manager, tenantId, productId);
      const changes: Record<string, { before: unknown; after: unknown }> = {};

      const assign = <K extends keyof EditProductDto & keyof ProductEntity>(key: K, value: ProductEntity[K]) => {
        if (product[key] !== value) {
          changes[key] = { before: product[key], after: value };
          product[key] = value;
        }
      };

      if (dto.sku !== undefined) {
        const sku = dto.sku.toUpperCase();
        if (sku !== product.sku) {
          const duplicated = await manager.findOne(ProductEntity, { where: { tenantId, sku }, select: { id: true } });
          if (duplicated) throw new ConflictException(`El SKU '${sku}' ya está registrado.`);
        }
        assign('sku', sku);
      }
      if (dto.barcode !== undefined) {
        const barcode = dto.barcode ? dto.barcode : null;
        if (barcode && barcode !== product.barcode) {
          const duplicated = await manager.findOne(ProductEntity, { where: { tenantId, barcode }, select: { id: true } });
          if (duplicated) throw new ConflictException(`El código de barras '${barcode}' ya está asignado.`);
        }
        assign('barcode', barcode);
      }
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.description !== undefined) assign('description', dto.description || null);
      if (dto.category !== undefined) assign('category', dto.category || null);
      if (dto.brand !== undefined) assign('brand', dto.brand || null);
      if (dto.unitOfMeasure !== undefined) assign('unitOfMeasure', dto.unitOfMeasure);

      if (Object.keys(changes).length > 0) {
        await manager.save(ProductEntity, product);
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'PRODUCT_UPDATED',
          aggregateType: 'PRODUCT',
          aggregateId: productId,
          metadata: { changes },
          context,
        });
      }
      return product;
    });
  }

  async setStatus(
    tenantId: string,
    actorUserId: string,
    productId: string,
    dto: UpdateProductStatusDto,
    context: RequestAuditContext,
  ): Promise<ProductEntity> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.lockProduct(manager, tenantId, productId);
      if (product.status !== dto.status) {
        product.status = dto.status;
        await manager.save(ProductEntity, product);
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: dto.status ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED',
          aggregateType: 'PRODUCT',
          aggregateId: productId,
          metadata: { reason: dto.reason.trim() },
          context,
        });
      }
      return product;
    });
  }

  /** Crea o actualiza el precio/costo/mínimo de un producto en una sucursal, con historial de precios. */
  async upsertBranchPrice(
    tenantId: string,
    actorUserId: string,
    productId: string,
    branchId: string,
    dto: UpsertBranchPriceDto,
    context: RequestAuditContext,
  ): Promise<BranchPriceView> {
    return this.dataSource.transaction(async (manager) => {
      let row = await manager
        .createQueryBuilder(ProductBranchEntity, 'pb')
        .setLock('pessimistic_write')
        .where('pb.tenantId = :tenantId', { tenantId })
        .andWhere('pb.productId = :productId', { productId })
        .andWhere('pb.branchId = :branchId', { branchId })
        .getOne();

      let created = false;
      if (!row) {
        await this.lockProduct(manager, tenantId, productId);
        const branch = await manager.findOne(BranchEntity, { where: { id: branchId, tenantId }, select: { id: true } });
        if (!branch) throw new NotFoundException('La sucursal no pertenece a esta empresa.');
        row = manager.create(ProductBranchEntity, {
          tenantId,
          productId,
          branchId,
          costPrice: 0,
          profitMargin: 0,
          sellingPrice: 0,
          stock: 0,
          minStock: 0,
          isActive: true,
        });
        created = true;
      }

      const before: PriceSnapshot = {
        costCents: cents(row.costPrice),
        sellingCents: cents(row.sellingPrice),
        marginBp: cents(row.profitMargin),
      };
      const costCents = dto.costPrice !== undefined ? cents(dto.costPrice) : before.costCents;
      let sellingCents: bigint;
      let marginBp: bigint;
      if (dto.sellingPrice !== undefined) {
        sellingCents = cents(dto.sellingPrice);
        marginBp = marginBasisPoints(costCents, sellingCents) ?? (dto.profitMargin !== undefined ? cents(dto.profitMargin) : before.marginBp);
      } else if (dto.profitMargin !== undefined) {
        marginBp = cents(dto.profitMargin);
        sellingCents = costCents > 0n ? priceFromMargin(costCents, marginBp, PriceRounding.NONE) : before.sellingCents;
      } else {
        sellingCents = before.sellingCents;
        marginBp = marginBasisPoints(costCents, sellingCents) ?? before.marginBp;
      }
      if (sellingCents > MAX_PRICE_CENTS) throw new BadRequestException('El precio resultante excede el máximo admitido.');

      row.costPrice = Number(formatMoney(costCents));
      row.sellingPrice = Number(formatMoney(sellingCents));
      row.profitMargin = Number(formatMoney(marginBp));
      if (dto.minStock !== undefined) row.minStock = Number(dto.minStock);
      if (dto.isActive !== undefined) row.isActive = dto.isActive;
      const saved = await manager.save(ProductBranchEntity, row);

      const priceChanged = created || costCents !== before.costCents || sellingCents !== before.sellingCents;
      if (priceChanged) {
        await manager.save(
          ProductPriceHistoryEntity,
          manager.create(ProductPriceHistoryEntity, {
            tenantId,
            productId,
            branchId,
            oldCostPrice: formatMoney(before.costCents),
            newCostPrice: formatMoney(costCents),
            oldSellingPrice: formatMoney(before.sellingCents),
            newSellingPrice: formatMoney(sellingCents),
            reason: dto.reason?.trim() || (created ? 'Alta en sucursal' : 'Actualización manual'),
            batchId: null,
            actorUserId,
          }),
        );
      }
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: created ? 'PRODUCT_BRANCH_CREATED' : 'PRODUCT_BRANCH_UPDATED',
        aggregateType: 'PRODUCT',
        aggregateId: productId,
        metadata: {
          branchId,
          before: { cost: formatMoney(before.costCents), selling: formatMoney(before.sellingCents) },
          after: { cost: formatMoney(costCents), selling: formatMoney(sellingCents), minStock: saved.minStock, isActive: saved.isActive },
          reason: dto.reason?.trim() ?? null,
        },
        context,
      });
      return this.toBranchView(saved);
    });
  }

  /** Ajuste masivo de precios por porcentaje, con vista previa (dryRun) y registro en el historial. */
  async bulkPriceUpdate(
    tenantId: string,
    actorUserId: string,
    dto: BulkPriceUpdateDto,
    branchScope: string | null,
    context: RequestAuditContext,
  ): Promise<BulkPriceResult> {
    const scope = dto.scope ?? {};
    let branchIds = scope.branchIds ?? [];
    if (branchScope) {
      if (branchIds.some((id) => id !== branchScope)) {
        throw new ForbiddenException('Solo puede ajustar precios de su sucursal.');
      }
      branchIds = [branchScope];
    }
    const percentBp = cents(dto.percentage, true);
    if (percentBp === 0n) throw new BadRequestException('El porcentaje no puede ser cero.');

    const buildQuery = (manager: EntityManager): SelectQueryBuilder<ProductBranchEntity> => {
      const qb = manager
        .createQueryBuilder(ProductBranchEntity, 'pb')
        .innerJoinAndSelect('pb.product', 'p')
        .where('pb.tenantId = :tenantId', { tenantId })
        .andWhere('pb.isActive = true')
        .andWhere('p.status = true')
        .andWhere('p.deletedAt IS NULL');
      if (branchIds.length) qb.andWhere('pb.branchId IN (:...branchIds)', { branchIds });
      if (scope.categories?.length) qb.andWhere('p.category IN (:...categories)', { categories: scope.categories });
      if (scope.brands?.length) qb.andWhere('p.brand IN (:...brands)', { brands: scope.brands });
      if (scope.productIds?.length) qb.andWhere('p.id IN (:...productIds)', { productIds: scope.productIds });
      return qb.orderBy('p.name', 'ASC').addOrderBy('pb.branchId', 'ASC');
    };

    const compute = (rows: ProductBranchEntity[]) => {
      const changes: Array<{ row: ProductBranchEntity; before: PriceSnapshot; after: PriceSnapshot }> = [];
      let unchanged = 0;
      for (const row of rows) {
        const before: PriceSnapshot = {
          costCents: cents(row.costPrice),
          sellingCents: cents(row.sellingPrice),
          marginBp: cents(row.profitMargin),
        };
        let after: PriceSnapshot;
        try {
          after = adjustPrices(before, dto.target, percentBp, dto.rounding);
        } catch (error) {
          throw new BadRequestException(
            `No se puede ajustar ${row.product.sku}: ${error instanceof Error ? error.message : 'valor inválido'}`,
          );
        }
        if (after.costCents === before.costCents && after.sellingCents === before.sellingCents) {
          unchanged += 1;
        } else {
          changes.push({ row, before, after });
        }
      }
      return { changes, unchanged };
    };

    const toPreview = (change: { row: ProductBranchEntity; before: PriceSnapshot; after: PriceSnapshot }): BulkPriceRowPreview => ({
      productId: change.row.productId,
      sku: change.row.product.sku,
      name: change.row.product.name,
      branchId: change.row.branchId,
      oldCostPrice: formatMoney(change.before.costCents),
      newCostPrice: formatMoney(change.after.costCents),
      oldSellingPrice: formatMoney(change.before.sellingCents),
      newSellingPrice: formatMoney(change.after.sellingCents),
      newProfitMargin: formatMoney(change.after.marginBp),
    });

    if (dto.dryRun) {
      const qb = buildQuery(this.dataSource.manager);
      const total = await qb.getCount();
      this.assertBulkSize(total);
      const { changes, unchanged } = compute(await qb.getMany());
      return { dryRun: true, batchId: null, affectedRows: changes.length, unchangedRows: unchanged, preview: changes.slice(0, 200).map(toPreview) };
    }

    return this.dataSource.transaction(async (manager) => {
      const qb = buildQuery(manager).setLock('pessimistic_write', undefined, ['pb']);
      const rows = await qb.getMany();
      this.assertBulkSize(rows.length);
      const { changes, unchanged } = compute(rows);
      const batchId = randomUUID();
      const reason = dto.reason.trim();

      for (const change of changes) {
        change.row.costPrice = Number(formatMoney(change.after.costCents));
        change.row.sellingPrice = Number(formatMoney(change.after.sellingCents));
        change.row.profitMargin = Number(formatMoney(change.after.marginBp));
      }
      await manager.save(ProductBranchEntity, changes.map((change) => change.row), { chunk: 500 });
      await manager.save(
        ProductPriceHistoryEntity,
        changes.map((change) =>
          manager.create(ProductPriceHistoryEntity, {
            tenantId,
            productId: change.row.productId,
            branchId: change.row.branchId,
            oldCostPrice: formatMoney(change.before.costCents),
            newCostPrice: formatMoney(change.after.costCents),
            oldSellingPrice: formatMoney(change.before.sellingCents),
            newSellingPrice: formatMoney(change.after.sellingCents),
            reason,
            batchId,
            actorUserId,
          }),
        ),
        { chunk: 500 },
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PRODUCT_PRICES_BULK_UPDATED',
        aggregateType: 'PRICE_BATCH',
        aggregateId: batchId,
        metadata: {
          percentage: dto.percentage,
          target: dto.target,
          rounding: dto.rounding,
          scope: { ...scope, branchIds },
          affectedRows: changes.length,
          reason,
        },
        context,
      });
      return { dryRun: false, batchId, affectedRows: changes.length, unchangedRows: unchanged, preview: changes.slice(0, 200).map(toPreview) };
    });
  }

  async priceHistory(
    tenantId: string,
    productId: string,
    query: PriceHistoryQueryDto,
    branchScope: string | null,
  ): Promise<Paginated<ProductPriceHistoryEntity>> {
    const branchId = branchScope ?? query.branchId ?? null;
    const [items, total] = await this.dataSource.getRepository(ProductPriceHistoryEntity).findAndCount({
      where: { tenantId, productId, ...(branchId ? { branchId } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginated(items, total, query.page, query.limit);
  }

  private assertBulkSize(total: number): void {
    if (total === 0) throw new BadRequestException('Ningún producto coincide con el filtro indicado.');
    if (total > MAX_BULK_PRICE_ROWS) {
      throw new BadRequestException(
        `El ajuste alcanza ${total} filas (máximo ${MAX_BULK_PRICE_ROWS}). Acotá por categoría, marca o sucursal.`,
      );
    }
  }

  private async lockProduct(manager: EntityManager, tenantId: string, productId: string): Promise<ProductEntity> {
    const product = await manager
      .createQueryBuilder(ProductEntity, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :productId', { productId })
      .andWhere('p.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!product) throw new NotFoundException('Producto no encontrado en esta empresa.');
    return product;
  }

  private applyProductFilters<T extends object>(qb: SelectQueryBuilder<T>, query: ProductListQueryDto): void {
    if (query.status === ProductStatusFilter.ACTIVE) qb.andWhere('p.status = true');
    if (query.status === ProductStatusFilter.INACTIVE) qb.andWhere('p.status = false');
    if (query.category) qb.andWhere('p.category = :category', { category: query.category });
    if (query.brand) qb.andWhere('p.brand = :brand', { brand: query.brand });
    if (query.search) {
      const pattern = likePattern(query.search);
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('p.name LIKE :pattern', { pattern })
            .orWhere('p.sku LIKE :pattern', { pattern })
            .orWhere('p.barcode = :exact', { exact: query.search });
        }),
      );
    }
  }

  private applySort<T extends object>(qb: SelectQueryBuilder<T>, sort: ProductSort, withBranch: boolean): void {
    switch (sort) {
      case ProductSort.SKU:
        qb.orderBy('p.sku', 'ASC');
        break;
      case ProductSort.UPDATED:
        qb.orderBy('p.updatedAt', 'DESC');
        break;
      case ProductSort.STOCK:
        qb.orderBy(withBranch ? 'pb.stock' : 'p.name', 'ASC');
        break;
      default:
        qb.orderBy('p.name', 'ASC');
    }
    qb.addOrderBy('p.id', 'ASC');
  }

  private toListItem(product: ProductEntity): ProductListItem {
    return {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode ?? null,
      name: product.name,
      category: product.category ?? null,
      brand: product.brand ?? null,
      unitOfMeasure: product.unitOfMeasure,
      taxRate: Number(product.taxRate),
      vatTreatment: product.vatTreatment,
      priceIncludesVat: product.priceIncludesVat,
      status: product.status,
    };
  }

  private toBranchView(row: ProductBranchEntity): BranchPriceView {
    return {
      branchId: row.branchId,
      stock: Number(row.stock),
      minStock: Number(row.minStock),
      costPrice: Number(row.costPrice),
      sellingPrice: Number(row.sellingPrice),
      profitMargin: Number(row.profitMargin),
      isActive: row.isActive,
      belowMinimum: milli(row.stock, true) <= milli(row.minStock),
    };
  }
}
