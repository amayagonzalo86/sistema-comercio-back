import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ALLOWED_VAT_PERCENTAGES } from '../../../fiscal/vat/vat';
import { SaleAdjustmentKind, SaleAdjustmentSettlement } from '../entities/sale-adjustment.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * POST /sales/:id/adjustments (Idempotency-Key obligatorio) — nota de crédito o débito por importe.
 * Ej.: { "kind": "DEBIT", "concept": "Cheque rechazado N.º 12345678", "reason": "Banco Nación lo devolvió sin fondos",
 *        "amount": 1210, "taxRate": 21, "settlement": "CASH", "cashSessionId": "…" }
 */
export class CreateSaleAdjustmentDto {
  @IsEnum(SaleAdjustmentKind, { message: 'Indicá CREDIT (nota de crédito) o DEBIT (nota de débito).' })
  kind!: SaleAdjustmentKind;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Detallá el concepto (mínimo 3 caracteres).' })
  @MaxLength(150)
  concept!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Detallá el motivo (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;

  /** Importe final (con IVA incluido cuando corresponde). */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El importe debe ser numérico (hasta 2 decimales).' })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  /** Alícuota de IVA (si no se indica, la principal de la venta). Se ignora en ventas sin IVA y en clase C. */
  @IsOptional()
  @IsIn(ALLOWED_VAT_PERCENTAGES as number[], { message: `Alícuota no admitida (${ALLOWED_VAT_PERCENTAGES.join(', ')}).` })
  taxRate?: number;

  @IsEnum(SaleAdjustmentSettlement, { message: 'Liquidación inválida (CASH, OTHER o NONE).' })
  settlement!: SaleAdjustmentSettlement;

  /** Obligatorio si settlement = CASH: caja abierta de la sucursal de la venta. */
  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  externalReference?: string;
}
