/**
 * Synthesized "player joined" alert for the admin panel  no audio assets, all
 * generated with the Web Audio API. Deliberately loud/sharp (square wave, high
 * gain) rather than a soft UI chime, since the whole point is to grab an
 * admin's attention away from whatever they're looking at. Best-effort: no-ops
 * silently if audio is unavailable. Call `resumeAdminAudio()` from a user
 * gesture (the header toggle) so the browser allows the context to start.
 * Mirrors the approach in werkSfx.ts/poolSfx.ts.
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

function tone(
    freq: number,
    dur: number,
    gain: number,
    delay = 0,
    type: OscillatorType = 'sine',
): void {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const start = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
}

/**
 * Sharp, loud triple-beep alert  played when a player opens the Mini App.
 * Square wave (brighter/buzzier than a sine, cuts through background noise)
 * at a much higher gain than a passive UI chime, with a rising final beep so
 * it reads as urgent rather than a soft "ding".
 */
export function playerJoinedChime(): void {
    tone(1046.5, 0.11, 0.5, 0, 'square');
    tone(1046.5, 0.11, 0.5, 0.15, 'square');
    tone(1318.5, 0.18, 0.55, 0.32, 'square');
}
