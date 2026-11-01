import { BadRequestException } from '@nestjs/common';
import { ars, enabledPaymentMethods, parseItems } from './ai-sales.tools';
import { buildSystemPrompt } from './system-prompt';
import { AiSalesSettingsEntity } from '../entities/ai-sales.entities';

describe('herramientas del vendedor IA', () => {
  it('formatea importes en pesos argentinos', () => {
    expect(ars('1210.00')).toBe('$ 1.210,00');
    expect(ars(123456789n)).toBe('$ 1.234.567,89');
    expect(ars('-5.5')).toBe('-$ 5,50');
  });

  it('valida y une los ítems que manda el modelo', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseItems([{ productoId: id, cantidad: 2 }, { productoId: id, cantidad: 1.5 }])).toEqual([{ productId: id, quantity: 3.5 }]);
    expect(() => parseItems([])).toThrow(BadRequestException);
    expect(() => parseItems([{ productoId: 'inventado', cantidad: 1 }])).toThrow(BadRequestException);
    expect(() => parseItems([{ productoId: id, cantidad: -1 }])).toThrow(BadRequestException);
  });

  it('solo ofrece medios de pago conocidos y habilitados', () => {
    expect(enabledPaymentMethods({ paymentMethods: 'CASH, CREDIT_CARD,BITCOIN' })).toEqual(['CASH', 'CREDIT_CARD']);
  });

  it('las instrucciones prohíben descuentos inventados e incluyen la info del local', () => {
    const prompt = buildSystemPrompt({
      settings: { assistantName: 'Sofía', storeInfo: 'Envío gratis desde $ 50.000', paymentMethods: 'CASH,QR' } as AiSalesSettingsEntity,
      tenantName: 'Almacén Sur',
      branchName: 'Centro',
      customerRegistered: false,
      orderNumber: null,
      localDateTime: 'sábado',
    });
    expect(prompt).toContain('Sos Sofía, vendedora de Almacén Sur (sucursal Centro)');
    expect(prompt).toContain('Nunca inventes');
    expect(prompt).toContain('Envío gratis desde $ 50.000');
    expect(prompt).toContain('Efectivo, QR / billetera virtual');
  });
});
