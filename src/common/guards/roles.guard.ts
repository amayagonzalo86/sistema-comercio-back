import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRoleEnum } from '../../modules/roles/entities/role.entity';

interface RequestUserPayload {
  roles?: (UserRoleEnum | { name: UserRoleEnum })[];
  tenantRole?: string;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRoleEnum[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestUserPayload }>();
    const user = request.user;

    if (!user || !Array.isArray(user.roles)) {
      throw new ForbiddenException(
        'Acceso denegado: El usuario no posee roles asignados',
      );
    }

    // Once tenant context is verified, authorize from the tenant-scoped role.
    const tenantRoleMap: Record<string, UserRoleEnum[]> = {
      OWNER: [UserRoleEnum.ADMIN],
      ADMIN: [UserRoleEnum.ADMIN],
      MANAGER: [UserRoleEnum.MANAGER],
      ACCOUNTANT: [UserRoleEnum.USER],
      CASHIER: [UserRoleEnum.CASHIER],
      INVENTORY: [UserRoleEnum.WAREHOUSE, UserRoleEnum.STOCK_CLERK],
      SELLER: [UserRoleEnum.SELLER],
      VIEWER: [UserRoleEnum.USER],
    };
    const userRoleNames: UserRoleEnum[] = user.tenantRole
      ? (tenantRoleMap[user.tenantRole] ?? [])
      : user.roles.map((role) =>
      typeof role === 'object' && role !== null && 'name' in role
        ? role.name
        : role,
    );

    const hasPermission = requiredRoles.some((requiredRole) =>
      userRoleNames.includes(requiredRole),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Acceso denegado: Se requiere uno de los siguientes roles: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}