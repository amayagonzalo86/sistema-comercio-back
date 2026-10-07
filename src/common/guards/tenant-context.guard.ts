import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MembershipStatus,
  TenantMembershipEntity,
} from '../../modules/platform/entities/tenant-membership.entity';
import { TenantStatus } from '../../modules/platform/entities/tenant.entity';
import { isIpAllowed } from '../security/ip-allowlist';

type TenantRequest = {
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: {
    id?: string;
    tenantId?: string;
    tenantRole?: string;
    branchId?: string | null;
  };
};

@Injectable()
export class TenantContextGuard implements CanActivate {
  private readonly logger = new Logger(TenantContextGuard.name);

  constructor(
    @InjectRepository(TenantMembershipEntity)
    private readonly membershipRepository: Repository<TenantMembershipEntity>,
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

    // Use the current database role, not a possibly stale role claim in the JWT.
    user.tenantRole = membership.role;
    user.branchId = membership.branchId ?? null;
    return true;
  }
}
