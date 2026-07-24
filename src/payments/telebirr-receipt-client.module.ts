import { Module } from '@nestjs/common';
import { TelebirrReceiptClientService } from './telebirr-receipt-client.service';

/**
 * Leaf module: no imports beyond the global ConfigModule, so anything can depend
 * on it without creating a cycle. Provides the Telebirr receipt fetch+parse used
 * by the withdrawal-proof verifier.
 */
@Module({
  providers: [TelebirrReceiptClientService],
  exports: [TelebirrReceiptClientService],
})
export class TelebirrReceiptClientModule {}
