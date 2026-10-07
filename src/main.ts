import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // 0. IP real del cliente detrás de Cloudflare/Nginx. Sin esto, X-Forwarded-For se ignora
  //    (es falsificable) y el rate limit / lista blanca IP ven la IP del proxy.
  const trustProxyHops = configService.get<number>('TRUST_PROXY_HOPS', 0);
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);
  app.disable('x-powered-by');

  // 1. Límite de tamaño del cuerpo (protección contra agotamiento de memoria).
  const bodyLimit = configService.get<string>('BODY_LIMIT', '200kb');
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: false });

  // 2. Cabeceras de seguridad. Es una API JSON: no sirve HTML, así que la CSP es la más restrictiva.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(cookieParser());

  // 3. Id de correlación: se acepta el del proxy si es seguro, si no se genera uno nuevo.
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const incoming = request.headers['x-request-id'];
    request.requestId =
      typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    response.setHeader('x-request-id', request.requestId);
    // Las respuestas de la API contienen datos de negocio: no deben quedar en cachés intermedias.
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  // 4. Prefijo global (/api/v1).
  const globalPrefix = 'api/v1';
  app.setGlobalPrefix(globalPrefix);

  // 5. CORS estricto: solo los orígenes exactos de ALLOWED_ORIGINS (validados al arrancar).
  const allowedOrigins = new Set(
    configService
      .get<string>('ALLOWED_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      // Sin cabecera Origin = cliente no navegador (curl, app móvil, otro servidor): CORS no aplica.
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    maxAge: 600,
  });

  // 6. Validación global de DTOs: descarta y rechaza campos no declarados (mass assignment).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      // En producción no se devuelve el objeto recibido dentro de los errores de validación.
      validationError: { target: false, value: false },
      disableErrorMessages: false,
    }),
  );

  // 7. Apagado ordenado: cierra conexiones MySQL al recibir SIGTERM (deploys sin cortes).
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`ERP Backend escuchando en el puerto ${port} con prefijo /${globalPrefix}`);
}

bootstrap().catch((err: unknown) => {
  console.error('No se pudo iniciar la aplicación:', err);
  process.exit(1);
});
