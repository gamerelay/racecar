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
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
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
import { TRAFFIC_KINDS } from '../../../core/world/traffic';
import type { WorldVisual } from '../../skin';
import { toon } from './toon';

const TRAFFIC_COLORS = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a, 0xff7b00, 0x9bf6ff, 0xc9c1d9];
const MAX_TRAFFIC = 128;
const DEBRIS = 24;

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

export function buildWorldVisual(scene: Scene, sim: Sim): WorldVisual {
  const root = new Group();
  scene.add(root);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Object3D();
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();

  // ---- traffic: body + cabin per kind, instanced ----
  const bodyMat = toon();
  const glassMat = toon({ color: 0x243a66 });
  const bodies = TRAFFIC_KINDS.map((k) => {
    const body = new InstancedMesh(new BoxGeometry(k.hw * 2, k.hh * 1.2, k.hl * 2), bodyMat, MAX_TRAFFIC);
    const cabin = new InstancedMesh(new BoxGeometry(k.hw * 1.8, k.hh * 0.7, k.hl * (k.big ? 1.9 : 1.0)), glassMat, MAX_TRAFFIC);
    body.count = cabin.count = 0;
    body.frustumCulled = cabin.frustumCulled = false;
    root.add(body, cabin);
    return { body, cabin, kind: k };
  });
  const trafficColor = (k: number) => TRAFFIC_COLORS[Math.floor(hash01(sim.seed, k, 9) * TRAFFIC_COLORS.length)];

  // ---- debris: wrecked traffic, tumbling for a few seconds ----
  const debris: Debris[] = [];
  const debrisMeshes = Array.from({ length: DEBRIS }, () => {
    const g = new Mesh(new BoxGeometry(1, 1, 1), toon());
    g.visible = false;
    root.add(g);
    return g;
  });

  // ---- hazards ----
  const logs = new InstancedMesh(new CylinderGeometry(0.35, 0.35, 4.2, 10).rotateX(Math.PI / 2), toon({ color: 0x8a5a33 }), 64);
  logs.frustumCulled = false;
  logs.count = 0;
  const signs = new InstancedMesh(new BoxGeometry(1, 1, 1), toon({ color: 0x1f7a4a }), 16);
  signs.frustumCulled = false;
  signs.count = 0;
  const ringMat = new MeshBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
  const rings = Array.from({ length: 16 }, () => {
    const r = new Mesh(new RingGeometry(0.8, 1, 32), ringMat);
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
    update(dt, cam) {
      cursor = sim.events.read(cursor, onEvent);
      const tr = sim.world.traffic;
      // Pose traffic at the render time: it's a formula, so it's exactly where it should be.
      for (const b of bodies) b.body.count = b.cabin.count = 0;
      for (let p = 0; p < tr.posed; p++) {
        const k = tr.idx[p];
        const kind = TRAFFIC_KINDS[tr.kind[k]];
        const b = bodies[tr.kind[k]];
        e.position.set(tr.x[p], tr.y[p] + kind.hh * 0.6 + 0.35, tr.z[p]);
        e.rotation.set(0, tr.h[p], 0);
        e.updateMatrix();
        const n = b.body.count++;
        b.body.setMatrixAt(n, e.matrix);
        b.body.setColorAt(n, col.setHex(trafficColor(k)));
        e.position.y += kind.hh * 0.9;
        e.position.x += Math.sin(tr.h[p]) * (kind.big ? kind.hl * 0.02 : -kind.hl * 0.1);
        e.position.z += Math.cos(tr.h[p]) * (kind.big ? kind.hl * 0.02 : -kind.hl * 0.1);
        e.updateMatrix();
        b.cabin.setMatrixAt(b.cabin.count++, e.matrix);
      }
      for (const b of bodies) {
        b.body.instanceMatrix.needsUpdate = b.cabin.instanceMatrix.needsUpdate = true;
        if (b.body.instanceColor) b.body.instanceColor.needsUpdate = true;
      }

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
      debrisMeshes.forEach((mesh, k) => {
        const d = debris[k];
        mesh.visible = !!d;
        if (!d) return;
        const kind = TRAFFIC_KINDS[d.kind];
        mesh.position.set(d.x, d.y, d.z);
        mesh.rotation.set(d.rx, d.h, d.rz, 'YXZ');
        mesh.scale.set(kind.hw * 2, kind.hh * 1.6, kind.hl * 2);
        (mesh.material as MeshToonMaterial).color.setHex(d.color);
      });

      // Hazard pieces.
      const hz = sim.world.hazards;
      logs.count = 0;
      signs.count = 0;
      for (let p = 0; p < hz.pieces; p++) {
        pos.set(hz.px[p], hz.py[p], hz.pz[p]);
        if (hz.pType[p] === Piece.Log && logs.count < 64) {
          q.setFromAxisAngle(new Vector3(0, 1, 0), hz.ph[p]);
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
      rings.forEach((r, k) => {
        r.visible = k < hz.markers;
        if (!r.visible) return;
        const u = hz.mu[k];
        const pulse = 1 + Math.sin(u * 30) * 0.08;
        r.position.set(hz.mx[k], hz.my[k] + 0.08, hz.mz[k]);
        r.scale.setScalar(hz.mr[k] * pulse);
        ringMat.opacity = 0.3 + 0.5 * u;
      });

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
          const j = d * 6;
          rainPos[j] = x;
          rainPos[j + 1] = y;
          rainPos[j + 2] = z;
          rainPos[j + 3] = x + 0.1;
          rainPos[j + 4] = y - 1.2;
          rainPos[j + 5] = z;
        }
        (rainGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (rain.material as LineBasicMaterial).opacity = 0.35 * sim.wetness;
      }
    },
  };

}
