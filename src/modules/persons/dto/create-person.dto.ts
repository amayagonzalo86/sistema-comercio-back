import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PersonType } from '../entities/person.entity';
import { IdentificationTypeEnum, TaxConditionEnum } from '../../../common/enums/afip.enum';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

const DOCUMENT_TYPES = [
  IdentificationTypeEnum.CUIT,
  IdentificationTypeEnum.CUIL,
  IdentificationTypeEnum.DNI,
  IdentificationTypeEnum.PASAPORTE,
  IdentificationTypeEnum.CONSUMIDOR_FINAL,
];

/**
 * Alta de clientes/proveedores.
 * La coherencia documento ↔ condición de IVA (por ejemplo, un Responsable Inscripto necesita CUIT válida)
 * se valida en PersonsService para devolver un mensaje claro.
 */
export class CreatePersonDto {
  @IsOptional()
  @IsEnum(PersonType)
  personType?: PersonType;

  @Transform(trim)
  @IsString({ message: 'El nombre o razón social debe ser texto' })
  @IsNotEmpty({ message: 'El nombre o razón social no puede estar vacío' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, { message: 'El nombre admite hasta 100 caracteres' })
  firstName!: string;

  @Transform(trim)
  @IsString({ message: 'El apellido debe ser texto' })
  @IsNotEmpty({ message: 'El apellido no puede estar vacío (para empresas repetí la razón social o usá "-")' })
  @MaxLength(100, { message: 'El apellido admite hasta 100 caracteres' })
  lastName!: string;

  @IsOptional()
  @IsIn(DOCUMENT_TYPES, { message: 'Tipo de documento inválido (80 CUIT, 86 CUIL, 96 DNI, 94 Pasaporte, 99 Sin identificar)' })
  documentType?: IdentificationTypeEnum | null;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'El número de documento debe ser texto' })
  @Matches(/^[0-9A-Za-z.-]{5,20}$/, { message: 'El número de documento tiene un formato inválido' })
  nationalId?: string | null;

  @IsOptional()
  @IsEnum(TaxConditionEnum, { message: 'Condición frente al IVA inválida' })
  vatCondition?: TaxConditionEnum;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(150)
  email?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9+()\s-]+$/, { message: 'El teléfono solo admite números, espacios, +, (, ) y guiones' })
  phone?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  address?: string | null;
}
