import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductEntity } from './entities/product.entity';
import { InventoryMovementEntity, InventoryMovementType } from './entities/inventory-movement.entity';
import { AuditEventEntity } from '../../platform/entities/audit-event.entity';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(ProductBranchEntity)
    private readonly productBranchRepository: Repository<ProductBranchEntity>,
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
    private readonly dataSource: DataSource,
  ) { }

  
  //Registra un producto y su matriz de precios/stock inicial por sucursal en una transacción atómica.
  async create(tenantId: string, actorUserId: string, createProductDto: CreateProductDto): Promise<ProductEntity> {
    const { sku, barcode, branchSettings, ...productData } = createProductDto;

    // 1. Validar duplicados dentro de la empresa para SKU y código de barras
    const existingSku = await this.productRepository.findOne({ where: { sku: sku.trim().toUpperCase(), tenantId } });

    if (existingSku) { throw new ConflictException(`El SKU '${sku}' ya está registrado en su catálogo`); }

    if (barcode) {
      const existingBarcode = await this.productRepository.findOne({ where: { barcode: barcode.trim(), tenantId } });
      if (existingBarcode) { throw new ConflictException(`El código de barras '${barcode}' ya está asignado a otro producto`) }
    }

    // 2. Transacción de creación atómica (Producto + Precios en Sucursales)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // a. Guardar Cabecera del Producto
      const newProduct = queryRunner.manager.create(ProductEntity, {
        ...productData,
        tenantId,
        sku: sku.trim().toUpperCase(),
        barcode: barcode?.trim() || null,
      });

      const savedProduct = await queryRunner.manager.save(newProduct);

      // b. Crear la matriz por sucursal
      const branchEntitiesToSave: ProductBranchEntity[] = [];

      for (const bSetting of branchSettings) {
        const branch = await queryRunner.manager.findOne(BranchEntity, {
          where: { id: bSetting.branchId, tenantId },
        });

        if (!branch) { throw new NotFoundException(`La sucursal ID '${bSetting.branchId}' no pertenece a su empresa`) }

        const pbEntry = queryRunner.manager.create(ProductBranchEntity, {
          tenantId,
          productId: savedProduct.id,
          branchId: bSetting.branchId,
          costPrice: bSetting.costPrice,
          profitMargin: bSetting.profitMargin,
          sellingPrice: bSetting.sellingPrice,
          stock: bSetting.stock,
          minStock: bSetting.minStock,
          isActive: true,
        });

        branchEntitiesToSave.push(pbEntry);
      }

      await queryRunner.manager.save(branchEntitiesToSave);

      const openingMovements = branchEntitiesToSave.map((stock) =>
        queryRunner.manager.create(InventoryMovementEntity, {
          tenantId,
          productId: savedProduct.id,
          branchId: stock.branchId,
          movementType: InventoryMovementType.OPENING,
          quantityDelta: Number(stock.stock).toFixed(3),
          quantityBefore: '0.000',
          quantityAfter: Number(stock.stock).toFixed(3),
          reason: 'Saldo inicial al dar de alta el producto',
          referenceType: 'PRODUCT_OPENING',
          referenceId: savedProduct.id,
          idempotencyKey: `opening:${savedProduct.id}:${stock.branchId}`,
          actorUserId,
        }),
      );
      const savedMovements = await queryRunner.manager.save(
        InventoryMovementEntity,
        openingMovements,
      );
      const openingAudits = savedMovements.map((movement) =>
        queryRunner.manager.create(AuditEventEntity, {
          tenantId,
          actorUserId,
          eventType: 'INVENTORY_OPENING_RECORDED',
          aggregateType: 'INVENTORY_MOVEMENT',
          aggregateId: movement.id,
          metadata: {
            productId: savedProduct.id,
            branchId: movement.branchId,
            quantity: movement.quantityAfter,
            reason: movement.reason,
          },
        }),
      );
      await queryRunner.manager.save(AuditEventEntity, openingAudits);
      await queryRunner.commitTransaction();

      this.logger.log(`Producto '${savedProduct.name}' (SKU: ${savedProduct.sku}) creado exitosamente.`);
      return this.findOne(savedProduct.id, tenantId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error al ejecutar la transacción de creación de producto', error);
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al guardar el producto en la base de datos');
    } finally {
      await queryRunner.release();
    }
  }

  async adjustStock(
    tenantId: string,
    actorUserId: string,
    productId: string,
    branchId: string,
    idempotencyKey: string,
    dto: AdjustStockDto,
  ): Promise<InventoryMovementEntity> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }

    const normalizedReason = dto.reason.trim();
    const delta = Number(dto.quantityDelta);
    if (!Number.isFinite(delta) || Math.abs(delta * 1000 - Math.round(delta * 1000)) > 1e-6) {
      throw new BadRequestException('La cantidad debe ser finita y tener como máximo tres decimales.');
    }
    if (!normalizedReason) {
      throw new BadRequestException('El motivo del ajuste es obligatorio.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const stockRow = await queryRunner.manager
        .createQueryBuilder(ProductBranchEntity, 'stock')
        .setLock('pessimistic_write')
        .where('stock.tenantId = :tenantId', { tenantId })
        .andWhere('stock.productId = :productId', { productId })
        .andWhere('stock.branchId = :branchId', { branchId })
        .andWhere('stock.isActive = :isActive', { isActive: true })
        .getOne();

      if (!stockRow) {
        throw new NotFoundException('El producto no está activo en una sucursal de esta empresa.');
      }

      const movementRepository = queryRunner.manager.getRepository(InventoryMovementEntity);
      const existing = await movementRepository.findOne({
        where: { tenantId, idempotencyKey: key },
      });
      if (existing) {
        const sameRequest =
          existing.productId === productId &&
          existing.branchId === branchId &&
          Number(existing.quantityDelta) === delta &&
          existing.reason === normalizedReason &&
          existing.movementType === InventoryMovementType.ADJUSTMENT;
        if (!sameRequest) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otra operación.');
        }
        await queryRunner.commitTransaction();
        return existing;
      }

      const quantityBefore = Number(stockRow.stock);
      const quantityAfter = Number((quantityBefore + delta).toFixed(3));
      if (!Number.isFinite(quantityAfter) || quantityAfter < 0) {
        throw new BadRequestException('El ajuste dejaría el stock por debajo de cero.');
      }

      stockRow.stock = quantityAfter;
      await queryRunner.manager.save(ProductBranchEntity, stockRow);

      const movement = movementRepository.create({
        tenantId,
        productId,
        branchId,
        movementType: InventoryMovementType.ADJUSTMENT,
        quantityDelta: delta.toFixed(3),
        quantityBefore: quantityBefore.toFixed(3),
        quantityAfter: quantityAfter.toFixed(3),
        reason: normalizedReason,
        referenceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: key,
        actorUserId,
      });
      const savedMovement = await movementRepository.save(movement);
      await queryRunner.manager.save(
        AuditEventEntity,
        queryRunner.manager.create(AuditEventEntity, {
          tenantId,
          actorUserId,
          eventType: 'INVENTORY_STOCK_ADJUSTED',
          aggregateType: 'INVENTORY_MOVEMENT',
          aggregateId: savedMovement.id,
          metadata: {
            productId,
            branchId,
            quantityDelta: savedMovement.quantityDelta,
            quantityBefore: savedMovement.quantityBefore,
            quantityAfter: savedMovement.quantityAfter,
            reason: normalizedReason,
          },
        }),
      );

      await queryRunner.commitTransaction();
      return savedMovement;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ER_DUP_ENTRY'
      ) {
        const existing = await this.productBranchRepository.manager
          .getRepository(InventoryMovementEntity)
          .findOne({ where: { tenantId, idempotencyKey: key } });
        if (
          existing &&
          existing.productId === productId &&
          existing.branchId === branchId &&
          Number(existing.quantityDelta) === delta &&
          existing.reason === normalizedReason &&
          existing.movementType === InventoryMovementType.ADJUSTMENT
        ) {
          return existing;
        }
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra operación.');
      }
      this.logger.error('Error al aplicar el ajuste de stock', error);
      throw new InternalServerErrorException('No se pudo aplicar el ajuste de stock.');
    } finally {
      await queryRunner.release();
    }
  }

  async findStockMovements(
    tenantId: string,
    productId: string,
    branchId: string,
    query: StockMovementQueryDto,
  ): Promise<{ items: InventoryMovementEntity[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const builder = this.dataSource
      .getRepository(InventoryMovementEntity)
      .createQueryBuilder('movement')
      .where('movement.tenantId = :tenantId', { tenantId })
      .andWhere('movement.productId = :productId', { productId })
      .andWhere('movement.branchId = :branchId', { branchId });

    if (query.cursor) {
      let cursorId: string;
      try {
        cursorId = Buffer.from(query.cursor, 'base64url').toString('utf8');
      } catch {
        throw new BadRequestException('El cursor de movimientos no es válido.');
      }
      if (
        !/^[0-9]{1,20}$/.test(cursorId)
      ) {
        throw new BadRequestException('El cursor de movimientos no es válido.');
      }
      builder.andWhere(
        'movement.id < :cursorId',
        { cursorId },
      );
    }

    const rows = await builder
      .orderBy('movement.id', 'DESC')
      .take(limit + 1)
      .getMany();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(last.id, 'utf8').toString('base64url')
      : null;
    return { items, nextCursor };
  }

  //Busca productos por filtro de sucursal (para el POS o gestión de stock local). 
  async findByBranch(tenantId: string, branchId: string): Promise<ProductBranchEntity[]> {
    try{
      return await this.productBranchRepository.find({ where: { tenantId, branchId, isActive: true }, relations: { product: true }, order: { product: { name: 'ASC' } } });
    } catch (error) {
      this.logger.error(`Error al buscar productos para la sucursal ID '${branchId}'`, error);
      throw new InternalServerErrorException('Error al consultar productos por sucursal');
    }
  };

  //Obtiene la ficha completa de un producto con la matriz de todas sus sucursales.
  async findOne(id: string, tenantId: string): Promise<ProductEntity> {
    try{
      const product = await this.productRepository.findOne({ where: { id, tenantId }, relations: { branchSettings: { branch: true } } });
  
      if (!product) { throw new NotFoundException(`El producto con ID '${id}' no existe en su catálogo`) }
      return product;
    } catch (error) {
      this.logger.error(`Error al buscar el producto ID '${id}'`, error);
      throw new InternalServerErrorException('Error al consultar el producto');
    }
  };
}