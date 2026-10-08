// Cars against the world: traffic, hazard pieces and solid props (SPEC §9). All three are
// kinematic: a car bounces off them, they don't move. Also the scoring that comes from traffic:
// near misses, oncoming-lane driving and traffic checks.
//
// Near misses need no memory: a car passed a traffic car this tick if their order along the road
// flipped between last tick and this one, and both positions are known (the car's from the pool,
// the traffic car's from its formula at t − dt).

import { earnBoost, recentAttacker, wreckCar } from '../car/physics';
import { TUNING as T } from '../car/tuning';
import { Cause, Ev } from '../events';
import { hash01 } from '../rng';
import type { SimState } from '../state';
import { mainDistance, signedGap } from '../track/bake';
import { DEVIL_PUSH, Solid, type Hazards } from '../world/hazards';
import type { Breakables } from '../world/breakables';
import { SMASH_KINDS, SMASH_OPEN, type Smashables } from '../world/smash';
import { ANIMAL_SLOW, laneActive, newTrafficPose, TRAFFIC_KINDS, type Traffic } from '../world/traffic';
import { collideBreakables } from './breakables';
import { bounce as wallBounce } from './walls';
import { newContact, obbOverlap } from './obb';
import { cos, hypot, sin, wrapAngle } from '../math';

const contact = newContact();

export interface WorldCtx {
  traffic: Traffic;
  hazards: Hazards;
  smash: Smashables;
  breakables: Breakables;
  /** Race time now and last tick. */
  t: number;
  tPrev: number;
  /** Per car: main-spline distance last tick. */
  prevMain: Float64Array;
}

/** Bounces car i off a kinematic box moving at (ovx, ovz); returns the closing speed (0 if separating). */
function bounce(sim: SimState, i: number, ovx: number, ovz: number, restitution: number): number {
  const c = sim.cars;
  const { nx, nz, depth } = contact;
  // Normal points from the car toward the obstacle: push the car back along it.
  c.x[i] -= nx * depth;
  c.z[i] -= nz * depth;
  const closing = (c.vx[i] - ovx) * nx + (c.vz[i] - ovz) * nz;
  if (closing <= 0) return 0;
  c.vx[i] -= (1 + restitution) * closing * nx;
  c.vz[i] -= (1 + restitution) * closing * nz;
  return closing;
}

export function collideWorld(sim: SimState, i: number, ctx: WorldCtx): void {
  const c = sim.cars;
  if (!c.active[i]) return;
  const cls = sim.classes[c.cls[i]];
  const tick = sim.tick;
  const { traffic, hazards } = ctx;
  const L = sim.track.main.length;
  const sMain = mainDistance(sim.track, c.spline[i], c.s[i]);
  const onMain = c.spline[i] === 0;
  const speed = hypot(c.vx[i], c.vz[i]);
  const ghost = c.ghostT[i] > 0;

  // ---- traffic ----
  for (let p = 0; p < traffic.posed; p++) {
    const k = traffic.idx[p];
    // Wrecked this tick (by a car before this one, or a hazard): gone already.
    if (traffic.wreckedAt[k] === ctx.t) continue;
    const kind = TRAFFIC_KINDS[traffic.kind[k]];
    const ds = signedGap(traffic.s[p], sMain, L);
    // (A car along a back street, TrafficLaneDef.road: its main distance is its street's, stretched
    // onto the boulevard, and a car that came over the hill onto the street, never through a
    // junction, is still the boulevard's beside it, up to 36 m apart: by how far apart they are.)
    if (Math.abs(ds) > 14 && (traffic.lanes[traffic.lane[k]].road === undefined || hypot(traffic.x[p] - c.x[i], traffic.z[p] - c.z[i]) > 14)) continue;
    if (!c.wreck[i] && !ghost && onMain) nearMiss(sim, i, ctx, p, ds, speed);
    if (ghost || Math.abs(c.y[i] - traffic.y[p]) > kind.hh * 2 + 0.8) continue;
    if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], traffic.x[p], traffic.z[p], traffic.h[p], kind.hw, kind.hl, contact)) continue;
    const vx = c.vx[i];
    const vz = c.vz[i];
    const closing = bounce(sim, i, traffic.vx[p], traffic.vz[p], 0.25);
    if (closing <= 0.5) continue;
    if (c.wreck[i]) {
      // A tumbling wreck takes the traffic car with it.
      traffic.wreckedAt[k] = ctx.t;
      sim.events.push(tick, Ev.TrafficWreck, i, traffic.x[p], traffic.y[p], traffic.z[p], closing, 0, k);
      continue;
    }
    // An animal (a camel): it scatters, the car a little slower, nobody wrecked.
    if (kind.animal) {
      c.vx[i] = vx * ANIMAL_SLOW;
      c.vz[i] = vz * ANIMAL_SLOW;
      traffic.wreckedAt[k] = ctx.t;
      sim.events.push(tick, Ev.TrafficWreck, i, traffic.x[p], traffic.y[p], traffic.z[p], closing, 0, k);
      continue;
    }
    // Traffic check: boosting into the back of something small, going the same way.
    const sameWay = traffic.vx[p] * vx + traffic.vz[p] * vz > 0;
    if (c.boosting[i] && sameWay && !kind.big) {
      c.vx[i] = vx * 0.95;
      c.vz[i] = vz * 0.95;
      traffic.wreckedAt[k] = ctx.t;
      earnBoost(sim, i, T.boostFromCheck);
      c.score[i] += 800;
      sim.events.push(tick, Ev.TrafficCheck, i, traffic.x[p], traffic.y[p] + 0.8, traffic.z[p], closing, 0, k);
      sim.events.push(tick, Ev.TrafficWreck, i, traffic.x[p], traffic.y[p], traffic.z[p], closing, 1, k);
    } else if (closing > T.trafficWreck) {
      traffic.wreckedAt[k] = ctx.t;
      sim.events.push(tick, Ev.TrafficWreck, i, traffic.x[p], traffic.y[p], traffic.z[p], closing, 0, k);
      const by = recentAttacker(sim, i, 45);
      wreckCar(sim, i, Cause.Traffic, -contact.nx * closing * 0.3, -contact.nz * closing * 0.3, by);
    } else {
      sim.events.push(tick, Ev.CarContact, i, contact.x, c.y[i] + 0.6, contact.z, closing, 0, -1);
    }
  }

  // ---- breakable walls: a wall, or through it ----
  if (ctx.breakables.n) collideBreakables(sim, i, ctx.breakables, ctx.t);

  // ---- smashables: a car through one bursts it (a respawning ghost goes through) ----
  if (!ghost) {
    const sm = ctx.smash;
    const sp = sim.track.splines[c.spline[i]];
    const fx = sin(c.h[i]);
    const fz = cos(c.h[i]);
    for (let k = 0; k < sm.n; k++) {
      // One on open ground by where it is (a car cutting down a hillside is placed on whichever pass
      // of the road it's nearest); one by a road by the car's place along that road.
      if (sm.spline[k] === SMASH_OPEN) {
        if (Math.abs(sm.x[k] - c.x[i]) > 8 || Math.abs(sm.z[k] - c.z[i]) > 8 || !sm.standing(k, ctx.t)) continue;
      } else {
        if (sm.spline[k] !== c.spline[i]) continue;
        const ds = sp.closed ? signedGap(sm.s[k], c.s[i], sp.length) : sm.s[k] - c.s[i];
        if (Math.abs(ds) > 8 || !sm.standing(k, ctx.t)) continue;
      }
      const kind = SMASH_KINDS[sm.kind[k]];
      if (c.y[i] - sm.y[k] > kind.h + 0.3 || sm.y[k] - c.y[i] > 2) continue;
      // The car's box, grown by the prop's radius.
      const dx = sm.x[k] - c.x[i];
      const dz = sm.z[k] - c.z[i];
      if (Math.abs(dx * fx + dz * fz) > cls.size[1] + kind.r || Math.abs(dx * fz - dz * fx) > cls.size[0] + kind.r) continue;
      sm.brokenAt[k] = ctx.t;
      // (No `other`: listeners read it as a car, and the prop's index isn't one.)
      sim.events.push(tick, Ev.Smash, i, sm.x[k], sm.y[k] + kind.h / 2, sm.z[k], speed, sm.kind[k], -1);
      if (c.wreck[i]) continue;
      c.vx[i] *= kind.slow;
      c.vz[i] *= kind.slow;
      earnBoost(sim, i, kind.boost);
      c.score[i] += kind.points;
    }
  }

  // Oncoming: driving on the side of the road whose lanes come at you.
  if (!c.wreck[i] && onMain && traffic.lanes.length && speed > 28 && c.grounded[i]) {
    const main = sim.track.main;
    const frac = (2 * c.lateral[i]) / Math.max(1, main.width[Math.round(c.s[i] / main.step) % main.n]);
    // (Of the main road's lanes: not one along a back street, TrafficLaneDef.road.)
    let best: (typeof traffic.lanes)[number] | null = null;
    for (const lane of traffic.lanes) if (lane.road === undefined && (!best || Math.abs(lane.pos - frac) < Math.abs(best.pos - frac))) best = lane;
    // Only where that lane has traffic: an empty street's wrong side is just a road.
    if (best && best.dir < 0 && Math.abs(best.pos - frac) < 0.5 && laneActive(best, c.s[i])) {
      if (c.oncomingT[i] === 0) sim.events.push(tick, Ev.Oncoming, i, c.x[i], c.y[i], c.z[i]);
      // Scaled time, like the physics: slow-mo doesn't pay out at full rate.
      const dt = sim.dt * sim.timeScale;
      c.oncomingT[i] += dt;
      earnBoost(sim, i, T.boostFromOncoming * dt);
      c.score[i] += 80 * dt;
    } else c.oncomingT[i] = 0;
  } else c.oncomingT[i] = 0;

  // ---- hazard pieces ----
  for (let p = 0; p < hazards.pieces; p++) {
    if (!hazards.pSolid[p]) continue;
    if (Math.abs(c.x[i] - hazards.px[p]) > 14 || Math.abs(c.z[i] - hazards.pz[p]) > 14) continue;
    if (Math.abs(c.y[i] + 0.5 - hazards.py[p]) > hazards.phh[p] + 1.2) continue;
    if (ghost) continue;
    if (hazards.pSolid[p] === Solid.Gust) {
      // A dust devil: shoved round with its wind and out from its middle, turned with it a little.
      const dx = c.x[i] - hazards.px[p];
      const dz = c.z[i] - hazards.pz[p];
      const d = hypot(dx, dz);
      const r = hazards.phw[p];
      if (d >= r || d < 1e-6 || c.wreck[i]) continue;
      const dt = sim.dt * sim.timeScale;
      const push = (hazards.defs[hazards.occurrenceOf(p).def].params?.push ?? DEVIL_PUSH) * (1 - d / r) * hazards.pTilt[p] * dt;
      c.vx[i] += push * ((-dz / d) * 0.8 + (dx / d) * 0.6);
      c.vz[i] += push * ((dx / d) * 0.8 + (dz / d) * 0.6);
      c.h[i] = wrapAngle(c.h[i] + push * 0.02);
      continue;
    }
    if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], hazards.px[p], hazards.pz[p], hazards.ph[p], hazards.phw[p], hazards.phl[p], contact)) continue;
    if (hazards.pSolid[p] === Solid.Bump) {
      // Run over: a hop, a little speed lost and a nudge off line, once (it lands past it).
      if (!c.grounded[i] || c.wreck[i]) continue;
      c.vx[i] *= 0.9;
      c.vz[i] *= 0.9;
      c.vy[i] = Math.max(c.vy[i], 2.4);
      c.grounded[i] = 0;
      c.h[i] += (hash01(hazards.seed, p, tick) - 0.5) * 0.12;
      sim.events.push(tick, Ev.CarContact, i, hazards.px[p], hazards.py[p], hazards.pz[p], 3, 0, -1);
      continue;
    }
    const closing = bounce(sim, i, 0, 0, 0.2);
    if (closing <= 0.5 || c.wreck[i]) continue;
    const occ = hazards.occurrenceOf(p);
    if (closing > hazards.pWreck[p]) {
      // Whoever set the hazard off gets the takedown.
      wreckCar(sim, i, Cause.Hazard, -contact.nx * closing * 0.35, -contact.nz * closing * 0.35, occ.by !== i ? occ.by : -1);
    } else {
      c.vy[i] = Math.max(c.vy[i], closing * 0.25);
      c.grounded[i] = 0;
      sim.events.push(tick, Ev.CarContact, i, contact.x, c.y[i] + 0.5, contact.z, closing, 0, -1);
    }
  }

  // ---- solid props (pillars and the like on the road) ----
  const props = sim.track.props;
  for (let p = 0; p < props.length; p++) {
    const pr = props[p];
    if (!pr.solid) continue;
    if (Math.abs(c.x[i] - pr.x) > pr.hx + pr.hz + 4 || Math.abs(c.z[i] - pr.z) > pr.hx + pr.hz + 4) continue;
    // Only at its own level (a pillar under a bridge doesn't touch the bridge).
    if (c.y[i] < pr.y - 1 || c.y[i] > pr.y + pr.hy * 2) continue;
    if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], pr.x, pr.z, pr.heading, pr.hx, pr.hz, contact)) continue;
    // A building's wall: met as a road's is (scraped along; a ghost bounces too, but never wrecks).
    if (pr.wall) {
      wallBounce(sim, i, contact.nx, contact.nz, contact.depth, cls.size[1], 0);
      continue;
    }
    const closing = bounce(sim, i, 0, 0, 0.2);
    if (closing <= 0.5 || c.wreck[i]) continue;
    c.wallT[i] = 0.3;
    if (closing > T.wallWreck && !ghost) {
      const by = recentAttacker(sim, i, 60);
      wreckCar(sim, i, Cause.Prop, -contact.nx * closing * 0.3, -contact.nz * closing * 0.3, by);
    } else sim.events.push(tick, Ev.WallHit, i, contact.x, c.y[i] + 0.5, contact.z, closing, 0);
  }

  // ---- pines on open ground (track/pines.ts): a trunk like a pillar, and over its top in the air ----
  const pines = sim.track.pines;
  if (pines) {
    const x = c.x[i];
    const z = c.z[i];
    pines.near(x, z, (k) => {
      const r = pines.r[k];
      if (Math.abs(c.x[i] - pines.x[k]) > r + 4 || Math.abs(c.z[i] - pines.z[k]) > r + 4) return;
      if (c.y[i] > pines.y[k] + pines.h[k] || c.y[i] < pines.y[k] - 2) return;
      if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], pines.x[k], pines.z[k], 0, r, r, contact)) return;
      const closing = bounce(sim, i, 0, 0, 0.2);
      if (closing <= 0.5 || c.wreck[i]) return;
      c.wallT[i] = 0.3;
      if (closing > T.wallWreck && !ghost) wreckCar(sim, i, Cause.Prop, -contact.nx * closing * 0.3, -contact.nz * closing * 0.3, recentAttacker(sim, i, 60));
      else sim.events.push(tick, Ev.WallHit, i, contact.x, c.y[i] + 0.5, contact.z, closing, 0);
    });
  }
}

function nearMiss(sim: SimState, i: number, ctx: WorldCtx, p: number, ds: number, speed: number): void {
  const c = sim.cars;
  const { traffic } = ctx;
  if (speed < 22) return;
  const L = sim.track.main.length;
  const k = traffic.idx[p];
  const before = signedGap(traffic.sAt(k, ctx.tPrev), ctx.prevMain[i], L);
  // Order along the road flipped this tick: one passed the other.
  if (Math.sign(before) === Math.sign(ds) || Math.abs(before) > 14) return;
  const kind = TRAFFIC_KINDS[traffic.kind[k]];
  const cls = sim.classes[c.cls[i]];
  const gap = Math.abs(c.lateral[i] - traffic.lat[p]) - kind.hw - cls.size[0];
  if (gap < 0 || gap > T.nearMissGap) return;
  const oncoming = traffic.lanes[traffic.lane[k]].dir < 0;
  earnBoost(sim, i, oncoming ? T.boostFromNearMiss * 1.5 : T.boostFromNearMiss);
  c.score[i] += oncoming ? 500 : 250;
  sim.events.push(sim.tick, Ev.NearMiss, i, traffic.x[p], traffic.y[p] + 1, traffic.z[p], gap, oncoming ? 1 : 0, k);
}

const hazardPose = newTrafficPose();

/**
 * Traffic caught by a hazard's pieces is wrecked on every screen: the check runs over every
 * traffic car near a piece, not only the posed ones, so it doesn't depend on who is nearby.
 */
export function hazardsWreckTraffic(sim: SimState, ctx: WorldCtx): void {
  const { traffic, hazards } = ctx;
  if (!hazards.pieces) return;
  const L = sim.track.main.length;
  for (let k = 0; k < traffic.count; k++) {
    if (!traffic.present(k, ctx.t)) continue;
    const s = traffic.sAt(k, ctx.t);
    for (let p = 0; p < hazards.pieces; p++) {
      if (hazards.pSolid[p] !== Solid.Hard) continue;
      if (Math.abs(signedGap(s, hazards.pS[p], L)) > 4) continue;
      const lane = traffic.lanes[traffic.lane[k]];
      // Close enough along the road; check across it. (A car by side streets may be on one: its pose.)
      const at = sim.track.main;
      const idx = Math.round(s / at.step) % at.n;
      const lat = (lane.pos * at.width[idx]) / 2;
      const routed = traffic.onRoute(k) ? traffic.poseAt(k, ctx.t, hazardPose) : null;
      const px = routed ? routed.x : at.px[idx] - at.tz[idx] * lat;
      const pz = routed ? routed.z : at.pz[idx] + at.tx[idx] * lat;
      if (hypot(px - hazards.px[p], pz - hazards.pz[p]) < hazards.phl[p] + 2.5) {
        traffic.wreckedAt[k] = ctx.t;
        sim.events.push(sim.tick, Ev.TrafficWreck, -1, px, at.py[idx], pz, lane.speed, 2, k);
        break;
      }
    }
  }
}
