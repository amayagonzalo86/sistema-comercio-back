import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>( err: any, user: TUser | null | undefined): TUser {
    if (err || !user) {
      throw ( err || new UnauthorizedException('Acceso no autorizado: El token de sesión es inválido o ha expirado.') );
    }
    return user;
  }
}