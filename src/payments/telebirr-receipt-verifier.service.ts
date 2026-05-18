import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import {
  ParsedTelebirrReceipt,
  TelebirrReceiptPackage
} from './types/telebirr-receipt';

const loadCommonJsModule = createRequire(__filename);
const telebirrReceipt = loadCommonJsModule('telebirr-receipt') as TelebirrReceiptPackage;

export type VerifiedTelebirrReceipt = {
  receiptNo: string;
  amountMinor: number;
  parsedReceipt: ParsedTelebirrReceipt;
  verification: {
    receiverNameMatched: boolean | null;
    receiverAccountMatched: boolean | null;
    transactionStatusAccepted: boolean;
    expectedReceiverName?: string;
    expectedReceiverAccount?: string;
  };
};

import { AdminService } from '../admin/admin.service';

@Injectable()
export class TelebirrReceiptVerifierService {
  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService
  ) {}

  async verifyReceipt(receiptNoOrUrl: string): Promise<VerifiedTelebirrReceipt> {
    const receiptNo = this.extractReceiptNo(receiptNoOrUrl);
    const html = await this.loadReceipt(receiptNo);
    const parsedReceipt = telebirrReceipt.utils.parseFromHTML(html);

    return this.verifyParsedReceipt(receiptNo, parsedReceipt);
  }

  async verifyParsedReceipt(
    submittedReceiptNo: string,
    parsedReceipt: ParsedTelebirrReceipt
  ): Promise<VerifiedTelebirrReceipt> {
    const receiptNo = parsedReceipt.receiptNo || submittedReceiptNo;
    if (!receiptNo) {
      throw new BadRequestException('Telebirr receipt number was not found');
    }

    const amountBirr = parsedReceipt.settled_amount ?? parsedReceipt.total_amount;
    if (typeof amountBirr !== 'number' || !Number.isFinite(amountBirr) || amountBirr <= 0) {
      throw new BadRequestException('Telebirr receipt amount is invalid');
    }

    const transactionStatusAccepted = this.isAcceptedTransactionStatus(
      parsedReceipt.transaction_status
    );
    if (!transactionStatusAccepted) {
      throw new BadRequestException('Telebirr transaction is not completed');
    }

    const expectedReceiverName = this.configService.get<string>(
      'TELEBIRR_EXPECTED_RECEIVER_NAME'
    );
    const expectedReceiverAccount = this.configService.get<string>(
      'TELEBIRR_EXPECTED_RECEIVER_ACCOUNT'
    );

    const receiverNameMatched = this.matchOptionalField(
      parsedReceipt.credited_party_name ?? parsedReceipt.to,
      expectedReceiverName
    );
    const receiverAccountMatched = this.matchOptionalField(
      parsedReceipt.credited_party_acc_no ?? parsedReceipt.bank_acc_no,
      expectedReceiverAccount
    );

    if (receiverNameMatched === false || receiverAccountMatched === false) {
      throw new BadRequestException('Telebirr receipt receiver does not match');
    }

    return {
      receiptNo,
      amountMinor: await this.toCreditMinor(amountBirr),
      parsedReceipt,
      verification: {
        receiverNameMatched,
        receiverAccountMatched,
        transactionStatusAccepted,
        expectedReceiverName,
        expectedReceiverAccount
      }
    };
  }

  private async loadReceipt(receiptNo: string): Promise<string> {
    try {
      return await telebirrReceipt.utils.loadReceipt({ receiptNo });
    } catch (error) {
      throw new ServiceUnavailableException({
        message: 'Unable to load Telebirr receipt',
        detail: error instanceof Error ? error.message : 'Unknown Telebirr receipt error'
      });
    }
  }

  private extractReceiptNo(receiptNoOrUrl: string): string {
    const trimmed = receiptNoOrUrl.trim();
    if (!trimmed) {
      throw new BadRequestException('Telebirr receipt number is required');
    }

    if (!trimmed.startsWith('http')) {
      return this.validateReceiptNo(trimmed);
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new BadRequestException('Telebirr receipt URL is invalid');
    }

    if (url.hostname !== 'transactioninfo.ethiotelecom.et') {
      throw new BadRequestException('Telebirr receipt URL host is not allowed');
    }

    const receiptNo = url.pathname.split('/').filter(Boolean).at(-1);
    if (!receiptNo) {
      throw new BadRequestException('Telebirr receipt URL does not include a receipt number');
    }

    return this.validateReceiptNo(receiptNo);
  }

  private validateReceiptNo(receiptNo: string): string {
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(receiptNo)) {
      throw new BadRequestException('Telebirr receipt number is invalid');
    }
    return receiptNo;
  }

  private isAcceptedTransactionStatus(status: string | undefined): boolean {
    if (!status) {
      return false;
    }
    return ['completed', 'success', 'successful', 'paid'].some((accepted) =>
      status.toLowerCase().includes(accepted)
    );
  }

  private matchOptionalField(
    parsedValue: string | undefined,
    expectedValue: string | undefined
  ): boolean | null {
    if (!expectedValue) {
      return null;
    }
    if (!parsedValue) {
      return false;
    }
    return this.normalize(parsedValue) === this.normalize(expectedValue);
  }

  private normalize(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private async toCreditMinor(amountBirr: number): Promise<number> {
    const systemConfig = await this.adminService.getSystemConfig();
    const multiplier = systemConfig.telebirrCreditMinorPerBirr || 100;

    const amountMinor = Math.round(amountBirr * multiplier);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Telebirr converted wallet amount is invalid');
    }
    return amountMinor;
  }
}
