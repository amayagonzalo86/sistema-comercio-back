import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync } from 'class-validator';

enum Environment {
    DEVELOPMENT = 'development',
    PRODUCTION = 'production',
    TEST = 'test',
}

class EnvironmentVariables {
    @IsEnum(Environment)
    NODE_ENV: Environment = Environment.DEVELOPMENT;

    @IsNumber()
    PORT: number = 3000;

    @IsString()
    DB_HOST!: string;

    @IsNumber()
    DB_PORT: number = 3306;

    @IsString()
    DB_USER!: string;

    @IsString()
    DB_PASSWORD!: string;

    @IsString()
    DB_NAME!: string;

    @IsString()
    JWT_ACCESS_SECRET!: string;

    @IsString()
    JWT_REFRESH_SECRET!: string;

    @IsString()
    ALLOWED_ORIGINS!: string;
}

export function validateEnv(config: Record<string, unknown>) {
    const validatedConfig = plainToInstance(EnvironmentVariables, config, {
        enableImplicitConversion: true,
    });

    const errors = validateSync(validatedConfig, {
        skipMissingProperties: false,
    });

    if (errors.length > 0) {
        throw new Error(`Error de validación en variables de entorno: ${errors.toString()}`);
    }

    return validatedConfig;
}