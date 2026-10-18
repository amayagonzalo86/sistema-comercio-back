import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Cierre Z: el arqueo es opcional. Sin efectivo contado, el Z sale sin contado ni diferencia y el arqueo
 * se registra después (por ejemplo, contando en la oficina) con POST /cash/sessions/:id/count.
 */
export class CloseCashSessionDto {
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

/** Arqueo posterior de una caja cerrada con Z sin arqueo. */
export class CashCountDto {
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
