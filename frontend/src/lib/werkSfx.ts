/**
 * Synthesized sound for Werk Flega  no audio assets, all generated with the Web
 * Audio API (spec §9). Best-effort: no-ops silently if audio is unavailable or
 * muted. Call `resumeWerkAudio()` from a user gesture so the browser starts the
 * context. Mirrors the approach in poolSfx.ts.
 */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
    if (typeof window === 'undefined' || muted) return null;
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

export function resumeWerkAudio(): void {
    const c = ac();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setWerkMuted(m: boolean): void {
    muted = m;
}

export function isWerkMuted(): boolean {
    return muted;
}

/** A tone with an optional linear/exponential frequency sweep. */
function tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    sweepTo?: number,
): void {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const now = c.currentTime;
    o.frequency.setValueAtTime(freq, now);
    if (sweepTo)
        o.frequency.exponentialRampToValueAtTime(
            Math.max(30, sweepTo),
            now + dur,
        );
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(c.destination);
    o.start(now);
    o.stop(now + dur + 0.02);
}

function chord(
    freqs: number[],
    dur: number,
    gain: number,
    type: OscillatorType = 'triangle',
): void {
    for (const f of freqs) tone(f, dur, gain, type);
}

// ── Throttle so dense collect bursts don't machine-gun ──────────────────────
const last: Record<string, number> = {};
function throttled(key: string, gapMs: number): boolean {
    const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (last[key] && now - last[key] < gapMs) return false;
    last[key] = now;
    return true;
}

/** Bronze/silver coin pickup: rising triangle 880→1320Hz. */
export function coinPickup(): void {
    if (!throttled('coin', 40)) return;
    tone(880, 0.08, 0.12, 'triangle', 1320);
}

/** Gold coin pickup: richer three-note chord. */
export function goldPickup(): void {
    chord([523, 659, 784], 0.15, 0.1, 'triangle');
}

/** Power-up pickup: bright two-tone. */
export function powerPickup(): void {
    tone(660, 0.1, 0.12, 'square', 990);
}

/** Final-sprint horn (Mode B): sawtooth 180→260Hz. */
export function sprintHorn(): void {
    tone(180, 0.9, 0.18, 'sawtooth', 260);
}

/** Countdown beep. */
export function countdownBeep(): void {
    tone(440, 0.1, 0.15, 'sine');
}

/** Victory fanfare: ascending C-E-G-C arpeggio. */
export function victoryFanfare(): void {
    const c = ac();
    if (!c) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) =>
        setTimeout(() => tone(f, 0.22, 0.16, 'triangle'), i * 130),
    );
}

/** Elimination / loss thud. */
export function lossThud(): void {
    tone(220, 0.4, 0.16, 'sine', 90);
}
