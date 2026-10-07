import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ALLOWED_VAT_PERCENTAGES, VatTreatment } from '../../../fiscal/vat/vat';

/**
 * Asignar o quitar IVA a un producto.
 * - Asignar: { "vatTreatment": "TAXED", "taxRate": 21 }
 * - Quitar (exento por ley): { "vatTreatment": "EXEMPT", "reason": "Libro - art. 7 inc. a Ley de IVA" }
 * - Quitar (no gravado): { "vatTreatment": "NOT_TAXED", "reason": "..." }
 */
export class UpdateProductVatDto {
  @IsEnum(VatTreatment, { message: 'El tratamiento de IVA debe ser TAXED, EXEMPT o NOT_TAXED' })
  readonly vatTreatment!: VatTreatment;

  @IsOptional()
  @IsIn(ALLOWED_VAT_PERCENTAGES as number[], {
    message: `La alícuota de IVA debe ser una de: ${ALLOWED_VAT_PERCENTAGES.join(', ')}`,
  })
  readonly taxRate?: number;

  @IsOptional()
  @IsBoolean({ message: 'priceIncludesVat debe ser verdadero o falso' })
  readonly priceIncludesVat?: boolean;

  @IsString({ message: 'Indicá el motivo del cambio (queda auditado).' })
  @MinLength(5, { message: 'El motivo debe tener al menos 5 caracteres.' })
  @MaxLength(200, { message: 'El motivo admite hasta 200 caracteres.' })
  readonly reason!: string;
}
