import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,

  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { UnitOfMeasure } from '../entities/product.entity';
import { PriceRounding, PriceTarget } from '../domain/pricing';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export enum ProductStatusFilter {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export enum ProductSort {
  NAME = 'name',
  SKU = 'sku',
  UPDATED = 'updated',
  STOCK = 'stock',
}

/** GET /products — búsqueda del catálogo con filtros para la grilla del frontend. */
export class ProductListQueryDto extends PageQueryDto {
  /** Busca en nombre, SKU y código de barras. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  brand?: string;

  /** Con sucursal, cada producto trae su precio y stock en esa sucursal. */
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsEnum(ProductStatusFilter)
  status: ProductStatusFilter = ProductStatusFilter.ACTIVE;

  /** Solo productos con stock en o por debajo del mínimo (requiere branchId o usa todas las sucursales). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  lowStock?: boolean;

  @IsOptional()
  @IsEnum(ProductSort)
  sort: ProductSort = ProductSort.NAME;
}

/** PATCH /products/:id — datos generales (precios y stock van por sucursal). */
export class EditProductDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  category?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsEnum(UnitOfMeasure)
  unitOfMeasure?: UnitOfMeasure;
}

export class UpdateProductStatusDto {
  @IsBoolean()
  status!: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

/** PUT /products/:id/branches/:branchId — precio, costo y mínimo de stock en una sucursal (alta si no existía). */
export class UpsertBranchPriceDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  costPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  sellingPrice?: number;

  /** Si se envía sin sellingPrice, el precio se recalcula como costo × (1 + margen). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999.99)
  profitMargin?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999.999)
  minStock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class PriceUpdateScopeDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  brands?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  productIds?: string[];

  /** Sucursales a ajustar. Vacío = todas. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  branchIds?: string[];
}

/**
 * POST /products/price-updates — ajuste masivo de precios.
 * Con dryRun=true devuelve la vista previa sin modificar nada.
 */
export class BulkPriceUpdateDto {
  /** Porcentaje a aplicar: 15 = +15 %, -10 = -10 %. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-90)
  @Max(500)
  percentage!: number;

  @IsEnum(PriceTarget)
  target: PriceTarget = PriceTarget.SELLING_PRICE;

  @IsEnum(PriceRounding)
  rounding: PriceRounding = PriceRounding.NONE;

  @ValidateNested()
  @Type(() => PriceUpdateScopeDto)
  scope: PriceUpdateScopeDto = new PriceUpdateScopeDto();

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  dryRun: boolean = true;
}

export class PriceHistoryQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}
