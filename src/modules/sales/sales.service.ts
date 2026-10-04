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
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { BranchEntity } from '../branches/entities/branch.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { InventoryMovementEntity, InventoryMovementType } from '../inventory/product/entities/inventory-movement.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { SaleEntity, SaleFiscalStatus } from './entities/sale.entity';
import { SaleItemEntity } from './entities/sale-item.entity';
import { SalePaymentEntity } from './entities/sale-payment.entity';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CashMovementDirection, CashMovementEntity, CashMovementType } from '../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../cash/entities/cash-session.entity';

const MAX_MONEY_CENTS = 99_999_999_999_999n;

type PricedLine = {
  line: CreateSaleDto['lines'][number];
  stock: ProductBranchEntity;
  quantityMilli: bigint;
  unitPriceCents: bigint;
  taxRateHundredths: bigint;
  netCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
};

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SaleEntity)
    private readonly saleRepository: Repository<SaleEntity>,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    idempotencyKey: string,
    dto: CreateSaleDto,
    auditContext: InventoryAuditContext = {},
    allowedBranchId: string | null = null,
  ): Promise<Record<string, unknown>> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez en la venta.');
    }

    const normalizedLines = [...dto.lines]
      .map((line) => ({ productId: line.productId, quantity: Number(line.quantity).toFixed(3) }))
      .sort((a, b) => a.productId.localeCompare(b.productId));
    const normalizedPayments = [...dto.payments]
      .map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount).toFixed(2),
        ...(payment.cashSessionId ? { cashSessionId: payment.cashSessionId } : {}),
      }))
      .sort((a, b) =>
        a.method.localeCompare(b.method) ||
        a.amount.localeCompare(b.amount) ||
        (a.cashSessionId ?? '').localeCompare(b.cashSessionId ?? ''),
      );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        branchId: dto.branchId,
        customerPersonId: dto.customerPersonId ?? null,
        lines: normalizedLines,
        payments: normalizedPayments,
      }))
      .digest('hex');

    const prior = await this.saleRepository.findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra venta.');
      }
      return this.loadSale(tenantId, prior.id);
    }

    if (dto.payments.some((payment) => payment.method === 'CASH' && !payment.cashSessionId)) {
      throw new BadRequestException('Cada cobro en efectivo debe indicar cashSessionId.');
    }
    if (dto.payments.some((payment) => payment.method !== 'CASH' && payment.cashSessionId)) {
      throw new BadRequestException('cashSessionId solo corresponde a pagos en efectivo.');
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

      if (dto.customerPersonId) {
        const customer = await queryRunner.manager.findOne(PersonEntity, {
          where: { id: dto.customerPersonId, tenantId, isActive: true },
          select: { id: true, tenantId: true, isActive: true, personType: true },
        });
        if (!customer || customer.personType === PersonType.SUPPLIER) {
          throw new NotFoundException('El cliente no existe, no está activo o no está habilitado para ventas en esta empresa.');
        }
      }

      const pricedLines: PricedLine[] = [];
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
        if (!stock || !stock.product) {
          throw new NotFoundException('Uno de los productos no está activo en esta sucursal.');
        }

        const quantityMilli = BigInt(Math.round(Number(line.quantity) * 1000));
        const unitPriceCents = toMinorUnits(Number(stock.sellingPrice));
        const taxRateHundredths = toMinorUnits(Number(stock.product.taxRate));
        const netCents = roundDivide(unitPriceCents * quantityMilli, 1000n);
        const taxCents = roundDivide(netCents * taxRateHundredths, 10000n);
        const totalCents = netCents + taxCents;
        if (totalCents > MAX_MONEY_CENTS) {
          throw new BadRequestException('El importe de una línea excede el máximo admitido.');
        }
        pricedLines.push({
          line: { productId: line.productId, quantity: Number(line.quantity) },
          stock,
          quantityMilli,
          unitPriceCents,
          taxRateHundredths,
          netCents,
          taxCents,
          totalCents,
        });
      }

      // A second read after taking stock locks makes same-key concurrent requests replay safely.
      const concurrentSale = await queryRunner.manager.findOne(SaleEntity, {
        where: { tenantId, idempotencyKey: key },
      });
      if (concurrentSale) {
        if (concurrentSale.requestFingerprint !== fingerprint) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otra venta.');
        }
        await queryRunner.commitTransaction();
        transactionStarted = false;
        return this.loadSale(tenantId, concurrentSale.id);
      }

      const subtotalCents = pricedLines.reduce((sum, line) => sum + line.netCents, 0n);
      const taxTotalCents = pricedLines.reduce((sum, line) => sum + line.taxCents, 0n);
      const totalCents = subtotalCents + taxTotalCents;
      if (totalCents <= 0n || totalCents > MAX_MONEY_CENTS) {
        throw new BadRequestException('El total de la venta está fuera del rango admitido.');
      }
      const paymentCents = dto.payments.reduce(
        (sum, payment) => sum + toMinorUnits(Number(payment.amount)),
        0n,
      );
      if (paymentCents !== totalCents) {
        throw new BadRequestException('La suma de los medios de pago debe coincidir con el total de la venta.');
      }

      for (const line of pricedLines) {
        const availableMilli = BigInt(Math.round(Number(line.stock.stock) * 1000));
        if (line.quantityMilli > availableMilli) {
          throw new BadRequestException(`Stock insuficiente para el producto ${line.line.productId}.`);
        }
      }

      const cashSessions = new Map<string, CashSessionEntity>();
      const cashSessionIds = [...new Set(
        dto.payments
          .filter((payment) => payment.method === 'CASH' && payment.cashSessionId)
          .map((payment) => payment.cashSessionId as string),
      )].sort();
      for (const cashSessionId of cashSessionIds) {
        const cashSession = await queryRunner.manager
          .createQueryBuilder(CashSessionEntity, 'cashSession')
          .setLock('pessimistic_write')
          .where('cashSession.tenantId = :tenantId', { tenantId })
          .andWhere('cashSession.id = :cashSessionId', { cashSessionId })
          .andWhere('cashSession.branchId = :branchId', { branchId: branch.id })
          .andWhere('cashSession.status = :status', { status: CashSessionStatus.OPEN })
          .getOne();
        if (!cashSession) {
          throw new NotFoundException('La sesión de caja no existe, está cerrada o no corresponde a la sucursal de la venta.');
        }
        if (cashSession.currency !== tenant.currencyCode) {
          throw new BadRequestException('La moneda de la sesión de caja debe coincidir con la moneda de la venta.');
        }
        cashSessions.set(cashSession.id, cashSession);
      }

      const saleRepository = queryRunner.manager.getRepository(SaleEntity);
      const sale = await saleRepository.save(saleRepository.create({
        tenantId,
        branchId: branch.id,
        customerPersonId: dto.customerPersonId ?? null,
        currency: tenant.currencyCode,
        subtotal: formatCents(subtotalCents),
        taxTotal: formatCents(taxTotalCents),
        total: formatCents(totalCents),
        fiscalStatus: SaleFiscalStatus.NOT_ISSUED,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId,
      }));

      const itemRepository = queryRunner.manager.getRepository(SaleItemEntity);
      const items = pricedLines.map(({ line, stock, quantityMilli, unitPriceCents, taxRateHundredths, netCents, taxCents, totalCents: lineTotal }) =>
        itemRepository.create({
          tenantId,
          saleId: sale.id,
          productId: line.productId,
          skuSnapshot: stock.product.sku,
          nameSnapshot: stock.product.name,
          quantity: formatMilli(quantityMilli),
          unitPrice: formatCents(unitPriceCents),
          taxRate: formatCents(taxRateHundredths),
          netAmount: formatCents(netCents),
          taxAmount: formatCents(taxCents),
          total: formatCents(lineTotal),
        }),
      );
      await itemRepository.save(items);

      const paymentRepository = queryRunner.manager.getRepository(SalePaymentEntity);
      const payments = dto.payments.map((payment) =>
        paymentRepository.create({
          tenantId,
          saleId: sale.id,
          method: payment.method,
          amount: formatCents(toMinorUnits(Number(payment.amount))),
          currency: tenant.currencyCode,
          externalReference: null,
        }),
      );
      const savedPayments = await paymentRepository.save(payments);
      const cashMovementRepository = queryRunner.manager.getRepository(CashMovementEntity);
      for (let index = 0; index < dto.payments.length; index += 1) {
        const requestPayment = dto.payments[index];
        if (requestPayment.method !== 'CASH') continue;

        const payment = savedPayments[index];
        const cashSession = cashSessions.get(requestPayment.cashSessionId as string);
        if (!payment || !cashSession) {
          throw new InternalServerErrorException('No se pudo asociar el cobro en efectivo a una sesión de caja.');
        }

        const amountCents = toMinorUnits(Number(payment.amount));
        const currentCashCents = parseDecimalCents(cashSession.expectedAmount);
        const nextCashCents = currentCashCents + amountCents;
        if (nextCashCents > MAX_MONEY_CENTS) {
          throw new BadRequestException('El saldo de caja excede el máximo monetario admitido.');
        }

        const cashMovementKey = `sale-payment:${payment.id}`;
        const requestFingerprint = createHash('sha256')
          .update(JSON.stringify({ saleId: sale.id, paymentId: payment.id, amount: payment.amount }))
          .digest('hex');
        await cashMovementRepository.save(cashMovementRepository.create({
          tenantId,
          branchId: branch.id,
          cashSessionId: cashSession.id,
          type: CashMovementType.SALE,
          direction: CashMovementDirection.IN,
          amount: payment.amount,
          currency: payment.currency,
          reason: 'Cobro de venta',
          sourceType: 'SALE_PAYMENT',
          sourceId: payment.id,
          idempotencyKey: cashMovementKey,
          requestFingerprint,
          actorUserId,
        }));
        cashSession.expectedAmount = formatCents(nextCashCents);
        await queryRunner.manager.save(CashSessionEntity, cashSession);
        await queryRunner.manager.save(AuditEventEntity, queryRunner.manager.create(AuditEventEntity, {
          tenantId,
          actorUserId,
          requestId: auditContext.requestId,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          eventType: 'SALE_CASH_RECEIVED',
          aggregateType: 'SALE_PAYMENT',
          aggregateId: payment.id,
          metadata: { saleId: sale.id, branchId: branch.id, cashSessionId: cashSession.id, amount: payment.amount, currency: payment.currency },
        }));
      }

      const movementRepository = queryRunner.manager.getRepository(InventoryMovementEntity);
      for (const line of pricedLines) {
        const beforeMilli = BigInt(Math.round(Number(line.stock.stock) * 1000));
        const afterMilli = beforeMilli - line.quantityMilli;
        line.stock.stock = Number(afterMilli) / 1000;
        await queryRunner.manager.save(ProductBranchEntity, line.stock);
        await movementRepository.save(movementRepository.create({
          tenantId,
          productId: line.line.productId,
          branchId: branch.id,
          movementType: InventoryMovementType.SALE,
          quantityDelta: formatMilli(-line.quantityMilli),
          quantityBefore: formatMilli(beforeMilli),
          quantityAfter: formatMilli(afterMilli),
          reason: 'Salida por venta completada',
          referenceType: 'SALE',
          referenceId: sale.id,
          idempotencyKey: `sale:${sale.id}:${line.line.productId}`,
          actorUserId,
        }));
      }

      await queryRunner.manager.save(AuditEventEntity, queryRunner.manager.create(AuditEventEntity, {
        tenantId,
        actorUserId,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        eventType: 'SALE_COMPLETED',
        aggregateType: 'SALE',
        aggregateId: sale.id,
        metadata: {
          branchId: branch.id,
          currency: tenant.currencyCode,
          subtotal: sale.subtotal,
          taxTotal: sale.taxTotal,
          total: sale.total,
          lineCount: items.length,
          paymentCount: payments.length,
          fiscalStatus: sale.fiscalStatus,
        },
      }));

      await queryRunner.commitTransaction();
      transactionStarted = false;
      return this.loadSale(tenantId, sale.id);
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
        const existing = await this.saleRepository.findOne({ where: { tenantId, idempotencyKey: key } });
        if (existing && existing.requestFingerprint === fingerprint) {
          return this.loadSale(tenantId, existing.id);
        }
        throw new ConflictException('Idempotency-Key ya fue utilizado para otra venta.');
      }
      this.logger.error('Error al registrar la venta', error);
      throw new InternalServerErrorException('No se pudo registrar la venta.');
    } finally {
      if (queryRunner.isReleased === false) {
        await queryRunner.release();
      }
    }
  }

  async findOne(
    tenantId: string,
    saleId: string,
    allowedBranchId: string | null = null,
  ): Promise<Record<string, unknown>> {
    const sale = await this.saleRepository.findOne({
      where: {
        id: saleId,
        tenantId,
        ...(allowedBranchId ? { branchId: allowedBranchId } : {}),
      },
    });
    if (!sale) {
      throw new NotFoundException('Venta no encontrada.');
    }
    return this.loadSale(tenantId, sale.id);
  }

  private async loadSale(tenantId: string, saleId: string): Promise<Record<string, unknown>> {
    const sale = await this.saleRepository.findOne({ where: { id: saleId, tenantId } });
    if (!sale) {
      throw new NotFoundException('Venta no encontrada.');
    }
    const [items, payments] = await Promise.all([
      this.dataSource.getRepository(SaleItemEntity).find({
        where: { tenantId, saleId },
        order: { id: 'ASC' },
      }),
      this.dataSource.getRepository(SalePaymentEntity).find({
        where: { tenantId, saleId },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return { ...sale, items, payments };
  }
}

function toMinorUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException('Los importes deben ser números finitos no negativos.');
  }
  const [whole, fraction = ''] = value.toFixed(2).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}


function parseDecimalCents(value: string): bigint {
  if (!/^(?:0|[1-9]\\d{0,11})\\.\\d{2}$/.test(value)) {
    throw new BadRequestException('El saldo de caja tiene un formato inválido.');
  }
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
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
