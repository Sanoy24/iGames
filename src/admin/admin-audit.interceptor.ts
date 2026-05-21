import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // Only audit mutating actions
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      this.connection.collection('adminauditlogs').insertOne({
        adminUserId: user?.id || 'unknown',
        method,
        url,
        body: this.sanitizeBody(body),
        timestamp: new Date(),
      }).catch(err => console.error('Failed to write admin audit log:', err));
    }

    return next.handle().pipe(tap(() => {}));
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const SENSITIVE = /password|secret|token/i;
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '[REDACTED]' : v,
      ]),
    );
  }
}
