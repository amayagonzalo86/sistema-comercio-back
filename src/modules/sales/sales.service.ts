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
import { CreateSaleDto, QuoteSaleDto } from './dto/create-sale.dto';
import { CashMovementDirection, CashMovementEntity, CashMovementType } from '../cash/entities/cash-movement.entity';
import { CashSessionEntity, CashSessionStatus } from '../cash/entities/cash-session.entity';
import { FiscalProfileEntity } from '../platform/entities/fiscal-profile.entity';
import { parseTaxCondition, TaxConditionEnum } from '../../common/enums/afip.enum';
import { isValidCuit } from '../../common/validators/argentina-id';
import {
  computeVatLine,
  FISCAL_TRANSPARENCY_TITLE,
  MONOTRIBUTO_CREDIT_LEGEND,
  percentToBasisPoints,
  resolveVatPolicy,
  summarizeVat,
  VatLineResult,
  VatPolicy,
  VatTreatment,
  VoucherClass,
} from '../fiscal/vat/vat';
import { loadActivePromotions } from '../marketing/promotion-loader';
import { AppliedPromotion, bestPromotion } from '../marketing/domain/promotions';
import { localToday, localWeekday } from '../reports/domain/period';

const MAX_MONEY_CENTS = 99_999_999_999_999n;

export interface SaleQuote {
  voucherClass: VoucherClass;
  vatChargeMode: string;
  requiresCustomerCuit: boolean;
  customerCuitValid: boolean;
  lines: Array<Record<string, unknown>>;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  vatBreakdown: Array<{ arcaVatRateId: number; rate: string; base: string; vat: string }>;
  fiscalNotes: Record<string, unknown>;
}

type PricedLine = {
  line: CreateSaleDto['lines'][number];
  stock: ProductBranchEntity;
  quantityMilli: bigint;
  unitPriceCents: bigint;
  vatTreatment: VatTreatment;
  vat: VatLineResult;
  promotion: AppliedPromotion | null;
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
        vatExemption: dto.vatExemption
          ? { reason: dto.vatExemption.reason, note: dto.vatExemption.note.trim() }
          : null,
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

      let customerCondition = TaxConditionEnum.CONSUMIDOR_FINAL;
      let customerTaxId: string | null = null;
      if (dto.customerPersonId) {
        const customer = await queryRunner.manager.findOne(PersonEntity, {
          where: { id: dto.customerPersonId, tenantId, isActive: true },
          select: { id: true, tenantId: true, isActive: true, personType: true, vatCondition: true, nationalId: true },
        });
        if (!customer || customer.personType === PersonType.SUPPLIER) {
          throw new NotFoundException('El cliente no existe, no está activo o no está habilitado para ventas en esta empresa.');
        }
        customerCondition = parseTaxCondition(customer.vatCondition) ?? TaxConditionEnum.CONSUMIDOR_FINAL;
        customerTaxId = customer.nationalId ?? null;
      }

      const issuerCondition = await this.resolveIssuerCondition(queryRunner.manager, tenantId);
      const policy = this.resolvePolicy(issuerCondition, customerCondition, dto);
      if (policy.requiresCustomerCuit && !isValidCuit(customerTaxId)) {
        throw new BadRequestException(
          `Un comprobante ${policy.voucherClass} requiere que el cliente tenga una CUIT válida cargada.`,
        );
      }

      // Promociones vigentes hoy (fecha y día de la semana en la zona horaria de la empresa).
      const timeZone = tenant.timeZone || 'America/Argentina/Buenos_Aires';
      const promotions = await loadActivePromotions(queryRunner.manager, tenantId, localToday(timeZone));
      const weekday = localWeekday(timeZone);

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
        const vatTreatment = stock.product.vatTreatment ?? VatTreatment.TAXED;
        const promotion = bestPromotion(
          promotions,
          {
            productId: line.productId,
            category: stock.product.category ?? null,
            brand: stock.product.brand ?? null,
            branchId: branch.id,
            quantityMilli,
            unitPriceCents,
          },
          weekday,
        );
        let vat: VatLineResult;
        try {
          vat = computeVatLine({
            discountCents: promotion?.discountCents ?? 0n,
            unitPriceCents,
            quantityMilli,
            treatment: vatTreatment,
            rateBasisPoints: percentToBasisPoints(Number(stock.product.taxRate)),
            priceIncludesVat: Boolean(stock.product.priceIncludesVat),
            chargeMode: policy.chargeMode,
          });
        } catch (error) {
          if (error instanceof RangeError) {
            throw new BadRequestException(
              `El producto ${stock.product.sku} tiene una configuración de IVA inválida: ${error.message}`,
            );
          }
          throw error;
        }
        if (vat.totalCents > MAX_MONEY_CENTS) {
          throw new BadRequestException('El importe de una línea excede el máximo admitido.');
        }
        pricedLines.push({
          line: { productId: line.productId, quantity: Number(line.quantity) },
          stock,
          quantityMilli,
          unitPriceCents,
          vatTreatment,
          vat,
          promotion,
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

      const vatSummary = summarizeVat(pricedLines.map((line) => line.vat));
      const taxTotalCents = vatSummary.vatCents;
      const subtotalCents = vatSummary.netCents + vatSummary.exemptCents + vatSummary.notTaxedCents;
      const totalCents = vatSummary.totalCents;
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
        netTaxedTotal: formatCents(vatSummary.netCents),
        discountTotal: formatCents(pricedLines.reduce((sum, item) => sum + (item.promotion?.discountCents ?? 0n), 0n)),
        exemptTotal: formatCents(vatSummary.exemptCents),
        notTaxedTotal: formatCents(vatSummary.notTaxedCents),
        voucherClass: policy.voucherClass,
        vatChargeMode: policy.chargeMode,
        issuerVatCondition: issuerCondition,
        customerVatCondition: customerCondition,
        vatExemptionReason: dto.vatExemption?.reason ?? null,
        vatExemptionNote: dto.vatExemption?.note.trim() ?? null,
        fiscalStatus: SaleFiscalStatus.NOT_ISSUED,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId,
      }));

      const itemRepository = queryRunner.manager.getRepository(SaleItemEntity);
      const items = pricedLines.map(({ line, stock, quantityMilli, unitPriceCents, vatTreatment, vat, promotion }) =>
        itemRepository.create({
          tenantId,
          saleId: sale.id,
          productId: line.productId,
          skuSnapshot: stock.product.sku,
          nameSnapshot: stock.product.name,
          quantity: formatMilli(quantityMilli),
          unitPrice: formatCents(unitPriceCents),
          taxRate: formatCents(vat.appliedRateBasisPoints),
          netAmount: formatCents(vat.netCents),
          taxAmount: formatCents(vat.vatCents),
          exemptAmount: formatCents(vat.exemptCents),
          notTaxedAmount: formatCents(vat.notTaxedCents),
          vatTreatment,
          arcaVatRateId: vat.arcaVatRateId,
          priceIncludesVat: Boolean(stock.product.priceIncludesVat),
          total: formatCents(vat.totalCents),
          unitCost: formatCents(costSnapshotCents(stock.costPrice)),
          discountAmount: formatCents(promotion?.discountCents ?? 0n),
          promotionId: promotion?.promotionId ?? null,
          promotionName: promotion?.name.slice(0, 120) ?? null,
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
          voucherClass: policy.voucherClass,
          vatChargeMode: policy.chargeMode,
          vatExemptionReason: sale.vatExemptionReason ?? null,
          vatExemptionNote: sale.vatExemptionNote ?? null,
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
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
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

  /**
   * Cotiza una venta con las mismas reglas que create(): precio de la sucursal, promociones vigentes,
   * IVA según emisor/cliente y clase de comprobante. No reserva stock ni registra nada.
   */
  async quote(tenantId: string, dto: QuoteSaleDto, allowedBranchId: string | null = null): Promise<SaleQuote> {
    if (allowedBranchId && allowedBranchId !== dto.branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez en la venta.');
    }
    const manager = this.dataSource.manager;
    const [tenant, branch] = await Promise.all([
      manager.findOne(TenantEntity, { where: { id: tenantId } }),
      manager.findOne(BranchEntity, { where: { id: dto.branchId, tenantId, status: true } }),
    ]);
    if (!tenant || !branch) {
      throw new NotFoundException('La sucursal no existe o no está activa en esta empresa.');
    }

    let customerCondition = TaxConditionEnum.CONSUMIDOR_FINAL;
    let customerTaxId: string | null = null;
    if (dto.customerPersonId) {
      const customer = await manager.findOne(PersonEntity, {
        where: { id: dto.customerPersonId, tenantId, isActive: true },
        select: { id: true, personType: true, vatCondition: true, nationalId: true },
      });
      if (!customer || customer.personType === PersonType.SUPPLIER) {
        throw new NotFoundException('El cliente no existe, no está activo o no está habilitado para ventas.');
      }
      customerCondition = parseTaxCondition(customer.vatCondition) ?? TaxConditionEnum.CONSUMIDOR_FINAL;
      customerTaxId = customer.nationalId ?? null;
    }
    const issuerCondition = await this.resolveIssuerCondition(manager, tenantId);
    const policy = this.resolvePolicy(issuerCondition, customerCondition, dto as CreateSaleDto);

    const timeZone = tenant.timeZone || 'America/Argentina/Buenos_Aires';
    const promotions = await loadActivePromotions(manager, tenantId, localToday(timeZone));
    const weekday = localWeekday(timeZone);

    const stocks = await manager.find(ProductBranchEntity, {
      where: { tenantId, branchId: dto.branchId, productId: In(dto.lines.map((line) => line.productId)), isActive: true },
      relations: { product: true },
    });
    const byProduct = new Map(stocks.map((stock) => [stock.productId, stock]));

    const lines = dto.lines.map((line) => {
      const stock = byProduct.get(line.productId);
      if (!stock?.product?.status) {
        throw new NotFoundException(`El producto ${line.productId} no está activo en esta sucursal.`);
      }
      const quantityMilli = BigInt(Math.round(Number(line.quantity) * 1000));
      const unitPriceCents = toMinorUnits(Number(stock.sellingPrice));
      const promotion = bestPromotion(
        promotions,
        {
          productId: line.productId,
          category: stock.product.category ?? null,
          brand: stock.product.brand ?? null,
          branchId: branch.id,
          quantityMilli,
          unitPriceCents,
        },
        weekday,
      );
      let vat: VatLineResult;
      try {
        vat = computeVatLine({
          discountCents: promotion?.discountCents ?? 0n,
          unitPriceCents,
          quantityMilli,
          treatment: stock.product.vatTreatment ?? VatTreatment.TAXED,
          rateBasisPoints: percentToBasisPoints(Number(stock.product.taxRate)),
          priceIncludesVat: Boolean(stock.product.priceIncludesVat),
          chargeMode: policy.chargeMode,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          throw new BadRequestException(`El producto ${stock.product.sku} tiene una configuración de IVA inválida: ${error.message}`);
        }
        throw error;
      }
      const availableMilli = BigInt(Math.round(Number(stock.stock) * 1000));
      return {
        productId: line.productId,
        sku: stock.product.sku,
        name: stock.product.name,
        quantity: formatMilli(quantityMilli),
        unitPrice: formatCents(unitPriceCents),
        discount: formatCents(promotion?.discountCents ?? 0n),
        promotion: promotion ? { id: promotion.promotionId, name: promotion.name } : null,
        netAmount: formatCents(vat.netCents),
        taxAmount: formatCents(vat.vatCents),
        exemptAmount: formatCents(vat.exemptCents),
        notTaxedAmount: formatCents(vat.notTaxedCents),
        total: formatCents(vat.totalCents),
        availableStock: formatMilli(availableMilli),
        stockSufficient: availableMilli >= quantityMilli,
        vat,
        discountCents: promotion?.discountCents ?? 0n,
      };
    });

    const summary = summarizeVat(lines.map((line) => line.vat));
    const discountCents = lines.reduce((sum, line) => sum + line.discountCents, 0n);
    const draft = {
      voucherClass: policy.voucherClass,
      taxTotal: formatCents(summary.vatCents),
      customerVatCondition: customerCondition,
      vatExemptionReason: dto.vatExemption?.reason ?? null,
      vatExemptionNote: dto.vatExemption?.note ?? null,
    } as SaleEntity;
    return {
      voucherClass: policy.voucherClass,
      vatChargeMode: policy.chargeMode,
      requiresCustomerCuit: policy.requiresCustomerCuit,
      customerCuitValid: isValidCuit(customerTaxId),
      lines: lines.map(({ vat: _vat, discountCents: _discount, ...rest }) => rest),
      subtotal: formatCents(summary.netCents + summary.exemptCents + summary.notTaxedCents),
      taxTotal: formatCents(summary.vatCents),
      discountTotal: formatCents(discountCents),
      total: formatCents(summary.totalCents),
      vatBreakdown: summary.byRate.map((rate) => ({
        arcaVatRateId: rate.arcaVatRateId,
        rate: formatCents(rate.rateBasisPoints),
        base: formatCents(rate.baseCents),
        vat: formatCents(rate.vatCents),
      })),
      fiscalNotes: buildFiscalNotes(draft),
    };
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
    return { ...sale, items, payments, fiscalNotes: buildFiscalNotes(sale) };
  }

  /**
   * Condición frente al IVA del emisor (la empresa), tomada del perfil fiscal activo.
   * Sin perfil fiscal se asume Responsable Inscripto para conservar el comportamiento previo
   * (el IVA se agrega según el producto). Configurar el perfil fiscal antes de operar en producción.
   */
  private async resolveIssuerCondition(
    manager: EntityManager,
    tenantId: string,
  ): Promise<TaxConditionEnum> {
    const profile = await manager.findOne(FiscalProfileEntity, {
      where: { tenantId, isActive: true },
      order: { updatedAt: 'DESC' },
      select: { id: true, vatConditionCode: true },
    });
    if (!profile) {
      return TaxConditionEnum.RESPONSABLE_INSCRIPTO;
    }
    const condition = parseTaxCondition(profile.vatConditionCode);
    if (!condition) {
      throw new BadRequestException(
        'La condición frente al IVA del perfil fiscal de la empresa no es válida. Revisá la configuración fiscal.',
      );
    }
    return condition;
  }

  private resolvePolicy(
    issuer: TaxConditionEnum,
    customer: TaxConditionEnum,
    dto: CreateSaleDto,
  ): VatPolicy {
    try {
      return resolveVatPolicy(issuer, customer, dto.vatExemption?.reason ?? null);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

/**
 * Notas fiscales que el comprobante debe mostrar según la normativa vigente:
 * - Comprobante B: "IVA contenido" (Régimen de Transparencia Fiscal al Consumidor, Ley 27.743).
 * - Comprobante A a monotributista: leyenda de la RG 5003/2021.
 */
function buildFiscalNotes(sale: SaleEntity): Record<string, unknown> {
  const notes: Record<string, unknown> = {};
  if (sale.voucherClass === VoucherClass.B && Number(sale.taxTotal) > 0) {
    notes.fiscalTransparency = {
      title: FISCAL_TRANSPARENCY_TITLE,
      vatContained: sale.taxTotal,
      otherNationalIndirectTaxes: '0.00',
    };
  }
  if (
    sale.voucherClass === VoucherClass.A &&
    sale.customerVatCondition === TaxConditionEnum.MONOTRIBUTO
  ) {
    notes.legend = MONOTRIBUTO_CREDIT_LEGEND;
  }
  if (sale.vatExemptionReason) {
    notes.vatExemption = { reason: sale.vatExemptionReason, note: sale.vatExemptionNote ?? null };
  }
  return notes;
}

/** Costo para el snapshot de margen: un costo no cargado o inválido no debe impedir vender. */
function costSnapshotCents(value: unknown): bigint {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric >= 0 ? toMinorUnits(numeric) : 0n;
}

function toMinorUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException('Los importes deben ser números finitos no negativos.');
  }
  const [whole, fraction = ''] = value.toFixed(2).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}


function parseDecimalCents(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value)) {
    throw new BadRequestException('El saldo de caja tiene un formato inválido.');
  }
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
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
