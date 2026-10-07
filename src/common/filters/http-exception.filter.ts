import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface StandardErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  requestId: string | null;
  message: string | string[];
  details: unknown;
}

/**
 * Filtro global de errores.
 * - Errores esperados (4xx): devuelve el mensaje de negocio/validación.
 * - Errores inesperados (5xx, errores de MySQL, bugs): mensaje genérico, sin stack ni SQL,
 *   y se registra el detalle en el log del servidor con el requestId para rastrearlo.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Error interno del servidor';
    let details: unknown = null;

    if (exception instanceof HttpException && !isServerError) {
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        details = body.error ?? null;
      }
    }

    // Ruta sin query string: evita reflejar parámetros (que podrían contener datos sensibles).
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0];

    if (isServerError) {
      this.logger.error(
        `[${request.requestId ?? '-'}] ${request.method} ${path} -> ${status}: ${
          exception instanceof Error ? exception.stack : JSON.stringify(exception)
        }`,
      );
    }

    const payload: StandardErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      requestId: request.requestId ?? null,
      message,
      details,
    };

    response.status(status).json(payload);
  }
}
