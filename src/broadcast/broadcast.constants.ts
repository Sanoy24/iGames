import { join } from 'path';

/** Root directory served statically at /uploads (see main.ts). */
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');

/** Sub-directory (relative to UPLOADS_ROOT) that broadcast images live in. */
export const BROADCAST_IMAGE_SUBDIR = 'broadcasts';

/** Absolute directory that multer writes broadcast images into. */
export const BROADCAST_IMAGE_DIR = join(UPLOADS_ROOT, BROADCAST_IMAGE_SUBDIR);

/** Telegram caption limit when a photo is attached. */
export const TELEGRAM_CAPTION_MAX = 1024;
