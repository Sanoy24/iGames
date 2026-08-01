import { join } from 'path';

/** Root directory served statically at /uploads (see main.ts). */
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');

/** MIME whitelist for payment-receipt uploads (deposit/withdrawal proof) — images or PDF. */
export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
