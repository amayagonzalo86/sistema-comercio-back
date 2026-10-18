import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Brackets, DataSource, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { PriceListEntity, PriceListPaymentCondition } from '../../sales/price-list/entities/price-list.entity';
import { ProductPriceListEntity } from '../../sales/price-list/entities/product-price-list.entity';
import { applyPriceList, cashMethodsOf, ResolvedPriceList } from '../../sales/price-list/pricing';
import { deleteProductImage, productImageUrl, saveProductImage } from './product-images';
import { recordAudit } from '../../../common/audit/audit';
import { likePattern, Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { cents, formatMoney, milli, roundDivide } from '../../../common/utils/money';
import { parseTaxCondition, TaxConditionEnum } from '../../../common/enums/afip.enum';
import { printableName } from '../../fiscal/printable';
import { resolveVatRegime, VatRegime, VatTreatment } from '../../fiscal/vat/vat';
import { PersonEntity, PersonType } from '../../persons/entities/person.entity';
import { FiscalProfileEntity } from '../../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import {
  addAmount,
  adjustPrices,
  applyFreight,
  changeBasisPoints,
  marginBasisPoints,
  totalCost,
  MAX_PRICE_CENTS,
  priceFromMargin,
  PriceRounding,
  PriceSnapshot,
} from './domain/pricing';
import {
  BulkPriceMode,
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
  /** Costo, flete y margen: null para vendedores y cajeros (no los pueden ver). */
  costPrice: number | null;
  freightPercentage: number | null;
  freightAmount: number | null;
  /** Costo + flete: base del margen. */
  totalCost: number | null;
  sellingPrice: number;
  profitMargin: number | null;
  isActive: boolean;
  belowMinimum: boolean;
  /**
   * Precio en cada lista activa: price es el precio de la sucursal con el ajuste de la lista y finalPrice,
   * lo que paga un consumidor final (con IVA si corresponde; en Tierra del Fuego, sin IVA).
   */
  listPrices: Array<{ priceListId: string; price: string; finalPrice: string }>;
  /** Precio final de la sucursal sin lista. */
  finalPrice: string;
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
  /** URL de la foto del producto (servida por GET /product-images/:archivo). */
  imageUrl: string | null;
  supplier: { id: string; name: string } | null;
  /** Presente cuando se filtra por sucursal. */
  branch?: BranchPriceView;
  /** Presente sin filtro de sucursal: stock sumado de todas las sucursales activas. */
  totalStock?: number;
}

/** Precios de un producto en una sucursal, por lista (sin costos). */
export interface ProductListPricesView {
  branchId: string;
  branchName: string | null;
  isActive: boolean;
  sellingPrice: string;
  /** Precio final al consumidor sin lista (con IVA cuando corresponde sumarlo). */
  finalPrice: string;
  /** true si el precio cargado no incluye IVA y el final se lo suma. */
  vatAdded: boolean;
  lists: Array<{ priceListId: string; name: string; percentage: string; paymentCondition: PriceListPaymentCondition; price: string; finalPrice: string }>;
}

/** Stock de un producto en una sucursal (sin costos: lo consulta el vendedor). */
export interface ProductBranchStockView {
  branchId: string;
  branchName: string;
  /** El producto está cargado en esa sucursal. */
  enabled: boolean;
  /** Se vende en esa sucursal. */
  isActive: boolean;
  stock: number;
  minStock: number;
  belowMinimum: boolean;
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
  oldFreightPercentage: string;
  newFreightPercentage: string;
  /** Variación del precio de venta en % (para los aumentos en pesos). */
  sellingChangePercentage: string | null;
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
    canSeeCosts = true,
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
      const [lists, addsVat, suppliers] = await Promise.all([
        this.loadPriceLists(tenantId, rows.map((row) => row.productId)),
        this.consumerAddsVat(tenantId, branchId),
        this.supplierNames(tenantId, rows.map((row) => row.product)),
      ]);
      return paginated(
        rows.map((row) => ({
          ...this.toListItem(row.product, suppliers),
          branch: { ...this.toBranchView(row, canSeeCosts), ...listPricesFor(row, lists, addsVat) },
        })),
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

    const suppliers = await this.supplierNames(tenantId, products);
    return paginated(
      products.map((product) => ({ ...this.toListItem(product, suppliers), totalStock: stockByProduct.get(product.id) ?? 0 })),
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
      if (dto.supplierPersonId !== undefined) {
        if (dto.supplierPersonId) await assertSupplier(manager, tenantId, dto.supplierPersonId);
        assign('supplierPersonId', dto.supplierPersonId || null);
      }

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

  /** Reemplaza la foto del producto. La anterior se borra recién cuando la nueva quedó guardada. */
  async setImage(tenantId: string, actorUserId: string, productId: string, buffer: Buffer, context: RequestAuditContext): Promise<{ imageUrl: string | null }> {
    const name = await saveProductImage(buffer);
    let previous: string | null = null;
    try {
      previous = await this.dataSource.transaction(async (manager) => {
        const product = await this.lockProduct(manager, tenantId, productId);
        const before = product.imagePath ?? null;
        await manager.update(ProductEntity, { id: productId, tenantId }, { imagePath: name });
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'PRODUCT_IMAGE_UPDATED',
          aggregateType: 'PRODUCT',
          aggregateId: productId,
          metadata: { sku: product.sku, bytes: buffer.length, replaced: Boolean(before) },
          context,
        });
        return before;
      });
    } catch (error) {
      await deleteProductImage(name);
      throw error;
    }
    await deleteProductImage(previous);
    return { imageUrl: productImageUrl(name) };
  }

  async removeImage(tenantId: string, actorUserId: string, productId: string, context: RequestAuditContext): Promise<{ imageUrl: null }> {
    const previous = await this.dataSource.transaction(async (manager) => {
      const product = await this.lockProduct(manager, tenantId, productId);
      if (!product.imagePath) return null;
      await manager.update(ProductEntity, { id: productId, tenantId }, { imagePath: null });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PRODUCT_IMAGE_REMOVED',
        aggregateType: 'PRODUCT',
        aggregateId: productId,
        metadata: { sku: product.sku },
        context,
      });
      return product.imagePath;
    });
    await deleteProductImage(previous);
    return { imageUrl: null };
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
  ): Promise<Omit<BranchPriceView, 'listPrices' | 'finalPrice'>> {
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

      const before: PriceSnapshot = snapshotOf(row);
      const costCents = dto.costPrice !== undefined ? cents(dto.costPrice) : before.costCents;
      const freightBp = dto.freightPercentage !== undefined ? cents(dto.freightPercentage) : before.freightBp ?? 0n;
      const freightCents = dto.freightAmount !== undefined ? cents(dto.freightAmount) : before.freightCents ?? 0n;
      // El margen se calcula sobre el costo total (costo + flete).
      const baseCents = totalCost(costCents, freightBp, freightCents);
      const freightChanged = freightBp !== (before.freightBp ?? 0n) || freightCents !== (before.freightCents ?? 0n);
      let sellingCents: bigint;
      let marginBp: bigint;
      if (dto.sellingPrice !== undefined) {
        sellingCents = cents(dto.sellingPrice);
        marginBp = marginBasisPoints(baseCents, sellingCents) ?? (dto.profitMargin !== undefined ? cents(dto.profitMargin) : before.marginBp);
      } else if (dto.profitMargin !== undefined || dto.costPrice !== undefined || freightChanged) {
        // Cambió el costo, el flete o el margen: el precio acompaña manteniendo el margen.
        marginBp = dto.profitMargin !== undefined ? cents(dto.profitMargin) : before.marginBp;
        sellingCents = baseCents > 0n ? priceFromMargin(baseCents, marginBp, PriceRounding.NONE) : before.sellingCents;
      } else {
        sellingCents = before.sellingCents;
        marginBp = marginBasisPoints(baseCents, sellingCents) ?? before.marginBp;
      }
      if (sellingCents > MAX_PRICE_CENTS) throw new BadRequestException('El precio resultante excede el máximo admitido.');

      row.costPrice = Number(formatMoney(costCents));
      row.freightPercentage = Number(formatMoney(freightBp));
      row.freightAmount = Number(formatMoney(freightCents));
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
          after: {
            cost: formatMoney(costCents),
            freightPercentage: formatMoney(freightBp),
            freightAmount: formatMoney(freightCents),
            selling: formatMoney(sellingCents),
            minStock: saved.minStock,
            isActive: saved.isActive,
          },
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
    const mode = dto.mode ?? BulkPriceMode.PERCENTAGE;
    const percentBp = mode === BulkPriceMode.AMOUNT ? 0n : cents(dto.percentage, true);
    const amountCents = mode === BulkPriceMode.AMOUNT ? cents(dto.amount ?? 0, true) : 0n;
    if (mode === BulkPriceMode.PERCENTAGE && percentBp === 0n) throw new BadRequestException('El porcentaje no puede ser cero.');
    if (mode === BulkPriceMode.AMOUNT && amountCents === 0n) throw new BadRequestException('El importe no puede ser cero.');
    if (mode === BulkPriceMode.FREIGHT && (percentBp < 0n || percentBp > 30_000n)) throw new BadRequestException('El flete debe estar entre 0 % y 300 %.');

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
      if (scope.supplierIds?.length) qb.andWhere('p.supplierPersonId IN (:...supplierIds)', { supplierIds: scope.supplierIds });
      return qb.orderBy('p.name', 'ASC').addOrderBy('pb.branchId', 'ASC');
    };

    const compute = (rows: ProductBranchEntity[]) => {
      const changes: Array<{ row: ProductBranchEntity; before: PriceSnapshot; after: PriceSnapshot }> = [];
      let unchanged = 0;
      for (const row of rows) {
        const before: PriceSnapshot = snapshotOf(row);
        let after: PriceSnapshot;
        try {
          after =
            mode === BulkPriceMode.FREIGHT
              ? applyFreight(before, percentBp, dto.rounding)
              : mode === BulkPriceMode.AMOUNT
                ? addAmount(before, dto.target, amountCents, dto.rounding)
                : adjustPrices(before, dto.target, percentBp, dto.rounding);
        } catch (error) {
          throw new BadRequestException(
            `No se puede ajustar ${row.product.sku}: ${error instanceof Error ? error.message : 'valor inválido'}`,
          );
        }
        if (after.costCents === before.costCents && after.sellingCents === before.sellingCents && (after.freightBp ?? 0n) === (before.freightBp ?? 0n)) {
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
      oldFreightPercentage: formatMoney(change.before.freightBp ?? 0n),
      newFreightPercentage: formatMoney(change.after.freightBp ?? 0n),
      sellingChangePercentage: (() => {
        const bp = changeBasisPoints(change.before.sellingCents, change.after.sellingCents);
        return bp === null ? null : formatMoney(bp);
      })(),
    });

    if (dto.dryRun) {
      const qb = buildQuery(this.dataSource.manager);
      const total = await qb.getCount();
      this.assertBulkSize(total);
      const { changes, unchanged } = compute(await qb.getMany());
      return { dryRun: true, batchId: null, affectedRows: changes.length, unchangedRows: unchanged, preview: changes.slice(0, 200).map(toPreview) };
    }

    return this.dataSource.transaction(async (manager) => {
      const qb = buildQuery(manager).setLock('pessimistic_write');
      const rows = await qb.getMany();
      this.assertBulkSize(rows.length);
      const { changes, unchanged } = compute(rows);
      const batchId = randomUUID();
      const reason = dto.reason.trim();

      for (const change of changes) {
        change.row.costPrice = Number(formatMoney(change.after.costCents));
        change.row.freightPercentage = Number(formatMoney(change.after.freightBp ?? 0n));
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
          mode,
          percentage: mode === BulkPriceMode.AMOUNT ? null : dto.percentage,
          amount: mode === BulkPriceMode.AMOUNT ? dto.amount : null,
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
    if (query.supplierId) qb.andWhere('p.supplierPersonId = :supplierId', { supplierId: query.supplierId });
    if (query.ids?.length) qb.andWhere('p.id IN (:...ids)', { ids: query.ids });
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

  private toListItem(product: ProductEntity, suppliers: Map<string, string> = new Map()): ProductListItem {
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
      imageUrl: productImageUrl(product.imagePath),
      supplier: product.supplierPersonId ? { id: product.supplierPersonId, name: suppliers.get(product.supplierPersonId) ?? '' } : null,
    };
  }

  /** Nombre de los proveedores habituales de una página de productos. */
  private async supplierNames(tenantId: string, products: ProductEntity[]): Promise<Map<string, string>> {
    const ids = [...new Set(products.map((product) => product.supplierPersonId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(PersonEntity).find({ where: { tenantId, id: In(ids) }, select: { id: true, firstName: true, lastName: true } });
    return new Map(rows.map((row) => [row.id, printableName(row.firstName, row.lastName)]));
  }

  /**
   * Si el precio final al consumidor lleva IVA encima del precio cargado: no en Tierra del Fuego (Ley 19.640)
   * ni cuando la empresa no es Responsable Inscripto (Monotributo/Exento venden a precio final).
   */
  private async consumerAddsVat(tenantId: string, branchId: string | null): Promise<boolean> {
    const [tenant, branch, profile] = await Promise.all([
      this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId }, select: { id: true, defaultVatRegime: true } }),
      branchId ? this.dataSource.getRepository(BranchEntity).findOne({ where: { id: branchId, tenantId }, select: { id: true, vatRegime: true } }) : null,
      this.dataSource.getRepository(FiscalProfileEntity).findOne({ where: { tenantId, isActive: true }, select: { id: true, vatConditionCode: true } }),
    ]);
    if (resolveVatRegime(tenant?.defaultVatRegime, branch?.vatRegime) === VatRegime.TIERRA_DEL_FUEGO) return false;
    const condition = profile ? parseTaxCondition(profile.vatConditionCode) : TaxConditionEnum.RESPONSABLE_INSCRIPTO;
    return condition === TaxConditionEnum.RESPONSABLE_INSCRIPTO;
  }

  /**
   * Stock del producto en todas las sucursales activas de la empresa. Lo ve también el vendedor: sirve para
   * ofrecer la mercadería de otro local o pedir una transferencia. No incluye costos.
   */
  async branchStock(tenantId: string, productId: string): Promise<ProductBranchStockView[]> {
    const product = await this.dataSource.getRepository(ProductEntity).findOne({ where: { id: productId, tenantId }, select: { id: true } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    const [branches, rows] = await Promise.all([
      this.dataSource.getRepository(BranchEntity).find({ where: { tenantId, status: true }, select: { id: true, name: true }, order: { name: 'ASC' } }),
      this.dataSource.getRepository(ProductBranchEntity).find({
        where: { tenantId, productId },
        select: { id: true, branchId: true, stock: true, minStock: true, isActive: true },
      }),
    ]);
    const byBranch = new Map(rows.map((row) => [row.branchId, row]));
    return branches.map((branch) => {
      const row = byBranch.get(branch.id);
      const stock = row ? Number(row.stock) : 0;
      const minStock = row ? Number(row.minStock) : 0;
      return {
        branchId: branch.id,
        branchName: branch.name,
        enabled: Boolean(row),
        isActive: row?.isActive ?? false,
        stock,
        minStock,
        belowMinimum: Boolean(row) && stock <= minStock,
      };
    });
  }

  /**
   * Precios de un producto en cada sucursal y cada lista, con el precio final al consumidor.
   * No incluye costos: lo puede consultar el vendedor para cotizar.
   */
  async listPrices(tenantId: string, productId: string, branchScope: string | null): Promise<ProductListPricesView[]> {
    const product = await this.dataSource.getRepository(ProductEntity).findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    const rows = await this.dataSource.getRepository(ProductBranchEntity).find({
      where: { tenantId, productId, ...(branchScope ? { branchId: branchScope } : {}) },
      relations: { branch: true },
      order: { branchId: 'ASC' },
    });
    const lists = await this.loadPriceLists(tenantId, [productId]);
    const result: ProductListPricesView[] = [];
    for (const row of rows) {
      row.product = product;
      const addsVat = await this.consumerAddsVat(tenantId, row.branchId);
      const prices = listPricesFor(row, lists, addsVat);
      result.push({
        branchId: row.branchId,
        branchName: row.branch?.name ?? null,
        isActive: row.isActive,
        sellingPrice: Number(row.sellingPrice).toFixed(2),
        finalPrice: prices.finalPrice,
        vatAdded: addsVat && product.vatTreatment === VatTreatment.TAXED && !product.priceIncludesVat,
        lists: lists.map((list) => {
          const price = prices.listPrices.find((item) => item.priceListId === list.id);
          return {
            priceListId: list.id,
            name: list.name,
            percentage: list.percentage,
            paymentCondition: list.paymentCondition,
            price: price?.price ?? Number(row.sellingPrice).toFixed(2),
            finalPrice: price?.finalPrice ?? prices.finalPrice,
          };
        }),
      });
    }
    return result;
  }

  /** Listas activas con los porcentajes propios de los productos de la página. */
  private async loadPriceLists(tenantId: string, productIds: string[]): Promise<ResolvedPriceList[]> {
    const lists = await this.dataSource.getRepository(PriceListEntity).find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    if (lists.length === 0) return [];
    const overrides = productIds.length
      ? await this.dataSource.getRepository(ProductPriceListEntity).find({
          where: { tenantId, priceListId: In(lists.map((list) => list.id)), productId: In(productIds) },
          select: { priceListId: true, productId: true, appliedPercentage: true },
        })
      : [];
    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      percentage: Number(list.percentage).toFixed(2),
      percentageBasisPoints: BigInt(Math.round(Number(list.percentage) * 100)),
      paymentCondition: list.paymentCondition,
      isDefault: list.isDefault,
      isChargeBase: list.isDefault && list.paymentCondition === PriceListPaymentCondition.ANY,
      cashMethods: cashMethodsOf(list.discountMethods),
      overrides: new Map(
        overrides
          .filter((override) => override.priceListId === list.id)
          .map((override) => [override.productId, BigInt(Math.round(Number(override.appliedPercentage) * 100))]),
      ),
    }));
  }

  private toBranchView(row: ProductBranchEntity, canSeeCosts = true): Omit<BranchPriceView, 'listPrices' | 'finalPrice'> {
    const total = Number(formatMoney(totalCost(cents(row.costPrice), cents(row.freightPercentage ?? 0), cents(row.freightAmount ?? 0))));
    return {
      branchId: row.branchId,
      stock: Number(row.stock),
      minStock: Number(row.minStock),
      costPrice: canSeeCosts ? Number(row.costPrice) : null,
      freightPercentage: canSeeCosts ? Number(row.freightPercentage ?? 0) : null,
      freightAmount: canSeeCosts ? Number(row.freightAmount ?? 0) : null,
      totalCost: canSeeCosts ? total : null,
      sellingPrice: Number(row.sellingPrice),
      profitMargin: canSeeCosts ? Number(row.profitMargin) : null,
      isActive: row.isActive,
      belowMinimum: milli(row.stock, true) <= milli(row.minStock),
    };
  }
}

/** Precio final al consumidor: agrega el IVA cuando el precio está cargado sin IVA y corresponde cobrarlo. */
function consumerFinalCents(priceCents: bigint, product: ProductEntity, addsVat: boolean): bigint {
  if (!addsVat || product.priceIncludesVat || product.vatTreatment !== VatTreatment.TAXED) return priceCents;
  const rateBp = BigInt(Math.round(Number(product.taxRate) * 100));
  return roundDivide(priceCents * (10_000n + rateBp), 10_000n);
}

function listPricesFor(row: ProductBranchEntity, lists: ResolvedPriceList[], addsVat: boolean): Pick<BranchPriceView, 'listPrices' | 'finalPrice'> {
  const baseCents = cents(row.sellingPrice);
  return {
    finalPrice: formatMoney(consumerFinalCents(baseCents, row.product, addsVat)),
    listPrices: lists.map((list) => {
      const price = applyPriceList(baseCents, list, row.productId);
      return { priceListId: list.id, price: formatMoney(price), finalPrice: formatMoney(consumerFinalCents(price, row.product, addsVat)) };
    }),
  };
}

function snapshotOf(row: ProductBranchEntity): PriceSnapshot {
  return {
    costCents: cents(row.costPrice),
    sellingCents: cents(row.sellingPrice),
    marginBp: cents(row.profitMargin),
    freightBp: cents(row.freightPercentage ?? 0),
    freightCents: cents(row.freightAmount ?? 0),
  };
}

/** El proveedor habitual tiene que ser un proveedor activo de la empresa. */
export async function assertSupplier(manager: EntityManager, tenantId: string, supplierId: string): Promise<void> {
  const supplier = await manager.findOne(PersonEntity, { where: { id: supplierId, tenantId }, select: { id: true, personType: true, isActive: true } });
  if (!supplier || supplier.personType === PersonType.CUSTOMER) {
    throw new BadRequestException('El proveedor no existe o no está cargado como proveedor.');
  }
}
