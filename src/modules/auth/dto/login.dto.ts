import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'El nombre de usuario debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El usuario es un campo requerido' })
  @MaxLength(150, { message: 'El usuario es demasiado largo' })
  readonly username!: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  // Tope de longitud: evita que contraseñas gigantes consuman CPU/memoria en Argon2 (DoS).
  @MaxLength(128, { message: 'La contraseña es demasiado larga' })
  readonly password!: string;

  @IsUUID('4', { message: 'La empresa debe ser un UUID válido.' })
  @IsOptional()
  readonly tenantId?: string;
}
