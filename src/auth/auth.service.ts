import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { ClientSession, Connection, Model } from 'mongoose';
import { TelegramMiniAppAuthService } from '../telegram/telegram-mini-app-auth.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminService } from '../admin/admin.service';
import { RefreshSession } from './schemas/refresh-session.schema';

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
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(RefreshSession.name)
    private readonly refreshSessionModel: Model<RefreshSession>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly telegramMiniAppAuthService: TelegramMiniAppAuthService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly adminService: AdminService
  ) {}

  async loginWithTelegramMiniApp(initData: string): Promise<AuthTokenResponse> {
    const validatedTelegramData = this.telegramMiniAppAuthService.validateInitData(initData);
    const session = await this.connection.startSession();

    try {
      let response: AuthTokenResponse | undefined;

      await session.withTransaction(async () => {
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
          session
        );

        await this.walletService.ensureDefaultWallet(user._id, session);
        
        if (created) {
          const config = await this.adminService.getSystemConfig();
          if (config.welcomeBonusMinor > 0) {
            await this.walletService.creditInSession({
              userId: user._id.toString(),
              amountMinor: config.welcomeBonusMinor,
              entryType: 'bonus',
              sourceType: 'welcome_bonus',
              sourceId: user._id.toString(),
              idempotencyKey: `welcome-bonus-${user._id.toString()}`,
              metadata: { reason: 'welcome_bonus' }
            }, session);
          }
        }

        response = await this.issueTokens({
          userId: user._id.toString(),
          roles: user.roles,
          displayName: user.displayName,
          provider: 'telegram',
          session
        });
      });

      if (!response) {
        throw new Error('Token issuing transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async loginWithCredentials(email: string, password: string): Promise<AuthTokenResponse> {
    const user = await this.usersService.findAgentByCredentials(email, password);
    const session = await this.connection.startSession();
    try {
      let response: AuthTokenResponse | undefined;
      await session.withTransaction(async () => {
        await this.walletService.ensureDefaultWallet(user._id, session);
        response = await this.issueTokens({
          userId: user._id.toString(),
          roles: user.roles,
          displayName: user.displayName,
          provider: 'password',
          session,
        });
      });
      if (!response) throw new Error('Credentials login transaction did not complete');
      return response;
    } finally {
      await session.endSession();
    }
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

    const session = await this.connection.startSession();
    try {
      let response: AuthTokenResponse | undefined;

      await session.withTransaction(async () => {
        const refreshSession = await this.refreshSessionModel
          .findById(payload.sessionId)
          .session(session)
          .exec();

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

        // Revoke the old session
        refreshSession.revokedAt = new Date();
        await refreshSession.save({ session });

        const user = await this.usersService.findById(payload.sub);

        response = await this.issueTokens({
          userId: user._id.toString(),
          roles: user.roles,
          displayName: user.displayName,
          provider: refreshSession.provider,
          session
        });
      });

      if (!response) {
        throw new Error('Token refresh transaction did not complete');
      }

      return response;
    } finally {
      await session.endSession();
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.refreshSessionModel
      .findByIdAndUpdate(sessionId, { $set: { revokedAt: new Date() } })
      .exec();
  }

  /**
   * DEV ONLY — creates (or reuses) a seeded user and returns a token pair.
   * Never call this from production code; the controller that exposes it is
   * gated behind NODE_ENV !== 'production'.
   */
  async devSeedAdmin(
    displayName: string,
    roles: string[],
    initialBalanceMinor: number = 0
  ): Promise<AuthTokenResponse> {
    const providerUserId = `dev-seed:${displayName.toLowerCase().replace(/\s+/g, '-')}`;
    const session = await this.connection.startSession();

    try {
      let response: AuthTokenResponse | undefined;

      await session.withTransaction(async () => {
        // Find or create the user via the existing upsert path
        const { user } = await this.usersService.findOrCreateTelegramUser(
          {
            telegramUserId: providerUserId,
            firstName: displayName,
            username: displayName.toLowerCase().replace(/\s+/g, '_')
          },
          session
        );

        // Patch roles if the seeded user is missing any requested ones
        const currentRoles = user.roles as string[];
        const merged = [...new Set([...currentRoles, ...roles])];
        if (merged.length !== currentRoles.length) {
          user.roles = merged as typeof user.roles;
          await user.save({ session });
        }

        await this.walletService.ensureDefaultWallet(user._id, session);
        if (initialBalanceMinor > 0) {
          await this.walletService.creditInSession(
            {
              userId: user._id.toString(),
              amountMinor: initialBalanceMinor,
              entryType: 'deposit',
              sourceType: 'dev_seed',
              sourceId: `seed-${Date.now()}`,
              idempotencyKey: `seed-fund-${user._id}-${Date.now()}`
            },
            session
          );
        }

        response = await this.issueTokens({
          userId: user._id.toString(),
          roles: user.roles,
          displayName: user.displayName,
          provider: 'telegram',
          session
        });
      });

      if (!response) throw new Error('Dev seed transaction did not complete');
      return response;
    } finally {
      await session.endSession();
    }
  }

  private async issueTokens(input: {
    userId: string;
    roles: string[];
    displayName: string;
    provider: 'telegram' | 'password';
    session: ClientSession;
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

    await this.refreshSessionModel.create(
      [
        {
          _id: refreshSessionId,
          userId: input.userId,
          provider: input.provider,
          refreshTokenHash: this.hashToken(refreshToken),
          expiresAt: refreshExpiresAt
        }
      ],
      { session: input.session }
    );

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
