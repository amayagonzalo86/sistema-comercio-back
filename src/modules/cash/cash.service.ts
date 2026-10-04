import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BranchEntity } from '../branches/entities/branch.entity';
import { UserEntity } from '../users/entities/user.entity';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';
import { TenantEntity, TenantStatus } from '../platform/entities/tenant.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CashMovementQueryDto } from './dto/cash-movement-query.dto';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import {
  CashManualMovementDirection,
  CashManualMovementType,
  CreateCashMovementDto,
} from './dto/create-cash-movement.dto';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import {
  CashMovementDirection,
  CashMovementEntity,
  CashMovementType,
} from './entities/cash-movement.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashSessionEntity, CashSessionStatus } from './entities/cash-session.entity';

const MAX_MONEY_CENTS = 99_999_999_999_999n;

@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CashRegisterEntity)
    private readonly registerRepository: Repository<CashRegisterEntity>,
    @InjectRepository(CashSessionEntity)
    private readonly sessionRepository: Repository<CashSessionEntity>,
    @InjectRepository(CashMovementEntity)
    private readonly movementRepository: Repository<CashMovementEntity>,
  ) {}

  async createRegister(
    tenantId: string,
    actorUserId: string,
    dto: CreateCashRegisterDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<CashRegisterEntity> {
    const branchId = dto.branchId;
    if (allowedBranchId && allowedBranchId !== branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.MANAGER]);

      const branch = await queryRunner.manager.findOne(BranchEntity, {
        where: { id: branchId, tenantId, status: true },
      });
      if (!branch) {
        throw new NotFoundException('La sucursal no existe o no está activa en esta empresa.');
      }

      const repository = queryRunner.manager.getRepository(CashRegisterEntity);
      const register = await repository.save(repository.create({
        tenantId,
        branchId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        isActive: true,
        createdByUserId: actorUserId,
      }));
      await this.writeAudit(queryRunner.manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_REGISTER_CREATED',
        aggregateType: 'CASH_REGISTER',
        aggregateId: register.id,
        metadata: { branchId, code: register.code },
      });

      await queryRunner.commitTransaction();
      started = false;
      return register;
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      if (isDuplicateEntry(error)) {
        throw new ConflictException('Ya existe una caja con ese código en la sucursal.');
      }
      this.logger.error('No se pudo crear la caja', error);
      throw new InternalServerErrorException('No se pudo crear la caja.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async listRegisters(
    tenantId: string,
    allowedBranchId: string | null,
    requestedBranchId?: string,
  ): Promise<CashRegisterEntity[]> {
    if (allowedBranchId && requestedBranchId && allowedBranchId !== requestedBranchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = allowedBranchId ?? requestedBranchId;
    return this.registerRepository.find({
      where: { tenantId, isActive: true, ...(branchId ? { branchId } : {}) },
      order: { branchId: 'ASC', code: 'ASC' },
      take: 100,
    });
  }

  async openSession(
    tenantId: string,
    actorUserId: string,
    registerId: string,
    idempotencyKey: string,
    dto: OpenCashSessionDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<CashSessionEntity> {
    const key = normalizeKey(idempotencyKey);
    const openingCents = parseMoney(dto.openingAmount, 'El fondo inicial');
    const openingAmount = formatCents(openingCents);
    const fingerprint = hashRequest({
      operation: 'open',
      registerId,
      currency: dto.currency,
      openingAmount,
      actorUserId,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.MANAGER, TenantRole.CASHIER]);

      const register = await queryRunner.manager
        .createQueryBuilder(CashRegisterEntity, 'register')
        .setLock('pessimistic_write')
        .where('register.id = :registerId', { registerId })
        .andWhere('register.tenantId = :tenantId', { tenantId })
        .andWhere('register.isActive = :isActive', { isActive: true })
        .getOne();
      if (!register || (allowedBranchId && register.branchId !== allowedBranchId)) {
        throw new NotFoundException('La caja no existe o no está activa en una sucursal habilitada.');
      }

      // The parent row lock serializes competing opens and makes this current read fresh
      // under MySQL REPEATABLE READ, including retries that started before the first commit.
      const prior = await queryRunner.manager
        .createQueryBuilder(CashSessionEntity, 'session')
        .setLock('pessimistic_write')
        .where('session.tenantId = :tenantId', { tenantId })
        .andWhere('session.openingIdempotencyKey = :key', { key })
        .getOne();
      if (prior) {
        if (
          prior.openingRequestFingerprint !== fingerprint ||
          prior.cashRegisterId !== register.id
        ) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otra apertura.');
        }
        await queryRunner.commitTransaction();
        started = false;
        return prior;
      }

      const repository = queryRunner.manager.getRepository(CashSessionEntity);
      const session = await repository.save(repository.create({
        tenantId,
        branchId: register.branchId,
        cashRegisterId: register.id,
        status: CashSessionStatus.OPEN,
        currency: dto.currency,
        openingAmount,
        expectedAmount: openingAmount,
        openingIdempotencyKey: key,
        openingRequestFingerprint: fingerprint,
        openedByUserId: actorUserId,
      }));

      if (openingCents > 0n) {
        const movementRepo = queryRunner.manager.getRepository(CashMovementEntity);
        await movementRepo.save(movementRepo.create({
          tenantId,
          branchId: register.branchId,
          cashSessionId: session.id,
          type: CashMovementType.OPENING,
          direction: CashMovementDirection.IN,
          amount: openingAmount,
          currency: dto.currency,
          reason: 'Fondo inicial de caja',
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          actorUserId,
        }));
      }

      await this.writeAudit(queryRunner.manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_SESSION_OPENED',
        aggregateType: 'CASH_SESSION',
        aggregateId: session.id,
        metadata: { branchId: register.branchId, registerId: register.id, currency: dto.currency, openingAmount },
      });
      await queryRunner.commitTransaction();
      started = false;
      return session;
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) {
        if (error instanceof ConflictException) {
          const prior = await this.findOpenByKey(tenantId, key);
          if (prior?.openingRequestFingerprint === fingerprint) return prior;
        }
        throw error;
      }
      if (isDuplicateEntry(error)) {
        const prior = await this.findOpenByKey(tenantId, key);
        if (prior?.openingRequestFingerprint === fingerprint) return prior;
        throw new ConflictException('La caja ya tiene una sesión abierta o la clave de idempotencia está duplicada.');
      }
      this.logger.error('No se pudo abrir la sesión de caja', error);
      throw new InternalServerErrorException('No se pudo abrir la sesión de caja.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async recordMovement(
    tenantId: string,
    actorUserId: string,
    sessionId: string,
    idempotencyKey: string,
    dto: CreateCashMovementDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<{ movement: CashMovementEntity; expectedAmount: string }> {
    const key = normalizeKey(idempotencyKey);
    const amountCents = parseMoney(dto.amount, 'El importe', false);
    const amount = formatCents(amountCents);
    const reason = dto.reason.trim();
    const externalReference = dto.externalReference?.trim() || null;
    const fingerprint = hashRequest({
      operation: 'movement',
      sessionId,
      type: dto.type,
      direction: dto.direction,
      amount,
      reason,
      externalReference,
      actorUserId,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.MANAGER, TenantRole.CASHIER]);

      const session = await this.lockSession(queryRunner.manager, tenantId, sessionId, allowedBranchId);
      if (session.status !== CashSessionStatus.OPEN) {
        throw new ConflictException('No se pueden registrar movimientos en una caja cerrada.');
      }

      const prior = await queryRunner.manager.findOne(CashMovementEntity, {
        where: { tenantId, cashSessionId: session.id, idempotencyKey: key },
      });
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otro movimiento.');
        }
        await queryRunner.commitTransaction();
        started = false;
        return { movement: prior, expectedAmount: session.expectedAmount };
      }

      const direction = dto.direction === CashManualMovementDirection.IN
        ? CashMovementDirection.IN
        : CashMovementDirection.OUT;
      if (
        (dto.type === CashManualMovementType.INCOME && direction !== CashMovementDirection.IN) ||
        (dto.type === CashManualMovementType.EXPENSE && direction !== CashMovementDirection.OUT)
      ) {
        throw new BadRequestException('El sentido del movimiento no coincide con su tipo.');
      }

      const currentCents = parseMoney(session.expectedAmount, 'El saldo esperado');
      const nextCents = direction === CashMovementDirection.IN
        ? currentCents + amountCents
        : currentCents - amountCents;
      if (nextCents < 0n) {
        throw new ConflictException('El egreso supera el efectivo esperado disponible.');
      }
      if (nextCents > MAX_MONEY_CENTS) {
        throw new BadRequestException('El saldo esperado supera el rango monetario admitido.');
      }

      const movementRepo = queryRunner.manager.getRepository(CashMovementEntity);
      const movement = await movementRepo.save(movementRepo.create({
        tenantId,
        branchId: session.branchId,
        cashSessionId: session.id,
        type: dto.type === CashManualMovementType.INCOME
          ? CashMovementType.INCOME
          : dto.type === CashManualMovementType.EXPENSE
            ? CashMovementType.EXPENSE
            : CashMovementType.ADJUSTMENT,
        direction,
        amount,
        currency: session.currency,
        reason,
        externalReference,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId,
      }));
      session.expectedAmount = formatCents(nextCents);
      await queryRunner.manager.save(CashSessionEntity, session);

      await this.writeAudit(queryRunner.manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_MOVEMENT_RECORDED',
        aggregateType: 'CASH_SESSION',
        aggregateId: session.id,
        metadata: { movementId: movement.id, type: movement.type, direction, amount, currency: session.currency },
      });
      await queryRunner.commitTransaction();
      started = false;
      return { movement, expectedAmount: session.expectedAmount };
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      if (isDuplicateEntry(error)) {
        const prior = await this.movementRepository.findOne({ where: { tenantId, cashSessionId: sessionId, idempotencyKey: key } });
        if (prior?.requestFingerprint === fingerprint) {
          const current = await this.sessionRepository.findOne({ where: { id: sessionId, tenantId } });
          return { movement: prior, expectedAmount: current?.expectedAmount ?? '0.00' };
        }
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro movimiento.');
      }
      this.logger.error('No se pudo registrar el movimiento de caja', error);
      throw new InternalServerErrorException('No se pudo registrar el movimiento de caja.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async closeSession(
    tenantId: string,
    actorUserId: string,
    sessionId: string,
    idempotencyKey: string,
    dto: CloseCashSessionDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<CashSessionEntity> {
    const key = normalizeKey(idempotencyKey);
    const countedCents = parseMoney(dto.countedAmount, 'El efectivo contado');
    const countedAmount = formatCents(countedCents);
    const fingerprint = hashRequest({ operation: 'close', sessionId, countedAmount, actorUserId });

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.MANAGER, TenantRole.CASHIER]);

      const session = await this.lockSession(queryRunner.manager, tenantId, sessionId, allowedBranchId);
      if (session.status === CashSessionStatus.CLOSED) {
        if (session.closeIdempotencyKey !== key || session.closeRequestFingerprint !== fingerprint) {
          throw new ConflictException('La sesión de caja ya está cerrada.');
        }
        await queryRunner.commitTransaction();
        started = false;
        return session;
      }

      const expectedCents = parseMoney(session.expectedAmount, 'El saldo esperado');
      session.status = CashSessionStatus.CLOSED;
      session.countedAmount = countedAmount;
      session.differenceAmount = formatSignedCents(countedCents - expectedCents);
      session.closedByUserId = actorUserId;
      session.closedAt = new Date();
      session.closeIdempotencyKey = key;
      session.closeRequestFingerprint = fingerprint;
      const saved = await queryRunner.manager.save(CashSessionEntity, session);

      await this.writeAudit(queryRunner.manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_SESSION_CLOSED',
        aggregateType: 'CASH_SESSION',
        aggregateId: session.id,
        metadata: {
          branchId: session.branchId,
          registerId: session.cashRegisterId,
          expectedAmount: session.expectedAmount,
          countedAmount,
          differenceAmount: session.differenceAmount,
          currency: session.currency,
        },
      });
      await queryRunner.commitTransaction();
      started = false;
      return saved;
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        if (error instanceof ConflictException) {
          const prior = await this.sessionRepository.findOne({ where: { tenantId, closeIdempotencyKey: key } });
          if (prior?.closeRequestFingerprint === fingerprint) return prior;
        }
        throw error;
      }
      if (isDuplicateEntry(error)) {
        const prior = await this.sessionRepository.findOne({ where: { tenantId, closeIdempotencyKey: key } });
        if (prior?.closeRequestFingerprint === fingerprint) return prior;
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro cierre.');
      }
      this.logger.error('No se pudo cerrar la sesión de caja', error);
      throw new InternalServerErrorException('No se pudo cerrar la sesión de caja.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  async findSession(
    tenantId: string,
    sessionId: string,
    allowedBranchId: string | null,
  ): Promise<CashSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: {
        tenantId,
        id: sessionId,
        ...(allowedBranchId ? { branchId: allowedBranchId } : {}),
      },
    });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada.');
    return session;
  }

  async listMovements(
    tenantId: string,
    sessionId: string,
    allowedBranchId: string | null,
    query: CashMovementQueryDto,
  ): Promise<{ items: CashMovementEntity[]; nextCursor: string | null }> {
    await this.findSession(tenantId, sessionId, allowedBranchId);
    const limit = query.limit ?? 50;
    const builder = this.movementRepository.createQueryBuilder('movement')
      .where('movement.tenantId = :tenantId', { tenantId })
      .andWhere('movement.cashSessionId = :sessionId', { sessionId });
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      builder.andWhere(
        '(movement.createdAt < :cursorCreatedAt OR (movement.createdAt = :cursorCreatedAt AND movement.id < :cursorId))',
        { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
      );
    }
    const { raw, entities } = await builder
      .addSelect("DATE_FORMAT(movement.createdAt, '%Y-%m-%d %H:%i:%s.%f')", 'cursorCreatedAt')
      .orderBy('movement.createdAt', 'DESC')
      .addOrderBy('movement.id', 'DESC')
      .take(limit + 1)
      .getRawAndEntities();
    const hasMore = entities.length > limit;
    const items = entities.slice(0, limit);
    const last = items.at(-1);
    const lastRaw = raw[items.length - 1] as { cursorCreatedAt?: string } | undefined;
    return {
      items,
      nextCursor: hasMore && last && lastRaw?.cursorCreatedAt
        ? encodeCursor({ createdAt: lastRaw.cursorCreatedAt, id: last.id })
        : null,
    };
  }

  private async assertActorAccess(
    manager: EntityManager,
    tenantId: string,
    actorUserId: string,
    allowedBranchId: string | null,
    permittedRoles: TenantRole[],
  ): Promise<void> {
    // Share locks keep permission revocation from racing a cash write while allowing
    // concurrent requests from the same active user to proceed together.
    const membership = await manager.createQueryBuilder(TenantMembershipEntity, 'membership')
      .setLock('pessimistic_read')
      .where('membership.tenantId = :tenantId', { tenantId })
      .andWhere('membership.userId = :actorUserId', { actorUserId })
      .andWhere('membership.status = :status', { status: MembershipStatus.ACTIVE })
      .getOne();
    if (
      !membership ||
      (membership.branchId ?? null) !== allowedBranchId ||
      !permittedRoles.includes(membership.role)
    ) {
      throw new ForbiddenException('La membresía actual no tiene acceso a esta operación de caja.');
    }

    const user = await manager.createQueryBuilder(UserEntity, 'user')
      .select(['user.id', 'user.isActive'])
      .setLock('pessimistic_read')
      .where('user.id = :actorUserId', { actorUserId })
      .andWhere('user.isActive = :isActive', { isActive: true })
      .getOne();
    if (!user) {
      throw new ForbiddenException('La cuenta de usuario está desactivada.');
    }

    const tenant = await manager.createQueryBuilder(TenantEntity, 'tenant')
      .select(['tenant.id', 'tenant.status'])
      .setLock('pessimistic_read')
      .where('tenant.id = :tenantId', { tenantId })
      .andWhere('tenant.status IN (:...statuses)', {
        statuses: [TenantStatus.ACTIVE, TenantStatus.TRIAL],
      })
      .getOne();
    if (!tenant) {
      throw new ForbiddenException('La empresa está suspendida o inactiva.');
    }
  }

  private async lockSession(
    manager: EntityManager,
    tenantId: string,
    sessionId: string,
    allowedBranchId: string | null,
  ): Promise<CashSessionEntity> {
    const builder = manager.createQueryBuilder(CashSessionEntity, 'session')
      .setLock('pessimistic_write')
      .where('session.tenantId = :tenantId', { tenantId })
      .andWhere('session.id = :sessionId', { sessionId });
    if (allowedBranchId) {
      builder.andWhere('session.branchId = :allowedBranchId', { allowedBranchId });
    }
    const session = await builder.getOne();
    if (!session) throw new NotFoundException('Sesión de caja no encontrada.');
    return session;
  }

  private async findOpenByKey(tenantId: string, key: string): Promise<CashSessionEntity | null> {
    return this.sessionRepository.findOne({ where: { tenantId, openingIdempotencyKey: key } });
  }

  private async writeAudit(
    manager: EntityManager,
    event: {
      tenantId: string;
      actorUserId: string;
      audit: InventoryAuditContext;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await manager.save(AuditEventEntity, manager.create(AuditEventEntity, {
      tenantId: event.tenantId,
      actorUserId: event.actorUserId,
      requestId: event.audit.requestId,
      ipAddress: event.audit.ipAddress,
      userAgent: event.audit.userAgent,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      metadata: event.metadata,
    }));
  }
}

function normalizeKey(value: string): string {
  const key = value?.trim();
  if (!key || key.length > 100) {
    throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
  }
  return key;
}

function parseMoney(value: string, label: string, allowZero = true): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) {
    throw new BadRequestException(`${label} debe tener hasta 12 enteros y dos decimales.`);
  }
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if ((!allowZero && cents === 0n) || cents > MAX_MONEY_CENTS) {
    throw new BadRequestException(`${label} está fuera del rango admitido.`);
  }
  return cents;
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function formatSignedCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function hashRequest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  if (cursor.length > 256) throw new BadRequestException('El cursor de movimientos no es válido.');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof value.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value.createdAt) ||
      Number.isNaN(Date.parse(value.createdAt.replace(' ', 'T') + 'Z')) ||
      typeof value.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    ) throw new Error('invalid cursor');
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new BadRequestException('El cursor de movimientos no es válido.');
  }
}
