// One design per car class: the side profile everything else hangs off, and the details the chase
// camera sees. Coordinates are meters in the car's frame: +z is the nose, y is up from the road.
// Each class should read at a glance from behind: the coupe's light bar and wing, the muscle car's
// quad pipes and round tails, the hatch's tall glass and vertical lamps, the van's slab back.

import type { Livery } from './paint';

export type TailStyle = 'bar' | 'round' | 'vertical' | 'block';
export type HeadStyle = 'slit' | 'round' | 'square' | 'wide';
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
}

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
      [1.62, 1.1],
      [1.02, 2.0],
      [-2.36, 2.02],
      [-2.38, 1.1],
    ],
    cabinBase: 0.98,
    cabinRoof: 0.9,
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
  },
};
