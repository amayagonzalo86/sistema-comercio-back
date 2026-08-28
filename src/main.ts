import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // 1. Capa de Seguridad HTTP (Helmet)
  app.use(helmet());

  // 2. Prefijo Global Estricto (/api/v1)
  const globalPrefix = 'api/v1';
  app.setGlobalPrefix(globalPrefix);

  // 3. Configuración Estricta de CORS desde variables de entorno
  const allowedOrigins = configService
    .get<string>('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',');

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // 4. Transformación y Validación Global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(
    `🚀 ERP Backend ejecutándose en: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();