/**
 * Synthesized "player joined" chime for the admin panel  no audio assets, all
 * generated with the Web Audio API. Best-effort: no-ops silently if audio is
 * unavailable. Call `resumeAdminAudio()` from a user gesture (the header
 * toggle) so the browser allows the context to start. Mirrors the approach in
 * werkSfx.ts/poolSfx.ts.
 */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        try {
            const Ctor =
                window.AudioContext ||
                (
                    window as unknown as {
                        webkitAudioContext?: typeof AudioContext;
                    }
                ).webkitAudioContext;
            if (!Ctor) return null;
            ctx = new Ctor();
        } catch {
            return null;
        }
    }
    return ctx;
}

/** Resume the audio context  call on a user gesture (the alerts toggle). */
export function resumeAdminAudio(): void {
    const c = ac();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function tone(freq: number, dur: number, gain: number, delay = 0): void {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    const start = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
}

/** Two-note doorbell-style chime, played when a player opens the Mini App. */
export function playerJoinedChime(): void {
    tone(880, 0.18, 0.14);
    tone(659, 0.22, 0.12, 0.14);
}
