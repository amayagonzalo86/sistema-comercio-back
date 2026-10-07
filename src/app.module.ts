import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SeederModule } from './database/seeders/seeder.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ProductModule } from './modules/inventory/product/product.module';
import { ProductPriceListModule } from './modules/sales/price-list/product-price-list.module';
import { SalesModule } from './modules/sales/sales.module';
import { UserModule } from './modules/users/user.module';
import { PersonsModule } from './modules/persons/persons.module';
import { RolesModule } from './modules/roles/roles.module';
import { validateEnv } from './config/env.validation';
import { PlatformModule } from './modules/platform/platform.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { CashModule } from './modules/cash/cash.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    // Límite global de peticiones por IP (complementa el límite persistente del login y el WAF de Cloudflare).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          name: 'default',
          ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: configService.get<number>('THROTTLE_LIMIT', 300),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDevelopment = configService.get<string>('NODE_ENV') === 'development';
        const useSsl = configService.get<string>('DB_SSL') === 'true';
        return {
          type: 'mysql' as const,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 3306),
          username: configService.get<string>('DB_USER'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: configService.get<string>('DB_NAME'),
          autoLoadEntities: true, // Carga automáticamente las entidades registradas con forFeature()
          // Solo en desarrollo. En producción el esquema cambia únicamente con migraciones revisadas.
          synchronize: isDevelopment,
          timezone: 'Z',
          charset: 'utf8mb4_unicode_ci',
          // Pool acotado: protege a MySQL de saturarse en un VPS chico.
          poolSize: configService.get<number>('DB_POOL_SIZE', 10),
          // Corta consultas colgadas en lugar de retener conexiones indefinidamente.
          connectTimeout: 10_000,
          ...(useSsl ? { ssl: { rejectUnauthorized: true } } : {}),
          // Nunca permitir múltiples sentencias por consulta (reduce el impacto de una inyección SQL).
          extra: { multipleStatements: false },
        };
      },
    }),
    UserModule,
    AuthModule,
    ProductModule,
    SeederModule,
    BranchesModule,
    ProductPriceListModule,
    SalesModule,
    PersonsModule,
    RolesModule,
    PlatformModule,
    PurchasesModule,
    CashModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule { }
