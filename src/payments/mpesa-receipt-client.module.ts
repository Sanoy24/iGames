import { Module } from '@nestjs/common';
import { MpesaReceiptClientService } from './mpesa-receipt-client.service';

/**
 * Leaf module: no imports beyond the global ConfigModule, so anything can depend
 * on it without creating a cycle. Provides the M-PESA receipt fetch+parse used by
 * the deposit verifier (PaymentsModule) and the withdrawal-proof verifier
 * (AgentsModule)  the exact analogue of TelebirrReceiptClientModule.
 */
@Module({
    providers: [MpesaReceiptClientService],
    exports: [MpesaReceiptClientService],
})
export class MpesaReceiptClientModule {}
