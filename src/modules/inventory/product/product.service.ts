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

  
  //Registra un producto y su matriz de precios/stock inicial por sucursal en una transacción atómica.
  async create(tenantId: string, createProductDto: CreateProductDto): Promise<ProductEntity> {
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