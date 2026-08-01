import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractTelebirrTxnNumber } from './telebirr-screenshot-ocr';

// tesseract.js is CommonJS; require it directly (same pattern as pdf-parse /
// telebirr-receipt elsewhere in this module) to avoid default-import interop
// pitfalls with its `export =` typing.
const loadCommonJsModule = createRequire(__filename);
type TesseractRecognizeResult = { data: { text: string } };
type TesseractRecognizeOptions = { langPath?: string };
type TesseractModule = {
  recognize: (image: Buffer, langs?: string, options?: TesseractRecognizeOptions) => Promise<TesseractRecognizeResult>;
};
const tesseract = loadCommonJsModule('tesseract.js') as TesseractModule;

const CANNOT_READ_MESSAGE =
  'Could not find a transaction number in that screenshot — please paste the SMS or receipt link instead';

// `scripts/fetch-tessdata.js` (a postinstall step — this project deploys by
// uploading dist/ + running npm install, not a git checkout on the server)
// vendors eng.traineddata.gz here so OCR never has to fetch it from a CDN at
// request time. When passed a local filesystem path (not a URL), tesseract.js
// reads `<langPath>/eng.traineddata.gz` directly instead of fetching it — see
// its worker-script/index.js loadLanguage(). Falls back to tesseract.js's own
// default CDN fetch if the vendored file isn't there (e.g. postinstall never
// ran, or the download failed on a host with known egress issues).
const VENDORED_TESSDATA_DIR = join(__dirname, '..', '..', 'tessdata');
const langPath = existsSync(join(VENDORED_TESSDATA_DIR, 'eng.traineddata.gz')) ? VENDORED_TESSDATA_DIR : undefined;

/**
 * OCR is trusted for exactly one thing: finding the Telebirr transaction
 * number in a screenshot so it can be looked up. The verified fetch against
 * the real Ethiotelecom receipt page (via TelebirrReceiptVerifierService,
 * driven from PaymentsService.previewTelebirrReceipt) remains the sole
 * source of truth for amount/payer/status — never anything read off the image.
 */
@Injectable()
export class TelebirrScreenshotOcrService {
  private readonly logger = new Logger(TelebirrScreenshotOcrService.name);

  async extractTransactionNumber(imageBuffer: Buffer): Promise<string> {
    let text: string;
    try {
      const result = await tesseract.recognize(imageBuffer, 'eng', langPath ? { langPath } : undefined);
      text = result.data.text;
    } catch (err) {
      this.logger.error(
        `Tesseract OCR failed: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadRequestException(CANNOT_READ_MESSAGE);
    }

    const receiptNo = extractTelebirrTxnNumber(text);
    if (!receiptNo) {
      throw new BadRequestException(CANNOT_READ_MESSAGE);
    }
    return receiptNo;
  }
}
