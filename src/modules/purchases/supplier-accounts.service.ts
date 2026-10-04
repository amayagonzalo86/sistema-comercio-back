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
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { SupplierPayableQueryDto } from './dto/supplier-payable-query.dto';
import { SupplierPayableEntity } from './entities/supplier-payable.entity';
import { SupplierPaymentAllocationEntity } from './entities/supplier-payment-allocation.entity';
import { SupplierPaymentEntity } from './entities/supplier-payment.entity';

const MAX_MONEY_CENTS = 99_999_999_999_999n;

@Injectable()
export class SupplierAccountsService {
  private readonly logger = new Logger(SupplierAccountsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SupplierPaymentEntity)
    private readonly paymentRepository: Repository<SupplierPaymentEntity>,
    @InjectRepository(SupplierPayableEntity)
    private readonly payableRepository: Repository<SupplierPayableEntity>,
  ) {}

  async createPayment(
    tenantId: string,
    actorUserId: string,
    idempotencyKey: string,
    dto: CreateSupplierPaymentDto,
    allowedBranchId: string | null,
    auditContext: InventoryAuditContext = {},
  ): Promise<Record<string, unknown>> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (new Set(dto.allocations.map((allocation) => allocation.payableId)).size !== dto.allocations.length) {
      throw new BadRequestException('Cada cuenta a pagar debe aparecer una sola vez en la asignación.');
    }

    const allocations = [...dto.allocations]
      .map((allocation) => ({
        payableId: allocation.payableId,
        amount: Number(allocation.amount).toFixed(2),
      }))
      .sort((a, b) => a.payableId.localeCompare(b.payableId));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        branchId: dto.branchId,
        supplierPersonId: dto.supplierPersonId,
        method: dto.method,
        externalReference: dto.externalReference?.trim() || null,
        allocations,
      }))
      .digest('hex');

    const prior = await this.paymentRepository.findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro pago.');
      }
      return this.loadPayment(tenantId, prior.id, allowedBranchId);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    let transactionStarted = false;
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      transactionStarted = true;

      const branch = await queryRunner.manager.findOne(BranchEntity, {
        where: { id: dto.branchId, tenantId, status: true },
      });
      if (!branch) {
        throw new NotFoundException('La sucursal del pago no existe o no está activa en esta empresa.');
      }
      if (allowedBranchId && allowedBranchId !== branch.id) {
        throw new ForbiddenException('No tiene acceso a la sucursal del pago.');
      }

      const supplier = await queryRunner.manager.findOne(PersonEntity, {
        where: { id: dto.supplierPersonId, tenantId, isActive: true },
      });
      if (!supplier || supplier.personType === PersonType.CUSTOMER) {
        throw new NotFoundException('El proveedor no existe, no está activo o no está habilitado para compras en esta empresa.');
      }

      const lockedPayables: SupplierPayableEntity[] = [];
      for (const allocation of allocations) {
        const payable = await queryRunner.manager
          .createQueryBuilder(SupplierPayableEntity, 'payable')
          .setLock('pessimistic_write')
          .where('payable.tenantId = :tenantId', { tenantId })
          .andWhere('payable.id = :payableId', { payableId: allocation.payableId })
          .andWhere('payable.supplierPersonId = :supplierPersonId', { supplierPersonId: supplier.id })
          .getOne();
        if (!payable || (allowedBranchId && payable.branchId !== allowedBranchId)) {
          throw new NotFoundException('Una de las cuentas a pagar no existe para este proveedor y sucursal.');
        }
        lockedPayables.push(payable);
      }

      const concurrentPayment = await queryRunner.manager
        .createQueryBuilder(SupplierPaymentEntity, 'payment')
        .setLock('pessimistic_write')
        .where('payment.tenantId = :tenantId', { tenantId })
        .andWhere('payment.idempotencyKey = :idempotencyKey', { idempotencyKey: key })
        .getOne();
      if (concurrentPayment) {
        if (concurrentPayment.requestFingerprint !== fingerprint) {
          throw new ConflictException('Idempotency-Key ya fue utilizado para otro pago.');
        }
        await queryRunner.commitTransaction();
        transactionStarted = false;
        return this.loadPayment(tenantId, concurrentPayment.id, allowedBranchId);
      }

      const currency = lockedPayables[0]?.currency;
      if (!currency || lockedPayables.some((payable) => payable.currency !== currency)) {
        throw new BadRequestException('Todas las cuentas del pago deben usar la misma moneda.');
      }

      const allocationRows: Array<{ payable: SupplierPayableEntity; amountCents: bigint; newPaidCents: bigint }> = [];
      let paymentCents = 0n;
      for (let index = 0; index < allocations.length; index += 1) {
        const requestedCents = toMinorUnits(Number(allocations[index].amount));
        const payable = lockedPayables[index];
        const paidCents = toMinorUnits(Number(payable.amountPaid));
        const originalCents = toMinorUnits(Number(payable.originalAmount));
        const newPaidCents = paidCents + requestedCents;
        if (requestedCents <= 0n || newPaidCents > originalCents) {
          throw new BadRequestException('El pago supera el saldo pendiente de una cuenta a pagar.');
        }
        allocationRows.push({ payable, amountCents: requestedCents, newPaidCents });
        paymentCents += requestedCents;
      }
      if (paymentCents <= 0n || paymentCents > MAX_MONEY_CENTS) {
        throw new BadRequestException('El importe total del pago está fuera del rango admitido.');
      }

      const paymentRepo = queryRunner.manager.getRepository(SupplierPaymentEntity);
      const payment = await paymentRepo.save(paymentRepo.create({
        tenantId,
        branchId: branch.id,
        supplierPersonId: supplier.id,
        currency,
        method: dto.method,
        amount: formatCents(paymentCents),
        externalReference: dto.externalReference?.trim() || null,
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        actorUserId,
      }));

      const allocationRepo = queryRunner.manager.getRepository(SupplierPaymentAllocationEntity);
      const savedAllocations = allocationRows.map(({ payable, amountCents }) => allocationRepo.create({
        tenantId,
        paymentId: payment.id,
        payableId: payable.id,
        amount: formatCents(amountCents),
      }));
      await allocationRepo.save(savedAllocations);
      for (const allocation of allocationRows) {
        allocation.payable.amountPaid = formatCents(allocation.newPaidCents);
        await queryRunner.manager.save(SupplierPayableEntity, allocation.payable);
      }

      await queryRunner.manager.save(AuditEventEntity, queryRunner.manager.create(AuditEventEntity, {
        tenantId,
        actorUserId,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        eventType: 'SUPPLIER_PAYMENT_RECORDED',
        aggregateType: 'SUPPLIER_PAYMENT',
        aggregateId: payment.id,
        metadata: {
          branchId: branch.id,
          supplierPersonId: supplier.id,
          currency,
          method: payment.method,
          amount: payment.amount,
          allocationCount: savedAllocations.length,
        },
      }));

      await queryRunner.commitTransaction();
      transactionStarted = false;
      return this.loadPayment(tenantId, payment.id, allowedBranchId);
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
        const existing = await this.paymentRepository.findOne({ where: { tenantId, idempotencyKey: key } });
        if (existing && existing.requestFingerprint === fingerprint) {
          return this.loadPayment(tenantId, existing.id, allowedBranchId);
        }
        throw new ConflictException('Idempotency-Key ya fue utilizado para otro pago.');
      }
      this.logger.error('Error al registrar el pago al proveedor', error);
      throw new InternalServerErrorException('No se pudo registrar el pago al proveedor.');
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  async findPayables(
    tenantId: string,
    query: SupplierPayableQueryDto,
    branchScope: string | null,
  ): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const builder = this.payableRepository.createQueryBuilder('payable')
      .where('payable.tenantId = :tenantId', { tenantId });
    const branchId = branchScope ?? query.branchId;
    if (branchId) builder.andWhere('payable.branchId = :branchId', { branchId });
    if (query.supplierPersonId) {
      builder.andWhere('payable.supplierPersonId = :supplierPersonId', { supplierPersonId: query.supplierPersonId });
    }
    if (query.dueBefore) {
      builder.andWhere('payable.dueDate <= :dueBefore', { dueBefore: query.dueBefore });
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      builder.andWhere(
        '(payable.createdAt < :cursorCreatedAt OR (payable.createdAt = :cursorCreatedAt AND payable.id < :cursorId))',
        { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
      );
    }

    const rows = await builder
      .orderBy('payable.createdAt', 'DESC')
      .addOrderBy('payable.id', 'DESC')
      .take(limit + 1)
      .getMany();
    const hasMore = rows.length > limit;
    const payables = rows.slice(0, limit);
    const items = payables.map((payable) => {
      const originalCents = toMinorUnits(Number(payable.originalAmount));
      const paidCents = toMinorUnits(Number(payable.amountPaid));
      const outstanding = originalCents - paidCents;
      return {
        ...payable,
        amountPaid: formatCents(paidCents),
        outstanding: formatCents(outstanding),
        status: outstanding === 0n ? 'PAID' : paidCents === 0n ? 'OPEN' : 'PARTIAL',
      };
    });
    const last = payables.at(-1);
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })
      : null;
    return { items, nextCursor };
  }

  async findPayment(
    tenantId: string,
    paymentId: string,
    allowedBranchId: string | null,
  ): Promise<Record<string, unknown>> {
    return this.loadPayment(tenantId, paymentId, allowedBranchId);
  }

  private async loadPayment(
    tenantId: string,
    paymentId: string,
    allowedBranchId: string | null,
  ): Promise<Record<string, unknown>> {
    const payment = await this.paymentRepository.findOne({
      where: {
        id: paymentId,
        tenantId,
        ...(allowedBranchId ? { branchId: allowedBranchId } : {}),
      },
    });
    if (!payment) throw new NotFoundException('Pago a proveedor no encontrado.');
    const allocations = await this.dataSource.getRepository(SupplierPaymentAllocationEntity).find({
      where: { tenantId, paymentId },
      order: { id: 'ASC' },
    });
    return { ...payment, allocations };
  }
}

function toMinorUnits(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException('Los importes deben ser números finitos no negativos.');
  }
  const [whole, fraction = ''] = value.toFixed(2).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  if (cursor.length > 256) throw new BadRequestException('El cursor de cuentas a pagar no es válido.');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof value.createdAt !== 'string' ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      typeof value.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { createdAt: new Date(value.createdAt).toISOString(), id: value.id };
  } catch {
    throw new BadRequestException('El cursor de cuentas a pagar no es válido.');
  }
}
