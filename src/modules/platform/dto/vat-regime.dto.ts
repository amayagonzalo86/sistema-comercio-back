import { IsEnum, ValidateIf } from 'class-validator';
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
