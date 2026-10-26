import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantModuleEntity } from '../../modules/platform/entities/tenant-module.entity';
import { localToday } from '../../modules/reports/domain/period';
import { DEFAULT_TIME_ZONE } from '../time/local-day-range';

/**
 * Módulos que se venden aparte del plan base. El plan base incluye todo lo demás: punto de venta, facturación ARCA,
 * caja con cierres X/Z, catálogo, listas de precios y etiquetas, control de mercadería (stock mínimo, reposición,
 * valorización), multisucursal y transferencias, compras y proveedores, preventa, tablero y reportes, clientes,
 * presupuestos X, tarjetas y cuotas, empleados y auditoría.
 */
export enum TenantModule {
  /** Promociones (se aplican al vender) y fidelización de clientes. */
  MARKETING = 'MARKETING',
}

export const ALL_TENANT_MODULES = Object.values(TenantModule);

export const TENANT_MODULE_INFO: Record<TenantModule, { name: string; description: string }> = {
  [TenantModule.MARKETING]: {
    name: 'Marketing y fidelización',
    description: 'Promociones que se aplican solas al vender (3x2, porcentajes, por día) y análisis de clientes.',
  },
};

export const TENANT_MODULE_METADATA = 'tenantModule';

/**
 * Exige que la empresa tenga contratado el módulo (en el controlador o en un método). Lo verifica
 * TenantContextGuard con la empresa del token, así que vale también para quien llama a la API directamente.
 */
export const RequiresModule = (module: TenantModule) => SetMetadata(TENANT_MODULE_METADATA, module);

/** Mensaje para el usuario; `details` lleva el código para que el frontend muestre «Módulo no contratado». */
export function moduleNotEnabled(module: TenantModule): ForbiddenException {
  return new ForbiddenException(
    `Tu plan no incluye «${TENANT_MODULE_INFO[module].name}». Pedile al proveedor del sistema que lo active.`,
    { description: `MODULE_NOT_ENABLED:${module}` },
  );
}

/** Módulos activos y vigentes (sin vencer) de una empresa, según la fecha local de la empresa. */
export async function enabledTenantModules(manager: EntityManager, tenantId: string, timeZone?: string | null): Promise<TenantModule[]> {
  const today = localToday(timeZone || DEFAULT_TIME_ZONE);
  const rows = await manager.find(TenantModuleEntity, { where: { tenantId, enabled: true }, select: { module: true, validUntil: true } });
  return rows
    .filter((row) => !row.validUntil || String(row.validUntil).slice(0, 10) >= today)
    .map((row) => row.module)
    .filter((module): module is TenantModule => ALL_TENANT_MODULES.includes(module));
}

export async function hasTenantModule(manager: EntityManager, tenantId: string, module: TenantModule, timeZone?: string | null): Promise<boolean> {
  return (await enabledTenantModules(manager, tenantId, timeZone)).includes(module);
}

export async function assertTenantModule(manager: EntityManager, tenantId: string, module: TenantModule, timeZone?: string | null): Promise<void> {
  if (!(await hasTenantModule(manager, tenantId, module, timeZone))) throw moduleNotEnabled(module);
}
