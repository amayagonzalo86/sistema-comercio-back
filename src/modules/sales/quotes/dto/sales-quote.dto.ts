import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { CreateSaleLineDto } from '../../dto/create-sale.dto';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** POST /sales-quotes — presupuesto X (válido 24 h, no es factura). */
export class CreateSalesQuoteDto {
  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @IsUUID('4')
  customerPersonId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleLineDto)
  lines!: CreateSaleLineDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;

  /** Lista de precios (si no se indica, la principal). */
  @IsOptional()
  @IsUUID('4')
  priceListId?: string;
}

export class SalesQuoteQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  /** Vigentes (por defecto), un estado del historial o todos. */
  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'CONVERTED', 'DISCARDED', 'ALL'])
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'DISCARDED' | 'ALL' = 'ACTIVE';
}
