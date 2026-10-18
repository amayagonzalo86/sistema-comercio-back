import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { RequestAuditContext } from '../../../common/http/request-context';
import { tenantTimeZone } from '../../../common/time/local-day-range';
import { localToday, localWeekday } from '../../reports/domain/period';
import { cardPlanLabel, isPlanAvailable, parseWeekdays, serializeWeekdays } from './card-plan-rules';
import { CreateCardPlanDto, UpdateCardPlanDto } from './dto/card-plan.dto';
import { CardBrand, CardPlanEntity, CardPlanPaymentMethod } from './entities/card-plan.entity';

export interface CardPlanView {
  id: string;
  name: string;
  label: string;
  cardBrand: CardBrand;
  bankName: string | null;
  paymentMethod: CardPlanPaymentMethod;
  installments: number;
  surchargePercentage: string;
  weekdays: number[] | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Vale hoy (activo, dentro de la vigencia y en el día de la semana local). */
  availableToday: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_PLANS = 300;

/**
 * Planes de tarjeta de la empresa (tarjeta + banco + cuotas + recargo). Los carga el titular, la administración
 * o el encargado; el cajero solo ve los vigentes hoy al cobrar.
 */
@Injectable()
export class CardPlansService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string, includeInactive: boolean): Promise<CardPlanView[]> {
    const plans = await this.dataSource.getRepository(CardPlanEntity).find({
      where: { tenantId, deletedAt: IsNull(), ...(includeInactive ? {} : { isActive: true }) },
      order: { sortOrder: 'ASC', name: 'ASC', installments: 'ASC' },
    });
    return this.views(tenantId, plans);
  }

  /** Planes que se pueden usar hoy (para el modal de cobro). */
  async available(tenantId: string): Promise<CardPlanView[]> {
    return (await this.list(tenantId, false)).filter((plan) => plan.availableToday);
  }

  async create(tenantId: string, actorUserId: string, dto: CreateCardPlanDto, context: RequestAuditContext): Promise<CardPlanView> {
    assertValidity(dto.validFrom ?? null, dto.validTo ?? null);
    const saved = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.count(CardPlanEntity, { where: { tenantId, deletedAt: IsNull() } });
      if (existing >= MAX_PLANS) throw new BadRequestException(`Se admiten hasta ${MAX_PLANS} planes de tarjeta.`);
      const plan = await manager.save(
        CardPlanEntity,
        manager.create(CardPlanEntity, {
          tenantId,
          name: dto.name,
          cardBrand: dto.cardBrand ?? CardBrand.OTHER,
          bankName: dto.bankName ? dto.bankName : null,
          paymentMethod: dto.paymentMethod ?? CardPlanPaymentMethod.CREDIT_CARD,
          installments: dto.installments,
          surchargePercentage: dto.surchargePercentage.toFixed(2),
          weekdays: serializeWeekdays(dto.weekdays),
          validFrom: dto.validFrom || null,
          validTo: dto.validTo || null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? (existing + 1) * 10,
        }),
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CARD_PLAN_CREATED',
        aggregateType: 'CARD_PLAN',
        aggregateId: plan.id,
        metadata: snapshot(plan),
        context,
      });
      return plan;
    });
    const [view] = await this.views(tenantId, [saved]);
    return view;
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: UpdateCardPlanDto, context: RequestAuditContext): Promise<CardPlanView> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const plan = await this.requirePlan(manager, tenantId, id);
      const before = snapshot(plan);
      Object.assign(plan, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.cardBrand !== undefined ? { cardBrand: dto.cardBrand } : {}),
        ...(dto.bankName !== undefined ? { bankName: dto.bankName ? dto.bankName : null } : {}),
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
        ...(dto.installments !== undefined ? { installments: dto.installments } : {}),
        ...(dto.surchargePercentage !== undefined ? { surchargePercentage: dto.surchargePercentage.toFixed(2) } : {}),
        ...(dto.weekdays !== undefined ? { weekdays: serializeWeekdays(dto.weekdays) } : {}),
        ...(dto.validFrom !== undefined ? { validFrom: dto.validFrom || null } : {}),
        ...(dto.validTo !== undefined ? { validTo: dto.validTo || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      });
      assertValidity(plan.validFrom ?? null, plan.validTo ?? null);
      const updated = await manager.save(CardPlanEntity, plan);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CARD_PLAN_UPDATED',
        aggregateType: 'CARD_PLAN',
        aggregateId: id,
        metadata: { before, after: snapshot(updated) },
        context,
      });
      return updated;
    });
    const [view] = await this.views(tenantId, [saved]);
    return view;
  }

  /** Baja lógica: deja de ofrecerse al cobrar; las ventas conservan el plan con que se cobraron. */
  async remove(tenantId: string, actorUserId: string, id: string, context: RequestAuditContext): Promise<{ message: string }> {
    return this.dataSource.transaction(async (manager) => {
      const plan = await this.requirePlan(manager, tenantId, id);
      await manager.softDelete(CardPlanEntity, { id, tenantId });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'CARD_PLAN_DELETED',
        aggregateType: 'CARD_PLAN',
        aggregateId: id,
        metadata: snapshot(plan),
        context,
      });
      return { message: `Plan «${cardPlanLabel(plan)}» eliminado.` };
    });
  }

  private async views(tenantId: string, plans: CardPlanEntity[]): Promise<CardPlanView[]> {
    if (plans.length === 0) return [];
    const timeZone = await tenantTimeZone(this.dataSource.manager, tenantId);
    const today = localToday(timeZone);
    const weekday = localWeekday(timeZone);
    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      label: cardPlanLabel(plan),
      cardBrand: plan.cardBrand,
      bankName: plan.bankName ?? null,
      paymentMethod: plan.paymentMethod,
      installments: plan.installments,
      surchargePercentage: Number(plan.surchargePercentage).toFixed(2),
      weekdays: parseWeekdays(plan.weekdays),
      validFrom: plan.validFrom ? String(plan.validFrom).slice(0, 10) : null,
      validTo: plan.validTo ? String(plan.validTo).slice(0, 10) : null,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      availableToday: isPlanAvailable(plan, today, weekday),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    }));
  }

  private async requirePlan(manager: EntityManager, tenantId: string, id: string): Promise<CardPlanEntity> {
    const plan = await manager
      .createQueryBuilder(CardPlanEntity, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :id AND p.tenantId = :tenantId AND p.deletedAt IS NULL', { id, tenantId })
      .getOne();
    if (!plan) throw new NotFoundException('El plan de tarjeta no existe.');
    return plan;
  }
}

function assertValidity(from: string | null, to: string | null): void {
  if (from && to && String(from).slice(0, 10) > String(to).slice(0, 10)) {
    throw new BadRequestException('La fecha desde no puede ser posterior a la fecha hasta.');
  }
}

function snapshot(plan: CardPlanEntity): Record<string, unknown> {
  return {
    name: plan.name,
    cardBrand: plan.cardBrand,
    bankName: plan.bankName ?? null,
    paymentMethod: plan.paymentMethod,
    installments: plan.installments,
    surchargePercentage: Number(plan.surchargePercentage).toFixed(2),
    weekdays: plan.weekdays ?? null,
    validFrom: plan.validFrom ?? null,
    validTo: plan.validTo ?? null,
    isActive: plan.isActive,
  };
}
