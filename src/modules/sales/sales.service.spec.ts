import { DataSource, Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { BranchEntity } from '../branches/entities/branch.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { InventoryMovementEntity } from '../inventory/product/entities/inventory-movement.entity';
import { SaleEntity } from './entities/sale.entity';
import { SaleItemEntity } from './entities/sale-item.entity';
import { SalePaymentEntity, SalePaymentMethod } from './entities/sale-payment.entity';
import { CashMovementEntity, CashMovementDirection, CashMovementType } from '../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../cash/entities/cash-session.entity';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';

const tenantId = 'tenant-0000-4000-8000-000000000001';
const branchId = 'branch-0000-4000-8000-000000000001';
const actorUserId = 'actor-0000-4000-8000-000000000001';
const cashSessionId = 'session-0000-4000-8000-000000000001';

function setup() {
  const cashSession = {
    id: cashSessionId,
    tenantId,
    branchId,
    currency: 'ARS',
    status: CashSessionStatus.OPEN,
    expectedAmount: '10.00',
  } as CashSessionEntity;
  const stock = {
    tenantId,
    branchId,
    productId: 'product-0000-4000-8000-000000000001',
    stock: '10.000',
    sellingPrice: '100.00',
    isActive: true,
    product: { sku: 'SKU-1', name: 'Producto', taxRate: '0.00', status: true },
  } as unknown as ProductBranchEntity;
  let savedSale: SaleEntity | null = null;
  const salesRepo = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      'id' in where ? savedSale : null),
  };
  const createRepository = (entity: Function) => ({
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (value: Record<string, unknown> | Record<string, unknown>[]) => {
      if (entity === SaleEntity) {
        savedSale = { ...(value as Record<string, unknown>), id: 'sale-0000-4000-8000-000000000001' } as SaleEntity;
        return savedSale;
      }
      if (entity === SalePaymentEntity) {
        const rows = value as Record<string, unknown>[];
        return rows.map((row, index) => ({ ...row, id: `payment-${index + 1}` }));
      }
      if (Array.isArray(value)) return value.map((row, index) => ({ ...row, id: `row-${index + 1}` }));
      return { ...value, id: 'cash-movement-1' };
    }),
    find: jest.fn(async () => []),
  });
  const repositories = new Map<Function, ReturnType<typeof createRepository>>([
    [SaleEntity, createRepository(SaleEntity)],
    [SaleItemEntity, createRepository(SaleItemEntity)],
    [SalePaymentEntity, createRepository(SalePaymentEntity)],
    [CashMovementEntity, createRepository(CashMovementEntity)],
    [InventoryMovementEntity, createRepository(InventoryMovementEntity)],
  ]);
  const queryBuilder = (result: unknown) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  });
  const stockBuilder = queryBuilder(stock);
  const cashBuilder = queryBuilder(cashSession);
  const manager = {
    findOne: jest.fn(async (entity: Function) => {
      if (entity === TenantEntity) return { id: tenantId, currencyCode: 'ARS' };
      if (entity === BranchEntity) return { id: branchId, tenantId, status: true };
      if (entity === SaleEntity) return null;
      return null;
    }),
    createQueryBuilder: jest.fn((entity: Function) =>
      entity === ProductBranchEntity ? stockBuilder : entity === CashSessionEntity ? cashBuilder : queryBuilder(null)),
    getRepository: jest.fn((entity: Function) => repositories.get(entity)),
    create: jest.fn((_entity: Function, value: Record<string, unknown>) => value),
    save: jest.fn(async (_entity: Function, value: Record<string, unknown>) => value),
  };
  const queryRunner = {
    manager,
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    isReleased: false,
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
    getRepository: jest.fn((entity: Function) => repositories.get(entity)),
  };
  const service = new SalesService(dataSource as never, salesRepo as never);
  const dto: CreateSaleDto = {
    branchId,
    lines: [{ productId: stock.productId, quantity: 1 }],
    payments: [{
      method: SalePaymentMethod.CASH,
      amount: 100,
      cashSessionId,
    }],
  };
  return { service, dto, cashSession, repositories, queryRunner, dataSource };
}

describe('SalesService cash settlement', () => {
  it('writes the cash inflow and sale atomically to the assigned open session', async () => {
    const h = setup();

    await h.service.create(tenantId, actorUserId, 'sale-key-1', h.dto, {}, branchId);

    expect(h.cashSession.expectedAmount).toBe('110.00');
    expect(h.repositories.get(CashMovementEntity)?.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      branchId,
      cashSessionId,
      type: CashMovementType.SALE,
      direction: CashMovementDirection.IN,
      amount: '100.00',
      sourceType: 'SALE_PAYMENT',
      sourceId: 'payment-1',
    }));
    expect(h.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(h.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('requires an open cash session for a new cash sale', async () => {
    const h = setup();
    h.dto.payments[0].cashSessionId = undefined;

    await expect(h.service.create(tenantId, actorUserId, 'sale-key-2', h.dto, {}, branchId))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});
