import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    response.status(status).json({
      statusCode: status,
      error: this.getErrorName(status),
      message: this.getMessage(exceptionResponse),
      path: request.url,
      requestId: request.requestId,
      timestamp: new Date().toISOString()
    });
  }

  private getMessage(exceptionResponse: unknown): string | string[] {
    let msg: string | string[] = 'Internal server error';
    if (typeof exceptionResponse === 'string') {
      msg = exceptionResponse;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
    ) {
      const message = (exceptionResponse as { message: unknown }).message;
      if (typeof message === 'string' || Array.isArray(message)) {
        msg = message as string | string[];
      }
    }
    return this.sanitizeMessage(msg);
  }

  private sanitizeMessage(msg: string | string[]): string | string[] {
    if (Array.isArray(msg)) {
      return msg.map((m) => this.sanitizeString(m));
    }
    return this.sanitizeString(msg);
  }

  private sanitizeString(s: string): string {
    const lower = s.toLowerCase();
    const sensitiveWords = [
      'localhost',
      '127.0.0.1',
      'mongodb',
      'mongo',
      'database',
      'db:',
      'redis',
      'postgres',
      'mysql',
      'connection',
      'port',
      'host',
      'stack',
      'nest',
      'server information',
      'http://',
      'https://'
    ];
    if (sensitiveWords.some((word) => lower.includes(word))) {
      return 'A system error occurred. Please try again.';
    }
    return s;
  }

  private getErrorName(status: number): string {
    return HttpStatus[status] ?? 'Error';
  }
}
