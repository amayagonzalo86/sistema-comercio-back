import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { PromotionType } from '../domain/promotions';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * Ejemplos:
 *  { "name": "Miércoles 15% en bebidas", "type": "PERCENTAGE", "percentage": 15, "categories": ["Bebidas"], "weekdays": [3] }
 *  { "name": "3x2 en yerbas", "type": "BUY_X_PAY_Y", "buyQuantity": 3, "payQuantity": 2, "categories": ["Yerba"] }
 */
export class CreatePromotionDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(PromotionType)
  type!: PromotionType;

  /** PERCENTAGE: porcentaje de descuento (0.01 a 100). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(1000)
  buyQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  payQuantity?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  brands?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  branchIds?: string[];

  /** 0 = domingo ... 6 = sábado. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999)
  minQuantity?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromotionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class PromotionQueryDto extends PageQueryDto {
  /** true = solo vigentes hoy. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  current?: boolean;
}

export class CustomerInsightQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 50;
}

export class InactiveCustomersQueryDto extends PageQueryDto {
  /** Días sin comprar para considerar inactivo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(730)
  days: number = 60;

  /** Solo clientes que aceptaron comunicaciones comerciales. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  onlyWithConsent?: boolean;
}
