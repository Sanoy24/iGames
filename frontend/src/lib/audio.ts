import { Howl } from 'howler';
import { useStore } from '../store/useStore';

// Web Audio API context for real-time synthesizer
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

function playTone(
  freq: number,
  type: OscillatorType,
  duration: number,
  vol: number,
  endFreq?: number
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const { soundMuted, soundVolume } = useStore.getState();
  if (soundMuted) return;

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
  }

  gainNode.gain.setValueAtTime(vol * soundVolume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export const soundEngine = {
  click: () => {
    playTone(600, 'sine', 0.1, 0.15);
  },
  hover: () => {
    playTone(900, 'sine', 0.04, 0.05);
  },
  pop: () => {
    playTone(400, 'triangle', 0.15, 0.2);
  },
  countdown: (isLast = false) => {
    if (isLast) {
      playTone(880, 'triangle', 0.18, 0.25);
    } else {
      playTone(440, 'triangle', 0.1, 0.2);
    }
  },
  reveal: (isHit = false) => {
    if (isHit) {
      // Ascending tone
      playTone(523.25, 'sine', 0.2, 0.2, 783.99); // C5 -> G5
    } else {
      // Short wood block pop
      playTone(300, 'triangle', 0.08, 0.12);
    }
  },
  win: () => {
    // Beautiful C Major arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        playTone(freq, 'sine', 0.3, 0.25);
      }, idx * 100);
    });
  },
  bigWin: () => {
    // Celebratory double-tempo major scale run
    const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.50, 1318.51, 1567.98];
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        playTone(freq, 'sine', 0.25, 0.25);
      }, idx * 80);
    });
  },
  jackpot: () => {
    // Sirens and fireworks arpeggio
    let count = 0;
    const interval = setInterval(() => {
      playTone(count % 2 === 0 ? 880 : 1320, 'sine', 0.15, 0.3);
      count++;
      if (count > 12) clearInterval(interval);
    }, 120);
  },
  cashout: () => {
    // Sound resembling cash register: High bell followed by metallic noise
    playTone(1800, 'sine', 0.12, 0.3);
    setTimeout(() => {
      playTone(1500, 'triangle', 0.25, 0.15);
    }, 60);
  },
  error: () => {
    // Double low buzz
    playTone(130, 'sawtooth', 0.2, 0.25);
    setTimeout(() => {
      playTone(110, 'sawtooth', 0.2, 0.25);
    }, 120);
  },
  // Howler integration stub in case we decide to load actual audio file maps
  loadCustomSound: (name: string, url: string) => {
    try {
      return new Howl({
        src: [url],
        volume: useStore.getState().soundVolume,
        mute: useStore.getState().soundMuted,
      });
    } catch (e) {
      console.warn('Failed to load custom sound via Howler:', name, e);
      return null;
    }
  }
};
