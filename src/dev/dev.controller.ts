import { Body, Controller, ForbiddenException, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthTokenResponse } from '../auth/auth.service';
import { DevSeedDto } from './dto/dev-seed.dto';

@ApiTags('dev')
@Controller('dev')
export class DevController {
  private readonly logger = new Logger(DevController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
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

  private guardProduction(): void {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Dev endpoints are not available in production');
    }
  }
}
