import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean;
};

/** Datos que la empresa imprime en facturas y presupuestos. Un campo vacío lo quita del impreso. */
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
  @MaxLength(80, { message: 'La condición admite hasta 80 caracteres.' })
  @Matches(/^[^<>]*$/, { message: 'La condición no puede tener los caracteres < o >.' })
  quoteCondition?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El descuento debe ser un número con hasta 2 decimales.' })
  @Min(0, { message: 'El descuento no puede ser negativo.' })
  @Max(50, { message: 'El descuento no puede superar el 50 %.' })
  quoteCashDiscount?: number;
}
