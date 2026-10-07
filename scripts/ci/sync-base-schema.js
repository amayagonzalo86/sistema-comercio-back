/* eslint-disable */
// CI: crea el esquema de la versión base (main) con sus entidades compiladas y marca sus migraciones
// como ya ejecutadas. Después el CI aplica encima las migraciones nuevas, igual que en producción.
// Uso: node scripts/ci/sync-base-schema.js <carpeta-del-checkout-base>
const path = require('node:path');
const fs = require('node:fs');

async function main() {
  const baseDir = path.resolve(process.argv[2]);
  const { DataSource } = require(path.join(baseDir, 'node_modules', 'typeorm'));
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [path.join(baseDir, 'dist', '**', '*.entity.js')],
    synchronize: true,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
  });
  await dataSource.initialize();

  await dataSource.query(
    'CREATE TABLE IF NOT EXISTS migrations (id INT NOT NULL AUTO_INCREMENT, timestamp BIGINT NOT NULL, name VARCHAR(255) NOT NULL, PRIMARY KEY (id))',
  );
  const migrationsDir = path.join(baseDir, 'dist', 'migrations');
  const names = [];
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js'))) {
    const exported = require(path.join(migrationsDir, file));
    for (const MigrationClass of Object.values(exported)) {
      if (typeof MigrationClass !== 'function') continue;
      const instance = new MigrationClass();
      const name = instance.name || MigrationClass.name;
      const match = /(\d{13})$/.exec(name);
      if (match) names.push({ name, timestamp: Number(match[1]) });
    }
  }
  names.sort((a, b) => a.timestamp - b.timestamp);
  for (const item of names) {
    await dataSource.query('INSERT INTO migrations (timestamp, name) VALUES (?, ?)', [item.timestamp, item.name]);
  }
  console.log(`Esquema base creado; ${names.length} migraciones marcadas como ejecutadas.`);
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
