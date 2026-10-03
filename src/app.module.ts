import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SeederModule } from './database/seeders/seeder.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ProductModule } from './modules/inventory/product/product.module';
import { ProductPriceListModule } from './modules/sales/price-list/product-price-list.module';
import { UserModule } from './modules/users/user.module';
import { PersonsModule } from './modules/persons/persons.module';
import { RolesModule } from './modules/roles/roles.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true, // Carga automáticamente las entidades registradas con forFeature()
        synchronize: configService.get<string>('NODE_ENV') === 'development', // true solo en desarrollo
      }),
    }),
    UserModule,
    AuthModule,
    ProductModule,
    SeederModule,
    BranchesModule,
    ProductPriceListModule,
    PersonsModule,
    RolesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }