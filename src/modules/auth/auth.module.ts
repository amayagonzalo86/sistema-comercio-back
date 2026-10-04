import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StringValue } from 'ms';
import { UserEntity } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionEntity } from './entities/session.entity';
import { AuthRateLimitEntity } from './entities/auth-rate-limit.entity';
import { TenantMembershipEntity } from '../platform/entities/tenant-membership.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, SessionEntity, TenantMembershipEntity, AuthRateLimitEntity]),
    PassportModule.register({ defaultStrategy: 'jwt', property: 'user' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN', '45m');

        if (!secret) {
          throw new Error(
            'CRÍTICO: JWT_ACCESS_SECRET no está definido en las variables de entorno',
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: expiresIn as StringValue,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule implements OnModuleInit {
  private readonly logger = new Logger(AuthModule.name);

  constructor(private readonly jwtStrategy: JwtStrategy) {}

  onModuleInit() {
    this.logger.log(
      'Estrategia de autenticación Passport "jwt" registrada e inicializada correctamente.',
    );
  }
}