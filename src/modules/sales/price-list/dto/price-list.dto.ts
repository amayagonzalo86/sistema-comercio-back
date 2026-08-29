import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class ProductPriceOverrideDto {
    @IsUUID('4', { message: 'El productId debe ser un UUID v4 válido.' })
    readonly productId!: string;

    @IsNumber({}, { message: 'El porcentaje aplicado debe ser numérico.' })
    @Min(0, { message: 'El porcentaje aplicado no puede ser negativo.' })
    readonly appliedPercentage!: number;
}

export class CreatePriceListDto {
    @IsString({ message: 'El nombre de la lista es obligatorio.' })
    readonly name!: string;

    @IsString()
    @IsOptional()
    readonly description?: string;

    @IsNumber()
    @Min(0)
    readonly percentage!: number;

    @IsBoolean()
    @IsOptional()
    readonly isDefault?: boolean;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => ProductPriceOverrideDto)
    readonly productOverrides?: ProductPriceOverrideDto[];
}