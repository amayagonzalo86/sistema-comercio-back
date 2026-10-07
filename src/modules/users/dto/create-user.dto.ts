import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  // El login compara en minúsculas: se normaliza al guardar para que el usuario pueda ingresar.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(4, { message: 'El nombre de usuario debe tener al menos 4 caracteres' })
  @MaxLength(50, { message: 'El nombre de usuario admite hasta 50 caracteres' })
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message:
      'El nombre de usuario solo puede contener letras, números, guiones y puntos',
  })
  @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
  readonly username!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @MaxLength(128, { message: 'La contraseña admite hasta 128 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'La contraseña debe combinar mayúsculas, minúsculas y números',
  })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  readonly password!: string;

  @IsArray({ message: 'Los IDs de roles deben enviarse en un arreglo' })
  @ArrayMinSize(1, { message: 'Debe asignar al menos un rol al usuario' })
  @ArrayMaxSize(1, { message: 'Cada usuario debe tener un único rol por empresa' })
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