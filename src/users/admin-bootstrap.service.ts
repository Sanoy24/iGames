import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

type AdminBootstrapAccount = {
  phoneNumber: string;
  password: string;
  displayName?: string;
};

/**
 * Boot-time admin seeding for a fresh production database. There is no
 * self-service admin sign-up endpoint, and the /dev/seed/* routes are disabled
 * once NODE_ENV=production (DevController.guardProduction), so this is the
 * supported way to get the first admin account(s) into a brand-new deployment.
 *
 * Configured via ADMIN_BOOTSTRAP_ACCOUNTS — a JSON array of
 * { phoneNumber, password, displayName }. Idempotent: an account that already
 * exists (matched by phone number) is left completely untouched, so an admin
 * changing their password later is never undone by a restart. Safe to leave
 * configured indefinitely; blank (default) is a no-op.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const raw = this.configService.get<string>('ADMIN_BOOTSTRAP_ACCOUNTS')?.trim();
    if (!raw) return;

    let accounts: AdminBootstrapAccount[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('ADMIN_BOOTSTRAP_ACCOUNTS must be a JSON array');
      accounts = parsed as AdminBootstrapAccount[];
    } catch (err) {
      this.logger.error(
        `ADMIN_BOOTSTRAP_ACCOUNTS is not valid JSON — skipping admin bootstrap: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    for (const account of accounts) {
      if (!account?.phoneNumber || !account?.password) {
        this.logger.warn('Skipping an ADMIN_BOOTSTRAP_ACCOUNTS entry missing phoneNumber/password');
        continue;
      }
      if (account.password.length < 8) {
        this.logger.warn(`Skipping admin bootstrap for ${account.phoneNumber} — password must be at least 8 characters`);
        continue;
      }
      try {
        const result = await this.usersService.ensureAdminAccount({
          phoneNumber: account.phoneNumber,
          password: account.password,
          displayName: account.displayName?.trim() || 'Admin',
        });
        if (result === 'created') {
          this.logger.log(`Bootstrapped admin account for ${account.phoneNumber}`);
        }
      } catch (err) {
        this.logger.error(
          `Failed to bootstrap admin account for ${account.phoneNumber}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
