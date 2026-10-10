import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/** Período en fechas locales AAAA-MM-DD (inclusive). Por defecto: últimos 30 días. */
export class ReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

export enum TopProductsSort {
  REVENUE = 'revenue',
  QUANTITY = 'quantity',
  MARGIN = 'margin',
}

export class TopProductsQueryDto extends ReportQueryDto {
  @IsOptional()
  @IsEnum(TopProductsSort)
  sort: TopProductsSort = TopProductsSort.REVENUE;

  /** desc = más vendidos; asc = menos vendidos (entre los que tuvieron ventas). */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;
}

export class DeadStockQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  /** Días sin ventas para considerar un producto inmovilizado. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days: number = 60;
}
