import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { RequestAuditContext } from '../../common/http/request-context';
import { userDisplayNames } from '../../common/security/platform-operators';
import { deviceCode } from '../auth/device-proof';
import { SessionEntity } from '../auth/entities/session.entity';
import { TrustedDeviceEntity, TrustedDeviceStatus } from '../auth/entities/trusted-device.entity';
import { TenantEntity } from './entities/tenant.entity';

export interface TrustedDeviceView {
  id: string;
  code: string;
  name: string;
  status: TrustedDeviceStatus;
  userAgent: string | null;
  requestedBy: string | null;
  lastUser: string | null;
  lastIp: string | null;
  lastSeenAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface TenantDevicesView {
  tenantId: string;
  legalName: string;
  tradeName: string | null;
  displayName: string | null;
  deviceApprovalRequired: boolean;
  counts: Record<TrustedDeviceStatus, number>;
  devices: TrustedDeviceView[];
}

/**
 * Equipos autorizados por empresa: los aprueba solo el operador de la plataforma. Un equipo es un navegador con su
 * llave propia (no una IP), así que funciona con IP dinámica. Cada cambio queda en la auditoría de la empresa.
 */
@Injectable()
export class PlatformDevicesService {
  constructor(private readonly dataSource: DataSource) {}

  async view(tenantId: string, status?: TrustedDeviceStatus): Promise<TenantDevicesView> {
    const tenant = await this.tenant(this.dataSource.manager, tenantId);
    const repo = this.dataSource.getRepository(TrustedDeviceEntity);
    const [devices, grouped] = await Promise.all([
      repo.find({
        where: { tenantId, ...(status ? { status } : {}) },
        order: { lastSeenAt: 'DESC', createdAt: 'DESC' },
        take: 500,
      }),
      repo
        .createQueryBuilder('d')
        .select('d.status', 'status')
        .addSelect('COUNT(*)', 'total')
        .where('d.tenantId = :tenantId', { tenantId })
        .groupBy('d.status')
        .getRawMany<{ status: TrustedDeviceStatus; total: string }>(),
    ]);
    const names = await userDisplayNames(
      this.dataSource.manager,
      devices.flatMap((device) => [device.requestedByUserId, device.lastUserId, device.approvedByUserId]),
    );
    const counts: Record<TrustedDeviceStatus, number> = { PENDING: 0, APPROVED: 0, REVOKED: 0 };
    for (const row of grouped) counts[row.status] = Number(row.total);
    return {
      tenantId: tenant.id,
      legalName: tenant.legalName,
      tradeName: tenant.tradeName ?? null,
      displayName: tenant.displayName ?? null,
      deviceApprovalRequired: Boolean(tenant.deviceApprovalRequired),
      counts,
      devices: devices
        // Primero los que esperan aprobación, después los aprobados y al final las bajas (sort estable: recientes primero).
        .sort((a, b) => rank(a.status) - rank(b.status))
        .map((device) => ({
          id: device.id,
          code: deviceCode(device.keyThumbprint),
          name: device.name,
          status: device.status,
          userAgent: device.userAgent ?? null,
          requestedBy: device.requestedByUserId ? names.get(device.requestedByUserId) ?? null : null,
          lastUser: device.lastUserId ? names.get(device.lastUserId) ?? null : null,
          lastIp: device.lastIp ?? null,
          lastSeenAt: device.lastSeenAt ?? null,
          approvedBy: device.approvedByUserId ? names.get(device.approvedByUserId) ?? null : null,
          approvedAt: device.approvedAt ?? null,
          revokedAt: device.revokedAt ?? null,
          createdAt: device.createdAt,
        })),
    };
  }

  /** Exigir (o no) equipos autorizados. Al activarlo, quien no tenga un equipo aprobado deja de poder entrar. */
  async setRequired(tenantId: string, required: boolean, actorUserId: string, context: RequestAuditContext): Promise<TenantDevicesView> {
    await this.dataSource.transaction(async (manager) => {
      const tenant = await this.tenant(manager, tenantId, true);
      if (Boolean(tenant.deviceApprovalRequired) === required) return;
      const approved = await manager.count(TrustedDeviceEntity, { where: { tenantId, status: TrustedDeviceStatus.APPROVED } });
      if (required && approved === 0) {
        throw new ConflictException('Aprobá al menos un equipo de la empresa antes de exigir equipos autorizados.');
      }
      await manager.update(TenantEntity, { id: tenantId }, { deviceApprovalRequired: required });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: required ? 'DEVICE_APPROVAL_ENABLED' : 'DEVICE_APPROVAL_DISABLED',
        aggregateType: 'TENANT',
        aggregateId: tenantId,
        metadata: { approvedDevices: approved },
        context,
      });
    });
    return this.view(tenantId);
  }

  async approve(tenantId: string, deviceId: string, name: string | undefined, actorUserId: string, context: RequestAuditContext): Promise<TenantDevicesView> {
    await this.dataSource.transaction(async (manager) => {
      const device = await this.device(manager, tenantId, deviceId);
      device.status = TrustedDeviceStatus.APPROVED;
      device.approvedByUserId = actorUserId;
      device.approvedAt = new Date();
      device.revokedAt = null;
      device.revokedByUserId = null;
      if (name) device.name = name;
      await manager.save(TrustedDeviceEntity, device);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'DEVICE_APPROVED',
        aggregateType: 'TRUSTED_DEVICE',
        aggregateId: device.id,
        metadata: { name: device.name, code: deviceCode(device.keyThumbprint) },
        context,
      });
    });
    TenantContextGuard.forgetDevice(tenantId, deviceId);
    return this.view(tenantId);
  }

  /** Baja del equipo: se cierran sus sesiones al instante y no puede volver a entrar. */
  async revoke(tenantId: string, deviceId: string, actorUserId: string, context: RequestAuditContext): Promise<TenantDevicesView> {
    await this.dataSource.transaction(async (manager) => {
      const device = await this.device(manager, tenantId, deviceId);
      if (device.status === TrustedDeviceStatus.REVOKED) return;
      device.status = TrustedDeviceStatus.REVOKED;
      device.revokedByUserId = actorUserId;
      device.revokedAt = new Date();
      await manager.save(TrustedDeviceEntity, device);
      await manager.update(SessionEntity, { deviceId: device.id, isValid: true }, { isValid: false });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'DEVICE_REVOKED',
        aggregateType: 'TRUSTED_DEVICE',
        aggregateId: device.id,
        metadata: { name: device.name, code: deviceCode(device.keyThumbprint) },
        context,
      });
    });
    TenantContextGuard.forgetDevice(tenantId, deviceId);
    return this.view(tenantId);
  }

  async rename(tenantId: string, deviceId: string, name: string, actorUserId: string, context: RequestAuditContext): Promise<TenantDevicesView> {
    await this.dataSource.transaction(async (manager) => {
      const device = await this.device(manager, tenantId, deviceId);
      if (device.name === name) return;
      const before = device.name;
      device.name = name;
      await manager.save(TrustedDeviceEntity, device);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'DEVICE_RENAMED',
        aggregateType: 'TRUSTED_DEVICE',
        aggregateId: device.id,
        metadata: { before, after: name, code: deviceCode(device.keyThumbprint) },
        context,
      });
    });
    return this.view(tenantId);
  }

  private async tenant(manager: EntityManager, tenantId: string, lock = false): Promise<TenantEntity> {
    const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!tenant) throw new NotFoundException('La empresa no existe.');
    return tenant;
  }

  private async device(manager: EntityManager, tenantId: string, deviceId: string): Promise<TrustedDeviceEntity> {
    const device = await manager.findOne(TrustedDeviceEntity, { where: { id: deviceId, tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!device) throw new NotFoundException('El equipo no existe en esa empresa.');
    return device;
  }
}

function rank(status: TrustedDeviceStatus): number {
  return status === TrustedDeviceStatus.PENDING ? 0 : status === TrustedDeviceStatus.APPROVED ? 1 : 2;
}
