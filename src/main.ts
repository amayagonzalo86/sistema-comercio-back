import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Seguridad Cabeceras HTTP
  app.use(helmet());

  // Parser de Cookies para Refresh Tokens
  app.use(cookieParser());

  // CORS de Alta Seguridad
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS', '').split(',');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Branch-ID'],
  });

  // Prefijo Único de Versionado de API
  app.setGlobalPrefix('api/v1');

  // Pipe Global de Sanitización y Conversión DTO
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

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Servidor ERP backend iniciado exitosamente en puerto: ${port}`);
}

bootstrap();