import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Connection, Types } from 'mongoose';
import { AuthService, AuthTokenResponse } from '../auth/auth.service';
import { KenoService } from '../keno/keno.service';
import { WalletService } from '../wallet/wallet.service';
import { DEFAULT_KENO_PAYTABLE } from '../keno/constants/default-keno-paytable';
import { DevSeedDto } from './dto/dev-seed.dto';

@ApiTags('dev')
@Controller('dev')
export class DevController {
  private readonly logger = new Logger(DevController.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly kenoService: KenoService,
    private readonly walletService: WalletService,
  ) {}

  @Post('seed/admin')
  @ApiOkResponse({
    description: 'Returns a token pair for the seeded user',
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        refreshToken: 'eyJhbGciOi...',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: '665f...', displayName: 'Test Admin', roles: ['admin', 'player'] }
      }
    }
  })
  async seedAdmin(@Body() dto: DevSeedDto): Promise<AuthTokenResponse> {
    this.guardProduction();
    try {
      return await this.authService.devSeedAdmin(
        dto.displayName ?? 'Dev Admin',
        dto.roles ?? ['admin', 'player'],
        dto.initialBalanceMinor
      );
    } catch (error) {
      this.logger.error('devSeedAdmin failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  @Post('seed/player')
  @ApiOkResponse({ description: 'Returns a token pair for a seeded player user' })
  async seedPlayer(@Body() dto: DevSeedDto): Promise<AuthTokenResponse> {
    this.guardProduction();
    try {
      return await this.authService.devSeedAdmin(
        dto.displayName ?? 'Dev Player',
        dto.roles ?? ['player'],
        dto.initialBalanceMinor
      );
    } catch (error) {
      this.logger.error('devSeedPlayer failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  @Post('seed/keno-config')
  @ApiOkResponse({ description: 'Creates the default Keno config if none exists' })
  async seedKenoConfig() {
    this.guardProduction();
    try {
      return await this.kenoService.createConfig({
        name: 'Default Keno',
        ticketPriceMinor: 100,
        paytable: DEFAULT_KENO_PAYTABLE,
        numberMin: 1,
        numberMax: 80,
        drawSize: 20,
        allowedSpots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        globalBotWinInterval: 0,
        autoScheduleIntervalMinutes: 3,
      });
    } catch (error) {
      this.logger.error('seedKenoConfig failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  @Post('topup')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Adds test credits to a user wallet by userId' })
  async topup(@Body() body: { userId: string; amountMinor?: number }) {
    this.guardProduction();
    if (!body?.userId || !Types.ObjectId.isValid(body.userId)) {
      throw new ForbiddenException('Valid userId is required');
    }
    const amount = Math.max(1, body.amountMinor ?? 100_000);
    const userObjectId = new Types.ObjectId(body.userId);
    const session = await this.connection.startSession();
    try {
      let result: unknown;
      await session.withTransaction(async () => {
        await this.walletService.ensureDefaultWallet(userObjectId, session);
        result = await this.walletService.creditInSession(
          {
            userId: body.userId,
            amountMinor: amount,
            entryType: 'deposit',
            sourceType: 'dev_topup',
            sourceId: `dev-topup-${Date.now()}`,
            idempotencyKey: `dev-topup-${body.userId}-${Date.now()}`,
            metadata: { reason: 'dev_topup' },
          },
          session,
        );
      });
      return { ok: true, amountMinor: amount, ledgerEntry: result };
    } finally {
      await session.endSession();
    }
  }

  private guardProduction(): void {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Dev endpoints are not available in production');
    }
  }
}
