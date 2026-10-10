import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { VoucherClass } from '../../fiscal/vat/vat';
import { SalePaymentMethod } from '../entities/sale-payment.entity';
import { SaleReturnStatus } from '../entities/sale.entity';

/** GET /sales — filtros del listado de ventas. Fechas en formato AAAA-MM-DD (inclusive). */
export class SaleQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  customerPersonId?: string;

  @IsOptional()
  @IsUUID('4')
  sellerUserId?: string;

  @IsOptional()
  @IsEnum(SalePaymentMethod)
  paymentMethod?: SalePaymentMethod;

  @IsOptional()
  @IsEnum(VoucherClass)
  voucherClass?: VoucherClass;

  @IsOptional()
  @IsEnum(SaleReturnStatus)
  returnStatus?: SaleReturnStatus;
}
