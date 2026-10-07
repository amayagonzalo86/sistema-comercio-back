import { IsString, Matches } from 'class-validator';

export class OpenCashSessionDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código ISO 4217 en mayúsculas.' })
  currency!: string;

  // Decimal strings avoid IEEE-754 rounding in accounting amounts.
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, {
    message: 'El fondo inicial debe ser un importe decimal no negativo con hasta dos decimales.',
  })
  openingAmount!: string;
}
