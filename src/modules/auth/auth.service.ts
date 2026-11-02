import { membershipRoles } from '../../common/security/tenant-roles';
import { recordAudit } from '../../common/audit/audit';
import { isPlatformOperator } from '../../common/security/platform-operators';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, Repository } from 'typeorm';
import { createHmac, randomUUID } from 'node:crypto';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';
import { TenantEntity, TenantStatus } from '../platform/entities/tenant.entity';
import { tenantLogoUrl } from '../platform/tenant-logo';
import { UserEntity } from '../users/entities/user.entity';
import { DeviceProofDto, LoginDto } from './dto/login.dto';
import { TrustedDeviceEntity, TrustedDeviceStatus } from './entities/trusted-device.entity';
import {
  cleanDeviceName,
  deviceCode,
  deviceThumbprint,
  deviceTokenThumbprint,
  isValidDeviceChallenge,
  normalizeDeviceJwk,
  verifyDeviceSignature,
} from './device-proof';
import { SessionEntity } from './entities/session.entity';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { enabledTenantModules, TenantModule } from '../../common/modules/tenant-modules';


export interface JwtPayload {
  sub: string;
  username: string;
  roles: UserRoleEnum[];
  tenantId: string;
  tenantRole: TenantRole;
  /** Todos los roles en la empresa (principal + adicionales), para que el frontend arme el menú. */
  tenantRoles: TenantRole[];
  jti?: string;
  /** Equipo autorizado desde el que se inició la sesión. */
  did?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const JWT_ALGORITHM = 'HS256' as const;

@Injectable()
export class AuthService {
  private lastRateLimitCleanupAt = 0;
  private readonly logger = new Logger(AuthService.name);
  // Hash señuelo: se verifica cuando el usuario no existe para que el tiempo de respuesta
  // no revele qué nombres de usuario son válidos (enumeración por timing).
  private dummyHash: Promise<string> | null = null;

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

    // Diagnóstico de existencia y estado del usuario. Siempre se ejecuta una verificación
    // Argon2 (real o señuelo) para que todas las respuestas fallidas tarden lo mismo.
    if (!user || !user.isActive) {
      await this.verifyAgainstDummyHash(loginDto.password);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 3. Control defensivo contra hashes de contraseña nulos o inválidos
    if (!user.passwordHash || typeof user.passwordHash !== 'string' || user.passwordHash.trim() === '') {
      this.logger.error(`Error de integridad: El usuario ID [${user.id}] posee un hash de contraseña no válido o nulo.`);
      await this.verifyAgainstDummyHash(loginDto.password);
      throw new UnauthorizedException('Credenciales inválidas');
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
      throw new UnauthorizedException('Credenciales inválidas o empresa inactiva.');
    }

    // Equipos autorizados: si la empresa los exige, solo entra un equipo aprobado por la plataforma.
    const deviceId = await this.resolveLoginDevice(membership.tenant, user.id, loginDto.device, ipAddress, userAgent);

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
      tenantRoles: membershipRoles(membership),
      jti: sessionTokenId,
      ...(deviceId ? { did: deviceId } : {}),
    };

    const { accessToken, refreshToken } = this.signTokens(payload);

    // 6. Hashear Refresh Token
    const refreshTokenHash = await argon2.hash(refreshToken);

    // 7. Transacción ACID para persistir sesión activa y token hash
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

      const sessionInstance = queryRunner.manager.create(SessionEntity, {
        userId: user.id,
        refreshTokenHash,
        tokenId: sessionTokenId,
        deviceId,
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
      throw new HttpException('Demasiados intentos de acceso. Reintentá en 15 minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Empresas del usuario con los módulos contratados de cada una (el plan base no figura: siempre está). */
  async listUserTenants(userId: string): Promise<Array<{ id: string; slug: string; legalName: string; tradeName: string | null; displayName: string | null; logoUrl: string | null; role: TenantRole; modules: TenantModule[] }>> {
    const memberships = await this.membershipRepository.find({
      where: { userId, status: MembershipStatus.ACTIVE },
      relations: { tenant: true },
      order: { createdAt: 'ASC' },
    });
    const active = memberships.filter((membership) => membership.tenant && [TenantStatus.ACTIVE, TenantStatus.TRIAL].includes(membership.tenant.status));
    return Promise.all(
      active.map(async ({ tenant, role }) => ({
        id: tenant.id,
        slug: tenant.slug,
        legalName: tenant.legalName,
        tradeName: tenant.tradeName ?? null,
        displayName: tenant.displayName ?? null,
        logoUrl: tenantLogoUrl(tenant.logoPath),
        role,
        modules: await enabledTenantModules(this.membershipRepository.manager, tenant.id, tenant.timeZone),
      })),
    );
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);

    // Detección de reutilización: un refresh token firmado y vigente cuyo jti ya no existe
    // fue rotado antes, es decir, alguien lo está reutilizando (posible robo). Se revocan
    // todas las sesiones del usuario para cortar el acceso del atacante (OWASP).
    const knownSession = await this.sessionRepository.findOne({
      where: { userId: payload.sub, tokenId: payload.jti! },
      select: { id: true },
    });
    if (!knownSession) {
      await this.sessionRepository.update({ userId: payload.sub, isValid: true }, { isValid: false });
      this.logger.warn(`Reutilización de refresh token detectada. Sesiones revocadas para el usuario ${payload.sub}.`);
      throw new UnauthorizedException('Sesión inválida. Iniciá sesión nuevamente.');
    }

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

    await this.assertSessionDevice(membership.tenant, user.id, session);

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
      tenantRoles: membershipRoles(membership),
      jti: nextTokenId,
      ...(session.deviceId ? { did: session.deviceId } : {}),
    };
    const { accessToken, refreshToken: nextRefreshToken } = this.signTokens(nextPayload);
    const nextRefreshTokenHash = await argon2.hash(nextRefreshToken);
    const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

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

  /**
   * Cambio de la contraseña propia: exige la contraseña actual, aplica el mismo límite de intentos que el
   * ingreso y cierra las demás sesiones del usuario (la sesión desde la que se cambia sigue abierta).
   */
  async changeOwnPassword(
    userId: string,
    tenantId: string | undefined,
    currentTokenId: string | undefined,
    currentPassword: string,
    newPassword: string,
    ipAddress: string,
    context: { requestId?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    await this.enforceLoginRateLimit(`password-change:${userId}`, ipAddress);
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
      select: { id: true, username: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Sesión inválida.');
    let valid = false;
    try {
      valid = await argon2.verify(user.passwordHash, currentPassword);
    } catch {
      valid = false;
    }
    if (!valid) throw new BadRequestException('La contraseña actual no es correcta.');
    if (currentPassword === newPassword) throw new BadRequestException('La contraseña nueva debe ser distinta de la actual.');

    const passwordHash = await argon2.hash(newPassword);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(UserEntity, { id: userId }, { passwordHash });
      const sessions = manager
        .createQueryBuilder()
        .update(SessionEntity)
        .set({ isValid: false })
        .where('user_id = :userId AND is_valid = 1', { userId });
      if (currentTokenId) sessions.andWhere('token_id <> :tokenId', { tokenId: currentTokenId });
      await sessions.execute();
      // La cuenta de un operador de la plataforma no pertenece a la empresa: no se registra en su auditoría.
      if (tenantId && !(await isPlatformOperator(manager, userId))) {
        await recordAudit(manager, {
          tenantId,
          actorUserId: userId,
          eventType: 'PASSWORD_CHANGED',
          aggregateType: 'USER',
          aggregateId: userId,
          metadata: { otherSessionsClosed: true },
          context: { requestId: context.requestId ?? null, ipAddress, userAgent: context.userAgent ?? null },
        });
      }
    });
  }

  async logoutWithRefreshToken(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    const payload = this.verifyRefreshToken(refreshToken);
    await this.sessionRepository.update(
      { userId: payload.sub, tokenId: payload.jti!, isValid: true },
      { isValid: false },
    );
  }

  /**
   * Registra o reconoce el equipo del inicio de sesión. Si la empresa exige equipos autorizados (y quien entra no
   * es operador de la plataforma), rechaza los equipos sin aprobar. Si no lo exige, igual los registra para que la
   * plataforma pueda aprobarlos antes de activar la exigencia. Devuelve el id del equipo (o null sin prueba válida).
   */
  private async resolveLoginDevice(
    tenant: TenantEntity,
    userId: string,
    proof: DeviceProofDto | undefined,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Promise<string | null> {
    const enforced = Boolean(tenant.deviceApprovalRequired) && !(await isPlatformOperator(this.dataSource.manager, userId));
    if (!proof) {
      if (enforced) {
        throw new ForbiddenException(
          'Este equipo no está autorizado. Abrí el sistema con https en un navegador actualizado (no en modo incógnito).',
          { description: 'DEVICE_REQUIRED' },
        );
      }
      return null;
    }
    let thumbprint: string;
    let publicKey: string;
    if (proof.token) {
      // Navegador sin WebCrypto (http en la red local): secreto aleatorio del equipo, se guarda solo su huella.
      thumbprint = deviceTokenThumbprint(proof.token);
      publicKey = JSON.stringify({ kind: 'token' });
    } else {
      const jwk = normalizeDeviceJwk(proof.publicKey);
      const challenge = proof.challenge ?? '';
      if (!jwk || !isValidDeviceChallenge(challenge) || !verifyDeviceSignature(jwk, challenge, proof.signature ?? '')) {
        if (enforced) throw new UnauthorizedException('No se pudo verificar este equipo. Volvé a intentar.');
        return null;
      }
      thumbprint = deviceThumbprint(jwk);
      publicKey = JSON.stringify(jwk);
    }
    const repo = this.dataSource.getRepository(TrustedDeviceEntity);
    let device = await repo.findOne({ where: { tenantId: tenant.id, keyThumbprint: thumbprint } });
    const name = cleanDeviceName(proof.name, userAgent);
    if (!device) {
      try {
        device = await this.dataSource.transaction(async (manager) => {
          const created = await manager.save(
            TrustedDeviceEntity,
            manager.create(TrustedDeviceEntity, {
              tenantId: tenant.id,
              keyThumbprint: thumbprint,
              publicKey,
              name,
              status: TrustedDeviceStatus.PENDING,
              userAgent: userAgent?.slice(0, 255) ?? null,
              requestedByUserId: userId,
              lastSeenAt: new Date(),
              lastIp: ipAddress?.slice(0, 45) ?? null,
              lastUserId: userId,
            }),
          );
          await recordAudit(manager, {
            tenantId: tenant.id,
            actorUserId: userId,
            eventType: 'DEVICE_REGISTERED',
            aggregateType: 'TRUSTED_DEVICE',
            aggregateId: created.id,
            metadata: { name, code: deviceCode(thumbprint) },
            context: { ipAddress: ipAddress ?? null, userAgent: userAgent?.slice(0, 512) ?? null },
          });
          return created;
        });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          device = await repo.findOne({ where: { tenantId: tenant.id, keyThumbprint: thumbprint } });
        }
        if (!device) throw error;
      }
    } else {
      await repo.update(
        { id: device.id },
        {
          lastSeenAt: new Date(),
          lastIp: ipAddress?.slice(0, 45) ?? null,
          lastUserId: userId,
          userAgent: userAgent?.slice(0, 255) ?? null,
          // Mientras espera aprobación, el local puede corregir el nombre con el que lo pidió.
          ...(device.status === TrustedDeviceStatus.PENDING && proof.name?.trim() ? { name } : {}),
        },
      );
    }
    if (enforced && device.status === TrustedDeviceStatus.PENDING) {
      const code = deviceCode(thumbprint);
      throw new ForbiddenException(
        `Este equipo todavía no está autorizado. Pedile al proveedor del sistema que apruebe el equipo con código ${code}.`,
        { description: `DEVICE_PENDING:${code}` },
      );
    }
    if (enforced && device.status === TrustedDeviceStatus.REVOKED) {
      throw new ForbiddenException('Este equipo fue dado de baja y no puede ingresar al sistema.', { description: 'DEVICE_REVOKED' });
    }
    return device.id;
  }

  /** Al renovar el acceso, el equipo de la sesión tiene que seguir aprobado (si la empresa lo exige). */
  private async assertSessionDevice(tenant: TenantEntity, userId: string, session: SessionEntity): Promise<void> {
    if (!tenant.deviceApprovalRequired || (await isPlatformOperator(this.dataSource.manager, userId))) return;
    const device = session.deviceId
      ? await this.dataSource.getRepository(TrustedDeviceEntity).findOne({ where: { id: session.deviceId, tenantId: tenant.id } })
      : null;
    if (device?.status === TrustedDeviceStatus.APPROVED) return;
    await this.sessionRepository.update({ id: session.id }, { isValid: false });
    throw new UnauthorizedException('Este equipo no está autorizado. Iniciá sesión nuevamente.');
  }

  private verifyRefreshToken(refreshToken: string): JwtPayload {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET!,
        algorithms: [JWT_ALGORITHM],
      });
      if (!payload.sub || !payload.jti || !payload.tenantId) {
        throw new UnauthorizedException('Token de refresco incompleto');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }

  private signTokens(payload: JwtPayload): AuthTokens {
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: ACCESS_TOKEN_TTL,
      algorithm: JWT_ALGORITHM,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
      algorithm: JWT_ALGORITHM,
    });
    return { accessToken, refreshToken };
  }

  private async verifyAgainstDummyHash(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash(`dummy:${randomUUID()}`);
    try {
      await argon2.verify(await this.dummyHash, password);
    } catch {
      // El resultado no importa: solo iguala el tiempo de respuesta.
    }
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      currentHashedRefreshToken: null,
    });
    await this.sessionRepository.update({ userId, isValid: true }, { isValid: false });
  }
}