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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_DATABASE', 'sistema_comercio'),
        autoLoadEntities: true, // Carga automáticamente las entidades registradas con forFeature()
        synchronize: configService.get<string>('NODE_ENV') !== 'production', // true solo en desarrollo
      }),
    }),
    UserModule,
    AuthModule,
    ProductModule,
    SeederModule,
    BranchesModule,
    ProductPriceListModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }