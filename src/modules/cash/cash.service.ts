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
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BranchEntity } from '../branches/entities/branch.entity';
import { UserEntity } from '../users/entities/user.entity';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';
import { TenantEntity, TenantStatus } from '../platform/entities/tenant.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CashMovementQueryDto } from './dto/cash-movement-query.dto';
import { CashCountDto, CashXReportDto, CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CashSessionQueryDto } from './dto/cash-session-query.dto';
import { buildCashSalesDetail, buildCashSummary, CashSessionSalesDetail, centsText, decimalCents } from './cash-report';
import { CashReportSummary, CashReportType, CashSessionReportEntity } from './entities/cash-session-report.entity';
import { Paginated, paginated } from '../../common/dto/page-query.dto';
import { userDisplayNames } from '../../common/security/platform-operators';
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
/** Abrir, registrar movimientos, cierres X y Z e historial: solo titular, administración y encargados. */
const CASH_MANAGEMENT_ROLES = [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.MANAGER];

/** Sesión con nombres y caja, para el historial. */
export interface CashSessionView extends CashSessionEntity {
  registerCode: string | null;
  registerName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  zNumber: number | null;
  salesTotal: string;
  salesCount: number;
}

export interface CashReportView extends CashSessionReportEntity {
  actorName: string | null;
  registerCode: string | null;
  registerName: string | null;
  branchName: string | null;
  openedAt: Date;
  openedByName: string | null;
}

export interface CashSessionDetail extends CashSessionView {
  /** Resumen en vivo (sesión abierta) o el del cierre Z (sesión cerrada). */
  summary: CashReportSummary;
  reports: Array<Pick<CashSessionReportEntity, 'id' | 'type' | 'number' | 'expectedAmount' | 'countedAmount' | 'differenceAmount' | 'createdAt'> & { actorName: string | null }>;
}

/** Caja con su sesión abierta (si la hay), para que el frontend sepa dónde imputar el efectivo. */
export type CashRegisterWithSession = CashRegisterEntity & {
  openSession: {
    id: string;
    currency: string;
    openingAmount: string | null;
    expectedAmount: string | null;
    openedByUserId: string;
    openedAt: Date;
  } | null;
};

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
    includeAmounts = true,
  ): Promise<CashRegisterWithSession[]> {
    if (allowedBranchId && requestedBranchId && allowedBranchId !== requestedBranchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = allowedBranchId ?? requestedBranchId;
    const registers = await this.registerRepository.find({
      where: { tenantId, isActive: true, ...(branchId ? { branchId } : {}) },
      order: { branchId: 'ASC', code: 'ASC' },
      take: 100,
    });
    if (registers.length === 0) return [];
    // La sesión abierta de cada caja permite al punto de venta cobrar en efectivo sin pasos extra.
    const openSessions = await this.sessionRepository.find({
      where: { tenantId, status: CashSessionStatus.OPEN, cashRegisterId: In(registers.map((register) => register.id)) },
    });
    const byRegister = new Map(openSessions.map((session) => [session.cashRegisterId, session]));
    return registers.map((register) => {
      const session = byRegister.get(register.id);
      return {
        ...register,
        openSession: session
          ? {
              id: session.id,
              currency: session.currency,
              // El cajero solo necesita saber qué caja está abierta para cobrar: no ve importes.
              openingAmount: includeAmounts ? session.openingAmount : null,
              expectedAmount: includeAmounts ? session.expectedAmount : null,
              openedByUserId: session.openedByUserId,
              openedAt: session.openedAt,
            }
          : null,
      };
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
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, CASH_MANAGEMENT_ROLES);

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
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, CASH_MANAGEMENT_ROLES);

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
  ): Promise<CashSessionEntity & { report: CashSessionReportEntity | null }> {
    const key = normalizeKey(idempotencyKey);
    // Sin efectivo contado: Z sin arqueo (el arqueo se registra después, por ejemplo contando en la oficina).
    const countedCents = dto.countedAmount !== undefined && dto.countedAmount !== '' ? parseMoney(dto.countedAmount, 'El efectivo contado') : null;
    const countedAmount = countedCents !== null ? formatCents(countedCents) : null;
    const notes = dto.notes?.trim() || null;
    const fingerprint = hashRequest({ operation: 'close', sessionId, countedAmount, notes, actorUserId });

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, CASH_MANAGEMENT_ROLES);

      const session = await this.lockSession(queryRunner.manager, tenantId, sessionId, allowedBranchId);
      if (session.status === CashSessionStatus.CLOSED) {
        if (session.closeIdempotencyKey !== key || session.closeRequestFingerprint !== fingerprint) {
          throw new ConflictException('La sesión de caja ya está cerrada.');
        }
        const priorReport = await queryRunner.manager.findOne(CashSessionReportEntity, { where: { tenantId, cashSessionId: session.id, type: CashReportType.Z } });
        await queryRunner.commitTransaction();
        started = false;
        return { ...session, report: priorReport };
      }

      // Numeración Z por caja: el bloqueo de la caja evita números repetidos con cierres simultáneos.
      await queryRunner.manager
        .createQueryBuilder(CashRegisterEntity, 'register')
        .setLock('pessimistic_write')
        .where('register.id = :id AND register.tenantId = :tenantId', { id: session.cashRegisterId, tenantId })
        .getOne();
      const closedAt = new Date();
      const summary = await buildCashSummary(queryRunner.manager, session, closedAt);

      const expectedCents = parseMoney(session.expectedAmount, 'El saldo esperado');
      session.status = CashSessionStatus.CLOSED;
      session.countedAmount = countedAmount;
      session.differenceAmount = countedCents !== null ? formatSignedCents(countedCents - expectedCents) : null;
      session.closedByUserId = actorUserId;
      session.closedAt = closedAt;
      session.closingNotes = notes;
      session.closeIdempotencyKey = key;
      session.closeRequestFingerprint = fingerprint;
      const saved = await queryRunner.manager.save(CashSessionEntity, session);
      const zNumber = await this.nextReportNumber(queryRunner.manager, tenantId, { cashRegisterId: session.cashRegisterId }, CashReportType.Z);
      const report = await queryRunner.manager.save(
        CashSessionReportEntity,
        queryRunner.manager.create(CashSessionReportEntity, {
          tenantId,
          branchId: session.branchId,
          cashRegisterId: session.cashRegisterId,
          cashSessionId: session.id,
          type: CashReportType.Z,
          number: zNumber,
          expectedAmount: session.expectedAmount,
          countedAmount,
          differenceAmount: session.differenceAmount,
          summary,
          notes,
          idempotencyKey: `z:${key}`,
          requestFingerprint: fingerprint,
          actorUserId,
        }),
      );

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
          zNumber,
          reportId: report.id,
        },
      });
      await queryRunner.commitTransaction();
      started = false;
      return { ...saved, report };
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        if (error instanceof ConflictException) {
          const prior = await this.sessionRepository.findOne({ where: { tenantId, closeIdempotencyKey: key } });
          if (prior?.closeRequestFingerprint === fingerprint) return { ...prior, report: await this.zReportOf(tenantId, prior.id) };
        }
        throw error;
      }
      if (isDuplicateEntry(error)) {
        const prior = await this.sessionRepository.findOne({ where: { tenantId, closeIdempotencyKey: key } });
        if (prior?.closeRequestFingerprint === fingerprint) return { ...prior, report: await this.zReportOf(tenantId, prior.id) };
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro cierre.');
      }
      this.logger.error('No se pudo cerrar la sesión de caja', error);
      throw new InternalServerErrorException('No se pudo cerrar la sesión de caja.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  /**
   * Cierre X: informe parcial con el resumen al momento y, si se cuenta el efectivo, la diferencia.
   * La caja sigue abierta y se puede seguir cobrando.
   */
  async xReport(
    tenantId: string,
    actorUserId: string,
    sessionId: string,
    idempotencyKey: string,
    dto: CashXReportDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<CashSessionReportEntity> {
    const key = normalizeKey(idempotencyKey);
    const counted = dto.countedAmount !== undefined && dto.countedAmount !== '' ? formatCents(parseMoney(dto.countedAmount, 'El efectivo contado')) : null;
    const notes = dto.notes?.trim() || null;
    const fingerprint = hashRequest({ operation: 'x', sessionId, counted, notes, actorUserId });

    const queryRunner = this.dataSource.createQueryRunner();
    let started = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      started = true;
      await this.assertActorAccess(queryRunner.manager, tenantId, actorUserId, allowedBranchId, CASH_MANAGEMENT_ROLES);
      const prior = await queryRunner.manager.findOne(CashSessionReportEntity, { where: { tenantId, idempotencyKey: `x:${key}` } });
      if (prior) {
        if (prior.requestFingerprint !== fingerprint || prior.cashSessionId !== sessionId) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otro cierre.');
        }
        await queryRunner.commitTransaction();
        started = false;
        return prior;
      }
      // Bloquear la sesión ordena los cierres X y evita que se cierre (Z) mientras tanto.
      const session = await this.lockSession(queryRunner.manager, tenantId, sessionId, allowedBranchId);
      if (session.status !== CashSessionStatus.OPEN) {
        throw new ConflictException('La caja ya está cerrada: el cierre X se hace con la caja abierta.');
      }
      const summary = await buildCashSummary(queryRunner.manager, session, new Date());
      const number = await this.nextReportNumber(queryRunner.manager, tenantId, { cashSessionId: session.id }, CashReportType.X);
      const difference = counted !== null ? centsText(decimalCents(counted) - decimalCents(session.expectedAmount)) : null;
      const report = await queryRunner.manager.save(
        CashSessionReportEntity,
        queryRunner.manager.create(CashSessionReportEntity, {
          tenantId,
          branchId: session.branchId,
          cashRegisterId: session.cashRegisterId,
          cashSessionId: session.id,
          type: CashReportType.X,
          number,
          expectedAmount: session.expectedAmount,
          countedAmount: counted,
          differenceAmount: difference,
          summary,
          notes,
          idempotencyKey: `x:${key}`,
          requestFingerprint: fingerprint,
          actorUserId,
        }),
      );
      await this.writeAudit(queryRunner.manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_X_REPORT',
        aggregateType: 'CASH_SESSION',
        aggregateId: session.id,
        metadata: { reportId: report.id, number, expectedAmount: session.expectedAmount, countedAmount: counted, differenceAmount: difference },
      });
      await queryRunner.commitTransaction();
      started = false;
      return report;
    } catch (error) {
      if (started) await queryRunner.rollbackTransaction();
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      if (isDuplicateEntry(error)) {
        const prior = await this.dataSource.getRepository(CashSessionReportEntity).findOne({ where: { tenantId, idempotencyKey: `x:${key}` } });
        if (prior?.requestFingerprint === fingerprint) return prior;
        throw new ConflictException('Otro cierre X se registró al mismo tiempo. Volvé a intentarlo.');
      }
      this.logger.error('No se pudo hacer el cierre X', error);
      throw new InternalServerErrorException('No se pudo hacer el cierre X.');
    } finally {
      if (!queryRunner.isReleased) await queryRunner.release();
    }
  }

  /** Historial de cajas (sesiones) con totales, más recientes primero. */
  async listSessions(tenantId: string, allowedBranchId: string | null, query: CashSessionQueryDto): Promise<Paginated<CashSessionView>> {
    if (allowedBranchId && query.branchId && allowedBranchId !== query.branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = allowedBranchId ?? query.branchId;
    const qb = this.sessionRepository.createQueryBuilder('s').where('s.tenantId = :tenantId', { tenantId });
    if (branchId) qb.andWhere('s.branchId = :branchId', { branchId });
    if (query.registerId) qb.andWhere('s.cashRegisterId = :registerId', { registerId: query.registerId });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    if (query.from) qb.andWhere('s.openedAt >= :from', { from: `${query.from} 00:00:00` });
    if (query.to) qb.andWhere('s.openedAt < DATE_ADD(:to, INTERVAL 1 DAY)', { to: query.to });
    const [items, total] = await qb
      .orderBy('s.openedAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(await this.sessionViews(tenantId, items), total, query.page, query.limit);
  }

  /** Detalle de una caja: resumen (en vivo si está abierta; el del cierre Z si está cerrada) y sus cierres X/Z. */
  async sessionDetail(tenantId: string, sessionId: string, allowedBranchId: string | null): Promise<CashSessionDetail> {
    const session = await this.findSession(tenantId, sessionId, allowedBranchId);
    const [view] = await this.sessionViews(tenantId, [session]);
    const reports = await this.dataSource.getRepository(CashSessionReportEntity).find({
      where: { tenantId, cashSessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    const zReport = reports.find((report) => report.type === CashReportType.Z);
    const summary = zReport?.summary ?? (await buildCashSummary(this.dataSource.manager, session, new Date()));
    const names = await userDisplayNames(this.dataSource.manager, reports.map((report) => report.actorUserId));
    return {
      ...view,
      summary,
      reports: reports.map((report) => ({
        id: report.id,
        type: report.type,
        number: report.number,
        expectedAmount: report.expectedAmount,
        countedAmount: report.countedAmount ?? null,
        differenceAmount: report.differenceAmount ?? null,
        createdAt: report.createdAt,
        actorName: names.get(report.actorUserId) ?? null,
      })),
    };
  }

  /**
   * Arqueo posterior: registra el efectivo contado de una caja cerrada con Z sin arqueo (una sola vez).
   * Actualiza la caja y su Z con el contado y la diferencia.
   */
  async registerCount(
    tenantId: string,
    actorUserId: string,
    sessionId: string,
    idempotencyKey: string,
    dto: CashCountDto,
    allowedBranchId: string | null,
    audit: InventoryAuditContext,
  ): Promise<CashSessionEntity & { report: CashSessionReportEntity | null }> {
    normalizeKey(idempotencyKey);
    const countedCents = parseMoney(dto.countedAmount, 'El efectivo contado');
    const countedAmount = formatCents(countedCents);
    const notes = dto.notes?.trim() || null;
    return this.dataSource.transaction(async (manager) => {
      await this.assertActorAccess(manager, tenantId, actorUserId, allowedBranchId, CASH_MANAGEMENT_ROLES);
      const session = await this.lockSession(manager, tenantId, sessionId, allowedBranchId);
      const report = await manager.findOne(CashSessionReportEntity, { where: { tenantId, cashSessionId: session.id, type: CashReportType.Z } });
      if (session.status !== CashSessionStatus.CLOSED || !report) {
        throw new ConflictException('El arqueo posterior se registra sobre una caja ya cerrada con cierre Z.');
      }
      if (session.countedAmount !== null && session.countedAmount !== undefined) {
        // Reintento del mismo arqueo (doble clic, corte de red): devuelve lo ya registrado.
        if (session.countedAmount === countedAmount) return { ...session, report };
        throw new ConflictException('Esta caja ya tiene el arqueo registrado.');
      }
      const difference = formatSignedCents(countedCents - parseMoney(session.expectedAmount, 'El saldo esperado'));
      session.countedAmount = countedAmount;
      session.differenceAmount = difference;
      const savedSession = await manager.save(CashSessionEntity, session);
      report.countedAmount = countedAmount;
      report.differenceAmount = difference;
      const countNote = `Arqueo posterior${notes ? `: ${notes}` : ''}`;
      report.notes = [report.notes, countNote].filter(Boolean).join(' · ').slice(0, 500);
      const savedReport = await manager.save(CashSessionReportEntity, report);
      await this.writeAudit(manager, {
        tenantId,
        actorUserId,
        audit,
        eventType: 'CASH_SESSION_COUNTED',
        aggregateType: 'CASH_SESSION',
        aggregateId: session.id,
        metadata: { reportId: report.id, zNumber: report.number, expectedAmount: session.expectedAmount, countedAmount, differenceAmount: difference },
      });
      return { ...savedSession, report: savedReport };
    });
  }

  /** Ventas y productos de una caja: en vivo si está abierta, hasta el cierre si está cerrada. */
  async sessionSalesDetail(tenantId: string, sessionId: string, allowedBranchId: string | null): Promise<CashSessionSalesDetail> {
    const session = await this.findSession(tenantId, sessionId, allowedBranchId);
    return buildCashSalesDetail(this.dataSource.manager, tenantId, session.id, session.closedAt ? new Date(session.closedAt) : new Date());
  }

  /** Detalle de un cierre: lo cobrado en la caja hasta el momento de ese X o Z. */
  async reportSalesDetail(tenantId: string, reportId: string, allowedBranchId: string | null): Promise<CashSessionSalesDetail> {
    const report = await this.dataSource.getRepository(CashSessionReportEntity).findOne({
      where: { tenantId, id: reportId, ...(allowedBranchId ? { branchId: allowedBranchId } : {}) },
      select: { id: true, cashSessionId: true, createdAt: true },
    });
    if (!report) throw new NotFoundException('Cierre de caja no encontrado.');
    return buildCashSalesDetail(this.dataSource.manager, tenantId, report.cashSessionId, new Date(report.createdAt));
  }

  /** Un cierre X o Z para imprimir. */
  async getReport(tenantId: string, reportId: string, allowedBranchId: string | null): Promise<CashReportView> {
    const report = await this.dataSource.getRepository(CashSessionReportEntity).findOne({
      where: { tenantId, id: reportId, ...(allowedBranchId ? { branchId: allowedBranchId } : {}) },
    });
    if (!report) throw new NotFoundException('Cierre de caja no encontrado.');
    const [session, register, branch] = await Promise.all([
      this.sessionRepository.findOne({ where: { tenantId, id: report.cashSessionId } }),
      this.registerRepository.findOne({ where: { tenantId, id: report.cashRegisterId } }),
      this.dataSource.getRepository(BranchEntity).findOne({ where: { tenantId, id: report.branchId }, select: { id: true, name: true } }),
    ]);
    const names = await userDisplayNames(this.dataSource.manager, [report.actorUserId, session?.openedByUserId]);
    return {
      ...report,
      actorName: names.get(report.actorUserId) ?? null,
      registerCode: register?.code ?? null,
      registerName: register?.name ?? null,
      branchName: branch?.name ?? null,
      openedAt: session?.openedAt ?? report.createdAt,
      openedByName: session ? names.get(session.openedByUserId) ?? null : null,
    };
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

  private async nextReportNumber(
    manager: EntityManager,
    tenantId: string,
    scope: { cashSessionId?: string; cashRegisterId?: string },
    type: CashReportType,
  ): Promise<number> {
    const qb = manager
      .createQueryBuilder(CashSessionReportEntity, 'r')
      .select('COALESCE(MAX(r.number), 0)', 'last')
      .where('r.tenantId = :tenantId AND r.type = :type', { tenantId, type });
    if (scope.cashSessionId) qb.andWhere('r.cashSessionId = :sessionId', { sessionId: scope.cashSessionId });
    if (scope.cashRegisterId) qb.andWhere('r.cashRegisterId = :registerId', { registerId: scope.cashRegisterId });
    const row = await qb.getRawOne<{ last: string | number }>();
    return Number(row?.last ?? 0) + 1;
  }

  private zReportOf(tenantId: string, sessionId: string): Promise<CashSessionReportEntity | null> {
    return this.dataSource.getRepository(CashSessionReportEntity).findOne({ where: { tenantId, cashSessionId: sessionId, type: CashReportType.Z } });
  }

  private async sessionViews(tenantId: string, sessions: CashSessionEntity[]): Promise<CashSessionView[]> {
    if (sessions.length === 0) return [];
    const ids = sessions.map((session) => session.id);
    const [registers, zReports, totals, names] = await Promise.all([
      this.registerRepository.find({ where: { tenantId, id: In([...new Set(sessions.map((session) => session.cashRegisterId))]) } }),
      this.dataSource.getRepository(CashSessionReportEntity).find({
        where: { tenantId, cashSessionId: In(ids), type: CashReportType.Z },
        select: { id: true, cashSessionId: true, number: true },
      }),
      this.dataSource.query(
        `SELECT cash_session_id AS sessionId, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM sales WHERE tenant_id = ? AND cash_session_id IN (${ids.map(() => '?').join(', ')})
          GROUP BY cash_session_id`,
        [tenantId, ...ids],
      ) as Promise<Array<{ sessionId: string; count: string | number; total: string }>>,
      userDisplayNames(this.dataSource.manager, sessions.flatMap((session) => [session.openedByUserId, session.closedByUserId])),
    ]);
    const registerById = new Map(registers.map((register) => [register.id, register]));
    const zBySession = new Map(zReports.map((report) => [report.cashSessionId, report.number]));
    const totalsBySession = new Map(totals.map((row) => [String(row.sessionId), row]));
    return sessions.map((session) => {
      const register = registerById.get(session.cashRegisterId);
      const total = totalsBySession.get(session.id);
      return {
        ...session,
        registerCode: register?.code ?? null,
        registerName: register?.name ?? null,
        openedByName: names.get(session.openedByUserId) ?? null,
        closedByName: session.closedByUserId ? names.get(session.closedByUserId) ?? null : null,
        zNumber: zBySession.get(session.id) ?? null,
        salesTotal: centsText(decimalCents(total?.total ?? '0')),
        salesCount: Number(total?.count ?? 0),
      };
    });
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
