// Cars against the world: traffic, hazard pieces and solid props (SPEC §9). All three are
// kinematic: a car bounces off them, they don't move. Also the scoring that comes from traffic:
// near misses, oncoming-lane driving and traffic checks.
//
// Near misses need no memory: a car passed a traffic car this tick if their order along the road
// flipped between last tick and this one, and both positions are known (the car's from the pool,
// the traffic car's from its formula at t − dt).

import { recentAttacker, wreckCar } from '../car/physics';
import { TUNING as T } from '../car/tuning';
import { Cause, Ev } from '../events';
import type { SimState } from '../state';
import { mainDistance, signedGap } from '../track/bake';
import type { Hazards } from '../world/hazards';
import { laneActive, TRAFFIC_KINDS, type Traffic } from '../world/traffic';
import { newContact, obbOverlap } from './obb';

const contact = newContact();

export interface WorldCtx {
  traffic: Traffic;
  hazards: Hazards;
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
  const speed = Math.hypot(c.vx[i], c.vz[i]);
  const ghost = c.ghostT[i] > 0;

  // ---- traffic ----
  for (let p = 0; p < traffic.posed; p++) {
    const k = traffic.idx[p];
    // Wrecked this tick (by a car before this one, or a hazard): gone already.
    if (traffic.wreckedAt[k] === ctx.t) continue;
    const kind = TRAFFIC_KINDS[traffic.kind[k]];
    const ds = signedGap(traffic.s[p], sMain, L);
    if (Math.abs(ds) > 14) continue;
    if (!c.wreck[i] && !ghost && onMain) nearMiss(sim, i, ctx, p, sMain, ds, speed);
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
    // Traffic check: boosting into the back of something small, going the same way.
    const sameWay = traffic.vx[p] * vx + traffic.vz[p] * vz > 0;
    if (c.boosting[i] && sameWay && !kind.big) {
      c.vx[i] = vx * 0.95;
      c.vz[i] = vz * 0.95;
      traffic.wreckedAt[k] = ctx.t;
      c.boost[i] = Math.min(1, c.boost[i] + T.boostFromCheck);
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

  // Oncoming: driving on the side of the road whose lanes come at you.
  if (!c.wreck[i] && onMain && traffic.lanes.length && speed > 28 && c.grounded[i]) {
    const main = sim.track.main;
    const frac = (2 * c.lateral[i]) / Math.max(1, main.width[Math.round(c.s[i] / main.step) % main.n]);
    let best = traffic.lanes[0];
    for (let l = 1; l < traffic.lanes.length; l++) if (Math.abs(traffic.lanes[l].pos - frac) < Math.abs(best.pos - frac)) best = traffic.lanes[l];
    // Only where that lane has traffic: an empty street's wrong side is just a road.
    if (best.dir < 0 && Math.abs(best.pos - frac) < 0.5 && laneActive(best, c.s[i])) {
      if (c.oncomingT[i] === 0) sim.events.push(tick, Ev.Oncoming, i, c.x[i], c.y[i], c.z[i]);
      // Scaled time, like the physics: slow-mo doesn't pay out at full rate.
      const dt = sim.dt * sim.timeScale;
      c.oncomingT[i] += dt;
      c.boost[i] = Math.min(1, c.boost[i] + T.boostFromOncoming * dt);
      c.score[i] += 80 * dt;
    } else c.oncomingT[i] = 0;
  } else c.oncomingT[i] = 0;

  // ---- hazard pieces ----
  for (let p = 0; p < hazards.pieces; p++) {
    if (!hazards.pSolid[p]) continue;
    if (Math.abs(c.x[i] - hazards.px[p]) > 14 || Math.abs(c.z[i] - hazards.pz[p]) > 14) continue;
    if (Math.abs(c.y[i] + 0.5 - hazards.py[p]) > hazards.phh[p] + 1.2) continue;
    if (ghost) continue;
    if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], hazards.px[p], hazards.pz[p], hazards.ph[p], hazards.phw[p], hazards.phl[p], contact)) continue;
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
    const closing = bounce(sim, i, 0, 0, 0.2);
    if (closing <= 0.5 || c.wreck[i]) continue;
    c.wallT[i] = 0.3;
    if (closing > T.wallWreck && !ghost) {
      const by = recentAttacker(sim, i, 60);
      wreckCar(sim, i, Cause.Prop, -contact.nx * closing * 0.3, -contact.nz * closing * 0.3, by);
    } else sim.events.push(tick, Ev.WallHit, i, contact.x, c.y[i] + 0.5, contact.z, closing, 0);
  }
}

function nearMiss(sim: SimState, i: number, ctx: WorldCtx, p: number, sMain: number, ds: number, speed: number): void {
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
  c.boost[i] = Math.min(1, c.boost[i] + (oncoming ? T.boostFromNearMiss * 1.5 : T.boostFromNearMiss));
  c.score[i] += oncoming ? 500 : 250;
  sim.events.push(sim.tick, Ev.NearMiss, i, traffic.x[p], traffic.y[p] + 1, traffic.z[p], gap, oncoming ? 1 : 0, k);
}

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
      if (!hazards.pSolid[p]) continue;
      if (Math.abs(signedGap(s, hazards.pS[p], L)) > 4) continue;
      const lane = traffic.lanes[traffic.lane[k]];
      // Close enough along the road; check across it.
      const at = sim.track.main;
      const idx = Math.round(s / at.step) % at.n;
      const lat = (lane.pos * at.width[idx]) / 2;
      const px = at.px[idx] - at.tz[idx] * lat;
      const pz = at.pz[idx] + at.tx[idx] * lat;
      if (Math.hypot(px - hazards.px[p], pz - hazards.pz[p]) < hazards.phl[p] + 2.5) {
        traffic.wreckedAt[k] = ctx.t;
        sim.events.push(sim.tick, Ev.TrafficWreck, -1, px, at.py[idx], pz, lane.speed, 2, k);
        break;
      }
    }
  }
}
