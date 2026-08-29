import {
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Matches
} from 'class-validator';

export class CreateBranchDto {
    @IsString({ message: 'El código debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El código de la sucursal es obligatorio' })
    @Length(3, 10, { message: 'El código debe tener entre 3 y 10 caracteres' })
    @Matches(/^[A-Z0-9-]+$/, {
        message: 'El código solo puede contener letras mayúsculas, números y guiones',
    })
    readonly code!: string;

    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre de la sucursal es obligatorio' })
    @Length(3, 100, { message: 'El nombre debe tener entre 3 y 100 caracteres' })
    readonly name!: string;

    @IsString({ message: 'La dirección debe ser una cadena de texto' })
    @IsOptional()
    @Length(5, 255, { message: 'La dirección debe tener entre 5 y 255 caracteres' })
    readonly address?: string;

    @IsString({ message: 'El teléfono debe ser una cadena de texto' })
    @IsOptional()
    readonly phone?: string;

    @IsBoolean({ message: 'El estado debe ser un valor booleano' })
    @IsOptional()
    readonly status?: boolean;
}