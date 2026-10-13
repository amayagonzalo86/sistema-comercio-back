import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRoleEnum } from '../../roles/entities/role.entity';

export interface JwtCustomPayload {
  sub: string;
  email?: string;
  username?: string;
  role?: UserRoleEnum | string;
  roles?: (UserRoleEnum | string)[];
  tenantId?: string;
  tenantRole?: string;
  tenantRoles?: string[];
  jti?: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username?: string;
  role: UserRoleEnum | string;
  roles: (UserRoleEnum | string)[];
  tenantId?: string;
  tenantRole?: string;
  tenantRoles?: string[];
  branchId?: string;
  /** Id de la sesión que emitió el token (permite cerrar las demás sesiones). */
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
      // Solo se acepta el algoritmo con el que firmamos: bloquea ataques de "algorithm confusion"/alg=none.
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtCustomPayload): AuthenticatedUser {
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Payload de autenticación inválido.');
    }

    const primaryRole =
      payload.role ||
      (payload.roles && payload.roles.length > 0 ? payload.roles[0] : UserRoleEnum.USER);

    const allRoles = payload.roles && payload.roles.length > 0
      ? payload.roles
      : [primaryRole];

    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      role: primaryRole,
      roles: allRoles,
      tenantId: payload.tenantId,
      tenantRole: payload.tenantRole,
      sessionId: typeof payload.jti === 'string' ? payload.jti : undefined,
      tenantRoles: Array.isArray(payload.tenantRoles) ? payload.tenantRoles.filter((role) => typeof role === 'string') : undefined,
    };
  }
}