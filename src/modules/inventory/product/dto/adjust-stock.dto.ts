import { IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';

export class AdjustStockDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-999999999.999)
  @Max(999999999.999)
  @NotEquals(0)
  quantityDelta!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}
