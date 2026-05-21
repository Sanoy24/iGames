import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types } from 'mongoose';
import { Request } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-user';

type AccessTokenPayload = {
  sub?: string;
  roles?: string[];
  sessionId?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

      const user = await this.connection
        .collection('users')
        .findOne(
          { _id: new Types.ObjectId(payload.sub) },
          { projection: { status: 1 } }
        );

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('Account is not active');
      }

      request.user = {
        id: payload.sub,
        roles: payload.roles,
        sessionId: payload.sessionId
      };

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
