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

for (const username of ['demo.cajero', 'demo.encargado', 'demo.vendedor', 'demo.deposito', 'demo.contador']) {
  const r = await call('POST', '/auth/login', null, { username, password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
  const tok = r.json.tokens?.accessToken;
  const br = tok ? await call('GET', '/branches', tok) : { status: 0, json: [] };
  log(r.status === 200, `login ${username} ${r.status} sucursal=${r.json.user?.branchId ?? '-'} branches=${br.status}/${Array.isArray(br.json) ? br.json.length : '-'}`);
}

console.log(out.join('\n'));
for (const line of out) console.log(`::${line.startsWith('OK') ? 'notice' : 'error'}::${line.replace(/%/g, '%25')}`);
process.exit(failed ? 1 : 0);
