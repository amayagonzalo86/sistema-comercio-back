import { Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseReceiptLineDto {
  @IsUUID('4')
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999.999)
  quantity!: number;

  // Cost before tax; taxRate is transcribed from the supplier document for internal accounting.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  unitCost!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate!: number;
}

export class CreatePurchaseReceiptDto {
  @IsUUID('4')
  branchId!: string;

  /** Pedido de compra que esta recepción cumple (total o parcialmente). */
  @IsOptional()
  @IsUUID('4')
  purchaseOrderId?: string;

  /**
   * true: si el costo cambia, el precio de venta se recalcula manteniendo el margen de cada producto
   * (queda en el historial de precios).
   */
  @IsOptional()
  @IsBoolean()
  updateSellingPrices?: boolean;

  @IsUUID('4')
  supplierPersonId!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceDocumentNumber?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReceiptLineDto)
  lines!: CreatePurchaseReceiptLineDto[];
}
