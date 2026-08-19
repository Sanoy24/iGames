/**
 * Admin "player joined" alert  plays an actual ringtone file rather than a
 * synthesized tone, so it reads as a real attention-grabbing notification
 * (served from /public/sounds, swap the file there to change the sound).
 * Browsers block audio playback until a user gesture has happened on the
 * page, so `resumeAdminAudio()` primes the element (play + immediate pause)
 * from the header toggle's first click  the same unlock pattern used for the
 * Web Audio contexts elsewhere in the app (werkSfx.ts/poolSfx.ts).
 */
const SOUND_URL = '/sounds/admin-player-alert.mp3';

let audioEl: HTMLAudioElement | null = null;

function getAudioEl(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!audioEl) {
        audioEl = new Audio(SOUND_URL);
        audioEl.preload = 'auto';
        audioEl.volume = 1;
    }
    return audioEl;
}

/** Unlock playback  call on a user gesture (the alerts toggle / first click). */
export function resumeAdminAudio(): void {
    const el = getAudioEl();
    if (!el) return;
    el.play()
        .then(() => {
            el.pause();
            el.currentTime = 0;
        })
        .catch(() => {});
}

/** Plays the admin alert sound  played when a player opens the Mini App. */
export function playerJoinedChime(): void {
    const el = getAudioEl();
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
}
