import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
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
    private readonly dataSource: DataSource,
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
        autoScheduleIntervalSeconds: 40,
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
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body?.userId || !uuidRegex.test(body.userId)) {
      throw new ForbiddenException('Valid UUID userId is required');
    }
    const amount = Math.max(1, body.amountMinor ?? 100_000);
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        await this.walletService.ensureDefaultWallet(body.userId, manager);
        return await this.walletService.creditInSession(
          {
            userId: body.userId,
            amountMinor: amount,
            entryType: 'deposit',
            sourceType: 'dev_topup',
            sourceId: `dev-topup-${Date.now()}`,
            idempotencyKey: `dev-topup-${body.userId}-${Date.now()}`,
            metadata: { reason: 'dev_topup' },
          },
          manager,
        );
      });
      return { ok: true, amountMinor: amount, ledgerEntry: result };
    } catch (error) {
      this.logger.error('topup failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  private guardProduction(): void {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Dev endpoints are not available in production');
    }
  }
}
