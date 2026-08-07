import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Like {@link JwtAuthGuard}, but never rejects: it verifies the Bearer token and
 * populates `request.user` when one is present and valid, otherwise it lets the
 * request continue as an anonymous caller. Use it on read endpoints that serve
 * both logged-in players (who should get their own data, e.g. their tickets) and
 * anonymous spectators.
 *
 * The explicit constructor is required  a guard that merely `extends` another
 * without redeclaring the constructor loses its DI param metadata, so Nest would
 * inject nothing and `super()` would run with undefined dependencies.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
    constructor(
        configService: ConfigService,
        jwtService: JwtService,
        @InjectDataSource() dataSource: DataSource,
        reflector: Reflector,
    ) {
        super(configService, jwtService, dataSource, reflector);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            return await super.canActivate(context);
        } catch {
            // No token, expired/invalid token, or inactive account → treat as anonymous
            // rather than blocking the request.
            return true;
        }
    }
}
