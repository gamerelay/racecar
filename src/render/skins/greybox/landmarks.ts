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
  AdditiveBlending,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  SphereGeometry,
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

/** The ground each landmark keeps as a circle (for the country and the island, which place by circles). */
export function landmarkCircles(layout: TrackLayout): { x: number; z: number; r: number }[] {
  return (layout.landmarks ?? []).filter((m) => m.r > 0).map((m) => ({ x: m.at[0], z: m.at[1], r: m.r }));
}

/** A race time as the clock's readout: m:ss. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The sea's level the landmarks stand by: the island's terrain's, or open ground's (`ground.sea`); undefined with no sea. */
export function landmarkSea(layout: TrackLayout): number | undefined {
  return layout.terrain?.sea ?? layout.ground?.sea;
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
    // The ground under a point in the landmark's own frame, relative to its middle (it stands on a slope).
    const base = floor(m.at[0], m.at[1]);
    const sc = m.params?.scale ?? 1;
    const [cs, sn] = [Math.cos(m.rot ?? 0), Math.sin(m.rot ?? 0)];
    const ground = (lx: number, lz: number) => (floor(m.at[0] + (lx * cs + lz * sn) * sc, m.at[1] + (-lx * sn + lz * cs) * sc) - base) / sc;
    const seaY = landmarkSea(layout);
    const b = build(m, { time, ground, sea: seaY === undefined ? null : (seaY - base) / sc });
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

/**
 * A lit sign's material: shows at night, and isn't shaded. Signs sit a few centimetres off what
 * they're on, and the depth buffer can't tell that apart from far away (the camera's near plane is
 * 10 cm): they're pulled forward in the depth test too, so they don't flicker through it.
 */
const lit = (map: CanvasTexture) => new MeshBasicMaterial({ map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
/** A lit sign face. */
const face = (tex: CanvasTexture, w: number, h: number) => new Mesh(new PlaneGeometry(w, h), lit(tex));

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
  // The faces stand 10 cm off the stone (the box's face is at 5.2), and are lit signs (`lit`): the
  // tower is seen from hundreds of metres, and at 2 cm the dial flickered through the stone.
  const sides = [0, 1, 2, 3].map((k) => new Matrix4().makeRotationY((k * Math.PI) / 2));
  const onSides = (w: number, hgt: number, y: number) => mergeGeometries(sides.map((r) => new PlaneGeometry(w, hgt).applyMatrix4(new Matrix4().multiplyMatrices(r, new Matrix4().makeTranslation(0, y, 5.3)))))!;
  root.add(new Mesh(onSides(8, 8, top + 6.2), lit(dial)));
  root.add(new Mesh(onSides(5, 1.56, top + 1.3), lit(readout.tex)));
  const handGeo = new BoxGeometry(1, 1, 1).translate(0, 0.43, 0);
  const hands = new InstancedMesh(handGeo, new MeshBasicMaterial({ color: 0x1b1030 }), 8);
  hands.frustumCulled = false;
  root.add(hands);
  // Clear of the dial and of each other where they cross (each is 6 cm deep).
  const HANDS = [
    { w: 0.28, len: 3.6, z: 5.5 },
    { w: 0.45, len: 2.4, z: 5.4 },
  ];
  const hm = new Matrix4();
  const turn = new Matrix4();
  const size = new Matrix4();
  const pivot = new Matrix4();
  const pose = (long: number, short: number) => {
    sides.forEach((r, k) =>
      HANDS.forEach((hd, j) => {
        hm.multiplyMatrices(r, pivot.makeTranslation(0, top + 6.2, hd.z));
        hm.multiply(turn.makeRotationZ(j === 0 ? long : short)).multiply(size.makeScale(hd.w, hd.len, 0.06));
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
    w.position.set(x, 2.4, 5.56);
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
  // Its top 3 cm over the basin's (level with it, the two flickered).
  pool.position.y = 1.08;
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
    const stripe = box(0.4, 0.55, street + 0.04, 0xffd23f, -side * (w / 2 + WALL - 0.3), 0, 0);
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

/** What a builder gets: world seconds for what's animated in a shader, and the ground under a point of its own frame. */
interface Ctx {
  time: { value: number };
  ground(lx: number, lz: number): number;
  /** The sea's surface, relative to the landmark's middle (null: no sea). */
  sea: number | null;
}

// ---- Backroads ----

/** A mesh posed by position and turn (Euler, radians). */
const posed = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh => {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
};

/** A farm windpump: a lattice tower, a many-bladed wheel that spins faster the wetter (and windier) it gets, and a tail vane. */
function windmill(): Built {
  const root = new Group();
  const S = solids();
  const H = 17;
  const steel = toon({ color: 0xb8bcc4 });
  // Four legs leaning in from a 6 m square to a 1.6 m one at the top, braced every few meters.
  const lean = Math.atan2(2.2, H);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    root.add(posed(new Mesh(new BoxGeometry(0.3, H + 0.3, 0.3), steel), a * 1.9, H / 2, b * 1.9, -b * lean, 0, a * lean));
  }
  for (let y = 3; y < H - 1; y += 3.5) {
    const half = 3 - (2.2 * y) / H;
    for (const sgn of [-1, 1]) {
      S.add(half * 2, 0.15, 0.15, 0xa8acb4, 0, y, sgn * half);
      S.add(0.15, 0.15, half * 2, 0xa8acb4, sgn * half, y, 0);
    }
  }
  S.add(2.4, 0.3, 2.4, 0x8a8e96, 0, H, 0);
  S.add(3, 1.2, 0.8, 0x2a2140, 0, -0.4, 0);
  // The head: a hub facing +z, the wheel's blades round it, the vane behind.
  const head = new Group();
  head.position.set(0, H + 1.2, 0);
  root.add(head);
  head.add(posed(new Mesh(new BoxGeometry(0.9, 0.9, 2.4), steel), 0, 0, 0));
  const vane = new Mesh(new BoxGeometry(0.12, 2.2, 4.2), toon({ color: 0xd7263d }));
  head.add(posed(vane, 0, 0.3, -3.6));
  const wheel = new Group();
  wheel.position.z = 1.4;
  head.add(wheel);
  const blade = new BoxGeometry(0.9, 2.6, 0.06);
  blade.translate(0, 2.4, 0);
  const bladeMat = toon({ color: 0xe2e5ea });
  for (let k = 0; k < 18; k++) wheel.add(posed(new Mesh(blade, bladeMat), 0, 0, 0, 0, 0.35, (k / 18) * Math.PI * 2));
  wheel.add(new Mesh(new TorusGeometry(3.6, 0.08, 4, 36), steel));
  root.add(S.mesh());
  let angle = 0;
  let last = 0;
  return {
    root,
    update(t, live) {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      const wind = 0.9 + (live?.wetness ?? 0) * 2.6;
      // Gusts: the wheel speeds up and slows, and the head hunts a little into the wind.
      const gust = 0.75 + 0.35 * Math.sin(t * 0.37) + 0.15 * Math.sin(t * 1.3);
      angle += dt * wind * gust * 2.2;
      wheel.rotation.z = angle;
      head.rotation.y = 0.12 * Math.sin(t * 0.21);
    },
  };
}

/** A giant fibreglass cow on a plinth by the road: black and white, pink nose and udder, and a tail that swishes. */
function cow(): Built {
  const root = new Group();
  const S = solids();
  const W = 0xf6f3ee;
  const B = 0x1f1a24;
  const P = 0xf2a0b4;
  S.add(11, 1.6, 6, 0x8f7d69, 0, 0.3);
  // Legs, body, spots, head (facing +x, along the plinth), horns, udder.
  for (const [x, z] of [[-3, -1.3], [-3, 1.3], [3, -1.3], [3, 1.3]]) S.add(1, 3.4, 1, W, x, 2.8, z);
  for (const [x, z] of [[-3, -1.3], [3, 1.3]]) S.add(1.05, 0.7, 1.05, B, x, 1.45, z);
  S.add(8.4, 3.6, 3.8, W, 0, 6.2, 0);
  S.add(2.6, 2.2, 3.9, B, -1.6, 6.8, 0);
  S.add(1.8, 1.6, 3.9, B, 2.2, 5.4, 0);
  S.add(1.4, 1.3, 0.2, B, 0.6, 7.2, -1.98);
  S.add(3, 2.6, 2.6, W, 5.2, 7.6, 0);
  S.add(1.3, 1.4, 2.2, P, 6.9, 7.1, 0);
  S.add(1.4, 0.9, 0.4, B, 4.8, 8.6, -1.5);
  S.add(1.4, 0.9, 0.4, B, 4.8, 8.6, 1.5);
  for (const z of [-1, 1]) S.add(0.35, 1.2, 0.35, 0xe8dcc0, 5, 9.4, z);
  S.add(1.8, 1, 1.8, P, 2.4, 4, 0);
  root.add(S.mesh());
  const tail = new Group();
  tail.position.set(-4.2, 7.2, 0);
  tail.add(posed(new Mesh(new BoxGeometry(0.3, 3.4, 0.3), toon({ color: W })), 0, -1.7, 0));
  tail.add(posed(new Mesh(new BoxGeometry(0.6, 1, 0.6), toon({ color: B })), 0, -3.5, 0));
  root.add(tail);
  const sign = staticCanvas(512, 96, (g) => {
    g.fillStyle = '#3a6b35';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#fff6ee';
    g.font = `54px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BIG BESSIE', 256, 52);
  });
  const f = face(sign, 8, 1.5);
  f.position.set(0, 0.5, 3.06);
  root.add(f);
  return {
    root,
    update(t) {
      tail.rotation.x = 0.35 * Math.sin(t * 1.7);
    },
  };
}

/** A water tower on four legs, the town's name round its tank, and a red light on top. */
function waterTower(m: LandmarkDef): Built {
  const root = new Group();
  const S = solids();
  const H = 16;
  const r = 5.2;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) S.add(0.5, H, 0.5, 0x6b7078, a * 3.2, H / 2, b * 3.2);
  for (const y of [5, 10]) {
    S.add(6.9, 0.2, 0.2, 0x6b7078, 0, y, 3.2);
    S.add(6.9, 0.2, 0.2, 0x6b7078, 0, y, -3.2);
    S.add(0.2, 0.2, 6.9, 0x6b7078, 3.2, y, 0);
    S.add(0.2, 0.2, 6.9, 0x6b7078, -3.2, y, 0);
  }
  root.add(S.mesh());
  root.add(cyl(r, r, 7, 0xc9ced6, H + 3.5, 24));
  const roof = new Mesh(faceted(new ConeGeometry(r + 0.4, 3.2, 24)), toon({ color: 0x8a919c }));
  roof.position.y = H + 8.6;
  root.add(roof);
  root.add(glowPoints([0, H + 10.6, 0], 0xff3355, 3));
  const name = m.label ?? 'MILLBROOK';
  const band = staticCanvas(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128);
    g.fillStyle = '#1b3a6b';
    g.font = `76px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Twice round, so it reads from any side.
    g.fillText(name, 256, 68);
    g.fillText(name, 768, 68);
  });
  const ring = new Mesh(new CylinderGeometry(r + 0.05, r + 0.05, 2.6, 32, 1, true), new MeshBasicMaterial({ map: band, transparent: true, toneMapped: false }));
  ring.position.y = H + 4;
  root.add(ring);
  return { root };
}

/** A drive-in on the flats: a big screen on its frame, flickering with a film, a projection booth and its beam, and rows of cars facing it. */
function driveIn(c: Ctx): Built {
  const root = new Group();
  const S = solids();
  const W = 30;
  const H = 14;
  const lift = 5;
  // The frame behind the screen, and its footings down into the slope.
  for (const x of [-W / 2 + 1, -W / 6, W / 6, W / 2 - 1]) S.add(0.8, H + lift + 4, 0.8, 0x5e4630, x, (H + lift) / 2 - 2 + c.ground(x, -1), -1);
  S.add(W + 1.4, H + 1.2, 0.6, 0xe8e2d4, 0, lift + H / 2, -0.4);
  const film = staticCanvas(1024, 480, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, '#1b0b45');
    sky.addColorStop(1, '#ff6a00');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1024, 480);
    g.fillStyle = '#120a20';
    g.beginPath();
    g.moveTo(0, 480);
    g.lineTo(0, 380);
    g.quadraticCurveTo(300, 300, 520, 360);
    g.quadraticCurveTo(760, 420, 1024, 330);
    g.lineTo(1024, 480);
    g.fill();
    g.fillStyle = '#ffd23f';
    g.font = `64px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('ATTACK OF THE', 512, 120);
    g.font = `92px ${FONT}`;
    g.fillStyle = '#ff2e88';
    g.fillText('50 FT COMBINE', 512, 230);
  });
  const screenMat = new MeshBasicMaterial({ map: film, toneMapped: false });
  const screen = new Mesh(new PlaneGeometry(W, H), screenMat);
  screen.position.set(0, lift + H / 2, 0);
  root.add(screen);
  // The booth, at the back of the lot, and the beam from it to the screen.
  const bz = 46;
  S.add(5, 3.2, 4, 0xd8c7ad, 0, 1.6 + c.ground(0, bz), bz);
  root.add(S.mesh());
  const beamLen = Math.hypot(bz, lift + H / 2 - 2.8);
  const beam = new Mesh(new ConeGeometry(W * 0.42, beamLen, 4, 1, true), new MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.06, depthWrite: false, side: DoubleSide }));
  beam.position.set(0, (lift + H / 2 + 2.8 + c.ground(0, bz)) / 2, bz / 2);
  beam.rotation.x = -Math.PI / 2 + Math.atan2(lift + H / 2 - 2.8 - c.ground(0, bz), bz);
  beam.rotation.y = Math.PI / 4;
  root.add(beam);
  // Cars in rows facing the screen (little boxes of body and cabin), each by a speaker post.
  const rng = Rng.stream(0xd1, 'drive-in');
  const COLORS = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a];
  const lot: Box[] = [];
  for (let row = 0; row < 3; row++) {
    for (let k = -3; k <= 3; k++) {
      const x = k * 4.4;
      const z = 14 + row * 9;
      const y = c.ground(x, z);
      lot.push({ x: x + 2.2, y: y + 0.6, z: z + 1, w: 0.15, h: 1.2, d: 0.15, rot: 0, color: 0x3a3050 });
      if (rng.next() < 0.3) continue;
      const color = COLORS[Math.floor(rng.next() * COLORS.length)];
      lot.push({ x, y: y + 0.75, z, w: 1.9, h: 0.9, d: 4.4, rot: 0, color });
      lot.push({ x, y: y + 1.55, z: z + 0.3, w: 1.7, h: 0.7, d: 2.2, rot: 0, color: 0x2a2140 });
    }
  }
  root.add(boxes(lot, toon()));
  return {
    root,
    update(t) {
      // The film flickers.
      const f = 0.86 + 0.1 * Math.sin(t * 23) * Math.sin(t * 7.1) + 0.04 * Math.sin(t * 61);
      screenMat.color.setScalar(f);
    },
  };
}

/** A scarecrow in a patch of corn, swaying in the wind, crows circling over it. */
function scarecrow(c: Ctx): Built {
  const root = new Group();
  const figure = new Group();
  root.add(figure);
  const S = solids();
  S.add(0.25, 5, 0.25, 0x6b4a3a, 0, 2.5, 0);
  S.add(3.8, 0.22, 0.22, 0x6b4a3a, 0, 3.8, 0);
  S.add(1.3, 1.9, 0.8, 0xc0392b, 0, 3.2, 0);
  S.add(3.4, 0.55, 0.6, 0xc0392b, 0, 3.8, 0);
  S.add(0.5, 1.8, 0.5, 0x3d5a8a, -0.35, 1.5, 0);
  S.add(0.5, 1.8, 0.5, 0x3d5a8a, 0.35, 1.5, 0);
  const head = new Mesh(faceted(new CylinderGeometry(0.55, 0.6, 1.1, 8)), toon({ color: 0xd9b77a }));
  head.position.y = 4.8;
  figure.add(head);
  figure.add(cyl(1.3, 1.3, 0.12, 0x6b553b, 5.4, 10));
  figure.add(cyl(0.3, 0.6, 0.9, 0x6b553b, 5.9, 10));
  for (const x of [-1.9, 1.9]) S.add(0.4, 0.5, 0.4, 0xe2c36a, x, 3.6, 0);
  figure.add(S.mesh());
  // The corn: stalks in rows round it (not on it), each on the ground where it stands.
  const rng = Rng.stream(0xc0, 'corn');
  const stalks: Box[] = [];
  for (let x = -12; x <= 12; x += 1.6) {
    for (let z = -8; z <= 8; z += 1.1) {
      if (Math.hypot(x, z) < 2.4) continue;
      const h = 2 + rng.next() * 0.8;
      stalks.push({ x: x + (rng.next() - 0.5) * 0.4, y: c.ground(x, z) + h / 2, z, w: 0.35, h, d: 0.35, rot: rng.next() * 3, color: rng.next() < 0.5 ? 0x7a9a3a : 0xa8b04a });
    }
  }
  root.add(boxes(stalks, toon()));
  const pos: number[] = [];
  const phase: number[] = [];
  const colors: number[] = [];
  for (let k = 0; k < 5; k++) {
    pos.push(0, 8, 0);
    phase.push(k / 5 + rng.next() * 0.1);
    colors.push(0.08, 0.06, 0.1);
  }
  root.add(animatedPoints(pos, phase, colors, 'bird', 1.6, c.time));
  return {
    root,
    update(t, live) {
      const wind = 0.04 + (live?.wetness ?? 0) * 0.08;
      figure.rotation.z = wind * Math.sin(t * 1.1);
      figure.rotation.x = wind * 0.5 * Math.sin(t * 0.7 + 1);
    },
  };
}

/** A hot-air balloon drifting in a slow loop over the Ridge: striped, a basket, the burner flaring now and then. */
function balloon(m: LandmarkDef): Built {
  const root = new Group();
  const alt = m.params?.alt ?? 70;
  const R = m.params?.radius ?? 50;
  const craft = new Group();
  root.add(craft);
  // The envelope's gores, alternating colors round it (a color per face, by its longitude).
  const geo = faceted(new SphereGeometry(9, 12, 9));
  const pos = geo.getAttribute('position');
  const cols: number[] = [];
  const STRIPES = [new Color(0xff2e88), new Color(0xffd23f), new Color(0x35a8ff)];
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    const band = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12) % 3;
    for (let k = 0; k < 3; k++) cols.push(STRIPES[band].r, STRIPES[band].g, STRIPES[band].b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
  const env = new Mesh(geo, toon({ vertexColors: true }));
  env.scale.set(1, 1.15, 1);
  env.position.y = 14;
  craft.add(env);
  const skirt = new Mesh(faceted(new CylinderGeometry(4.2, 1.6, 4, 12, 1, true)), toon({ color: 0xff2e88, side: DoubleSide }));
  skirt.position.y = 4.4;
  craft.add(skirt);
  craft.add(box(2, 1.4, 2, 0x8a5a33, 0, 0, 0));
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) craft.add(posed(new Mesh(new BoxGeometry(0.06, 2.6, 0.06), toon({ color: 0x3a2a20 })), a * 1.2, 1.9, b * 1.2, b * 0.18, 0, -a * 0.18));
  const flame = glowPoints([0, 2.8, 0], 0xffa23a, 6);
  craft.add(flame);
  return {
    root,
    update(t) {
      const w = t * 0.02;
      craft.position.set(Math.cos(w) * R, alt + 4 * Math.sin(t * 0.13), Math.sin(w * 1.3) * R * 0.7);
      craft.rotation.y = t * 0.03;
      // The burner: a flare for a couple of seconds every twelve or so.
      flame.visible = t % 12 < 2 && Math.floor(t * 8) % 3 !== 0;
    },
  };
}

// ---- Paradise ----

/** A wreck on the beach: a timber hull heeled over in the shallows, its ribs showing, a broken mast and a torn sail. */
function shipwreck(): Built {
  const root = new Group();
  const hull = new Group();
  hull.rotation.set(0.08, 0, 0.42);
  hull.position.y = -1;
  root.add(hull);
  const S = solids();
  const WOOD = [0x6b4a33, 0x5a3d2a, 0x7a5638];
  // Planking down each side, missing some near the bow, the keel, the deck's stump.
  for (let k = 0; k < 5; k++) {
    for (const side of [-1, 1]) {
      if (side > 0 && k > 2) continue;
      S.add(0.3, 0.9, 16 - k * 1.4, WOOD[k % 3], side * (2.6 - k * 0.35), 0.5 + k * 0.85, -k * 0.3);
    }
  }
  S.add(1, 0.5, 18, 0x4a3223, 0, -0.1, 0);
  for (let z = -6; z <= 6; z += 2) S.add(5.4, 0.3, 0.3, 0x3f2a1d, 0, 4.4, z);
  for (let z = -5; z <= 5; z += 2.5) S.add(0.35, 4.4, 0.35, 0x3f2a1d, 2.5, 2.4, z);
  S.add(0.45, 7, 0.45, 0x4a3223, 0, 6.5, -1);
  S.add(3.6, 0.25, 0.25, 0x4a3223, 0, 8.4, -1);
  hull.add(S.mesh());
  const sail = new Mesh(new PlaneGeometry(3.2, 2.8, 3, 2), toon({ color: 0xe8dcc0, side: DoubleSide }));
  sail.position.set(0.3, 6.9, -0.9);
  sail.rotation.set(0.1, 0.3, 0.15);
  hull.add(sail);
  let last = 0;
  return {
    root,
    update(t) {
      if (t - last < 0.05) return;
      last = t;
      sail.rotation.y = 0.3 + 0.18 * Math.sin(t * 1.3);
    },
  };
}

/** A tiki head at the Lava Tube's mouth: carved stone, glowing eyes, and a torch either side. */
function tikiHead(): Built {
  const root = new Group();
  const S = solids();
  const STONE = 0x5b5048;
  const DARK = 0x3a332e;
  S.add(6, 1.2, 5, 0x3f3833, 0, 0.1);
  S.add(4.6, 9, 3.8, STONE, 0, 5, 0);
  S.add(5, 1, 4.2, DARK, 0, 9.9, 0);
  S.add(4.8, 0.9, 1, DARK, 0, 7.4, 2);
  for (const x of [-1.2, 1.2]) S.add(1.1, 0.9, 0.3, 0x1a1512, x, 6.7, 1.98);
  S.add(1.2, 2.6, 1.2, DARK, 0, 5.4, 2.2);
  S.add(3, 0.8, 0.4, 0x1a1512, 0, 3.2, 1.98);
  for (const x of [-2.1, 2.1]) S.add(0.6, 2.4, 0.9, DARK, x, 5.4, 1.2);
  for (const x of [-5, 5]) {
    S.add(0.3, 4, 0.3, 0x6b4a33, x, 2, 1.5);
    S.add(0.6, 0.6, 0.6, 0x3a2a20, x, 4.2, 1.5);
  }
  root.add(S.mesh());
  const eyes = glowPoints([-1.2, 6.7, 2.2, 1.2, 6.7, 2.2], 0xff7a2a, 2.2);
  root.add(eyes);
  const fire = glowPoints([-5, 4.8, 1.5, 5, 4.8, 1.5], 0xffa040, 3.4);
  root.add(fire);
  return {
    root,
    update(t) {
      eyes.scale.setScalar(0.85 + 0.15 * Math.sin(t * 2.3));
      fire.visible = Math.sin(t * 17) + Math.sin(t * 29) > -1.7;
    },
  };
}

/** A surf shack on stilts: bamboo, a thatched roof, a sign, and boards stuck in the sand in front. */
function surfShack(c: Ctx): Built {
  const root = new Group();
  const S = solids();
  const BAMBOO = 0xc9a86a;
  for (const [x, z] of [[-3.4, -2.4], [3.4, -2.4], [-3.4, 2.4], [3.4, 2.4]]) {
    const g = c.ground(x, z);
    S.add(0.35, 3.2 - g, 0.35, BAMBOO, x, (3.2 + g) / 2, z);
  }
  S.add(7.4, 0.3, 5.4, 0xa88450, 0, 1.6, 0);
  S.add(7, 2.6, 0.2, BAMBOO, 0, 2.9, -2.5);
  for (const x of [-3.5, 3.5]) S.add(0.2, 2.6, 5, BAMBOO, x, 2.9, 0);
  S.add(7, 0.9, 0.2, BAMBOO, 0, 2.1, 2.5);
  // Boards: upright in the sand in front, in a fan of colours.
  const BOARDS = [0xff2e88, 0x35f0ff, 0xffd23f, 0x7cff6b, 0xff6a00, 0xb26bff];
  for (let k = 0; k < 6; k++) {
    const x = -4.2 + k * 1.7;
    S.add(0.6, 2.6, 0.12, BOARDS[k], x, c.ground(x, 5) + 1.2, 5 + (k % 2) * 0.3);
  }
  root.add(S.mesh());
  const roof = new Mesh(faceted(new ConeGeometry(5.8, 2.8, 4)), toon({ color: 0xd9b77a }));
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.25, 1, 0.95);
  root.add(roof);
  const sign = staticCanvas(512, 128, (g) => {
    g.fillStyle = '#35f0ff';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#120a20';
    g.font = `72px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SURF', 256, 70);
  });
  const f = face(sign, 4, 1);
  f.position.set(0, 4.6, 2.62);
  root.add(f);
  return { root };
}

/** A whale out at sea: every so often it breaches, arcing up out of the water and crashing back in a splash, and blows now and then between. */
function whale(m: LandmarkDef, c: Ctx): Built {
  const every = m.params?.every ?? 80;
  const root = new Group();
  const sea = c.sea ?? 0;
  const body = new Group();
  root.add(body);
  const hide = new Mesh(faceted(new IcosahedronGeometry(1, 1)), toon({ color: 0x3b4a5c }));
  hide.scale.set(2.6, 2.4, 9);
  body.add(hide);
  const belly = new Mesh(faceted(new IcosahedronGeometry(1, 1)), toon({ color: 0xd8dce2 }));
  belly.scale.set(2.2, 1.6, 7.6);
  belly.position.set(0, -1.1, 0.6);
  body.add(belly);
  const S = solids();
  S.add(7, 0.35, 2.2, 0x33404f, 0, 0, -9.6);
  for (const x of [-2.8, 2.8]) S.add(3.6, 0.3, 1.4, 0x33404f, x, -0.8, 3);
  body.add(S.mesh());
  // The splash (and the blow): points thrown out of the water on a clock of their own.
  const splashT = { value: 0 };
  const pos: number[] = [];
  const phase: number[] = [];
  const colors: number[] = [];
  const rng = Rng.stream(0x3a, 'whale');
  for (let k = 0; k < 160; k++) {
    pos.push(0, sea, 0);
    phase.push(rng.next());
    colors.push(0.9, 0.96, 1);
  }
  const splash = animatedPoints(pos, phase, colors, 'splash', 5, splashT);
  root.add(splash);
  const BREACH = 5;
  return {
    root,
    update(t) {
      const u = (t % every) / BREACH;
      if (u < 1) {
        // Up out of the water nose first, over, and back in on its back.
        body.visible = true;
        const arc = Math.sin(u * Math.PI);
        body.position.set(0, sea - 10 + arc * 19, (u - 0.5) * 18);
        body.rotation.set(-Math.PI / 2 * (1 - u * 1.6), 0, u * 1.4);
        splash.visible = true;
        splashT.value = u < 0.5 ? u * BREACH : (u - 0.75) * BREACH;
        splash.position.z = u < 0.5 ? -6 : 9;
      } else {
        // A blow at the surface halfway to the next breach.
        const b = (t % every) - every / 2;
        body.visible = b > -1.5 && b < 4;
        body.position.set(0, sea - 1.9, 0);
        body.rotation.set(0.05, 0, 0);
        splash.visible = b > 0 && b < 2.5;
        splashT.value = b * 0.6;
        splash.position.z = 5;
      }
    },
  };
}

/** Seaplanes on the lagoon: two moored and bobbing at a jetty, and one flying a lazy circuit over the bay. */
function seaplanes(m: LandmarkDef, c: Ctx): Built {
  const root = new Group();
  const sea = c.sea ?? 0;
  const S = solids();
  // The jetty, out over the water.
  S.add(3, 0.4, 30, 0x8a6a4a, 0, sea + 1.2, 0);
  for (let z = -14; z <= 14; z += 4) for (const x of [-1.3, 1.3]) S.add(0.35, 3.4, 0.35, 0x5e4630, x, sea - 0.3, z);
  root.add(S.mesh());
  const COLORS = [0xffd23f, 0xff2e88, 0x35f0ff];
  const plane = (color: number): { root: Group; prop: Object3D } => {
    const g = new Group();
    const P = solids();
    P.add(1.4, 1.4, 8, color, 0, 2.6, 0);
    P.add(1.1, 0.9, 1.8, 0x9ee6ff, 0, 3.4, 1.8);
    P.add(11, 0.2, 1.8, color, 0, 3.4, 0.8);
    P.add(3.6, 0.15, 1.1, color, 0, 2.9, -3.6);
    P.add(0.15, 1.6, 1.2, color, 0, 3.6, -3.7);
    for (const x of [-1.5, 1.5]) {
      P.add(0.6, 0.6, 6.5, 0xf2f2f2, x, 0.3, 0.4);
      P.add(0.15, 1.8, 0.15, 0x3a3050, x, 1.3, 1.6);
      P.add(0.15, 1.8, 0.15, 0x3a3050, x, 1.3, -0.8);
    }
    g.add(P.mesh());
    const prop = new Group();
    prop.position.set(0, 2.6, 4.1);
    prop.add(box(0.2, 2.6, 0.12, 0x2a2140));
    g.add(prop);
    return { root: g, prop };
  };
  const moored = [plane(COLORS[0]), plane(COLORS[1])];
  moored[0].root.position.set(-5, sea, -6);
  moored[1].root.position.set(5, sea, 7);
  moored[1].root.rotation.y = Math.PI;
  for (const p of moored) root.add(p.root);
  const flyer = plane(COLORS[2]);
  root.add(flyer.root);
  const R = m.params?.radius ?? 160;
  const alt = m.params?.alt ?? 55;
  return {
    root,
    update(t) {
      moored.forEach((p, k) => {
        p.root.position.y = sea + 0.15 * Math.sin(t * 1.1 + k * 2);
        p.root.rotation.z = 0.03 * Math.sin(t * 0.9 + k);
      });
      // Anticlockwise round the bay, banked into the turn.
      const w = t * 0.05;
      flyer.root.position.set(Math.cos(w) * R, sea + alt + 6 * Math.sin(t * 0.2), Math.sin(w) * R * 0.6);
      flyer.root.rotation.set(0, Math.atan2(-Math.sin(w), Math.cos(w) * 0.6) + Math.PI, -0.25);
      flyer.prop.rotation.z = t * 40;
    },
  };
}

/** Each kind's builder. */
// ---- Coastal ----

/**
 * The lighthouse on Lighthouse Point (docs/COASTAL.md): a tapering tower in white and red bands on
 * a stone base, a black gallery, the lantern and a red cap, `h` m tall (params.h, default 26), and
 * a slow sweeping beam over the sea, seen from the Descent's switchbacks above.
 */
function lighthouse(m: LandmarkDef): Built {
  const root = new Group();
  const H = m.params?.h ?? 26;
  root.add(cyl(4.6, 5.2, 3, 0xb9ad94, 1.5, 10));
  const bands = 7;
  for (let k = 0; k < bands; k++) {
    const r0 = 3.4 - (k / bands) * 1.3;
    const r1 = 3.4 - ((k + 1) / bands) * 1.3;
    root.add(cyl(r1, r0, (H - 3) / bands, k % 2 ? 0xd8423a : 0xf6f1e6, 3 + ((k + 0.5) * (H - 3)) / bands));
  }
  root.add(cyl(2.9, 2.9, 0.5, 0x2a2f38, H + 0.25));
  root.add(cyl(1.5, 1.5, 2.4, 0xfff2b0, H + 1.7, 8));
  root.add(posed(new Mesh(faceted(new ConeGeometry(1.9, 1.8, 8)), toon({ color: 0xd8423a })), 0, H + 3.8, 0));
  const lamp = glowPoints([0, H + 1.7, 0], 0xfff2b0, 10);
  root.add(lamp);
  const beamMat = new MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.14, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  const cone = new ConeGeometry(10, 220, 16, 1, true).translate(0, -110, 0).rotateX(Math.PI / 2);
  const beam = new Mesh(mergeGeometries([cone, cone.clone().rotateY(Math.PI)])!, beamMat);
  beam.position.y = H + 1.7;
  root.add(beam);
  return {
    root,
    update(t) {
      beam.rotation.y = t * 0.5;
    },
  };
}

/**
 * The fort on the mountain's top (the owner: "a little empty up there"; Villefranche's Fort du Mont
 * Alban): low limestone curtain walls round a square, a bastion at each corner, a squat keep in the
 * middle with a flag. `size` m across (params.size, default 56). Each wall stands on the ground under it.
 */
function fort(m: LandmarkDef, c: Ctx): Built {
  const root = new Group();
  const S = m.params?.size ?? 56;
  const half = S / 2;
  const WALL = 0xc9bc9f;
  const DARK = 0xa8997a;
  const low = (x: number, z: number) => c.ground(x, z);
  // The curtain walls, in pieces down each side so they follow the hilltop.
  for (const [ax, az, bx, bz] of [[-half, -half, half, -half], [half, -half, half, half], [half, half, -half, half], [-half, half, -half, -half]]) {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * (k + 0.5)) / n;
      const z = az + ((bz - az) * (k + 0.5)) / n;
      const along = ax === bx ? [2.2, S / n + 0.4] : [S / n + 0.4, 2.2];
      const y = low(x, z);
      root.add(box(along[0], 7, along[1], WALL, x, y + 2.5, z));
      // Crenellations along the top.
      root.add(box(along[0] * 0.9, 1, along[1] * 0.9, DARK, x, y + 6.5, z));
    }
  }
  // A bastion at each corner: a stubby diamond, its point outward.
  for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const b = box(11, 8, 11, WALL, x, low(x, z) + 3, z);
    b.rotation.y = Math.PI / 4;
    root.add(b);
    const cap = box(11.6, 0.8, 11.6, DARK, x, low(x, z) + 7.4, z);
    cap.rotation.y = Math.PI / 4;
    root.add(cap);
  }
  // The keep, and its flag.
  const y0 = low(0, 0);
  root.add(box(16, 12, 14, WALL, 0, y0 + 5, 0));
  root.add(box(17, 1.2, 15, DARK, 0, y0 + 11.6, 0));
  root.add(box(0.3, 9, 0.3, 0x3a3340, 0, y0 + 16.5, 0));
  const flag = box(4, 2.4, 0.15, 0xe0413a, 2.1, y0 + 19.5, 0);
  root.add(flag);
  return {
    root,
    update(t) {
      flag.rotation.y = Math.sin(t * 1.3) * 0.25;
    },
  };
}

const BUILDERS: Record<string, (m: LandmarkDef, ctx: Ctx) => Built> = {
  'clock-tower': (m) => clockTower(m),
  'donut-shop': () => donutShop(),
  fountain: (m, c) => fountain(m, c.time),
  'leader-board': (m) => leaderBoard(m),
  canal: (m, c) => canal(m, c.time),
  windmill: () => windmill(),
  cow: () => cow(),
  'water-tower': (m) => waterTower(m),
  'drive-in': (_m, c) => driveIn(c),
  scarecrow: (_m, c) => scarecrow(c),
  balloon: (m) => balloon(m),
  shipwreck: () => shipwreck(),
  'tiki-head': () => tikiHead(),
  'surf-shack': (_m, c) => surfShack(c),
  whale: (m, c) => whale(m, c),
  seaplanes: (m, c) => seaplanes(m, c),
  lighthouse: (m) => lighthouse(m),
  fort: (m, c) => fort(m, c),
};
