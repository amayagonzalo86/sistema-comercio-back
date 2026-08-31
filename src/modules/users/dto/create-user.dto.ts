import { ArrayMinSize, IsArray,  IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

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

  @IsArray({ message: 'Los IDs de roles deben enviarse en un arreglo' })
  @ArrayMinSize(1, { message: 'Debe asignar al menos un rol al usuario' })
  @IsUUID('4', {
    each: true,
    message: 'Cada ID de rol debe ser un UUID v4 válido',
  })
  readonly roleIds!: string[];

  @IsUUID('4', { message: 'El ID de la persona debe ser un UUID v4 válido' })
  @IsNotEmpty({ message: 'El ID de la persona es obligatorio' })
  readonly personId!: string;

  @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID v4 válido' })
  @IsOptional()
  readonly branchId?: string;
}