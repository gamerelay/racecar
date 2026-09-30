// Synth building blocks on Web Audio: a shared noise buffer, looping voices whose level and color
// follow the game every frame (engines, tyres, wind), and one-shot envelopes for moments (hits,
// chimes, whooshes, horns). Everything is made from oscillators and filtered noise: no samples.

export type Wave = OscillatorType;

let noise: AudioBuffer | undefined;

/** Two seconds of white noise, shared by every noise voice. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noise = b);
}

/** Moves an AudioParam toward `v` smoothly (time constant `tc` seconds): no zipper noise. */
export const glide = (p: AudioParam, v: number, now: number, tc = 0.04): void => {
  p.setTargetAtTime(v, now, tc);
};

/** A gain and a stereo panner: where every voice ends before its bus. */
export class Out {
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
  constructor(ctx: AudioContext, bus: AudioNode, level = 0) {
    this.gain = ctx.createGain();
    this.gain.gain.value = level;
    this.pan = ctx.createStereoPanner();
    this.gain.connect(this.pan).connect(bus);
  }
  set(level: number, pan: number, now: number, tc = 0.04): void {
    glide(this.gain.gain, level, now, tc);
    glide(this.pan.pan, pan, now, tc);
  }
}

/** A looping noise voice through one filter: tyres, gravel, wind, the boost roar. */
export class NoiseVoice {
  readonly filter: BiquadFilterNode;
  readonly out: Out;
  constructor(ctx: AudioContext, bus: AudioNode, type: BiquadFilterType, freq: number, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    // Start somewhere different in the buffer so voices don't phase against each other.
    src.start(0, Math.random() * 2);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.out = new Out(ctx, bus);
    src.connect(this.filter).connect(this.out.gain);
  }
}

/**
 * An engine: a sawtooth at the fundamental, a square an octave under (the growl), a detuned saw a
 * fifth up, through a low-pass that opens with throttle. Pitch and color are set every frame.
 */
export class EngineVoice {
  private readonly oscs: OscillatorNode[];
  private readonly mix: GainNode[];
  readonly filter: BiquadFilterNode;
  readonly out: Out;
  constructor(ctx: AudioContext, bus: AudioNode) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.out = new Out(ctx, bus);
    this.filter.connect(this.out.gain);
    const parts: [Wave, number][] = [['sawtooth', 0.5], ['square', 0.35], ['sawtooth', 0.18]];
    this.oscs = [];
    this.mix = [];
    for (const [type, level] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(this.filter);
      o.start();
      this.oscs.push(o);
      this.mix.push(g);
    }
  }
  /** `hz` fundamental, `growl` 0–1 (sub and fifth), `bright` the filter cutoff in Hz. */
  set(hz: number, growl: number, bright: number, now: number): void {
    glide(this.oscs[0].frequency, hz, now, 0.03);
    glide(this.oscs[1].frequency, hz / 2, now, 0.03);
    glide(this.oscs[2].frequency, hz * 1.5 * 1.004, now, 0.03);
    glide(this.mix[1].gain, 0.15 + 0.35 * growl, now, 0.1);
    glide(this.mix[2].gain, 0.08 + 0.15 * growl, now, 0.1);
    glide(this.filter.frequency, bright, now, 0.05);
  }
}

/** Where a one-shot goes: its bus, and its level and pan. */
export interface Shot {
  ctx: AudioContext;
  bus: AudioNode;
  gain: number;
  pan: number;
}

/** The end of every one-shot: a gain with an envelope and a panner, torn down when it's done. */
function shotOut(s: Shot, attack: number, decay: number, when = s.ctx.currentTime): GainNode {
  const g = s.ctx.createGain();
  const p = s.ctx.createStereoPanner();
  p.pan.value = s.pan;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, s.gain), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  g.connect(p).connect(s.bus);
  // Disconnect when finished so the graph doesn't grow.
  setTimeout(() => p.disconnect(), (when - s.ctx.currentTime + attack + decay + 0.1) * 1000);
  return g;
}

/** A burst of filtered noise: hits, crunches, glass, whooshes (with a sweep from `f0` to `f1`). */
export function noiseShot(s: Shot, type: BiquadFilterType, f0: number, f1: number, attack: number, decay: number, q = 1, when = s.ctx.currentTime): void {
  const src = s.ctx.createBufferSource();
  src.buffer = noiseBuffer(s.ctx);
  const f = s.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, when);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + attack + decay);
  src.connect(f).connect(shotOut(s, attack, decay, when));
  src.start(when, Math.random() * 1.5);
  src.stop(when + attack + decay + 0.05);
}

/** A tone with a pitch glide from `f0` to `f1`: thumps, beeps, chimes, horns. */
export function toneShot(s: Shot, wave: Wave, f0: number, f1: number, attack: number, decay: number, when = s.ctx.currentTime): void {
  const o = s.ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, when);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + attack + decay);
  o.connect(shotOut(s, attack, decay, when));
  o.start(when);
  o.stop(when + attack + decay + 0.05);
}

/** Semitones above A4 to Hz. */
export const note = (semis: number): number => 440 * 2 ** (semis / 12);
