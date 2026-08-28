import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Headers de Seguridad HTTP
  app.use(helmet());

  // Parser de cookies para Refresh Tokens seguros
  app.use(cookieParser());

  // Configuración de CORS
  const allowedOrigins = configService
    .get<string>('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',');

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Branch-ID'],
  });

  // Prefijo global de API
  app.setGlobalPrefix('api/v1');

  // Pipe global de validación DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Filtro de excepciones estandarizado
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Servidor ERP (Argentina) iniciado correctamente en el puerto: ${port}`);
}

bootstrap();