import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

/** Secretos publicados en versiones anteriores de .env.example: nunca deben usarse. */
const KNOWN_LEAKED_SECRETS = new Set([
  'c8f5d0e91a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
  '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
]);

const WEAK_DB_PASSWORDS = new Set(['', '12345', '123456', 'root', 'password', 'admin', 'mysql']);

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.DEVELOPMENT;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 3306;

  @IsString()
  DB_USER!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_NAME!: string;

  /** Conexiones máximas del pool MySQL por instancia. 10 alcanza para un VPS chico. */
  @IsInt()
  @Min(2)
  @Max(100)
  DB_POOL_SIZE: number = 10;

  @IsIn(['true', 'false'])
  @IsOptional()
  DB_SSL?: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres aleatorios.' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres aleatorios.' })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  ALLOWED_ORIGINS!: string;

  /** Cantidad de proxies confiables delante de la API (Cloudflare + Nginx = 2). 0 = conexión directa. */
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  /** Ventana del límite global de peticiones, en segundos. */
  @IsInt()
  @Min(1)
  @Max(3600)
  THROTTLE_TTL: number = 60;

  /** Peticiones permitidas por IP dentro de la ventana. */
  @IsInt()
  @Min(10)
  @Max(100000)
  THROTTLE_LIMIT: number = 300;

  /** Tamaño máximo del cuerpo JSON. Evita ataques de agotamiento de memoria. */
  @IsString()
  BODY_LIMIT: string = '200kb';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  const problems = errors.flatMap((error) => Object.values(error.constraints ?? {}));

  problems.push(...securityProblems(validatedConfig));

  if (problems.length > 0) {
    throw new Error(`Configuración inválida en variables de entorno:\n - ${problems.join('\n - ')}`);
  }

  return validatedConfig;
}

/** Reglas cruzadas que class-validator no expresa por sí solo. */
export function securityProblems(env: EnvironmentVariables): string[] {
  const problems: string[] = [];
  const isProduction = env.NODE_ENV === Environment.PRODUCTION;

  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos.');
  }
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
  ] as const) {
    if (value && KNOWN_LEAKED_SECRETS.has(value)) {
      problems.push(`${name} usa un valor de ejemplo publicado. Generá uno nuevo (ver .env.example).`);
    }
  }

  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    problems.push('ALLOWED_ORIGINS debe listar al menos un origen.');
  }
  for (const origin of origins) {
    if (origin === '*' || origin.includes('*')) {
      problems.push('ALLOWED_ORIGINS no admite comodines (*): listá los orígenes exactos.');
      continue;
    }
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push(`ALLOWED_ORIGINS contiene un origen inválido: ${origin}`);
      continue;
    }
    if (parsed.origin !== origin) {
      problems.push(`ALLOWED_ORIGINS debe contener solo esquema+host+puerto, sin barra final ni ruta: ${origin}`);
    }
    if (isProduction && parsed.protocol !== 'https:') {
      problems.push(`En producción los orígenes deben usar HTTPS: ${origin}`);
    }
  }

  if (isProduction) {
    if (WEAK_DB_PASSWORDS.has(env.DB_PASSWORD ?? '') || (env.DB_PASSWORD ?? '').length < 12) {
      problems.push('En producción DB_PASSWORD debe ser robusta (12+ caracteres, no un valor por defecto).');
    }
    if (env.DB_USER === 'root') {
      problems.push('En producción no uses el usuario root de MySQL: creá un usuario con permisos mínimos.');
    }
  }

  return problems;
}
