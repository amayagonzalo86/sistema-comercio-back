import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ProductBranchEntity } from '../../inventory/product/entities/product-branch.entity';
import { ProductEntity } from '../../inventory/product/entities/product.entity';
import { CreatePriceListDto } from './dto/price-list.dto';
import { PriceListEntity } from './entities/price-list.entity';
import { ProductPriceListEntity } from './entities/product-price-list.entity';

export interface CalculatedPriceResponse {
  productId: string;
  branchId: string;
  priceListId: string;
  basePrice: number;
  appliedPercentage: number;
  finalPrice: number;
  isCustomOverride: boolean;
}

@Injectable()
export class PriceListService {
  private readonly logger = new Logger(PriceListService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PriceListEntity)
    private readonly priceListRepo: Repository<PriceListEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(ProductBranchEntity)
    private readonly productBranchRepo: Repository<ProductBranchEntity>,
  ) { }

  async create(createPriceListDto: CreatePriceListDto, tenantId: string): Promise<PriceListEntity> {
    const { productOverrides = [], ...priceListData } = createPriceListDto;

    if (productOverrides.length > 0) {
      const productIds = productOverrides.map((item) => item.productId);

      const existingProducts = await this.productRepo.find({
        where: {
          id: In(productIds),
          tenantId: tenantId,
        },
        select: { id: true },
      });

      const existingIds = new Set(existingProducts.map((p) => p.id));
      const invalidIds = productIds.filter((id) => !existingIds.has(id));

      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `Los siguientes productos no existen o no pertenecen a la empresa actual: [${invalidIds.join(', ')}]`,
        );
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newPriceList = queryRunner.manager.create(PriceListEntity, {
        ...priceListData,
        tenantId,
      });

      const savedPriceList = await queryRunner.manager.save(PriceListEntity, newPriceList);

      if (productOverrides.length > 0) {
        const details = productOverrides.map((override) =>
          queryRunner.manager.create(ProductPriceListEntity, {
            tenantId,
            priceListId: savedPriceList.id,
            productId: override.productId,
            appliedPercentage: override.appliedPercentage,
          }),
        );

        await queryRunner.manager.save(ProductPriceListEntity, details);
      }

      await queryRunner.commitTransaction();

      return await this.priceListRepo.findOneOrFail({
        where: { id: savedPriceList.id, tenantId },
        relations: { productOverrides: true },
      });
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();

      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Error al guardar la lista de precios para el tenant ${tenantId}: ${errorMessage}`,
        errorStack,
      );

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Error crítico al persistir la lista de precios en la base de datos.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Obtiene el precio calculado considerando la sucursal (sellingPrice) y las reglas de sobreescritura
   */
  async getCalculatedProductPrice(
    productId: string,
    branchId: string,
    priceListId: string,
    tenantId: string,
  ): Promise<CalculatedPriceResponse> {
    const priceList = await this.priceListRepo.findOne({
      where: { id: priceListId, tenantId, isActive: true },
      relations: { productOverrides: true },
    });

    if (!priceList) {
      throw new NotFoundException(`La lista de precios con ID '${priceListId}' no existe o está inactiva.`);
    }

    const productBranch = await this.productBranchRepo.findOne({
      where: { productId, branchId, tenantId },
      relations: { product: true },
    });

    if (!productBranch) {
      throw new NotFoundException(
        `El producto '${productId}' no está asignado o habilitado en la sucursal '${branchId}'.`,
      );
    }

    const basePrice = Number(productBranch.sellingPrice ?? 0);

    const override = priceList.productOverrides?.find((item) => item.productId === productId);

    let appliedPercentage = Number(priceList.percentage);
    let isCustomOverride = false;

    if (override) {
      appliedPercentage = Number(override.appliedPercentage);
      isCustomOverride = true;
    }

    const marginAmount = basePrice * (appliedPercentage / 100);
    const finalPrice = Number((basePrice + marginAmount).toFixed(2));

    return {
      productId,
      branchId,
      priceListId,
      basePrice,
      appliedPercentage,
      finalPrice,
      isCustomOverride,
    };
  }
}