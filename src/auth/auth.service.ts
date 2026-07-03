import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { Repository, DataSource } from 'typeorm';
import { TelegramMiniAppAuthService } from '../telegram/telegram-mini-app-auth.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminService } from '../admin/admin.service';
import { RefreshSession } from './entities/refresh-session.entity';
import { User } from '../users/entities/user.entity';

export type AuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    displayName: string;
    roles: string[];
  };
};

type JwtSubjectPayload = {
  sub: string;
  roles: string[];
  sessionId?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly telegramMiniAppAuthService: TelegramMiniAppAuthService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly adminService: AdminService
  ) {}

  async loginWithTelegramMiniApp(initData: string): Promise<AuthTokenResponse> {
    const validatedTelegramData = this.telegramMiniAppAuthService.validateInitData(initData);

    return this.dataSource.transaction(async (manager) => {
      const { user, created } = await this.usersService.findOrCreateTelegramUser(
        {
          telegramUserId: String(validatedTelegramData.user.id),
          username: validatedTelegramData.user.username,
          firstName: validatedTelegramData.user.first_name,
          lastName: validatedTelegramData.user.last_name,
          languageCode: validatedTelegramData.user.language_code,
          photoUrl: validatedTelegramData.user.photo_url,
          isPremium: validatedTelegramData.user.is_premium
        },
        manager
      );

      await this.walletService.ensureDefaultWallet(user.id, manager);
      
      if (created) {
        const config = await this.adminService.getSystemConfig();
        if (config.welcomeBonusMinor > 0) {
          await this.walletService.creditInSession({
            userId: user.id,
            amountMinor: config.welcomeBonusMinor,
            entryType: 'bonus',
            sourceType: 'welcome_bonus',
            sourceId: user.id,
            idempotencyKey: `welcome-bonus-${user.id}`,
            metadata: { reason: 'welcome_bonus' }
          }, manager);
        }
      }

      return await this.issueTokens({
        userId: user.id,
        roles: user.roles,
        displayName: user.displayName,
        provider: 'telegram',
        manager
      });
    });
  }

  async loginWithCredentials(phoneNumber: string, password: string): Promise<AuthTokenResponse> {
    const user = await this.usersService.findBackofficeUserByCredentials(phoneNumber, password);
    
    return this.dataSource.transaction(async (manager) => {
      await this.walletService.ensureDefaultWallet(user.id, manager);
      return await this.issueTokens({
        userId: user.id,
        roles: user.roles,
        displayName: user.displayName,
        provider: 'password',
        manager,
      });
    });
  }

  async refreshTokens(rawRefreshToken: string): Promise<AuthTokenResponse> {
    let payload: JwtSubjectPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtSubjectPayload>(rawRefreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET')
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException('Refresh token payload is invalid');
    }

    return this.dataSource.transaction(async (manager) => {
      const refreshSessionRepo = manager.getRepository(RefreshSession);
      const refreshSession = await refreshSessionRepo.findOneBy({ id: payload.sessionId });

      if (!refreshSession || refreshSession.revokedAt) {
        throw new UnauthorizedException('Refresh session not found or revoked');
      }
      if (refreshSession.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh session has expired');
      }

      const expectedHash = this.hashToken(rawRefreshToken);
      const actualHash = Buffer.from(refreshSession.refreshTokenHash, 'hex');
      const expectedHashBuf = Buffer.from(expectedHash, 'hex');
      if (
        actualHash.length !== expectedHashBuf.length ||
        !timingSafeEqual(actualHash, expectedHashBuf)
      ) {
        throw new UnauthorizedException('Refresh token does not match session');
      }

      refreshSession.revokedAt = new Date();
      await refreshSessionRepo.save(refreshSession);

      const user = await this.usersService.findById(payload.sub);

      return await this.issueTokens({
        userId: user.id,
        roles: user.roles,
        displayName: user.displayName,
        provider: refreshSession.provider,
        manager
      });
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.refreshSessionRepository.update(sessionId, { revokedAt: new Date() });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    await this.usersService.changePassword(userId, currentPassword, newPassword);
    return { ok: true };
  }

  async devSeedAdmin(
    displayName: string,
    roles: string[],
    initialBalanceMinor = 0
  ): Promise<AuthTokenResponse> {
    const providerUserId = `dev-seed:${displayName.toLowerCase().replace(/\s+/g, '-')}`;

    return this.dataSource.transaction(async (manager) => {
      const { user } = await this.usersService.findOrCreateTelegramUser(
        {
          telegramUserId: providerUserId,
          firstName: displayName,
          username: displayName.toLowerCase().replace(/\s+/g, '_')
        },
        manager
      );

      const currentRoles = user.roles as string[];
      const merged = [...new Set([...currentRoles, ...roles])];
      if (merged.length !== currentRoles.length) {
        user.roles = merged as typeof user.roles;
        await manager.getRepository(User).save(user);
      }

      await this.walletService.ensureDefaultWallet(user.id, manager);
      if (initialBalanceMinor > 0) {
        await this.walletService.creditInSession(
          {
            userId: user.id,
            amountMinor: initialBalanceMinor,
            entryType: 'deposit',
            sourceType: 'dev_seed',
            sourceId: `seed-${Date.now()}`,
            idempotencyKey: `seed-fund-${user.id}-${Date.now()}`
          },
          manager
        );
      }

      return await this.issueTokens({
        userId: user.id,
        roles: user.roles,
        displayName: user.displayName,
        provider: 'telegram',
        manager
      });
    });
  }

  private async issueTokens(input: {
    userId: string;
    roles: string[];
    displayName: string;
    provider: 'telegram' | 'password';
    manager: any; // EntityManager
  }): Promise<AuthTokenResponse> {
    const refreshSessionId = randomUUID();
    const accessExpiresIn = this.getAccessExpiresInSeconds();
    const refreshExpiresAt = this.getRefreshExpiresAt();

    const accessPayload: JwtSubjectPayload = {
      sub: input.userId,
      roles: input.roles,
      sessionId: refreshSessionId
    };
    const refreshPayload: JwtSubjectPayload = {
      sub: input.userId,
      roles: input.roles,
      sessionId: refreshSessionId
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessExpiresIn
    });
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.getRefreshExpiresInSeconds()
    });

    const refreshSessionRepo = input.manager.getRepository(RefreshSession);
    const sessionRecord = refreshSessionRepo.create({
      id: refreshSessionId,
      userId: input.userId,
      provider: input.provider,
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt: refreshExpiresAt
    });
    await refreshSessionRepo.save(sessionRecord);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresIn,
      user: {
        id: input.userId,
        displayName: input.displayName,
        roles: input.roles
      }
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getAccessExpiresInSeconds(): number {
    const ttl = this.configService.getOrThrow<string>('JWT_ACCESS_TTL');
    return this.parseDurationSeconds(ttl, 15 * 60);
  }

  private getRefreshExpiresAt(): Date {
    const seconds = this.getRefreshExpiresInSeconds();
    return new Date(Date.now() + seconds * 1000);
  }

  private getRefreshExpiresInSeconds(): number {
    const ttl = this.configService.getOrThrow<string>('JWT_REFRESH_TTL');
    return this.parseDurationSeconds(ttl, 30 * 24 * 60 * 60);
  }

  private parseDurationSeconds(value: string, fallbackSeconds: number): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      return fallbackSeconds;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 's') {
      return amount;
    }
    if (unit === 'm') {
      return amount * 60;
    }
    if (unit === 'h') {
      return amount * 60 * 60;
    }
    return amount * 24 * 60 * 60;
  }
}
