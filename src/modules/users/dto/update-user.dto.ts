import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['personId'] as const),
) {
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsOptional()
  readonly password?: string;

  @IsBoolean({ message: 'El estado isActive debe ser un valor booleano' })
  @IsOptional()
  readonly isActive?: boolean;
}