import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Matches,
    MaxLength
} from 'class-validator';
import { IsIpOrCidr } from '../../../common/validators/decorators';
import { MAX_ALLOWED_IP_RANGES } from '../../../common/security/ip-allowlist';

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
    @MaxLength(30, { message: 'El teléfono debe tener como máximo 30 caracteres' })
    @Matches(/^[0-9+()\s-]+$/, { message: 'El teléfono solo admite números, espacios, +, (, ) y guiones' })
    readonly phone?: string;

    @IsOptional()
    @IsArray({ message: 'allowedIpRanges debe ser una lista' })
    @ArrayMaxSize(MAX_ALLOWED_IP_RANGES, { message: `Se admiten hasta ${MAX_ALLOWED_IP_RANGES} rangos IP` })
    @IsIpOrCidr({ each: true })
    readonly allowedIpRanges?: string[] | null;

    @IsBoolean({ message: 'El estado debe ser un valor booleano' })
    @IsOptional()
    readonly status?: boolean;
}