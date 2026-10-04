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
import { DataSource, Repository } from 'typeorm';
import { BranchEntity } from '../branches/entities/branch.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { InventoryMovementEntity, InventoryMovementType } from '../inventory/product/entities/inventory-movement.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { PurchaseReceiptEntity } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItemEntity } from './entities/purchase-receipt-item.entity';

const MAX_MONEY_CENTS = 99_999_999_999_999n;
const MAX_STOCK_MILLI = 999_999_999_999n;

type PricedPurchaseLine = {
  productId: string;
  quantityMilli: bigint;
  unitCostCents: bigint;
  taxRateHundredths: bigint;
  netCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
  stock: ProductBranchEntity;
};

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PurchaseReceiptEntity)
    private readonly receiptRepository: Repository<PurchaseReceiptEntity>,
  ) {}

  async receive(
    tenantId: string,
    actorUserId: string,
    idempotencyKey: string,
    dto: CreatePurchaseReceiptDto,
    allowedBranchId: string | null,
    auditContext: InventoryAuditContext = {},
  ): Promise<Record<string, unknown>> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez en la recepción.');
    }

    const normalizedLines = [...dto.lines]
      .map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity).toFixed(3),
        unitCost: Number(line.unitCost).toFixed(2),
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        branchId: dto.branchId,
        supplierPersonId: dto.supplierPersonId,
        sourceDocumentType: dto.sourceDocumentType?.trim() || null,
        sourceDocumentNumber: dto.sourceDocumentNumber?.trim() || null,
        lines: normalizedLines,
      }))
      .digest('hex');

    const prior = await this.receiptRepository.findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra recepción.');
      }
      return this.loadReceipt(tenantId, prior.id, allowedBranchId);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    let transactionStarted = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      transactionStarted = true;

      const tenant = await queryRunner.manager.findOne(TenantEntity, { where: { id: tenantId } });
      const branch = await queryRunner.manager.findOne(BranchEntity, {
        where: { id: dto.branchId, tenantId, status: true },
      });
      if (!tenant || !branch) {
        throw new NotFoundException('La sucursal no existe o no está activa en esta empresa.');
      }
      if (allowedBranchId && allowedBranchId !== branch.id) {
        throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
      }

      const supplier = await queryRunner.manager.findOne(PersonEntity, {
        where: { id: dto.supplierPersonId, tenantId, isActive: true },
      });
      if (!supplier || supplier.personType === PersonType.CUSTOMER) {
        throw new NotFoundException('El proveedor no existe, no está activo o no está habilitado para compras en esta empresa.');
      }

      const pricedLines: PricedPurchaseLine[] = [];
      for (const line of normalizedLines) {
        const stock = await queryRunner.manager
          .createQueryBuilder(ProductBranchEntity, 'stock')
          .leftJoinAndSelect('stock.product', 'product')
          .setLock('pessimistic_write')
          .where('stock.tenantId = :tenantId', { tenantId })
          .andWhere('stock.branchId = :branchId', { branchId: dto.branchId })
          .andWhere('stock.productId = :productId', { productId: line.productId })
          .andWhere('stock.isActive = true')
          .andWhere('product.status = true')
          .getOne();
        if (!stock?.product) {
          throw new NotFoundException('Uno de los productos no está activo en esta sucursal de la empresa.');
        }

        const quantityMilli = BigInt(Math.round(Number(line.quantity) * 1000));
        const unitCostCents = toMinorUnits(Number(line.unitCost));
        const taxRateHundredths = toMinorUnits(Number(stock.product.taxRate));
        const netCents = roundDivide(unitCostCents * quantityMilli, 1000n);
        const taxCents = roundDivide(netCents * taxRateHundredths, 10000n);
        const totalCents = netCents + taxCents;
        if (totalCents > MAX_MONEY_CENTS) {
          throw new BadRequestException('El importe de una línea excede el máximo admitido.');
        }
        pricedLines.push({
          productId: line.productId,
          quantityMilli,
          unitCostCents,
          taxRateHundredths,
          netCents,
          taxCents,
          totalCents,
          stock,
        });
      }

      // Locked product rows serialize retries and concurrent receipts for overlapping SKUs.
      const concurrentReceipt = await queryRunner.manager.findOne(PurchaseReceiptEntity, {
        where: { tenantId, idempotencyKey: key },
      });
      if (concurrentReceipt) {
        if (concurrentReceipt.requestFingerprint !== fingerprint) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otra recepción.');
        }
        await queryRunner.commitTransaction();
        transactionStarted = false;
        return this.loadReceipt(tenantId, concurrentReceipt.id, allowedBranchId);
      }

      const subtotalCents = pricedLines.reduce((sum, line) => sum + line.netCents, 0n);
      const taxTotalCents = pricedLines.reduce((sum, line) => sum + line.taxCents, 0n);
      const totalCents = subtotalCents + taxTotalCents;
      if (totalCents <= 0n || totalCents > MAX_MONEY_CENTS) {
        throw new BadRequestException('El total de la recepción está fuera del rango admitido.');
      }
      for (const line of pricedLines) {
        const beforeMilli = BigInt(Math.round(Number(line.stock.stock) * 1000));
        if (beforeMilli + line.quantityMilli > MAX_STOCK_MILLI) {
          throw new BadRequestException(`La recepción excede el stock máximo para el producto ${line.productId}.`);
        }
      }

      const receiptRepository = queryRunner.manager.getRepository(PurchaseReceiptEntity);
      const receipt = await receiptRepository.save(receiptRepository.create({
        tenantId,
        branchId: branch.id,
        supplierPersonId: supplier.id,
        currency: tenant.currencyCode,
        sourceDocumentType: dto.sourceDocumentType?.trim() || null,
        sourceDocumentNumber: dto.sourceDocumentNumber?.trim() || null,
        subtotal: formatCents(subtotalCents),
        taxTotal: formatCents(taxTotalCents),
        total: formatCents(totalCents),
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId,
      }));

      const itemRepository = queryRunner.manager.getRepository(PurchaseReceiptItemEntity);
      const items = pricedLines.map((line) => itemRepository.create({
        tenantId,
        purchaseReceiptId: receipt.id,
        productId: line.productId,
        skuSnapshot: line.stock.product.sku,
        nameSnapshot: line.stock.product.name,
        quantity: formatMilli(line.quantityMilli),
        unitCost: formatCents(line.unitCostCents),
        taxRate: formatCents(line.taxRateHundredths),
        netAmount: formatCents(line.netCents),
        taxAmount: formatCents(line.taxCents),
        total: formatCents(line.totalCents),
      }));
      await itemRepository.save(items);

      const movementRepository = queryRunner.manager.getRepository(InventoryMovementEntity);
      for (const line of pricedLines) {
        const beforeMilli = BigInt(Math.round(Number(line.stock.stock) * 1000));
        const afterMilli = beforeMilli + line.quantityMilli;
        const previousCostCents = toMinorUnits(Number(line.stock.costPrice));
        const weightedCostCents = beforeMilli === 0n
          ? line.unitCostCents
          : roundDivide(
            previousCostCents * beforeMilli + line.unitCostCents * line.quantityMilli,
            afterMilli,
          );
        line.stock.stock = Number(formatMilli(afterMilli));
        line.stock.costPrice = Number(formatCents(weightedCostCents));
        await queryRunner.manager.save(ProductBranchEntity, line.stock);
        await movementRepository.save(movementRepository.create({
          tenantId,
          productId: line.productId,
          branchId: branch.id,
          movementType: InventoryMovementType.PURCHASE,
          quantityDelta: formatMilli(line.quantityMilli),
          quantityBefore: formatMilli(beforeMilli),
          quantityAfter: formatMilli(afterMilli),
          reason: 'Ingreso por recepción de compra',
          referenceType: 'PURCHASE_RECEIPT',
          referenceId: receipt.id,
          idempotencyKey: `purchase:${receipt.id}:${line.productId}`,
          actorUserId,
        }));
      }

      await queryRunner.manager.save(AuditEventEntity, queryRunner.manager.create(AuditEventEntity, {
        tenantId,
        actorUserId,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        eventType: 'PURCHASE_RECEIVED',
        aggregateType: 'PURCHASE_RECEIPT',
        aggregateId: receipt.id,
        metadata: {
          branchId: branch.id,
          supplierPersonId: supplier.id,
          currency: receipt.currency,
          subtotal: receipt.subtotal,
          taxTotal: receipt.taxTotal,
          total: receipt.total,
          lineCount: items.length,
          sourceDocumentType: receipt.sourceDocumentType,
          sourceDocumentNumber: receipt.sourceDocumentNumber,
        },
      }));

      await queryRunner.commitTransaction();
      transactionStarted = false;
      return this.loadReceipt(tenantId, receipt.id, allowedBranchId);
    } catch (error) {
      if (transactionStarted) {
        await queryRunner.rollbackTransaction();
      }
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ER_DUP_ENTRY'
      ) {
        const existing = await this.receiptRepository.findOne({ where: { tenantId, idempotencyKey: key } });
        if (existing && existing.requestFingerprint === fingerprint) {
          return this.loadReceipt(tenantId, existing.id, allowedBranchId);
        }
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra recepción.');
      }
      this.logger.error('Error al registrar la recepción de compra', error);
      throw new InternalServerErrorException('No se pudo registrar la recepción de compra.');
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  async findOne(
    tenantId: string,
    receiptId: string,
    allowedBranchId: string | null = null,
  ): Promise<Record<string, unknown>> {
    const receipt = await this.receiptRepository.findOne({
      where: {
        id: receiptId,
        tenantId,
        ...(allowedBranchId ? { branchId: allowedBranchId } : {}),
      },
    });
    if (!receipt) {
      throw new NotFoundException('Recepción de compra no encontrada.');
    }
    return this.loadReceipt(tenantId, receipt.id, allowedBranchId);
  }

  private async loadReceipt(
    tenantId: string,
    receiptId: string,
    allowedBranchId: string | null,
  ): Promise<Record<string, unknown>> {
    const receipt = await this.receiptRepository.findOne({
      where: {
        id: receiptId,
        tenantId,
        ...(allowedBranchId ? { branchId: allowedBranchId } : {}),
      },
    });
    if (!receipt) {
      throw new NotFoundException('Recepción de compra no encontrada.');
    }
    const items = await this.dataSource.getRepository(PurchaseReceiptItemEntity).find({
      where: { tenantId, purchaseReceiptId: receiptId },
      order: { id: 'ASC' },
    });
    return { ...receipt, items };
  }
}

function toMinorUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException('Los importes deben ser números finitos no negativos.');
  }
  const [whole, fraction = ''] = value.toFixed(2).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function formatMilli(milli: bigint): string {
  const sign = milli < 0n ? '-' : '';
  const absolute = milli < 0n ? -milli : milli;
  return `${sign}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, '0')}`;
}
