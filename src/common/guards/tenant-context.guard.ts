import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MembershipStatus,
  TenantMembershipEntity,
} from '../../modules/platform/entities/tenant-membership.entity';
import { TenantStatus } from '../../modules/platform/entities/tenant.entity';

type TenantRequest = {
  user?: {
    id?: string;
    tenantId?: string;
    tenantRole?: string;
  };
};

@Injectable()
export class TenantContextGuard implements CanActivate {
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
      relations: { tenant: true, user: true },
    });

    if (
      !membership ||
      !membership.tenant ||
      !membership.user?.isActive ||
      ![TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status)
    ) {
      throw new UnauthorizedException('La membresía de la empresa no está activa.');
    }

    // Use the current database role, not a possibly stale role claim in the JWT.
    user.tenantRole = membership.role;
    return true;
  }
}
