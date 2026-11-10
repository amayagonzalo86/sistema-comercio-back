import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean;
};

/**
 * Datos que la empresa imprime en facturas y presupuestos. Un campo vacío lo quita del impreso.
 * El descuento de efectivo y las cuotas del presupuesto no se cargan acá: salen de la lista de efectivo y de los planes de tarjeta.
 */
export class UpdatePrintSettingsDto {
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30, { message: 'El WhatsApp admite hasta 30 caracteres.' })
  @Matches(/^\+?[0-9 ()-]{6,30}$/, { message: 'El WhatsApp solo puede tener números, espacios, guiones, paréntesis y un + inicial.' })
  whatsapp?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120, { message: 'La web admite hasta 120 caracteres.' })
  @Matches(/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"]*)?$/i, { message: 'Escribí la web como www.tuempresa.com.ar.' })
  website?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300, { message: 'La leyenda admite hasta 300 caracteres.' })
  @Matches(/^[^<>]*$/, { message: 'La leyenda no puede tener los caracteres < o >.' })
  invoiceLegend?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80, { message: 'La nota de condición admite hasta 80 caracteres.' })
  @Matches(/^[^<>]*$/, { message: 'La nota de condición no puede tener los caracteres < o >.' })
  quoteCondition?: string | null;
}
