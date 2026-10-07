import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CashMovementEntity } from './entities/cash-movement.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashSessionEntity, CashSessionStatus } from './entities/cash-session.entity';
import { CashManualMovementDirection, CashManualMovementType } from './dto/create-cash-movement.dto';
import { CashService } from './cash.service';
import { TenantMembershipEntity, TenantRole, MembershipStatus } from '../platform/entities/tenant-membership.entity';
import { UserEntity } from '../users/entities/user.entity';
import { TenantEntity, TenantStatus } from '../platform/entities/tenant.entity';

function setup(expectedAmount = '10.00') {
  const session = {
    id: 'session-0000-4000-8000-000000000001',
    tenantId: 'tenant-0000-4000-8000-000000000001',
    branchId: 'branch-0000-4000-8000-000000000001',
    cashRegisterId: 'register-0000-4000-8000-000000000001',
    status: CashSessionStatus.OPEN,
    currency: 'ARS',
    expectedAmount,
  } as CashSessionEntity;

  const makeQueryBuilder = (result: unknown) => ({
    setLock: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  });
  const queryBuilder = makeQueryBuilder(session);
  const membershipBuilder = makeQueryBuilder({
    tenantId: session.tenantId,
    userId: 'actor-0000-4000-8000-000000000001',
    branchId: session.branchId,
    role: TenantRole.CASHIER,
    status: MembershipStatus.ACTIVE,
  });
  const userBuilder = makeQueryBuilder({ id: 'actor-0000-4000-8000-000000000001', isActive: true });
  const tenantBuilder = makeQueryBuilder({ id: session.tenantId, status: TenantStatus.TRIAL });
  const movement = { id: 'movement-0000-4000-8000-000000000001' };
  const movementRepository = {
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => ({ ...value, ...movement })),
  };
  const manager = {
    createQueryBuilder: jest.fn((entity: unknown) => entity === TenantMembershipEntity
      ? membershipBuilder
      : entity === UserEntity
        ? userBuilder
        : entity === TenantEntity
          ? tenantBuilder
          : queryBuilder),
    findOne: jest.fn().mockResolvedValue(null),
    getRepository: jest.fn().mockReturnValue(movementRepository),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    save: jest.fn().mockImplementation(async (_entity: unknown, value: unknown) => value),
  };
  const queryRunner = {
    manager,
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isReleased: false,
  };
  const dataSource = {
    createQueryRunner: jest.fn().mockReturnValue(queryRunner),
  };
  const service = new CashService(
    dataSource as unknown as DataSource,
    {} as Repository<CashRegisterEntity>,
    {} as Repository<CashSessionEntity>,
    {} as Repository<CashMovementEntity>,
  );

  return { service, session, queryBuilder, manager, queryRunner, movementRepository };
}

describe('CashService', () => {
  it('serializes each manual movement through the locked session balance', async () => {
    const { service, session, queryRunner, movementRepository } = setup();

    const result = await service.recordMovement(
      session.tenantId,
      'actor-0000-4000-8000-000000000001',
      session.id,
      'movement-key-1',
      {
        type: CashManualMovementType.INCOME,
        direction: CashManualMovementDirection.IN,
        amount: '5.25',
        reason: 'Cambio inicial',
      },
      session.branchId,
      {},
    );

    expect(result.expectedAmount).toBe('15.25');
    expect(movementRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: session.tenantId,
      cashSessionId: session.id,
      amount: '5.25',
      direction: 'IN',
      currency: 'ARS',
    }));
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rejects an outflow that would make the locked balance negative', async () => {
    const { service, session, queryRunner, movementRepository, manager } = setup('10.00');

    await expect(service.recordMovement(
      session.tenantId,
      'actor-0000-4000-8000-000000000001',
      session.id,
      'movement-key-2',
      {
        type: CashManualMovementType.EXPENSE,
        direction: CashManualMovementDirection.OUT,
        amount: '10.01',
        reason: 'Gasto sin saldo',
      },
      session.branchId,
      {},
    )).rejects.toBeInstanceOf(ConflictException);

    expect(movementRepository.save).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('locks and filters session access by tenant and assigned branch', async () => {
    const { service, session, queryBuilder } = setup();
    await service.recordMovement(
      session.tenantId,
      'actor-0000-4000-8000-000000000001',
      session.id,
      'movement-key-3',
      {
        type: CashManualMovementType.INCOME,
        direction: CashManualMovementDirection.IN,
        amount: '1.00',
        reason: 'Ingreso',
      },
      session.branchId,
      {},
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('session.tenantId = :tenantId', { tenantId: session.tenantId });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('session.id = :sessionId', { sessionId: session.id });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('session.branchId = :allowedBranchId', { allowedBranchId: session.branchId });
  });
});
