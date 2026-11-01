import { DataSource } from 'typeorm';
import { ALL_TENANT_MODULES } from '../common/modules/tenant-modules';

/**
 * Actualiza el esquema de la base de forma segura (npm run migration:run).
 *
 * Una base creada con `base-completa.sql` o arrancando la API en desarrollo (synchronize) ya tiene todas las
 * tablas, pero su tabla `migrations` no registra las migraciones: `typeorm migration:run` intentaba crear de nuevo
 * las tablas y fallaba («Table 'tenants' already exists»). Este comando lo resuelve:
 *
 * - Sin migraciones pendientes: no hace nada.
 * - Pendientes y el esquema YA coincide con las entidades: las registra como aplicadas sin ejecutarlas
 *   (y completa los datos que agregaban: módulos de la empresa de la plataforma).
 * - Base creada sin migraciones (tiene las tablas pero no registra la migración inicial) y con un esquema más viejo
 *   que el código: aplica solo los cambios que AGREGAN (tablas, columnas, índices) y después las registra. Si hiciera
 *   falta borrar o modificar algo, se detiene y lo lista sin tocar la base.
 * - En cualquier otro caso: ejecuta las migraciones pendientes, cada una en su transacción.
 */

const PLATFORM_TENANT_SLUG = 'plataforma';
/** Primera migración del esquema actual: si no está registrada pero sus tablas existen, la base se creó sin migraciones. */
const CORE_MIGRATION = 'CreateSaasCore1791000000000';

/** Cambios que solo agregan estructura (no borran ni modifican datos existentes). */
const ADDITIVE = /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE `[^`]+` ADD (`|CONSTRAINT|UNIQUE INDEX|INDEX|PRIMARY KEY))/i;

export type MigrateOutcome =
  | { mode: 'UP_TO_DATE'; pending: string[] }
  | { mode: 'BASELINE'; pending: string[]; applied: string[] }
  | { mode: 'MIGRATED'; pending: string[] };

interface MigrationEntry {
  name: string;
  timestamp: number;
}

function migrationEntries(dataSource: DataSource): MigrationEntry[] {
  return dataSource.migrations
    .map((migration) => {
      const name = migration.name ?? migration.constructor.name;
      const match = /(\d{13})$/.exec(name);
      if (!match) throw new Error(`La migración ${name} no termina con un timestamp de 13 dígitos.`);
      return { name, timestamp: Number(match[1]) };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function migrationsTable(dataSource: DataSource): string {
  const name = dataSource.options.migrationsTableName ?? 'migrations';
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Nombre de tabla de migraciones inválido: ${name}`);
  return name;
}

async function tableExists(dataSource: DataSource, table: string): Promise<boolean> {
  const rows = (await dataSource.query(
    'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  )) as Array<{ total: number | string }>;
  return Number(rows[0]?.total ?? 0) > 0;
}

async function executedMigrations(dataSource: DataSource): Promise<Set<string>> {
  const table = migrationsTable(dataSource);
  if (!(await tableExists(dataSource, table))) return new Set();
  const rows = (await dataSource.query(`SELECT name FROM \`${table}\``)) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** Diferencias entre la base y las entidades (vacío = el esquema ya está al día). */
export async function schemaDifferences(dataSource: DataSource): Promise<string[]> {
  const sql = await dataSource.driver.createSchemaBuilder().log();
  return sql.upQueries.map((query) => query.query.replace(/\s+/g, ' ').trim());
}

export async function migrateDatabase(dataSource: DataSource, log: (message: string) => void = console.log): Promise<MigrateOutcome> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const executed = await executedMigrations(dataSource);
  const pending = migrationEntries(dataSource).filter((migration) => !executed.has(migration.name));
  if (pending.length === 0) {
    log('La base ya está al día: no hay migraciones pendientes.');
    return { mode: 'UP_TO_DATE', pending: [] };
  }

  const differences = await schemaDifferences(dataSource);
  const createdWithoutMigrations = !executed.has(CORE_MIGRATION) && (await tableExists(dataSource, 'tenants'));
  let applied: string[] = [];
  if (differences.length > 0) {
    if (!createdWithoutMigrations) {
      log(`Aplicando ${pending.length} migraciones pendientes…`);
      await dataSource.runMigrations({ transaction: 'each' });
      log('Migraciones aplicadas.');
      return { mode: 'MIGRATED', pending: pending.map((migration) => migration.name) };
    }
    const destructive = differences.filter((query) => !ADDITIVE.test(query));
    if (destructive.length > 0) {
      throw new Error(
        'La base se creó sin migraciones y para ponerla al día habría que borrar o modificar estructura existente. ' +
          'No se tocó nada. Hacé un respaldo y revisá estos cambios:\n' +
          destructive.slice(0, 20).map((query) => `  - ${query}`).join('\n'),
      );
    }
    log(`La base se creó sin migraciones: agregando ${differences.length} cambios de estructura (tablas, columnas e índices nuevos)…`);
    for (const query of differences) await dataSource.query(query);
    applied = differences;
  }

  // La base ya tiene el esquema completo (base-completa.sql o synchronize): solo falta registrarlas.
  const table = migrationsTable(dataSource);
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `CREATE TABLE IF NOT EXISTS \`${table}\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`timestamp\` bigint NOT NULL,
        \`name\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    for (const migration of pending) {
      await manager.query(`INSERT INTO \`${table}\` (\`timestamp\`, \`name\`) VALUES (?, ?)`, [migration.timestamp, migration.name]);
    }
    // Datos que agregaban esas migraciones: la empresa de la plataforma tiene todos los módulos.
    for (const module of ALL_TENANT_MODULES) {
      await manager.query(
        `INSERT INTO tenant_modules (id, tenant_id, module, enabled, notes)
         SELECT UUID(), t.id, ?, 1, 'Empresa de la plataforma: todos los módulos.' FROM tenants t
          WHERE t.slug = ? AND NOT EXISTS (SELECT 1 FROM tenant_modules m WHERE m.tenant_id = t.id AND m.module = ?)`,
        [module, PLATFORM_TENANT_SLUG, module],
      );
    }
  });
  log(
    `${applied.length ? 'Esquema completado' : 'El esquema ya estaba completo'} (base creada con base-completa.sql o con la API en desarrollo): ` +
      `se registraron ${pending.length} migraciones como aplicadas.`,
  );
  return { mode: 'BASELINE', pending: pending.map((migration) => migration.name), applied };
}

if (require.main === module) {
  // Se carga recién acá para que importar este archivo (p. ej. desde las pruebas) no lea el .env ni conecte.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dataSource = (require('./data-source') as { default: DataSource }).default;
  migrateDatabase(dataSource)
    .then(async () => {
      await dataSource.destroy();
    })
    .catch(async (error: unknown) => {
      console.error('No se pudo actualizar la base:', error instanceof Error ? error.message : error);
      if (dataSource.isInitialized) await dataSource.destroy();
      process.exit(1);
    });
}
