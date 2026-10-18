import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { localToday, localWeekday } from '../../reports/domain/period';
import { CardPlanEntity } from './entities/card-plan.entity';

export const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "4" o "1,3" → [4] / [1, 3]; null o vacío → null (todos los días). */
export function parseWeekdays(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const days = [...new Set(value.split(',').map((item) => Number(item.trim())))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length > 0 ? days.sort((a, b) => a - b) : null;
}

export function serializeWeekdays(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0 || days.length === 7) return null;
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

/** Recargo del plan en puntos básicos (15 % → 1500; −10 % → −1000). */
export function surchargeBasisPoints(plan: Pick<CardPlanEntity, 'surchargePercentage'>): bigint {
  return BigInt(Math.round(Number(plan.surchargePercentage) * 100));
}

function percentText(value: number): string {
  return Math.abs(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

/** "Visa Banco de Tierra del Fuego · 12 cuotas sin interés" / "Mastercard · 6 cuotas +15 %". */
export function cardPlanLabel(plan: Pick<CardPlanEntity, 'name' | 'installments' | 'surchargePercentage'>): string {
  const installments = plan.installments <= 1 ? '1 pago' : `${plan.installments} cuotas`;
  const surcharge = Number(plan.surchargePercentage);
  const terms = surcharge === 0 ? 'sin interés' : surcharge > 0 ? `+${percentText(surcharge)} %` : `−${percentText(surcharge)} %`;
  return `${plan.name} · ${installments} ${terms}`.slice(0, 150);
}

/** ¿El plan vale en esta fecha y día de la semana locales? */
export function isPlanAvailable(plan: Pick<CardPlanEntity, 'isActive' | 'weekdays' | 'validFrom' | 'validTo'>, today: string, weekday: number): boolean {
  if (!plan.isActive) return false;
  if (plan.validFrom && today < String(plan.validFrom).slice(0, 10)) return false;
  if (plan.validTo && today > String(plan.validTo).slice(0, 10)) return false;
  const days = parseWeekdays(plan.weekdays);
  return !days || days.includes(weekday);
}

/** Texto de la vigencia para el mensaje de error: "solo los jueves". */
export function availabilityText(plan: Pick<CardPlanEntity, 'weekdays' | 'validFrom' | 'validTo'>): string {
  const parts: string[] = [];
  const days = parseWeekdays(plan.weekdays);
  if (days) parts.push(`solo los ${days.map((day) => WEEKDAY_NAMES[day]).join(', ')}`);
  if (plan.validFrom) parts.push(`desde el ${String(plan.validFrom).slice(0, 10)}`);
  if (plan.validTo) parts.push(`hasta el ${String(plan.validTo).slice(0, 10)}`);
  return parts.join(' ');
}

/**
 * Plan que se usa en un cobro: tiene que ser de la empresa, estar activo y vigente hoy (fecha y día locales)
 * y corresponder al medio de pago (crédito o débito).
 */
export async function resolveCardPlanForSale(
  manager: EntityManager,
  tenantId: string,
  cardPlanId: string,
  method: string,
  timeZone: string,
  at: Date = new Date(),
): Promise<CardPlanEntity> {
  const plan = await manager.findOne(CardPlanEntity, { where: { id: cardPlanId, tenantId, deletedAt: IsNull() } });
  if (!plan || !plan.isActive) {
    throw new BadRequestException('El plan de tarjeta no existe o está desactivado.');
  }
  if (plan.paymentMethod !== method) {
    throw new BadRequestException(`El plan «${plan.name}» es de tarjeta de ${plan.paymentMethod === 'CREDIT_CARD' ? 'crédito' : 'débito'}: elegí ese medio de pago.`);
  }
  if (!isPlanAvailable(plan, localToday(timeZone, at), localWeekday(timeZone, at))) {
    throw new BadRequestException(`El plan «${cardPlanLabel(plan)}» no está vigente hoy (${availabilityText(plan) || 'fuera de vigencia'}).`);
  }
  return plan;
}
