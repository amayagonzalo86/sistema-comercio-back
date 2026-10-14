import { createRequire } from 'node:module';

/**
 * Driver mysql2 cuyas conexiones trabajan siempre en UTC.
 *
 * TypeORM está configurado con `timezone: 'Z'`: convierte las fechas de JavaScript a UTC al escribir y
 * las interpreta como UTC al leer. Pero los valores que genera MySQL (DEFAULT CURRENT_TIMESTAMP,
 * NOW(), ON UPDATE) usan la zona horaria de la SESIÓN, que por defecto es la del servidor. En un
 * servidor configurado en Argentina (-03:00), `created_at` se leía 3 horas antes de lo real.
 *
 * Cada conexión nueva del pool ejecuta `SET time_zone = '+00:00'` antes de cualquier otra consulta
 * (mysql2 encola los comandos de una conexión en orden), así la API funciona igual sin importar
 * cómo esté configurado MySQL en el VPS.
 */

interface MysqlConnectionLike {
  query(sql: string, callback?: (error: Error | null) => void): unknown;
}

interface MysqlPoolLike {
  on(event: 'connection', listener: (connection: MysqlConnectionLike) => void): unknown;
}

interface Mysql2Module {
  createPool(config: unknown): MysqlPoolLike;
  createConnection(config: unknown): MysqlConnectionLike;
}

export const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

const mysql2 = createRequire(__filename)('mysql2') as Mysql2Module;

function forceUtc(connection: MysqlConnectionLike): void {
  connection.query(UTC_SESSION_SQL, (error) => {
    if (error) {
      // Sin la zona UTC las fechas quedarían corridas: se informa en el log del proceso.
      console.error(`[database] No se pudo fijar la zona horaria UTC de la sesión: ${error.message}`);
    }
  });
}

/** Hereda todo de mysql2 y solo cambia cómo se crean pools y conexiones. */
export const mysqlUtcDriver: Mysql2Module = Object.create(mysql2, {
  createPool: {
    value: (config: unknown): MysqlPoolLike => {
      const pool = mysql2.createPool(config);
      pool.on('connection', forceUtc);
      return pool;
    },
  },
  createConnection: {
    value: (config: unknown): MysqlConnectionLike => {
      const connection = mysql2.createConnection(config);
      forceUtc(connection);
      return connection;
    },
  },
}) as Mysql2Module;
