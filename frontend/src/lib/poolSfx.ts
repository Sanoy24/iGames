/**
 * Tiny synthesized sound + haptics for the pool table  no audio assets. All
 * sounds are generated with the Web Audio API and are best-effort: if the API is
 * unavailable or blocked they no-op silently. Call `resumeAudio()` from a user
 * gesture (a tap) so the browser lets the context start.
 */
let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
    if (typeof window === 'undefined' || !enabled) return null;
    if (!ctx) {
        try {
            const Ctor =
                window.AudioContext ||
                (
                    window as unknown as {
                        webkitAudioContext?: typeof AudioContext;
                    }
                ).webkitAudioContext;
            if (!Ctor) {
                enabled = false;
                return null;
            }
            ctx = new Ctor();
        } catch {
            enabled = false;
            return null;
        }
    }
    return ctx;
}

/** Resume the audio context  call on a user gesture (pointer down / shot). */
export function resumeAudio(): void {
    const c = ac();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function haptic(ms: number): void {
    try {
        navigator.vibrate?.(ms);
    } catch {
        /* unsupported */
    }
}

/** A short filtered-noise burst  the sharp "clack" of a collision. */
function noiseBurst(dur: number, gain: number, freq: number, q = 1.2): void {
    const c = ac();
    if (!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n); // decaying noise
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur + 0.02);
}

/** A quick tonal blip with an optional downward sweep  used for the pocket drop. */
function blip(freq: number, dur: number, gain: number, sweepTo?: number): void {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (sweepTo)
        o.frequency.exponentialRampToValueAtTime(
            Math.max(40, sweepTo),
            c.currentTime + dur,
        );
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
}

// Throttle so a dense burst of events (e.g. the break) doesn't machine-gun.
const last: Record<string, number> = {};
function throttled(key: string, minGapMs: number): boolean {
    const now = performance.now();
    if (last[key] && now - last[key] < minGapMs) return false;
    last[key] = now;
    return true;
}

/** Ball-to-ball contact. `strength` 0–1 scales volume + haptic. */
export function ballClick(strength = 1): void {
    if (!throttled('click', 18)) return;
    noiseBurst(0.03, 0.06 + 0.16 * strength, 2100 + 600 * strength, 1.4);
    haptic(4 + Math.round(6 * strength));
}

/** Ball-to-cushion contact  softer + lower than a ball click. */
export function cushionHit(strength = 1): void {
    if (!throttled('cushion', 22)) return;
    noiseBurst(0.05, 0.05 + 0.09 * strength, 620, 0.9);
}

/** The cue tip striking the cue ball  a crisp tick when the shot fires. */
export function cueStrike(power = 1): void {
    noiseBurst(0.025, 0.1 + 0.14 * power, 1500, 2);
    haptic(10);
}

/** A ball dropping into a pocket. */
export function pocketDrop(): void {
    blip(360, 0.2, 0.2, 150);
    noiseBurst(0.09, 0.1, 380, 0.7);
    haptic(20);
}
