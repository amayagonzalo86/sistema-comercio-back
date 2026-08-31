import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @IsString()
  @MinLength(4, { message: 'El nombre de usuario debe tener al menos 4 caracteres' })
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message:
      'El nombre de usuario solo puede contener letras, números, guiones y puntos',
  })
  @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
  readonly username!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  readonly password!: string;

  @IsEnum(UserRole, { message: 'El rol especificado no es válido' })
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  readonly role!: UserRole;

  @IsUUID('4', { message: 'El ID de la persona debe ser un UUID v4 válido' })
  @IsNotEmpty({ message: 'El ID de la persona es obligatorio' })
  readonly personId!: string;

  @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID v4 válido' })
  @IsOptional()
  readonly branchId?: string;
}