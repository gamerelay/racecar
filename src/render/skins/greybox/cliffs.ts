// A coast's cliffs dressed (the owner, 2026-10-06: the ridge over the Rock Tunnel's gallery was "tall
// and uniform"): on its steep limestone (no volcano), scrub clinging along the beds' ledges (the
// beds are the ground material's, snow.ts's limestone(), by height: the same sine), and now and then
// an outcrop of rock jutting from the face. Scenery only (the sim never sees them): where each one
// is, is a hash of its spot. Instanced, a mesh per chunk of ground.

import { Color, IcosahedronGeometry, type BufferGeometry, type InstancedMesh } from 'three';
import { hash01 } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { noise } from '../../../core/track/ground';
import { newHit, projectGlobal } from '../../../core/track/query';
import { instanced, type Part } from './forest';
import { faceted, toon } from './toon';

/**
 * A candidate every `every` m across the ground, where it's steeper than `steep` (rise per metre:
 * the ground's rock is 1.1) and over the sea; kept with chance `keep` in patches (a noise `patch` m
 * across over `patchy`); an outcrop instead of scrub with chance `rock`. None within `clear` m of a
 * road's edge, nor over a tunnel's mouths or by its gallery (its openings and the ledge under them).
 */
const CLIFF = { every: 2.5, steep: 1.25, keep: 0.45, patch: 30, patchy: 0.3, rock: 0.12, clear: 4, chunk: 200 };
/** Scrub, olive and dry: the maquis. */
const SCRUB = ['#55702f', '#4a6529', '#66793a', '#5d6e33'].map((c) => new Color(c).getHex());
/** Outcrops, the limestone's (snow.ts) a shade either way. */
const ROCKS = ['#b9ad94', '#a89c83', '#c4b8a0'].map((c) => new Color(c).getHex());

/** Where the beds' ledges are: the bands' line in limestone() (snow.ts), at its top edge. */
function ledgeY(x: number, y: number, z: number): number {
  const w = 0.9 * Math.sin(x * 0.045 + 1.7) + 0.9 * Math.sin(z * 0.05);
  // sin(y·1.3 + w) at its rise through 0.2 (the bands' smoothstep's start): the nearest such y.
  const k = Math.round((y * 1.3 + w - 0.2) / (2 * Math.PI));
  return (2 * Math.PI * k + 0.2 - w) / 1.3;
}

export function buildCliffs(track: Track): InstancedMesh[] {
  const g = track.ground;
  const coast = track.layout.ground?.coast;
  if (!g || !coast || track.layout.ground?.volcano) return [];
  const sea = g.sea ?? -Infinity;
  const hit = newHit();
  const tunnels = g.pieces.list.filter((p) => p.spline === track.main.index && p.ceiling > 0 && !p.building);
  const scrub = new Map<string, Part[]>();
  const rocks = new Map<string, Part[]>();
  const span = g.cell * (g.nx - 1);
  const depth = g.cell * (g.nz - 1);
  const e = g.cell;
  let n = 0;
  for (let z = 0; z < depth; z += CLIFF.every)
    for (let x = 0; x < span; x += CLIFF.every, n++) {
      if (hash01(n, 71, 7) > CLIFF.keep) continue;
      let px = g.x0 + x + hash01(n, 72, 7) * CLIFF.every;
      let pz = g.z0 + z + hash01(n, 73, 7) * CLIFF.every;
      if (noise(px, pz, CLIFF.patch, 41) < CLIFF.patchy) continue;
      const gx = (g.height(px + e, pz) - g.height(px - e, pz)) / (2 * e);
      const gz = (g.height(px, pz + e) - g.height(px, pz - e)) / (2 * e);
      const slope = Math.hypot(gx, gz);
      if (slope < CLIFF.steep) continue;
      // Down the face to the nearest ledge (along the slope, by how far it's over it).
      const y0 = g.height(px, pz);
      const yl = ledgeY(px, y0, pz);
      const run = (y0 - yl) / slope;
      if (Math.abs(run) > CLIFF.every) continue;
      px += (gx / slope) * -run;
      pz += (gz / slope) * -run;
      const y = g.height(px, pz);
      if (y < sea + 1) continue;
      // Off every road (and its verge), and clear of a tunnel's mouths and its gallery's side.
      let near = false;
      for (const sp of track.splines) {
        projectGlobal(sp, px, pz, hit);
        if (Math.abs(hit.lateral) < hit.width / 2 + hit.shoulder + CLIFF.clear && Math.abs(y - hit.cy) < 12) near = true;
        if (sp === track.main)
          for (const p of tunnels) {
            const mouth = hit.s > p.s[0] - 15 && hit.s < p.s[0] + 15 ? 1 : hit.s > p.s[1] - 15 && hit.s < p.s[1] + 15 ? 1 : 0;
            const gallery = p.gallery && hit.s > p.gallery.s[0] - 5 && hit.s < p.gallery.s[1] + 5 && hit.lateral * p.gallery.side > 0 && y < hit.cy + p.ceiling + 2;
            if ((mouth && Math.abs(hit.lateral) < 30) || gallery) near = true;
          }
        if (near) break;
      }
      if (near) continue;
      // Into the face along its normal, as far as it reaches out (so it clings, not floats).
      const len = Math.hypot(gx, 1, gz);
      const [nx, ny, nz] = [-gx / len, 1 / len, -gz / len];
      const key = `${Math.floor(px / CLIFF.chunk)},${Math.floor(pz / CLIFF.chunk)}`;
      const yaw = hash01(n, 75, 7) * Math.PI * 2;
      if (hash01(n, 74, 7) < CLIFF.rock) {
        const size = 1.6 + hash01(n, 76, 7) * 2.6;
        const list = rocks.get(key) ?? (rocks.set(key, []), rocks.get(key)!);
        list.push({ x: px - nx * size * 0.35, y: y - ny * size * 0.35, z: pz - nz * size * 0.35, yaw, sx: size * 1.3, sy: size * 0.7, sz: size, color: ROCKS[Math.floor(hash01(n, 77, 7) * ROCKS.length)], pitch: (hash01(n, 78, 7) - 0.5) * 0.6 });
      } else {
        const size = 0.9 + hash01(n, 76, 7) * 1.4;
        const list = scrub.get(key) ?? (scrub.set(key, []), scrub.get(key)!);
        list.push({ x: px + nx * size * 0.2, y: y + ny * size * 0.2 - 0.2, z: pz + nz * size * 0.2, yaw, sx: size * 1.25, sy: size * 0.75, sz: size, color: SCRUB[Math.floor(hash01(n, 77, 7) * SCRUB.length)] });
      }
    }
  const out: InstancedMesh[] = [];
  const add = (geo: BufferGeometry, parts: Map<string, Part[]>) => {
    const mat = toon({});
    for (const list of parts.values()) {
      const mesh = instanced(geo, mat, list);
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
  };
  add(faceted(new IcosahedronGeometry(1, 0)), scrub);
  add(faceted(new IcosahedronGeometry(1, 0)), rocks);
  return out;
}
