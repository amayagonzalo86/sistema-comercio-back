import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { cents, formatMoney } from '../../../common/utils/money';
import { PersonEntity, PersonType } from '../../persons/entities/person.entity';
import { agingOf, AllocationPlanItem, Aging, OpenDebit, planAllocation } from './domain/account-math';
import {
  AccountEntryDirection,
  AccountEntryKind,
  CustomerAccountAllocationEntity,
  CustomerAccountEntryEntity,
} from './entities/customer-account-entry.entity';

/**
 * Operaciones del libro de cuenta corriente dentro de una transacción.
 * Toda escritura bloquea antes la fila del cliente (persons FOR UPDATE): así dos cajas no venden por encima
 * del límite a la vez ni imputan el mismo saldo dos veces.
 */

export const decimalToCents = (value: string | number | null | undefined): bigint =>
  value === null || value === undefined || value === '' ? 0n : cents(value, true);

export async function lockCustomer(manager: EntityManager, tenantId: string, customerPersonId: string): Promise<PersonEntity> {
  const customer = await manager
    .createQueryBuilder(PersonEntity, 'person')
    .setLock('pessimistic_write')
    .where('person.id = :id AND person.tenantId = :tenantId', { id: customerPersonId, tenantId })
    .getOne();
  if (!customer || customer.personType === PersonType.SUPPLIER) throw new NotFoundException('Cliente no encontrado.');
  return customer;
}

export interface OpenDebitRow extends OpenDebit {
  entry: CustomerAccountEntryEntity;
}

export async function openDebits(manager: EntityManager, tenantId: string, customerPersonId: string): Promise<OpenDebitRow[]> {
  const rows = await manager
    .createQueryBuilder(CustomerAccountEntryEntity, 'e')
    .where('e.tenantId = :tenantId AND e.customerPersonId = :customerPersonId', { tenantId, customerPersonId })
    .andWhere('e.direction = :direction', { direction: AccountEntryDirection.DEBIT })
    .andWhere('e.amountApplied < e.amount')
    .orderBy('e.dueDate', 'ASC')
    .addOrderBy('e.createdAt', 'ASC')
    .getMany();
  return rows.map((entry) => ({
    id: entry.id,
    entry,
    pendingCents: decimalToCents(entry.amount) - decimalToCents(entry.amountApplied),
    dueDate: entry.dueDate ?? null,
    createdAt: entry.createdAt,
  }));
}

async function openCredits(manager: EntityManager, tenantId: string, customerPersonId: string): Promise<CustomerAccountEntryEntity[]> {
  return manager
    .createQueryBuilder(CustomerAccountEntryEntity, 'e')
    .where('e.tenantId = :tenantId AND e.customerPersonId = :customerPersonId', { tenantId, customerPersonId })
    .andWhere('e.direction = :direction', { direction: AccountEntryDirection.CREDIT })
    .andWhere('e.amountApplied < e.amount')
    .orderBy('e.createdAt', 'ASC')
    .getMany();
}

export interface AccountPosition {
  /** Débitos − créditos (positivo = el cliente debe; negativo = saldo a favor). */
  balanceCents: bigint;
  /** Saldo a favor sin imputar. */
  unappliedCreditCents: bigint;
  aging: Aging;
  debits: OpenDebitRow[];
}

export async function accountPosition(manager: EntityManager, tenantId: string, customerPersonId: string, today: string): Promise<AccountPosition> {
  const totals = (await manager.query(
    `SELECT
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0) AS balance,
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount - amount_applied ELSE 0 END), 0) AS unapplied
       FROM customer_account_entries WHERE tenant_id = ? AND customer_person_id = ?`,
    [tenantId, customerPersonId],
  )) as Array<{ balance: string; unapplied: string }>;
  const debits = await openDebits(manager, tenantId, customerPersonId);
  return {
    balanceCents: decimalToCents(totals[0]?.balance),
    unappliedCreditCents: decimalToCents(totals[0]?.unapplied),
    aging: agingOf(debits, today),
    debits,
  };
}

/** Imputa un crédito a débitos según el plan, actualizando ambos saldos. */
export async function applyCredit(
  manager: EntityManager,
  credit: CustomerAccountEntryEntity,
  items: AllocationPlanItem[],
  debits: Map<string, CustomerAccountEntryEntity>,
): Promise<void> {
  let applied = decimalToCents(credit.amountApplied);
  for (const item of items) {
    const debit = debits.get(item.debitId);
    if (!debit) throw new BadRequestException('Una de las facturas elegidas no está pendiente en la cuenta del cliente.');
    await manager.save(
      CustomerAccountAllocationEntity,
      manager.create(CustomerAccountAllocationEntity, {
        tenantId: credit.tenantId,
        creditEntryId: credit.id,
        debitEntryId: debit.id,
        amount: formatMoney(item.amountCents),
      }),
    );
    debit.amountApplied = formatMoney(decimalToCents(debit.amountApplied) + item.amountCents);
    await manager.save(CustomerAccountEntryEntity, debit);
    applied += item.amountCents;
  }
  if (applied > decimalToCents(credit.amount)) throw new BadRequestException('La imputación supera el importe del cobro.');
  credit.amountApplied = formatMoney(applied);
  await manager.save(CustomerAccountEntryEntity, credit);
}

/**
 * Imputa automáticamente los saldos a favor (recibos con sobrante, notas de crédito, devoluciones) a las facturas
 * pendientes, de la más vieja a la más nueva. Se llama después de cada movimiento nuevo.
 */
export async function autoApply(manager: EntityManager, tenantId: string, customerPersonId: string): Promise<void> {
  const credits = await openCredits(manager, tenantId, customerPersonId);
  if (credits.length === 0) return;
  let debits = await openDebits(manager, tenantId, customerPersonId);
  for (const credit of credits) {
    if (debits.length === 0) return;
    const available = decimalToCents(credit.amount) - decimalToCents(credit.amountApplied);
    const plan = planAllocation(available, debits);
    if (plan.items.length === 0) continue;
    await applyCredit(manager, credit, plan.items, new Map(debits.map((row) => [row.id, row.entry])));
    debits = debits
      .map((row) => ({ ...row, pendingCents: decimalToCents(row.entry.amount) - decimalToCents(row.entry.amountApplied) }))
      .filter((row) => row.pendingCents > 0n);
  }
}

export interface PostEntryInput {
  tenantId: string;
  branchId: string;
  customerPersonId: string;
  kind: AccountEntryKind;
  direction: AccountEntryDirection;
  sourceType: string;
  sourceId: string;
  saleId?: string | null;
  description: string;
  amountCents: bigint;
  currency: string;
  dueDate?: string | null;
  actorUserId: string;
}

/** Registra un movimiento (el llamador ya bloqueó al cliente). No imputa: para eso autoApply o applyCredit. */
export async function postEntry(manager: EntityManager, input: PostEntryInput): Promise<CustomerAccountEntryEntity> {
  if (input.amountCents <= 0n) throw new BadRequestException('El importe del movimiento de cuenta corriente debe ser positivo.');
  return manager.save(
    CustomerAccountEntryEntity,
    manager.create(CustomerAccountEntryEntity, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      customerPersonId: input.customerPersonId,
      kind: input.kind,
      direction: input.direction,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      saleId: input.saleId ?? null,
      description: input.description.slice(0, 200),
      amount: formatMoney(input.amountCents),
      amountApplied: '0.00',
      currency: input.currency,
      dueDate: input.direction === AccountEntryDirection.DEBIT ? input.dueDate ?? null : null,
      actorUserId: input.actorUserId,
    }),
  );
}
