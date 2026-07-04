import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-user';
import { User } from '../../users/entities/user.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

type AccessTokenPayload = {
  sub?: string;
  roles?: string[];
  operatorId?: string;
  sessionId?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET')
      });

      if (!payload.sub || !Array.isArray(payload.roles)) {
        throw new UnauthorizedException('Access token payload is invalid');
      }

      const user = await this.dataSource.getRepository(User).findOne({
        where: { id: payload.sub },
        select: ['status']
      });

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('Account is not active');
      }

      request.user = {
        id: payload.sub,
        roles: payload.roles,
        operatorId: payload.operatorId,
        sessionId: payload.sessionId
      };

      // Record the tenant for the rest of the request so scoped reads/writes
      // resolve to this operator.
      if (payload.operatorId) {
        this.tenantContext.set(payload.operatorId, 'jwt');
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Access token is invalid');
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const authorization = request.header('authorization');
    if (!authorization) {
      return undefined;
    }

    const [type, token] = authorization.split(' ');
    if (type?.toLowerCase() !== 'bearer' || !token) {
      return undefined;
    }

    return token;
  }
}
