import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

export enum CashManualMovementType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum CashManualMovementDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export class CreateCashMovementDto {
  @IsEnum(CashManualMovementType)
  type!: CashManualMovementType;

  @IsEnum(CashManualMovementDirection)
  direction!: CashManualMovementDirection;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})\.\d{2}$/, {
    message: 'El importe debe expresarse como cadena decimal con exactamente dos decimales.',
  })
  amount!: string;

  @IsString()
  @Length(1, 240)
  @Matches(/\S/, { message: 'El motivo no puede estar vacío.' })
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  externalReference?: string;
}
