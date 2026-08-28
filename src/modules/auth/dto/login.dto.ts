import { IsEmail, IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class LoginDto {
    @IsEmail({}, { message: 'El correo electrónico debe ser una dirección válida' })
    @IsNotEmpty({ message: 'El email es un campo requerido' })
    readonly email!: string;

    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La contraseña es requerida' })
    @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
    readonly password!: string;

    @IsUUID('4', { message: 'El tenantId debe ser un UUID v4 válido' })
    @IsNotEmpty({ message: 'El identificador de organización (tenantId) es requerido' })
    readonly tenantId!: string;
}