import { IsString, Matches } from 'class-validator';

export class CloseCashSessionDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, {
    message: 'El efectivo contado debe ser un importe decimal no negativo con hasta dos decimales.',
  })
  countedAmount!: string;
}
