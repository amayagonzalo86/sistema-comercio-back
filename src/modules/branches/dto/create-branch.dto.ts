import {
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export class CreateBranchDto {
    @IsString({ message: 'El código de la sucursal debe ser un texto' })
    @IsNotEmpty({ message: 'El código de la sucursal es obligatorio' })
    @MinLength(2, { message: 'El código debe tener al menos 2 caracteres' })
    @MaxLength(20, { message: 'El código no puede exceder los 20 caracteres' })
    readonly code!: string;

    @IsString({ message: 'El nombre debe ser un texto' })
    @IsNotEmpty({ message: 'El nombre de la sucursal es obligatorio' })
    @MaxLength(150, { message: 'El nombre no puede exceder los 150 caracteres' })
    readonly name!: string;

    @IsString({ message: 'La dirección debe ser un texto' })
    @IsOptional()
    @MaxLength(255, { message: 'La dirección no puede exceder los 255 caracteres' })
    readonly address?: string;

    @IsString({ message: 'El teléfono debe ser un texto' })
    @IsOptional()
    @MaxLength(50, { message: 'El teléfono no puede exceder los 50 caracteres' })
    readonly phone?: string;

    @IsBoolean({ message: 'El estado debe ser un valor booleano' })
    @IsOptional()
    readonly status?: boolean;
}