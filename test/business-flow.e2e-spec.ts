import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminSeederService } from '../src/database/seeders/admin-seeder.service';
import { ARCA_CLIENT, ArcaClient } from '../src/modules/fiscal/arca/arca-client';
import { RoleEntity, UserRoleEnum } from '../src/modules/roles/entities/role.entity';
import { CaeRequest } from '../src/modules/fiscal/arca/wsfe';

/** ARCA simulado: numera por tipo de comprobante y autoriza todo (las pruebas no llegan a ARCA real). */
class FakeArcaClient implements ArcaClient {
  readonly requests: CaeRequest[] = [];
  private readonly last = new Map<string, number>();

  async authenticate() {
    return { token: 'TOKEN', sign: 'SIGN', expiresAt: new Date(Date.now() + 12 * 3600_000) };
  }
  async lastAuthorized(_env: unknown, _auth: unknown, pointOfSale: number, voucherType: number) {
    return this.last.get(`${pointOfSale}:${voucherType}`) ?? 0;
  }
  async requestCae(_env: unknown, _auth: unknown, request: CaeRequest) {
    this.requests.push(request);
    this.last.set(`${request.pointOfSale}:${request.voucherType}`, request.number);
    return { result: 'A', cae: `7${String(request.number).padStart(13, '0')}`, caeExpiration: '20261231', observations: [], errors: [] };
  }
  async consult() {
    return { found: false, cae: null, caeExpiration: null, total: null };
  }
  async receiverConditions() {
    return [{ id: 1, description: 'IVA Responsable Inscripto' }];
  }
  async health() {
    return { app: 'OK', db: 'OK', auth: 'OK' };
  }
}

/**
 * Prueba de integración contra MySQL real: recorre el día operativo de una empresa con dos sucursales
 * (catálogo, promociones, venta con IVA, caja, devolución, transferencia, compra y reportes).
 */
describe('Flujo comercial completo (e2e)', () => {
  let app: INestApplication<App>;
  let token = '';
  const arca = new FakeArcaClient();

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object, idempotent = false) => {
    let call = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    if (idempotent) call = call.set('Idempotency-Key', randomUUID());
    return body ? call.send(body) : call;
  };

  const expectStatus = (response: request.Response, status: number) => {
    if (response.status !== status) {
      throw new Error(`${response.request.method} ${response.request.url} -> ${response.status}: ${JSON.stringify(response.body)}`);
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ARCA_CLIENT)
      .useValue(arca)
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();

    // Base limpia en cada corrida.
    const dataSource = app.get(DataSource);
    await dataSource.synchronize(true);
    await app.get(AdminSeederService).seed();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
    expectStatus(login, 200);
    token = login.body.tokens.accessToken as string;
    expect(login.headers['set-cookie']?.toString()).toContain('refreshToken=');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('opera dos sucursales de punta a punta', async () => {
    // Sucursales
    const branchA = await api('post', '/branches', { code: 'CENTRO', name: 'Sucursal Centro' });
    expectStatus(branchA, 201);
    const branchB = await api('post', '/branches', { code: 'NORTE', name: 'Sucursal Norte' });
    expectStatus(branchB, 201);
    const A = branchA.body.id as string;
    const B = branchB.body.id as string;

    // Producto en ambas sucursales (precio neto + IVA 21 %)
    const product = await api('post', '/products', {
      sku: 'GAS-500',
      name: 'Gaseosa 500 ml',
      category: 'Bebidas',
      brand: 'Marca Test',
      taxRate: 21,
      branchSettings: [
        { branchId: A, costPrice: 600, profitMargin: 66.67, sellingPrice: 1000, stock: 50, minStock: 10 },
        { branchId: B, costPrice: 600, profitMargin: 66.67, sellingPrice: 1000, stock: 2, minStock: 10 },
      ],
    });
    expectStatus(product, 201);
    const productId = product.body.id as string;

    const list = await api('get', `/products?search=Gaseosa&branchId=${A}`);
    expectStatus(list, 200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].branch.stock).toBe(50);
    expectStatus(await api('get', '/products/facets'), 200);

    // Clientes y proveedores
    const customer = await api('post', '/persons', {
      personType: 'CUSTOMER',
      firstName: 'Cliente',
      lastName: 'Inscripto',
      documentType: 80,
      nationalId: '20-12345678-6',
      vatCondition: 'RESPONSABLE_INSCRIPTO',
      email: 'cliente@example.com',
      marketingConsent: true,
    });
    expectStatus(customer, 201);
    const invalidCuit = await api('post', '/persons', {
      firstName: 'Mal',
      lastName: 'Cuit',
      documentType: 80,
      nationalId: '20-12345678-5',
      vatCondition: 'RESPONSABLE_INSCRIPTO',
    });
    expectStatus(invalidCuit, 400);
    const supplier = await api('post', '/persons', {
      personType: 'SUPPLIER',
      firstName: 'Proveedor',
      lastName: 'Mayorista',
      documentType: 80,
      nationalId: '30-71234567-1',
      vatCondition: 'RESPONSABLE_INSCRIPTO',
    });
    expectStatus(supplier, 201);
    const customersList = await api('get', '/persons?role=customers&search=Inscripto');
    expectStatus(customersList, 200);
    expect(customersList.body.total).toBe(1);

    // Promoción: 10 % en bebidas
    expectStatus(
      await api('post', '/marketing/promotions', { name: 'Bebidas 10%', type: 'PERCENTAGE', percentage: 10, categories: ['Bebidas'] }),
      201,
    );

    // Cotización: 3 × $1000 − 10 % = $2700 neto + IVA $567 = $3267 (factura A a RI)
    const quote = await api('post', '/sales/quote', { branchId: A, customerPersonId: customer.body.id, lines: [{ productId, quantity: 3 }] });
    expectStatus(quote, 200);
    expect(quote.body.total).toBe('3267.00');
    expect(quote.body.discountTotal).toBe('300.00');
    expect(quote.body.voucherClass).toBe('A');

    // Caja y venta en efectivo
    const register = await api('post', '/cash/registers', { branchId: A, code: 'CAJA1', name: 'Caja 1' });
    expectStatus(register, 201);
    const session = await api('post', `/cash/registers/${register.body.id}/sessions`, { currency: 'ARS', openingAmount: '1000.00' }, true);
    expectStatus(session, 201);
    const sale = await api(
      'post',
      '/sales',
      {
        branchId: A,
        customerPersonId: customer.body.id,
        lines: [{ productId, quantity: 3 }],
        payments: [{ method: 'CASH', amount: 3267, cashSessionId: session.body.id }],
      },
      true,
    );
    expectStatus(sale, 201);
    expect(sale.body.total).toBe('3267.00');
    expect(sale.body.voucherClass).toBe('A');
    expect(sale.body.items[0].promotionName).toBe('Bebidas 10%');

    const salesList = await api('get', `/sales?branchId=${A}`);
    expectStatus(salesList, 200);
    expect(salesList.body.total).toBe(1);

    // Devolución parcial en efectivo: 1/3 de la línea = $900 + $189
    const saleReturn = await api(
      'post',
      `/sales/${sale.body.id}/returns`,
      {
        lines: [{ saleItemId: sale.body.items[0].id, quantity: 1 }],
        reason: 'Producto fallado',
        restock: true,
        refundMethod: 'CASH',
        cashSessionId: session.body.id,
      },
      true,
    );
    expectStatus(saleReturn, 201);
    expect(saleReturn.body.total).toBe('1089.00');
    const returns = await api('get', `/sales/${sale.body.id}/returns`);
    expectStatus(returns, 200);
    expect(returns.body.length).toBe(1);

    // Factura electrónica A (ARCA simulado) y nota de crédito asociada a la devolución
    expectStatus(
      await api('put', '/fiscal/profile', {
        taxId: '30-71234567-1',
        legalName: 'Comercio de Prueba SA',
        vatConditionCode: 'RESPONSABLE_INSCRIPTO',
        environment: 'HOMOLOGATION',
        certificateSecretRef: 'env:ARCA_CERT',
        privateKeySecretRef: 'env:ARCA_KEY',
        activityStartDate: '2020-01-01',
      }),
      200,
    );
    expectStatus(await api('post', '/fiscal/points-of-sale', { branchId: A, number: 3 }), 201);
    const invoice = await api('post', `/fiscal/sales/${sale.body.id}/invoice`);
    expectStatus(invoice, 200);
    expect(invoice.body.status).toBe('AUTHORIZED');
    expect(invoice.body.voucherType).toBe(1);
    expect(invoice.body.number).toBe(1);
    expect(arca.requests[0].receiverConditionId).toBe(1);
    expect(arca.requests[0].vatRates).toEqual([{ arcaId: 5, base: '2700.00', amount: '567.00' }]);
    const again = await api('post', `/fiscal/sales/${sale.body.id}/invoice`);
    expect(again.body.id).toBe(invoice.body.id);
    expect(arca.requests.length).toBe(1);
    const creditNote = await api('post', `/fiscal/returns/${saleReturn.body.id}/credit-note`);
    expectStatus(creditNote, 200);
    expect(creditNote.body.voucherType).toBe(3);
    expect(arca.requests[1].associated?.number).toBe(1);
    expect(arca.requests[1].total).toBe('1089.00');
    const printable = await api('get', `/fiscal/documents/${invoice.body.id}`);
    expectStatus(printable, 200);
    expect(printable.body.formattedNumber).toBe('00003-00000001');
    expect(printable.body.qrUrl).toContain('https://www.arca.gob.ar/fe/qr/?p=');
    expectStatus(await api('get', '/fiscal/documents'), 200);
    expectStatus(await api('get', '/fiscal/status'), 200);

    // Transferencia de 5 unidades de Centro a Norte
    const transfer = await api('post', '/stock-transfers', { originBranchId: A, destinationBranchId: B, lines: [{ productId, quantity: 5 }] }, true);
    expectStatus(transfer, 201);
    expect(transfer.body.status).toBe('SENT');
    const received = await api('post', `/stock-transfers/${transfer.body.id}/receive`, {});
    expectStatus(received, 200);
    expect(received.body.status).toBe('RECEIVED');

    const matrix = await api('get', '/inventory/stock-matrix');
    expectStatus(matrix, 200);
    expect(matrix.body.items[0].branches[A].stock).toBe('43.000'); // 50 − 3 + 1 − 5
    expect(matrix.body.items[0].branches[B].stock).toBe('7.000'); // 2 + 5
    const lowStock = await api('get', '/inventory/low-stock');
    expectStatus(lowStock, 200);
    expect(lowStock.body.total).toBe(1);
    const replenishment = await api('get', '/inventory/replenishment');
    expectStatus(replenishment, 200);
    expect(replenishment.body.transfers.length + replenishment.body.purchases.length).toBeGreaterThan(0);

    // Pedido de compra desde faltantes, envío y recepción vinculada
    // Norte puede reponerse con el excedente de Centro: no hay nada para comprar.
    const suggested = await api('post', '/purchase-orders/from-replenishment', { supplierPersonId: supplier.body.id, branchId: B });
    expectStatus(suggested, 400);
    const order = await api('post', '/purchase-orders', {
      supplierPersonId: supplier.body.id,
      branchId: B,
      lines: [{ productId, quantity: 20, unitCost: 650 }],
    });
    expectStatus(order, 201);
    expectStatus(await api('post', `/purchase-orders/${order.body.id}/send`), 200);
    const receipt = await api(
      'post',
      '/purchases/receipts',
      {
        branchId: B,
        supplierPersonId: supplier.body.id,
        purchaseOrderId: order.body.id,
        updateSellingPrices: true,
        lines: [{ productId, quantity: 20, unitCost: 650, taxRate: 21 }],
      },
      true,
    );
    expectStatus(receipt, 201);
    const closedOrder = await api('get', `/purchase-orders/${order.body.id}`);
    expectStatus(closedOrder, 200);
    expect(closedOrder.body.status).toBe('RECEIVED');
    expectStatus(await api('get', '/purchases/receipts'), 200);

    // Aumento masivo de precios: vista previa y aplicación
    const preview = await api('post', '/products/price-updates', {
      percentage: 10,
      target: 'SELLING_PRICE',
      rounding: 'UNIT',
      scope: { categories: ['Bebidas'], branchIds: [A] },
      reason: 'Aumento de lista',
      dryRun: true,
    });
    expectStatus(preview, 200);
    expect(preview.body.affectedRows).toBe(1);
    expect(preview.body.preview[0].newSellingPrice).toBe('1100.00');
    const applied = await api('post', '/products/price-updates', {
      percentage: 10,
      target: 'SELLING_PRICE',
      rounding: 'UNIT',
      scope: { categories: ['Bebidas'], branchIds: [A] },
      reason: 'Aumento de lista',
      dryRun: false,
    });
    expectStatus(applied, 200);
    const history = await api('get', `/products/${productId}/price-history`);
    expectStatus(history, 200);
    expect(history.body.total).toBeGreaterThanOrEqual(2);
    expectStatus(await api('put', `/products/${productId}/branches/${B}`, { minStock: 5 }), 200);

    // Tablero: ventas netas $3267 − $1089 = $2178; margen ($2700 − $900) − ($600 × 2) = $600
    const dashboard = await api('get', '/reports/dashboard');
    expectStatus(dashboard, 200);
    expect(dashboard.body.totals.tickets).toBe(1);
    expect(dashboard.body.totals.netSales).toBe(2178);
    expect(dashboard.body.totals.grossMargin).toBe(600);
    expect(dashboard.body.operations.openCashSessions).toBe(1);

    for (const path of [
      '/reports/sales-by-day',
      '/reports/sales-by-hour',
      '/reports/top-products',
      '/reports/sales-by-category',
      '/reports/sales-by-payment-method',
      '/reports/sales-by-seller',
      '/reports/stock-valuation',
      '/reports/dead-stock',
      '/marketing/customers/top',
      '/marketing/customers/inactive',
      '/marketing/customers/summary',
      '/marketing/promotions?current=true',
      '/stock-transfers',
      '/purchase-orders',
      '/audit-events',
    ]) {
      expectStatus(await api('get', path), 200);
    }
    const top = await api('get', '/reports/top-products');
    expect(top.body.items[0].quantity).toBe(2);
    const csv = await api('get', '/marketing/customers/contacts.csv');
    expectStatus(csv, 200);
    expect(csv.text).toContain('cliente@example.com');

    // ── Preventa: la vendedora arma el pedido y la caja lo cobra ──────────────────────────────
    const roleRepository = app.get(DataSource).getRepository(RoleEntity);
    const sellerRole =
      (await roleRepository.findOne({ where: { name: UserRoleEnum.SELLER } })) ??
      (await roleRepository.save(roleRepository.create({ name: UserRoleEnum.SELLER, description: 'Vendedor' })));
    const sellerPerson = await api('post', '/persons', {
      firstName: 'Vera',
      lastName: 'Vendedora',
      documentType: 96,
      nationalId: '30111222',
      vatCondition: 'CONSUMIDOR_FINAL',
    });
    expectStatus(sellerPerson, 201);
    const sellerPassword = 'Vendedora-2026x';
    const sellerUser = await api('post', '/users', {
      username: 'vera.vendedora',
      password: sellerPassword,
      roleIds: [sellerRole.id],
      personId: sellerPerson.body.id,
      branchId: A,
    });
    expectStatus(sellerUser, 201);
    const sellerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'vera.vendedora', password: sellerPassword });
    expectStatus(sellerLogin, 200);
    const adminToken = token;
    token = sellerLogin.body.tokens.accessToken as string;

    // La vendedora no cobra: POST /sales le está vedado; arma el pedido.
    const sellerSale = await api(
      'post',
      '/sales',
      { branchId: A, lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 1000 }] },
      true,
    );
    expectStatus(sellerSale, 403);
    expectStatus(await api('post', '/sales-orders', { branchId: B, lines: [{ productId, quantity: 1 }] }, true), 403);
    const orderKey = randomUUID();
    const salesOrder = await request(app.getHttpServer())
      .post('/api/v1/sales-orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', orderKey)
      .send({ branchId: A, lines: [{ productId, quantity: 2 }], notes: 'Retira en mostrador' });
    expectStatus(salesOrder, 201);
    expect(salesOrder.body.status).toBe('PENDING');
    expect(salesOrder.body.number).toBe(1);
    expect(salesOrder.body.sellerName).toBe('Vera Vendedora');
    expect(salesOrder.body.items.length).toBe(1);
    // Precio vigente $1100 (aumento de lista) − 10 % de promoción = $1980 neto + IVA 21 % = $2395.80
    expect(salesOrder.body.estimatedTotal).toBe('2395.80');
    const replay = await request(app.getHttpServer())
      .post('/api/v1/sales-orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', orderKey)
      .send({ branchId: A, lines: [{ productId, quantity: 2 }], notes: 'Retira en mostrador' });
    expectStatus(replay, 201);
    expect(replay.body.id).toBe(salesOrder.body.id);
    const spare = await api('post', '/sales-orders', { branchId: A, lines: [{ productId, quantity: 1 }] }, true);
    expectStatus(spare, 201);
    expect(spare.body.number).toBe(2);
    const stockBeforeCharge = await api('get', '/inventory/stock-matrix');
    expect(stockBeforeCharge.body.items[0].branches[A].stock).toBe('43.000'); // el pedido no descuenta stock

    // La caja (administrador) ve la cola, busca el pedido por número y lo cobra.
    token = adminToken;
    const queue = await api('get', '/sales-orders?status=PENDING');
    expectStatus(queue, 200);
    expect(queue.body.total).toBe(2);
    expect(queue.body.items[0].number).toBe(1);
    const byNumber = await api('get', '/sales-orders/by-number/1');
    expectStatus(byNumber, 200);
    expect(byNumber.body.id).toBe(salesOrder.body.id);
    expectStatus(await api('get', '/sales-orders/by-number/999'), 404);
    const pendingDashboard = await api('get', '/reports/dashboard');
    expect(pendingDashboard.body.operations.salesOrdersPending).toBe(2);

    const charge = {
      branchId: A,
      salesOrderId: salesOrder.body.id,
      lines: [{ productId, quantity: 2 }],
      payments: [{ method: 'CASH', amount: 2395.8, cashSessionId: session.body.id }],
    };
    const charged = await api('post', '/sales', charge, true);
    expectStatus(charged, 201);
    expect(charged.body.salesOrderId).toBe(salesOrder.body.id);
    expect(charged.body.sellerUserId).toBe(sellerUser.body.id);
    expect(charged.body.total).toBe('2395.80');
    const chargedOrder = await api('get', `/sales-orders/${salesOrder.body.id}`);
    expect(chargedOrder.body.status).toBe('CHARGED');
    expect(chargedOrder.body.saleId).toBe(charged.body.id);
    // Otra caja no puede cobrar el mismo pedido.
    expectStatus(await api('post', '/sales', charge, true), 409);
    const bySeller = await api('get', `/sales?sellerUserId=${sellerUser.body.id}`);
    expectStatus(bySeller, 200);
    expect(bySeller.body.total).toBe(1);
    const sellerReport = await api('get', '/reports/sales-by-seller');
    expect(sellerReport.body.items.some((row: { userId: string; tickets: number }) => row.userId === sellerUser.body.id && row.tickets === 1)).toBe(true);

    // La vendedora puede anular su propio pedido pendiente, pero no uno cobrado.
    token = sellerLogin.body.tokens.accessToken as string;
    expectStatus(await api('post', `/sales-orders/${salesOrder.body.id}/cancel`, { reason: 'Se arrepintió' }), 409);
    const cancelled = await api('post', `/sales-orders/${spare.body.id}/cancel`, { reason: 'El cliente no vino' });
    expectStatus(cancelled, 200);
    expect(cancelled.body.status).toBe('CANCELLED');
    token = adminToken;
    expectStatus(await api('post', '/sales', { ...charge, salesOrderId: spare.body.id, lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 1197.9 }] }, true), 409);
    const finalDashboard = await api('get', '/reports/dashboard');
    expect(finalDashboard.body.operations.salesOrdersPending).toBe(0);
    const audit = await api('get', '/audit-events');
    expectStatus(audit, 200);
  });
});
