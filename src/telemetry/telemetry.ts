// Telemetry (SPEC §14, "Telemetry pipe"). Reads the sim's event queue after each frame (never in
// the tick), turns it into small typed records, and batches them to a sink: the dev server's
// /__telemetry (local JSONL files Claude can read) in dev builds; PostHog in playtest builds
// (milestone 2). Also keeps what's needed for an F8 report: snapshots every 5 s and every tick's
// inputs, so the last 30 s can be replayed headless (tools/replay.ts).

import { TUNING } from '../core/car/tuning';
import type { TrackLayout } from '../core/content';
import { packControls, type Controls } from '../core/controls';
import { Cause, Ev, type GameEvent } from '../core/events';
import type { CarSpec, Sim, SimOptions, SimSnapshot } from '../core/sim';

export const TELEMETRY_VERSION = 1;

export interface Record {
  t: string;
  /** Sim tick and wall-clock ms. */
  tick: number;
  at: number;
  [k: string]: unknown;
}

export interface Report {
  version: number;
  build: string;
  createdAt: string;
  note: string;
  seed: number;
  /** The sim's options (weather, mayhem, traffic…), so the replay runs the same world. */
  options: SimOptions;
  layout: TrackLayout;
  layoutVersion: string;
  cars: CarSpec[];
  tuning: typeof TUNING;
  /** State at the start of the window, then every tick's packed inputs per human car. */
  start: SimSnapshot;
  inputs: { tick: number; car: number; c: [number, number, number, number] }[];
  /** The focus car's state when F8 was pressed, to check a replay against. */
  end: { tick: number; x: number; z: number; h: number; speed: number };
  records: Record[];
}

const CAUSES: { [k: number]: string } = { [Cause.Wall]: 'wall', [Cause.Car]: 'car', [Cause.OutOfBounds]: 'out_of_bounds', [Cause.Reset]: 'reset', [Cause.SpinOut]: 'spin_out', [Cause.Traffic]: 'traffic', [Cause.Hazard]: 'hazard', [Cause.Prop]: 'prop' };
const SNAP_EVERY = 60 * 5;
const WINDOW = 60 * 30;

export class Telemetry {
  readonly session = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  private cursor = 0;
  private queue: Record[] = [];
  private recent: Record[] = [];
  private lastPerf = 0;
  private lastFlush = 0;
  private frameMs: number[] = [];
  private simMs = 0;
  private snaps: SimSnapshot[] = [];
  private inputs: Report['inputs'] = [];
  private driftStart = new Map<number, number>();
  enabled: boolean;
  trace: boolean;

  constructor(
    private readonly sim: Sim,
    private readonly specs: CarSpec[],
    private readonly getLayout: () => TrackLayout,
    readonly build: string,
    opts: { enabled: boolean; trace: boolean },
  ) {
    this.enabled = opts.enabled;
    this.trace = opts.trace;
    window.addEventListener('pagehide', () => this.flush(true));
  }

  record(t: string, data: { [k: string]: unknown } = {}): void {
    const r: Record = { t, tick: this.sim.tick, at: Date.now(), ...data };
    this.recent.push(r);
    if (this.recent.length > 4000) this.recent.splice(0, 1000);
    if (this.enabled) this.queue.push(r);
  }

  start(device: string): void {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    this.record('session', {
      v: TELEMETRY_VERSION,
      build: this.build,
      ua: navigator.userAgent,
      screen: [screen.width, screen.height, devicePixelRatio],
      gpu: dbg ? gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      device,
      layout: this.getLayout().id,
      layoutVersion: this.sim.track.version,
      cars: this.specs.map((s) => s.cls),
    });
  }

  /** Before each sim step: remember human inputs, and snapshot every 5 s. */
  beforeStep(inputs: readonly (Controls | undefined)[]): void {
    if (this.sim.tick % SNAP_EVERY === 0) {
      this.snaps.push(structuredClone(this.sim.snapshot()));
      while (this.snaps.length > 8) this.snaps.shift();
    }
    for (let i = 0; i < inputs.length; i++) {
      const c = inputs[i];
      if (c) this.inputs.push({ tick: this.sim.tick, car: i, c: packControls(c) });
    }
    const oldest = this.snaps[0]?.tick ?? 0;
    let drop = 0;
    while (drop < this.inputs.length && this.inputs[drop].tick < oldest) drop++;
    if (drop > 0) this.inputs.splice(0, drop);
  }

  /** After each sim step, when tracing: the focus car's full state every tick. */
  afterStep(focus: number, simMs: number): void {
    this.simMs += (simMs - this.simMs) * 0.05;
    if (!this.trace) return;
    const c = this.sim.cars;
    const i = focus;
    this.record('trace', {
      x: r2(c.x[i]), y: r2(c.y[i]), z: r2(c.z[i]), h: r3(c.h[i]), vx: r2(c.vx[i]), vz: r2(c.vz[i]),
      slip: r3(c.slip[i]), yaw: r3(c.yaw[i]), drift: c.drift[i], charge: r2(c.driftCharge[i]), boost: r2(c.boost[i]),
      g: c.grounded[i], s: r1(c.s[i]), lat: r2(c.lateral[i]), surf: c.surface[i],
    });
  }

  /** After each frame: events → records, perf every 5 s, flush every 2 s. */
  frame(dtMs: number, fps: number, drawCalls: number, focus: number): void {
    this.frameMs.push(dtMs);
    this.cursor = this.sim.events.read(this.cursor, (e) => this.onEvent(e, focus));
    const now = performance.now();
    if (now - this.lastPerf > 5000) {
      this.lastPerf = now;
      const sorted = [...this.frameMs].sort((a, b) => a - b);
      const p = (q: number) => r1(sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
      this.record('perf', { fps: r1(fps), p50: p(0.5), p95: p(0.95), p99: p(0.99), simMs: r3(this.simMs), draws: drawCalls, heapMb: heapMb() });
      this.frameMs = [];
    }
    if (now - this.lastFlush > 2000) this.flush();
  }

  /** Errors seen this session, by message and first stack line: a throw in the frame loop repeats every frame. */
  private readonly errorsSeen = new Map<string, number>();

  error(err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    const stack = e.stack?.split('\n').slice(0, 8).join('\n');
    const key = `${e.message}|${e.stack?.split('\n')[1] ?? ''}`;
    const n = (this.errorsSeen.get(key) ?? 0) + 1;
    this.errorsSeen.set(key, n);
    // The first of each, then a count at powers of ten; flushed with the rest, not per error.
    if (n === 1) this.record('error', { message: e.message, stack });
    else if (Number.isInteger(Math.log10(n))) this.record('error_repeat', { message: e.message, count: n });
  }

  private onEvent(e: GameEvent, focus: number): void {
    const c = this.sim.cars;
    const who = { car: e.car, human: c.human[e.car] === 1 };
    switch (e.type) {
      case Ev.Lap:
        this.record('lap', { ...who, time: r3(e.a), lap: e.b });
        break;
      case Ev.Wreck:
        this.record('wreck', { ...who, cause: CAUSES[e.b] ?? e.b, by: e.other, x: r1(e.x), z: r1(e.z), s: r1(c.s[e.car]), spline: c.spline[e.car], impact: r1(e.a) });
        break;
      case Ev.DriftStart:
        this.driftStart.set(e.car, e.tick);
        if (e.car === focus) this.record('drift_start', { ...who, speed: r1(e.a), dir: e.b, s: r1(c.s[e.car]) });
        break;
      case Ev.DriftEnd: {
        const t0 = this.driftStart.get(e.car) ?? e.tick;
        if (e.car === focus) this.record('drift', { ...who, duration: r2(e.a), stage: e.b, ticks: e.tick - t0, s: r1(c.s[e.car]), chain: c.driftChain[e.car] });
        break;
      }
      case Ev.SpinOut:
        this.record('spin_out', { ...who, s: r1(c.s[e.car]) });
        break;
      case Ev.Land:
        if (e.a > 0.3) this.record('air', { ...who, time: r2(e.a), impact: r1(e.b), s: r1(c.s[e.car]) });
        break;
      case Ev.WallHit:
        if (e.car === focus && e.a > 5) this.record('wall', { ...who, impact: r1(e.a), s: r1(c.s[e.car]) });
        break;
      case Ev.CarContact:
        if (e.car === focus || e.other === focus) this.record('contact', { a: e.car, b: e.other, closing: r1(e.a) });
        break;
      case Ev.NearMiss:
        if (e.car === focus) this.record('near_miss', { ...who, gap: r2(e.a), oncoming: e.b === 1, s: r1(c.s[e.car]) });
        break;
      case Ev.TrafficCheck:
        if (e.car === focus) this.record('traffic_check', { ...who, s: r1(c.s[e.car]) });
        break;
      case Ev.Takedown:
        this.record('takedown', { ...who, victim: e.other, revenge: e.b === 1, s: r1(c.s[e.other]) });
        break;
      case Ev.Hazard:
        this.record('hazard', { occurrence: e.a, def: e.b, by: e.car });
        break;
      case Ev.StartBoost:
        if (e.car === focus) this.record('start', { ...who, lead: r2(e.a), boost: e.b === 1 });
        break;
      case Ev.Finish:
        this.record('finish', { ...who, time: r2(e.a), place: e.b, score: Math.round(c.score[e.car]), takedowns: c.takedowns[e.car], wrecks: c.wrecks[e.car] });
        break;
      case Ev.RaceStart:
        this.record('race_start', { laps: this.sim.race.laps, cars: c.count, wet: this.sim.wet, weather: this.sim.weatherPlan, traffic: this.sim.world.traffic.count, mayhem: this.sim.world.hazards.mayhem });
        break;
      default:
        break;
    }
  }

  flush(beacon = false): void {
    this.lastFlush = performance.now();
    if (!this.enabled || this.queue.length === 0) return;
    const lines = this.queue;
    this.queue = [];
    if (this.sink) {
      this.sink(lines, beacon);
      return;
    }
    const body = JSON.stringify({ session: this.session, lines });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/__telemetry', body);
    else fetch('/__telemetry', { method: 'POST', body, keepalive: true }).catch(() => {});
  }

  /** Where records go instead of the dev server (PostHog in playtest builds). */
  sink: ((lines: Record[], beacon: boolean) => void) | null = null;

  /** The last ~30 s, replayable: the oldest snapshot inside the window and every input since. */
  report(note: string, focus: number): Report {
    const tick = this.sim.tick;
    const start = [...this.snaps].reverse().find((s) => s.tick <= tick - WINDOW) ?? this.snaps[0] ?? structuredClone(this.sim.snapshot());
    const c = this.sim.cars;
    return {
      version: TELEMETRY_VERSION,
      build: this.build,
      createdAt: new Date().toISOString(),
      note,
      seed: this.sim.seed,
      options: structuredClone(this.sim.options),
      layout: this.getLayout(),
      layoutVersion: this.sim.track.version,
      cars: this.specs,
      tuning: structuredClone(TUNING),
      start,
      inputs: this.inputs.filter((x) => x.tick >= start.tick),
      end: { tick, x: c.x[focus], z: c.z[focus], h: c.h[focus], speed: Math.hypot(c.vx[focus], c.vz[focus]) },
      records: this.recent.filter((r) => r.tick >= start.tick && r.t !== 'trace'),
    };
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const heapMb = () => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? r1(m.usedJSHeapSize / 1048576) : undefined;
};
