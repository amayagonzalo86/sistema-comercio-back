import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';

/**
 * Prueba de equipo (ver device-proof.ts). Dos formas:
 * - Con https: el navegador firma el desafío con su llave ECDSA no exportable (publicKey + challenge + signature).
 * - Sin https (http://IP en la red local, donde el navegador no habilita WebCrypto): `token`, un secreto aleatorio
 *   del equipo. El servidor guarda solo su huella.
 */
export class DeviceProofDto {
  /** Llave pública ECDSA P-256 en formato JWK. */
  @ValidateIf((proof: DeviceProofDto) => proof.token === undefined)
  @IsObject()
  readonly publicKey?: Record<string, unknown>;

  @ValidateIf((proof: DeviceProofDto) => proof.token === undefined)
  @IsString()
  @MaxLength(200)
  readonly challenge?: string;

  /** Firma r||s (64 bytes) en base64url. */
  @ValidateIf((proof: DeviceProofDto) => proof.token === undefined)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{60,100}$/, { message: 'Firma del equipo inválida.' })
  readonly signature?: string;

  /** Secreto aleatorio del equipo (32 bytes en base64url) cuando el navegador no tiene WebCrypto. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Identificador del equipo inválido.' })
  readonly token?: string;

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
