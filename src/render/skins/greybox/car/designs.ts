// One design per car class: the side profile everything else hangs off, and the details the chase
// camera sees. Coordinates are meters in the car's frame: +z is the nose, y is up from the road.
// Each class should read at a glance from behind: the coupe's light bar and wing, the muscle car's
// quad pipes and round tails, the hatch's tall glass and vertical lamps, the van's slab back.
// The rest aren't player classes: the sedan, compact, truck and bus are traffic, and the rally car
// and the police car are here for when the sim grows a class (or a pursuit mode) for them (SPEC,
// "Car art").

import type { Livery } from './paint';

export type TailStyle = 'bar' | 'round' | 'vertical' | 'block' | 'rect' | 'dot';
export type HeadStyle = 'slit' | 'round' | 'square' | 'wide' | 'bug';
export type ExhaustStyle = 'twin' | 'quad' | 'side' | 'none';

export interface CarDesign {
  /** Top line of the body, front bottom over to rear bottom; the builder adds the sill and arches. */
  body: [number, number][];
  /** Sill height: the body's bottom edge between the wheels. */
  sill: number;
  /** The greenhouse, a closed outline sitting on the body's belt line. */
  cabin: [number, number][];
  /** Cabin width at its base and at the roof, as fractions of the car's width. */
  cabinBase: number;
  cabinRoof: number;
  /** Van-style cabins are painted with glass set into them; the rest are glass with a painted roof. */
  cabinPainted?: boolean;
  /** Plan-view taper toward the nose and tail (fraction of half-width lost at the very end). */
  noseTaper: number;
  tailTaper: number;
  wheel: { r: number; w: number; front: number; rear: number };
  head: { style: HeadStyle; y: number };
  tail: { style: TailStyle; y: number; h: number };
  exhaust: ExhaustStyle;
  /** Rear wing: height of the blade, z of the struts, chord. */
  wing?: { y: number; z: number; chord: number };
  /** Roof spoiler over the hatch glass. */
  roofSpoiler?: boolean;
  hoodScoop?: boolean;
  /** Finned diffuser under the tail (the sporty three). */
  diffuser?: boolean;
  roofRack?: boolean;
  /** Painted B-pillar position along z, blacked out. */
  pillar?: number;
  /** Door cut lines along each flank (z), drawn as ink seams. */
  doors?: number[];
  livery: Livery;
  /** Band livery height range (y), when the default car-height band is wrong (the bus). */
  band?: [number, number];
  /** Glass set into a painted cabin: side panes (z0, z1, y0, y1) and and the back glass (one pane, or a pair at ±x). */
  sideWindows?: [number, number, number, number][];
  rearWindow?: { x: number; w: number; y: number; h: number };
  /** Hood and trunk lids cut out of the body top (default on). Off for bodies with no real deck. */
  lids?: boolean;
  /** Gap between tyre and arch (default 0.08): bigger reads as raised suspension. */
  archGap?: number;
  /** Door mirrors (default), bus mirrors reaching forward from the roof corners, or none. */
  mirrors?: 'car' | 'bus';
  /** Glass doors on the right (−x) flank, sill to window top: (z0, z1). */
  glassDoors?: [number, number][];
  /** A lit destination sign across the top of the screen. */
  destination?: boolean;
  /** A box on the roof (the bus's AC unit): center z, length, width as a fraction of the roof, height. */
  roofBox?: { z: number; l: number; w: number; h: number };
  /** Rally bits: flaps behind the wheels, a scoop at the front of the roof, a pod of lamps on the nose. */
  mudFlaps?: boolean;
  roofScoop?: boolean;
  lightPod?: boolean;
  /** A box truck's cargo box, its own extrusion behind the cab: z front to back, y floor to roof. */
  cargo?: { z0: number; z1: number; y0: number; y1: number };
  /** Twin tyres on the rear axle. */
  dualRear?: boolean;
  /** A big slatted grille between the lamps, over a heavy bumper: bottom y and height. */
  grille?: { y: number; h: number };
  /** Police kit: a flashing bar of lamps on the roof and a push bar on the nose. */
  lightBar?: boolean;
  pushBar?: boolean;
}

/** Bus side glass: panes of `pane` meters with `gap`-wide painted pillars between, from z0 back to z1. */
function panes(z0: number, z1: number, n: number, y0: number, y1: number, gap = 0.12): [number, number, number, number][] {
  const pane = (z0 - z1 - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const a = z0 - i * (pane + gap);
    return [a - pane, a, y0, y1] as [number, number, number, number];
  });
}

// Sedan: the forgettable one you smash into. Three boxes, upright glass, a proper trunk step,
// plain rectangular lamps, four doors. Out here so the police car can borrow its shell.
const sedan: CarDesign = {
  body: [
    [2.25, 0.32],
    [2.27, 0.6],
    [2.17, 0.74],
    [1.1, 0.86],
    [-1.4, 0.9],
    [-2.13, 0.93],
    [-2.25, 0.87],
    [-2.25, 0.32],
  ],
  sill: 0.33,
  cabin: [
    [1.12, 0.84],
    [0.35, 1.4],
    [-0.85, 1.42],
    [-1.42, 0.94],
    [-1.42, 0.86],
  ],
  cabinBase: 0.87,
  cabinRoof: 0.72,
  // Gentle: more pinch than this creases the long flat flank in the ink pass.
  noseTaper: 0.03,
  tailTaper: 0.02,
  wheel: { r: 0.33, w: 0.25, front: 1.42, rear: -1.4 },
  head: { style: 'square', y: 0.64 },
  tail: { style: 'rect', y: 0.76, h: 0.14 },
  exhaust: 'side',
  pillar: -0.25,
  doors: [1.05, -0.2, -1.3],
  livery: 'none',
};

export const DESIGNS: Record<string, CarDesign> = {
  // Vanta: a low wedge with a fastback, a full-width light bar and a proper wing.
  coupe: {
    body: [
      [2.1, 0.3],
      [2.13, 0.52],
      [2.02, 0.64],
      [1.2, 0.8],
      [0.9, 0.84],
      [-1.5, 0.86],
      [-2.0, 0.92],
      [-2.1, 0.86],
      [-2.1, 0.3],
    ],
    sill: 0.3,
    cabin: [
      [0.95, 0.8],
      [0.15, 1.18],
      [-0.6, 1.2],
      [-1.65, 0.86],
      [-1.65, 0.8],
    ],
    cabinBase: 0.84,
    cabinRoof: 0.64,
    noseTaper: 0.16,
    tailTaper: 0.07,
    wheel: { r: 0.36, w: 0.3, front: 1.35, rear: -1.33 },
    head: { style: 'slit', y: 0.58 },
    tail: { style: 'bar', y: 0.72, h: 0.09 },
    exhaust: 'twin',
    diffuser: true,
    wing: { y: 1.18, z: -1.82, chord: 0.36 },
    pillar: -0.2,
    doors: [0.88, -0.3],
    livery: 'stripes',
  },
  // Muscle: long flat hood with a scoop, short deck with a ducktail, round tails and quad pipes.
  muscle: {
    body: [
      [2.33, 0.32],
      [2.35, 0.74],
      [2.25, 0.84],
      [0.55, 0.9],
      [-1.75, 0.92],
      [-2.26, 1.0],
      [-2.33, 0.93],
      [-2.33, 0.32],
    ],
    sill: 0.32,
    cabin: [
      [0.6, 0.86],
      [-0.12, 1.3],
      [-0.95, 1.31],
      [-1.8, 0.92],
      [-1.8, 0.86],
    ],
    cabinBase: 0.84,
    cabinRoof: 0.72,
    noseTaper: 0.05,
    tailTaper: 0.04,
    wheel: { r: 0.39, w: 0.34, front: 1.48, rear: -1.5 },
    head: { style: 'round', y: 0.62 },
    tail: { style: 'round', y: 0.74, h: 0.18 },
    exhaust: 'quad',
    diffuser: true,
    hoodScoop: true,
    pillar: -0.55,
    doors: [0.5, -0.65],
    livery: 'stripes',
  },
  // Hot hatch: tall and short, nearly upright hatch glass, roof spoiler, vertical lamps.
  hatch: {
    body: [
      [1.92, 0.3],
      [1.95, 0.6],
      [1.84, 0.72],
      [0.95, 0.86],
      [-1.8, 0.95],
      [-1.92, 0.93],
      [-1.92, 0.3],
    ],
    sill: 0.3,
    cabin: [
      [0.98, 0.84],
      [0.18, 1.42],
      [-1.62, 1.46],
      [-1.88, 0.98],
      [-1.88, 0.9],
    ],
    cabinBase: 0.88,
    cabinRoof: 0.72,
    noseTaper: 0.12,
    tailTaper: 0.06,
    wheel: { r: 0.35, w: 0.3, front: 1.3, rear: -1.28 },
    head: { style: 'square', y: 0.6 },
    tail: { style: 'vertical', y: 0.74, h: 0.34 },
    exhaust: 'side',
    roofSpoiler: true,
    diffuser: true,
    pillar: -0.45,
    doors: [0.9, -0.4, -1.3],
    livery: 'flash',
  },
  // Van: a painted slab with glass set in, a roof rack and tall corner lamps.
  van: {
    body: [
      [2.48, 0.34],
      [2.5, 0.78],
      [2.36, 0.98],
      [1.6, 1.16],
      [-2.48, 1.16],
      [-2.48, 0.34],
    ],
    sill: 0.36,
    cabin: [
      [1.62, 1.16],
      [1.02, 2.0],
      [-2.36, 2.02],
      [-2.38, 1.16],
    ],
    // Painted cabins stand on the body's top edge at full width, so the flanks meet flush.
    cabinBase: 1,
    cabinRoof: 0.92,
    cabinPainted: true,
    noseTaper: 0.1,
    tailTaper: 0.02,
    wheel: { r: 0.4, w: 0.34, front: 1.72, rear: -1.72 },
    head: { style: 'wide', y: 0.74 },
    tail: { style: 'block', y: 1.05, h: 0.62 },
    exhaust: 'side',
    roofRack: true,
    doors: [1.45, 0.1, -1.55],
    livery: 'band',
    sideWindows: [
      [0.15, 0.95, 1.3, 1.85],
      [-1.5, -0.3, 1.35, 1.85],
    ],
    rearWindow: { x: 0.45, w: 0.72, y: 1.66, h: 0.42 },
  },
  // Sedan: the forgettable one you smash into. Three boxes, upright glass, a proper trunk step,
  // plain rectangular lamps, four doors.
  sedan,
  // City bus: a long painted box with a strip of glass down each side, a flat screen under a lit
  // destination sign, small wheels set in from the ends, glass doors on the curb side, an AC unit.
  bus: {
    body: [
      [5.2, 0.42],
      [5.22, 1.05],
      [5.18, 1.28],
      [-5.18, 1.28],
      [-5.2, 1.2],
      [-5.2, 0.42],
    ],
    sill: 0.45,
    cabin: [
      [5.17, 1.28],
      [5.08, 2.86],
      [4.96, 3.0],
      [-5.08, 3.0],
      [-5.17, 2.9],
      [-5.17, 1.28],
    ],
    cabinBase: 1,
    cabinRoof: 0.96,
    cabinPainted: true,
    // Square in plan: any pinch creases ten meters of flat flank.
    noseTaper: 0,
    tailTaper: 0,
    wheel: { r: 0.5, w: 0.32, front: 3.1, rear: -2.75 },
    head: { style: 'square', y: 0.78 },
    tail: { style: 'block', y: 1.0, h: 0.5 },
    exhaust: 'none',
    livery: 'band',
    band: [0.92, 1.18],
    sideWindows: panes(4.7, -4.85, 6, 1.5, 2.45),
    rearWindow: { x: 0, w: 1.9, y: 2.28, h: 0.62 },
    lids: false,
    mirrors: 'bus',
    glassDoors: [
      [3.75, 4.85],
      [-0.35, 0.85],
    ],
    destination: true,
    roofBox: { z: -1.2, l: 2.8, w: 0.62, h: 0.3 },
  },
  // Rally: a boxy hatch jacked up on chunky tyres, mud flaps, a roof scoop, a big wing, a pod of
  // lamps on the nose and a loud livery.
  rally: {
    body: [
      [1.95, 0.42],
      [1.98, 0.7],
      [1.88, 0.82],
      [0.95, 0.96],
      [-1.8, 1.04],
      [-1.95, 1.02],
      [-1.95, 0.42],
    ],
    sill: 0.44,
    cabin: [
      [0.98, 0.94],
      [0.25, 1.5],
      [-1.55, 1.53],
      [-1.9, 1.08],
      [-1.9, 1.0],
    ],
    cabinBase: 0.88,
    cabinRoof: 0.76,
    noseTaper: 0.1,
    tailTaper: 0.05,
    wheel: { r: 0.37, w: 0.34, front: 1.3, rear: -1.28 },
    archGap: 0.17,
    head: { style: 'square', y: 0.72 },
    tail: { style: 'vertical', y: 0.86, h: 0.32 },
    exhaust: 'side',
    wing: { y: 1.62, z: -1.78, chord: 0.46 },
    pillar: -0.45,
    doors: [0.9, -0.4],
    mudFlaps: true,
    roofScoop: true,
    lightPod: true,
    livery: 'rally',
  },
  // Compact: the city car you punt across an intersection. A short rounded nose, a tall bubble of
  // glass with a domed roof, little wheels pushed out to the corners, big round friendly lamps.
  compact: {
    body: [
      [1.82, 0.3],
      [1.86, 0.5],
      [1.83, 0.62],
      [1.73, 0.73],
      [1.5, 0.82],
      [1.08, 0.87],
      [-1.62, 0.93],
      [-1.77, 0.91],
      [-1.84, 0.84],
      [-1.84, 0.3],
    ],
    sill: 0.3,
    cabin: [
      [1.1, 0.85],
      [0.55, 1.34],
      [0.3, 1.48],
      [0.02, 1.55],
      [-1.2, 1.57],
      [-1.45, 1.53],
      [-1.64, 1.38],
      [-1.78, 1.02],
      [-1.78, 0.9],
    ],
    cabinBase: 0.9,
    cabinRoof: 0.74,
    noseTaper: 0.14,
    tailTaper: 0.07,
    wheel: { r: 0.29, w: 0.24, front: 1.22, rear: -1.2 },
    head: { style: 'bug', y: 0.6 },
    tail: { style: 'dot', y: 0.76, h: 0.2 },
    exhaust: 'side',
    pillar: -0.4,
    doors: [1.0, -0.5],
    livery: 'none',
  },
  // Box truck: a flat-fronted cab with a big grille, a gap, then a tall box on the frame with a
  // band down it, twin tyres at the back. The box is its own extrusion (`cargo`).
  truck: {
    body: [
      [3.8, 0.55],
      [3.82, 1.28],
      [3.72, 1.42],
      [1.95, 1.42],
      [1.95, 1.1],
      [-3.8, 1.1],
      [-3.8, 0.55],
    ],
    sill: 0.58,
    cabin: [
      [3.7, 1.42],
      [3.5, 2.56],
      [3.36, 2.64],
      [1.99, 2.64],
      [1.99, 1.42],
    ],
    cabinBase: 1,
    cabinRoof: 0.96,
    cabinPainted: true,
    // Square in plan, like the bus: a pinch creases the long flat sides.
    noseTaper: 0,
    tailTaper: 0,
    wheel: { r: 0.5, w: 0.3, front: 2.85, rear: -2.35 },
    head: { style: 'square', y: 1.08 },
    tail: { style: 'block', y: 0.82, h: 0.4 },
    exhaust: 'none',
    doors: [3.35, 2.1],
    livery: 'band',
    band: [1.28, 1.6],
    sideWindows: [[2.2, 3.3, 1.72, 2.36]],
    lids: false,
    mirrors: 'bus',
    cargo: { z0: 1.78, z1: -3.8, y0: 1.1, y1: 3.0 },
    dualRear: true,
    grille: { y: 0.66, h: 0.56 },
  },
  // Police: the sedan's shell on bigger wheels, a black-and-white livery, a light bar and a push bar.
  police: {
    ...sedan,
    wheel: { r: 0.35, w: 0.28, front: 1.42, rear: -1.4 },
    exhaust: 'twin',
    livery: 'police',
    lightBar: true,
    pushBar: true,
  },
};
