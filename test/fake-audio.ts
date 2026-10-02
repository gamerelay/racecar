// A stand-in for Web Audio, enough for audio.ts and music.ts to build their graphs and schedule
// sounds in Bun (which has none). It makes nothing audible: it counts what's made and keeps what
// each oscillator was told, so a test can see which sounds would have played.

type Listener = (e?: unknown) => void;

/** An AudioParam that remembers its value and the values it was scheduled to. */
class FakeParam {
  value = 0;
  readonly scheduled: { v: number; at: number }[] = [];
  setTargetAtTime(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number, at: number) {
    this.value = v;
    this.scheduled.push({ v, at });
  }
  exponentialRampToValueAtTime() {}
}

/** Any node: every param a node of ours reads, connect/disconnect, start/stop. */
export class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly pan = new FakeParam();
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: Listener | null = null;
  /** When `start` was called for (an oscillator or a buffer source), or -1. */
  startedAt = -1;
  constructor(readonly kind: string) {}
  connect<T>(to: T): T {
    return to;
  }
  disconnect() {}
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {}
}

export class FakeAudioContext {
  /** Every context made, newest last. */
  static all: FakeAudioContext[] = [];
  /**
   * The browser holds sound back (no gesture yet): a context starts suspended, and resuming it does
   * nothing. A key press or click on the fake window ends it (fakeBrowser).
   */
  static blocked = false;
  /** A resume takes a while (a real one's audio thread starts a few ms later): it doesn't switch to running at once. */
  static lag = false;
  currentTime = 0;
  readonly sampleRate = 8;
  state: 'running' | 'suspended' = 'running';
  readonly destination = new FakeNode('destination');
  readonly oscillators: FakeNode[] = [];
  readonly sources: FakeNode[] = [];
  resumes = 0;
  constructor() {
    FakeAudioContext.all.push(this);
    if (FakeAudioContext.blocked) this.state = 'suspended';
  }
  createGain() {
    return new FakeNode('gain');
  }
  createStereoPanner() {
    return new FakeNode('panner');
  }
  createBiquadFilter() {
    return new FakeNode('filter');
  }
  createDynamicsCompressor() {
    return new FakeNode('compressor');
  }
  createOscillator() {
    const o = new FakeNode('oscillator');
    this.oscillators.push(o);
    return o;
  }
  createBufferSource() {
    const s = new FakeNode('source');
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { sampleRate, getChannelData: () => data };
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    this.resumes++;
    if (!FakeAudioContext.blocked && !FakeAudioContext.lag) this.state = 'running';
    return Promise.resolve();
  }
  /** Sounds made so far (oscillators and noise), for counting what one frame added. */
  get made(): number {
    return this.oscillators.length + this.sources.length;
  }
}

/** A target that keeps its listeners, so a test can fire them (a key press, a hidden tab). */
export class FakeTarget {
  readonly listeners = new Map<string, Listener[]>();
  hidden = false;
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  fire(type: string, e?: unknown) {
    // A gesture: the browser lets sound start (the listeners run in it).
    if (type === 'keydown' || type === 'pointerup') FakeAudioContext.blocked = false;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

/**
 * Puts `window`, `document` and `AudioContext` on the global object for a test, and returns a
 * function that takes them away again (other test files share the process).
 */
export function fakeBrowser({ autoplay = false } = {}): { window: FakeTarget; document: FakeTarget; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const before = { window: g.window, document: g.document, AudioContext: g.AudioContext };
  const win = new FakeTarget();
  const doc = new FakeTarget();
  g.window = win;
  g.document = doc;
  g.AudioContext = FakeAudioContext;
  FakeAudioContext.all = [];
  // Like most browsers on a first visit: no sound till a gesture, unless `autoplay`.
  FakeAudioContext.blocked = !autoplay;
  FakeAudioContext.lag = false;
  return {
    window: win,
    document: doc,
    restore: () => {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    },
  };
}
