import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminSeederService } from '../src/database/seeders/admin-seeder.service';

/**
 * Prueba de integración contra MySQL real: recorre el día operativo de una empresa con dos sucursales
 * (catálogo, promociones, venta con IVA, caja, devolución, transferencia, compra y reportes).
 */
describe('Flujo comercial completo (e2e)', () => {
  let app: INestApplication<App>;
  let token = '';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const customersList = await api('get', '/persons?role=customers');
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
  });
});
