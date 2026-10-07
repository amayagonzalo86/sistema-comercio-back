import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { UnitOfMeasure } from '../entities/product.entity';
import { ALLOWED_VAT_PERCENTAGES, VatTreatment } from '../../../fiscal/vat/vat';

export class BranchPriceStockDto {
    @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID válido' })
    @IsNotEmpty({ message: "la id de la sucursal es obligatorio" })
    readonly branchId!: string;

    @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio de costo debe ser numérico con hasta 2 decimales' })
    @Min(0, { message: 'El precio de costo no puede ser negativo' })
    @Max(9999999999.99)
    readonly costPrice!: number;
    
    @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El margen de ganancia debe ser numérico' })
    @Min(0, { message: 'El margen de ganancia no puede ser negativo' })
    @Max(999.99)
    readonly profitMargin!: number;

    @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El precio de venta debe ser numérico con hasta 2 decimales' })
    @Min(0, { message: 'El precio de venta no puede ser negativo' })
    @Max(9999999999.99)
    readonly sellingPrice!: number;

    @IsNumber({ maxDecimalPlaces: 3 }, { message: 'El stock debe ser numérico con hasta 3 decimales' })
    @Min(0, { message: 'El stock no puede ser negativo' })
    @Max(999999999.999)
    readonly stock!: number;

    @IsNumber({ maxDecimalPlaces: 3 }, { message: 'El stock mínimo debe ser numérico con hasta 3 decimales' })
    @Min(0, { message: 'El stock mínimo no puede ser negativo' })
    @Max(999999999.999)
    readonly minStock!: number;

    @IsBoolean()
    @IsOptional()
    readonly isActive?: boolean = true;
}

export class CreateProductDto {
    @IsString({ message: 'El SKU es obligatorio' })
    @IsNotEmpty({ message: "El id del producto no puede ser vacio" })
    @MaxLength(50)
    readonly sku!: string;

    @IsString()
    @IsOptional()
    @MaxLength(100)
    readonly barcode?: string;

    @IsString({ message: 'El nombre del producto es obligatorio' })
    @IsNotEmpty({ message: "El nombre no puede ser vacio" })
    @MaxLength(150)
    readonly name!: string;

    @IsString()
    @IsOptional()
    @MaxLength(2000)
    readonly description?: string;

    @IsString()
    @IsOptional()
    @MaxLength(80)
    readonly category?: string;

    @IsString()
    @IsOptional()
    @MaxLength(80)
    readonly brand?: string;

    @IsEnum(UnitOfMeasure, { message: 'Unidad de medida no válida' })
    @IsOptional()
    readonly unitOfMeasure?: UnitOfMeasure = UnitOfMeasure.UNIT;

    @IsOptional()
    @IsIn(ALLOWED_VAT_PERCENTAGES as number[], {
        message: `La alícuota de IVA debe ser una de: ${ALLOWED_VAT_PERCENTAGES.join(', ')}`,
    })
    readonly taxRate?: number;

    @IsOptional()
    @IsEnum(VatTreatment, { message: 'El tratamiento de IVA debe ser TAXED, EXEMPT o NOT_TAXED' })
    readonly vatTreatment?: VatTreatment;

    @IsOptional()
    @IsBoolean({ message: 'priceIncludesVat debe ser verdadero o falso' })
    readonly priceIncludesVat?: boolean;

    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => BranchPriceStockDto)
    readonly branchSettings!: BranchPriceStockDto[];
}