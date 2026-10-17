import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, ERROR_CODES } from '../errors/app-error';

const STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: ERROR_CODES.unauthenticated,
  403: ERROR_CODES.forbidden,
  404: ERROR_CODES.notFound,
  409: ERROR_CODES.conflict,
  423: ERROR_CODES.accountLocked,
  429: 'RATE_LIMITED',
};

interface HttpBody {
  message?: string | string[];
  code?: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.internal;
    let message = 'Terjadi kesalahan internal. Silakan coba lagi.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? ERROR_CODES.internal;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const typed = body as HttpBody;
        if (typed.code) code = typed.code;
        if (typed.details !== undefined) details = typed.details;
        if (Array.isArray(typed.message)) {
          code = ERROR_CODES.validation;
          message = 'Data yang dikirim tidak valid.';
          details = typed.message.map((entry) => ({ message: entry }));
        } else if (typeof typed.message === 'string') {
          message = typed.message;
        }
      }
    } else if (exception instanceof Error && exception.name === 'MulterError') {
      status = HttpStatus.BAD_REQUEST;
      code = ERROR_CODES.validation;
      message = 'Berkas tidak dapat diproses. Pastikan ukuran tidak melebihi 20 MB dan hanya satu berkas.';
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl} -> ${status}`);
    }

    response.status(status).json({
      error: {
        code,
        message,
        details,
        requestId: request.id !== undefined ? String(request.id) : '',
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      },
    });
  }
}
