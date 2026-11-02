import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { RequestAuditContext } from '../../common/http/request-context';
import { TenantEntity } from './entities/tenant.entity';
import { deleteTenantLogo, saveTenantLogo, tenantLogoUrl } from './tenant-logo';

export interface TenantBrandingView {
  tenantId: string;
  legalName: string;
  tradeName: string | null;
  displayName: string | null;
  logoUrl: string | null;
}

/** Identidad visual de la empresa: logo (lo cambian la administración de la empresa o la plataforma). */
@Injectable()
export class TenantBrandingService {
  constructor(private readonly dataSource: DataSource) {}

  async view(tenantId: string): Promise<TenantBrandingView> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    return {
      tenantId: tenant.id,
      legalName: tenant.legalName,
      tradeName: tenant.tradeName ?? null,
      displayName: tenant.displayName ?? null,
      logoUrl: tenantLogoUrl(tenant.logoPath),
    };
  }

  async setLogo(tenantId: string, buffer: Buffer, actorUserId: string, context: RequestAuditContext): Promise<TenantBrandingView> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId }, select: { id: true, logoPath: true } });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    const name = await saveTenantLogo(buffer);
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.update(TenantEntity, { id: tenantId }, { logoPath: name });
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'TENANT_LOGO_CHANGED',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          metadata: { replaced: Boolean(tenant.logoPath), bytes: buffer.length },
          context,
        });
      });
    } catch (error) {
      await deleteTenantLogo(name);
      throw error;
    }
    await deleteTenantLogo(tenant.logoPath);
    return this.view(tenantId);
  }

  async removeLogo(tenantId: string, actorUserId: string, context: RequestAuditContext): Promise<TenantBrandingView> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId }, select: { id: true, logoPath: true } });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    if (tenant.logoPath) {
      await this.dataSource.transaction(async (manager) => {
        await manager.update(TenantEntity, { id: tenantId }, { logoPath: null });
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'TENANT_LOGO_REMOVED',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          metadata: null,
          context,
        });
      });
      await deleteTenantLogo(tenant.logoPath);
    }
    return this.view(tenantId);
  }
}
