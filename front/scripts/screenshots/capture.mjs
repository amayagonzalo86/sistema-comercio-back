// Capturas de las pantallas principales contra la API simulada (solo CI).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const OUT = process.argv[2] ?? 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
const page = await context.newPage();
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`[${message.type()}] ${page.url()} ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${page.url()} ${error.message}`));

const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};

// El mock siempre renueva la sesión: forzamos el formulario de ingreso bloqueando /auth/refresh una vez.
await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, body: '{"statusCode":401,"message":"Sin sesión"}' }));
await page.goto(`${BASE}/login`);
await shot('01-login');
await page.unroute('**/api/v1/auth/refresh');
await page.fill('#username', 'gonzalo');
await page.fill('#password', 'demo-123456');
await page.click('button[type=submit]');
await page.waitForURL('**/tablero');
await shot('02-tablero');

const visit = async (path, name, after) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  if (after) await after();
  await shot(name);
};

await visit('/ventas/pos', '03-pos', async () => {
  await page.selectOption('.branch-pill select', 'b-1').catch(() => undefined);
  await page.waitForTimeout(400);
  const search = page.locator('.pos-search input');
  await search.fill('yerba');
  await page.waitForTimeout(700);
  await page.locator('.pos-results .result').first().click();
  await search.fill('café');
  await page.waitForTimeout(700);
  await page.locator('.pos-results .result').first().click();
  await page.locator('.qty-stepper button[aria-label=Sumar]').first().click();
  await page.locator('.qty-stepper button[aria-label=Sumar]').first().click();
  await page.waitForTimeout(900);
});
await page.keyboard.press('F9');
await shot('04-pos-cobro');
await page.keyboard.press('Escape');

await visit('/catalogo', '05-catalogo');
await visit('/catalogo/aumentos', '06-aumentos');
await visit('/stock', '07-stock');
await visit('/caja', '08-caja');
await visit('/ventas', '09-ventas');
await visit('/comprobantes/d-1', '10-factura');
await visit('/reportes', '11-reportes');
await visit('/marketing', '12-promociones');
await visit('/compras/pedidos', '13-pedidos');
await visit('/configuracion/fiscal', '14-fiscal');
await visit('/contactos', '15-contactos');

await page.setViewportSize({ width: 390, height: 844 });
await visit('/tablero', '16-tablero-movil');

writeFileSync(`${OUT}/console.txt`, problems.join('\n') || 'Sin errores ni advertencias en consola.');
await browser.close();
console.log(`Capturas en ${OUT}. Problemas de consola: ${problems.length}`);
