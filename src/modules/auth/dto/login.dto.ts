import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** Prueba de equipo: el navegador firma el desafío con su llave (ver device-proof.ts). */
export class DeviceProofDto {
  /** Llave pública ECDSA P-256 en formato JWK. */
  @IsObject()
  readonly publicKey!: Record<string, unknown>;

  @IsString()
  @MaxLength(200)
  readonly challenge!: string;

  /** Firma r||s (64 bytes) en base64url. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{60,100}$/, { message: 'Firma del equipo inválida.' })
  readonly signature!: string;

  /** Nombre que el local le da al equipo (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  readonly name?: string;
}

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

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceProofDto)
  readonly device?: DeviceProofDto;
}
