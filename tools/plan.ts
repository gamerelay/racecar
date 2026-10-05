// A plan of a layout from above, as an SVG (and a PNG with rsvg-convert): the ground shaded by
// height, the sea, every road coloured by its height, its pieces, and marks every 250 m along the
// main road. For laying out a lap in world space and seeing its shape (docs/MAPS.md).
//
//   bun tools/plan.ts coastal/riviera [--out telemetry/plans/coastal-riviera.svg] [--cell 10]
//   bun tools/plan.ts coastal/riviera --at 200,250 --size 500 --cell 3     a square 500 m across, closer up

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, sampleAt } from '../src/core/track/query';
import { args } from './lib/args';
import { SURFACES, layout } from './content';

const a = args();
const cell = a.num('cell') ?? 10;
const at = a.str('at')?.split(',').map(Number);
const size = a.num('size') ?? 500;
const outFlag = a.str('out');
const key = a.rest()[0];
if (!key) {
  console.error('usage: bun tools/plan.ts <map/layout> [--out file.svg] [--cell m]');
  process.exit(2);
}
const def = layout(key);
const track = bakeTrack(def, SURFACES);
const g = track.ground;
const out = outFlag ?? join('telemetry', 'plans', `${key.replace('/', '-')}.svg`);

// The bounds: every road's points, and a margin.
let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
const hit = newHit();
for (const sp of track.splines)
  for (let s = 0; s < sp.length; s += 10) {
    sampleAt(sp, s, hit);
    x0 = Math.min(x0, hit.cx);
    x1 = Math.max(x1, hit.cx);
    z0 = Math.min(z0, hit.cz);
    z1 = Math.max(z1, hit.cz);
  }
const pad = 200;
[x0, x1, z0, z1] = at ? [at[0] - size / 2, at[0] + size / 2, at[1] - size / 2, at[1] + size / 2] : [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
let top = 1;
for (const sp of track.splines)
  for (let s = 0; s < sp.length; s += 10) top = Math.max(top, sampleAt(sp, s, hit).cy);
const sea = def.ground?.sea ?? -Infinity;

/** Land shaded green to brown to white with height; the sea blue, deeper darker. */
const shade = (y: number) => {
  if (y < sea) {
    const d = Math.min(1, (sea - y) / 12);
    return `rgb(${Math.round(90 - 60 * d)},${Math.round(170 - 90 * d)},${Math.round(210 - 60 * d)})`;
  }
  const u = Math.min(1, Math.max(0, y / Math.max(top, 60)));
  const c = u < 0.5 ? [[120, 170, 90], [170, 150, 100]] : [[170, 150, 100], [235, 230, 220]];
  const f = u < 0.5 ? u * 2 : (u - 0.5) * 2;
  return `rgb(${c[0].map((v, k) => Math.round(v + (c[1][k] - v) * f)).join(',')})`;
};
/** A road's colour by its height: blue low, red high. */
const heat = (y: number) => {
  const u = Math.min(1, Math.max(0, y / top));
  return `hsl(${Math.round(220 - 220 * u)},90%,45%)`;
};

const parts: string[] = [];
if (g)
  for (let x = x0; x < x1; x += cell)
    for (let z = z0; z < z1; z += cell) parts.push(`<rect x="${x}" y="${z}" width="${cell + 0.5}" height="${cell + 0.5}" fill="${shade(g.height(x + cell / 2, z + cell / 2))}"/>`);
// Contours every 10 m, as dots where a cell crosses one.
if (g)
  for (let x = x0; x < x1; x += cell / 2)
    for (let z = z0; z < z1; z += cell / 2) {
      const h = g.height(x, z);
      const k = Math.floor(h / 10);
      if (h > sea && k !== Math.floor(g.height(x + cell / 2, z) / 10)) parts.push(`<rect x="${x}" y="${z}" width="2" height="2" fill="rgba(0,0,0,0.25)"/>`);
    }
track.splines.forEach((sp, k) => {
  const step = 4;
  for (let s = 0; s + step <= sp.length; s += step) {
    const a = sampleAt(sp, s, newHit());
    const b = sampleAt(sp, Math.min(sp.length, s + step), newHit());
    parts.push(`<line x1="${a.cx.toFixed(1)}" y1="${a.cz.toFixed(1)}" x2="${b.cx.toFixed(1)}" y2="${b.cz.toFixed(1)}" stroke="${heat(a.cy)}" stroke-width="${k === 0 ? a.width : a.width * 0.7}" stroke-linecap="round"/>`);
  }
});
for (const p of g?.pieces.list ?? []) {
  for (let s = p.s[0]; s < p.s[1]; s += 6) {
    const a = sampleAt(track.main, s, hit);
    parts.push(`<circle cx="${a.cx.toFixed(1)}" cy="${a.cz.toFixed(1)}" r="2" fill="${p.lift ? '#e33' : '#222'}"/>`);
  }
}
for (let s = 0; s < track.main.length; s += 250) {
  sampleAt(track.main, s, hit);
  parts.push(`<circle cx="${hit.cx}" cy="${hit.cz}" r="6" fill="white" stroke="black"/>`);
  parts.push(`<text x="${hit.cx + 9}" y="${hit.cz + 6}" font-size="${Math.round((x1 - x0) / 75)}" font-family="sans-serif" fill="black" stroke="white" stroke-width="0.6">${s} · ${Math.round(hit.cy)}m</text>`);
}
const w = x1 - x0;
const h = z1 - z0;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">${parts.join('')}<text x="${x0 + 20}" y="${z0 + 40}" font-size="32" font-family="sans-serif">${key}: ${Math.round(track.main.length)} m, top ${Math.round(top)} m (north up)</text></svg>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
const png = out.replace(/\.svg$/, '') + '.png';
const r = spawnSync('rsvg-convert', ['-w', '1400', '-o', png, out]);
console.log(r.status === 0 ? png : out);
