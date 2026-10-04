import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

  // Cost before the tax rate configured on the product; this is an internal stock valuation input.
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

  @IsUUID('4')
  supplierPersonId!: string;

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
