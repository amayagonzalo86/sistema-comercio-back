import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
import { VatRegime } from '../../fiscal/vat/vat';

/** PATCH /platform/tenants/:tenantId/vat-regime */
export class UpdateTenantVatRegimeDto {
  @IsEnum(VatRegime, { message: 'Régimen inválido (GENERAL o TIERRA_DEL_FUEGO).' })
  defaultVatRegime!: VatRegime;
}

/** PATCH /platform/tenants/:tenantId/branches/:branchId/vat-regime — null: la sucursal usa el de la empresa. */
export class UpdateBranchVatRegimeDto {
  @ValidateIf((_, value) => value !== null)
  @IsEnum(VatRegime, { message: 'Régimen inválido (GENERAL, TIERRA_DEL_FUEGO o null para usar el de la empresa).' })
  vatRegime!: VatRegime | null;
}

/** PATCH /platform/tenants/:tenantId/display-name — nombre que se muestra en el sistema; null o vacío: el nombre de fantasía. */
export class UpdateTenantDisplayNameDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(60, { message: 'El nombre puede tener hasta 60 caracteres.' })
  displayName!: string | null;
}
