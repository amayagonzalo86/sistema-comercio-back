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
const loginAs = async (user) => {
  await context.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', user);
  await page.fill('#password', 'Admin-Comercio-2026!');
  await page.click('button[type=submit]');
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await reportInflight(`login ${user}`);
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
  if (await page.locator('.tenant-option').count()) await page.locator('.tenant-option', { hasText: 'Almacenes del Centro' }).click();
  await page.goto(`${BASE}/tablero`);
  await page.waitForSelector('text=Pedidos esperando cobro', { timeout: 20000 });
});

writeFileSync(`${OUT}/informe.txt`, `${report.join('\n')}\n\nFALLAS (${failures.length}):\n${failures.join('\n')}\n`);
console.log(report.join('\n'));
console.log(`FALLAS (${failures.length})`);
for (const f of failures) console.log(`::warning::${f.replace(/%/g, '%25').replace(/\n/g, ' ')}`);
await browser.close();
