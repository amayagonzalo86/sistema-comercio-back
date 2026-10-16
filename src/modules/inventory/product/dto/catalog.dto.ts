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
  ValidateIf,
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

  /** Proveedor habitual del producto. */
  @IsOptional()
  @IsUUID('4')
  supplierId?: string;

  /** Productos puntuales (ej.: selección para imprimir etiquetas): UUIDs separados por coma, hasta 100. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids?: string[];

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

  /** Proveedor habitual (null = sin proveedor). */
  @IsOptional()
  @IsUUID('4')
  supplierPersonId?: string | null;
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

  /** Flete en % del costo (0 a 300). El margen se calcula sobre costo + flete. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(300)
  freightPercentage?: number;

  /** Flete fijo por unidad. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  freightAmount?: number;

  /** Si se envía sin sellingPrice, el precio se recalcula como costo total × (1 + margen). */
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

  /** Proveedores habituales de los productos a ajustar. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  supplierIds?: string[];

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
/** Qué hace el ajuste masivo. */
export enum BulkPriceMode {
  /** Porcentaje sobre costo o precio (15 = +15 %). */
  PERCENTAGE = 'PERCENTAGE',
  /** Importe fijo en pesos sobre costo o precio; se informa el % equivalente de cada producto. */
  AMOUNT = 'AMOUNT',
  /** Fija el flete (% sobre el costo) y recalcula el precio manteniendo el margen. */
  FREIGHT = 'FREIGHT',
}

export class BulkPriceUpdateDto {
  @IsOptional()
  @IsEnum(BulkPriceMode)
  mode: BulkPriceMode = BulkPriceMode.PERCENTAGE;

  /** PERCENTAGE: porcentaje a aplicar (15 = +15 %, -10 = -10 %). FREIGHT: flete a fijar (0 a 300 %). */
  @ValidateIf((dto: BulkPriceUpdateDto) => dto.mode !== BulkPriceMode.AMOUNT)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-90)
  @Max(500)
  percentage!: number;

  /** AMOUNT: pesos a sumar (o restar, negativo) por unidad. */
  @ValidateIf((dto: BulkPriceUpdateDto) => dto.mode === BulkPriceMode.AMOUNT)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-999999999.99)
  @Max(999999999.99)
  amount?: number;

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
