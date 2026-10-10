import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { RefundMethod } from '../entities/sale-return.entity';

export class SaleReturnLineDto {
  @IsUUID('4')
  saleItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999.999)
  quantity!: number;
}

/** POST /sales/:id/returns (encabezado Idempotency-Key obligatorio). Sin líneas devuelve todo lo pendiente. */
export class CreateSaleReturnDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnLineDto)
  lines?: SaleReturnLineDto[];

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  restock: boolean = true;

  @IsEnum(RefundMethod)
  refundMethod!: RefundMethod;

  /** Obligatorio si refundMethod = CASH: caja abierta de la sucursal de la venta. */
  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalReference?: string;
}
