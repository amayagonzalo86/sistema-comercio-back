import { SetMetadata } from '@nestjs/common';
import { UserRoleEnum } from '../../modules/roles/entities/role.entity';

export const ROLES_KEY = 'roles';

/**
 * Decorador para restringir el acceso a rutas según los roles del usuario.
 * @param roles Lista de roles permitidos (UserRoleEnum)
 */
export const Roles = (...roles: UserRoleEnum[]) => SetMetadata(ROLES_KEY, roles);