// Landmarks (PLAN phase 6): small, distinct things you remember a lap by, placed by the layout
// (`landmarks`, from the generators) and the same every race. Some move (the drawbridge, the
// fountain), and some show the race: the clock tower tells the race time and the billboard shows
// who's leading (SceneLive, from the renderer). Scenery only: nothing here is solid.
//
// Each landmark is a group at its spot on the ground, turned so its front faces the road that
// sees it (+z local). The ground it keeps clear (`landmarkKeeps`) is left empty by the city.

import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
  Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkDef, TrackLayout } from '../../../core/content';
import { Rng } from '../../../core/rng';
import type { SceneLive } from '../../skin';
import type { Keep } from './cityscape';
import { animatedPoints, boxes, FONT, glowPoints, type Box } from './scenery';
import { water } from './terrain';
import { faceted, toon } from './toon';

export interface Landmarks {
  objects: Object3D[];
  update(time: number, live?: SceneLive): void;
}

/** A landmark's builder: its objects, in its own frame (front toward +z), and what moves. */
type Built = { root: Object3D; update?: (time: number, live?: SceneLive) => void };

/** The ground each landmark keeps: its footprint square (and a sight line in front, `view`), or a canal's whole length. */
export function landmarkKeeps(layout: TrackLayout): Keep[] {
  return (layout.landmarks ?? []).flatMap((m): Keep[] => {
    const [x, z] = m.at;
    if (m.kind === 'canal') {
      const { len, w } = canalSize(m);
      const along = Math.abs(Math.sin(m.rot ?? 0)) > 0.5;
      const [hx, hz] = along ? [len / 2, w / 2 + WALL] : [w / 2 + WALL, len / 2];
      return [{ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, cut: true }];
    }
    const out: Keep[] = m.r > 0 ? [{ x0: x - m.r, x1: x + m.r, z0: z - m.r, z1: z + m.r }] : [];
    // `view`: the ground in front of it kept clear too, that far out, so it's seen from the road.
    const view = m.params?.view ?? 0;
    if (view > 0) {
      const fx = Math.sin(m.rot ?? 0);
      const fz = Math.cos(m.rot ?? 0);
      const half = Math.max(m.r, (m.params?.w ?? 0) / 2);
      const [ex, ez] = [x + fx * view, z + fz * view];
      const [wx, wz] = Math.abs(fx) > Math.abs(fz) ? [0, half] : [half, 0];
      out.push({ x0: Math.min(x, ex) - wx, x1: Math.max(x, ex) + wx, z0: Math.min(z, ez) - wz, z1: Math.max(z, ez) + wz });
    }
    return out;
  });
}

/** Mins and maxes of a race time as the clock's readout: m:ss. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Every landmark in the layout, standing on `floor` (the ground's height at x, z). `time` drives
 * the ones animated in their shaders.
 */
export function buildLandmarks(layout: TrackLayout, floor: (x: number, z: number) => number): Landmarks {
  const objects: Object3D[] = [];
  const time = { value: 0 };
  const updates: ((time: number, live?: SceneLive) => void)[] = [(t) => (time.value = t)];
  for (const m of layout.landmarks ?? []) {
    const build = BUILDERS[m.kind];
    if (!build) continue;
    const b = build(m, time);
    b.root.position.set(m.at[0], floor(m.at[0], m.at[1]), m.at[1]);
    b.root.name = `landmark:${m.kind}`;
    b.root.rotation.y = m.rot ?? 0;
    b.root.scale.setScalar(m.params?.scale ?? 1);
    b.root.updateMatrixWorld(true);
    objects.push(b.root);
    if (b.update) updates.push(b.update);
  }
  return {
    objects,
    update(time, live) {
      for (const u of updates) u(time, live);
    },
  };
}

// ---- small builders ----

const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): Mesh => {
  const m = new Mesh(new BoxGeometry(w, h, d), toon({ color }));
  m.position.set(x, y, z);
  return m;
};
const cyl = (rTop: number, rBottom: number, h: number, color: number, y: number, sides = 16): Mesh => {
  const m = new Mesh(faceted(new CylinderGeometry(rTop, rBottom, h, sides)), toon({ color }));
  m.position.y = y;
  return m;
};

/** A landmark's still boxes, drawn as one instanced mesh (one draw call). */
function solids(): { add(w: number, h: number, d: number, color: number, x?: number, y?: number, z?: number): void; mesh(): InstancedMesh } {
  const list: Box[] = [];
  return {
    add: (w, h, d, color, x = 0, y = 0, z = 0) => list.push({ x, y, z, w, h, d, rot: 0, color }),
    mesh: () => boxes(list, toon()),
  };
}

/** A canvas you draw into and redraw (the clock's readout, the billboard). */
function liveCanvas(w: number, h: number): { g: CanvasRenderingContext2D; tex: CanvasTexture } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return { g: c.getContext('2d')!, tex };
}

function staticCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const { g, tex } = liveCanvas(w, h);
  draw(g);
  // Again once the display font has loaded (the first draw may have used a fallback).
  document.fonts?.ready.then(() => {
    g.clearRect(0, 0, w, h);
    draw(g);
    tex.needsUpdate = true;
  });
  return tex;
}

/** A lit sign face: shows at night, and isn't shaded. */
const face = (tex: CanvasTexture, w: number, h: number) => new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, toneMapped: false }));

// ---- Downtown ----

/** The clock tower: a stone shaft with a clock on every side whose hands tell the race time (the long hand the seconds, the short one the minutes), a lit readout under each, and a copper spire. */
function clockTower(m: LandmarkDef): Built {
  const h = m.params?.h ?? 44;
  const root = new Group();
  const S = solids();
  const stone = 0xb9a58c;
  S.add(12, 3, 12, 0x8f7d69, 0, 1.5);
  S.add(8, h, 8, stone, 0, 3 + h / 2);
  for (let y = 3 + h * 0.3; y < 3 + h - 2; y += h * 0.3) S.add(8.8, 0.7, 8.8, 0xd8c7ad, 0, y);
  const top = 3 + h;
  S.add(10.4, 11, 10.4, 0x8a7560, 0, top + 5.5);
  S.add(11.4, 1, 11.4, 0xd8c7ad, 0, top + 11.3);
  const spire = new Mesh(faceted(new ConeGeometry(7.6, 12, 4)), toon({ color: 0x5fa58a }));
  spire.position.y = top + 17.8;
  spire.rotation.y = Math.PI / 4;
  root.add(spire);
  S.add(0.5, 6, 0.5, 0x3a3050, 0, top + 26.5);
  root.add(glowPoints([0, top + 29.8, 0], 0xff3355, 5));
  const dial = staticCanvas(256, 256, (g) => {
    g.fillStyle = '#fff4dc';
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2140';
    g.lineWidth = 10;
    g.stroke();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const major = k % 5 === 0;
      const r0 = major ? 92 : 104;
      g.lineWidth = major ? 9 : 3;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
      g.lineTo(128 + Math.sin(a) * 114, 128 - Math.cos(a) * 114);
      g.stroke();
    }
    g.fillStyle = '#ff2e88';
    g.font = `26px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('RACE', 128, 88);
  });
  const readout = liveCanvas(256, 80);
  let shown = '';
  const draw = (text: string) => {
    const g = readout.g;
    g.fillStyle = '#120a20';
    g.fillRect(0, 0, 256, 80);
    g.fillStyle = '#ffd23f';
    g.font = `56px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 44);
    readout.tex.needsUpdate = true;
  };
  // Four dials and four readouts, one merged mesh each; the eight hands one instanced mesh, posed
  // each frame (a hand's matrix: its side, its pivot at the dial's middle, its turn, its size).
  const sides = [0, 1, 2, 3].map((k) => new Matrix4().makeRotationY((k * Math.PI) / 2));
  const onSides = (w: number, hgt: number, y: number) => mergeGeometries(sides.map((r) => new PlaneGeometry(w, hgt).applyMatrix4(new Matrix4().multiplyMatrices(r, new Matrix4().makeTranslation(0, y, 5.22)))))!;
  root.add(new Mesh(onSides(8, 8, top + 6.2), new MeshBasicMaterial({ map: dial, toneMapped: false })));
  root.add(new Mesh(onSides(5, 1.56, top + 1.3), new MeshBasicMaterial({ map: readout.tex, toneMapped: false })));
  const handGeo = new BoxGeometry(1, 1, 1).translate(0, 0.43, 0);
  const hands = new InstancedMesh(handGeo, new MeshBasicMaterial({ color: 0x1b1030 }), 8);
  hands.frustumCulled = false;
  root.add(hands);
  const HANDS = [
    { w: 0.28, len: 3.6, z: 5.4 },
    { w: 0.45, len: 2.4, z: 5.35 },
  ];
  const hm = new Matrix4();
  const turn = new Matrix4();
  const size = new Matrix4();
  const pose = (long: number, short: number) => {
    sides.forEach((r, k) =>
      HANDS.forEach((hd, j) => {
        hm.multiplyMatrices(r, new Matrix4().makeTranslation(0, top + 6.2, hd.z));
        hm.multiply(turn.makeRotationZ(j === 0 ? long : short)).multiply(size.makeScale(hd.w, hd.len, 0.08));
        hands.setMatrixAt(k * 2 + j, hm);
      }),
    );
    hands.instanceMatrix.needsUpdate = true;
  };
  pose(0, 0);
  draw(clockText(0));
  root.add(S.mesh());
  return {
    root,
    update(_t, live) {
      const t = live?.raceTime ?? 0;
      // Clockwise seen from the front: the face is turned toward +z, so the hands turn by -angle.
      pose(-((t % 60) / 60) * Math.PI * 2, -(((t / 60) % 12) / 12) * Math.PI * 2);
      const text = clockText(t);
      if (text !== shown) draw((shown = text));
    },
  };
}

/** The donut shop: a low shop with a striped awning, a sign, and a giant donut standing on its roof, iced and sprinkled, facing the road. */
function donutShop(): Built {
  const root = new Group();
  const S = solids();
  S.add(16, 6, 11, 0xf2e3c6, 0, 3);
  S.add(16.6, 0.6, 11.6, 0x6d3b52, 0, 6.3);
  // The front: windows, a door, the awning in pink and white stripes.
  const glass = new MeshBasicMaterial({ color: 0x9ee6ff });
  for (const x of [-4.8, 4.8]) {
    const w = new Mesh(new PlaneGeometry(4.8, 2.6), glass);
    w.position.set(x, 2.4, 5.52);
    root.add(w);
  }
  S.add(2, 3.2, 0.2, 0x6d3b52, 0, 1.6, 5.55);
  for (let k = 0; k < 8; k++) S.add(2, 0.3, 2.2, k % 2 ? 0xffffff : 0xff6fb1, -7 + k * 2, 4.4, 6.5);
  const sign = staticCanvas(512, 128, (g) => {
    g.fillStyle = '#ff6fb1';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff6ee';
    g.font = `78px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DONUTS', 256, 68);
  });
  const s = face(sign, 9, 2.25);
  s.position.set(0, 5.3, 5.62);
  root.add(s);
  // The donut, upright on two posts: dough, a thick layer of pink icing on its face, sprinkles.
  const donut = new Group();
  donut.position.set(0, 13.2, 0);
  const dough = new Mesh(faceted(new TorusGeometry(4.2, 1.8, 10, 28)), toon({ color: 0xd9a05b }));
  donut.add(dough);
  const icing = new Mesh(faceted(new TorusGeometry(4.2, 1.85, 10, 28)), toon({ color: 0xff6fb1 }));
  icing.scale.set(1, 1, 0.6);
  icing.position.z = 0.55;
  donut.add(icing);
  const rng = Rng.stream(0xd0, 'donut');
  const SPRINKLES = [0xffd23f, 0x35f0ff, 0xffffff, 0x7cff6b, 0xb26bff];
  const sprinkles = new InstancedMesh(new BoxGeometry(0.16, 0.6, 0.16), toon(), 46);
  const mat = new Matrix4();
  const q = new Quaternion();
  const c = new Color();
  for (let k = 0; k < 46; k++) {
    const a = rng.next() * Math.PI * 2;
    const r = 4.2 + (rng.next() - 0.5) * 2.6;
    mat.compose(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 1.72), q.setFromAxisAngle(new Vector3(0, 0, 1), rng.next() * Math.PI), new Vector3(1, 1, 1));
    sprinkles.setMatrixAt(k, mat);
    sprinkles.setColorAt(k, c.setHex(SPRINKLES[k % SPRINKLES.length]));
  }
  donut.add(sprinkles);
  root.add(donut);
  for (const x of [-2.2, 2.2]) S.add(0.5, 3, 0.5, 0x3a3050, x, 7.8, -0.6);
  root.add(S.mesh());
  return { root };
}

/** A fountain in a round plaza: a curb, grass, a stone basin, two tiers, and water arcing out of the top in the shader. */
function fountain(m: LandmarkDef, time: { value: number }): Built {
  const r = m.params?.r ?? 11;
  const root = new Group();
  const S = solids();
  // The plaza's ring road, painted round it, and its curb and grass.
  const ring = new Mesh(new RingGeometry(r + 4.6, r + 5, 48), new MeshBasicMaterial({ color: 0xa89cc0, side: DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  root.add(ring);
  root.add(cyl(r, r, 0.35, 0x6d5f86, 0.18, 32));
  root.add(cyl(r - 0.7, r - 0.7, 0.4, 0x3f8a4f, 0.2, 32));
  const basin = r * 0.55;
  root.add(cyl(basin, basin + 0.3, 1.1, 0xc9bda8, 0.55, 24));
  const pool = new Mesh(new CylinderGeometry(basin - 0.5, basin - 0.5, 0.1, 24), new MeshBasicMaterial({ color: 0x3aa7d9 }));
  pool.position.y = 1.05;
  root.add(pool);
  root.add(cyl(0.9, 1.3, 3.2, 0xc9bda8, 2.1, 12));
  root.add(cyl(2.6, 1.6, 0.6, 0xd8c7ad, 3.9, 16));
  root.add(cyl(0.45, 0.6, 1.8, 0xc9bda8, 5.1, 10));
  root.add(cyl(1.4, 0.9, 0.45, 0xd8c7ad, 6.1, 12));
  // Spray: points thrown out and up from the top tier, and falling back into the basin.
  const pos: number[] = [];
  const phase: number[] = [];
  const colors: number[] = [];
  const rng = Rng.stream(0xf0, 'fountain');
  for (let k = 0; k < 220; k++) {
    pos.push(0, 6.4, 0);
    phase.push(rng.next());
    colors.push(0.8, 0.93, 1);
  }
  root.add(animatedPoints(pos, phase, colors, 'spray', 1.2, time));
  // Lamps in the basin's rim, in the city's neon.
  const lamps: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    lamps.push(Math.cos(a) * basin, 1.2, Math.sin(a) * basin);
  }
  root.add(glowPoints(lamps, 0x35f0ff, 2.4));
  root.add(S.mesh());
  return { root };
}

/** The billboard up high: LEADER and the leading car's plate, redrawn whenever the lead changes. */
function leaderBoard(m: LandmarkDef): Built {
  const h = m.params?.h ?? 22;
  const w = m.params?.w ?? 24;
  const bh = w * 0.36;
  const root = new Group();
  const S = solids();
  for (const x of [-w * 0.3, w * 0.3]) S.add(0.9, h - bh / 2, 0.9, 0x3a3050, x, (h - bh / 2) / 2, -0.4);
  S.add(w + 1.2, bh + 1.2, 0.8, 0x1b1030, 0, h, -0.5);
  S.add(w + 1.6, 0.4, 2, 0x3a3050, 0, h - bh / 2 - 0.8, 0.2);
  const board = liveCanvas(1024, Math.round(1024 * 0.36));
  const H = board.g.canvas.height;
  let shown: string | null | undefined;
  const draw = (plate: string | null) => {
    const g = board.g;
    g.fillStyle = '#120a20';
    g.fillRect(0, 0, 1024, H);
    g.strokeStyle = '#ff2e88';
    g.lineWidth = 12;
    g.strokeRect(10, 10, 1004, H - 20);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#35f0ff';
    g.font = `58px ${FONT}`;
    g.fillText('LEADER', 512, 66);
    // The plate: white, navy lettering, like the ones on the cars.
    const text = plate ?? 'RACECAR';
    g.font = `bold 118px 'Chakra Petch', ${FONT}`;
    const tw = Math.max(360, g.measureText(text).width + 80);
    const x0 = 512 - tw / 2;
    g.fillStyle = '#ffffff';
    g.fillRect(x0, 128, tw, 196);
    g.strokeStyle = '#1b1f5e';
    g.lineWidth = 10;
    g.strokeRect(x0 + 5, 133, tw - 10, 186);
    g.fillStyle = '#1b1f5e';
    g.fillText(text, 512, 232);
    board.tex.needsUpdate = true;
  };
  const f = face(board.tex, w, bh);
  f.position.set(0, h, 0);
  root.add(f);
  // Lamps along the top, lighting it.
  const lamps: number[] = [];
  for (let k = 0; k < 4; k++) lamps.push(-w * 0.375 + (k * w * 0.75) / 3, h + bh / 2 + 0.9, 1.2);
  root.add(glowPoints(lamps, 0xfff1c9, 3.6));
  draw(null);
  document.fonts?.ready.then(() => draw(shown ?? null));
  root.add(S.mesh());
  return {
    root,
    update(_t, live) {
      const plate = live?.leader ?? null;
      if (plate !== shown) draw((shown = plate));
    },
  };
}

/** A canal's walls (m out from the water on each side). */
const WALL = 1.2;
const canalSize = (m: LandmarkDef) => ({ len: m.params?.len ?? 600, w: m.params?.w ?? 14 });

/**
 * A canal down the middle of a row of blocks: water sunk between stone walls, flat bridges where
 * the side streets cross it (every 64 m, the city's blocks), and at `draw` (m along it from its
 * middle) a drawbridge whose two leaves lift for a tugboat going by.
 */
function canal(m: LandmarkDef, time: { value: number }): Built {
  const { len, w } = canalSize(m);
  const root = new Group();
  const S = solids();
  const y = -1.5;
  root.add(water([[0, -len / 2], [0, -len / 6], [0, len / 6], [0, len / 2]], w / 2, y, time));
  for (const side of [-1, 1]) {
    S.add(WALL, 3, len, 0x8e7f9e, side * (w / 2 + WALL / 2), -1.2);
    S.add(WALL + 0.4, 0.3, len, 0xc9bda8, side * (w / 2 + WALL / 2), 0.3);
  }
  // The side streets cross it on the city's grid (every 64 m in world coordinates, along its
  // length); `draw` is the world coordinate of the one with the drawbridge.
  const across = Math.abs(Math.sin(m.rot ?? 0)) > 0.5;
  const mid = across ? m.at[0] : m.at[1];
  const draw = (m.params?.draw ?? mid) - mid;
  const street = 12;
  const span = w + WALL * 2 + 0.4;
  for (let u = Math.ceil((mid - len / 2 + 8) / 64) * 64 - mid; u < len / 2 - 8; u += 64) {
    if (Math.abs(u - draw) < 1) continue;
    S.add(span, 0.6, street, 0x2a2140, 0, -0.05, u);
    for (const e of [-1, 1]) S.add(span, 0.9, 0.3, 0x6d5f86, 0, 0.7, u + (e * street) / 2);
  }
  // The drawbridge: a leaf from each bank, hinged at the wall, meeting in the middle.
  const leaves: Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new Group();
    hinge.position.set(side * (w / 2 + WALL), 0.25, draw);
    const leaf = box(w / 2 + WALL, 0.5, street, 0x39304f, -side * ((w / 2 + WALL) / 2), 0, 0);
    hinge.add(leaf);
    const stripe = box(0.4, 0.55, street, 0xffd23f, -side * (w / 2 + WALL - 0.3), 0, 0);
    hinge.add(stripe);
    root.add(hinge);
    leaves.push(hinge);
    // A control hut on each bank.
    S.add(3, 3.4, 3, 0xd8c7ad, side * (w / 2 + WALL + 2.5), 1.7, draw + street / 2 + 2);
  }
  const warn = glowPoints([-(w / 2 + WALL + 2.5), 3.9, draw + street / 2 + 2, w / 2 + WALL + 2.5, 3.9, draw + street / 2 + 2], 0xff3355, 3);
  root.add(warn);
  // The tug: up the canal and gone at its end, then back from the start after a while.
  const tug = new Group();
  tug.add(box(4, 1.4, 9, 0xd7263d, 0, 0.2));
  tug.add(box(3.2, 2, 3.4, 0xfff4dc, 0, 1.9, -1));
  tug.add(box(0.8, 1.6, 0.8, 0x1b1030, 0, 3.6, -1.6));
  tug.position.y = y;
  root.add(tug);
  const speed = 5;
  const period = len / speed + 25;
  root.add(S.mesh());
  return {
    root,
    update(t) {
      const along = -len / 2 + 8 + ((t % period) * speed);
      tug.visible = along < len / 2 - 8;
      tug.position.z = along;
      // Open while the tug is within 30 m of the bridge, lifting over the 12 m before that.
      const open = tug.visible ? Math.min(1, Math.max(0, (42 - Math.abs(along - draw)) / 12)) : 0;
      const eased = open * open * (3 - 2 * open);
      // The left leaf (reaching +x) lifts turning about +z, the right one the other way.
      leaves[0].rotation.z = eased * 1.2;
      leaves[1].rotation.z = -eased * 1.2;
      warn.visible = open > 0 && Math.floor(t * 2) % 2 === 0;
    },
  };
}

/** Each kind's builder; `time` is world seconds, for what's animated in a shader. */
const BUILDERS: Record<string, (m: LandmarkDef, time: { value: number }) => Built> = {
  'clock-tower': (m) => clockTower(m),
  'donut-shop': () => donutShop(),
  fountain: (m, time) => fountain(m, time),
  'leader-board': (m) => leaderBoard(m),
  canal: (m, time) => canal(m, time),
};
