import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { RequestAuditContext } from '../../common/http/request-context';
import { BranchEntity } from '../branches/entities/branch.entity';
import { resolveVatRegime, VatRegime } from '../fiscal/vat/vat';
import { TenantEntity } from './entities/tenant.entity';

export interface PlatformTenantVatView {
  id: string;
  slug: string;
  legalName: string;
  tradeName: string | null;
  status: string;
  defaultVatRegime: VatRegime;
  branches: Array<{ id: string; code: string; name: string; status: boolean; vatRegime: VatRegime | null; effectiveVatRegime: VatRegime }>;
}

/**
 * Configuración fiscal que administra la plataforma (no la empresa): régimen de IVA por defecto de cada
 * empresa y, si hace falta, por sucursal (por ejemplo, locales en Tierra del Fuego y en el continente).
 * Cada cambio queda en la auditoría de la empresa (figura como "Soporte de la plataforma").
 */
@Injectable()
export class PlatformVatService {
  constructor(private readonly dataSource: DataSource) {}

  async list(): Promise<PlatformTenantVatView[]> {
    const [tenants, branches] = await Promise.all([
      this.dataSource.getRepository(TenantEntity).find({ order: { legalName: 'ASC' } }),
      this.dataSource.getRepository(BranchEntity).find({
        select: { id: true, tenantId: true, code: true, name: true, status: true, vatRegime: true },
        order: { name: 'ASC' },
      }),
    ]);
    return tenants.map((tenant) => this.view(tenant, branches.filter((branch) => branch.tenantId === tenant.id)));
  }

  async setTenantRegime(tenantId: string, regime: VatRegime, actorUserId: string, context: RequestAuditContext): Promise<PlatformTenantVatView> {
    await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('La empresa no existe.');
      const before = tenant.defaultVatRegime;
      if (before === regime) return;
      await manager.update(TenantEntity, { id: tenantId }, { defaultVatRegime: regime });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'VAT_REGIME_CHANGED',
        aggregateType: 'TENANT',
        aggregateId: tenantId,
        metadata: { scope: 'TENANT', before, after: regime },
        context,
      });
    });
    return this.one(tenantId);
  }

  async setBranchRegime(
    tenantId: string,
    branchId: string,
    regime: VatRegime | null,
    actorUserId: string,
    context: RequestAuditContext,
  ): Promise<PlatformTenantVatView> {
    await this.dataSource.transaction(async (manager) => {
      const branch = await manager.findOne(BranchEntity, { where: { id: branchId, tenantId } });
      if (!branch) throw new NotFoundException('La sucursal no existe en esa empresa.');
      const before = branch.vatRegime ?? null;
      if (before === regime) return;
      await manager.update(BranchEntity, { id: branchId }, { vatRegime: regime });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'VAT_REGIME_CHANGED',
        aggregateType: 'BRANCH',
        aggregateId: branchId,
        metadata: { scope: 'BRANCH', branch: branch.name, before, after: regime },
        context,
      });
    });
    return this.one(tenantId);
  }

  private async one(tenantId: string): Promise<PlatformTenantVatView> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    const branches = await this.dataSource.getRepository(BranchEntity).find({
      where: { tenantId },
      select: { id: true, tenantId: true, code: true, name: true, status: true, vatRegime: true },
      order: { name: 'ASC' },
    });
    return this.view(tenant, branches);
  }

  private view(tenant: TenantEntity, branches: BranchEntity[]): PlatformTenantVatView {
    return {
      id: tenant.id,
      slug: tenant.slug,
      legalName: tenant.legalName,
      tradeName: tenant.tradeName ?? null,
      status: tenant.status,
      defaultVatRegime: tenant.defaultVatRegime,
      branches: branches.map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        status: branch.status,
        vatRegime: branch.vatRegime ?? null,
        effectiveVatRegime: resolveVatRegime(tenant.defaultVatRegime, branch.vatRegime),
      })),
    };
  }
}
