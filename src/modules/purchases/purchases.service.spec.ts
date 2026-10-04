import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { BranchEntity } from '../branches/entities/branch.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { InventoryMovementEntity, InventoryMovementType } from '../inventory/product/entities/inventory-movement.entity';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { PurchaseReceiptEntity } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItemEntity } from './entities/purchase-receipt-item.entity';
import { SupplierPayableEntity } from './entities/supplier-payable.entity';
import { PurchasesService } from './purchases.service';

const tenantId = 'tenant-1';
const branchId = 'branch-1';
const supplierId = 'supplier-1';
const productId = 'product-1';

function setup(supplierType = PersonType.SUPPLIER) {
  const tenant = { id: tenantId, currencyCode: 'ARS' } as TenantEntity;
  const branch = { id: branchId, tenantId, status: true } as BranchEntity;
  const supplier = {
    id: supplierId,
    tenantId,
    isActive: true,
    personType: supplierType,
  } as PersonEntity;
  const stock = {
    tenantId,
    productId,
    branchId,
    isActive: true,
    stock: 10,
    costPrice: 50,
    product: { id: productId, sku: 'SKU-1', name: 'Producto', taxRate: 21, status: true },
  } as ProductBranchEntity;
  const savedItems: PurchaseReceiptItemEntity[] = [];
  const savedPayables: SupplierPayableEntity[] = [];
  const savedMovements: InventoryMovementEntity[] = [];
  const receipt = {
    id: 'receipt-1',
    tenantId,
    branchId,
    supplierPersonId: supplierId,
    currency: 'ARS',
    subtotal: '200.00',
    taxTotal: '42.00',
    total: '242.00',
    requestFingerprint: '',
  } as PurchaseReceiptEntity;

  const receiptRepository = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('idempotencyKey' in where) {
        return receipt.requestFingerprint ? receipt : null;
      }
      return receipt;
    }),
  };
  let concurrentLookupCount = 0;
  const transactionReceiptRepository = {
    create: jest.fn((value: Partial<PurchaseReceiptEntity>) => value),
    save: jest.fn(async (value: Partial<PurchaseReceiptEntity>) => {
      Object.assign(receipt, value);
      receipt.id = 'receipt-1';
      return receipt;
    }),
  };
  const payableRepository = {
    create: jest.fn((value: Partial<SupplierPayableEntity>) => value),
    save: jest.fn(async (value: SupplierPayableEntity) => {
      savedPayables.push(value);
      return value;
    }),
  };
  const transactionItemRepository = {
    create: jest.fn((value: Partial<PurchaseReceiptItemEntity>) => value),
    save: jest.fn(async (value: PurchaseReceiptItemEntity[]) => {
      savedItems.push(...value);
      return value;
    }),
  };
  const movementRepository = {
    create: jest.fn((value: Partial<InventoryMovementEntity>) => value),
    save: jest.fn(async (value: InventoryMovementEntity) => {
      savedMovements.push(value);
      return value;
    }),
  };

  const manager = {
    findOne: jest.fn(async (entity: Function) => {
      if (entity === TenantEntity) return tenant;
      if (entity === BranchEntity) return branch;
      if (entity === PersonEntity) return supplier;
      if (entity === PurchaseReceiptEntity) {
        concurrentLookupCount += 1;
        return null;
      }
      return null;
    }),
    createQueryBuilder: jest.fn(() => {
      const builder = {
        leftJoinAndSelect: jest.fn(() => builder),
        setLock: jest.fn(() => builder),
        where: jest.fn(() => builder),
        andWhere: jest.fn(() => builder),
        getOne: jest.fn(async () => stock),
      };
      return builder;
    }),
    getRepository: jest.fn((entity: Function) => {
      if (entity === PurchaseReceiptEntity) return transactionReceiptRepository;
      if (entity === PurchaseReceiptItemEntity) return transactionItemRepository;
      if (entity === SupplierPayableEntity) return payableRepository;
      if (entity === InventoryMovementEntity) return movementRepository;
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
      find: jest.fn(async () => savedItems),
    })),
  };
  const service = new PurchasesService(dataSource as never, receiptRepository as never);
  return {
    service,
    stock,
    receipt,
    receiptRepository,
    dataSource,
    queryRunner,
    savedItems,
    savedPayables,
    savedMovements,
    getConcurrentLookupCount: () => concurrentLookupCount,
  };
}

const dto: CreatePurchaseReceiptDto = {
  branchId,
  supplierPersonId: supplierId,
  sourceDocumentType: 'FACTURA',
  sourceDocumentNumber: 'A-0001-00000001',
  lines: [{ productId, quantity: 2, unitCost: 100, taxRate: 21 }],
};

describe('PurchasesService', () => {
  it('registra compra, stock, costo ponderado, movimiento y auditoría atómicamente', async () => {
    const h = setup();
    const result = await h.service.receive(tenantId, 'actor-1', 'request-key-1', dto, null);

    expect(result).toMatchObject({ total: '242.00', currency: 'ARS' });
    expect(h.stock.stock).toBe(12);
    expect(h.stock.costPrice).toBe(58.33);
    expect(h.savedPayables).toHaveLength(1);
    expect(h.savedPayables[0]).toMatchObject({ originalAmount: '242.00', purchaseReceiptId: 'receipt-1' });
    expect(h.savedItems).toHaveLength(1);
    expect(h.savedItems[0]).toMatchObject({
      quantity: '2.000',
      unitCost: '100.00',
      taxAmount: '42.00',
      total: '242.00',
    });
    expect(h.savedMovements).toHaveLength(1);
    expect(h.savedMovements[0]).toMatchObject({
      movementType: InventoryMovementType.PURCHASE,
      quantityBefore: '10.000',
      quantityAfter: '12.000',
    });
    expect(h.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(h.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rechaza una ficha solo cliente y revierte la transacción', async () => {
    const h = setup(PersonType.CUSTOMER);

    await expect(h.service.receive(tenantId, 'actor-1', 'request-key-1', dto, null))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(h.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(h.savedMovements).toHaveLength(0);
  });

  it('rechaza reutilizar una clave idempotente con otro contenido', async () => {
    const h = setup();
    h.receipt.requestFingerprint = 'f'.repeat(64);

    await expect(h.service.receive(tenantId, 'actor-1', 'request-key-1', dto, null))
      .rejects.toBeInstanceOf(ConflictException);

    expect(h.dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});
