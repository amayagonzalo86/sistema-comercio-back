// API simulada SOLO para capturas de pantalla en CI. No se usa en producción.
import { createServer } from 'node:http';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = () =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-1', username: 'gonzalo', tenantId: 't-1', tenantRole: 'OWNER', exp: Math.floor(Date.now() / 1000) + 900 })}.firma`;

const branches = [
  { id: 'b-1', code: 'CENTRAL', name: 'Casa Central', status: true, address: 'Av. Colón 1200, Córdoba' },
  { id: 'b-2', code: 'NVA-CBA', name: 'Nueva Córdoba', status: true, address: 'Bv. San Juan 450' },
  { id: 'b-3', code: 'VILLA-A', name: 'Villa Allende', status: true },
  { id: 'b-4', code: 'RIO-IV', name: 'Río Cuarto', status: true },
  { id: 'b-5', code: 'DEPOSITO', name: 'Depósito', status: true },
];

const products = [
  ['p-1', 'YER-001', '7790001000011', 'Yerba mate suave 1 kg', 'Almacén', 'Del Litoral', 21, 4890, 3200, 84, 20],
  ['p-2', 'ACE-002', '7790001000028', 'Aceite de girasol 1,5 l', 'Almacén', 'Cocinera Sur', 21, 3650, 2400, 12, 15],
  ['p-3', 'GAL-003', '7790001000035', 'Galletitas de agua 3 x 100 g', 'Almacén', 'Panificadora', 21, 1590, 980, 0, 10],
  ['p-4', 'LEC-004', '7790001000042', 'Leche entera larga vida 1 l', 'Lácteos', 'Tambo Norte', 10.5, 1490, 1050, 140, 40],
  ['p-5', 'CAF-005', '7790001000059', 'Café molido 500 g', 'Almacén', 'Tostadero', 21, 8990, 5900, 26, 8],
  ['p-6', 'DET-006', '7790001000066', 'Detergente concentrado 750 ml', 'Limpieza', 'Brillo', 21, 2350, 1400, 7, 12],
  ['p-7', 'LIB-007', '9789870000001', 'Libro de recetas criollas', 'Librería', 'Editorial Sur', 0, 15900, 9800, 9, 3],
];

const productList = (branchId) =>
  products.map(([id, sku, barcode, name, category, brand, taxRate, price, cost, stock, min]) => ({
    id, sku, barcode, name, category, brand, unitOfMeasure: 'UNIT', taxRate, vatTreatment: taxRate === 0 ? 'EXEMPT' : 'TAXED', priceIncludesVat: true, status: true,
    ...(branchId
      ? { branch: { branchId, stock, minStock: min, costPrice: cost, sellingPrice: price, profitMargin: Math.round(((price - cost) / cost) * 10000) / 100, isActive: true, belowMinimum: stock <= min } }
      : { totalStock: stock * 4 }),
  }));

const days = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.now() - (29 - index) * 86400000);
  const day = date.toISOString().slice(0, 10);
  const base = 2_400_000 + Math.sin(index / 2.3) * 520_000 + index * 26_000 + (date.getDay() === 6 ? 700_000 : 0);
  return { day, tickets: Math.round(base / 9800), grossSales: Math.round(base), refunds: index % 6 === 0 ? 48_000 : 0, netSales: Math.round(base - (index % 6 === 0 ? 48_000 : 0)) };
});

const page = (items) => ({ items, total: items.length, page: 1, limit: 25, pages: 1 });
const people = [
  { id: 'c-1', firstName: 'Distribuidora del Centro', lastName: 'SA', nationalId: '30712345671', documentType: 80, vatCondition: 'RESPONSABLE_INSCRIPTO', email: 'compras@delcentro.com.ar', phone: '351 555-1200', personType: 'BOTH', isActive: true, marketingConsent: true },
  { id: 'c-2', firstName: 'María', lastName: 'Gómez', nationalId: '27303456789', documentType: 86, vatCondition: 'MONOTRIBUTO', email: 'maria.gomez@mail.com', phone: '351 555-8899', personType: 'CUSTOMER', isActive: true, marketingConsent: true },
  { id: 'c-3', firstName: 'Lucas', lastName: 'Fernández', nationalId: '34567890', documentType: 96, vatCondition: 'CONSUMIDOR_FINAL', email: null, phone: '358 444-1020', personType: 'CUSTOMER', isActive: true, marketingConsent: false },
];

function quote(body) {
  const lines = (body.lines ?? []).map((line) => {
    const p = productList(body.branchId).find((item) => item.id === line.productId);
    const unit = p?.branch?.sellingPrice ?? 1000;
    const promo = p?.id === 'p-1' && line.quantity >= 3 ? Math.floor(line.quantity / 3) * unit : 0;
    const total = unit * line.quantity - promo;
    const rate = p?.taxRate ?? 21;
    const net = rate ? total / (1 + rate / 100) : total;
    return { productId: line.productId, sku: p?.sku, name: p?.name, quantity: line.quantity.toFixed(3), unitPrice: unit.toFixed(2), discount: promo.toFixed(2), promotion: promo ? { id: 'pr-1', name: '3x2 en yerbas' } : null, netAmount: net.toFixed(2), taxAmount: (total - net).toFixed(2), exemptAmount: rate ? '0.00' : total.toFixed(2), notTaxedAmount: '0.00', total: total.toFixed(2), availableStock: String(p?.branch?.stock ?? 0), stockSufficient: (p?.branch?.stock ?? 0) >= line.quantity };
  });
  const total = lines.reduce((sum, line) => sum + Number(line.total), 0);
  const tax = lines.reduce((sum, line) => sum + Number(line.taxAmount), 0);
  return {
    voucherClass: body.customerPersonId === 'c-1' ? 'A' : 'B', vatChargeMode: 'DISCRIMINATED', requiresCustomerCuit: false, customerCuitValid: true, lines,
    subtotal: (total - tax).toFixed(2), taxTotal: tax.toFixed(2), discountTotal: lines.reduce((sum, line) => sum + Number(line.discount), 0).toFixed(2), total: total.toFixed(2),
    vatBreakdown: [{ arcaVatRateId: 5, rate: '21.00', base: (total - tax).toFixed(2), vat: tax.toFixed(2) }],
    fiscalNotes: body.customerPersonId === 'c-1' ? {} : { fiscalTransparency: { title: 'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', vatContained: tax.toFixed(2), otherNationalIndirectTaxes: '0.00' } },
  };
}

const routes = [
  ['POST', /^\/auth\/(login|refresh)$/, (_, p) => (p.endsWith('login') ? { user: { id: 'u-1', username: 'gonzalo', branchId: null, person: { firstName: 'Gonzalo', lastName: 'Amaya' } }, tokens: { accessToken: token() } } : { accessToken: token() })],
  ['GET', /^\/auth\/tenants$/, () => [{ id: 't-1', slug: 'almacenes', legalName: 'Almacenes del Centro SRL', tradeName: 'Almacenes del Centro', role: 'OWNER' }]],
  ['GET', /^\/branches$/, () => branches],
  ['GET', /^\/fiscal\/profile$/, () => ({ id: 'f-1', taxId: '30712345671', legalName: 'Almacenes del Centro SRL', vatConditionCode: 'RESPONSABLE_INSCRIPTO', environment: 'HOMOLOGATION', grossIncomeRegistration: '904-123456-7', activityStartDate: '2015-03-01', commercialAddress: 'Av. Colón 1200, Córdoba', certificateSecretRef: 'file:empresa.crt', privateKeySecretRef: 'file:empresa.key', isActive: true, updatedAt: new Date().toISOString() })],
  ['GET', /^\/fiscal\/points-of-sale$/, () => [{ id: 'pv-1', branchId: 'b-1', number: 3, environment: 'HOMOLOGATION', isActive: true }]],
  ['GET', /^\/reports\/dashboard$/, () => ({
    period: { from: days[0].day, to: days[29].day, days: 30 }, previousPeriod: { from: '2026-08-11', to: '2026-09-09' },
    totals: { tickets: 8420, grossSales: 84_250_000, refunds: 410_000, netSales: 83_840_000, vat: 14_550_000, averageTicket: 9957, revenueWithoutVat: 69_290_000, cost: 47_100_000, grossMargin: 22_190_000, marginPercent: 32 },
    previous: { tickets: 7980, grossSales: 70_100_000, refunds: 380_000, netSales: 69_720_000, vat: 12_100_000, averageTicket: 8737, revenueWithoutVat: 57_620_000, cost: 40_200_000, grossMargin: 17_420_000, marginPercent: 30.2 },
    growth: { netSales: 20.3, tickets: 5.5, grossMargin: 27.4 },
    byBranch: [['b-1', 'CENTRAL', 'Casa Central', 31_200_000], ['b-2', 'NVA-CBA', 'Nueva Córdoba', 22_400_000], ['b-3', 'VILLA-A', 'Villa Allende', 16_900_000], ['b-4', 'RIO-IV', 'Río Cuarto', 13_340_000]].map(([branchId, code, name, netSales]) => ({ branchId, code, name, netSales, tickets: Math.round(netSales / 9900), grossMargin: netSales * 0.26, marginPercent: 31.5 })),
    today: { tickets: 286, netSales: 2_870_400 },
    operations: { openCashSessions: 4, cashInRegisters: 1_284_500, payablesOutstanding: 18_400_000, payablesOverdue: 2_150_000, lowStockItems: 23, transfersInTransit: 3, purchaseOrdersPending: 5 },
  })],
  ['GET', /^\/reports\/sales-by-day$/, () => ({ period: { from: days[0].day, to: days[29].day }, series: days })],
  ['GET', /^\/reports\/sales-by-hour$/, () => ({ period: {}, cells: Array.from({ length: 7 * 14 }, (_, i) => { const weekday = (i % 7) + 1; const hour = 8 + Math.floor(i / 7); const peak = (hour >= 11 && hour <= 13) || (hour >= 18 && hour <= 20) ? 3 : 1; return { weekday, hour, tickets: Math.round(peak * (weekday === 7 ? 1.6 : 1) * (8 + (i % 5) * 3)), grossSales: 120000 * peak }; }) })],
  ['GET', /^\/reports\/top-products$/, () => ({ period: {}, items: products.map(([productId, sku, , name, , , , price, cost], index) => ({ productId, sku, name, quantity: 900 - index * 110, revenue: (900 - index * 110) * price, grossMargin: (900 - index * 110) * (price - cost) / 1.21, marginPercent: Math.round(((price / 1.21 - cost) / (price / 1.21)) * 1000) / 10 })) })],
  ['GET', /^\/reports\/sales-by-payment-method$/, () => ({ period: {}, items: [['DEBIT_CARD', 38.2], ['CASH', 27.5], ['QR', 18.1], ['CREDIT_CARD', 12.6], ['BANK_TRANSFER', 3.6]].map(([method, share]) => ({ method, share, amount: 83_840_000 * share / 100, tickets: Math.round(8420 * share / 100) })) })],
  ['GET', /^\/reports\/sales-by-category$/, () => ({ period: {}, items: [['Almacén', 41_000_000], ['Lácteos', 18_200_000], ['Limpieza', 12_400_000], ['Bebidas', 9_800_000], ['Librería', 2_440_000]].map(([category, revenue]) => ({ category, revenue, quantity: revenue / 3000, grossMargin: revenue * 0.27, marginPercent: 32.4 })) })],
  ['GET', /^\/reports\/sales-by-seller$/, () => ({ period: {}, items: [{ userId: 'u-2', username: 'lperez', fullName: 'Laura Pérez', tickets: 2210, grossSales: 22_100_000, refunds: 120_000, averageTicket: 10000 }, { userId: 'u-3', username: 'jsosa', fullName: 'Julián Sosa', tickets: 1980, grossSales: 18_900_000, refunds: 0, averageTicket: 9545 }] })],
  ['GET', /^\/reports\/stock-valuation$/, () => ({ items: branches.slice(0, 4).map((branch, index) => ({ branchId: branch.id, code: branch.code, name: branch.name, products: 1200 - index * 80, units: 18000 - index * 2000, costValue: 42_000_000 - index * 5_000_000, retailValue: 61_000_000 - index * 7_000_000 })), totals: { units: 60000, costValue: 138_000_000, retailValue: 202_000_000 } })],
  ['GET', /^\/products\/facets$/, () => ({ categories: [{ name: 'Almacén', count: 812 }, { name: 'Lácteos', count: 140 }, { name: 'Limpieza', count: 230 }, { name: 'Librería', count: 64 }], brands: [{ name: 'Del Litoral', count: 22 }, { name: 'Cocinera Sur', count: 18 }, { name: 'Brillo', count: 31 }] })],
  ['GET', /^\/products$/, (q) => page(productList(q.get('branchId')).filter((item) => !q.get('search') || item.name.toLowerCase().includes(q.get('search').toLowerCase()) || item.sku.toLowerCase().includes(q.get('search').toLowerCase())))],
  ['POST', /^\/sales\/quote$/, (_, __, body) => quote(body)],
  ['GET', /^\/persons$/, () => page(people)],
  ['GET', /^\/inventory\/stock-matrix$/, () => ({ ...page(products.map(([productId, sku, , name, category, , , , , stock, min]) => ({ productId, sku, name, category, totalStock: String(stock * 4), branches: Object.fromEntries(branches.map((branch, index) => { const value = Math.max(0, stock - index * 9); return [branch.id, { stock: String(value), minStock: String(min), belowMinimum: value <= min }]; })) }))), branches: branches.map(({ id, code, name }) => ({ id, code, name })) })],
  ['GET', /^\/cash\/registers$/, () => [{ id: 'r-1', branchId: 'b-1', code: 'CAJA-1', name: 'Caja 1', isActive: true, openSession: { id: 's-1', currency: 'ARS', openingAmount: '50000.00', expectedAmount: '412350.00', openedByUserId: 'u-1', openedAt: new Date(Date.now() - 5 * 3600000).toISOString() } }, { id: 'r-2', branchId: 'b-1', code: 'CAJA-2', name: 'Caja 2', isActive: true, openSession: null }]],
  ['GET', /^\/cash\/sessions\/s-1$/, () => ({ id: 's-1', branchId: 'b-1', cashRegisterId: 'r-1', status: 'OPEN', currency: 'ARS', openingAmount: '50000.00', expectedAmount: '412350.00', openedByUserId: 'u-1', openedAt: new Date(Date.now() - 5 * 3600000).toISOString() })],
  ['GET', /^\/cash\/sessions\/s-1\/movements$/, () => ({ nextCursor: null, items: [['OPENING', 'IN', '50000.00', 'Apertura de caja'], ['SALE', 'IN', '18450.00', 'Venta'], ['SALE', 'IN', '32990.00', 'Venta'], ['EXPENSE', 'OUT', '12000.00', 'Pago de flete'], ['SALE', 'IN', '9870.00', 'Venta']].map(([type, direction, amount, reason], index) => ({ id: `m-${index}`, cashSessionId: 's-1', type, direction, amount, currency: 'ARS', reason, actorUserId: 'u-1', createdAt: new Date(Date.now() - (5 - index) * 3600000).toISOString() })) })],
  ['GET', /^\/sales$/, () => page(Array.from({ length: 12 }, (_, index) => ({ id: `sa-${index}00000000`, branchId: branches[index % 4].id, customerPersonId: index % 3 === 0 ? 'c-1' : null, currency: 'ARS', subtotal: '0', taxTotal: String((12000 + index * 900) * 0.1736), discountTotal: '0', exemptTotal: '0', notTaxedTotal: '0', voucherClass: index % 3 === 0 ? 'A' : 'B', total: String(12000 + index * 900), fiscalStatus: index === 4 ? 'FAILED' : index % 5 === 0 ? 'NOT_ISSUED' : 'AUTHORIZED', returnStatus: index === 7 ? 'PARTIAL' : 'NONE', refundedTotal: '0', actorUserId: 'u-2', createdAt: new Date(Date.now() - index * 2400000).toISOString() })))],
  ['GET', /^\/fiscal\/documents\/d-1$/, () => ({
    document: { id: 'd-1', branchId: 'b-1', sourceType: 'SALE', sourceId: 'sa-1', environment: 'HOMOLOGATION', voucherClass: 'A', voucherType: 1, pointOfSale: 3, number: 1287, status: 'AUTHORIZED', cae: '76423187654321', caeExpiration: '2026-10-20', issueDate: '2026-10-10', docType: 80, docNumber: '30712345671', receiverConditionId: 1, total: '24379.00', netTaxed: '20147.93', vatTotal: '4231.07', exempt: '0.00', notTaxed: '0.00', vatRates: [{ arcaId: 5, base: '20147.93', amount: '4231.07' }], attempts: 1, createdAt: new Date().toISOString() },
    issuer: { legalName: 'Almacenes del Centro SRL', cuit: '30712345671', vatCondition: 'RESPONSABLE_INSCRIPTO', grossIncomeRegistration: '904-123456-7', activityStartDate: '2015-03-01', commercialAddress: 'Av. Colón 1200, Córdoba' },
    receiver: { name: 'Distribuidora del Centro SA', address: 'Ruta 9 km 695, Córdoba' },
    associated: null,
    items: [{ id: 'i-1', productId: 'p-1', skuSnapshot: 'YER-001', nameSnapshot: 'Yerba mate suave 1 kg', quantity: '3.000', unitPrice: '4890.00', taxRate: '21.00', netAmount: '12123.97', taxAmount: '2546.03', exemptAmount: '0.00', notTaxedAmount: '0.00', total: '14670.00' }, { id: 'i-2', productId: 'p-5', skuSnapshot: 'CAF-005', nameSnapshot: 'Café molido 500 g', quantity: '1.000', unitPrice: '8990.00', taxRate: '21.00', netAmount: '7429.75', taxAmount: '1560.25', exemptAmount: '0.00', notTaxedAmount: '0.00', total: '8990.00' }],
    formattedNumber: '00003-00001287', qrUrl: 'https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9',
  })],
  ['GET', /^\/marketing\/promotions$/, () => page([{ id: 'pr-1', name: '3x2 en yerbas', type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2, categories: ['Almacén'], brands: ['Del Litoral'], isActive: true, startsAt: '2026-10-01', endsAt: '2026-10-31', createdAt: new Date().toISOString() }, { id: 'pr-2', name: 'Miércoles 15 % en lácteos', type: 'PERCENTAGE', percentBasisPoints: 1500, categories: ['Lácteos'], weekdays: [3], isActive: true, createdAt: new Date().toISOString() }, { id: 'pr-3', name: 'Liquidación limpieza', type: 'PERCENTAGE', percentBasisPoints: 2000, categories: ['Limpieza'], branchIds: ['b-4'], isActive: false, createdAt: new Date().toISOString() }])],
  ['GET', /^\/purchase-orders$/, () => page([['DRAFT', 1840000], ['SENT', 920000], ['PARTIALLY_RECEIVED', 2300000], ['RECEIVED', 640000]].map(([status, total], index) => ({ id: `po-${index}`, number: 120 + index, supplierPersonId: 'c-1', branchId: branches[index].id, status, expectedDate: '2026-10-15', currency: 'ARS', estimatedTotal: String(total), createdByUserId: 'u-1', createdAt: new Date().toISOString() })))],
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(path));
    const payload = route ? route[2](url.searchParams, path, body) : req.method === 'GET' ? { ...page([]), nextCursor: null } : {};
    res.writeHead(200, { 'Content-Type': 'application/json', ...(path.startsWith('/auth/login') ? { 'Set-Cookie': 'refreshToken=demo; Path=/api/v1/auth; HttpOnly; SameSite=Strict' } : {}) });
    res.end(JSON.stringify(payload));
  });
});

server.listen(3000, () => console.log('API simulada en :3000'));
