import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { RequestAuditContext } from '../../common/http/request-context';
import { UpdatePrintSettingsDto } from './dto/print-settings.dto';
import { TenantEntity } from './entities/tenant.entity';
import { deleteTenantLogo, saveTenantLogo, tenantLogoUrl } from './tenant-logo';

export interface TenantBrandingView {
  tenantId: string;
  legalName: string;
  tradeName: string | null;
  displayName: string | null;
  logoUrl: string | null;
  /** Datos que se imprimen en facturas y presupuestos. */
  print: TenantPrintSettings;
}

export interface TenantPrintSettings {
  whatsapp: string | null;
  website: string | null;
  invoiceLegend: string | null;
  quoteCondition: string | null;
  quoteCashDiscount: string;
}

const PRINT_FIELDS = {
  whatsapp: 'printWhatsapp',
  website: 'printWebsite',
  invoiceLegend: 'invoiceLegend',
  quoteCondition: 'quoteCondition',
} as const;

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
      print: {
        whatsapp: tenant.printWhatsapp ?? null,
        website: tenant.printWebsite ?? null,
        invoiceLegend: tenant.invoiceLegend ?? null,
        quoteCondition: tenant.quoteCondition ?? null,
        quoteCashDiscount: tenant.quoteCashDiscount ?? '0.00',
      },
    };
  }

  /** Cambia los datos de impresión. Solo se tocan los campos enviados; vacío = no se imprime. */
  async updatePrintSettings(tenantId: string, dto: UpdatePrintSettingsDto, actorUserId: string, context: RequestAuditContext): Promise<TenantBrandingView> {
    await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('La empresa no existe.');
      const changes: Partial<TenantEntity> = {};
      const changed: Record<string, { from: string | null; to: string | null }> = {};
      for (const [key, column] of Object.entries(PRINT_FIELDS) as Array<[keyof typeof PRINT_FIELDS, (typeof PRINT_FIELDS)[keyof typeof PRINT_FIELDS]]>) {
        if (dto[key] === undefined) continue;
        const next = dto[key] ?? null;
        const previous = tenant[column] ?? null;
        if (next === previous) continue;
        changes[column] = next;
        changed[key] = { from: previous, to: next };
      }
      if (dto.quoteCashDiscount !== undefined) {
        const next = dto.quoteCashDiscount.toFixed(2);
        if (next !== Number(tenant.quoteCashDiscount).toFixed(2)) {
          changes.quoteCashDiscount = next;
          changed.quoteCashDiscount = { from: tenant.quoteCashDiscount, to: next };
        }
      }
      if (Object.keys(changes).length === 0) return;
      await manager.update(TenantEntity, { id: tenantId }, changes);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'TENANT_PRINT_SETTINGS_CHANGED',
        aggregateType: 'TENANT',
        aggregateId: tenantId,
        metadata: { changed },
        context,
      });
    });
    return this.view(tenantId);
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
