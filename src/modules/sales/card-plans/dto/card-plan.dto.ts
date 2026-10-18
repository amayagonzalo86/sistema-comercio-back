import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CardBrand, CardPlanPaymentMethod } from '../entities/card-plan.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Recargo máximo (300 %) y descuento máximo (50 %) de un plan de tarjeta. */
export const MAX_CARD_SURCHARGE = 300;
export const MIN_CARD_SURCHARGE = -50;

/**
 * POST /card-plans — plan de tarjeta.
 * Ej.: { "name": "Visa Banco de Tierra del Fuego", "cardBrand": "VISA", "bankName": "Banco de Tierra del Fuego",
 *        "paymentMethod": "CREDIT_CARD", "installments": 12, "surchargePercentage": 0, "weekdays": [4] }
 */
export class CreateCardPlanDto {
  @Transform(trim)
  @IsString({ message: 'El nombre de la tarjeta es obligatorio.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(80, { message: 'El nombre admite hasta 80 caracteres.' })
  readonly name!: string;

  @IsOptional()
  @IsEnum(CardBrand, { message: 'Marca de tarjeta inválida.' })
  readonly cardBrand?: CardBrand;

  /** null o vacío = cualquier banco. */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(80, { message: 'El banco admite hasta 80 caracteres.' })
  readonly bankName?: string | null;

  @IsOptional()
  @IsEnum(CardPlanPaymentMethod, { message: 'El plan debe ser de tarjeta de crédito o de débito.' })
  readonly paymentMethod?: CardPlanPaymentMethod;

  @IsInt({ message: 'Las cuotas deben ser un número entero.' })
  @Min(1, { message: 'Como mínimo, 1 pago.' })
  @Max(60, { message: 'Como máximo, 60 cuotas.' })
  readonly installments!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El recargo debe ser numérico (hasta 2 decimales).' })
  @Min(MIN_CARD_SURCHARGE, { message: `El descuento admite hasta ${-MIN_CARD_SURCHARGE} %.` })
  @Max(MAX_CARD_SURCHARGE, { message: `El recargo admite hasta ${MAX_CARD_SURCHARGE} %.` })
  readonly surchargePercentage!: number;

  /** Días de la semana (0 = domingo … 6 = sábado). Vacío o null = todos los días. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true, message: 'Los días van de 0 (domingo) a 6 (sábado).' })
  @Min(0, { each: true, message: 'Los días van de 0 (domingo) a 6 (sábado).' })
  @Max(6, { each: true, message: 'Los días van de 0 (domingo) a 6 (sábado).' })
  readonly weekdays?: number[] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha desde debe tener el formato AAAA-MM-DD.' })
  readonly validFrom?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha hasta debe tener el formato AAAA-MM-DD.' })
  readonly validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  readonly sortOrder?: number;
}

/** PATCH /card-plans/:id */
export class UpdateCardPlanDto extends PartialType(CreateCardPlanDto) {}
