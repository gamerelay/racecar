// Hazards (SPEC §7). A hazard is a kind in code and instances in the layout. Each occurrence of
// a hazard is a pure function of the time since it started: its pieces follow canned paths, and
// cars bounce off or wreck on them but never push them (category D). Scheduled occurrences
// (random, periodic) come from the seed; triggered ones are started by a car driving through a
// trigger, and scheduled a little in the future (principle 4) so online they start together.
//
// Every tick `update` fills a pool of pieces (what exists right now: logs, a falling sign) and a
// pool of markers (telegraphs: where danger is about to be). Collisions and the renderer read both.

import type { HazardDef } from '../content';
import { Ev, type EventQueue } from '../events';
import { Rng, hash01, hashString } from '../rng';
import { wrap, type Track } from '../track/bake';
import { newHit, sampleAt, type TrackHit } from '../track/query';
import { TRUCK, TRAFFIC_KINDS, type Traffic } from './traffic';
import { atan2, exp, log, sin, tan } from '../math';

export type Mayhem = 'off' | 'normal' | 'chaos';

export interface Occurrence {
  id: number;
  def: number;
  /** When the hazard becomes dangerous; its telegraph starts `telegraph` seconds before. */
  t0: number;
  /** Who set it off (a car index), or -1. */
  by: number;
  seed: number;
  /** Kind-specific: the traffic car involved (log-truck). */
  a: number;
}

export interface HazardKind {
  id: string;
  schedule: 'random' | 'periodic' | 'trigger';
  telegraph: number;
  /** How long an occurrence lasts once dangerous. */
  life(def: HazardDef): number;
  /** Mean or fixed interval for scheduled kinds; re-arm time for triggers. */
  every(def: HazardDef): number;
  /** Adds this occurrence's pieces and markers at time `u` since t0 (negative during the telegraph). */
  at(h: Hazards, occ: Occurrence, u: number): void;
}

/** Piece types, for the renderer. */
export const Piece = { Log: 1, Sign: 2, Bomb: 3, Coconut: 4 } as const;

/** `pSolid`: a piece you bounce off (and wreck on, fast enough), or one you hop over (a coconut). */
export const Solid = { None: 0, Hard: 1, Bump: 2 } as const;

const MAX_PIECES = 256;
const MAX_MARKERS = 64;
/** Triggered hazards start this long after the trigger (online: time for everyone to hear of it). */
export const TRIGGER_LEAD = 0.25;
/** Scheduled occurrences are planned this far ahead. */
const HORIZON = 60 * 30;

export class Hazards {
  readonly defs: HazardDef[];
  readonly kinds: (HazardKind | undefined)[];
  /** Every occurrence: the scheduled ones from the seed, then triggered ones appended as they happen. */
  readonly occurrences: Occurrence[] = [];
  private scheduled = 0;
  /** Triggered occurrences, for snapshots: [def, t0, by, seed]. */
  triggered: [number, number, number, number][] = [];

  // Pieces (this tick).
  pieces = 0;
  readonly pType = new Uint8Array(MAX_PIECES);
  readonly pOcc = new Int32Array(MAX_PIECES);
  readonly px = new Float64Array(MAX_PIECES);
  readonly py = new Float64Array(MAX_PIECES);
  readonly pz = new Float64Array(MAX_PIECES);
  readonly ph = new Float64Array(MAX_PIECES);
  /** Tilt for the renderer (a falling sign); for a bomb, how far through its flight (0–1), then 1 + seconds since it landed. */
  readonly pTilt = new Float64Array(MAX_PIECES);
  readonly phw = new Float64Array(MAX_PIECES);
  readonly phl = new Float64Array(MAX_PIECES);
  readonly phh = new Float64Array(MAX_PIECES);
  readonly pSolid = new Uint8Array(MAX_PIECES);
  /** Closing speed (m/s) above which hitting this piece wrecks you. */
  readonly pWreck = new Float64Array(MAX_PIECES);
  /** Main-spline distance of the piece (for traffic and quick culls). */
  readonly pS = new Float64Array(MAX_PIECES);

  // Markers (this tick): telegraphs.
  markers = 0;
  readonly mx = new Float64Array(MAX_MARKERS);
  readonly my = new Float64Array(MAX_MARKERS);
  readonly mz = new Float64Array(MAX_MARKERS);
  readonly mr = new Float64Array(MAX_MARKERS);
  /** 0 … 1 through the telegraph. */
  readonly mu = new Float64Array(MAX_MARKERS);

  readonly hit: TrackHit = newHit();
  private lastT = 0;

  constructor(
    readonly track: Track,
    readonly traffic: Traffic,
    readonly seed: number,
    readonly mayhem: Mayhem = 'normal',
  ) {
    // A def that names a mayhem is only there at that one (every screen in a room has the same).
    this.defs = mayhem === 'off' ? [] : (track.layout.hazards ?? []).filter((d) => !d.mayhem || d.mayhem === mayhem);
    this.kinds = this.defs.map((d) => KINDS[d.use]);
    const scale = mayhem === 'chaos' ? 0.5 : 1;
    this.defs.forEach((def, d) => {
      const kind = this.kinds[d];
      if (!kind || kind.schedule === 'trigger') return;
      const rng = Rng.stream(seed, `hazard:${d}:${def.use}`);
      let t = kind.schedule === 'periodic' ? rng.range(0, kind.every(def)) : 0;
      for (let n = 0; t < HORIZON && n < 10_000; n++) {
        t += kind.schedule === 'periodic' ? kind.every(def) * scale : -log(1 - rng.next()) * kind.every(def) * scale;
        // Nothing in the first 15 s: let the race settle.
        if (t < 15) continue;
        this.occurrences.push({ id: this.occurrences.length, def: d, t0: t, by: -1, seed: Math.floor(rng.next() * 2147483648), a: -1 });
      }
    });
    this.occurrences.sort((a, b) => a.t0 - b.t0);
    this.occurrences.forEach((o, k) => (o.id = k));
    this.scheduled = this.occurrences.length;
  }

  /** The occurrence's kind. */
  kindOf(o: Occurrence): HazardKind {
    return this.kinds[o.def]!;
  }

  /**
   * A car moved from main distance `prevS` to `s`: fire any armed trigger it crossed.
   * Returns true if one fired.
   */
  crossTriggers(car: number, prevS: number, s: number, t: number, events: EventQueue, tick: number): boolean {
    const L = this.track.main.length;
    let fired = false;
    const step = wrap(s - prevS, L);
    if (step > L / 2 || step === 0) return false;
    for (let d = 0; d < this.defs.length; d++) {
      const def = this.defs[d];
      const kind = this.kinds[d];
      if (!kind || kind.schedule !== 'trigger' || typeof def.s !== 'number') continue;
      if (wrap(def.s - prevS, L) > step) continue;
      // Armed: the last occurrence of this trigger is over and re-armed.
      let armed = true;
      for (let k = this.occurrences.length - 1; k >= this.scheduled; k--) {
        const o = this.occurrences[k];
        if (o.def === d && t < o.t0 + kind.every(def)) armed = false;
      }
      if (!armed) continue;
      const t0 = t + TRIGGER_LEAD + kind.telegraph;
      const seed = hashString(`${this.seed}:${d}:${this.triggered.length}`);
      this.triggered.push([d, t0, car, seed]);
      this.occurrences.push({ id: this.occurrences.length, def: d, t0, by: car, seed, a: -1 });
      events.push(tick, Ev.Hazard, car, 0, 0, 0, this.occurrences.length - 1, d);
      fired = true;
    }
    return fired;
  }

  /** Restores triggered occurrences from a snapshot taken at time t (so telegraphs already under way don't fire again). */
  restoreTriggered(list: [number, number, number, number][], t: number): void {
    this.lastT = t;
    this.occurrences.length = this.scheduled;
    this.triggered = list.map((x) => [...x] as [number, number, number, number]);
    for (const [d, t0, by, seed] of this.triggered) this.occurrences.push({ id: this.occurrences.length, def: d, t0, by, seed, a: -1 });
  }

  /** Rebuilds the piece and marker pools for time t; emits a Hazard event as each scheduled telegraph starts. */
  update(t: number, events: EventQueue, tick: number): void {
    this.pieces = 0;
    this.markers = 0;
    for (let k = 0; k < this.occurrences.length; k++) {
      const o = this.occurrences[k];
      const kind = this.kinds[o.def];
      if (!kind) continue;
      const start = o.t0 - kind.telegraph;
      if (t < start || t > o.t0 + kind.life(this.defs[o.def])) continue;
      if (o.id < this.scheduled && this.lastT < start && t >= start) events.push(tick, Ev.Hazard, -1, 0, 0, 0, o.id, o.def);
      kind.at(this, o, t - o.t0);
    }
    this.lastT = t;
  }

  /** The occurrence that owns piece p. */
  occurrenceOf(p: number): Occurrence {
    return this.occurrences[this.pOcc[p]];
  }

  addPiece(occ: number, type: number, s: number, x: number, y: number, z: number, h: number, hw: number, hl: number, hh: number, solid: boolean | number, wreckSpeed: number, tilt = 0): void {
    if (this.pieces >= MAX_PIECES) return;
    const p = this.pieces++;
    this.pType[p] = type;
    this.pOcc[p] = occ;
    this.px[p] = x;
    this.py[p] = y;
    this.pz[p] = z;
    this.ph[p] = h;
    this.phw[p] = hw;
    this.phl[p] = hl;
    this.phh[p] = hh;
    this.pSolid[p] = solid === true ? Solid.Hard : solid === false ? Solid.None : solid;
    this.pWreck[p] = wreckSpeed;
    this.pTilt[p] = tilt;
    this.pS[p] = s;
  }

  addMarker(x: number, y: number, z: number, r: number, u: number): void {
    if (this.markers >= MAX_MARKERS) return;
    const m = this.markers++;
    this.mx[m] = x;
    this.my[m] = y;
    this.mz[m] = z;
    this.mr[m] = r;
    this.mu[m] = u;
  }
}

/** Whether s is in a def's range (a point is a zero-length range). */
function inRange(s: number, def: HazardDef): boolean {
  const a = typeof def.s === 'number' ? def.s : def.s[0];
  const b = typeof def.s === 'number' ? def.s : def.s[1];
  return a <= b ? s >= a && s <= b : s >= a || s <= b;
}

// ---- Kinds ----

/** A truck in traffic sheds its load: logs bounce off the back and roll to a stop across the lanes. */
const logTruck: HazardKind = {
  id: 'log-truck',
  schedule: 'random',
  telegraph: 1.2,
  life: (def) => def.params?.life ?? 28,
  every: (def) => def.params?.every ?? 40,
  at(h, occ, u) {
    const traffic = h.traffic;
    const def = h.defs[occ.def];
    // The truck: the first truck in traffic inside the range at t0, picked by the formula alone.
    let truck = -1;
    for (let k = 0; k < traffic.count; k++) {
      if (traffic.kind[k] !== TRUCK) continue;
      const s = traffic.sAt(k, occ.t0);
      if (inRange(s, def) && traffic.present(k, occ.t0)) {
        truck = k;
        break;
      }
    }
    if (truck < 0) return;
    const lane = traffic.lanes[traffic.lane[truck]];
    const t = occ.t0 + u;
    if (u < 0) {
      // Telegraph: the load shifts; a marker rides on the truck.
      const s = traffic.sAt(truck, t);
      const at = sampleAt(h.track.main, s, h.hit);
      const lat = (lane.pos * at.width) / 2;
      h.addMarker(at.cx - at.tz * lat, at.cy + 3.2, at.cz + at.tx * lat, 3.5, 1 + u / logTruck.telegraph);
      return;
    }
    const truckS = traffic.sAt(truck, occ.t0);
    const kindHl = TRAFFIC_KINDS[TRUCK].hl;
    const n = def.params?.logs ?? 5;
    for (let j = 0; j < n; j++) {
      const r1 = hash01(occ.seed, j, 1);
      const r2 = hash01(occ.seed, j, 2);
      const r3 = hash01(occ.seed, j, 3);
      // Closed-form roll-out: displacement v·(1 − e^(−kt))/k, so it slows to a stop.
      const k = 0.9 + r3 * 0.4;
      const ease = (1 - exp(-k * u)) / k;
      const vs = lane.dir * lane.speed * (0.45 + r1 * 0.25);
      const vl = (r2 - 0.5) * 9;
      const s = truckS - lane.dir * (kindHl + 0.6 + j * 0.9) + vs * ease;
      const at = sampleAt(h.track.main, s, h.hit);
      const lat0 = (lane.pos * at.width) / 2 + (r3 - 0.5) * 1.2;
      const half = at.width / 2 + at.shoulder - 0.6;
      const lat = Math.max(-half, Math.min(half, lat0 + vl * ease));
      const bounce = 1.6 * Math.abs(sin(u * 5 + j)) * exp(-2.2 * u);
      const roadH = atan2(at.tx, at.tz);
      const heading = roadH + Math.PI / 2 + (r1 - 0.5) * 0.8 + (r2 - 0.5) * 2 * (1 - exp(-k * u));
      h.addPiece(occ.id, Piece.Log, at.s, at.cx - at.tz * lat, at.cy + 0.35 + bounce, at.cz + at.tx * lat, heading, 0.35, 2.1, 0.35, true, 16);
    }
  },
};

/** An overhead sign on a gantry. The first car under it knocks it loose; it drops onto one half of the road behind them. */
const fallingSign: HazardKind = {
  id: 'falling-sign',
  schedule: 'trigger',
  telegraph: 0.5,
  life: (def) => def.params?.life ?? 22,
  every: (def) => def.params?.rearm ?? 35,
  at(h, occ, u) {
    const def = h.defs[occ.def];
    const s = (typeof def.s === 'number' ? def.s : def.s[0]) - 6;
    const at = sampleAt(h.track.main, s, h.hit);
    const side = def.side ?? (hash01(occ.seed, 0, 0) < 0.5 ? -1 : 1);
    const lat = (side * at.width) / 4;
    const x = at.cx - at.tz * lat;
    const z = at.cz + at.tx * lat;
    const heading = atan2(at.tx, at.tz);
    const hw = at.width / 4 - 0.3;
    if (u < 0) {
      h.addMarker(x, at.cy, z, hw, 1 + u / fallingSign.telegraph);
      h.addPiece(occ.id, Piece.Sign, s, x, at.cy + 6.2, z, heading, hw, 0.15, 1.1, false, 0, sin(u * 40) * 0.08);
      return;
    }
    // Falls over half a second, swinging down onto the road, then lies there.
    const f = Math.min(1, u / 0.5);
    const y = at.cy + 6.2 * (1 - f * f) + 0.45 * f * f;
    const tilt = (Math.PI / 2) * f * f;
    h.addPiece(occ.id, Piece.Sign, s, x, y, z, heading, hw, 0.15 + 1.0 * f, 1.1 - 0.7 * f, f > 0.6, 13, tilt);
  },
};

/** How long a volcano bomb is in the air: the telegraph (rings on the road where they'll land). */
const BOMB_FLIGHT = 2;

/**
 * The volcano throws glowing rocks onto the rim road: rings grow where each will land while they
 * arc in from the crater, then they lie on the road as solid, cooling rocks. Scheduled from the
 * seed, so online every screen has them land at the same moment in the same places.
 */
const volcanoBombs: HazardKind = {
  id: 'volcano-bombs',
  schedule: 'random',
  telegraph: BOMB_FLIGHT,
  life: (def) => def.params?.life ?? 10,
  every: (def) => def.params?.every ?? 45,
  at(h, occ, u) {
    const def = h.defs[occ.def];
    const [a, b] = typeof def.s === 'number' ? [def.s - 40, def.s + 40] : def.s;
    const span = wrapSpan(a, b, h.track.main.length);
    const n = def.params?.bombs ?? 3;
    const r = def.params?.size ?? 0.9;
    for (let j = 0; j < n; j++) {
      const land = bombLanding(h, occ, j, n, a, span);
      if (u < 0) {
        const f = 1 + u / BOMB_FLIGHT;
        // In the air: a marker where it'll land, and the rock itself at its height (the renderer
        // draws it along the arc from the crater), not solid yet. The AI steers round it already.
        h.addMarker(land.x, land.y, land.z, r * 2.2, f);
        const y = land.y + r + (1 - f) * (1 - f) * 70 + sin(Math.PI * f) * 30;
        h.addPiece(occ.id, Piece.Bomb, land.s, land.x, y, land.z, land.yaw, r, r, r, false, 0, f);
        continue;
      }
      // `soft`: small rocks (the island's lava rain) you hop over and lose a little speed to, like a coconut.
      const soft = !!def.params?.soft;
      h.addPiece(occ.id, Piece.Bomb, land.s, land.x, land.y + r * 0.7, land.z, land.yaw, r, r, r * 0.8, soft ? Solid.Bump : true, soft ? Infinity : (def.params?.wreck ?? 18), 1 + u);
    }
  },
};

/** How far from a to b along a closed road of length L. */
function wrapSpan(a: number, b: number, L: number): number {
  return b >= a ? b - a : b + L - a;
}

const landing = { s: 0, x: 0, y: 0, z: 0, yaw: 0 };
/** Where bomb j of n lands: each in its own share of the range, somewhere across the road, clear of its edges. */
function bombLanding(h: Hazards, occ: Occurrence, j: number, n: number, a: number, span: number): typeof landing {
  const s = wrap(a + ((j + 0.15 + 0.7 * hash01(occ.seed, j, 11)) * span) / n, h.track.main.length);
  const at = sampleAt(h.track.main, s, h.hit);
  const lat = (hash01(occ.seed, j, 12) - 0.5) * (at.width - 3);
  landing.s = at.s;
  landing.x = at.cx - at.tz * lat;
  landing.z = at.cz + at.tx * lat;
  // The road's surface there, banked (a banked corner's edge is well off the centre's height).
  landing.y = at.cy - lat * tan(at.bank);
  landing.yaw = hash01(occ.seed, j, 13) * Math.PI * 2;
  return landing;
}

/**
 * Coconuts off the palms that lean over the coast road. The first car past shakes them loose;
 * they drop behind it, bounce and roll a little way across the road. Running one over is a hop
 * and a little lost speed, not a wreck.
 */
const coconuts: HazardKind = {
  id: 'coconuts',
  schedule: 'trigger',
  // 0.4 s of rings under the crowns, then the 0.9 s fall (drop, below).
  telegraph: 1.3,
  life: (def) => def.params?.life ?? 16,
  every: (def) => def.params?.rearm ?? 25,
  at(h, occ, u) {
    const def = h.defs[occ.def];
    const s0 = typeof def.s === 'number' ? def.s : def.s[0];
    const side = def.side ?? (hash01(occ.seed, 0, 21) < 0.5 ? -1 : 1);
    const n = 2 + Math.floor(hash01(occ.seed, 0, 22) * 2);
    // They fall from the crowns over the road's edge, onto the half of it under the palms.
    const drop = 0.9;
    for (let j = 0; j < n; j++) {
      const at = sampleAt(h.track.main, s0 + 6 + j * 9 + hash01(occ.seed, j, 23) * 7, h.hit);
      const half = at.width / 2;
      const lat0 = side * (half - 1.5 - hash01(occ.seed, j, 24) * 2);
      const bank = tan(at.bank);
      if (u < -drop) {
        // Shaken loose: a marker under each, the nut still up in the crown.
        h.addMarker(at.cx - at.tz * lat0, at.cy - lat0 * bank, at.cz + at.tx * lat0, 1.2, 1 + u / coconuts.telegraph);
        continue;
      }
      const t = u + drop;
      // Falls 9 m (it lands at u = 0), then rolls in toward the middle, slowing to a stop.
      const fall = Math.max(0, 9 - 11.1 * t * t);
      const roll = u > 0 ? ((1 - exp(-1.4 * u)) / 1.4) * (2 + hash01(occ.seed, j, 25) * 3) : 0;
      const lat = lat0 - side * roll;
      const hop = u > 0 ? 0.5 * Math.abs(sin(u * 7)) * exp(-3 * u) : 0;
      // It spins as it rolls, and stops when the roll does.
      h.addPiece(occ.id, Piece.Coconut, at.s, at.cx - at.tz * lat, at.cy - lat * bank + 0.28 + fall + hop, at.cz + at.tx * lat, j + roll * 2.5, 0.3, 0.3, 0.28, u > 0 ? Solid.Bump : Solid.None, Infinity);
    }
  },
};

/** Every hazard kind a layout can `use`, by id. */
export const KINDS: Record<string, HazardKind> = {
  'log-truck': logTruck,
  'falling-sign': fallingSign,
  'volcano-bombs': volcanoBombs,
  coconuts,
};

