import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../modules/users/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface AuthenticatedUserPayload {
  id: string;
  role?: UserRole | string;
  roles?: (UserRole | string)[];
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUserPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Acceso denegado: Sesión de usuario no encontrada.');
    }

    // Normalización ultra-segura de roles del usuario a un array de strings en mayúsculas
    const extractedRoles: string[] = [];

    if (user.roles && Array.isArray(user.roles)) {
      extractedRoles.push(...user.roles.map((r) => String(r).trim().toUpperCase()));
    }

    if (user.role) {
      extractedRoles.push(String(user.role).trim().toUpperCase());
    }

    // Normalizar los roles requeridos por el decorador
    const normalizedRequiredRoles = requiredRoles.map((r) => String(r).trim().toUpperCase());

    // Verificar si al menos uno de los roles del usuario coincide con los requeridos
    const hasRole = normalizedRequiredRoles.some((reqRole) =>
      extractedRoles.includes(reqRole),
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Acceso restringido: Se requiere uno de los siguientes roles [${requiredRoles.join(', ')}] para realizar esta operación.`,
      );
    }

    return true;
  }
}