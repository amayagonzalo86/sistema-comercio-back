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
  message: string;
  details: any;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Error interno del servidor';
    let details: any = null;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      message = (exceptionResponse as any).message || message;
      details = (exceptionResponse as any).error || (exceptionResponse as any).message || null;
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${request.method}] ${request.url} - Error Stack: ${
          exception instanceof Error ? exception.stack : JSON.stringify(exception)
        }`,
      );
    }

    const payload: StandardErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      details: status === HttpStatus.INTERNAL_SERVER_ERROR ? null : details,
    };

    response.status(status).json(payload);
  }
}