import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger('HttpException');

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request & { requestId?: string }>();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const exceptionResponse =
            exception instanceof HttpException
                ? exception.getResponse()
                : undefined;

        // Log server-side so failures are never invisible. 5xx get the full stack
        // (these are bugs); 4xx get a one-line warning (usually bad client input).
        // The full, un-sanitized detail stays in the logs  only the client response
        // is scrubbed by getMessage/sanitize below.
        const where = `${request.method} ${request.url}`;
        const rid = request.requestId ? ` [req ${request.requestId}]` : '';
        if (status >= 500) {
            const stack =
                exception instanceof Error ? exception.stack : undefined;
            const detail =
                exception instanceof Error
                    ? exception.message
                    : String(exception);
            this.logger.error(`${status} ${where}${rid}  ${detail}`, stack);
        } else if (status >= 400) {
            this.logger.warn(
                `${status} ${where}${rid}  ${JSON.stringify(this.getMessage(exceptionResponse))}`,
            );
        }

        response.status(status).json({
            statusCode: status,
            error: this.getErrorName(status),
            message: this.getMessage(exceptionResponse),
            path: request.url,
            requestId: request.requestId,
            timestamp: new Date().toISOString(),
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
            'https://',
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
