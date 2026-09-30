// License plates on the cars (PLAN phase 3): one canvas atlas for every car's plates, the map of
// the cars' shared unlit material (lamps, lenses, plates). A plate is a quad in that same mesh
// whose uvs point at its car's cell, so plates cost no draw calls; everything else in the mesh
// samples the atlas's white half, which leaves its vertex color as it was. Cells are shared by
// identical plates and freed when the last car using one goes.

import { CanvasTexture, SRGBColorSpace } from 'three';
import type { CarPlate } from '../../../skin';

/** One plate's cell, 4:1 like the plates on the cars. */
export const CELL = { w: 256, h: 64 };
const COLS = 2;
const ROWS = 8;
/** Cells fill the top half; the bottom half is white, for the rest of the mesh. */
export const ATLAS = { w: CELL.w * COLS, h: CELL.h * ROWS * 2 };
const SIZE = ATLAS;
export const CELLS = COLS * ROWS;

/** Where in the atlas a vertex that isn't a plate samples: the middle of the white half. */
export const WHITE_UV: readonly [number, number] = [0.5, 0.25];

/** A plate's look per map (its region's colors); others get the stock plate. */
export interface PlateStyle {
  bg: string;
  /** The bevel's light (top) and shade (bottom). */
  light: string;
  shade: string;
  ink: string;
  tag: string;
}
const STYLES: Record<string, PlateStyle> = {
  downtown: { bg: '#eceefb', light: '#ffffff', shade: '#c3c6de', ink: '#1b1f5e', tag: '#e0226f' },
  backroads: { bg: '#fbefc6', light: '#fffbe8', shade: '#dcc98a', ink: '#1f4d2b', tag: '#b3471d' },
  paradise: { bg: '#e9fbf6', light: '#ffffff', shade: '#b4dfd6', ink: '#0b5c6b', tag: '#f0663c' },
};
const STOCK: PlateStyle = { bg: '#e6e2ee', light: '#ffffff', shade: '#bdb7cc', ink: '#231d33', tag: '#5b5470' };

/** What a plate says: its text, the map's name across the top ("DOWNTOWN"), and the map's id for its colors. */
export type Plate = CarPlate;

/** A cell's uv rectangle: u0, v0 (bottom left) to u1, v1. */
export type CellUv = [number, number, number, number];

/** A cell's uvs (the texture is flipped, so canvas row 0 is at the top, v near 1). */
export function cellUv(cell: number): CellUv {
  const c = cell % COLS;
  const r = Math.floor(cell / COLS);
  const u0 = (c * CELL.w) / SIZE.w;
  const u1 = ((c + 1) * CELL.w) / SIZE.w;
  const v1 = 1 - (r * CELL.h) / SIZE.h;
  const v0 = 1 - ((r + 1) * CELL.h) / SIZE.h;
  // Half a texel in from each edge, so filtering never bleeds a neighbour in.
  const du = 0.5 / SIZE.w;
  const dv = 0.5 / SIZE.h;
  return [u0 + du, v0 + dv, u1 - du, v1 - dv];
}

/** Which cells hold which plates, by `text|region|map`, and how many cars use each. */
export class CellTable {
  private readonly byKey = new Map<string, { cell: number; refs: number }>();
  private readonly free: number[];

  constructor(n = CELLS) {
    this.free = Array.from({ length: n }, (_, k) => n - 1 - k);
  }

  /** A cell for `key` (shared if it's already drawn), and whether it needs drawing; null when full. */
  take(key: string): { cell: number; fresh: boolean } | null {
    const had = this.byKey.get(key);
    if (had) {
      had.refs++;
      return { cell: had.cell, fresh: false };
    }
    const cell = this.free.pop();
    if (cell === undefined) return null;
    this.byKey.set(key, { cell, refs: 1 });
    return { cell, fresh: true };
  }

  release(key: string): void {
    const had = this.byKey.get(key);
    if (!had || --had.refs > 0) return;
    this.byKey.delete(key);
    this.free.push(had.cell);
  }

  /** Every plate drawn now, for a redraw once the font arrives. */
  entries(): [string, number][] {
    return [...this.byKey].map(([k, v]) => [k, v.cell]);
  }
}

const keyOf = (p: Plate) => `${p.text}|${p.region}|${p.map}`;

let canvas: HTMLCanvasElement | undefined;
let texture: CanvasTexture | undefined;
const table = new CellTable();
const drawn = new Map<string, Plate>();

/** The atlas texture, made on first use (so importing this needs no DOM). */
export function plateAtlas(): CanvasTexture {
  if (texture) return texture;
  canvas = document.createElement('canvas');
  canvas.width = SIZE.w;
  canvas.height = SIZE.h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, SIZE.w, SIZE.h);
  texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  // The plate font is a web font: once it's in, draw every plate again with it.
  document.fonts?.load(`700 40px 'Chakra Petch'`).then(() => {
    for (const [key, cell] of table.entries()) {
      const p = drawn.get(key);
      if (p) draw(cell, p);
    }
    texture!.needsUpdate = true;
  });
  return texture;
}

/** The cell for a car's plate (drawn if new), or null if the atlas is full. Release it when the car goes. */
export function takePlate(p: Plate): { uv: CellUv; release: () => void } | null {
  plateAtlas();
  const key = keyOf(p);
  const got = table.take(key);
  if (!got) return null;
  if (got.fresh) {
    drawn.set(key, p);
    draw(got.cell, p);
    texture!.needsUpdate = true;
  }
  let released = false;
  return {
    uv: cellUv(got.cell),
    release: () => {
      if (released) return;
      released = true;
      table.release(key);
      if (!table.entries().some(([k]) => k === key)) drawn.delete(key);
    },
  };
}

/** A plate into its cell: a beveled plate with a border, bolts, the region across the top and the text. */
function draw(cell: number, p: Plate): void {
  const g = canvas!.getContext('2d')!;
  const s = STYLES[p.map] ?? STOCK;
  const x = (cell % COLS) * CELL.w;
  const y = Math.floor(cell / COLS) * CELL.h;
  const { w, h } = CELL;
  g.save();
  g.clearRect(x, y, w, h);
  // The pressed tin: a light top edge and a shaded bottom one around the face.
  const bevel = g.createLinearGradient(0, y, 0, y + h);
  bevel.addColorStop(0, s.light);
  bevel.addColorStop(0.5, s.bg);
  bevel.addColorStop(1, s.shade);
  g.fillStyle = bevel;
  g.fillRect(x, y, w, h);
  g.fillStyle = s.bg;
  g.fillRect(x + 4, y + 4, w - 8, h - 8);
  g.strokeStyle = s.ink;
  g.lineWidth = 3;
  g.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
  // Bolts.
  g.fillStyle = s.shade;
  for (const bx of [x + 22, x + w - 22]) {
    g.beginPath();
    g.arc(bx, y + 14, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = s.tag;
  g.font = `700 11px 'Chakra Petch', 'Arial Narrow', sans-serif`;
  g.fillText(p.region.toUpperCase().split('').join(String.fromCharCode(8202)), x + w / 2, y + 15);
  g.fillStyle = s.ink;
  g.font = `700 40px 'Chakra Petch', 'Arial Narrow', monospace`;
  // Squeezed to fit seven characters, like real plate lettering.
  const tw = g.measureText(p.text).width;
  const room = w - 36;
  g.translate(x + w / 2, y + h / 2 + 7);
  if (tw > room) g.scale(room / tw, 1);
  g.fillText(p.text, 0, 0);
  g.restore();
}
