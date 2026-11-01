import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';
import { migrateDatabase, schemaDifferences } from '../src/database/migrate';
import { ALL_TENANT_MODULES } from '../src/common/modules/tenant-modules';

/**
 * Base creada con base-completa.sql o con la API en desarrollo (synchronize): tiene todas las tablas pero la tabla
 * `migrations` no las registra. `npm run migration:run` tiene que registrarlas en lugar de fallar con
 * «Table 'tenants' already exists». Usa las entidades y migraciones compiladas (dist), como en el servidor.
 */
describe('npm run migration:run sobre una base creada sin migraciones (e2e)', () => {
  const dataSource = new DataSource({ ...dataSourceOptions, logging: false });

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.synchronize(true);
    await dataSource.query("INSERT INTO tenants (id, slug, legal_name, status) VALUES (?, 'plataforma', 'Operación de plataforma', 'ACTIVE')", [randomUUID()]);
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('registra las migraciones sin ejecutarlas y después queda al día', async () => {
    const messages: string[] = [];
    const first = await migrateDatabase(dataSource, (message) => messages.push(message));
    expect(first.mode).toBe('BASELINE');
    expect(first.pending).toHaveLength(dataSource.migrations.length);
    expect(first.pending).toContain('CreateSaasCore1791000000000');
    expect(messages[0]).toContain('se registraron');

    const recorded = (await dataSource.query('SELECT COUNT(*) AS total FROM migrations')) as Array<{ total: string | number }>;
    expect(Number(recorded[0].total)).toBe(dataSource.migrations.length);
    const modules = (await dataSource.query(
      "SELECT m.module FROM tenant_modules m JOIN tenants t ON t.id = m.tenant_id WHERE t.slug = 'plataforma' ORDER BY m.module",
    )) as Array<{ module: string }>;
    expect(modules.map((row) => row.module).sort()).toEqual([...ALL_TENANT_MODULES].sort());

    const second = await migrateDatabase(dataSource, () => undefined);
    expect(second.mode).toBe('UP_TO_DATE');
    expect(await schemaDifferences(dataSource)).toEqual([]);
  });

  it('completa una base vieja creada sin migraciones (solo agrega columnas e índices) y la registra', async () => {
    // Base de una versión anterior: sin el nombre en el sistema ni las columnas de pedidos por WhatsApp.
    await dataSource.query('DROP TABLE migrations');
    await dataSource.query('ALTER TABLE tenants DROP COLUMN display_name');
    await dataSource.query('ALTER TABLE sales_orders DROP COLUMN contact_phone');
    const outcome = await migrateDatabase(dataSource, () => undefined);
    expect(outcome.mode).toBe('BASELINE');
    if (outcome.mode !== 'BASELINE') throw new Error('modo inesperado');
    expect(outcome.applied.some((query) => query.includes('`display_name`'))).toBe(true);
    expect(outcome.applied.some((query) => query.includes('`contact_phone`'))).toBe(true);
    expect(await schemaDifferences(dataSource)).toEqual([]);
    expect((await migrateDatabase(dataSource, () => undefined)).mode).toBe('UP_TO_DATE');
  });

  it('no toca una base sin migraciones si habría que borrar o modificar estructura', async () => {
    await dataSource.query('DROP TABLE migrations');
    await dataSource.query('ALTER TABLE tenants MODIFY slug varchar(20) NOT NULL');
    await expect(migrateDatabase(dataSource, () => undefined)).rejects.toThrow('No se tocó nada');
    const exists = (await dataSource.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'migrations'",
    )) as Array<{ total: string | number }>;
    expect(Number(exists[0].total)).toBe(0);
  });
});
