import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { CashReportType } from '../entities/cash-session-report.entity';

/** Buscador de cierres X/Z: tipo, número, caja, sucursal y fecha (AAAA-MM-DD). */
export class CashReportQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(CashReportType)
  type?: CashReportType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99999999)
  number?: number;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  registerId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha desde debe tener el formato AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha hasta debe tener el formato AAAA-MM-DD.' })
  to?: string;
}
