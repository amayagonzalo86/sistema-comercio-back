import { formatCents, roundDivide, toCents } from '../../fiscal/vat/vat';
import { WEEKDAY_NAMES } from '../card-plans/card-plan-rules';

/**
 * Formas de pago que informa el presupuesto, congeladas al emitirlo (como los precios):
 * - Descuento por pago en efectivo (o los medios que tenga la lista de efectivo, p. ej. débito): sale de la lista
 *   «solo efectivo» de la empresa, producto por producto. Un cliente con cuenta corriente no lo tiene: paga el precio de lista.
 * - Planes de tarjeta de crédito en cuotas sin interés (o con descuento) vigentes ese día: sí valen para cualquier cliente.
 */
export interface QuotePaymentTerms {
  /** El cliente tiene cuenta corriente habilitada: no se le ofrece el descuento de efectivo. */
  accountCustomer: boolean;
  /** null = sin descuento de efectivo (la empresa no tiene lista de efectivo o el cliente es de cuenta corriente). */
  cash: {
    listName: string;
    /** Medios que llevan el descuento: CASH, DEBIT_CARD… */
    methods: string[];
    /** Descuento efectivo sobre el total (puede variar por producto, por eso se calcula sobre los importes). */
    percentage: string;
    total: string;
  } | null;
  cardPlans: QuoteCardPlanTerm[];
}

export interface QuoteCardPlanTerm {
  /** «Visa Banco de Tierra del Fuego». */
  name: string;
  installments: number;
  /** 0 = sin interés; negativo = descuento. */
  surchargePercentage: string;
  total: string;
  perInstallment: string;
  /** «solo los jueves» (null = todos los días). */
  availability: string | null;
}

export interface CashOffer {
  name: string;
  methods: string[];
  total: string;
}

export interface OfferablePlan {
  name: string;
  paymentMethod: string;
  installments: number;
  surchargePercentage: string;
  weekdays: number[] | null;
  validTo: string | null;
}

/** Hasta cuántos planes se imprimen (los de más cuotas primero dentro de cada tarjeta). */
export const MAX_QUOTE_PLANS = 12;

function availabilityOf(plan: OfferablePlan): string | null {
  const parts: string[] = [];
  if (plan.weekdays && plan.weekdays.length > 0 && plan.weekdays.length < 7) {
    parts.push(`solo los ${plan.weekdays.map((day) => WEEKDAY_NAMES[day]).join(', ')}`);
  }
  if (plan.validTo) {
    const [year, month, day] = String(plan.validTo).slice(0, 10).split('-');
    parts.push(`hasta el ${day}/${month}/${year}`);
  }
  return parts.length ? parts.join(' ') : null;
}

export function buildQuotePaymentTerms(totalValue: string, cashOffer: CashOffer | null, accountCustomer: boolean, plans: OfferablePlan[]): QuotePaymentTerms {
  const totalCents = toCents(totalValue);
  let cash: QuotePaymentTerms['cash'] = null;
  if (!accountCustomer && cashOffer && totalCents > 0n) {
    const cashCents = toCents(cashOffer.total);
    if (cashCents < totalCents) {
      cash = {
        listName: cashOffer.name,
        methods: cashOffer.methods.length ? cashOffer.methods : ['CASH'],
        percentage: formatCents(roundDivide((totalCents - cashCents) * 10_000n, totalCents)),
        total: formatCents(cashCents),
      };
    }
  }

  const cardPlans = plans
    .filter((plan) => plan.paymentMethod === 'CREDIT_CARD' && plan.installments >= 2 && Number(plan.surchargePercentage) <= 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.installments - b.installments)
    .slice(0, MAX_QUOTE_PLANS)
    .map((plan) => {
      const surchargeBp = BigInt(Math.round(Number(plan.surchargePercentage) * 100));
      const planTotal = roundDivide(totalCents * (10_000n + surchargeBp), 10_000n);
      return {
        name: plan.name,
        installments: plan.installments,
        surchargePercentage: Number(plan.surchargePercentage).toFixed(2),
        total: formatCents(planTotal),
        perInstallment: formatCents(roundDivide(planTotal, BigInt(plan.installments))),
        availability: availabilityOf(plan),
      };
    });

  return { accountCustomer, cash, cardPlans };
}
