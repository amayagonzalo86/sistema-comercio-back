import { EntityManager } from 'typeorm';
import { IdentificationTypeEnum, TaxConditionEnum } from '../../common/enums/afip.enum';
import { BranchEntity } from '../branches/entities/branch.entity';
import { FiscalProfileEntity } from '../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { PersonEntity } from '../persons/entities/person.entity';

/**
 * Encabezado de la empresa que se imprime en facturas, remitos y presupuestos (RG 1415):
 * razón social, domicilio comercial, condición frente al IVA, CUIT, Ingresos Brutos e inicio de actividades.
 * Si la sucursal tiene domicilio propio, se imprime el del local donde se hizo la operación.
 */
export interface Letterhead {
  /** Nombre de fantasía (o la razón social si no tiene). */
  name: string;
  legalName: string;
  branchName: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  vatCondition: string | null;
  cuit: string | null;
  grossIncomeRegistration: string | null;
  activityStartDate: string | null;
}

/** Datos del cliente para el bloque "Señor / Dirección / IVA / DNI" del comprobante. */
export interface PrintCustomer {
  id: string;
  accountNumber: number | null;
  /** "Apellido Nombre" de una persona o la razón social de una empresa. */
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  vatCondition: TaxConditionEnum;
  documentType: IdentificationTypeEnum | null;
  nationalId: string | null;
}

const blank = (value: string | null | undefined): string | null => (value && value.trim() ? value.trim() : null);

/** "Apellido Nombre" para personas; razón social sola cuando el apellido es "-" (alta con CUIT). */
export function printableName(firstName: string, lastName: string | null | undefined): string {
  const last = blank(lastName);
  return last && last !== '-' ? `${last} ${firstName}`.trim() : firstName.trim();
}

export async function loadLetterhead(
  manager: EntityManager,
  tenantId: string,
  branchId: string | null,
  profileOverride?: FiscalProfileEntity | null,
): Promise<Letterhead> {
  const [tenant, profile, branch] = await Promise.all([
    manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, legalName: true, tradeName: true, taxId: true } }),
    profileOverride !== undefined
      ? Promise.resolve(profileOverride)
      : manager.findOne(FiscalProfileEntity, { where: { tenantId, isActive: true }, order: { updatedAt: 'DESC' } }),
    branchId ? manager.findOne(BranchEntity, { where: { id: branchId, tenantId } }) : Promise.resolve(null),
  ]);
  const legalName = profile?.legalName ?? tenant?.legalName ?? '';
  const branchAddress = blank(branch?.address);
  return {
    name: blank(tenant?.tradeName) ?? legalName,
    legalName,
    branchName: branch?.name ?? null,
    address: branchAddress ?? blank(profile?.commercialAddress),
    city: branchAddress ? blank(branch?.city) : blank(profile?.commercialCity),
    province: branchAddress ? blank(branch?.province) : blank(profile?.commercialProvince),
    phone: blank(branch?.phone) ?? blank(profile?.phone),
    vatCondition: profile?.vatConditionCode ?? null,
    cuit: profile?.taxId ?? tenant?.taxId ?? null,
    grossIncomeRegistration: blank(profile?.grossIncomeRegistration),
    activityStartDate: profile?.activityStartDate ?? null,
  };
}

export function toPrintCustomer(person: PersonEntity): PrintCustomer {
  return {
    id: person.id,
    accountNumber: person.accountNumber ?? null,
    name: printableName(person.firstName, person.lastName),
    address: blank(person.address),
    city: blank(person.city),
    province: blank(person.province),
    vatCondition: person.vatCondition,
    documentType: person.documentType ?? null,
    nationalId: person.nationalId ?? null,
  };
}

export async function loadPrintCustomer(manager: EntityManager, tenantId: string, personId: string | null | undefined): Promise<PrintCustomer | null> {
  if (!personId) return null;
  const person = await manager.findOne(PersonEntity, { where: { id: personId, tenantId } });
  return person ? toPrintCustomer(person) : null;
}
