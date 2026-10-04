import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { SupplierPaymentMethod } from '../entities/supplier-payment.entity';

export class CreateSupplierPaymentAllocationDto {
  @IsUUID('4')
  payableId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;
}

export class CreateSupplierPaymentDto {
  @IsUUID('4')
  branchId!: string;

  @IsUUID('4')
  supplierPersonId!: string;

  @IsEnum(SupplierPaymentMethod)
  method!: SupplierPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalReference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierPaymentAllocationDto)
  allocations!: CreateSupplierPaymentAllocationDto[];
}
