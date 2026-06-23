import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { CredentialsAuthDto } from './dto/credentials-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TelegramMiniAppAuthDto } from './dto/telegram-mini-app-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService, AuthTokenResponse } from './auth.service';
import { AuthenticatedUser } from './types/authenticated-user';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram/miniapp')
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @ApiCreatedResponse({
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        refreshToken: 'eyJhbGciOi...',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: '665f...', displayName: 'Jane Player', roles: ['player'] }
      }
    }
  })
  loginWithTelegramMiniApp(
    @Body() dto: TelegramMiniAppAuthDto
  ): Promise<AuthTokenResponse> {
    return this.authService.loginWithTelegramMiniApp(dto.initData);
  }

  @Post('credentials')
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @ApiOkResponse({ description: 'Agent/admin login with email and password' })
  loginWithCredentials(@Body() dto: CredentialsAuthDto): Promise<AuthTokenResponse> {
    return this.authService.loginWithCredentials(dto.phoneNumber, dto.password);
  }

  @Post('refresh')
  @Throttle({ strict: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        refreshToken: 'eyJhbGciOi...',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: '665f...', displayName: 'Jane Player', roles: ['player'] }
      }
    }
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokenResponse> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (user.sessionId) {
      await this.authService.logout(user.sessionId);
    }
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Password changed successfully' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { currentPassword: string; newPassword: string },
  ): Promise<{ ok: boolean }> {
    return this.authService.changePassword(user.id, body.currentPassword, body.newPassword);
  }
}
