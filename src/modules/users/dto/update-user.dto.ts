import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MinLength(4, { message: 'El nombre de usuario debe tener al menos 4 caracteres' })
  @IsOptional()
  readonly username?: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsOptional()
  readonly password?: string;

  @IsArray({ message: 'Los IDs de roles deben enviarse en un arreglo' })
  @ArrayMinSize(1, { message: 'Debe asignar al menos un rol al usuario' })
  @IsUUID('4', {
    each: true,
    message: 'Cada ID de rol debe ser un UUID v4 válido',
  })
  @IsOptional()
  readonly roleIds?: string[];

  @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID v4 válido' })
  @IsOptional()
  readonly branchId?: string | null;

  @IsBoolean({ message: 'El estado isActive debe ser un valor booleano' })
  @IsOptional()
  readonly isActive?: boolean;
}