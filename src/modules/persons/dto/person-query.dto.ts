import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export enum PersonRoleFilter {
  CUSTOMERS = 'customers',
  SUPPLIERS = 'suppliers',
  ALL = 'all',
}

export enum PersonStatusFilter {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class PersonListQueryDto extends PageQueryDto {
  /** Busca en nombre, apellido, documento, email y teléfono. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(PersonRoleFilter)
  role: PersonRoleFilter = PersonRoleFilter.ALL;

  @IsOptional()
  @IsEnum(PersonStatusFilter)
  status: PersonStatusFilter = PersonStatusFilter.ACTIVE;
}
