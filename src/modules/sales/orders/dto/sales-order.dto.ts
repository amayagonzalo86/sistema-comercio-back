import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { CreateSaleLineDto } from '../../dto/create-sale.dto';
import { SalesOrderStatus } from '../entities/sales-order.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * POST /sales-orders — el vendedor arma el pedido (preventa). No descuenta stock ni mueve caja:
 * el cliente lo paga en caja con el número de pedido y recién ahí se registra la venta.
 */
export class CreateSalesOrderDto {
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
}

/** GET /sales-orders — cola de pedidos (por defecto los más recientes primero). */
export class SalesOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(SalesOrderStatus)
  status?: SalesOrderStatus;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  sellerUserId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4_294_967_295)
  number?: number;
}

/** POST /sales-orders/:id/cancel */
export class CancelSalesOrderDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Indicá el motivo de la anulación (mínimo 3 caracteres).' })
  @MaxLength(200)
  reason!: string;
}
