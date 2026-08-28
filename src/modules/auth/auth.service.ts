import {
  Injectable,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, Repository } from 'typeorm';
import { UserEntity, UserRole } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { SessionEntity } from './entities/session.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: Omit<UserEntity, 'passwordHash'>; tokens: AuthTokens }> {
    const { email, password, tenantId } = loginDto;

    // 1. Buscar usuario
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim(), tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!user || !user.status) {
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta desactivada'
      );
    }

    // 2. Verificar Hash
    const isPasswordValid = await argon2.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 3. Generar Tokens
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'SecretSuperSecureKey2026',
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'RefreshSecretSuperSecureKey2026',
      expiresIn: '7d',
    });

    // 4. Hashear Refresh Token
    const refreshTokenHash = await argon2.hash(refreshToken);

    // 5. Persistencia mediante QueryRunner (Garantiza ejecución y captura errores MySQL)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const sessionInstance = queryRunner.manager.create(SessionEntity, {
        tenantId: user.tenantId,
        userId: user.id,
        refreshTokenHash,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'Unknown Client',
        isValid: true,
        expiresAt,
      });

      const savedSession = await queryRunner.manager.save(SessionEntity, sessionInstance);

      await queryRunner.manager.update(UserEntity, user.id, {
        currentHashedRefreshToken: refreshTokenHash,
      });

      await queryRunner.commitTransaction();
      this.logger.log(`Sesión guardada exitosamente. ID: ${savedSession.id} para el Usuario: ${user.id}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error crítico al guardar la sesión en MySQL:', error);
      throw new InternalServerErrorException('Error al registrar la sesión de usuario');
    } finally {
      await queryRunner.release();
    }

    // 6. Formatear respuesta
    const { passwordHash: _, ...userWithoutPassword } = user;
    const userResponse = {
      ...userWithoutPassword,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      isAdmin: user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN,
    };

    return {
      user: userResponse,
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  async refreshTokens(userId: string, refreshToken: string): Promise<AuthTokens> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        currentHashedRefreshToken: true,
      },
    });

    if (!user || !user.status || !user.currentHashedRefreshToken) {
      throw new UnauthorizedException('Acceso denegado o sesión inválida');
    }

    const isRefreshTokenValid = await argon2.verify(
      user.currentHashedRefreshToken,
      refreshToken,
    );

    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Token de refresco inválido o revocado');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'SecretSuperSecureKey2026',
      expiresIn: '15m',
    });

    const newRefreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'RefreshSecretSuperSecureKey2026',
      expiresIn: '7d',
    });

    const newRefreshTokenHash = await argon2.hash(newRefreshToken);

    await this.userRepository.update(user.id, {
      currentHashedRefreshToken: newRefreshTokenHash,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      currentHashedRefreshToken: undefined,
    });
    await this.sessionRepository.update({ userId, isValid: true }, { isValid: false });
  }
}