import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { CashSessionStatus } from '../entities/cash-session.entity';

/** Historial de cajas: filtros por sucursal, caja, estado y fecha de apertura (AAAA-MM-DD). */
export class CashSessionQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  registerId?: string;

  @IsOptional()
  @IsEnum(CashSessionStatus)
  status?: CashSessionStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha desde debe tener el formato AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha hasta debe tener el formato AAAA-MM-DD.' })
  to?: string;
}
