import type { Options } from 'canvas-confetti';

// Fire a confetti burst, loading the canvas-confetti library on demand. Confetti
// only ever plays on a win, so there's no reason to ship it in a page's chunk
// this dynamic import keeps it out until the first celebration.
export async function fireConfetti(opts: Options): Promise<void> {
    try {
        const confetti = (await import('canvas-confetti')).default;
        confetti(opts);
    } catch {
        /* confetti is purely cosmetic  never let a load failure break the win flow */
    }
}
