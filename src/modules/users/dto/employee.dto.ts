import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { IdentificationTypeEnum } from '../../../common/enums/afip.enum';
import { MembershipStatus, TenantRole } from '../../platform/entities/tenant-membership.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const emptyToNull = ({ value }: { value: unknown }): unknown => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);

/** Roles que la administración de la empresa puede asignar. El titular (OWNER) no se asigna desde acá. */
export const ASSIGNABLE_ROLES = [
  TenantRole.ADMIN,
  TenantRole.MANAGER,
  TenantRole.ACCOUNTANT,
  TenantRole.CASHIER,
  TenantRole.SELLER,
  TenantRole.INVENTORY,
  TenantRole.VIEWER,
] as const;

const DOCUMENT_TYPES = [IdentificationTypeEnum.CUIT, IdentificationTypeEnum.CUIL, IdentificationTypeEnum.DNI, IdentificationTypeEnum.PASAPORTE];

/** Contraseña fuerte: 10 a 128 caracteres con mayúsculas, minúsculas y números. */
export const PASSWORD_RULES = {
  min: 10,
  max: 128,
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
  message: 'La contraseña debe tener al menos 10 caracteres y combinar mayúsculas, minúsculas y números.',
};

class EmployeePersonFields {
  @IsOptional()
  @IsIn(DOCUMENT_TYPES, { message: 'Tipo de documento inválido (80 CUIT, 86 CUIL, 96 DNI, 94 Pasaporte).' })
  documentType?: IdentificationTypeEnum | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @Matches(/^[0-9A-Za-z.-]{5,20}$/, { message: 'El número de documento tiene un formato inválido.' })
  nationalId?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim().toLowerCase()) : value))
  @ValidateIf((_, value) => value !== null)
  @IsEmail({}, { message: 'El email no es válido.' })
  @MaxLength(150)
  email?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @MaxLength(30)
  @Matches(/^[0-9+()\s-]+$/, { message: 'El teléfono solo admite números, espacios, +, (, ) y guiones.' })
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(255)
  address?: string | null;
}

/** POST /employees — alta de un empleado: datos personales + usuario + roles en un solo paso. */
export class CreateEmployeeDto extends EmployeePersonFields {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(100)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres.' })
  @MaxLength(100)
  lastName!: string;

  @Transform(lower)
  @IsString()
  @MinLength(4, { message: 'El usuario debe tener al menos 4 caracteres.' })
  @MaxLength(50)
  @Matches(/^[a-z0-9_.-]+$/, { message: 'El usuario solo admite letras minúsculas, números, puntos, guiones y guion bajo.' })
  username!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.min, { message: PASSWORD_RULES.message })
  @MaxLength(PASSWORD_RULES.max)
  @Matches(PASSWORD_RULES.pattern, { message: PASSWORD_RULES.message })
  password!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Asigná al menos un rol.' })
  @ArrayMaxSize(ASSIGNABLE_ROLES.length)
  @ArrayUnique()
  @IsIn(ASSIGNABLE_ROLES, { each: true, message: 'Rol inválido. El rol de titular no se asigna desde la administración.' })
  roles!: TenantRole[];

  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

/** PATCH /employees/:id — todos los campos son opcionales; branchId: null quita la sucursal. */
export class UpdateEmployeeDto extends EmployeePersonFields {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Transform(lower)
  @IsString()
  @MinLength(4)
  @MaxLength(50)
  @Matches(/^[a-z0-9_.-]+$/, { message: 'El usuario solo admite letras minúsculas, números, puntos, guiones y guion bajo.' })
  username?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Asigná al menos un rol.' })
  @ArrayMaxSize(ASSIGNABLE_ROLES.length + 1)
  @ArrayUnique()
  @IsEnum(TenantRole, { each: true })
  roles?: TenantRole[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  branchId?: string | null;
}

/** POST /employees/:id/password — la administración define una contraseña nueva. */
export class ResetEmployeePasswordDto {
  @IsString()
  @MinLength(PASSWORD_RULES.min, { message: PASSWORD_RULES.message })
  @MaxLength(PASSWORD_RULES.max)
  @Matches(PASSWORD_RULES.pattern, { message: PASSWORD_RULES.message })
  newPassword!: string;
}

/** POST /auth/change-password — cada usuario cambia su propia contraseña. */
export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(1, { message: 'Ingresá tu contraseña actual.' })
  @MaxLength(PASSWORD_RULES.max)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.min, { message: PASSWORD_RULES.message })
  @MaxLength(PASSWORD_RULES.max)
  @Matches(PASSWORD_RULES.pattern, { message: PASSWORD_RULES.message })
  newPassword!: string;
}

export class EmployeeQueryDto extends PageQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsIn([MembershipStatus.ACTIVE, MembershipStatus.SUSPENDED, 'ALL'])
  status?: MembershipStatus.ACTIVE | MembershipStatus.SUSPENDED | 'ALL';

  @IsOptional()
  @IsEnum(TenantRole)
  role?: TenantRole;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}
