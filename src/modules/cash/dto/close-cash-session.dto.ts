import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Cierre Z: efectivo contado (arqueo) y observaciones. */
export class CloseCashSessionDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, {
    message: 'El efectivo contado debe ser un importe decimal no negativo con hasta dos decimales.',
  })
  countedAmount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Cierre X: informe parcial; el arqueo es opcional y la caja sigue abierta. */
export class CashXReportDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, {
    message: 'El efectivo contado debe ser un importe decimal no negativo con hasta dos decimales.',
  })
  countedAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
