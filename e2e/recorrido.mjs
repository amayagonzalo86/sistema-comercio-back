// Recorrido E2E real: front (main) + API + MySQL con base-completa.sql.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const OUT = 'e2e-out';
mkdirSync(OUT, { recursive: true });
const report = [];
let current = 'inicio';
const failures = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
const page = await context.newPage();
page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('/api/v1/')) return;
  const status = res.status();
  if (status >= 400 && !(status === 401 && url.includes('/auth/refresh'))) {
    let body = '';
    try { body = (await res.text()).slice(0, 220); } catch { body = ''; }
    failures.push(`[${current}] ${res.request().method()} ${url.replace(BASE, '')} → ${status} ${body}`);
  }
});
const inflight = new Map();
page.on('request', (req) => inflight.set(req, `${req.method()} ${req.url().replace(BASE, '')}`));
page.on('requestfinished', (req) => inflight.delete(req));
page.on('requestfailed', (req) => inflight.delete(req));
const reportInflight = async (label) => {
  await page.waitForTimeout(3000);
  const pending = [...inflight.values()];
  report.push(`   en vuelo tras ${label}: ${pending.length ? pending.join(' | ').slice(0, 400) : 'ninguna'}`);
};
page.on('pageerror', (error) => failures.push(`[${current}] JS: ${error.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) failures.push(`[${current}] console: ${m.text().slice(0, 200)}`); });

const step = async (name, fn) => {
  current = name;
  const before = failures.length;
  try {
    await fn();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    report.push(`${failures.length === before ? 'OK ' : 'ERR'} ${name}`);
  } catch (error) {
    failures.push(`[${name}] EXCEPCIÓN: ${error.message.split('\n')[0]}`);
    report.push(`ERR ${name}`);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => undefined);
  }
};

await step('01-login', async () => {
  await page.goto(`${BASE}/login`);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'Admin-Comercio-2026!');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tenant-option, .app-shell', { timeout: 20000 });
  if (await page.locator('.tenant-option').count()) {
    await page.locator('.tenant-option', { hasText: 'Almacenes del Centro' }).click();
  }
  await page.waitForURL('**/tablero', { timeout: 20000 });
});

const pages = [
  ['02-tablero', '/tablero'], ['03-reportes', '/reportes'], ['04-ventas', '/ventas'], ['05-caja-todas', '/caja'],
  ['06-comprobantes', '/comprobantes'], ['07-catalogo', '/catalogo'], ['08-aumentos', '/catalogo/aumentos'], ['09-stock', '/stock'],
  ['10-transferencias', '/stock/transferencias'], ['11-reposicion', '/stock/reposicion'], ['12-pedidos', '/compras/pedidos'],
  ['13-recepciones', '/compras/recepciones'], ['14-cuentas', '/compras/cuentas'], ['15-contactos', '/contactos'], ['16-promociones', '/marketing'],
  ['17-fidelizacion', '/marketing/clientes'], ['18-fiscal', '/configuracion/fiscal'], ['19-sucursales', '/configuracion/sucursales'], ['20-auditoria', '/configuracion/auditoria'],
];
for (const [name, path] of pages) {
  await step(name, async () => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); });
}

// Sucursal Casa Central para operar.
await step('21-elegir-sucursal', async () => {
  await page.goto(`${BASE}/tablero`);
  const select = page.locator('.branch-pill select');
  const value = await select.locator('option', { hasText: 'Casa Central' }).getAttribute('value');
  await select.selectOption(value);
});
await step('22-caja-central', async () => { await page.goto(`${BASE}/caja`); await page.waitForLoadState('networkidle'); });
await step('23-catalogo-central', async () => { await page.goto(`${BASE}/catalogo`); await page.waitForLoadState('networkidle'); await page.locator('table tbody tr.clickable').first().click(); await page.waitForURL('**/catalogo/*'); await page.waitForLoadState('networkidle'); });

await step('24-pos-venta', async () => {
  await page.goto(`${BASE}/ventas/pos`);
  const search = page.locator('.pos-search input');
  await search.fill('Yerba');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await search.fill('Leche');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Cobrar/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Confirmar/ }).click();
  await page.waitForSelector('text=Venta registrada', { timeout: 20000 });
});
await step('25-ventas-detalle', async () => { await page.goto(`${BASE}/ventas`); await page.waitForLoadState('networkidle'); await page.locator('table tbody tr.clickable').first().click(); await page.waitForURL('**/ventas/*'); await page.waitForLoadState('networkidle'); });
await step('26-pedido-detalle', async () => { await page.goto(`${BASE}/compras/pedidos`); await page.waitForLoadState('networkidle'); await page.locator('table tbody tr.clickable').first().click(); await page.waitForURL('**/compras/pedidos/*'); await page.waitForLoadState('networkidle'); });
await step('27-recarga-sesion', async () => { await page.reload(); await page.waitForSelector('.app-shell', { timeout: 20000 }); });

for (const user of ['demo.cajero', 'demo.deposito', 'demo.contador']) {
  await step(`28-login-${user}`, async () => {
    await context.clearCookies();
    await page.goto(`${BASE}/login`);
    await page.waitForSelector('#username', { timeout: 20000 });
    await page.fill('#username', user);
    await page.fill('#password', 'Admin-Comercio-2026!');
    await page.click('button[type=submit]');
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    await reportInflight(`login ${user}`);
  });
}


// ── Preventa: la vendedora arma el pedido y el cajero lo cobra ──
const loginAs = async (user, password = 'Admin-Comercio-2026!') => {
  await context.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', user);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.app-shell, .tenant-option', { timeout: 20000 });
  if (await page.locator('.tenant-option').count()) await page.locator('.tenant-option', { hasText: 'Almacenes del Centro' }).click();
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await reportInflight(`login ${user}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
};
let orderNumber = null;
await step('30-vendedora-pos', async () => {
  await loginAs('demo.vendedora');
  await page.goto(`${BASE}/ventas/pos`);
  await page.waitForSelector('text=Nuevo pedido', { timeout: 15000 });
  const search = page.locator('.pos-search input');
  await search.fill('Yerba');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await search.fill('Fideos');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await page.waitForTimeout(1500);
  if (await page.getByRole('button', { name: /^Cobrar/ }).count()) throw new Error('La vendedora ve el botón Cobrar');
});
await step('31-vendedora-genera-pedido', async () => {
  await page.locator('aside').getByRole('button', { name: /Generar pedido/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.locator('.erp-modal input').fill('Retira en mostrador');
  await page.locator('.erp-modal').getByRole('button', { name: /Generar pedido/ }).click();
  await page.waitForSelector('text=Pedido generado', { timeout: 20000 });
  const text = await page.locator('.order-ticket').first().innerText();
  const match = text.match(/N\.º\s*(\d+)/);
  if (!match) throw new Error(`Sin número de pedido en el ticket: ${text.slice(0, 120)}`);
  orderNumber = Number(match[1]);
  report.push(`   pedido generado N.º ${orderNumber}`);
});
await step('32-vendedora-pedido-imprimible', async () => {
  await page.getByRole('link', { name: /Ver e imprimir/ }).click();
  await page.waitForURL('**/ventas/pedidos/*', { timeout: 15000 });
  await page.waitForSelector('.order-ticket', { timeout: 15000 });
});
await step('33-vendedora-cola', async () => { await page.goto(`${BASE}/ventas/pedidos`); await page.waitForLoadState('networkidle'); });
await step('34-cajero-cola', async () => {
  await loginAs('demo.cajero');
  await page.goto(`${BASE}/ventas/pedidos`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector(`tr:has-text("#${orderNumber}")`, { timeout: 15000 });
});
await step('35-cajero-carga-pedido', async () => {
  await page.locator(`tr:has-text("#${orderNumber}")`).getByRole('button', { name: /Cobrar/ }).click();
  await page.waitForURL('**/ventas/pos**', { timeout: 15000 });
  await page.waitForSelector(`text=Pedido N.º ${orderNumber}`, { timeout: 20000 });
  await page.waitForTimeout(1500);
});
await step('36-cajero-cobra-pedido', async () => {
  await page.getByRole('button', { name: new RegExp(`Cobrar pedido N\\.º ${orderNumber}`) }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Confirmar/ }).click();
  await page.waitForSelector('text=Venta registrada', { timeout: 20000 });
});
await step('37-cajero-venta-preventa', async () => {
  await page.getByRole('link', { name: /Ver venta/ }).click();
  await page.waitForURL('**/ventas/*', { timeout: 15000 });
  await page.waitForSelector(`text=N.º ${orderNumber}`, { timeout: 15000 });
});
await step('38-cajero-cobrados', async () => {
  await page.goto(`${BASE}/ventas/pedidos`);
  await page.getByRole('button', { name: 'Cobrados' }).click();
  await page.waitForSelector(`tr:has-text("#${orderNumber}")`, { timeout: 15000 });
});
await step('39-cajero-cargar-por-numero', async () => {
  await page.goto(`${BASE}/ventas/pos`);
  await page.getByRole('button', { name: /Cargar pedido/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.locator('.erp-modal input').fill(String(orderNumber));
  await page.locator('.erp-modal').getByRole('button', { name: /^Cargar$/ }).click();
  await page.waitForSelector('text=ya fue cobrado', { timeout: 10000 });
});
await step('40-tablero-admin-pedidos', async () => {
  await loginAs('admin');
  await page.goto(`${BASE}/tablero`);
  await page.waitForSelector('text=Pedidos esperando cobro', { timeout: 20000 });
});


// ── Empleados: alta con varios roles, edición, contraseña y cambio propio ──
const NEW_PASSWORD = 'Lucia-Admin-2026';
const OWN_PASSWORD = 'Lucia-Propia-2026';
const modal = () => page.locator('.erp-modal');
await step('50-empleados-listado', async () => {
  await page.goto(`${BASE}/configuracion/empleados`);
  await page.waitForSelector('table tbody tr td .cell-title', { timeout: 20000 });
});
await step('51-empleado-alta', async () => {
  await page.getByRole('button', { name: /Nuevo empleado/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  const inputs = modal().locator('input:not([type=checkbox])');
  await inputs.nth(0).fill('Lucía');
  await inputs.nth(1).fill('Prueba');
  await inputs.nth(2).fill('30555666');
  await inputs.nth(3).fill('lucia@example.com');
  await modal().locator('input[type=password]').fill('Lucia-Inicial-2026');
  await modal().locator('#role-CASHIER').check();
  await modal().locator('#role-INVENTORY').check();
  const branchSelect = modal().locator('select').last();
  const central = await branchSelect.locator('option', { hasText: 'Casa Central' }).getAttribute('value');
  await branchSelect.selectOption(central);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/51a-empleado-formulario.png`, fullPage: true });
  await modal().getByRole('button', { name: /Crear empleado/ }).click();
  await page.waitForSelector('tr:has-text("lucia.prueba")', { timeout: 15000 });
  const row = await page.locator('tr:has-text("lucia.prueba")').innerText();
  if (!row.includes('Cajero') || !row.includes('Depósito')) throw new Error(`Roles no visibles: ${row}`);
});
await step('52-empleado-edicion-roles', async () => {
  await page.locator('tr:has-text("lucia.prueba")').getByRole('button', { name: /Editar/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await modal().locator('#role-INVENTORY').uncheck();
  await modal().locator('#role-SELLER').check();
  await modal().getByRole('button', { name: /Guardar cambios/ }).click();
  await page.waitForSelector('.erp-modal', { state: 'detached', timeout: 15000 });
  const row = await page.locator('tr:has-text("lucia.prueba")').innerText();
  if (!row.includes('Vendedor') || row.includes('Depósito')) throw new Error(`Roles sin actualizar: ${row}`);
});
await step('53-empleado-contrasena', async () => {
  await page.locator('tr:has-text("lucia.prueba")').getByRole('button', { name: /Contraseña/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  const fields = modal().locator('input[type=password]');
  await fields.nth(0).fill(NEW_PASSWORD);
  await fields.nth(1).fill(NEW_PASSWORD);
  report.push(`   campos: ${await fields.count()} valores=${JSON.stringify([await fields.nth(0).inputValue(), await fields.nth(1).inputValue()])}`);
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.url().includes('/password') && req.method() === 'POST', { timeout: 10000 }),
    modal().getByRole('button', { name: /Guardar contraseña/ }).click(),
  ]);
  report.push(`   cuerpo enviado: ${request.postData()}`);
  await page.waitForSelector('.erp-modal', { state: 'detached', timeout: 15000 });
  for (const candidate of ['Lucia-Inicial-2026', NEW_PASSWORD]) {
    const status = await page.evaluate(async ([u, p]) => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).status, ['lucia.prueba', candidate]);
    report.push(`   login con ${candidate}: ${status}`);
  }
});
await step('54-empleada-ingresa', async () => {
  await loginAs('lucia.prueba', NEW_PASSWORD);
});
await step('55-empleada-cambia-su-contrasena', async () => {
  await page.locator('.topbar button[aria-expanded]').click();
  await page.getByRole('button', { name: /Cambiar mi contraseña/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/55a-modal-cambiar-contrasena.png` });
  const box = await modal().boundingBox();
  report.push(`   modal cambiar contraseña: alto ${Math.round(box?.height ?? 0)} px, botón visible ${await modal().getByRole('button', { name: /Guardar contraseña/ }).isVisible()}`);
  if (!box || box.height < 300) throw new Error(`Modal recortado: ${JSON.stringify(box)}`);
  const fields = modal().locator('input[type=password]');
  await fields.nth(0).fill(NEW_PASSWORD);
  await fields.nth(1).fill(OWN_PASSWORD);
  await fields.nth(2).fill(OWN_PASSWORD);
  await modal().getByRole('button', { name: /Guardar contraseña/ }).click();
  await page.waitForSelector('.erp-modal', { state: 'detached', timeout: 15000 });
});
await step('56-empleada-nueva-contrasena', async () => {
  await loginAs('lucia.prueba', OWN_PASSWORD);
  if (await page.locator('a[href="/configuracion/empleados"]').count()) throw new Error('Una cajera/vendedora ve el menú de empleados');
});


// ── El titular de la empresa no ve al operador de la plataforma ──
await step('60-titular-empleados', async () => {
  await loginAs('demo.titular');
  await page.goto(`${BASE}/configuracion/empleados?x=1`);
  await page.waitForSelector('table tbody tr td .cell-title', { timeout: 20000 });
  await page.getByRole('button', { name: 'Todos' }).click();
  await page.waitForTimeout(1500);
  const text = await page.locator('table').innerText();
  report.push(`   empleados que ve el titular: ${(await page.locator('table tbody tr .cell-sub').allInnerTexts()).join(', ')}`);
  if (/\badmin\b/.test(text) || text.includes('Administrador Plataforma')) throw new Error('El titular ve al operador de la plataforma');
});
await step('61-titular-auditoria', async () => {
  await page.goto(`${BASE}/configuracion/auditoria`);
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const text = await page.locator('table').innerText();
  report.push(`   auditoría muestra soporte: ${text.includes('Soporte de la plataforma')}`);
  if (text.includes('Administrador Plataforma')) throw new Error('La auditoría revela al operador');
});
await step('62-titular-reporte-vendedores', async () => {
  await page.goto(`${BASE}/reportes`);
  await page.waitForLoadState('networkidle');
  const text = await page.locator('body').innerText();
  if (text.includes('Administrador Plataforma')) throw new Error('Los reportes revelan al operador');
});


// ── Régimen Tierra del Fuego (plataforma) y comprobante elegido en caja ──
await step('70-plataforma-regimen-tdf', async () => {
  await loginAs('admin');
  await page.goto(`${BASE}/plataforma/empresas`);
  const company = page.locator('section.surface', { hasText: 'Almacenes del Centro' });
  await company.locator('select').first().selectOption('TIERRA_DEL_FUEGO');
  await page.waitForSelector('text=Régimen actualizado', { timeout: 15000 });
  await page.waitForTimeout(800);
});
await step('71-cajero-pos-tdf', async () => {
  await loginAs('demo.cajero');
  await page.goto(`${BASE}/ventas/pos`);
  const search = page.locator('.pos-search input');
  await search.fill('Yerba');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await page.waitForSelector('text=Sin IVA · Tierra del Fuego', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const ticket = await page.locator('aside.ticket').innerText();
  report.push(`   ticket: ${ticket.replace(/\s+/g, ' ').slice(0, 260)}`);
  if (/IVA 21/.test(ticket)) throw new Error('Con régimen Tierra del Fuego no debería discriminarse IVA');
  if (!ticket.includes('2.690,00')) throw new Error('En Tierra del Fuego se cobra el precio cargado ($ 2.690), sin volver a quitar el IVA');
});
await step('72-cajero-factura-a-cuit', async () => {
  await page.getByRole('button', { name: 'Factura A' }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.locator('.erp-modal input').first().fill('30-71999888-3');
  await page.locator('.erp-modal').getByRole('button', { name: /Buscar/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/72a-modal-cuit.png` });
  const modalText = await page.locator('.erp-modal').innerText();
  if (modalText.includes('Usar este cliente')) {
    await page.locator('.erp-modal').getByRole('button', { name: /Usar este cliente/ }).click();
  } else {
    await page.locator('.erp-modal input').nth(1).fill('Distribuidora Austral SRL');
    await page.locator('.erp-modal').getByRole('button', { name: /Dar de alta y usar/ }).click();
  }
  await page.waitForSelector('.erp-modal', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(1500);
  const ticket = await page.locator('aside.ticket').innerText();
  report.push(`   ticket A: ${ticket.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (!ticket.includes('Factura A')) throw new Error('No quedó seleccionada la Factura A');
});
await step('73-cajero-cobra-y-entrega', async () => {
  await page.getByRole('button', { name: /^Cobrar/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Confirmar/ }).click();
  await page.waitForSelector('text=Venta registrada', { timeout: 20000 });
  await page.getByRole('link', { name: /Ver venta/ }).click();
  await page.waitForURL('**/ventas/*', { timeout: 15000 });
  await page.getByRole('link', { name: /Comprobante de entrega/ }).click();
  await page.waitForSelector('text=No válido como factura', { timeout: 15000 });
  await page.waitForSelector('text=Inicio de actividad', { timeout: 15000 });
  const text = (await page.locator('article').innerText()).replace(/\s+/g, ' ');
  report.push(`   remito: ${text.slice(0, 420)}`);
  for (const expected of ['REMITO', 'Señor:', 'Cuenta:', 'Dirección:', 'IVA:', 'Vendedor:', 'Cond. de Vta.:', 'CUIT:', 'IIBB:']) {
    if (!text.includes(expected)) throw new Error(`Falta "${expected}" en el remito`);
  }
});
await step('74-vendedora-sin-elegir-comprobante', async () => {
  await loginAs('demo.vendedora');
  await page.goto(`${BASE}/ventas/pos`);
  const search = page.locator('.pos-search input');
  await search.fill('Yerba');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await page.waitForSelector('text=lo elige la caja', { timeout: 15000 });
  if (await page.getByRole('button', { name: 'Factura A' }).count()) throw new Error('La vendedora no debería elegir comprobante');
});


await step('75-compra-tdf-sin-iva', async () => {
  await loginAs('admin');
  await page.goto(`${BASE}/tablero`);
  const select = page.locator('.branch-pill select');
  const value = await select.locator('option', { hasText: 'Casa Central' }).getAttribute('value');
  await select.selectOption(value);
  await page.goto(`${BASE}/compras/recepciones/nueva`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Sucursal en Tierra del Fuego', { timeout: 15000 });
  const search = page.locator('input[placeholder*="Agregar producto"], .pos-search input, input[type=search]').first();
  await search.fill('Yerba');
  await page.waitForSelector('.pos-results .result, [role=option]', { timeout: 10000 });
  await page.locator('.pos-results .result, [role=option]').first().click();
  await page.waitForTimeout(800);
  const vat = await page.locator('select[aria-label^="IVA de"]').first();
  report.push(`   alícuota compra: ${await vat.inputValue()} deshabilitada=${await vat.isDisabled()}`);
  if ((await vat.inputValue()) !== '0' || !(await vat.isDisabled())) throw new Error('La compra en Tierra del Fuego debe quedar sin IVA');
});


// ── Presupuestos X de 24 h y datos de atención en la venta ──
let quoteUrl = '';
await step('80-vendedora-presupuesto-x', async () => {
  await loginAs('demo.vendedora');
  await page.goto(`${BASE}/ventas/pos`);
  const search = page.locator('.pos-search input');
  await search.fill('Café');
  await page.waitForSelector('.pos-results .result', { timeout: 10000 });
  await page.locator('.pos-results .result').first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Presupuesto X/ }).click();
  await page.waitForSelector('.erp-modal', { timeout: 5000 });
  await page.locator('.erp-modal input').fill('Vuelve mañana');
  await page.locator('.erp-modal').getByRole('button', { name: /Emitir presupuesto/ }).click();
  await page.waitForURL('**/ventas/presupuestos/*', { timeout: 15000 });
  await page.waitForSelector('text=Validez: 72 horas', { timeout: 15000 });
  quoteUrl = page.url();
  const text = (await page.locator('article').innerText()).replace(/\s+/g, ' ');
  report.push(`   presupuesto: ${text.slice(0, 420)}`);
  for (const expected of ['No válido como factura', 'PRESUPUESTO', 'Señor:', 'Vendedor:', 'Inicio de actividad', 'IIBB:', 'válido por 72 horas']) {
    if (!text.includes(expected)) throw new Error(`Falta "${expected}" en el presupuesto`);
  }
});
await step('81-otro-usuario-no-convierte', async () => {
  await loginAs('demo.cajero');
  await page.goto(quoteUrl);
  await page.waitForTimeout(2000);
  const text = await page.locator('main, body').first().innerText();
  if (await page.getByRole('button', { name: /Pasar a pedido/ }).count()) throw new Error('Otro usuario no debería poder pasarlo a pedido');
  report.push(`   cajero ve: ${text.includes('no existe o ya venció') ? 'no visible (otro vendedor)' : 'visible sin botón'}`);
});
await step('82-vendedora-pasa-a-pedido', async () => {
  await loginAs('demo.vendedora');
  await page.goto(`${BASE}/ventas/presupuestos`);
  await page.waitForSelector('table tbody tr.clickable', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/82a-lista-presupuestos.png`, fullPage: true });
  await page.locator('table tbody tr.clickable').first().getByRole('button', { name: /Pasar a pedido/ }).click();
  await page.waitForURL('**/ventas/pedidos/*', { timeout: 15000 });
  await page.waitForSelector('text=Presupuesto X N.º', { timeout: 15000 });
});
await step('83-venta-muestra-vendedor-y-cajero', async () => {
  await loginAs('admin');
  await page.goto(`${BASE}/ventas`);
  await page.waitForSelector('table tbody tr.clickable', { timeout: 15000 });
  await page.locator('table tbody tr.clickable').first().click();
  await page.waitForURL('**/ventas/*', { timeout: 15000 });
  await page.waitForSelector('text=Atención', { timeout: 15000 });
  const text = await page.locator('body').innerText();
  const block = text.slice(text.indexOf('Atención'), text.indexOf('Atención') + 120).replace(/\s+/g, ' ');
  report.push(`   ${block}`);
  if (!/Vendedor/.test(block) || !/Cobró/.test(block)) throw new Error('Falta vendedor/cajero en la venta');
});

await step('84-factura-encabezado', async () => {
  await page.goto(`${BASE}/comprobantes`);
  await page.waitForLoadState('networkidle');
  const row = page.locator('table tbody tr.clickable').first();
  if (!(await row.count())) { report.push('   sin comprobantes autorizados en la demo'); return; }
  await row.click();
  await page.waitForURL('**/comprobantes/*', { timeout: 15000 });
  await page.waitForSelector('article.invoice-sheet', { timeout: 15000 });
  const text = (await page.locator('article').innerText()).replace(/\s+/g, ' ');
  report.push(`   factura: ${text.slice(0, 420)}`);
  for (const expected of ['Señor:', 'Cuenta:', 'Dirección:', 'IVA:', 'Vendedor:', 'Cond. de Vta.:', 'Inicio de actividad', 'IIBB:']) {
    if (!text.includes(expected)) throw new Error(`Falta "${expected}" en la factura`);
  }
});
await step('85-config-datos-empresa', async () => {
  await page.goto(`${BASE}/configuracion/fiscal`);
  await page.waitForSelector('text=Localidad', { timeout: 15000 });
});

writeFileSync(`${OUT}/informe.txt`, `${report.join('\n')}\n\nFALLAS (${failures.length}):\n${failures.join('\n')}\n`);
console.log(report.join('\n'));
console.log(`FALLAS (${failures.length})`);
for (const f of failures) console.log(`::warning::${f.replace(/%/g, '%25').replace(/\n/g, ' ')}`);
await browser.close();
