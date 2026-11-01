import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MembershipStatus,
  TenantMembershipEntity,
} from '../../modules/platform/entities/tenant-membership.entity';
import { TenantStatus } from '../../modules/platform/entities/tenant.entity';
import { isIpAllowed } from '../security/ip-allowlist';
import { TrustedDeviceEntity, TrustedDeviceStatus } from '../../modules/auth/entities/trusted-device.entity';
import { membershipRoles } from '../security/tenant-roles';
import { hasTenantModule, moduleNotEnabled, TENANT_MODULE_METADATA, TenantModule } from '../modules/tenant-modules';

type TenantRequest = {
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: {
    id?: string;
    tenantId?: string;
    tenantRole?: string;
    tenantRoles?: string[];
    branchId?: string | null;
    roles?: string[];
    deviceId?: string;
  };
};

/** Cuánto se recuerda el estado de un equipo (una baja corta el acceso en este plazo como máximo). */
const DEVICE_CACHE_MS = 30_000;

@Injectable()
export class TenantContextGuard implements CanActivate {
  private readonly logger = new Logger(TenantContextGuard.name);
  private static readonly deviceCache = new Map<string, { approved: boolean; at: number }>();

  constructor(
    @InjectRepository(TenantMembershipEntity)
    private readonly membershipRepository: Repository<TenantMembershipEntity>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const user = request.user;

    if (!user?.id || !user.tenantId) {
      throw new UnauthorizedException('El token no tiene una empresa activa.');
    }

    const membership = await this.membershipRepository.findOne({
      where: {
        userId: user.id,
        tenantId: user.tenantId,
        status: MembershipStatus.ACTIVE,
      },
      relations: { tenant: true, user: true, branch: true },
    });

    if (
      !membership ||
      !membership.tenant ||
      !membership.user?.isActive ||
      ![TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status)
    ) {
      throw new UnauthorizedException('La membresía de la empresa no está activa.');
    }

    // Lista blanca opcional de IP por sucursal: solo aplica a usuarios con sucursal asignada.
    const allowedRanges = membership.branch?.allowedIpRanges ?? null;
    const clientIp = request.ip ?? request.socket?.remoteAddress ?? null;
    if (!isIpAllowed(clientIp, allowedRanges)) {
      this.logger.warn(
        `Acceso bloqueado por lista blanca IP: usuario=${user.id} sucursal=${membership.branchId ?? '-'}`,
      );
      throw new ForbiddenException('El acceso no está permitido desde esta red para su sucursal.');
    }

    // Equipos autorizados: el token tiene que venir de un equipo aprobado (los operadores de la plataforma, no).
    if (membership.tenant.deviceApprovalRequired && !(user.roles ?? []).includes('SUPER_ADMIN')) {
      if (!user.deviceId || !(await this.isDeviceApproved(user.deviceId, user.tenantId))) {
        throw new UnauthorizedException('Este equipo no está autorizado para usar el sistema.');
      }
    }

    // Use the current database role, not a possibly stale role claim in the JWT.
    // Roles múltiples: los permisos son la unión de todos los roles de la membresía.
    user.tenantRole = membership.role;
    user.tenantRoles = membershipRoles(membership);
    user.branchId = membership.branchId ?? null;

    // Módulos contratados: el endpoint (o su controlador) puede exigir uno que no es del plan base.
    const requiredModule = this.reflector.getAllAndOverride<TenantModule | undefined>(TENANT_MODULE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredModule && !(await hasTenantModule(this.membershipRepository.manager, user.tenantId, requiredModule, membership.tenant.timeZone))) {
      throw moduleNotEnabled(requiredModule);
    }
    return true;
  }

  private async isDeviceApproved(deviceId: string, tenantId: string): Promise<boolean> {
    const key = `${tenantId}:${deviceId}`;
    const cached = TenantContextGuard.deviceCache.get(key);
    if (cached && Date.now() - cached.at < DEVICE_CACHE_MS) return cached.approved;
    const device = await this.membershipRepository.manager.findOne(TrustedDeviceEntity, {
      where: { id: deviceId, tenantId },
      select: { id: true, status: true },
    });
    const approved = device?.status === TrustedDeviceStatus.APPROVED;
    if (TenantContextGuard.deviceCache.size > 5_000) TenantContextGuard.deviceCache.clear();
    TenantContextGuard.deviceCache.set(key, { approved, at: Date.now() });
    return approved;
  }

  /** Olvida el estado recordado de un equipo (al aprobarlo o darlo de baja). */
  static forgetDevice(tenantId: string, deviceId: string): void {
    TenantContextGuard.deviceCache.delete(`${tenantId}:${deviceId}`);
  }
}
