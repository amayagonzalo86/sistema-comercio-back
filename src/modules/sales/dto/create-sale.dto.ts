import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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
import { SalePaymentMethod } from '../entities/sale-payment.entity';
import { VatExemptionReason } from '../../fiscal/vat/vat';

/**
 * Quita el IVA de toda la venta por una causa legal. Solo OWNER/ADMIN de la empresa; queda auditado.
 * Ej.: { "reason": "EXPORT", "note": "Permiso de embarque 26 001 EC01 123456 X" }
 */
export class SaleVatExemptionDto {
  @IsEnum(VatExemptionReason, { message: 'Motivo de exención inválido (EXPORT, TIERRA_DEL_FUEGO, DIPLOMATIC, OTHER_LEGAL)' })
  reason!: VatExemptionReason;

  @IsString()
  @MinLength(5, { message: 'Detallá el respaldo de la exención (mínimo 5 caracteres).' })
  @MaxLength(200)
  note!: string;
}

export class CreateSaleLineDto {
  @IsUUID('4')
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999.999)
  quantity!: number;
}

export class CreateSalePaymentDto {
  @IsEnum(SalePaymentMethod)
  method!: SalePaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;
}

export class CreateSaleDto {
  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @IsUUID('4')
  customerPersonId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleLineDto)
  lines!: CreateSaleLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments!: CreateSalePaymentDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleVatExemptionDto)
  vatExemption?: SaleVatExemptionDto;
}

/** POST /sales/quote — calcula la venta (promociones, IVA y total) sin registrarla. */
export class QuoteSaleDto {
  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @IsUUID('4')
  customerPersonId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleLineDto)
  lines!: CreateSaleLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleVatExemptionDto)
  vatExemption?: SaleVatExemptionDto;
}
