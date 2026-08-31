import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'El nombre de usuario debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El usuario es un campo requerido' })
  readonly username!: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  readonly password!: string;

}