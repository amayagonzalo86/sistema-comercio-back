import { ConflictException } from '@nestjs/common';
import { BranchEntity } from '../branches/entities/branch.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { SupplierPayableQueryDto } from './dto/supplier-payable-query.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { SupplierPayableEntity } from './entities/supplier-payable.entity';
import { SupplierPaymentAllocationEntity } from './entities/supplier-payment-allocation.entity';
import { SupplierPaymentEntity, SupplierPaymentMethod } from './entities/supplier-payment.entity';
import { SupplierAccountsService } from './supplier-accounts.service';

const tenantId = 'tenant-1';
const branchId = 'branch-1';
const supplierId = 'supplier-1';
const payableId = 'payable-1';

function setup() {
  const branch = { id: branchId, tenantId, status: true } as BranchEntity;
  const supplier = {
    id: supplierId,
    tenantId,
    isActive: true,
    personType: PersonType.SUPPLIER,
  } as PersonEntity;
  const payable = {
    id: payableId,
    tenantId,
    branchId,
    supplierPersonId: supplierId,
    currency: 'ARS',
    originalAmount: '100.00',
    amountPaid: '25.00',
  } as SupplierPayableEntity;
  let savedPayment: SupplierPaymentEntity | null = null;
  let savedAllocations: SupplierPaymentAllocationEntity[] = [];
  const paymentRepository = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('idempotencyKey' in where) return null;
      return savedPayment;
    }),
  };
  const payableRepository = { createQueryBuilder: jest.fn() };
  const paymentRepo = {
    create: jest.fn((value: Partial<SupplierPaymentEntity>) => value),
    save: jest.fn(async (value: Partial<SupplierPaymentEntity>) => {
      savedPayment = { ...value, id: 'payment-1' } as SupplierPaymentEntity;
      return savedPayment;
    }),
  };
  const allocationRepo = {
    create: jest.fn((value: Partial<SupplierPaymentAllocationEntity>) => value),
    save: jest.fn(async (value: SupplierPaymentAllocationEntity[]) => {
      savedAllocations = value.map((allocation, index) => ({
        ...allocation,
        id: `allocation-${index + 1}`,
      })) as SupplierPaymentAllocationEntity[];
      return savedAllocations;
    }),
  };
  const manager = {
    findOne: jest.fn(async (entity: Function) => {
      if (entity === BranchEntity) return branch;
      if (entity === PersonEntity) return supplier;
      if (entity === SupplierPaymentEntity) return null;
      return null;
    }),
    createQueryBuilder: jest.fn((entity: Function) => {
      const builder = {
        setLock: jest.fn(() => builder),
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        select: jest.fn(() => builder),
        getOne: jest.fn(async () => entity === SupplierPayableEntity ? payable : null),
      };
      return builder;
    }),
    getRepository: jest.fn((entity: Function) => {
      if (entity === SupplierPaymentEntity) return paymentRepo;
      if (entity === SupplierPaymentAllocationEntity) return allocationRepo;
      throw new Error('Repositorio no esperado en la prueba');
    }),
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
    getRepository: jest.fn(() => ({
      find: jest.fn(async () => savedAllocations),
    })),
  };
  const service = new SupplierAccountsService(
    dataSource as never,
    paymentRepository as never,
    payableRepository as never,
  );
  return { service, dataSource, queryRunner, paymentRepo, payable, getPayment: () => savedPayment, getAllocations: () => savedAllocations };
}

const dto: CreateSupplierPaymentDto = {
  branchId,
  supplierPersonId: supplierId,
  method: SupplierPaymentMethod.BANK_TRANSFER,
  externalReference: 'transfer-123',
  allocations: [{ payableId, amount: 50 }],
};

describe('SupplierAccountsService', () => {
  it('permite un pago parcial y registra asignación y auditoría', async () => {
    const h = setup();

    const payment = await h.service.createPayment(tenantId, 'actor-1', 'pay-key-1', dto, branchId);

    expect(payment).toMatchObject({ amount: '50.00', currency: 'ARS' });
    expect(h.getAllocations()).toHaveLength(1);
    expect(h.getAllocations()[0]).toMatchObject({ payableId, amount: '50.00' });
    expect(h.payable.amountPaid).toBe('75.00');
    expect(h.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(h.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rechaza pagar por encima del saldo pendiente', async () => {
    const h = setup('25.00');
    const overpayment = { ...dto, allocations: [{ payableId, amount: 80 }] };

    await expect(h.service.createPayment(tenantId, 'actor-1', 'pay-key-1', overpayment, branchId))
      .rejects.toBeInstanceOf(ConflictException);

    expect(h.paymentRepo.save).not.toHaveBeenCalled();
    expect(h.payable.amountPaid).toBe('25.00');
    expect(h.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('rechaza reutilizar idempotencia con distinto contenido antes de abrir transacción', async () => {
    const h = setup();
    const paymentRepo = (h.service as unknown as {
      paymentRepository: { findOne: jest.Mock };
    }).paymentRepository;
    paymentRepo.findOne.mockResolvedValue({
      id: 'existing-payment',
      requestFingerprint: 'f'.repeat(64),
    });

    await expect(h.service.createPayment(tenantId, 'actor-1', 'pay-key-1', dto, branchId))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});
