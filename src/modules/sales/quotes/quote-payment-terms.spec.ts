import { buildQuotePaymentTerms, OfferablePlan } from './quote-payment-terms';

const plan = (overrides: Partial<OfferablePlan>): OfferablePlan => ({
  name: 'Visa Banco de Tierra del Fuego',
  paymentMethod: 'CREDIT_CARD',
  installments: 3,
  surchargePercentage: '0.00',
  weekdays: null,
  validTo: null,
  ...overrides,
});

describe('buildQuotePaymentTerms', () => {
  const cashOffer = { name: 'Ventas en efectivo', methods: ['CASH', 'DEBIT_CARD'], total: '9500.00' };

  it('informa el descuento de efectivo calculado sobre los importes', () => {
    const terms = buildQuotePaymentTerms('10000.00', cashOffer, false, []);
    expect(terms.cash).toEqual({ listName: 'Ventas en efectivo', methods: ['CASH', 'DEBIT_CARD'], percentage: '5.00', total: '9500.00' });
    expect(terms.accountCustomer).toBe(false);
  });

  it('a un cliente con cuenta corriente no le ofrece el descuento de efectivo, pero sí las cuotas', () => {
    const terms = buildQuotePaymentTerms('10000.00', cashOffer, true, [plan({ installments: 6 })]);
    expect(terms.cash).toBeNull();
    expect(terms.accountCustomer).toBe(true);
    expect(terms.cardPlans).toEqual([
      { name: 'Visa Banco de Tierra del Fuego', installments: 6, surchargePercentage: '0.00', total: '10000.00', perInstallment: '1666.67', availability: null },
    ]);
  });

  it('sin lista de efectivo o sin diferencia, no hay descuento', () => {
    expect(buildQuotePaymentTerms('10000.00', null, false, []).cash).toBeNull();
    expect(buildQuotePaymentTerms('10000.00', { ...cashOffer, total: '10000.00' }, false, []).cash).toBeNull();
  });

  it('solo ofrece cuotas de crédito sin interés (o con descuento) de todos los días, ordenadas', () => {
    const terms = buildQuotePaymentTerms('12000.00', null, false, [
      plan({ name: 'Mastercard', installments: 12, weekdays: [4] }),
      plan({ installments: 6 }),
      plan({ installments: 18, surchargePercentage: '25.00' }),
      plan({ installments: 1 }),
      plan({ paymentMethod: 'DEBIT_CARD' }),
      plan({ installments: 3, surchargePercentage: '-10.00', validTo: '2026-12-31' }),
    ]);
    expect(terms.cardPlans.map((item) => [item.name, item.installments, item.total, item.perInstallment, item.availability])).toEqual([
      ['Visa Banco de Tierra del Fuego', 3, '10800.00', '3600.00', 'hasta el 31/12/2026'],
      ['Visa Banco de Tierra del Fuego', 6, '12000.00', '2000.00', null],
    ]);
  });
});
