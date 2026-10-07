// An island on open ground (docs/PARADISE.md): the sea round it (terrain.ts's, over the ground's
// own grid: turquoise over the sand, foam on the beach), the volcano's crater with its lava lake and
// plume (island.ts's), and the trees the sim collides with (core/track/pines.ts, `tropic`): palms
// along the coast, leaning out to sea, and jungle trees inland, each drawn where its collider
// stands. The rest of the island's dressing stands on open ground only once it's solid too.

import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../../core/rng';
import { coneHeight } from '../../../core/track/island';
import type { Track } from '../../../core/track/bake';
import { TREE_JUNGLE, TREE_PALM } from '../../../core/track/pines';
import type { SeawallDef } from '../../../core/content';
import { hash01 } from '../../../core/rng';
import { newHit, sampleAt } from '../../../core/track/query';
import { glowPoints } from './scenery';
import { instanced, type Part } from './forest';
import { crater, JUNGLE, PALM_LEAVES, palmGeometry, swaying } from './island';
import type { Palette } from './palettes';
import { sea } from './terrain';
import { faceted, toon } from './toon';

export interface OpenIsland {
  objects: Object3D[];
  update(time: number): void;
}

/** The palm model's height (island.ts's palmGeometry): scaled to each tree's. */
const PALM_H = 8.5;

export function buildOpenIsland(track: Track, palette: Palette, seed: number): OpenIsland {
  const g = track.ground!;
  const def = track.layout.ground!;
  const rng = Rng.stream(seed, 'open-island');
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)];
  const time = { value: 0 };
  const objects: Object3D[] = [];
  const seaY = g.sea ?? 0;
  if (g.sea !== undefined) objects.push(sea(seaY, g.x0, g.z0, g.nx, g.nz, g.h, time, palette.seaLight ?? 0xffffff, g.cell, palette.sea));
  // (A shaft's lake fills it to its walls, and its plume rises from the lip, not down in it.)
  const v = def.volcano;
  if (v) objects.push(...crater(v, seaY + v.lava, time, rng, v.pit !== undefined ? v.crater : undefined, v.pit !== undefined ? seaY + coneHeight(v, v.x + v.crater, v.z) : undefined));

  objects.push(...ruts(track));
  const p = track.pines;
  if (p && p.n && def.pines?.look === 'riviera') objects.push(...riviera(track, time, rng), ...promenade(track, time, !!palette.day));
  else if (p && p.n) {
    const palms: Part[] = [];
    const trunks: Part[] = [];
    const crowns: Part[] = [];
    for (let k = 0; k < p.n; k++) {
      const x = p.x[k];
      const z = p.z[k];
      if (p.kind[k] === TREE_PALM) {
        // Leaning out to sea: down the coast's distance.
        const gx = g.coast(x + 2, z) - g.coast(x - 2, z);
        const gz = g.coast(x, z + 2) - g.coast(x, z - 2);
        const yaw = Math.atan2(gz, -gx) + rng.range(-0.4, 0.4);
        const s = p.h[k] / PALM_H;
        palms.push({ x, y: p.y[k] - 0.2, z, yaw, sx: s, sy: s, sz: s, color: pick(PALM_LEAVES) });
      } else if (p.kind[k] === TREE_JUNGLE) {
        const tall = p.h[k] * 0.62;
        const sc = p.h[k] / 9;
        trunks.push({ x, y: p.y[k] - 0.3, z, yaw: 0, sx: sc * 1.4, sy: tall, sz: sc * 1.4, color: 0x6b4a32 });
        crowns.push({ x, y: p.y[k] + tall - 0.5, z, yaw: rng.range(0, 6), sx: sc * rng.range(2.6, 3.4), sy: sc * rng.range(1.8, 2.4), sz: sc * rng.range(2.6, 3.4), color: pick(JUNGLE) });
      }
    }
    const palmGeo = palmGeometry();
    const trunkMat = swaying(time, 0.006);
    trunkMat.color = new Color(0x8a6a44);
    // The trunks keep their own brown (the instance colors are the fronds').
    if (palms.length) objects.push(instanced(palmGeo.trunk, trunkMat, palms.map((q) => ({ ...q, color: 0xffffff }))), instanced(palmGeo.fronds, swaying(time, 0.006), palms));
    if (trunks.length) {
      objects.push(instanced(new CylinderGeometry(0.22, 0.3, 1, 6).translate(0, 0.5, 0), toon(), trunks));
      objects.push(instanced(faceted(new IcosahedronGeometry(1, 0)), swaying(time, 0.01, 3), crowns));
    }
  }
  return {
    objects,
    update(t) {
      time.value = t;
    },
  };
}

/** Umbrella (stone) pines' crowns, dark and a little olive; cypresses', darker still. */
const UMBRELLA = [0x3f5f2e, 0x4b6b34, 0x36552c, 0x56733a];
const CYPRESS = [0x2a4529, 0x30502c, 0x253d26];
/** Holm oaks' crowns: dark, dusty evergreen. */
const OAK = [0x3d5230, 0x465a34, 0x34492b, 0x50643a];
/** Inland, these shares of the trees are cypresses and holm oaks (the rest umbrella pines). */
const CYPRESS_SHARE = 0.2;
const OAK_SHARE = 0.4;

/**
 * A Riviera's trees (PinesDef.look `riviera`), each where its collider stands: along the coast,
 * umbrella pines leaning out to sea on bare trunks; inland, umbrella pines, round holm oaks and
 * tall, dark cypresses. (Umbrella pines alone on the open hills read as a savannah's acacias.)
 */
function riviera(track: Track, time: { value: number }, rng: Rng): Object3D[] {
  const g = track.ground!;
  const p = track.pines!;
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)];
  const trunks: Part[] = [];
  const crowns: Part[] = [];
  const cypresses: Part[] = [];
  const oaks: Part[] = [];
  for (let k = 0; k < p.n; k++) {
    const x = p.x[k];
    const z = p.z[k];
    const y = p.y[k] - 0.3;
    const h = p.h[k];
    const r = p.kind[k] === TREE_PALM ? 1 : rng.next();
    if (r < CYPRESS_SHARE) {
      const w = h * rng.range(0.9, 1.3);
      cypresses.push({ x, y, z, yaw: rng.range(0, 6), sx: w, sy: h * rng.range(1.0, 1.25), sz: w, color: pick(CYPRESS) });
      continue;
    }
    if (r < CYPRESS_SHARE + OAK_SHARE) {
      // A holm oak: a short trunk under a round, full crown, as tall as it's wide or near it.
      const sc = h * rng.range(0.6, 0.75);
      trunks.push({ x, y, z, yaw: 0, sx: 1.5, sy: sc * 0.45, sz: 1.5, color: 0x5e4a3a });
      oaks.push({ x, y: y + sc * 0.62, z, yaw: rng.range(0, 6), sx: sc * rng.range(0.85, 1.05), sy: sc * rng.range(0.6, 0.75), sz: sc * rng.range(0.85, 1.05), color: pick(OAK) });
      continue;
    }
    // Leaning: out to sea by the coast (down the coast's distance), a little any way inland.
    let dx = 0;
    let dz = 0;
    let lean = rng.range(0, 0.12);
    if (p.kind[k] === TREE_PALM) {
      dx = g.coast(x - 2, z) - g.coast(x + 2, z);
      dz = g.coast(x, z - 2) - g.coast(x, z + 2);
      lean = rng.range(0.15, 0.4);
    }
    const yaw = dx || dz ? Math.atan2(dx, dz) + rng.range(-0.3, 0.3) : rng.range(0, 6);
    const tall = h * rng.range(0.5, 0.62);
    trunks.push({ x, y, z, yaw, pitch: lean, sx: 1.3, sy: tall, sz: 1.3, color: 0x7a5a42 });
    const reach = Math.sin(lean) * tall;
    const w = h * rng.range(0.5, 0.62);
    crowns.push({ x: x + Math.sin(yaw) * reach, y: y + Math.cos(lean) * tall - 0.4, z: z + Math.cos(yaw) * reach, yaw: rng.range(0, 6), sx: w, sy: w * rng.range(0.5, 0.6), sz: w * rng.range(0.85, 1.05), color: pick(UMBRELLA) });
  }
  const out: Object3D[] = [];
  if (trunks.length) {
    out.push(instanced(new CylinderGeometry(0.2, 0.32, 1, 6).translate(0, 0.5, 0), toon(), trunks));
    out.push(instanced(umbrellaCrown(), swaying(time, 0.01, 1), crowns));
  }
  if (oaks.length) out.push(instanced(faceted(new IcosahedronGeometry(0.5, 1)), swaying(time, 0.01, 0.5), oaks));
  if (cypresses.length) out.push(instanced(cypressGeometry(), swaying(time, 0.02, 0), cypresses));
  return out;
}

/** An umbrella pine's crown, 1 m wide and flat-topped: a broad dome of a few clumps, its underside flat. */
function umbrellaCrown(): BufferGeometry {
  const parts = [faceted(new IcosahedronGeometry(0.42, 1)).translate(0, 0.12, 0)];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    parts.push(faceted(new IcosahedronGeometry(0.26, 0)).translate(Math.cos(a) * 0.34, -0.05 + 0.08 * (k % 2), Math.sin(a) * 0.34));
  }
  return mergeGeometries(parts);
}

/** A cypress, 1 m tall and a fifth of that wide: a slim dark flame, fullest a quarter of the way up. */
function cypressGeometry(): BufferGeometry {
  return mergeGeometries([faceted(new ConeGeometry(0.1, 0.78, 7).translate(0, 0.58, 0)), faceted(new IcosahedronGeometry(0.1, 0)).scale(1, 1.6, 1).translate(0, 0.2, 0)]);
}

/** Ruts down a packed-sand road (Paradise Open's beach line): two darker tracks this far either side of its middle (m), this wide, a little over the ground. */
const RUTS = { apart: 0.9, width: 0.55, over: 0.04 };

/**
 * Ruts down every road on `packed-sand` (the beach line): two darker tyre tracks, wandering a
 * little, laid on the ground, so the firm line reads across the loose sand round it at speed.
 * Drawn only.
 */
function ruts(track: Track): Object3D[] {
  const id = track.surfaceIndex.get('packed-sand');
  if (id === undefined) return [];
  const g = track.ground!;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const sp of track.splines) {
    if (sp.surface[Math.floor(sp.n / 2)] !== id) continue;
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i < sp.n; i++) {
        const lat = side * RUTS.apart + 0.25 * Math.sin(i * 0.11 + side);
        for (const e of [-RUTS.width / 2, RUTS.width / 2]) {
          const x = sp.px[i] - sp.tz[i] * (lat + e);
          const z = sp.pz[i] + sp.tx[i] * (lat + e);
          pos.push(x, g.height(x, z) + RUTS.over, z);
        }
        if (i < sp.n - 1) idx.push(base + i * 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2, base + i * 2 + 3, base + i * 2 + 2);
      }
    }
  }
  if (!pos.length) return [];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, toon({ color: 0xa88f62, transparent: true, opacity: 0.55, depthWrite: false }));
  mesh.name = 'ruts';
  return [mesh];
}

/** Along a sea wall: a palm, then a lamp, each this far apart (m), on its ledge this far past the parapet's road face. */
const PROMENADE = { every: 26, palm: 2.9, lamp: 1.5 };
/** The lamps: cast iron, painted dark green, with two lanterns on a cross arm. */
const LAMP_IRON = 0x24382e;
const LAMP_GLASS = 0xfff0c0;

/**
 * The promenade (COASTAL's "The Promenade": palms and lamp posts along the seafront): on the ledge
 * behind the parapet of every sea wall (rails.ts's), palms leaning a little out to sea and,
 * between them, two-lantern lamp posts lit at dusk. They stand behind the parapet, where no car
 * reaches, so they're drawn only.
 */
function promenade(track: Track, time: { value: number }, day: boolean): Object3D[] {
  const g = track.ground!;
  const main = track.main;
  const hit = newHit();
  const palms: Part[] = [];
  const posts: Part[] = [];
  const arms: Part[] = [];
  const lanterns: Part[] = [];
  const glow: number[] = [];
  const walls = (track.layout.ground?.features ?? []).filter((f): f is SeawallDef => f.kind === 'seawall');
  for (const w of walls) {
    const side = w.side === 'left' ? -1 : 1;
    const len = (((w.s[1] - w.s[0]) % main.length) + main.length) % main.length;
    for (let d = PROMENADE.every / 2, k = 0; d < len; d += PROMENADE.every / 2, k++) {
      const s = (w.s[0] + d) % main.length;
      const i = Math.round(s / main.step) % main.n;
      // Only where the parapet stands (not across a gap in it).
      if ((side < 0 ? main.wallL : main.wallR)[i] !== 1) continue;
      sampleAt(main, s, hit);
      const out = side * (hit.width / 2 + hit.shoulder + (k % 2 ? PROMENADE.lamp : PROMENADE.palm));
      const x = hit.cx - hit.tz * out;
      const z = hit.cz + hit.tx * out;
      const y = Math.max(g.top(x, z, hit.cy + 1), hit.cy - out * Math.tan(hit.bank)) - 0.05;
      // Facing out to sea, across the road.
      const yaw = Math.atan2(-hit.tz * side, hit.tx * side);
      if (k % 2 === 0) {
        const sc = (7.5 + 2 * hash01(main.index, Math.round(s), 71)) / PALM_H;
        palms.push({ x, y, z, yaw: yaw - Math.PI / 2 + (hash01(main.index, Math.round(s), 73) - 0.5) * 0.8, sx: sc, sy: sc, sz: sc, color: PALM_LEAVES[k % PALM_LEAVES.length] });
      } else {
        posts.push({ x, y, z, yaw: 0, sx: 1, sy: 1, sz: 1, color: LAMP_IRON });
        const ax = Math.cos(yaw);
        const az = -Math.sin(yaw);
        arms.push({ x, y: y + 4.6, z, yaw, sx: 1, sy: 1, sz: 1, color: LAMP_IRON });
        for (const e of [-0.85, 0.85]) {
          lanterns.push({ x: x + ax * e, y: y + 4.35, z: z + az * e, yaw, sx: 1, sy: 1, sz: 1, color: LAMP_GLASS });
          glow.push(x + ax * e, y + 4.35, z + az * e);
        }
      }
    }
  }
  const out: Object3D[] = [];
  if (palms.length) {
    const geo = palmGeometry();
    const trunk = swaying(time, 0.006);
    trunk.color = new Color(0x8a6a44);
    out.push(instanced(geo.trunk, trunk, palms.map((q) => ({ ...q, color: 0xffffff }))), instanced(geo.fronds, swaying(time, 0.006), palms));
  }
  if (posts.length) {
    // A post tapering from a fluted base, a cross arm, and the lanterns hung from its ends.
    const post = mergeGeometries([faceted(new CylinderGeometry(0.22, 0.28, 0.9, 8).translate(0, 0.45, 0)), faceted(new CylinderGeometry(0.07, 0.11, 4.0, 6).translate(0, 2.7, 0)), faceted(new IcosahedronGeometry(0.14, 0)).translate(0, 4.75, 0)]);
    const arm = new CylinderGeometry(0.05, 0.05, 1.8, 5).rotateZ(Math.PI / 2);
    const lantern = mergeGeometries([faceted(new CylinderGeometry(0.16, 0.11, 0.42, 6)), faceted(new ConeGeometry(0.22, 0.2, 6).translate(0, 0.3, 0))]);
    out.push(instanced(post, toon(), posts), instanced(arm, toon(), arms), instanced(lantern, toon(), lanterns));
    if (!day) out.push(glowPoints(glow, LAMP_GLASS, 3));
  }
  return out;
}
