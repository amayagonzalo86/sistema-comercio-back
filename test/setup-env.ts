// Variables por defecto para las pruebas de integración (el CI las define con su MySQL de servicio).
const defaults: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3999',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_PASSWORD: 'root',
  DB_NAME: 'erp_test',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-abcdefghijklmno',
  THROTTLE_LIMIT: '100000',
  ADMIN_BOOTSTRAP_PASSWORD: 'Prueba-Integracion-2026!',
};
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
