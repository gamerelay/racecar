// Greybox visuals for the world systems: traffic (instanced, one mesh per kind, posed at the exact
// render time since traffic is a formula), wrecked traffic tumbling as cosmetic debris (category L),
// hazard pieces and telegraph markers, sign gantries, rain, snow and sandstorms, and one run's avalanche.

import {
  AdditiveBlending,
  CanvasTexture,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  IcosahedronGeometry,
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
import { newTrafficPose, TRAFFIC_KINDS, type TrafficPose } from '../../../core/world/traffic';
import type { WorldVisual } from '../../skin';
import { FADE_ATTR, fadeAttribute, fadeMaterial } from '../../fade';
import { markInk, unmarkInk } from '../../ink';
import { LampPoints, lampSpots, trafficModel, trafficModels } from './car/traffic';
import { disposeTree } from './dispose';
import { buildBreakablesVisual } from './breakables';
import { buildLiftsVisual } from './lifts';
import { buildSmashVisual } from './smash';
import { glow, toon } from './toon';

const TRAFFIC_COLORS = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a, 0xff7b00, 0x9bf6ff, 0xc9c1d9];
const MAX_TRAFFIC = 128;
const DEBRIS = 24;
/** Traffic is drawn within this of the camera (fog has it well before). */
const DRAW = 500;
/** Traffic nearer than this gets ink outlines (the ink pass's own reach for a single mesh). */
const INK_NEAR = 90;
const UP = new Vector3(0, 1, 0);

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

  // ---- smashables ----
  const smash = buildSmashVisual(sim);
  for (const o of smash.objects) root.add(o);
  const walls = buildBreakablesVisual(sim);
  for (const o of walls.objects) root.add(o);
  const bridges = buildLiftsVisual(sim);
  for (const o of bridges.objects) root.add(o);

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
    // Each kind as the car design of the same id (every kind has one); car/traffic.ts's one-draw
    // simple model if a new kind doesn't yet.
    const detailed = trafficModel(k.id, [k.hw, k.hl, k.hh]);
    const parts = detailed ? detailed.map((p) => instanced(p.geometry, p.material, p.tint, p.ink, p.inkOnly)) : [instanced(simple.geos[k.id], simple.material, true)];
    // (An animal has none.)
    return { parts, lamps: k.animal ? null : lampSpots(k.id) };
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
  /** Per kind, the nearest drawn car's squared distance from the camera this frame (for the ink pass). */
  const near2 = new Float64Array(TRAFFIC_KINDS.length);
  const camNow = new Vector3();
  const drawTraffic = (k: number, v: number, pose: TrafficPose) => {
    const tr = sim.world.traffic;
    const d2 = (pose.x - camNow.x) ** 2 + (pose.z - camNow.z) ** 2;
    if (d2 < near2[tr.kind[k]]) near2[tr.kind[k]] = d2;
    e.position.set(pose.x, pose.y, pose.z);
    // (A car cruising a city's hills, TrafficLaneDef.path: tipped to the street's slope, nose up the hill.)
    let pitch = 0;
    const g = sim.track.ground;
    if (g && tr.routes[tr.lane[k]]?.path) {
      const fx = Math.sin(pose.h) * 2;
      const fz = Math.cos(pose.h) * 2;
      pitch = -Math.atan2(g.height(pose.x + fx, pose.z + fz) - g.height(pose.x - fx, pose.z - fz), 4);
    }
    e.rotation.set(pitch, pose.h, 0, 'YXZ');
    e.updateMatrix();
    put(tr.kind[k], e.matrix, trafficColor(k), v);
    // Lamps are glow sprites that can't fade: they come on once the car is mostly there.
    const spots = bodies[tr.kind[k]].lamps;
    if (spots && v > 0.6 && lit < MAX_TRAFFIC) lamps.write(lit++, e.matrix, spots);
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
  // Volcano bombs: glowing rocks that cool from yellow-hot to dark lava rock once they land, each
  // with a glow while it's hot; they fly in from the crater (hazards.ts gives the height and how
  // far through the flight). Coconuts: green ones, which read on the asphalt (brown ones didn't).
  const bombs = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xffffff }), 32);
  bombs.frustumCulled = false;
  bombs.count = 0;
  bombs.setColorAt(0, col.setHex(0));
  // Dust devils (Sahara's): a funnel of sand, three open cones stacked, narrow at the foot, each
  // turning at its own rate, see-through, and a skirt of dust round its foot; grown and faded with
  // its strength (hazards.ts gives its spin and strength).
  const SWIRL = 140;
  const swirlSeeds = Float32Array.from({ length: SWIRL * 3 }, () => Math.random());
  const devils = Array.from({ length: 6 }, () => {
    const g = new Group();
    const layers = [0, 1, 2].map((n) => {
      // (Darker than the sand it's over, and thick at its foot: pale, it vanished into the dunes.)
      const cone = new Mesh(new CylinderGeometry(1.6 + n * 1.3, 0.5 + n * 1.4, 4, 14, 1, true), new MeshBasicMaterial({ color: [0x9c6f3e, 0xb3844f, 0xc99c66][n], transparent: true, opacity: 0.7 - n * 0.12, side: DoubleSide, depthWrite: false }));
      cone.position.y = 2 + n * 3.4;
      g.add(cone);
      return cone;
    });
    const skirt = new Mesh(new CylinderGeometry(4.5, 3, 1.2, 16, 1, true), new MeshBasicMaterial({ color: 0xa57a48, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false }));
    skirt.position.y = 0.6;
    g.add(skirt);
    // Sand whirled up it: grains spiralling round and up the funnel, wider as they climb, and
    // flung out at the top (placed each frame, in the funnel's own space).
    const swirl = new Points(new BufferGeometry(), new PointsMaterial({ color: 0x8a5e32, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false }));
    swirl.geometry.setAttribute('position', new BufferAttribute(new Float32Array(SWIRL * 3), 3));
    swirl.frustumCulled = false;
    g.add(swirl);
    g.visible = false;
    root.add(g);
    const mats = [...layers, skirt].map((m) => m.material as MeshBasicMaterial);
    return { g, layers, swirl, mats: [...mats, swirl.material as PointsMaterial], base: [...mats.map((m) => m.opacity), 0.9] };
  });
  const nuts = new InstancedMesh(new IcosahedronGeometry(1, 0), toon({ color: 0x9cc23e }), 32);
  nuts.frustumCulled = false;
  nuts.count = 0;
  const heatPos = new Float32Array(32 * 3);
  const heatCol = new Float32Array(32 * 3);
  const heatGeo = new BufferGeometry();
  heatGeo.setAttribute('position', new BufferAttribute(heatPos, 3));
  heatGeo.setAttribute('color', new BufferAttribute(heatCol, 3));
  heatGeo.setDrawRange(0, 0);
  const heatPoints = new Points(heatGeo, new PointsMaterial({ map: glow(), size: 7, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  heatPoints.frustumCulled = false;
  root.add(bombs, nuts, heatPoints);
  const crater = sim.track.layout.terrain?.volcano;
  const HOT = new Color(0xffd24a);
  const WARM = new Color(0xff5a14);
  const COLD = new Color(0x3a3134);

  // Gantries for the signs: two posts and a beam over the road.
  const hit = newHit();
  const wreckPose = newTrafficPose();
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

  // ---- snow (a map whose weather lists snow): flakes drifting down and swaying in a bigger box ----
  const FLAKES = 2600;
  const flakePos = new Float32Array(FLAKES * 3);
  const flakeGeo = new BufferGeometry();
  flakeGeo.setAttribute('position', new BufferAttribute(flakePos, 3));
  // A soft round dot, not the square a point draws by default.
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dctx = dot.getContext('2d');
  if (dctx) {
    const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, 32, 32);
  }
  const flakes = new Points(flakeGeo, new PointsMaterial({ color: 0xffffff, size: 0.3, map: new CanvasTexture(dot), transparent: true, opacity: 0.9, depthWrite: false }));
  flakes.frustumCulled = false;
  flakes.visible = false;
  root.add(flakes);
  const flakeSeeds = Float32Array.from({ length: FLAKES * 3 }, () => Math.random());

  // ---- a sandstorm (a map whose weather lists sand): sand streaking past on the wind, thickest
  // low down, and clouds of dust rolling through it, in a box wrapped round the camera ----
  const GRAINS = 1800;
  const grainPos = new Float32Array(GRAINS * 6);
  const grainGeo = new BufferGeometry();
  grainGeo.setAttribute('position', new BufferAttribute(grainPos, 3));
  const grains = new LineSegments(grainGeo, new LineBasicMaterial({ color: 0xe0b47a, transparent: true, opacity: 0.5, depthWrite: false }));
  grains.frustumCulled = false;
  grains.visible = false;
  root.add(grains);
  const grainSeeds = Float32Array.from({ length: GRAINS * 3 }, () => Math.random());
  const PUFFS = 160;
  const puffPos = new Float32Array(PUFFS * 3);
  const puffGeo = new BufferGeometry();
  puffGeo.setAttribute('position', new BufferAttribute(puffPos, 3));
  const puffs = new Points(puffGeo, new PointsMaterial({ color: 0xc89660, size: 14, map: (flakes.material as PointsMaterial).map, transparent: true, opacity: 0.3, depthWrite: false }));
  puffs.frustumCulled = false;
  puffs.visible = false;
  root.add(puffs);
  const puffSeeds = Float32Array.from({ length: PUFFS * 3 }, () => Math.random());
  /** The storm's wind: from the east-north-east, a little gusty (m/s). */
  const WIND = { x: -0.92, z: -0.38, speed: 26 };

  function onEvent(ev: GameEvent): void {
    if (ev.type !== Ev.TrafficWreck) return;
    const k = ev.other;
    const tr = sim.world.traffic;
    // An animal scatters (a puff of dust, the renderer's from the contact): nothing tumbles.
    if (TRAFFIC_KINDS[tr.kind[k]].animal) return;
    // Its way and speed as it was going (on a side street too).
    const pose = tr.poseAt(k, sim.time, wreckPose);
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
      vx: pose.vx * 0.3 + carVx * 0.6 + (Math.random() - 0.5) * 6,
      vy: kick,
      vz: pose.vz * 0.3 + carVz * 0.6 + (Math.random() - 0.5) * 6,
      h: pose.h,
      rx: 0,
      rz: 0,
      wx: (Math.random() - 0.5) * 8,
      wy: (Math.random() - 0.5) * 5,
      wz: (Math.random() - 0.5) * 10,
      life: 4,
      ground: pose.y,
    });
  }

  // ---- the avalanche (core/world/avalanche.ts): a churning band of snow across the slope at its
  // front, and a powder cloud billowing over and behind it ----
  const BLOBS = 220;
  const CLOUDS = 70;
  // Unlit white, so it reads as snow (shaded, big lumps read as boulders).
  const blobs = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshBasicMaterial({ color: 0xf6f9ff }), BLOBS);
  const clouds = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), CLOUDS);
  for (const m of [blobs, clouds]) {
    m.frustumCulled = false;
    m.visible = false;
    root.add(m);
  }
  const avHit = newHit();
  const avMat = new Matrix4();
  const avQ = new Quaternion();
  const avPos = new Vector3();
  const avScale = new Vector3();
  const AV_UP = new Vector3(0, 1, 0);
  /** Blob `k` of `n`'s place at `front`: across the piste and a way past it, a little behind the front, on the ground. */
  const avPlace = (k: number, seed: number, front: number, back: number, lift: number, size: number, t: number, mesh: InstancedMesh) => {
    const main = sim.track.main;
    const a = sampleAt(main, Math.max(0, front - hash01(seed, k, 1) * back), avHit);
    const lat = (hash01(seed, k, 2) - 0.5) * (a.width + 70);
    const x = a.cx - a.tz * lat;
    const z = a.cz + a.tx * lat;
    const ground = sim.track.ground ? sim.track.ground.height(x, z) : a.cy;
    const r = size * (0.6 + 0.8 * hash01(seed, k, 3)) * (1 + 0.18 * Math.sin(t * (2 + hash01(seed, k, 4) * 3) + k));
    avPos.set(x, ground + r * 0.5 + lift * hash01(seed, k, 5) + Math.abs(Math.sin(t * 2.5 + k)) * 1.2, z);
    avQ.setFromAxisAngle(AV_UP, t * 0.7 + k);
    avScale.setScalar(r);
    avMat.compose(avPos, avQ, avScale);
    mesh.setMatrixAt(k, avMat);
  };

  let cursor = sim.events.head;
  /** The rain's clock: world time, so it hangs in the air while paused. */
  let rainT = 0;
  return {
    update(dt, cam, time) {
      cursor = sim.events.read(cursor, onEvent);
      smash.update(time);
      walls.update(time);
      bridges.update(time);
      // The avalanche, at the render time (it's a formula, like traffic).
      const coming = sim.avalanche && sim.avalancheFront > -Infinity;
      blobs.visible = clouds.visible = !!coming;
      if (coming) {
        const front = sim.avalanche!.front(time - sim.race.goTime);
        if (front > -Infinity) {
          for (let k = 0; k < BLOBS; k++) avPlace(k, 71, front, 26, 5, 2.4, time, blobs);
          for (let k = 0; k < CLOUDS; k++) avPlace(k, 72, front + 6, 70, 16, 8, time * 0.6, clouds);
          blobs.instanceMatrix.needsUpdate = clouds.instanceMatrix.needsUpdate = true;
        } else blobs.visible = clouds.visible = false;
      }
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
      camNow.copy(cam);
      near2.fill(Infinity);
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
        near2[d.kind] = Math.min(near2[d.kind], (d.x - cam.x) ** 2 + (d.z - cam.z) ** 2);
        e.position.set(d.x, d.y, d.z);
        e.rotation.set(d.rx, d.h, d.rz, 'YXZ');
        e.updateMatrix();
        put(d.kind, e.matrix.multiply(center.makeTranslation(0, -TRAFFIC_KINDS[d.kind].hh, 0)), d.color);
      }
      for (const [kind, b] of bodies.entries()) {
        // Ink lines fade out well inside INK_NEAR: a kind with none that close skips the ink pass.
        const inkNear = near2[kind] < INK_NEAR * INK_NEAR;
        for (const p of b.parts) {
          p.solid.userData.inkNear = inkNear;
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
      let dv = 0;
      for (let p = 0; p < hz.pieces && dv < devils.length; p++) {
        if (hz.pType[p] !== Piece.Devil) continue;
        const d = devils[dv++];
        const k = hz.pTilt[p];
        d.g.visible = true;
        d.g.position.set(hz.px[p], hz.py[p], hz.pz[p]);
        d.g.scale.set(hz.phw[p] / 5, 0.4 + 0.6 * k, hz.phw[p] / 5);
        d.layers.forEach((l, n) => (l.rotation.y = hz.ph[p] * (1.5 - n * 0.35)));
        const sp = (d.swirl.geometry.attributes.position as BufferAttribute).array as Float32Array;
        for (let q = 0; q < SWIRL; q++) {
          // Each grain rises up the funnel and round it, over and over (its own phase and pace).
          const a = swirlSeeds[q * 3];
          const b = swirlSeeds[q * 3 + 1];
          const c = swirlSeeds[q * 3 + 2];
          const u = (((a + hz.ph[p] * (0.05 + 0.04 * b)) % 1) + 1) % 1;
          // (Past 0.8 up, flung: out and arcing down.)
          const out = Math.max(0, u - 0.8);
          const y = Math.min(u, 0.8) * 11 + out * 5 - out * out * 60;
          // Out with the cones as it climbs, and past them near the top: flung off.
          const r = 0.8 + Math.min(u, 0.8) * 4.6 + out * 30 * c + (b - 0.5) * 0.8;
          const ang = hz.ph[p] * (2.2 - u) + c * Math.PI * 2;
          sp[q * 3] = Math.cos(ang) * r;
          sp[q * 3 + 1] = y;
          sp[q * 3 + 2] = Math.sin(ang) * r;
        }
        d.swirl.geometry.attributes.position.needsUpdate = true;
        d.mats.forEach((m, n) => (m.opacity = d.base[n] * k));
      }
      for (; dv < devils.length; dv++) devils[dv].g.visible = false;
      bombs.count = 0;
      nuts.count = 0;
      let hot = 0;
      for (let p = 0; p < hz.pieces; p++) {
        if (hz.pType[p] === Piece.Bomb && bombs.count < 32) {
          const f = hz.pTilt[p];
          let x = hz.px[p];
          let z = hz.pz[p];
          if (f < 1 && crater) {
            x = crater.x + (x - crater.x) * f;
            z = crater.z + (z - crater.z) * f;
          }
          // Hot in the air; once down it cools over about 6 s.
          const age = Math.max(0, f - 1);
          const c = age <= 0 ? col.copy(HOT) : age < 1.5 ? col.copy(HOT).lerp(WARM, age / 1.5) : col.copy(WARM).lerp(COLD, Math.min(1, (age - 1.5) / 4.5));
          e.position.set(x, hz.py[p], z);
          e.rotation.set(age <= 0 ? f * 9 : 0.4, hz.ph[p], age <= 0 ? f * 5 : 0.2);
          e.scale.set(hz.phw[p], hz.phh[p], hz.phl[p]);
          e.updateMatrix();
          bombs.setColorAt(bombs.count, c);
          bombs.setMatrixAt(bombs.count++, e.matrix);
          e.scale.set(1, 1, 1);
          if (age < 4 && hot < 32) {
            heatPos.set([x, hz.py[p], z], hot * 3);
            const k = 1 - age / 4;
            heatCol.set([c.r * k, c.g * 0.7 * k, c.b * 0.4 * k], hot * 3);
            hot++;
          }
        } else if (hz.pType[p] === Piece.Coconut && nuts.count < 32) {
          e.position.set(hz.px[p], hz.py[p], hz.pz[p]);
          e.rotation.set(hz.ph[p], hz.ph[p] * 0.7, 0);
          e.scale.set(0.3, 0.28, 0.32);
          e.updateMatrix();
          nuts.setMatrixAt(nuts.count++, e.matrix);
          e.scale.set(1, 1, 1);
        }
      }
      heatGeo.setDrawRange(0, hot);
      if (hot) {
        (heatGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (heatGeo.attributes.color as BufferAttribute).needsUpdate = true;
      }
      bombs.visible = bombs.count > 0;
      if (bombs.visible) {
        bombs.instanceMatrix.needsUpdate = true;
        bombs.instanceColor!.needsUpdate = true;
      }
      nuts.visible = nuts.count > 0;
      if (nuts.visible) nuts.instanceMatrix.needsUpdate = true;
      logs.instanceMatrix.needsUpdate = true;
      signs.instanceMatrix.needsUpdate = true;
      for (let k = 0; k < rings.length; k++) {
        const r = rings[k];
        r.visible = k < hz.markers;
        if (!r.visible) continue;
        const u = hz.mu[k];
        const pulse = 1 + Math.sin(u * 30) * 0.08;
        r.position.set(hz.mx[k], hz.my[k] + 0.2, hz.mz[k]);
        r.scale.setScalar(hz.mr[k] * pulse);
        (r.material as MeshBasicMaterial).opacity = 0.3 + 0.5 * u;
      }

      // Snow, where it snows instead of raining: slow, swaying, and wrapped round the camera so a
      // car at speed drives through it.
      flakes.visible = sim.fall === 'snow' && sim.wetness > 0.05;
      if (flakes.visible) {
        const box = 80;
        rainT += dt;
        const time = rainT;
        for (let d = 0; d < FLAKES; d++) {
          const a = flakeSeeds[d * 3];
          const b = flakeSeeds[d * 3 + 1];
          const c = flakeSeeds[d * 3 + 2];
          const sway = Math.sin(time * (0.6 + a) + c * 40) * 1.2;
          const wrap = (v: number, at: number) => at + ((((v - at) % box) + box * 1.5) % box) - box / 2;
          const j = d * 3;
          flakePos[j] = wrap(a * box * 7 + sway, cam.x);
          flakePos[j + 1] = cam.y + 30 - ((c * 50 + time * (2 + b * 1.5)) % 50);
          flakePos[j + 2] = wrap(b * box * 7 + Math.cos(time * 0.5 + a * 30) * 1.2, cam.z);
        }
        (flakeGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (flakes.material as PointsMaterial).opacity = 0.9 * Math.min(1, sim.wetness * 1.5);
      }

      // A sandstorm: streaks of sand on the wind, low and fast, gusting; dust rolling slower above.
      grains.visible = puffs.visible = sim.fall === 'sand' && sim.wetness > 0.05;
      if (grains.visible) {
        const box = 70;
        rainT += dt;
        const time = rainT;
        const wrap = (v: number, at: number) => at + ((((v - at) % box) + box * 1.5) % box) - box / 2;
        const gust = 1 + 0.25 * Math.sin(time * 0.9) + 0.15 * Math.sin(time * 2.3);
        for (let d = 0; d < GRAINS; d++) {
          const a = grainSeeds[d * 3];
          const b = grainSeeds[d * 3 + 1];
          const c = grainSeeds[d * 3 + 2];
          const run = time * WIND.speed * gust * (0.7 + 0.6 * c);
          const x = wrap(a * box * 9 + WIND.x * run, cam.x);
          const z = wrap(b * box * 9 + WIND.z * run, cam.z);
          // Most of it low, skimming the ground (the camera's a few meters up), some higher.
          const y = cam.y - 3 + c * c * 16 + Math.sin(time * 3 + a * 50) * 0.3;
          const len = 0.8 + c * 1.2;
          const j = d * 6;
          grainPos[j] = x;
          grainPos[j + 1] = y;
          grainPos[j + 2] = z;
          grainPos[j + 3] = x - WIND.x * len;
          grainPos[j + 4] = y + 0.05;
          grainPos[j + 5] = z - WIND.z * len;
        }
        (grainGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (grains.material as LineBasicMaterial).opacity = 0.55 * Math.min(1, sim.wetness * 1.4);
        const big = 160;
        const wrapBig = (v: number, at: number) => at + ((((v - at) % big) + big * 1.5) % big) - big / 2;
        for (let d = 0; d < PUFFS; d++) {
          const a = puffSeeds[d * 3];
          const b = puffSeeds[d * 3 + 1];
          const c = puffSeeds[d * 3 + 2];
          const run = time * WIND.speed * 0.45 * (0.8 + 0.4 * c);
          const j = d * 3;
          puffPos[j] = wrapBig(a * big * 5 + WIND.x * run, cam.x);
          puffPos[j + 1] = cam.y - 2 + c * 14;
          puffPos[j + 2] = wrapBig(b * big * 5 + WIND.z * run, cam.z);
        }
        (puffGeo.attributes.position as BufferAttribute).needsUpdate = true;
        (puffs.material as PointsMaterial).opacity = 0.32 * Math.min(1, sim.wetness * 1.4);
      }

      // Rain.
      rain.visible = sim.fall === 'rain' && sim.wetness > 0.05;
      if (rain.visible) {
        const box = 60;
        const fall = 40;
        rainT += dt;
        const time = rainT;
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
