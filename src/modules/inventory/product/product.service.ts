import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductEntity } from './entities/product.entity';

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

  /**
   * Registra un producto y su matriz de precios/stock inicial por sucursal en una transacción atómica.
   */
  async create(createProductDto: CreateProductDto, tenantId: string): Promise<ProductEntity> {
    const { sku, barcode, branchSettings, ...productData } = createProductDto;

    // 1. Validar duplicados dentro del tenant
    const existingSku = await this.productRepository.findOne({
      where: { tenantId, sku },
    });

    if (existingSku) {
      throw new ConflictException(`El SKU '${sku}' ya está registrado en su catálogo`);
    }

    if (barcode) {
      const existingBarcode = await this.productRepository.findOne({
        where: { tenantId, barcode },
      });
      if (existingBarcode) {
        throw new ConflictException(`El código de barras '${barcode}' ya está asignado a otro producto`);
      }
    }

    // 2. Transacción de creación atómica (Producto + Precios en Sucursales)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // a. Guardar Cabecera del Producto
      const newProduct = queryRunner.manager.create(ProductEntity, {
        ...productData,
        sku: sku.trim().toUpperCase(),
        barcode: barcode?.trim() || null,
        tenantId,
      });

      const savedProduct = await queryRunner.manager.save(newProduct);

      // b. Crear la matriz por sucursal
      const branchEntitiesToSave: ProductBranchEntity[] = [];

      for (const bSetting of branchSettings) {
        const branch = await queryRunner.manager.findOne(BranchEntity, {
          where: { id: bSetting.branchId, tenantId },
        });

        if (!branch) {
          throw new NotFoundException(`La sucursal ID '${bSetting.branchId}' no pertenece a su empresa`);
        }

        const pbEntry = queryRunner.manager.create(ProductBranchEntity, {
          tenantId,
          productId: savedProduct.id,
          branchId: bSetting.branchId,
          costPrice: bSetting.costPrice,
          profitMargin: bSetting.profitMargin,
          sellingPrice: bSetting.sellingPrice,
          stock: bSetting.stock,
          minStock: bSetting.minStock,
          isActive: bSetting.isActive ?? true,
        });

        branchEntitiesToSave.push(pbEntry);
      }

      await queryRunner.manager.save(branchEntitiesToSave);
      await queryRunner.commitTransaction();

      this.logger.log(`Producto '${savedProduct.name}' (SKU: ${savedProduct.sku}) creado exitosamente.`);
      return this.findOne(savedProduct.id, tenantId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error al ejecutar la transacción de creación de producto', error);
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al guardar el producto en la base de datos');
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Busca productos por filtro de sucursal (para el POS o gestión de stock local).
   */
  async findByBranch(tenantId: string, branchId: string): Promise<ProductBranchEntity[]> {
    return await this.productBranchRepository.find({
      where: { tenantId, branchId, isActive: true },
      relations: { product: true },
      order: { product: { name: 'ASC' } },
    });
  }

  /**
   * Obtiene la ficha completa de un producto con la matriz de todas sus sucursales.
   */
  async findOne(id: string, tenantId: string): Promise<ProductEntity> {
    const product = await this.productRepository.findOne({
      where: { id, tenantId },
      relations: { branchSettings: { branch: true } },
    });

    if (!product) {
      throw new NotFoundException(`El producto con ID '${id}' no existe en su catálogo`);
    }

    return product;
  }
}