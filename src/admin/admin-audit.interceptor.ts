import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AdminAuditLog } from './entities/admin-audit-log.entity';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly auditRepository: Repository<AdminAuditLog>
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    // Only audit mutating actions
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const log = this.auditRepository.create({
        adminUserId: user?.id || 'unknown',
        method,
        url,
        body: this.sanitizeBody(body),
      });
      this.auditRepository.save(log).catch(err => console.error('Failed to write admin audit log:', err));
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
