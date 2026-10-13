// Verifica que los datos demo funcionen con la API real (solo CI de la rama temporal).
const API = 'http://localhost:3000/api/v1';
const out = [];
let failed = false;
const log = (ok, text) => { out.push(`${ok ? 'OK ' : 'ERR'} ${text}`); if (!ok) failed = true; };

async function call(method, path, token, body, extra = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const login = await call('POST', '/auth/login', null, { username: 'admin', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
log(login.status === 200, `login admin ${login.status}`);
const token = login.json.tokens?.accessToken;
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
log(claims.tenantId === '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f', `empresa por defecto = demo (${claims.tenantId}) rol ${claims.tenantRole}`);
const tenants = await call('GET', '/auth/tenants', token);
log(tenants.status === 200, `tenants ${JSON.stringify(tenants.json).slice(0, 200)}`);

const branches = await call('GET', '/branches', token);
log(branches.status === 200 && branches.json.length === 5, `branches ${branches.json.length}`);
const central = branches.json.find((b) => b.code === 'CENTRAL');

const dash = await call('GET', '/reports/dashboard', token);
log(dash.status === 200 && dash.json.totals?.tickets > 500, `dashboard ${dash.status} ${JSON.stringify(dash.json.totals)} hoy=${JSON.stringify(dash.json.today)} ops=${JSON.stringify(dash.json.operations)}`);
log(dash.json.growth?.netSales !== null, `growth ${JSON.stringify(dash.json.growth)}`);

for (const path of ['/reports/sales-by-day', '/reports/sales-by-hour', '/reports/top-products', '/reports/sales-by-category', '/reports/sales-by-payment-method', '/reports/sales-by-seller', '/reports/stock-valuation', '/reports/dead-stock?days=60',
  '/inventory/stock-matrix', '/inventory/low-stock', '/inventory/replenishment', '/stock-transfers', '/purchase-orders', '/purchases/receipts', '/supplier-payables', '/marketing/promotions',
  '/marketing/customers/top', '/marketing/customers/inactive?days=60', '/marketing/customers/summary', '/persons?role=customers', '/fiscal/profile', '/fiscal/points-of-sale', '/sales?limit=5', `/products?branchId=${central.id}&limit=5`, '/products/facets', `/cash/registers?branchId=${central.id}`, '/audit-events']) {
  const r = await call('GET', path, token);
  const summary = Array.isArray(r.json) ? `len=${r.json.length}` : r.json && typeof r.json === 'object' ? (r.json.items ? `items=${r.json.items.length} total=${r.json.total ?? '-'}` : Object.keys(r.json).slice(0, 6).join(',')) : String(r.json).slice(0, 80);
  log(r.status === 200, `GET ${path} ${r.status} ${summary}`);
}

const dead = await call('GET', '/reports/dead-stock?days=60', token);
log(dead.json.total > 0, `dead-stock total ${dead.json.total}`);
const inactive = await call('GET', '/marketing/customers/inactive?days=60', token);
log(inactive.json.total > 0, `inactivos ${inactive.json.total}`);
const low = await call('GET', '/inventory/low-stock', token);
log(low.json.total > 0, `bajo mínimo ${low.json.total}`);

// Una venta real en efectivo sobre la caja abierta de la demo: valida stock, caja y numeración.
const registers = await call('GET', `/cash/registers?branchId=${central.id}`, token);
const open = registers.json.find((r) => r.openSession);
log(Boolean(open), `caja abierta ${open?.name} esperado ${open?.openSession?.expectedAmount}`);
const products = await call('GET', `/products?branchId=${central.id}&search=Yerba&limit=3`, token);
const yerba = products.json.items[0];
const quote = await call('POST', '/sales/quote', token, { branchId: central.id, lines: [{ productId: yerba.id, quantity: 3 }] });
log(quote.status === 200, `quote ${quote.status} total=${quote.json.total} desc=${quote.json.discountTotal} clase=${quote.json.voucherClass}`);
const sale = await call('POST', '/sales', token, { branchId: central.id, lines: [{ productId: yerba.id, quantity: 3 }], payments: [{ method: 'CASH', amount: Number(quote.json.total), cashSessionId: open.openSession.id }] }, { 'Idempotency-Key': crypto.randomUUID() });
log(sale.status === 201 || sale.status === 200, `venta ${sale.status} ${JSON.stringify(sale.json).slice(0, 200)}`);
const transfer = await call('GET', '/stock-transfers?status=SENT', token);
const t = transfer.json.items?.[0];
if (t) {
  const rec = await call('POST', `/stock-transfers/${t.id}/receive`, token, {});
  log(rec.status === 200 || rec.status === 201, `recibir transferencia #${t.number} ${rec.status} ${rec.json.status ?? JSON.stringify(rec.json).slice(0, 150)}`);
}
const po = await call('POST', '/purchase-orders', token, { supplierPersonId: (await call('GET', '/persons?role=suppliers&limit=1', token)).json.items[0].id, branchId: central.id, lines: [{ productId: yerba.id, quantity: 10 }] });
log(po.status === 201 || po.status === 200, `nuevo pedido nro ${po.json.number} (${po.status})`);

// Preventa: cola de la demo, pedido de la vendedora y cobro en caja con salesOrderId.
const queue = await call('GET', '/sales-orders?status=PENDING', token);
log(queue.status === 200 && queue.json.total >= 4, `pedidos esperando cobro ${queue.json.total} primero=#${queue.json.items?.[0]?.number} ${queue.json.items?.[0]?.sellerName}`);
log(dash.json.operations?.salesOrdersPending >= 4, `tablero pedidos pendientes ${dash.json.operations?.salesOrdersPending}`);
const charged = await call('GET', '/sales-orders?status=CHARGED&limit=1', token);
log(charged.json.total > 50 && Boolean(charged.json.items?.[0]?.saleId), `pedidos cobrados históricos ${charged.json.total}`);
const sellerLogin = await call('POST', '/auth/login', null, { username: 'demo.vendedora', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
const sellerToken = sellerLogin.json.tokens?.accessToken;
const sellerBranch = sellerLogin.json.user?.branchId ?? central.id;
const forbidden = await call('POST', '/sales', sellerToken, { branchId: sellerBranch, lines: [{ productId: yerba.id, quantity: 1 }], payments: [{ method: 'DEBIT_CARD', amount: 1 }] }, { 'Idempotency-Key': crypto.randomUUID() });
log(forbidden.status === 403, `vendedora no cobra (POST /sales) ${forbidden.status}`);
const order = await call('POST', '/sales-orders', sellerToken, { branchId: sellerBranch, lines: [{ productId: yerba.id, quantity: 2 }], notes: 'Prueba de humo' }, { 'Idempotency-Key': crypto.randomUUID() });
log(order.status === 201, `pedido nuevo #${order.json.number} ${order.status} total=${order.json.estimatedTotal} vendedor=${order.json.sellerName}`);
const byNumber = await call('GET', `/sales-orders/by-number/${order.json.number}`, token);
const chargeQuote = await call('POST', '/sales/quote', token, { branchId: sellerBranch, lines: [{ productId: yerba.id, quantity: 2 }] });
const chargeSale = await call('POST', '/sales', token, { branchId: sellerBranch, salesOrderId: byNumber.json.id, lines: [{ productId: yerba.id, quantity: 2 }], payments: [{ method: 'DEBIT_CARD', amount: Number(chargeQuote.json.total) }] }, { 'Idempotency-Key': crypto.randomUUID() });
log(chargeSale.status === 201 && chargeSale.json.sellerUserId === sellerLogin.json.user?.id, `cobro del pedido ${chargeSale.status} vendedor=${chargeSale.json.sellerUserId}`);
const afterCharge = await call('GET', `/sales-orders/${byNumber.json.id}`, token);
log(afterCharge.json.status === 'CHARGED', `pedido queda ${afterCharge.json.status}`);
const sellers = await call('GET', '/reports/sales-by-seller', token);
log(sellers.json.items?.some((row) => row.username === 'demo.vendedora'), `ranking incluye a la vendedora ${JSON.stringify(sellers.json.items?.map((row) => `${row.username}:${row.tickets}`))}`);

// Empleados y roles múltiples.
const employees = await call('GET', '/employees?status=ALL&limit=50', token);
log(employees.status === 200 && employees.json.total >= 7, `empleados ${employees.json.total} ${JSON.stringify(employees.json.items?.map((row) => `${row.username}:${row.roles.join('+')}`))}`);
const cashierLogin = await call('POST', '/auth/login', null, { username: 'demo.cajero', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
const cashierClaims = JSON.parse(Buffer.from(cashierLogin.json.tokens.accessToken.split('.')[1], 'base64url').toString());
log(JSON.stringify(cashierClaims.tenantRoles) === JSON.stringify(['CASHIER', 'INVENTORY']), `demo.cajero roles ${JSON.stringify(cashierClaims.tenantRoles)}`);
const cashierTransfers = await call('GET', '/stock-transfers', cashierLogin.json.tokens.accessToken);
log(cashierTransfers.status === 200, `cajero+depósito ve transferencias ${cashierTransfers.status}`);

// El titular de la empresa no ve al operador de la plataforma (admin) entre sus empleados ni en la auditoría.
const ownerLogin = await call('POST', '/auth/login', null, { username: 'demo.titular', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
const ownerToken = ownerLogin.json.tokens?.accessToken;
const ownerEmployees = await call('GET', '/employees?status=ALL&limit=100', ownerToken);
log(ownerEmployees.status === 200 && !ownerEmployees.json.items.some((row) => row.username === 'admin'), `titular no ve al operador: ${ownerEmployees.json.items?.map((row) => row.username).join(',')}`);
const ownerAudit = await call('GET', '/audit-events?limit=100', ownerToken);
log(ownerAudit.status === 200 && !JSON.stringify(ownerAudit.json).includes(claims.sub), `auditoría sin el id del operador (${ownerAudit.json.items?.filter((e) => e.actorType === 'PLATFORM_SUPPORT').length} acciones de soporte)`);

for (const username of ['demo.titular', 'demo.cajero', 'demo.encargado', 'demo.vendedor', 'demo.vendedora', 'demo.deposito', 'demo.contador']) {
  const r = await call('POST', '/auth/login', null, { username, password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
  const tok = r.json.tokens?.accessToken;
  const br = tok ? await call('GET', '/branches', tok) : { status: 0, json: [] };
  log(r.status === 200, `login ${username} ${r.status} sucursal=${r.json.user?.branchId ?? '-'} branches=${br.status}/${Array.isArray(br.json) ? br.json.length : '-'}`);
}

console.log(out.join('\n'));
for (const line of out) console.log(`::${line.startsWith('OK') ? 'notice' : 'error'}::${line.replace(/%/g, '%25')}`);
process.exit(failed ? 1 : 0);
