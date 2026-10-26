import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { RequestAuditContext } from '../../common/http/request-context';
import { ALL_TENANT_MODULES, TENANT_MODULE_INFO, TenantModule } from '../../common/modules/tenant-modules';
import { DEFAULT_TIME_ZONE } from '../../common/time/local-day-range';
import { BranchEntity } from '../branches/entities/branch.entity';
import { localToday } from '../reports/domain/period';
import { UpdateTenantModuleDto } from './dto/tenant-module.dto';
import { TenantModuleEntity } from './entities/tenant-module.entity';
import { TenantEntity } from './entities/tenant.entity';

export interface TenantModuleView {
  module: TenantModule;
  name: string;
  description: string;
  enabled: boolean;
  validUntil: string | null;
  /** Activo y sin vencer hoy (fecha local de la empresa). */
  active: boolean;
  notes: string | null;
  updatedAt: Date | null;
}

export interface TenantModulesView {
  tenantId: string;
  legalName: string;
  tradeName: string | null;
  /** Sucursales activas (el plan base no tiene límite). */
  activeBranches: number;
  modules: TenantModuleView[];
}

/** Activación de módulos por empresa. Solo la usa un operador de la plataforma (SUPER_ADMIN). */
@Injectable()
export class PlatformModulesService {
  constructor(private readonly dataSource: DataSource) {}

  async view(tenantId: string): Promise<TenantModulesView> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    const [rows, activeBranches] = await Promise.all([
      this.dataSource.getRepository(TenantModuleEntity).find({ where: { tenantId } }),
      this.dataSource.getRepository(BranchEntity).count({ where: { tenantId, status: true } }),
    ]);
    const today = localToday(tenant.timeZone || DEFAULT_TIME_ZONE);
    const byModule = new Map(rows.map((row) => [row.module, row]));
    const modules = ALL_TENANT_MODULES.map((module): TenantModuleView => {
      const row = byModule.get(module);
      const validUntil = row?.validUntil ? String(row.validUntil).slice(0, 10) : null;
      return {
        module,
        ...TENANT_MODULE_INFO[module],
        enabled: row?.enabled ?? false,
        validUntil,
        active: Boolean(row?.enabled) && (!validUntil || validUntil >= today),
        notes: row?.notes ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
    return {
      tenantId: tenant.id,
      legalName: tenant.legalName,
      tradeName: tenant.tradeName ?? null,
      activeBranches,
      modules,
    };
  }

  async update(tenantId: string, module: TenantModule, dto: UpdateTenantModuleDto, actorUserId: string, context: RequestAuditContext): Promise<TenantModulesView> {
    if (!ALL_TENANT_MODULES.includes(module)) throw new BadRequestException('Módulo desconocido.');
    await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('La empresa no existe.');
      const repository = manager.getRepository(TenantModuleEntity);
      const existing = await repository
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.tenantId = :tenantId AND m.module = :module', { tenantId, module })
        .getOne();
      const before = existing ? { enabled: existing.enabled, validUntil: existing.validUntil ?? null, notes: existing.notes ?? null } : null;
      const row = existing ?? repository.create({ tenantId, module, enabled: false });
      row.enabled = dto.enabled;
      if (dto.validUntil !== undefined) row.validUntil = dto.validUntil || null;
      if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
      row.updatedByUserId = actorUserId;
      await repository.save(row);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: dto.enabled ? 'TENANT_MODULE_ENABLED' : 'TENANT_MODULE_DISABLED',
        aggregateType: 'TENANT_MODULE',
        aggregateId: row.id,
        metadata: {
          module,
          name: TENANT_MODULE_INFO[module].name,
          before,
          after: { enabled: row.enabled, validUntil: row.validUntil ?? null, notes: row.notes ?? null },
        },
        context,
      });
    });
    return this.view(tenantId);
  }
}
