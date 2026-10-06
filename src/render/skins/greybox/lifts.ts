// Greybox drawbridges (core/world/lifts.ts, PieceDef.lift): two leaves over the span, each hinged
// at its own end and tilted to the sim's angle at the render time (a formula of the clock, like
// traffic), a tower either side of each hinge, and barrier arms and red lights at both ends that
// come down and flash from the warning until it's down again. The deck's road stops at the hinges
// (track.ts, snow.ts): the leaves are the road between them. Its boat (LiftDef.boat), a motor
// yacht, waits at its mooring and sails under the leaves in each lift (core's boatAt).

import { BoxGeometry, type BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimState } from '../../../core/state';
import { newHit, sampleAt } from '../../../core/track/query';
import { boatAt } from '../../../core/world/lifts';
import { INK, markInk } from '../../ink';
import { toon } from './toon';

/** A box `w` × `h` × `d` (x, y, z) with its middle at (x, y, z), painted one colour. */
export function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [c.r, c.g, c.b][k % 3]), 3));
  g.deleteAttribute('uv');
  return g;
}

export const merge = (parts: BufferGeometry[]) => {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
};

/** A leaf's slab under its road (m), and the steel under that. */
const SLAB = 0.6;
const ASPHALT = '#3b3a40';
const STEEL = '#5a6b78';
const WHITE = '#f2efe6';
const YELLOW = '#f2c230';

/** A leaf `len` long from its hinge (local z from 0 to len), `w` wide, its road's top at y 0. */
function leaf(w: number, len: number, lane: number): BufferGeometry {
  const parts = [box(w, SLAB, len, ASPHALT, 0, -SLAB / 2, len / 2), box(w - 1, 1.2, len - 0.5, STEEL, 0, -SLAB - 0.6, len / 2)];
  // Its lines: the edges, and the middle dashed.
  for (const x of [-lane + 0.45, lane - 0.45]) parts.push(box(0.15, 0.04, len, WHITE, x, 0.02, len / 2));
  for (let z = 1; z + 3 < len; z += 10) parts.push(box(0.18, 0.04, 3.5, YELLOW, 0, 0.02, z + 1.75));
  // Red and white bands across its tip, which shows as it rises.
  for (let k = 0; k < 6; k++) parts.push(box(w / 6, 0.5, 0.3, k % 2 ? WHITE : '#c8322b', -w / 2 + (w / 6) * (k + 0.5), -0.25, len - 0.15));
  return merge(parts);
}

/** A hinge's towers, either side of the road, and the counterweight between them under the deck; its barrier posts. */
function towers(w: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * (w / 2 + 1.6);
    parts.push(box(2.6, 16, 3.2, '#d9d0bd', x, 6, -1.2), box(3.2, 1.4, 3.8, '#a33a2c', x, 14.5, -1.2), box(1.4, 1.6, 1.6, '#bdb3a0', x, 15.9, -1.2));
    // The barrier's post, a little back on the approach.
    parts.push(box(0.5, 1.4, 0.5, '#e8e2d2', side * (w / 2 - 0.4), 0.7, -9));
  }
  parts.push(box(w + 6, 2.2, 2.2, '#bdb3a0', 0, 15.2, -1.2), box(w - 1, 4, 5, '#4d5560', 0, -4, -2.5));
  return merge(parts);
}

/** A barrier's arm, from its post across half the road (local x out from 0), striped. */
function arm(len: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = Math.max(2, Math.round(len / 1.2));
  for (let k = 0; k < n; k++) parts.push(box(len / n, 0.25, 0.2, k % 2 ? WHITE : '#c8322b', (len / n) * (k + 0.5), 0, 0));
  return merge(parts);
}

/** A motor yacht, its bow toward local +z, its waterline at y 0. */
function yacht(): BufferGeometry {
  return merge([
    box(5, 1.6, 15, WHITE, 0, 0.3, 0),
    box(3.4, 1.6, 3, WHITE, 0, 0.3, 8.5),
    box(5.1, 0.35, 15.1, '#1d2b4f', 0, 0.7, 0),
    box(4.4, 0.12, 13, '#a87a4f', 0, 1.15, 0),
    box(3.6, 1.5, 6, WHITE, 0, 1.95, -1.5),
    box(3.65, 0.5, 5.5, '#26323d', 0, 2.2, -1.2),
    box(3, 0.9, 3.5, WHITE, 0, 3.15, -2),
    box(0.25, 6, 0.25, '#d8d8d8', 0, 6, -2.5),
    box(0.05, 0.9, 1.4, '#c8322b', 0, 8.4, -3.2),
  ]);
}

export function buildLiftsVisual(sim: SimState): { objects: Object3D[]; update(time: number): void } {
  const lifts = sim.world?.lifts;
  const g = sim.track.ground;
  const objects: Object3D[] = [];
  if (!lifts || !g || !lifts.pieces.length) return { objects, update() {} };
  const material = toon({ vertexColors: true });
  const lamp = toon({ color: 0x441111, emissive: 0xff2a1a, emissiveIntensity: 0 });
  const at = newHit();
  type Bridge = { leaves: Group[]; arms: Group[]; lamps: Mesh[]; boat?: Mesh; mid: { x: number; z: number; rx: number; rz: number } };
  const sea = sim.track.layout.ground?.sea ?? 0;
  const where = { across: 0, dir: 0 };
  const bridges: Bridge[] = [];
  for (let k = 0; k < lifts.pieces.length; k++) {
    const def = lifts.defs[k];
    const half = (def.s[1] - def.s[0]) / 2;
    sampleAt(sim.track.main, (def.s[0] + def.s[1]) / 2, at);
    const b: Bridge = { leaves: [], arms: [], lamps: [], mid: { x: at.cx, z: at.cz, rx: -at.tz, rz: at.tx } };
    if (def.boat) {
      b.boat = new Mesh(yacht(), material);
      markInk(b.boat, INK.trim);
      objects.push(b.boat);
    }
    // Each end: its hinge, facing the middle (the far one turned round).
    for (const [s, back] of [
      [def.s[0], false],
      [def.s[1], true],
    ] as const) {
      sampleAt(sim.track.main, s, at);
      const w = at.width + 2 * at.shoulder;
      const end = new Group();
      end.position.set(at.cx, at.cy, at.cz);
      end.rotation.y = Math.atan2(at.tx, at.tz) + (back ? Math.PI : 0);
      const pivot = new Group();
      pivot.rotation.order = 'YXZ';
      const slab = new Mesh(leaf(w, half, at.width / 2), material);
      markInk(slab, back ? INK.sign : INK.debris);
      pivot.add(slab);
      end.add(pivot);
      const tower = new Mesh(towers(w), material);
      markInk(tower, INK.trim);
      end.add(tower);
      // The arms, one from each post, swinging down across the road.
      for (const side of [-1, 1]) {
        const hinge = new Group();
        hinge.position.set(side * (w / 2 - 0.4), 1.3, -9);
        hinge.rotation.order = 'YXZ';
        hinge.rotation.y = side < 0 ? 0 : Math.PI;
        hinge.add(new Mesh(arm(w / 2 - 0.6), material));
        end.add(hinge);
        b.arms.push(hinge);
        const light = new Mesh(new BoxGeometry(0.45, 0.45, 0.2), lamp);
        light.position.set(side * (w / 2 - 0.4), 1.75, -8.7);
        end.add(light);
        b.lamps.push(light);
      }
      b.leaves.push(pivot);
      objects.push(end);
    }
    bridges.push(b);
  }
  return {
    objects,
    update(time) {
      for (let k = 0; k < bridges.length; k++) {
        const b = bridges[k];
        const a = lifts.angle(k, time);
        for (const p of b.leaves) p.rotation.x = -a;
        const closed = lifts.phase(k, time) !== 'down';
        // Arms down (across the road) from the warning; up (raised) when it's down.
        for (const h of b.arms) h.rotation.z = closed ? 0 : Math.PI / 2.2;
        const on = closed && Math.floor(time * 2) % 2 === 0;
        lamp.emissiveIntensity = on ? 2 : 0;
        if (b.boat) {
          boatAt(lifts.defs[k], lifts.starts[k], time - lifts.origin, where);
          const m = b.mid;
          b.boat.position.set(m.x + m.rx * where.across, sea + 0.15 * Math.sin(time * 1.3 + k), m.z + m.rz * where.across);
          // Bow along its way (moored, toward the far side); a little roll on the swell.
          const way = where.dir || (where.across < 0 ? 1 : -1);
          b.boat.rotation.set(0, Math.atan2(m.rx * way, m.rz * way), 0.03 * Math.sin(time * 0.9 + k));
        }
      }
    },
  };
}
