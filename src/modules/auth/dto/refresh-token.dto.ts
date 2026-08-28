import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
    @IsString({ message: 'El token de refresco debe ser una cadena válida' })
    @IsNotEmpty({ message: 'El token de refresco es requerido' })
    readonly refreshToken!: string;
}