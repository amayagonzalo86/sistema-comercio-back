import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  TooManyRequestsException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, Repository } from 'typeorm';
import { createHmac, randomUUID } from 'node:crypto';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';
import { TenantStatus } from '../platform/entities/tenant.entity';
import { UserEntity } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { SessionEntity } from './entities/session.entity';
import { UserRoleEnum } from '../roles/entities/role.entity';


export interface JwtPayload {
  sub: string;
  username: string;
  roles: UserRoleEnum[];
  tenantId: string;
  tenantRole: TenantRole;
  jti?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private lastRateLimitCleanupAt = 0;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TenantMembershipEntity)
    private readonly membershipRepository: Repository<TenantMembershipEntity>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async login( loginDto: LoginDto, ipAddress?: string, userAgent?: string): Promise<{ user: Omit<UserEntity, 'passwordHash'>; tokens: AuthTokens }> {
    const sanitizedUsername = loginDto.username.toLowerCase().trim();
    await this.enforceLoginRateLimit(sanitizedUsername, ipAddress ?? 'unknown');

    // 1. Definir criterios de búsqueda dinámicos
    const whereConditions: Record<string, any> = {
      username: sanitizedUsername,
    };

    // 2. Buscar usuario con proyección estricta (TypeORM 0.3+)
    const user = await this.userRepository.findOne({ where: whereConditions, relations: { person: true, branch: true },
      select: {
        id: true,
        username: true,
        passwordHash: true, // Forzar selección de columna declarada con select: false
        roles: true,
        isActive: true,
        personId: true,
        branchId: true,
      },
    });

    // Diagnóstico de existencia y estado del usuario
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas o cuenta desactivada');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas o cuenta desactivada');
    }

    // 3. Control defensivo contra hashes de contraseña nulos o inválidos
    if (!user.passwordHash || typeof user.passwordHash !== 'string' || user.passwordHash.trim() === '') {
      this.logger.error(`Error de integridad: El usuario ID [${user.id}] posee un hash de contraseña no válido o nulo.`);
      throw new UnauthorizedException('Credenciales inválidas o cuenta desactivada');
    }

    // 4. Verificar Hash con Argon2
    let isPasswordValid = false;
    try {
      isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);
    } catch (error) {
      this.logger.error(`Excepción al deserializar hash Argon2 para el usuario [${user.id}]:`, error);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const memberships = await this.membershipRepository.find({
      where: { userId: user.id, status: MembershipStatus.ACTIVE },
      relations: { tenant: true, branch: true },
    });
    memberships.sort((a, b) => {
      const byCreation = a.createdAt.getTime() - b.createdAt.getTime();
      return byCreation || a.tenant.slug.localeCompare(b.tenant.slug);
    });
    const membership = loginDto.tenantId
      ? memberships.find((item) => item.tenantId === loginDto.tenantId)
      : memberships[0];

    if (
      !membership ||
      !membership.tenant ||
      ![TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status)
    ) {
      throw new UnauthorizedException(
        'Empresa no asignada o inactiva. Verifique el tenantId de acceso.',
      );
    }

    // Branch assignment is scoped to the selected tenant membership.
    user.branch = membership.branch ?? null;
    user.branchId = membership.branchId ?? null;

    // Extraer únicamente los nombres de los roles para el JWT Payload
    const roleNames: UserRoleEnum[] = user.roles ? user.roles.map((r) => r.name) : [];

    // 5. Generar Tokens JWT
    const sessionTokenId = randomUUID();
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      roles: roleNames,
      tenantId: membership.tenantId,
      tenantRole: membership.role,
      jti: sessionTokenId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: '7d',
    });

    // 6. Hashear Refresh Token
    const refreshTokenHash = await argon2.hash(refreshToken);

    // 7. Transacción ACID para persistir sesión activa y token hash
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const sessionInstance = queryRunner.manager.create(SessionEntity, {
        userId: user.id,
        refreshTokenHash,
        tokenId: sessionTokenId,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'Unknown Client',
        isValid: true,
        expiresAt,
      });

      const savedSession = await queryRunner.manager.save(SessionEntity, sessionInstance);

      await queryRunner.commitTransaction();
      this.logger.log(`Sesión guardada exitosamente. ID: ${savedSession.id} para el Usuario: ${user.id}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error crítico al guardar la sesión en la BD:', error);
      throw new InternalServerErrorException('Error al registrar la sesión de usuario');
    } finally {
      await queryRunner.release();
    }

    // 8. Formatear respuesta omitiendo campos sensibles
    delete (user as Partial<UserEntity>).passwordHash;
    delete (user as Partial<UserEntity>).currentHashedRefreshToken;

    return {
      user,
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  private async enforceLoginRateLimit(username: string, ipAddress: string): Promise<void> {
    const hmacKey = process.env.JWT_ACCESS_SECRET;
    if (!hmacKey) {
      throw new InternalServerErrorException('No se pudo verificar el acceso.');
    }

    const scopes = [
      { value: `username:${username}`, maximum: 10 },
      { value: `ip:${ipAddress}`, maximum: 60 },
    ];
    const exceeded = await Promise.all(scopes.map(async ({ value, maximum }) => {
      const scopeHash = createHmac('sha256', hmacKey).update(value).digest('hex');
      await this.dataSource.query(
        `INSERT INTO auth_rate_limits (scope_hash, attempt_count, window_started_at)
         VALUES (?, 1, CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE
           attempt_count = IF(
             window_started_at <= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 15 MINUTE),
             1,
             attempt_count + 1
           ),
           window_started_at = IF(
             window_started_at <= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 15 MINUTE),
             CURRENT_TIMESTAMP(6),
             window_started_at
           )`,
        [scopeHash],
      );
      const result = await this.dataSource.query(
        'SELECT attempt_count AS attemptCount FROM auth_rate_limits WHERE scope_hash = ?',
        [scopeHash],
      ) as Array<{ attemptCount: number | string }>;
      const attempts = Number(result[0]?.attemptCount ?? 0);

      // Bounded opportunistic cleanup keeps old, pseudonymized IP and identifier keys from accumulating.
      const now = Date.now();
      if (now - this.lastRateLimitCleanupAt > 60 * 60 * 1000) {
        this.lastRateLimitCleanupAt = now;
        void this.dataSource.query(
          `DELETE FROM auth_rate_limits
           WHERE window_started_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 DAY)
           ORDER BY window_started_at
           LIMIT 500`,
        ).catch(() => this.logger.warn('No se pudo completar la limpieza de límites de autenticación.'));
      }

      return attempts > maximum;
    }));

    if (exceeded.some(Boolean)) {
      throw new TooManyRequestsException('Demasiados intentos de acceso. Reintentá en 15 minutos.');
    }
  }

  async listUserTenants(userId: string): Promise<Array<{ id: string; slug: string; legalName: string; tradeName: string | null; role: TenantRole }>> {
    const memberships = await this.membershipRepository.find({
      where: { userId, status: MembershipStatus.ACTIVE },
      relations: { tenant: true },
      order: { createdAt: 'ASC' },
    });
    return memberships
      .filter((membership) => membership.tenant && [TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status))
      .map(({ tenant, role }) => ({
        id: tenant.id,
        slug: tenant.slug,
        legalName: tenant.legalName,
        tradeName: tenant.tradeName ?? null,
        role,
      }));
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);

    const [user, session, membership] = await Promise.all([
      this.userRepository.findOne({
        where: { id: payload.sub, isActive: true },
        relations: { roles: true },
        select: { id: true, username: true, roles: true, isActive: true },
      }),
      this.sessionRepository.findOne({
        where: { userId: payload.sub, tokenId: payload.jti!, isValid: true },
      }),
      this.membershipRepository.findOne({
        where: {
          userId: payload.sub,
          tenantId: payload.tenantId,
          status: MembershipStatus.ACTIVE,
        },
        relations: { tenant: true },
      }),
    ]);

    if (
      !user ||
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      !membership ||
      !membership.tenant ||
      ![TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status)
    ) {
      throw new UnauthorizedException('Acceso denegado o sesión inválida');
    }

    let isRefreshTokenValid = false;
    try {
      isRefreshTokenValid = await argon2.verify(session.refreshTokenHash, refreshToken);
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o revocado');
    }
    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Token de refresco inválido o revocado');
    }

    const roleNames: UserRoleEnum[] = user.roles ? user.roles.map((role) => role.name) : [];
    const nextTokenId = randomUUID();
    const nextPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      roles: roleNames,
      tenantId: membership.tenantId,
      tenantRole: membership.role,
      jti: nextTokenId,
    };
    const accessToken = this.jwtService.sign(nextPayload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: '15m',
    });
    const nextRefreshToken = this.jwtService.sign(nextPayload, {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: '7d',
    });
    const nextRefreshTokenHash = await argon2.hash(nextRefreshToken);
    const nextExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Conditional update makes refresh-token rotation single-use under concurrent requests.
    const rotation = await this.sessionRepository.update(
      { id: session.id, tokenId: payload.jti!, isValid: true },
      {
        tokenId: nextTokenId,
        refreshTokenHash: nextRefreshTokenHash,
        expiresAt: nextExpiresAt,
      },
    );
    if (rotation.affected !== 1) {
      throw new UnauthorizedException('El token de refresco ya fue utilizado');
    }

    return { accessToken, refreshToken: nextRefreshToken };
  }

  async logoutWithRefreshToken(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    const payload = this.verifyRefreshToken(refreshToken);
    await this.sessionRepository.update(
      { userId: payload.sub, tokenId: payload.jti!, isValid: true },
      { isValid: false },
    );
  }

  private verifyRefreshToken(refreshToken: string): JwtPayload {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
      });
      if (!payload.sub || !payload.jti || !payload.tenantId) {
        throw new UnauthorizedException('Token de refresco incompleto');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      currentHashedRefreshToken: null,
    });
    await this.sessionRepository.update({ userId, isValid: true }, { isValid: false });
  }
}