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

  /** Simula un problema de credenciales (certificado inexistente) en el próximo intento. */
  failAuth: string | null = null;
  async authenticate() {
    if (this.failAuth) {
      const message = this.failAuth;
      this.failAuth = null;
      throw new Error(message);
    }
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
  /** El administrador sembrado es el operador de la plataforma (SUPER_ADMIN). */
  let operatorId = '';
  const arca = new FakeArcaClient();

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object, idempotent = false) => {
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
    operatorId = login.body.user.id as string;
    expect(login.headers['set-cookie']?.toString()).toContain('refreshToken=');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('opera dos sucursales de punta a punta', async () => {
    // Sucursales
    const branchA = await api('post', '/branches', {
      code: 'CENTRO',
      name: 'Sucursal Centro',
      address: 'San Martín 123',
      city: 'Ushuaia',
      province: 'Tierra del Fuego',
      phone: '2901-430000',
    });
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
      address: 'Belgrano 450',
      city: 'Río Grande',
      province: 'Tierra del Fuego',
      marketingConsent: true,
    });
    expectStatus(customer, 201);
    // Número de cuenta correlativo por empresa (se imprime en los comprobantes).
    const customerAccount = customer.body.accountNumber as number;
    expect(customerAccount).toBeGreaterThan(0);
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
    expect(supplier.body.accountNumber).toBe(customerAccount + 1);
    const byAccount = await api('get', `/persons?search=${customerAccount}`);
    expect(byAccount.body.items.map((person: { id: string }) => person.id)).toContain(customer.body.id);
    const customersList = await api('get', '/persons?role=customers&search=Inscripto');
    expectStatus(customersList, 200);
    expect(customersList.body.total).toBe(1);

    // Promoción: 10 % en bebidas
    expectStatus(
      await api('post', '/marketing/promotions', { name: 'Bebidas 10%', type: 'PERCENTAGE', percentage: 10, categories: ['Bebidas'] }),
      201,
    );

    // ── Listas de precios: descuento en efectivo, precio de lista y recargo gobierno ──
    const initialLists = await api('get', '/price-lists');
    expectStatus(initialLists, 200);
    if (!(initialLists.body as Array<{ isDefault: boolean }>).some((list) => list.isDefault)) {
      expectStatus(await api('post', '/price-lists', { name: 'Precio de lista', percentage: 0, isDefault: true }), 201);
    }
    const cashList = await api('post', '/price-lists', { name: 'Ventas en efectivo', percentage: -5, paymentCondition: 'CASH_ONLY' });
    expectStatus(cashList, 201);
    expect(cashList.body).toMatchObject({ percentage: '-5.00', paymentCondition: 'CASH_ONLY', isDefault: false });
    const govList = await api('post', '/price-lists', { name: 'Lista gobierno', percentage: 300 });
    expectStatus(govList, 201);
    expectStatus(await api('post', '/price-lists', { name: 'lista GOBIERNO', percentage: 10 }), 409);
    expectStatus(await api('post', '/price-lists', { name: 'Imposible', percentage: -100 }), 400);
    const lineFor = (body: { lines: Array<{ unitPrice: string }> }) => body.lines[0].unitPrice;
    const govQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }], priceListId: govList.body.id });
    expectStatus(govQuote, 200);
    expect(lineFor(govQuote.body)).toBe('4000.00'); // $1000 + 300 %
    expect(govQuote.body.priceList).toMatchObject({ name: 'Lista gobierno', percentage: '300.00' });
    const cashQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }], priceListId: cashList.body.id });
    expect(lineFor(cashQuote.body)).toBe('950.00'); // $1000 − 5 %
    // El ticket muestra el descuento de la lista: se informa el precio previo a la lista.
    expect(cashQuote.body.lines[0].listBasePrice).toBe('1000.00');
    const defaultQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }] });
    expect(lineFor(defaultQuote.body)).toBe('1000.00');
    expect(defaultQuote.body.lines[0].listBasePrice).toBeNull();
    // "Ventas en efectivo" solo se cobra en efectivo.
    const cardWithCashList = await api(
      'post',
      '/sales',
      { branchId: A, lines: [{ productId, quantity: 1 }], priceListId: cashList.body.id, payments: [{ method: 'DEBIT_CARD', amount: 1000 }] },
      true,
    );
    expectStatus(cardWithCashList, 400);
    expect(cardWithCashList.body.message).toContain('efectivo');
    // El catálogo muestra el precio en cada lista.
    const pricedCatalog = await api('get', `/products?branchId=${A}&search=Gaseosa`);
    const listPrices = pricedCatalog.body.items[0].branch.listPrices as Array<{ priceListId: string; price: string }>;
    expect(listPrices).toEqual(expect.arrayContaining([
      expect.objectContaining({ priceListId: govList.body.id, price: '4000.00' }),
      expect.objectContaining({ priceListId: cashList.body.id, price: '950.00' }),
    ]));
    // Foto del producto: se valida el contenido real; el nombre lo genera el sistema.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', png, 'foto.png');
    expectStatus(upload, 200);
    expect(upload.body.imageUrl).toMatch(/^\/api\/v1\/product-images\/[0-9a-f-]{36}\.png$/);
    const served = await request(app.getHttpServer()).get(upload.body.imageUrl as string);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    const fake = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('<script>alert(1)</script>'), 'foto.png');
    expectStatus(fake, 400);
    expect((await request(app.getHttpServer()).get('/api/v1/product-images/..%2F..%2Fpackage.json')).status).toBe(404);
    const withImage = await api('get', `/products?branchId=${A}&search=Gaseosa`);
    expect(withImage.body.items[0].imageUrl).toBe(upload.body.imageUrl);
    // Editar y eliminar (baja lógica): la lista eliminada ya no se ofrece ni se puede usar.
    const editedGov = await api('patch', `/price-lists/${govList.body.id}`, { percentage: 250, description: 'Organismos públicos' });
    expect(editedGov.body.percentage).toBe('250.00');
    const tempList = await api('post', '/price-lists', { name: 'Temporal', percentage: 1 });
    expectStatus(await api('delete', `/price-lists/${tempList.body.id}`), 200);
    expect((await api('get', '/price-lists')).body.map((list: { id: string }) => list.id)).not.toContain(tempList.body.id);
    expectStatus(await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }], priceListId: tempList.body.id }), 400);
    const defaultList = ((await api('get', '/price-lists')).body as Array<{ id: string; isDefault: boolean }>).find((list) => list.isDefault)!;
    expectStatus(await api('delete', `/price-lists/${defaultList.id}`), 400); // la principal no se elimina
    expectStatus(await api('patch', `/price-lists/${govList.body.id}`, { percentage: 300 }), 200);

    // Precio final al consumidor (Gaseosa: $1000 + IVA 21 %), también por lista.
    const finalCatalog = await api('get', `/products?branchId=${A}&search=Gaseosa`);
    expect(finalCatalog.body.items[0].branch.finalPrice).toBe('1210.00');
    expect(finalCatalog.body.items[0].branch.listPrices).toEqual(
      expect.arrayContaining([{ priceListId: govList.body.id, price: '4000.00', finalPrice: '4840.00' }]),
    );

    // ── Flete y aumentos por proveedor ──
    const screw = await api('post', '/products', {
      sku: 'TOR-001',
      name: 'Tornillo autoperforante',
      category: 'Ferretería',
      taxRate: 21,
      priceIncludesVat: true,
      supplierPersonId: supplier.body.id,
      branchSettings: [{ branchId: A, costPrice: 1000, profitMargin: 50, sellingPrice: 1500, stock: 10, minStock: 1 }],
    });
    expectStatus(screw, 201);
    const screwId = screw.body.id as string;
    expectStatus(await api('post', '/products', { sku: 'TOR-002', name: 'Inválido', taxRate: 21, supplierPersonId: customer.body.id, branchSettings: [] }), 400);
    // Flete 10 %: costo total $1100 y el precio acompaña manteniendo el 50 %.
    const withFreight = await api('put', `/products/${screwId}/branches/${A}`, { freightPercentage: 10 });
    expectStatus(withFreight, 200);
    expect(withFreight.body).toMatchObject({ freightPercentage: 10, totalCost: 1100, sellingPrice: 1650, profitMargin: 50 });
    // Flete masivo por proveedor (vista previa): 20 % → costo total $1200 → $1800.
    const freightPreview = await api('post', '/products/price-updates', {
      mode: 'FREIGHT',
      percentage: 20,
      scope: { supplierIds: [supplier.body.id], branchIds: [A] },
      reason: 'Flete del proveedor',
      dryRun: true,
    });
    expectStatus(freightPreview, 200);
    expect(freightPreview.body.preview).toEqual([
      expect.objectContaining({ sku: 'TOR-001', oldFreightPercentage: '10.00', newFreightPercentage: '20.00', newSellingPrice: '1800.00' }),
    ]);
    // Aumento en pesos del proveedor: +$100 al costo, mantiene el margen e informa el % equivalente.
    const amountUpdate = await api('post', '/products/price-updates', {
      mode: 'AMOUNT',
      amount: 100,
      target: 'COST_KEEP_MARGIN',
      scope: { productIds: [screwId], branchIds: [A] },
      reason: 'Lista nueva del proveedor',
      dryRun: false,
    });
    expectStatus(amountUpdate, 200);
    expect(amountUpdate.body.preview[0]).toMatchObject({ newCostPrice: '1100.00', newSellingPrice: '1815.00', sellingChangePercentage: '10.00' });
    const bySupplier = await api('get', `/products?branchId=${A}&supplierId=${supplier.body.id}`);
    expect(bySupplier.body.items.map((item: { sku: string }) => item.sku)).toEqual(['TOR-001']);
    expect(bySupplier.body.items[0].supplier).toMatchObject({ id: supplier.body.id });
    expect(bySupplier.body.items[0].branch).toMatchObject({ costPrice: 1100, freightPercentage: 10, totalCost: 1210, sellingPrice: 1815 });
    // Selección puntual (etiquetas): solo los productos pedidos.
    const byIds = await api('get', `/products?branchId=${A}&ids=${screwId},${productId}&sort=sku`);
    expectStatus(byIds, 200);
    expect(byIds.body.items.map((item: { id: string }) => item.id).sort()).toEqual([productId, screwId].sort());
    expectStatus(await api('get', '/products?ids=no-es-uuid'), 400);

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
        grossIncomeRegistration: '999-1267752',
        commercialAddress: 'Av. San Martín 1000',
        commercialCity: 'Ushuaia',
        commercialProvince: 'Tierra del Fuego',
        phone: '2901-421111',
      }),
      200,
    );
    expectStatus(await api('post', '/fiscal/points-of-sale', { branchId: A, number: 3 }), 201);
    // Sin certificado el comprobante no queda "pendiente" en silencio: guarda el motivo y se puede reintentar.
    arca.failAuth = 'No se encontró el archivo de secreto "empresa.crt" en FISCAL_SECRETS_DIR.';
    expectStatus(await api('post', `/fiscal/sales/${sale.body.id}/invoice`), 400);
    const failedDocs = await api('get', '/fiscal/documents?status=ERROR');
    expect(failedDocs.body.items[0]).toMatchObject({ status: 'ERROR', number: null });
    expect(failedDocs.body.items[0].errorMessage).toContain('empresa.crt');
    expect(arca.requests.length).toBe(0);
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
    // La factura muestra quién vendió, quién cobró y cómo se pagó (el operador figura como soporte).
    expect(printable.body.operation).toMatchObject({
      sellerName: 'Soporte de la plataforma',
      cashierName: 'Soporte de la plataforma',
      payments: [{ method: 'CASH', amount: '3267.00' }],
    });
    expect(printable.body.qrUrl).toContain('https://www.arca.gob.ar/fe/qr/?p=');
    // Encabezado: datos de la empresa con el domicilio del local donde se vendió.
    expect(printable.body.issuer).toMatchObject({
      legalName: 'Comercio de Prueba SA',
      address: 'San Martín 123',
      city: 'Ushuaia',
      province: 'Tierra del Fuego',
      phone: '2901-430000',
      vatCondition: 'RESPONSABLE_INSCRIPTO',
      cuit: '30712345671',
      grossIncomeRegistration: '999-1267752',
      activityStartDate: '2020-01-01',
    });
    expect(printable.body.receiver).toMatchObject({
      name: 'Inscripto Cliente',
      accountNumber: customerAccount,
      address: 'Belgrano 450',
      city: 'Río Grande',
      province: 'Tierra del Fuego',
      vatCondition: 'RESPONSABLE_INSCRIPTO',
      nationalId: '20123456786',
    });
    const letterhead = await api('get', `/fiscal/letterhead?branchId=${A}`);
    expectStatus(letterhead, 200);
    expect(letterhead.body).toMatchObject({ branchName: 'Sucursal Centro', address: 'San Martín 123', grossIncomeRegistration: '999-1267752' });
    expect(letterhead.body).not.toHaveProperty('certificateSecretRef');
    expectStatus(await api('get', '/fiscal/documents'), 200);
    // Buscador del historial de comprobantes: por número, por CUIT/DNI y por nombre del cliente.
    const docByNumber = await api('get', '/fiscal/documents?search=00003-00000001');
    // Factura A y nota de crédito A comparten el n.º 00003-00000001 (cada tipo tiene su propia numeración).
    expect(docByNumber.body.items.map((item: { id: string }) => item.id).sort()).toEqual([invoice.body.id, creditNote.body.id].sort());
    expect(docByNumber.body.items.every((item: { customerName: string }) => item.customerName === 'Inscripto Cliente')).toBe(true);
    expect((await api('get', '/fiscal/documents?search=3-1')).body.total).toBe(2);
    expect((await api('get', '/fiscal/documents?search=00003-00000002')).body.total).toBe(0);
    const byCuit = await api('get', '/fiscal/documents?search=20-12345678-6');
    expect(byCuit.body.total).toBe(2); // la factura y la nota de crédito de la devolución
    const byName = await api('get', `/fiscal/documents?search=${encodeURIComponent('inscripto')}`);
    expect(byName.body.total).toBe(2);
    expect((await api('get', '/fiscal/documents?search=Nadie%20Existe')).body.total).toBe(0);
    expect((await api('get', '/fiscal/documents?voucherClass=B')).body.total).toBe(0);
    expectStatus(await api('get', `/fiscal/documents?search=${encodeURIComponent("' OR 1=1 --")}`), 200);
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
    expectStatus(await api('get', '/inventory/stock-matrix'), 403); // el vendedor no ve el stock de todas las sucursales

    // La caja (administrador) ve la cola, busca el pedido por número y lo cobra.
    token = adminToken;
    const stockBeforeCharge = await api('get', '/inventory/stock-matrix');
    expect(stockBeforeCharge.body.items[0].branches[A].stock).toBe('43.000'); // el pedido no descuenta stock
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
    expect(charged.body.sellerName).toBe('Vera Vendedora');
    expect(charged.body.cashierName).toBe('Soporte de la plataforma');
    expect(charged.body.total).toBe('2395.80');
    const stockAfterCharge = await api('get', '/inventory/stock-matrix');
    expect(stockAfterCharge.body.items[0].branches[A].stock).toBe('41.000'); // el cobro sí descuenta
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

    // ── Caja: venta con tarjeta imputada a la caja, cierre X (sigue abierta) y cierre Z ──
    const cardSale = await api(
      'post',
      '/sales',
      { branchId: A, lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 1197.9 }], cashSessionId: session.body.id },
      true,
    );
    expectStatus(cardSale, 201);
    const liveSession = await api('get', `/cash/sessions/${session.body.id}`);
    expectStatus(liveSession, 200);
    expect(liveSession.body.status).toBe('OPEN');
    expect(liveSession.body.summary.sales.count).toBe(3);
    expect(liveSession.body.summary.payments).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'CASH' }), expect.objectContaining({ key: 'DEBIT_CARD', amount: '1197.90' })]),
    );
    expect(liveSession.body.summary.refunds.cash).toBe('1089.00');
    const expectedCash = liveSession.body.expectedAmount as string;
    expect(liveSession.body.summary.expectedCash).toBe(expectedCash);
    const xReport = await api('post', `/cash/sessions/${session.body.id}/x-reports`, { countedAmount: expectedCash }, true);
    expectStatus(xReport, 201);
    expect(xReport.body).toMatchObject({ type: 'X', number: 1, differenceAmount: '0.00' });
    const secondX = await api('post', `/cash/sessions/${session.body.id}/x-reports`, {}, true);
    expect(secondX.body).toMatchObject({ type: 'X', number: 2, countedAmount: null });
    expect((await api('get', `/cash/sessions/${session.body.id}`)).body.status).toBe('OPEN'); // el X no cierra
    const shortCount = (Number(expectedCash) - 100).toFixed(2);
    const zClose = await api('post', `/cash/sessions/${session.body.id}/close`, { countedAmount: shortCount, notes: 'Faltan $100' }, true);
    expectStatus(zClose, 200);
    expect(zClose.body).toMatchObject({ status: 'CLOSED', differenceAmount: '-100.00', closingNotes: 'Faltan $100' });
    expect(zClose.body.report).toMatchObject({ type: 'Z', number: 1, countedAmount: shortCount });
    expectStatus(await api('post', `/cash/sessions/${session.body.id}/x-reports`, {}, true), 409);
    // Cierre detallado: productos vendidos y ventas (con medio de pago) hasta el cierre.
    const xDetail = await api('get', `/cash/reports/${xReport.body.id}/sales`);
    expectStatus(xDetail, 200);
    expect(xDetail.body.sales.length).toBe(3);
    expect(xDetail.body.sales.map((sale: { payments: string[] }) => sale.payments.join('+'))).toEqual(expect.arrayContaining(['CASH', 'DEBIT_CARD']));
    expect(xDetail.body.products[0]).toMatchObject({ productId, quantity: '6.000' });
    const zDetail = await api('get', `/cash/sessions/${session.body.id}/sales`);
    expect(zDetail.body.sales.length).toBe(3);
    const zPrint = await api('get', `/cash/reports/${zClose.body.report.id}`);
    expectStatus(zPrint, 200);
    expect(zPrint.body).toMatchObject({ registerCode: 'CAJA1', type: 'Z' });
    expect(zPrint.body.summary.sales.count).toBe(3);
    const cashHistory = await api('get', `/cash/sessions?branchId=${A}`);
    expectStatus(cashHistory, 200);
    expect(cashHistory.body.items[0]).toMatchObject({ id: session.body.id, zNumber: 1, salesCount: 3 });
    expect(zPrint.body.summary.tickets).toMatchObject({ sales: 3 });
    expectStatus(await api('post', `/cash/sessions/${session.body.id}/count`, { countedAmount: '1.00' }, true), 409); // ya tenía arqueo

    // Z sin arqueo (se emite desde la oficina) y arqueo posterior.
    const session2 = await api('post', `/cash/registers/${register.body.id}/sessions`, { currency: 'ARS', openingAmount: '500.00' }, true);
    expectStatus(session2, 201);
    const blindZ = await api('post', `/cash/sessions/${session2.body.id}/close`, {}, true);
    expectStatus(blindZ, 200);
    expect(blindZ.body).toMatchObject({ status: 'CLOSED', countedAmount: null, differenceAmount: null });
    expect(blindZ.body.report).toMatchObject({ type: 'Z', number: 2, countedAmount: null, differenceAmount: null });
    const lateCount = await api('post', `/cash/sessions/${session2.body.id}/count`, { countedAmount: '480.00', notes: 'Contado en la oficina' }, true);
    expectStatus(lateCount, 200);
    expect(lateCount.body).toMatchObject({ countedAmount: '480.00', differenceAmount: '-20.00' });
    expect(lateCount.body.report).toMatchObject({ countedAmount: '480.00', differenceAmount: '-20.00' });
    expectStatus(await api('post', `/cash/sessions/${session2.body.id}/count`, { countedAmount: '500.00' }, true), 409);
    // Buscador de cierres: todos, por tipo y por número.
    const allReports = await api('get', `/cash/reports?branchId=${A}`);
    expectStatus(allReports, 200);
    expect(allReports.body.items.map((row: { type: string; number: number }) => `${row.type}${row.number}`)).toEqual(['Z2', 'Z1', 'X2', 'X1']);
    const zOnly = await api('get', '/cash/reports?type=Z');
    expect(zOnly.body.total).toBe(2);
    const zByNumber = await api('get', '/cash/reports?type=Z&number=2');
    expect(zByNumber.body.items).toEqual([expect.objectContaining({ type: 'Z', number: 2, countedAmount: '480.00', registerCode: 'CAJA1' })]);
    // Filtro por día local (Argentina): hoy incluye todos los cierres de hoy, aunque en UTC ya sea mañana.
    const todayAr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const todayReports = await api('get', `/cash/reports?from=${todayAr}&to=${todayAr}`);
    expect(todayReports.body.total).toBe(4);
    const todaySales = await api('get', `/sales?from=${todayAr}&to=${todayAr}`);
    expect(todaySales.body.total).toBeGreaterThanOrEqual(3);
    const closedDetail = await api('get', `/cash/sessions/${session.body.id}`);
    expect(closedDetail.body.reports.map((report: { type: string; number: number }) => `${report.type}${report.number}`)).toEqual(['X1', 'X2', 'Z1']);
    const audit = await api('get', '/audit-events');
    expectStatus(audit, 200);

    // ── Empleados: alta con varios roles, edición, contraseñas y desactivación ─────────────────
    const loginAs = (username: string, password: string) =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password });
    const claimsOf = (accessToken: string) =>
      JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as { tenantRole: string; tenantRoles: string[]; tenantId: string };

    const employee = await api('post', '/employees', {
      firstName: 'Camila',
      lastName: 'Cajera',
      documentType: 96,
      nationalId: '28999111',
      email: 'camila@example.com',
      username: 'Camila.Caja',
      password: 'Camila-Caja-2026',
      roles: ['INVENTORY', 'CASHIER'],
      branchId: A,
    });
    expectStatus(employee, 201);
    expect(employee.body.username).toBe('camila.caja');
    expect(employee.body.roles).toEqual(['CASHIER', 'INVENTORY']);
    expect(employee.body.primaryRole).toBe('CASHIER');
    expect(employee.body.branchId).toBe(A);
    const camilaId = employee.body.id as string;
    expectStatus(await api('post', '/employees', { firstName: 'Sin', lastName: 'Sucursal', username: 'sin.sucursal', password: 'Sin-Sucursal-2026', roles: ['CASHIER'] }), 400);
    expectStatus(await api('post', '/employees', { firstName: 'Otro', lastName: 'Titular', username: 'otro.titular', password: 'Otro-Titular-2026', roles: ['OWNER'] }), 400);
    expectStatus(await api('post', '/employees', { firstName: 'Clave', lastName: 'Debil', username: 'clave.debil', password: 'corta', roles: ['VIEWER'] }), 400);
    expectStatus(await api('post', '/employees', { firstName: 'Repetido', lastName: 'Usuario', username: 'camila.caja', password: 'Repetido-2026x', roles: ['VIEWER'] }), 409);
    const searched = await api('get', '/employees?search=camila');
    expectStatus(searched, 200);
    expect(searched.body.total).toBe(1);
    const byRole = await api('get', '/employees?role=INVENTORY');
    expect(byRole.body.items.some((row: { id: string }) => row.id === camilaId)).toBe(true);

    // La empleada ingresa con sus dos roles: puede ver transferencias (depósito) y no administra empleados.
    const camilaLogin = await loginAs('camila.caja', 'Camila-Caja-2026');
    expectStatus(camilaLogin, 200);
    expect(claimsOf(camilaLogin.body.tokens.accessToken).tenantRoles).toEqual(['CASHIER', 'INVENTORY']);
    const camilaCookie = camilaLogin.headers['set-cookie'];
    token = camilaLogin.body.tokens.accessToken as string;
    expectStatus(await api('get', '/stock-transfers'), 200);
    expectStatus(await api('get', '/employees'), 403);
    // La cajera ve qué caja está abierta para cobrar, pero no los importes ni la administración de la caja.
    const cashierRegisters = await api('get', '/cash/registers');
    expectStatus(cashierRegisters, 200);
    for (const register of cashierRegisters.body as Array<{ openSession: { expectedAmount: string | null } | null }>) {
      if (register.openSession) expect(register.openSession.expectedAmount).toBeNull();
    }
    expectStatus(await api('get', '/cash/sessions'), 403);
    expectStatus(await api('post', `/cash/registers/${register.body.id}/sessions`, { currency: 'ARS', openingAmount: '0' }, true), 403);
    token = adminToken;

    // Edición: datos personales y roles. Cambiar roles cierra sus sesiones (el refresh deja de servir).
    const edited = await api('patch', `/employees/${camilaId}`, { phone: '351 555-1234', roles: ['SELLER'], lastName: 'Vendedora' });
    expectStatus(edited, 200);
    expect(edited.body.roles).toEqual(['SELLER']);
    expect(edited.body.lastName).toBe('Vendedora');
    expect(edited.body.phone).toBe('351 555-1234');
    const staleRefresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', camilaCookie).send({});
    expectStatus(staleRefresh, 401);
    expectStatus(await api('patch', `/employees/${camilaId}`, { branchId: null }), 400); // un vendedor necesita sucursal

    // Contraseña definida por la administración.
    expectStatus(await api('post', `/employees/${camilaId}/password`, { newPassword: 'Nueva-Clave-2026' }), 200);
    expectStatus(await loginAs('camila.caja', 'Camila-Caja-2026'), 401);
    const renewed = await loginAs('camila.caja', 'Nueva-Clave-2026');
    expectStatus(renewed, 200);

    // La empleada cambia su propia contraseña (pide la actual).
    token = renewed.body.tokens.accessToken as string;
    expectStatus(await api('post', '/auth/change-password', { currentPassword: 'equivocada', newPassword: 'Propia-Clave-2026' }), 400);
    expectStatus(await api('post', '/auth/change-password', { currentPassword: 'Nueva-Clave-2026', newPassword: 'Propia-Clave-2026' }), 200);
    expectStatus(await loginAs('camila.caja', 'Propia-Clave-2026'), 200);
    const camilaToken = token;
    token = adminToken;

    // Desactivar corta el acceso al instante; reactivar lo devuelve.
    const deactivated = await api('post', `/employees/${camilaId}/deactivate`);
    expectStatus(deactivated, 200);
    expect(deactivated.body.status).toBe('SUSPENDED');
    token = camilaToken;
    expectStatus(await api('get', '/sales-orders'), 401);
    token = adminToken;
    expectStatus(await api('post', `/employees/${camilaId}/activate`), 200);
    expect((await api('get', '/employees?status=ALL&search=camila')).body.items[0].status).toBe('ACTIVE');

    // Un administrador gestiona empleados, pero no otorga el rol de administración ni se toca a sí mismo.
    const adminEmployee = await api('post', '/employees', {
      firstName: 'Adrián',
      lastName: 'Administra',
      username: 'adrian.admin',
      password: 'Adrian-Admin-2026',
      roles: ['ADMIN', 'MANAGER'],
    });
    expectStatus(adminEmployee, 201);
    expect(adminEmployee.body.roles).toEqual(['ADMIN', 'MANAGER']);
    const adrianLogin = await loginAs('adrian.admin', 'Adrian-Admin-2026');
    expectStatus(adrianLogin, 200);
    token = adrianLogin.body.tokens.accessToken as string;
    expectStatus(await api('patch', `/employees/${camilaId}`, { address: 'Av. Colón 100' }), 200);
    expectStatus(await api('patch', `/employees/${camilaId}`, { roles: ['SELLER', 'ADMIN'] }), 403);
    expectStatus(await api('post', `/employees/${adminEmployee.body.id}/deactivate`), 400);
    expectStatus(await api('patch', `/employees/${adminEmployee.body.id}`, { roles: ['VIEWER'] }), 403);
    // El operador de la plataforma no existe para la empresa: ni siquiera un administrador puede tocarlo.
    expectStatus(await api('post', `/employees/${operatorId}/password`, { newPassword: 'Robar-Cuenta-2026' }), 404);
    expectStatus(await api('patch', `/employees/${operatorId}`, { firstName: 'Curioso' }), 404);
    expectStatus(await api('post', `/employees/${operatorId}/deactivate`), 404);
    token = adminToken;
    expectStatus(await api('post', `/employees/${operatorId}/password`, { newPassword: 'Mi-Propia-2026x' }), 400); // la propia se cambia con la actual

    // ── Operador de la plataforma invisible para la empresa ──
    const everyone = await api('get', '/employees?status=ALL&limit=100');
    expectStatus(everyone, 200);
    expect(everyone.body.items.some((row: { id: string; username: string }) => row.id === operatorId || row.username === 'admin')).toBe(false);
    expect((await api('get', '/employees?role=OWNER')).body.total).toBe(0);
    expect((await api('get', '/employees?search=admin')).body.items.some((row: { username: string }) => row.username === 'admin')).toBe(false);
    expectStatus(await api('get', `/employees/${operatorId}`), 404);
    const legacyUsers = await api('get', '/users');
    expectStatus(legacyUsers, 200);
    expect(legacyUsers.body.some((row: { id: string }) => row.id === operatorId)).toBe(false);
    expectStatus(await api('get', `/users/${operatorId}`), 404);
    const operatorAudit = await api('get', '/audit-events?limit=100');
    expectStatus(operatorAudit, 200);
    const auditText = JSON.stringify(operatorAudit.body.items);
    expect(auditText).not.toContain(operatorId);
    expect(operatorAudit.body.items.some((event: { actorType: string; actorName: string }) => event.actorType === 'PLATFORM_SUPPORT' && event.actorName === 'Soporte de la plataforma')).toBe(true);
    expect(operatorAudit.body.items.some((event: { actorName: string }) => event.actorName === 'Adrián Administra')).toBe(true);
    const sellersReport = await api('get', '/reports/sales-by-seller');
    expect(JSON.stringify(sellersReport.body)).not.toContain(operatorId);
    expect(sellersReport.body.items.some((row: { fullName: string }) => row.fullName === 'Soporte de la plataforma')).toBe(true);

    // ── Régimen de IVA Tierra del Fuego (lo configura la plataforma) y comprobante elegido en caja ──
    const tenantId = claimsOf(adminToken).tenantId as string;
    token = adrianLogin.body.tokens.accessToken as string;
    expectStatus(await api('patch', `/platform/tenants/${tenantId}/vat-regime`, { defaultVatRegime: 'TIERRA_DEL_FUEGO' }), 403);
    token = adminToken;
    const platformTenants = await api('get', '/platform/tenants');
    expectStatus(platformTenants, 200);
    const tdf = await api('patch', `/platform/tenants/${tenantId}/vat-regime`, { defaultVatRegime: 'TIERRA_DEL_FUEGO' });
    expectStatus(tdf, 200);
    expect(tdf.body.branches.every((branch: { effectiveVatRegime: string }) => branch.effectiveVatRegime === 'TIERRA_DEL_FUEGO')).toBe(true);
    const regime = await api('get', `/sales/vat-regime?branchId=${A}`);
    expectStatus(regime, 200);
    expect(regime.body).toMatchObject({ vatRegime: 'TIERRA_DEL_FUEGO', source: 'TENANT', allowedVoucherClasses: ['A', 'B'] });

    // Sin cargar nada a mano: la venta sale sin IVA y con la causa legal de la Ley 19.640.
    const tdfQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }] });
    expectStatus(tdfQuote, 200);
    expect(tdfQuote.body.vatRegime).toBe('TIERRA_DEL_FUEGO');
    expect(tdfQuote.body.taxTotal).toBe('0.00');
    expect(tdfQuote.body.total).toBe('990.00'); // $1100 − 10 % de promoción, sin IVA
    expect(tdfQuote.body.fiscalNotes.vatExemption.reason).toBe('TIERRA_DEL_FUEGO');
    const wrongVoucherQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }], voucherClass: 'A' });
    expect(wrongVoucherQuote.body.requestedVoucherError).toContain('CUIT');
    const tdfSaleBody = { branchId: A, lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 990 }] };
    expectStatus(await api('post', '/sales', { ...tdfSaleBody, voucherClass: 'A' }, true), 400);
    expectStatus(await api('post', '/sales', { ...tdfSaleBody, voucherClass: 'C' }, true), 400);
    const tdfSale = await api('post', '/sales', { ...tdfSaleBody, voucherClass: 'B' }, true);
    expectStatus(tdfSale, 201);
    expect(tdfSale.body).toMatchObject({ voucherClass: 'B', taxTotal: '0.00', exemptTotal: '990.00', vatExemptionReason: 'TIERRA_DEL_FUEGO' });
    // Factura B de Tierra del Fuego: sin apartado de Transparencia Fiscal (Ley 27.743), con la leyenda de la Ley 19.640.
    const tdfDetail = await api('get', `/sales/${tdfSale.body.id}`);
    expect(tdfDetail.body.vatRegime).toBe('TIERRA_DEL_FUEGO');
    expect(tdfDetail.body.fiscalNotes.fiscalTransparency).toBeUndefined();
    expect(tdfDetail.body.fiscalNotes.vatExemption.note).toContain('19.640');
    expect(tdfQuote.body.fiscalNotes.fiscalTransparency).toBeUndefined();
    // "Cobrar con IVA" (envío al continente): lleva IVA y, en Factura B, el apartado de Transparencia Fiscal.
    const withVatQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }], vatRegime: 'GENERAL' });
    expect(withVatQuote.body.fiscalNotes.fiscalTransparency.vatContained).toBe(withVatQuote.body.taxTotal);
    const withVatSale = await api(
      'post',
      '/sales',
      { branchId: A, lines: [{ productId, quantity: 1 }], vatRegime: 'GENERAL', voucherClass: 'B', payments: [{ method: 'DEBIT_CARD', amount: Number(withVatQuote.body.total) }] },
      true,
    );
    expectStatus(withVatSale, 201);
    const withVatDetail = await api('get', `/sales/${withVatSale.body.id}`);
    expect(withVatDetail.body.vatRegime).toBe('GENERAL');
    expect(withVatDetail.body.fiscalNotes.fiscalTransparency).toBeDefined();
    const withCustomerA = await api(
      'post',
      '/sales',
      { branchId: A, customerPersonId: customer.body.id, voucherClass: 'A', lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 990 }] },
      true,
    );
    expectStatus(withCustomerA, 201);
    expect(withCustomerA.body.voucherClass).toBe('A');
    expectStatus(
      await api('post', '/sales', { branchId: A, customerPersonId: customer.body.id, voucherClass: 'B', lines: [{ productId, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 990 }] }, true),
      400,
    ); // a un Responsable Inscripto le corresponde A

    // Compras en Tierra del Fuego: el proveedor factura sin IVA; con alícuota no se acepta.
    const tdfReceiptLine = { productId, quantity: 2, unitCost: 700 };
    expectStatus(
      await api('post', '/purchases/receipts', { branchId: A, supplierPersonId: supplier.body.id, lines: [{ ...tdfReceiptLine, taxRate: 21 }] }, true),
      400,
    );
    const tdfReceipt = await api('post', '/purchases/receipts', { branchId: A, supplierPersonId: supplier.body.id, lines: [{ ...tdfReceiptLine, taxRate: 0 }] }, true);
    expectStatus(tdfReceipt, 201);
    expect(tdfReceipt.body.taxTotal).toBe('0.00');
    expect(tdfReceipt.body.total).toBe('1400.00');
    const tdfOrder = await api('post', '/purchase-orders', { supplierPersonId: supplier.body.id, branchId: A, lines: [{ productId, quantity: 10, unitCost: 700 }] });
    expectStatus(tdfOrder, 201);
    expect(tdfOrder.body.estimatedTotal).toBe('7000.00'); // sin IVA aunque el producto tenga 21 %
    expectStatus(await api('post', '/purchase-orders', { supplierPersonId: supplier.body.id, branchId: A, lines: [{ productId, quantity: 1, unitCost: 700, taxRate: 21 }] }), 400);

    // Una sucursal en el continente: régimen propio General, aunque la empresa sea de Tierra del Fuego.
    const continental = await api('patch', `/platform/tenants/${tenantId}/branches/${A}/vat-regime`, { vatRegime: 'GENERAL' });
    expectStatus(continental, 200);
    const generalQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }] });
    expect(generalQuote.body.vatRegime).toBe('GENERAL');
    expect(generalQuote.body.taxTotal).toBe('207.90');
    expectStatus(await api('patch', `/platform/tenants/${tenantId}/branches/${A}/vat-regime`, { vatRegime: null }), 200);
    const restored = await api('patch', `/platform/tenants/${tenantId}/vat-regime`, { defaultVatRegime: 'GENERAL' });
    expect(restored.body.defaultVatRegime).toBe('GENERAL');
    const regimeAudit = await api('get', '/audit-events?eventType=VAT_REGIME_CHANGED');
    expect(regimeAudit.body.items.length).toBeGreaterThanOrEqual(3);

    // ── Módulos por empresa: solo la plataforma los activa; sin el módulo, la API lo rechaza ──
    const modulesView = await api('get', `/platform/tenants/${tenantId}/modules`);
    expectStatus(modulesView, 200);
    // Único módulo pago: Marketing y fidelización. Mercadería, reportes, sucursales, compras y preventa son del plan base.
    expect(modulesView.body.modules.map((item: { module: string }) => item.module)).toEqual(['MARKETING']);
    expect(modulesView.body.modules[0].active).toBe(true);
    token = adrianLogin.body.tokens.accessToken as string; // administración de la empresa: no puede activarse módulos
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/MARKETING`, { enabled: true }), 403);
    expectStatus(await api('get', `/platform/tenants/${tenantId}/modules`), 403);
    token = adminToken;
    const withPromo = await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }] });
    expect(Number(withPromo.body.discountTotal)).toBeGreaterThan(0);
    const noMarketing = await api('put', `/platform/tenants/${tenantId}/modules/MARKETING`, { enabled: false, notes: 'Baja del módulo' });
    expectStatus(noMarketing, 200);
    expect(noMarketing.body.modules.find((item: { module: string }) => item.module === 'MARKETING')).toMatchObject({ enabled: false, active: false });
    const blocked = await api('get', '/marketing/promotions');
    expectStatus(blocked, 403);
    expect(blocked.body.details).toBe('MODULE_NOT_ENABLED:MARKETING');
    expect(blocked.body.message).toContain('Marketing y fidelización');
    // Sin el módulo, las promociones cargadas no se aplican al vender.
    expect((await api('post', '/sales/quote', { branchId: A, lines: [{ productId, quantity: 1 }] })).body.discountTotal).toBe('0.00');
    const sessionTenants = await api('get', '/auth/tenants');
    expect(sessionTenants.body.find((item: { id: string }) => item.id === tenantId).modules).not.toContain('MARKETING');
    // Vencido ayer: sigue bloqueado; sin vencimiento: vuelve.
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/MARKETING`, { enabled: true, validUntil: yesterday }), 200);
    expectStatus(await api('get', '/marketing/promotions'), 403);
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/MARKETING`, { enabled: true, validUntil: null }), 200);
    expectStatus(await api('get', '/marketing/promotions'), 200);
    // Lo que antes eran módulos ahora es del plan base: siempre disponible.
    expectStatus(await api('get', '/stock-transfers'), 200);
    expectStatus(await api('get', '/reports/dashboard'), 200);
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/REPORTS`, { enabled: false }), 400);
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/NO_EXISTE`, { enabled: true }), 400);
    const moduleAudit = await api('get', '/audit-events?eventType=TENANT_MODULE_DISABLED');
    expect(moduleAudit.body.items.length).toBeGreaterThanOrEqual(1);

    // ── Presupuestos X: 24 h, solo quien lo emitió lo pasa a pedido; nunca se borran (quedan en el historial) ──
    const veraToken = sellerLogin.body.tokens.accessToken as string;
    token = veraToken;
    // El vendedor ve la ficha y los precios por lista, pero no costos, fletes ni márgenes.
    const sellerProduct = await api('get', `/products/${productId}`);
    expectStatus(sellerProduct, 200);
    expect(sellerProduct.body.branchSettings[0]).not.toHaveProperty('costPrice');
    expect(sellerProduct.body.branchSettings[0]).not.toHaveProperty('profitMargin');
    expect(sellerProduct.body.branchSettings[0]).toHaveProperty('sellingPrice');
    const sellerCatalog = await api('get', `/products?branchId=${A}&search=Gaseosa`);
    expect(sellerCatalog.body.items[0].branch).toMatchObject({ costPrice: null, profitMargin: null, freightPercentage: null });
    const sellerListPrices = await api('get', `/products/${productId}/list-prices`);
    expectStatus(sellerListPrices, 200);
    expect(sellerListPrices.body[0].lists.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(sellerListPrices.body)).not.toContain('costPrice');
    // El vendedor ve el stock de todas las sucursales (sin costos).
    const sellerStock = await api('get', `/products/${productId}/stock`);
    expectStatus(sellerStock, 200);
    expect(sellerStock.body.map((row: { branchId: string }) => row.branchId)).toEqual(expect.arrayContaining([A, B]));
    expect(sellerStock.body.find((row: { branchId: string }) => row.branchId === A)).toMatchObject({ enabled: true });
    expect(JSON.stringify(sellerStock.body)).not.toContain('cost');
    expectStatus(await api('post', '/products/price-updates', { percentage: 5, reason: 'No autorizado', dryRun: true }), 403);
    const quoteX = await api('post', '/sales-quotes', { branchId: A, lines: [{ productId, quantity: 2 }], notes: 'Cliente vuelve mañana' }, true);
    expectStatus(quoteX, 201);
    expect(quoteX.body.number).toBe(1);
    expect(quoteX.body.total).toBe('2395.80');
    expect(quoteX.body.sellerName).toBe('Vera Vendedora');
    expect(quoteX.body.status).toBe('ACTIVE');
    expect(quoteX.body.remainingMs).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(new Date(quoteX.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000);
    expect((await api('get', '/sales-quotes')).body.total).toBe(1);
    // created_at lo pone MySQL (CURRENT_TIMESTAMP) y expires_at la API: ambos en UTC aunque el servidor esté en -03:00.
    const storedQuote = await api('get', `/sales-quotes/${quoteX.body.id}`);
    const createdAt = new Date(storedQuote.body.createdAt).getTime();
    expect(Math.abs(createdAt - Date.now())).toBeLessThan(5 * 60 * 1000);
    expect(Math.abs(new Date(storedQuote.body.expiresAt).getTime() - createdAt - 24 * 3600 * 1000)).toBeLessThan(60 * 1000);
    // Se borra a las 24 h, pero el impreso informa al cliente una validez de 72 h.
    expect(storedQuote.body.printedValidityHours).toBe(72);
    expect(storedQuote.body.customer).toBeNull();

    // Otro vendedor no lo ve ni lo puede convertir; el encargado/administración sí lo ve.
    const camilaAgain = await loginAs('camila.caja', 'Propia-Clave-2026');
    expectStatus(camilaAgain, 200);
    token = camilaAgain.body.tokens.accessToken as string;
    expectStatus(await api('get', `/sales-quotes/${quoteX.body.id}`), 404);
    expectStatus(await api('post', `/sales-quotes/${quoteX.body.id}/convert`), 403);
    expect((await api('get', '/sales-quotes')).body.total).toBe(0);
    token = adminToken;
    expectStatus(await api('get', `/sales-quotes/by-number/1`), 200);
    expectStatus(await api('post', `/sales-quotes/${quoteX.body.id}/convert`), 403); // solo quien lo emitió

    // Quien lo emitió lo pasa a pedido: el presupuesto queda CONVERTIDO (no se borra) y el pedido, para cobrar en caja.
    token = veraToken;
    const fromQuote = await api('post', `/sales-quotes/${quoteX.body.id}/convert`);
    expectStatus(fromQuote, 201);
    expect(fromQuote.body.status).toBe('PENDING');
    expect(fromQuote.body.notes).toContain('Presupuesto X N.º 1');
    expect(fromQuote.body.sellerName).toBe('Vera Vendedora');
    const convertedQuote = await api('get', `/sales-quotes/${quoteX.body.id}`);
    expectStatus(convertedQuote, 200);
    expect(convertedQuote.body).toMatchObject({ status: 'CONVERTED', convertedOrderId: fromQuote.body.id, remainingMs: 0 });
    expectStatus(await api('post', `/sales-quotes/${quoteX.body.id}/convert`), 409);
    expect((await api('get', '/sales-quotes')).body.total).toBe(0);
    expect((await api('get', '/sales-quotes?status=CONVERTED')).body.total).toBe(1);

    // Vencido: no se puede usar, pero queda en el historial como VENCIDO.
    const stale = await api('post', '/sales-quotes', { branchId: A, lines: [{ productId, quantity: 1 }] }, true);
    expectStatus(stale, 201);
    const dataSource = app.get(DataSource);
    await dataSource.query('UPDATE sales_quotes SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 60_000), stale.body.id]);
    expectStatus(await api('post', `/sales-quotes/${stale.body.id}/convert`), 409);
    const remaining = (await dataSource.query('SELECT status FROM sales_quotes WHERE id = ?', [stale.body.id])) as Array<{ status: string }>;
    expect(remaining[0].status).toBe('EXPIRED');
    expect((await api('get', `/sales-quotes/${stale.body.id}`)).body.status).toBe('EXPIRED');
    const discard = await api('post', '/sales-quotes', { branchId: A, customerPersonId: customer.body.id, lines: [{ productId, quantity: 1 }] }, true);
    expectStatus(discard, 201);
    const discardDetail = await api('get', `/sales-quotes/${discard.body.id}`);
    expect(discardDetail.body.customer).toMatchObject({ name: 'Inscripto Cliente', accountNumber: customerAccount, city: 'Río Grande' });
    expectStatus(await api('delete', `/sales-quotes/${discard.body.id}`), 200);
    expect((await api('get', `/sales-quotes/${discard.body.id}`)).body.status).toBe('DISCARDED');
    expectStatus(await api('delete', `/sales-quotes/${discard.body.id}`), 409);
    const quoteHistory = await api('get', '/sales-quotes?status=ALL');
    expect(quoteHistory.body.total).toBe(3); // convertido, vencido y descartado: ninguno se borró
    token = adminToken;

    // ── Cobro: descuento de efectivo automático y planes de tarjeta ──
    const weekdayAr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short' }).format(new Date()),
    );
    const otherDay = (weekdayAr + 1) % 7;
    const tdfToday = await api('post', '/card-plans', {
      name: 'Visa Banco de Tierra del Fuego', cardBrand: 'VISA', bankName: 'Banco de Tierra del Fuego',
      paymentMethod: 'CREDIT_CARD', installments: 12, surchargePercentage: 0, weekdays: [weekdayAr],
    });
    expectStatus(tdfToday, 201);
    expect(tdfToday.body).toMatchObject({ label: 'Visa Banco de Tierra del Fuego · 12 cuotas sin interés', availableToday: true, weekdays: [weekdayAr] });
    const tdfOtherDay = await api('post', '/card-plans', { name: 'Visa TDF otro día', cardBrand: 'VISA', installments: 18, surchargePercentage: 0, weekdays: [otherDay] });
    expect(tdfOtherDay.body.availableToday).toBe(false);
    const master6 = await api('post', '/card-plans', { name: 'Mastercard', cardBrand: 'MASTERCARD', installments: 6, surchargePercentage: 15 });
    expectStatus(master6, 201);
    expectStatus(await api('post', '/card-plans', { name: 'Inválido', installments: 0, surchargePercentage: 0 }), 400);
    const availablePlans = (await api('get', '/card-plans/available')).body as Array<{ id: string }>;
    expect(availablePlans.map((plan) => plan.id)).toEqual(expect.arrayContaining([tdfToday.body.id, master6.body.id]));
    expect(availablePlans.map((plan) => plan.id)).not.toContain(tdfOtherDay.body.id);
    // El vendedor ve los planes vigentes pero no los administra.
    token = veraToken;
    expectStatus(await api('get', '/card-plans/available'), 200);
    expectStatus(await api('post', '/card-plans', { name: 'No autorizado', installments: 3, surchargePercentage: 0 }), 403);
    token = adminToken;

    const tile = await api('post', '/products', {
      sku: 'CER-001', name: 'Cerámica 30x30', category: 'Revestimientos', taxRate: 21, priceIncludesVat: true,
      branchSettings: [{ branchId: A, costPrice: 500, profitMargin: 100, sellingPrice: 1000, stock: 50, minStock: 1 }],
    });
    expectStatus(tile, 201);
    const tileId = tile.body.id as string;
    const payRegister = await api('post', '/cash/registers', { branchId: A, code: 'CAJA-TARJ', name: 'Caja tarjetas' });
    expectStatus(payRegister, 201);
    const paySession = await api('post', `/cash/registers/${payRegister.body.id}/sessions`, { currency: 'ARS', openingAmount: '100.00' }, true);
    expectStatus(paySession, 201);
    const paySessionId = paySession.body.id as string;

    // La cotización informa cuánto sale todo en efectivo (lista «Ventas en efectivo» −5 %).
    const tileQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId: tileId, quantity: 2 }] });
    expectStatus(tileQuote, 200);
    expect(tileQuote.body.total).toBe('2000.00');
    expect(tileQuote.body.cashDiscount).toMatchObject({ name: 'Ventas en efectivo', percentage: '-5.00', total: '1900.00' });
    // Con una lista elegida a propósito (gobierno) no se suma el descuento de efectivo.
    const govTile = await api('post', '/sales/quote', { branchId: A, lines: [{ productId: tileId, quantity: 1 }], priceListId: govList.body.id });
    expect(govTile.body.cashDiscount).toBeNull();

    // Todo en efectivo: se cobra $1900.
    const allCash = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 2 }], cashDiscount: true,
      payments: [{ method: 'CASH', amount: 1900, cashSessionId: paySessionId }],
    }, true);
    expectStatus(allCash, 201);
    expect(allCash.body).toMatchObject({ total: '1900.00', paymentAdjustmentTotal: '-100.00' });
    expect(allCash.body.payments[0]).toMatchObject({ amount: '1900.00', adjustmentAmount: '-100.00', adjustmentLabel: 'Ventas en efectivo (−5 %)' });
    expect(allCash.body.items[0]).toMatchObject({ total: '1900.00', paymentAdjustment: '-100.00', unitPrice: '1000.00' });
    // Con descuento de efectivo, cobrar el precio de lista no cuadra: se rechaza.
    expectStatus(await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 2 }], cashDiscount: true,
      payments: [{ method: 'CASH', amount: 2000, cashSessionId: paySessionId }],
    }, true), 400);

    // Mitad en efectivo (cubre $1000 de lista → $950) y mitad con Visa TDF 12 cuotas sin interés ($1000).
    const mixed = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 2 }], cashDiscount: true, cashSessionId: paySessionId,
      payments: [
        { method: 'CASH', amount: 950, cashSessionId: paySessionId },
        { method: 'CREDIT_CARD', amount: 1000, cardPlanId: tdfToday.body.id },
      ],
    }, true);
    expectStatus(mixed, 201);
    expect(mixed.body).toMatchObject({ total: '1950.00', paymentAdjustmentTotal: '-50.00' });
    const mixedCard = (mixed.body.payments as Array<Record<string, unknown>>).find((payment) => payment.method === 'CREDIT_CARD');
    expect(mixedCard).toMatchObject({ cardPlanId: tdfToday.body.id, installments: 12, adjustmentAmount: '0.00', adjustmentLabel: 'Visa Banco de Tierra del Fuego · 12 cuotas sin interés' });

    // Mastercard 6 cuotas con 15 % de recargo: $1000 → $1150 (IVA recalculado sobre el total; venta con IVA).
    const surcharged = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }], cashSessionId: paySessionId, vatRegime: 'GENERAL', voucherClass: 'B',
      payments: [{ method: 'CREDIT_CARD', amount: 1150, cardPlanId: master6.body.id }],
    }, true);
    expectStatus(surcharged, 201);
    expect(surcharged.body).toMatchObject({ total: '1150.00', paymentAdjustmentTotal: '150.00', taxTotal: '199.59' });
    expect(surcharged.body.items[0]).toMatchObject({ total: '1150.00', netAmount: '950.41', taxAmount: '199.59', paymentAdjustment: '150.00' });

    // Reglas: plan de otro día, plan con medio equivocado, plan en efectivo.
    const wrongDay = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }],
      payments: [{ method: 'CREDIT_CARD', amount: 1000, cardPlanId: tdfOtherDay.body.id }],
    }, true);
    expectStatus(wrongDay, 400);
    expect(wrongDay.body.message).toContain('no está vigente hoy');
    expectStatus(await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }],
      payments: [{ method: 'DEBIT_CARD', amount: 1000, cardPlanId: tdfToday.body.id }],
    }, true), 400);
    expectStatus(await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1000, cashSessionId: paySessionId, cardPlanId: tdfToday.body.id }],
    }, true), 400);

    // La lista de pago contado no puede ser la principal.
    expectStatus(await api('patch', `/price-lists/${cashList.body.id}`, { isDefault: true }), 400);
    expectStatus(await api('patch', `/price-lists/${cashList.body.id}`, { discountMethods: ['CREDIT_CARD'] }), 400);
    // La administración habilita el descuento de contado también con QR: QR recibe el −5 %, crédito no.
    const withQr = await api('patch', `/price-lists/${cashList.body.id}`, { discountMethods: ['QR'] });
    expectStatus(withQr, 200);
    expect(withQr.body.discountMethods).toEqual(['QR']);
    const qrQuote = await api('post', '/sales/quote', { branchId: A, lines: [{ productId: tileId, quantity: 2 }] });
    expect(qrQuote.body.cashDiscount.methods).toEqual(['CASH', 'QR']);
    const qrSale = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 2 }], cashDiscount: true, cashSessionId: paySessionId,
      payments: [{ method: 'QR', amount: 1900 }],
    }, true);
    expectStatus(qrSale, 201);
    expect(qrSale.body).toMatchObject({ total: '1900.00', paymentAdjustmentTotal: '-100.00' });
    expect(qrSale.body.payments[0]).toMatchObject({ method: 'QR', adjustmentAmount: '-100.00' });
    expectStatus(await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 2 }], cashDiscount: true,
      payments: [{ method: 'CREDIT_CARD', amount: 1900 }],
    }, true), 400);

    // ── Notas de crédito y débito por importe (sin devolver mercadería) ──
    const noInvoiceNote = await api('post', `/sales/${surcharged.body.id}/adjustments`, { kind: 'DEBIT', concept: 'Intereses', reason: 'Pago fuera de término', amount: 100, settlement: 'NONE' }, true);
    expectStatus(noInvoiceNote, 400); // primero la factura
    expect(noInvoiceNote.body.message).toContain('factura');
    const surchargedInvoice = await api('post', `/fiscal/sales/${surcharged.body.id}/invoice`);
    expectStatus(surchargedInvoice, 200);
    expect(surchargedInvoice.body).toMatchObject({ status: 'AUTHORIZED', voucherType: 6 });
    // Nota de débito B: $121 con IVA 21 % (neto $100 + IVA $21), queda pendiente de cobro.
    const debit = await api('post', `/sales/${surcharged.body.id}/adjustments`, {
      kind: 'DEBIT', concept: 'Cheque rechazado N.º 00112233', reason: 'Sin fondos', amount: 121, taxRate: 21, settlement: 'NONE',
    }, true);
    expectStatus(debit, 201);
    expect(debit.body).toMatchObject({ kind: 'DEBIT', total: '121.00', netAmount: '100.00', taxAmount: '21.00', taxRate: '21.00', fiscalStatus: 'NOT_ISSUED' });
    const debitNote = await api('post', `/fiscal/adjustments/${debit.body.id}/note`);
    expectStatus(debitNote, 200);
    expect(debitNote.body).toMatchObject({ status: 'AUTHORIZED', voucherType: 7, total: '121.00' });
    const debitRequest = arca.requests[arca.requests.length - 1];
    expect(debitRequest.associated).toMatchObject({ voucherType: 6, number: surchargedInvoice.body.number });
    expect(debitRequest.vatRates).toEqual([{ arcaId: 5, base: '100.00', amount: '21.00' }]);
    expect((await api('post', `/fiscal/adjustments/${debit.body.id}/note`)).body.id).toBe(debitNote.body.id); // idempotente
    // Nota de crédito B por bonificación: tope = factura + débitos − créditos.
    expectStatus(await api('post', `/sales/${surcharged.body.id}/adjustments`, { kind: 'CREDIT', concept: 'Bonificación', reason: 'Excede', amount: 1272, settlement: 'NONE' }, true), 400);
    const credit = await api('post', `/sales/${surcharged.body.id}/adjustments`, {
      kind: 'CREDIT', concept: 'Bonificación comercial', reason: 'Cliente frecuente', amount: 242, settlement: 'OTHER', externalReference: 'Transferencia 991',
    }, true);
    expectStatus(credit, 201);
    expect(credit.body).toMatchObject({ kind: 'CREDIT', netAmount: '200.00', taxAmount: '42.00', settlement: 'OTHER' });
    const creditNoteB = await api('post', `/fiscal/adjustments/${credit.body.id}/note`);
    expect(creditNoteB.body).toMatchObject({ status: 'AUTHORIZED', voucherType: 8 });
    const adjustments = await api('get', `/sales/${surcharged.body.id}/adjustments`);
    expect(adjustments.body.map((item: { fiscalDocumentId: string | null }) => Boolean(item.fiscalDocumentId))).toEqual([true, true]);
    const printableDebit = await api('get', `/fiscal/documents/${debitNote.body.id}`);
    expect(printableDebit.body.items[0]).toMatchObject({ nameSnapshot: 'Cheque rechazado N.º 00112233', total: '121.00' });
    expect(printableDebit.body.adjustment).toMatchObject({ kind: 'DEBIT', settlement: 'NONE' });
    expect(printableDebit.body.associated).toMatchObject({ voucherType: 6 });

    // ── Cheque como medio de pago y cartera ──
    expectStatus(await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }], cashSessionId: paySessionId,
      payments: [{ method: 'CHECK', amount: 1000 }],
    }, true), 400); // faltan los datos del cheque
    const checkSale = await api('post', '/sales', {
      branchId: A, lines: [{ productId: tileId, quantity: 1 }], cashSessionId: paySessionId,
      payments: [{ method: 'CHECK', amount: 1000, check: { bank: 'Banco de Tierra del Fuego', number: '00112233', payDate: '2026-12-15', drawerName: 'Ferretería Sur SRL', drawerTaxId: '30712345671' } }],
    }, true);
    expectStatus(checkSale, 201);
    expect(checkSale.body.payments[0]).toMatchObject({ method: 'CHECK', check: { bank: 'Banco de Tierra del Fuego', number: '00112233', payDate: '2026-12-15', status: 'IN_PORTFOLIO' } });
    const portfolio = await api('get', '/checks?status=IN_PORTFOLIO');
    expectStatus(portfolio, 200);
    expect(portfolio.body.total).toBe(1);
    expect(portfolio.body.totals.IN_PORTFOLIO).toBe('1000.00');
    const checkId = portfolio.body.items[0].id as string;
    expectStatus(await api('patch', `/checks/${checkId}/status`, { status: 'REJECTED' }), 400); // falta el motivo
    expectStatus(await api('patch', `/checks/${checkId}/status`, { status: 'DEPOSITED' }), 200);
    const rejected = await api('patch', `/checks/${checkId}/status`, { status: 'REJECTED', note: 'Sin fondos' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', statusNote: 'Sin fondos' });
    expectStatus(await api('patch', `/checks/${checkId}/status`, { status: 'CASHED' }), 400); // un rechazado no se acredita
    expect((await api('get', '/checks?search=Ferreter')).body.items[0].customerName).toBeNull();

    // Baja lógica: deja de ofrecerse.
    expectStatus(await api('delete', `/card-plans/${tdfOtherDay.body.id}`), 200);
    expect(((await api('get', '/card-plans?includeInactive=true')).body as Array<{ id: string }>).map((plan) => plan.id)).not.toContain(tdfOtherDay.body.id);
  });
});
