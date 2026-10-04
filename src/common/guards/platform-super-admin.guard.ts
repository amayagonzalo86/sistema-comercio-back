import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRoleEnum } from '../../modules/roles/entities/role.entity';

type PlatformRequest = {
  user?: {
    roles?: Array<UserRoleEnum | string | { name?: UserRoleEnum | string }>;
  };
};

@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const roles = request.user?.roles ?? [];
    const roleNames = roles.map((role) =>
      typeof role === 'object' && role !== null ? role.name : role,
    );

    if (!roleNames.includes(UserRoleEnum.SUPER_ADMIN)) {
      throw new ForbiddenException('Se requiere un administrador de plataforma.');
    }
    return true;
  }
}
