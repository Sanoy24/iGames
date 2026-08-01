import { join } from 'path';
import { UPLOADS_ROOT } from '../common/uploads.constants';

export { UPLOADS_ROOT };

/** Sub-directory (relative to UPLOADS_ROOT) that broadcast images live in. */
export const BROADCAST_IMAGE_SUBDIR = 'broadcasts';

/** Absolute directory that multer writes broadcast images into. */
export const BROADCAST_IMAGE_DIR = join(UPLOADS_ROOT, BROADCAST_IMAGE_SUBDIR);

/** Telegram caption limit when a photo is attached. */
export const TELEGRAM_CAPTION_MAX = 1024;
