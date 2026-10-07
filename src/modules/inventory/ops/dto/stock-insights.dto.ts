import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';

export class StockMatrixQueryDto extends PageQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}

export class LowStockQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

export class ReplenishmentQueryDto {
  /** Objetivo de reposición como % del mínimo (200 = llevar al doble del mínimo). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000)
  targetPercent: number = 200;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}
