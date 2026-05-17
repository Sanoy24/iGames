const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq: number, type: OscillatorType, duration: number, vol: number) {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

  gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

export const soundEngine = {
  click: () => playTone(600, 'sine', 0.1, 0.1),
  pop: () => playTone(400, 'triangle', 0.15, 0.2),
  win: () => {
    playTone(523.25, 'sine', 0.2, 0.2); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.2, 0.2), 150); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.4, 0.2), 300); // G5
  },
  error: () => playTone(150, 'sawtooth', 0.3, 0.3),
};
