import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { UnitOfMeasure } from '../entities/product.entity';

export class BranchPriceStockDto {
    @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID válido' })
    @IsNotEmpty({ message: "la id de la sucursal es obligatorio" })
    readonly branchId!: string;

    @IsNumber({}, { message: 'El precio de costo debe ser numérico' })
    @Min(0, { message: 'El precio de costo no puede ser negativo' })
    readonly costPrice!: number;
    
    @IsNumber({}, { message: 'El margen de ganancia debe ser numérico' })
    @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
    readonly profitMargin!: number;

    @IsNumber({}, { message: 'El precio de venta debe ser numérico' })
    @Min(0, { message: 'El precio de venta no puede ser negativo' })
    readonly sellingPrice!: number;

    @IsNumber({}, { message: 'El stock debe ser numérico' })
    @Min(0, { message: 'El stock no puede ser negativo' })
    readonly stock!: number;

    @IsNumber({}, { message: 'El stock mínimo debe ser numérico' })
    @Min(0, { message: 'El stock mínimo no puede ser negativo' })
    readonly minStock!: number;

    @IsBoolean()
    @IsOptional()
    readonly isActive?: boolean = true;
}

export class CreateProductDto {
    @IsString({ message: 'El SKU es obligatorio' })
    @IsNotEmpty({ message: "El id del producto no puede ser vacio" })
    readonly sku!: string;

    @IsString()
    @IsOptional()
    readonly barcode?: string;

    @IsString({ message: 'El nombre del producto es obligatorio' })
    @IsNotEmpty({ message: "El nombre no puede ser vacio" })
    readonly name!: string;

    @IsString()
    @IsOptional()
    readonly description?: string;

    @IsString()
    @IsOptional()
    readonly category?: string;

    @IsString()
    @IsOptional()
    readonly brand?: string;

    @IsEnum(UnitOfMeasure, { message: 'Unidad de medida no válida' })
    @IsOptional()
    readonly unitOfMeasure?: UnitOfMeasure = UnitOfMeasure.UNIT;

    @IsNumber({}, { message: 'La tasa de impuesto debe ser numérica' })
    @Min(0)
    @IsOptional()
    readonly taxRate?: number = 21.00;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BranchPriceStockDto)
    readonly branchSettings!: BranchPriceStockDto[];
}