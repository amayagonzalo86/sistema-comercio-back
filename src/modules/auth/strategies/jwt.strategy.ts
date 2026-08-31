import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRoleEnum } from '../../roles/entities/role.entity';

export interface JwtCustomPayload {
  sub: string;
  email?: string;
  username?: string;
  role?: UserRoleEnum | string;
  roles?: (UserRoleEnum | string)[];
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username?: string;
  role: UserRoleEnum | string;
  roles: (UserRoleEnum | string)[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'SUPER_SECRET_KEY_PRODUCTION_ERP',
    });
  }

  validate(payload: JwtCustomPayload): AuthenticatedUser {
    if (!payload || !payload.sub) {
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
    };
  }
}