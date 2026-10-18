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
import { SalePaymentMethod } from '../entities/sale-payment.entity';
import { VatExemptionReason, VatRegime, VoucherClass } from '../../fiscal/vat/vat';

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

  /** Plan de tarjeta (crédito o débito): define cuotas y recargo de esta parte del cobro. */
  @IsOptional()
  @IsUUID('4')
  cardPlanId?: string;
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

  /**
   * Régimen de IVA solo para esta venta (por ejemplo, una venta desde Tierra del Fuego al continente con IVA).
   * Si no se envía, se usa el de la sucursal o la empresa. Solo titular/administración pueden forzarlo.
   */
  @IsOptional()
  @IsEnum(VatRegime)
  vatRegime?: VatRegime;

  /** Comprobante elegido por el cajero (A, B o C). Se valida contra las reglas de ARCA. */
  @IsOptional()
  @IsEnum(VoucherClass)
  voucherClass?: VoucherClass;

  /** Pedido de venta (preventa) que se está cobrando. Debe estar pendiente y ser de la misma sucursal. */
  @IsOptional()
  @IsUUID('4')
  salesOrderId?: string;

  /** Lista de precios (si no se indica, la principal de la empresa). */
  @IsOptional()
  @IsUUID('4')
  priceListId?: string;

  /**
   * Caja donde se cobra (aunque se pague con tarjeta, QR o transferencia): así el cierre X/Z suma todos los
   * medios de pago. Si hay pago en efectivo, se usa la caja de ese pago.
   */
  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  /**
   * Aplica la lista de efectivo (ej.: −5 %) a la parte pagada en efectivo, aunque el resto se pague con otro medio.
   * Solo sobre la lista principal; con una lista elegida (cliente, gobierno) no se suma.
   */
  @IsOptional()
  @IsBoolean()
  cashDiscount?: boolean;
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

  /**
   * Régimen de IVA solo para esta venta (por ejemplo, una venta desde Tierra del Fuego al continente con IVA).
   * Si no se envía, se usa el de la sucursal o la empresa. Solo titular/administración pueden forzarlo.
   */
  @IsOptional()
  @IsEnum(VatRegime)
  vatRegime?: VatRegime;

  /** Comprobante elegido por el cajero (A, B o C). Se valida contra las reglas de ARCA. */
  @IsOptional()
  @IsEnum(VoucherClass)
  voucherClass?: VoucherClass;

  /** Lista de precios (si no se indica, la principal de la empresa). */
  @IsOptional()
  @IsUUID('4')
  priceListId?: string;
}
