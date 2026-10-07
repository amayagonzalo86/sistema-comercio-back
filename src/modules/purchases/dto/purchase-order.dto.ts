import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { PurchaseOrderStatus } from '../entities/purchase-order.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class PurchaseOrderLineDto {
  @IsUUID('4')
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999.999)
  quantity!: number;

  /** Costo unitario pactado sin IVA. Si se omite, se usa el costo actual de la sucursal. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  unitCost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID('4')
  supplierPersonId!: string;

  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

/** Solo en borrador. Las líneas enviadas reemplazan a las anteriores. */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsDateString()
  expectedDate?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines?: PurchaseOrderLineDto[];
}

export class CancelPurchaseOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class PurchaseOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsUUID('4')
  supplierPersonId?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

/** Arma un borrador con los faltantes de una sucursal (según stock mínimo). */
export class PurchaseOrderFromReplenishmentDto {
  @IsUUID('4')
  supplierPersonId!: string;

  @IsUUID('4')
  branchId!: string;

  /** Limitar a estos productos (por ejemplo, los que vende ese proveedor). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000)
  targetPercent: number = 200;
}

export class PurchaseReceiptQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  supplierPersonId?: string;

  @IsOptional()
  @IsUUID('4')
  purchaseOrderId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
