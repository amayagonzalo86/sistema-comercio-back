import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @IsEmail({}, { message: 'Formato de correo inválido' })
  @IsNotEmpty()
  readonly email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  readonly password!: string;

  @IsString()
  @IsNotEmpty()
  readonly firstName!: string;

  @IsString()
  @IsNotEmpty()
  readonly lastName!: string;

  @IsEnum(UserRole)
  readonly role!: UserRole;
}
