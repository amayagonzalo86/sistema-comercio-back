import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
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
  ) { }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: Omit<UserEntity, 'passwordHash'>; tokens: AuthTokens }> {
    const sanitizedEmail = loginDto.email.toLowerCase().trim();
    const sanitizedTenantId = loginDto.tenantId.trim();

    // 1. Buscar usuario con proyección mediante objeto FindOptionsSelect (TypeORM 0.3+)
    const user = await this.userRepository.findOne({
      where: {
        email: sanitizedEmail,
        tenantId: sanitizedTenantId,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        passwordHash: true, // Forzamos selección de columna declarada con select: false
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    // Diagnóstico de existencia y estado del usuario
    if (!user) {
      this.logger.warn(
        `Intento de login fallido: Usuario no encontrado para email [${sanitizedEmail}] y tenant [${sanitizedTenantId}]`,
      );
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta desactivada',
      );
    }

    if (!user.status) {
      this.logger.warn(
        `Intento de login fallido: Usuario [${user.id}] desactivado en tenant [${sanitizedTenantId}]`,
      );
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta desactivada',
      );
    }

    // 2. Control defensivo contra hashes de contraseña nulos o inválidos
    if (!user.passwordHash || typeof user.passwordHash !== 'string' || user.passwordHash.trim() === '') {
      this.logger.error(
        `Error de integridad: El usuario ID [${user.id}] posee un hash de contraseña no válido o nulo en la BD.`,
      );
      throw new UnauthorizedException('Credenciales inválidas o cuenta desactivada');
    }

    // 3. Verificar Hash con Argon2
    let isPasswordValid = false;
    try {
      isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);
    } catch (error) {
      this.logger.error(`Excepción al deserializar hash Argon2 para el usuario [${user.id}]:`, error);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!isPasswordValid) {
      this.logger.warn(`Intento de login fallido: Contraseña incorrecta para el usuario [${user.id}]`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 4. Generar Tokens JWT
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

    // 5. Hashear Refresh Token
    const refreshTokenHash = await argon2.hash(refreshToken);

    // 6. Transacción ACID para persistir sesión activa y token hash
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

    // 7. Formatear respuesta sin retornar hashes sensibles
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, currentHashedRefreshToken: __, ...userWithoutPassword } = user;
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
    // Proyección corregida mediante FindOptionsSelect
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