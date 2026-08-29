import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../users/entities/user.entity';

export interface JwtCustomPayload {
    sub: string;
    tenantId: string;
    email: string;
    role?: UserRole | string;
    roles?: (UserRole | string)[];
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

    async validate(payload: JwtCustomPayload) {
        if (!payload || !payload.sub || !payload.tenantId) {
            throw new UnauthorizedException('Payload de autenticación inválido.');
        }

        // Retorna el usuario inyectando de forma explícita tanto 'role' como 'roles'
        const primaryRole = payload.role || (payload.roles && payload.roles[0]) || UserRole.USER;
        const allRoles = payload.roles || [primaryRole];

        return {
            id: payload.sub,
            tenantId: payload.tenantId,
            email: payload.email,
            role: primaryRole,
            roles: allRoles,
        };
    }
}