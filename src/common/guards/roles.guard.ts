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

    // Aplanar los roles ya sea que vengan como array de strings/enums o como Objetos de Entidad
    const userRoleNames: UserRoleEnum[] = user.roles.map((role) =>
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