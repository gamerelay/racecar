// Greybox visuals for the world systems: traffic (instanced, one mesh per kind, posed at the exact
// render time since traffic is a formula), wrecked traffic tumbling as cosmetic debris (category L),
// hazard pieces and telegraph markers, sign gantries, and rain.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type Scene,
} from 'three';
import { Ev, type GameEvent } from '../../../core/events';
import { hash01 } from '../../../core/rng';
import type { Sim } from '../../../core/sim';
import { sampleAt, newHit } from '../../../core/track/query';
import { Piece } from '../../../core/world/hazards';
import { TRAFFIC_KINDS, type TrafficPose } from '../../../core/world/traffic';
import type { WorldVisual } from '../../skin';
import { FADE_ATTR, fadeAttribute, fadeMaterial } from '../../fade';
import { markInk, unmarkInk } from '../../ink';
import { LampPoints, lampSpots, trafficModel, trafficModels } from './car/traffic';
import { disposeTree } from './dispose';
import { glow, toon } from './toon';

const TRAFFIC_COLORS = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a, 0xff7b00, 0x9bf6ff, 0xc9c1d9];
const MAX_TRAFFIC = 128;
const DEBRIS = 24;
/** Traffic is drawn within this of the camera (fog has it well before). */
const DRAW = 500;
const UP = new Vector3(0, 1, 0);
/** Traffic kinds drawn as a car design (every kind has one); car/traffic.ts's simple models are the fallback. */
const TRAFFIC_DESIGN: Record<string, string> = { sedan: 'sedan', compact: 'compact', van: 'van', bus: 'bus', truck: 'truck' };

interface Debris {
  kind: number;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  h: number;
  rx: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  life: number;
  ground: number;
}

export function buildWorldVisual(scene: Scene, sim: Sim, roof?: (x: number, z: number) => number): WorldVisual {
  const root = new Group();
  scene.add(root);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Object3D();
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();

  // ---- traffic: each kind as instanced parts, with glowing lamps ----
  // A kind with a racer design is that car, flattened to one instanced mesh per material and ink
  // id; the rest are one simple model. Both have room for the debris too (a wreck tumbles as itself).
  const simple = trafficModels();
  // Each part is two instanced meshes: the solid cars (inked), and a see-through copy for the ones
  // fading in or out of their lanes (render/fade.ts). A mesh with nothing in it this frame is hidden.
  const fading = new Map<Material, Material>();
  const CAP = MAX_TRAFFIC + DEBRIS;
  const instanced = (geometry: BufferGeometry, material: Material, tint: boolean, ink?: number, inkOnly = false) => {
    const solid = new InstancedMesh(geometry, material, CAP);
    if (ink !== undefined) markInk(solid as unknown as Mesh, ink, inkOnly);
    // Ink-only seams have nothing to fade.
    // The simple models' geometry is shared across builds: reuse its fade attribute rather than
    // leaking a new buffer on it every rebuild.
    const had = geometry.getAttribute(FADE_ATTR) as InstancedBufferAttribute | undefined;
    const fade = had && had.count >= CAP ? had : fadeAttribute(CAP);
    geometry.setAttribute(FADE_ATTR, fade);
    const ghost = inkOnly ? undefined : new InstancedMesh(geometry, fadeMaterial(material, fading), CAP);
    for (const m of [solid, ghost]) {
      if (!m) continue;
      m.count = 0;
      m.frustumCulled = false;
      root.add(m);
    }
    return { solid, ghost, tint, fade };
  };
  const bodies = TRAFFIC_KINDS.map((k) => {
    const design = TRAFFIC_DESIGN[k.id];
    const detailed = design ? trafficModel(design, [k.hw, k.hl, k.hh]) : undefined;
    const parts = detailed ? detailed.map((p) => instanced(p.geometry, p.material, p.tint, p.ink, p.inkOnly)) : [instanced(simple.geos[k.id], simple.material, true)];
    return { parts, lamps: lampSpots(k.id) };
  });
  /** Uploads what an instanced mesh got this frame, or hides it if nothing. */
  const commit = (m: InstancedMesh) => {
    m.visible = m.count > 0;
    if (!m.visible) return;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  /** Adds one instance of kind `kind` at `mat`, `fade` of it visible. */
  const put = (kind: number, mat: Matrix4, color: number, fade = 1) => {
    col.setHex(color);
    for (const p of bodies[kind].parts) {
      const m = fade >= 1 ? p.solid : p.ghost;
      if (!m || m.count >= CAP) continue;
      const n = m.count++;
      m.setMatrixAt(n, mat);
      if (p.tint) m.setColorAt(n, col);
      if (m === p.ghost) p.fade.setX(n, fade);
    }
  };
  const lamps = new LampPoints(MAX_TRAFFIC);
  const lampPoints = new Points(lamps.geo, new PointsMaterial({ map: glow(), size: 1.5, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  lampPoints.frustumCulled = false;
  root.add(lampPoints);
  const trafficColor = (k: number) => TRAFFIC_COLORS[Math.floor(hash01(sim.seed, k, 9) * TRAFFIC_COLORS.length)];

  let lit = 0;
  const drawTraffic = (k: number, v: number, pose: TrafficPose) => {
    const tr = sim.world.traffic;
    e.position.set(pose.x, pose.y, pose.z);
    e.rotation.set(0, pose.h, 0);
    e.updateMatrix();
    put(tr.kind[k], e.matrix, trafficColor(k), v);
    // Lamps are glow sprites that can't fade: they come on once the car is mostly there.
    if (v > 0.6 && lit < MAX_TRAFFIC) lamps.write(lit++, e.matrix, bodies[tr.kind[k]].lamps);
  };

  // ---- debris: wrecked traffic, tumbling for a few seconds ----
  const debris: Debris[] = [];
  // Debris tumbles about its middle; the models stand on the road, so lift them by half a height.
  const center = new Matrix4();

  // ---- hazards ----
  const logs = new InstancedMesh(new CylinderGeometry(0.35, 0.35, 4.2, 10).rotateX(Math.PI / 2), toon({ color: 0x8a5a33 }), 64);
  logs.frustumCulled = false;
  logs.count = 0;
  const signs = new InstancedMesh(new BoxGeometry(1, 1, 1), toon({ color: 0x1f7a4a }), 16);
  signs.frustumCulled = false;
  signs.count = 0;
  // A material per ring: each telegraph fades on its own.
  const ringGeo = new RingGeometry(0.8, 1, 32);
  const rings = Array.from({ length: 16 }, () => {
    const r = new Mesh(ringGeo, new MeshBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
    r.rotation.x = -Math.PI / 2;
    r.visible = false;
    root.add(r);
    return r;
  });
  root.add(logs, signs);

  // Gantries for the signs: two posts and a beam over the road.
  const hit = newHit();
  const post = toon({ color: 0x5a5470 });
  for (const def of sim.world.hazards.defs) {
    if (def.use !== 'falling-sign' || typeof def.s !== 'number') continue;
    const at = sampleAt(sim.track.main, def.s - 6, hit);
    const span = at.width / 2 + at.shoulder;
    const g = new Group();
    for (const side of [-1, 1]) {
      const p = new Mesh(new BoxGeometry(0.5, 7.4, 0.5), post);
      p.position.set(side * span, 3.7, 0);
      g.add(p);
    }
    const beam = new Mesh(new BoxGeometry(span * 2, 0.5, 0.5), post);
    beam.position.set(0, 7.2, 0);
    g.add(beam);
    g.position.set(at.cx, at.cy, at.cz);
    // Local x across the road: the road's right is (-tz, tx).
    g.rotation.y = Math.atan2(at.tx, at.tz);
    root.add(g);
  }

  // ---- rain: streaks in a box that follows the camera ----
  const DROPS = 1400;
  const rainPos = new Float32Array(DROPS * 6);
  const rainGeo = new BufferGeometry();
  rainGeo.setAttribute('position', new BufferAttribute(rainPos, 3));
  const rain = new LineSegments(rainGeo, new LineBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.35, depthWrite: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  root.add(rain);
  const seeds = Float32Array.from({ length: DROPS * 3 }, () => Math.random());

  function onEvent(ev: GameEvent): void {
    if (ev.type !== Ev.TrafficWreck) return;
    const k = ev.other;
    const tr = sim.world.traffic;
    const lane = tr.lanes[tr.lane[k]];
    const at = sampleAt(sim.track.main, tr.sAt(k, sim.time), hit);
    const dir = lane.dir;
    if (debris.length >= DEBRIS) debris.shift();
    const kick = 4 + Math.min(20, ev.a * 0.4);
    const carVx = ev.car >= 0 ? sim.cars.vx[ev.car] : 0;
    const carVz = ev.car >= 0 ? sim.cars.vz[ev.car] : 0;
    debris.push({
      kind: tr.kind[k],
      color: trafficColor(k),
      x: ev.x,
      y: ev.y + TRAFFIC_KINDS[tr.kind[k]].hh,
      z: ev.z,
      vx: at.tx * dir * lane.speed * 0.3 + carVx * 0.6 + (Math.random() - 0.5) * 6,
      vy: kick,
      vz: at.tz * dir * lane.speed * 0.3 + carVz * 0.6 + (Math.random() - 0.5) * 6,
      h: Math.atan2(at.tx * dir, at.tz * dir),
      rx: 0,
      rz: 0,
      wx: (Math.random() - 0.5) * 8,
      wy: (Math.random() - 0.5) * 5,
      wz: (Math.random() - 0.5) * 10,
      life: 4,
      ground: at.cy,
    });
  }

  let cursor = sim.events.head;
  return {
    update(dt, cam, time) {
      cursor = sim.events.read(cursor, onEvent);
      const tr = sim.world.traffic;
      // Pose traffic at the render time, like the cars: it's a formula, so it's exactly where it
      // should be between ticks, and so is how visible it is. Everything near the camera is drawn,
      // fading ones dithered; the sim's pool (solid cars near a racer) is for collisions.
      for (const b of bodies) {
        for (const p of b.parts) {
          p.solid.count = 0;
          if (p.ghost) p.ghost.count = 0;
        }
      }
      lit = 0;
      tr.visibleNear(time, cam.x, cam.z, DRAW, drawTraffic);
      lamps.commit(lit);

      // Debris.
      for (let k = debris.length - 1; k >= 0; k--) {
        const d = debris[k];
        d.life -= dt;
        if (d.life <= 0) {
          debris.splice(k, 1);
          continue;
        }
        d.vy -= 24 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.h += d.wy * dt;
        d.rx += d.wx * dt;
        d.rz += d.wz * dt;
        if (d.y < 0.9 + d.ground) {
          d.y = 0.9 + d.ground;
          d.vy *= -0.3;
          d.vx *= 0.7;
          d.vz *= 0.7;
          d.wx *= 0.6;
          d.wz *= 0.6;
        }
      }
      for (const d of debris) {
        e.position.set(d.x, d.y, d.z);
        e.rotation.set(d.rx, d.h, d.rz, 'YXZ');
        e.updateMatrix();
        put(d.kind, e.matrix.multiply(center.makeTranslation(0, -TRAFFIC_KINDS[d.kind].hh, 0)), d.color);
      }
      for (const b of bodies) {
        for (const p of b.parts) {
          commit(p.solid);
          if (p.ghost) commit(p.ghost);
          if (p.ghost?.visible) p.fade.needsUpdate = true;
        }
      }

      // Hazard pieces.
      const hz = sim.world.hazards;
      logs.count = 0;
      signs.count = 0;
      for (let p = 0; p < hz.pieces; p++) {
        pos.set(hz.px[p], hz.py[p], hz.pz[p]);
        if (hz.pType[p] === Piece.Log && logs.count < 64) {
          q.setFromAxisAngle(UP, hz.ph[p]);
          m.compose(pos, q, scl.set(1, 1, hz.phl[p] / 2.1));
          logs.setMatrixAt(logs.count++, m);
        } else if (hz.pType[p] === Piece.Sign && signs.count < 16) {
          e.position.copy(pos);
          e.rotation.set(-hz.pTilt[p], hz.ph[p], 0, 'YXZ');
          e.scale.set(hz.phw[p] * 2, 2.2, 0.3);
          e.updateMatrix();
          signs.setMatrixAt(signs.count++, e.matrix);
          e.scale.set(1, 1, 1);
        }
      }
      logs.instanceMatrix.needsUpdate = true;
      signs.instanceMatrix.needsUpdate = true;
      for (let k = 0; k < rings.length; k++) {
        const r = rings[k];
        r.visible = k < hz.markers;
        if (!r.visible) continue;
        const u = hz.mu[k];
        const pulse = 1 + Math.sin(u * 30) * 0.08;
        r.position.set(hz.mx[k], hz.my[k] + 0.08, hz.mz[k]);
        r.scale.setScalar(hz.mr[k] * pulse);
        (r.material as MeshBasicMaterial).opacity = 0.3 + 0.5 * u;
      }

      // Rain.
      rain.visible = sim.wetness > 0.05;
      if (rain.visible) {
        const box = 60;
        const fall = 40;
        const time = performance.now() / 1000;
        for (let d = 0; d < DROPS; d++) {
          const x = cam.x + (seeds[d * 3] - 0.5) * box;
          const z = cam.z + (seeds[d * 3 + 1] - 0.5) * box;
          const y = cam.y + 25 - ((seeds[d * 3 + 2] * 50 + time * fall) % 50);
          // Under a roof: no rain (a zero-length streak draws nothing).
          const dry = roof !== undefined && roof(x, z) > y - 1.2;
          const j = d * 6;
          rainPos[j] = x;
          rainPos[j + 1] = y;
          rainPos[j + 2] = z;
          rainPos[j + 3] = x + 0.1;
          rainPos[j + 4] = dry ? y : y - 1.2;
          rainPos[j + 5] = z;
        }
        (rainGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (rain.material as LineBasicMaterial).opacity = 0.35 * sim.wetness;
      }
    },
    dispose() {
      scene.remove(root);
      // Out of the ink registry too, or the old traffic meshes stay in its pass forever.
      unmarkInk(root);
      disposeTree([root]);
    },
  };

}
