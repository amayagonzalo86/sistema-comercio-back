import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
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
import { PriceListPaymentCondition } from '../entities/price-list.entity';
import { MAX_PRICE_LIST_PERCENTAGE, MIN_PRICE_LIST_PERCENTAGE } from '../pricing';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Porcentaje propio de un producto dentro de la lista (reemplaza el de la lista para ese producto). */
export class ProductPriceOverrideDto {
  @IsUUID('4', { message: 'El productId debe ser un UUID v4 válido.' })
  readonly productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El porcentaje del producto debe ser numérico (hasta 2 decimales).' })
  @Min(MIN_PRICE_LIST_PERCENTAGE, { message: 'El descuento no puede ser del 100 % o más.' })
  @Max(MAX_PRICE_LIST_PERCENTAGE, { message: `El recargo admite hasta ${MAX_PRICE_LIST_PERCENTAGE} %.` })
  readonly appliedPercentage!: number;
}

/**
 * POST /price-lists — lista de precios.
 * percentage: negativo = descuento (−5 → 5 % menos), positivo = recargo (300 → precio × 4).
 */
export class CreatePriceListDto {
  @Transform(trim)
  @IsString({ message: 'El nombre de la lista es obligatorio.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(60, { message: 'El nombre admite hasta 60 caracteres.' })
  readonly name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  readonly description?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El porcentaje debe ser numérico (hasta 2 decimales).' })
  @Min(MIN_PRICE_LIST_PERCENTAGE, { message: 'El descuento no puede ser del 100 % o más.' })
  @Max(MAX_PRICE_LIST_PERCENTAGE, { message: `El recargo admite hasta ${MAX_PRICE_LIST_PERCENTAGE} %.` })
  readonly percentage!: number;

  @IsOptional()
  @IsEnum(PriceListPaymentCondition, { message: 'Condición de pago inválida (ANY o CASH_ONLY).' })
  readonly paymentCondition?: PriceListPaymentCondition;

  @IsOptional()
  @IsBoolean()
  readonly isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  readonly sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ProductPriceOverrideDto)
  readonly productOverrides?: ProductPriceOverrideDto[];
}

/** PATCH /price-lists/:id — si se envía productOverrides, reemplaza los porcentajes propios de productos. */
export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}
