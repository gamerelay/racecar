// Drive a car somewhere and see what happens (docs/CALDERA.md, "Developer tools"): place it (on a
// road, or at a point), give it inputs (held, scripted, or the AI), run it headless, and get a
// trace and a summary back. What the one-off scripts written while building the Lava Tube's jump
// all did by hand. Dev only: plain objects, allocating freely.

import type { CarClass, SurfaceDef } from '../core/content';
import { neutralControls, type Controls } from '../core/controls';
import { Cause, EV_NAMES, Ev } from '../core/events';
import { Sim } from '../core/sim';
import type { Track } from '../core/track/bake';
import { nearestRoad } from './probe';

const CAUSES: Record<number, string> = Object.fromEntries(Object.entries(Cause).map(([k, v]) => [v, k.toLowerCase()]));

/** Where to put a car: along a road (by id or index; the main road by default), or at a point. */
export interface Spot {
  road?: string | number;
  s?: number;
  lateral?: number;
  x?: number;
  z?: number;
  /** Its height (default: on the road, or on whatever's under the point). */
  y?: number;
  /** Facing back down the road. */
  reverse?: boolean;
}

/** The car's inputs: the AI (hard), controls held throughout, or controls by time (s). */
export type Inputs = 'ai' | Partial<Controls> | ((t: number) => Partial<Controls>);

export interface DriveOptions {
  cls?: string;
  /** Start speed, km/h, along its heading. */
  kmh?: number;
  seconds?: number;
  /** A trace row every this many seconds. */
  every?: number;
  seed?: number;
  /** Other cars (the AI) on the road, and traffic. Default: alone. */
  rivals?: number;
  traffic?: boolean;
}

export interface Row {
  t: number;
  x: number;
  y: number;
  z: number;
  road: string;
  s: number;
  lateral: number;
  kmh: number;
  /** 'deck' or 'ground' on open ground, 'road' otherwise; 'air' off the ground. */
  on: string;
  surface: string;
  wreck: boolean;
}

export interface DriveEvent {
  t: number;
  type: string;
  detail: string;
}

export interface DriveResult {
  rows: Row[];
  events: DriveEvent[];
  summary: {
    seconds: number;
    topKmh: number;
    endKmh: number;
    airSeconds: number;
    wrecks: { t: number; cause: string; road: string; s: number }[];
    start: Row;
    end: Row;
  };
}

/** Which road `road` names: an index, an id, or (undefined) the main road. */
export function roadIndex(track: Track, road: string | number | undefined): number {
  if (road === undefined) return 0;
  if (typeof road === 'number') return road;
  const k = track.splines.findIndex((sp) => sp.id === road);
  if (k < 0) throw new Error(`no road "${road}" (roads: ${track.splines.map((sp) => sp.id).join(', ')})`);
  return k;
}

/** Puts car `i` at `spot`, moving at `kmh` the way it faces. */
export function place(sim: Sim, i: number, spot: Spot, kmh = 0): void {
  const track = sim.track;
  let spline: number;
  let s: number;
  let lateral: number;
  if (spot.x !== undefined && spot.z !== undefined) {
    const near = nearestRoad(track, spot.x, spot.z, spot.y);
    spline = near.spline;
    s = near.s;
    lateral = near.lateral;
  } else {
    spline = roadIndex(track, spot.road);
    s = spot.s ?? 0;
    lateral = spot.lateral ?? 0;
  }
  sim.placeCar(i, spline, s, lateral, 0);
  const c = sim.cars;
  const sp = track.splines[spline];
  const onRoad = Math.abs(lateral) <= (sp.width[Math.min(sp.n - 1, Math.max(0, Math.round(s / sp.step)))] ?? 0) / 2;
  if (spot.y !== undefined) c.y[i] = spot.y;
  else if (track.ground && !onRoad) c.y[i] = track.ground.top(c.x[i], c.z[i]);
  if (spot.reverse) c.h[i] += Math.PI;
  const v = kmh / 3.6;
  c.vx[i] = Math.sin(c.h[i]) * v;
  c.vz[i] = Math.cos(c.h[i]) * v;
  c.py[i] = c.y[i];
  c.ph[i] = c.h[i];
}

/** A sim on `track` with the car to drive (index 0), placed. */
export function setup(track: Track, classes: CarClass[], surfaces: SurfaceDef[], spot: Spot, input: Inputs, opts: DriveOptions = {}): Sim {
  const sim = new Sim(track, classes, surfaces, { seed: opts.seed ?? 7, traffic: opts.traffic ? 1 : 0, mayhem: 'off', weather: 'clear' });
  sim.addCar({ cls: opts.cls ?? 'coupe', human: input !== 'ai', racer: input === 'ai' ? { difficulty: 2 } : undefined });
  for (let k = 0; k < (opts.rivals ?? 0); k++) sim.addCar({ cls: classes[k % classes.length].id, racer: { difficulty: 2 } });
  place(sim, 0, spot, opts.kmh ?? 0);
  return sim;
}

/** Car `i` as a trace row (at time `t`, s). */
export function carRow(sim: Sim, i: number, t = sim.time): Row {
  const c = sim.cars;
  const g = sim.track.ground;
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const under = g ? g.deckUnder(c.x[i], c.z[i], c.y[i]) : NaN;
  return {
    t: r(t),
    x: r(c.x[i]),
    y: r(c.y[i]),
    z: r(c.z[i]),
    road: sim.track.splines[c.spline[i]].id,
    s: r(c.s[i], 1),
    lateral: r(c.lateral[i]),
    kmh: r(Math.hypot(c.vx[i], c.vz[i]) * 3.6, 1),
    on: !c.grounded[i] ? 'air' : !g ? 'road' : under === under ? 'deck' : 'ground',
    surface: sim.surfaces[c.surface[i]]?.id ?? String(c.surface[i]),
    wreck: c.wreck[i] === 1,
  };
}

/** Runs the sim `seconds` with car 0 on `input`, tracing it. */
export function run(sim: Sim, input: Inputs, seconds = 5, every = 0.25): DriveResult {
  const c = sim.cars;
  const controls = neutralControls();
  const inputs: (Controls | undefined)[] = [controls];
  const rows: Row[] = [carRow(sim, 0, 0)];
  const events: DriveEvent[] = [];
  const wrecks: DriveResult['summary']['wrecks'] = [];
  let top = 0;
  let air = 0;
  let cursor = sim.events.read(0, () => {});
  const ticks = Math.round(seconds * 60);
  const stride = Math.max(1, Math.round(every * 60));
  for (let t = 1; t <= ticks; t++) {
    const now = t / 60;
    if (input !== 'ai') Object.assign(controls, neutralControls(), typeof input === 'function' ? input(now) : input);
    sim.step(input === 'ai' ? [] : inputs);
    top = Math.max(top, Math.hypot(c.vx[0], c.vz[0]) * 3.6);
    if (!c.grounded[0]) air += 1 / 60;
    cursor = sim.events.read(cursor, (e) => {
      if (e.car !== 0) return;
      const name = EV_NAMES[e.type] ?? String(e.type);
      if (e.type === Ev.Wreck) {
        const cause = CAUSES[e.b] ?? String(e.b);
        wrecks.push({ t: now, cause, road: sim.track.splines[c.spline[0]].id, s: Math.round(c.s[0]) });
        events.push({ t: now, type: name, detail: cause });
      } else events.push({ t: now, type: name, detail: `a ${+e.a.toFixed(2)}, b ${+e.b.toFixed(2)}` });
    });
    if (t % stride === 0 || t === ticks) rows.push(carRow(sim, 0, now));
  }
  const end = rows[rows.length - 1];
  return { rows, events, summary: { seconds, topKmh: Math.round(top), endKmh: Math.round(end.kmh), airSeconds: Math.round(air * 100) / 100, wrecks, start: rows[0], end } };
}

/** A drive as text: the trace, the events, the summary. */
export function describeDrive(d: DriveResult): string {
  const lines = ['    t        x        y        z  road              s   lateral    km/h  on      surface'];
  for (const r of d.rows)
    lines.push(
      `${r.t.toFixed(2).padStart(5)} ${r.x.toFixed(1).padStart(8)} ${r.y.toFixed(2).padStart(8)} ${r.z.toFixed(1).padStart(8)}  ${r.road.padEnd(14).slice(0, 14)} ${r.s.toFixed(1).padStart(7)} ${r.lateral.toFixed(2).padStart(8)} ${r.kmh.toFixed(1).padStart(7)}  ${r.on.padEnd(7)} ${r.surface}${r.wreck ? '  WRECK' : ''}`,
    );
  // A run of the same event (a car scraping a wall hits it every tick) is one line.
  const runs: { from: number; to: number; type: string; detail: string; n: number }[] = [];
  for (const e of d.events) {
    const last = runs[runs.length - 1];
    if (last && last.type === e.type && e.t - last.to < 0.1 && e.type !== 'wreck') {
      last.to = e.t;
      last.n++;
    } else runs.push({ from: e.t, to: e.t, type: e.type, detail: e.detail, n: 1 });
  }
  if (runs.length)
    lines.push('', 'events:', ...runs.map((r) => (r.n > 1 ? `  ${r.from.toFixed(2)}–${r.to.toFixed(2)} s  ${r.type} ×${r.n}` : `  ${r.from.toFixed(2)} s  ${r.type}  ${r.detail}`)));
  const s = d.summary;
  lines.push('', `summary: ${s.seconds} s, top ${s.topKmh} km/h, end ${s.endKmh} km/h, ${s.airSeconds} s in the air, ${s.wrecks.length ? `wrecks: ${s.wrecks.map((w) => `${w.cause} at ${w.t.toFixed(2)} s (${w.road} s ${w.s})`).join('; ')}` : 'no wrecks'}`);
  lines.push(`ends on ${s.end.road} s ${s.end.s}, lateral ${s.end.lateral}, at (${s.end.x}, ${s.end.y}, ${s.end.z})`);
  return lines.join('\n');
}
