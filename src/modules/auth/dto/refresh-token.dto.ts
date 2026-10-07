import { IsJWT, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Opcional: los navegadores envían el refresh token en la cookie HttpOnly.
 * El cuerpo solo se usa en clientes nativos que no manejan cookies.
 */
export class RefreshTokenDto {
    @IsOptional()
    @IsString({ message: 'El token de refresco debe ser una cadena válida' })
    @MaxLength(2048)
    @IsJWT({ message: 'El token de refresco no tiene un formato válido' })
    readonly refreshToken?: string;
}
