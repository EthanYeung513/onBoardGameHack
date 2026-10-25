/**
 * Tiny synthesised sound effects (Web Audio), plus playback of remote clips. Everything is a no-op where audio
 * isn't available (tests, old browsers) and nothing plays until the page has had a user gesture.
 */
type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A short beep: menu cursor, text blips. */
export function blip(freq = 660, ms = 35, type: OscillatorType = "square", volume = 0.035) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + ms / 1000);
}

/** A pitch sweep: whooshes, power-ups, failures. */
export function sweep(from: number, to: number, ms = 250, type: OscillatorType = "sawtooth", volume = 0.05) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(to, a.currentTime + ms / 1000);
  gain.gain.setValueAtTime(volume, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + ms / 1000);
}

/** A noise burst: hits, slams. */
export function thud(ms = 180, volume = 0.3) {
  const a = audio();
  if (!a) return;
  const length = Math.floor((a.sampleRate * ms) / 1000);
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
  const src = a.createBufferSource();
  const gain = a.createGain();
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  gain.gain.value = volume;
  src.buffer = buffer;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
}

/** Plays a remote clip (e.g. a Pokémon cry). Failures are ignored. */
export function playClip(url: string, volume = 0.5) {
  if (typeof Audio === "undefined") return;
  const clip = new Audio(url);
  clip.volume = volume;
  void clip.play().catch(() => {});
}
