import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { StockTransferStatus } from '../entities/stock-transfer.entity';

export class StockTransferLineDto {
  @IsUUID('4')
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999.999)
  quantity!: number;
}

/** POST /stock-transfers (encabezado Idempotency-Key obligatorio). */
export class CreateStockTransferDto {
  @IsUUID('4')
  originBranchId!: string;

  @IsUUID('4')
  destinationBranchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineDto)
  lines!: StockTransferLineDto[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveLineDto {
  @IsUUID('4')
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999.999)
  quantityReceived!: number;
}

/** POST /stock-transfers/:id/receive — sin líneas se recibe todo lo enviado. */
export class ReceiveStockTransferDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines?: ReceiveLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelStockTransferDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export class StockTransferQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(StockTransferStatus)
  status?: StockTransferStatus;

  /** Transferencias donde la sucursal es origen o destino. */
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}
