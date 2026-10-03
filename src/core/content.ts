// Content formats (SPEC §5, principle 7): tracks, surfaces and cars are JSON; these are their types.
// `validateLayout` in track/validate.ts checks a layout against them and the gameplay rules.

import { hash01 } from './rng';

export type Vec3 = [number, number, number];

export interface TrackPoint {
  /** Position of this control point in meters (y up). */
  p: Vec3;
  /** Road width in meters (the drivable asphalt). */
  width: number;
  lanes?: number;
  /** Bank angle in radians; positive tilts the road's right edge down. */
  bank?: number;
  /** Default surface id for this stretch (see surfaces.json). */
  surface?: string;
  /** Run-off between the road edge and the wall, in meters (default 4). */
  shoulder?: number;
  /** The ground past the road's edge on this stretch (a surface id; default the layout's `shoulderSurface`). */
  verge?: string;
}

export interface SplineDef {
  points: TrackPoint[];
}

export interface BranchDef extends SplineDef {
  id: string;
  /** Main-spline distance where the branch leaves, and where it rejoins. */
  from: number;
  to: number;
  kind: 'shortcut' | 'alternate';
  /** A secret one: no sign at its mouth, and not on the minimap or the map's thumbnail. */
  secret?: boolean;
}

export interface ZoneDef {
  /** Distance range on the spline (main unless `spline` names a branch). */
  s: [number, number];
  /** Lateral range, meters from the centerline (negative = left). */
  lateral: [number, number];
  surface: string;
  /** Only active in this weather. */
  when?: 'wet' | 'dry';
  spline?: string;
}

export interface WallGap {
  s: [number, number];
  side: 'left' | 'right' | 'both';
  spline?: string;
}

export interface RampDef {
  s: number;
  height: number;
  length: number;
  spline?: string;
  /**
   * A rounded kicker: the rise curves up from flat (h ∝ u^1.5, its lip 1.5× as steep as a straight
   * one's), and past the lip the ground rolls back down over `back` m instead of dropping straight
   * to the road. Flat at the top of that roll, so the lip still launches you. Unset: a straight
   * wedge with a sheer back.
   */
  back?: number;
  /**
   * Sides you can launch off: past the road's edge (and its shoulder) the kicker's height runs out
   * over this many meters, a grass bank, instead of standing the whole width of the world. Driven
   * up from the side, it throws you across the road. Unset: the height is the same however far out.
   */
  flank?: number;
}

export interface PropDef {
  kind: string;
  s: number;
  /** -1 left, 1 right (beyond the wall). */
  side?: -1 | 1;
  /** Meters beyond the wall (default 2). */
  offset?: number;
  /** On the road instead: meters from the centerline. Props on the road are solid. */
  lateral?: number;
  size: Vec3;
  spline?: string;
}

export interface TrafficLaneDef {
  /** Lane center as a fraction of the half width: -1 left edge … 1 right edge (0.5 = middle of the right half). */
  pos: number;
  /** 1 = with the track direction, -1 = oncoming. */
  dir: 1 | -1;
  /** m/s */
  speed: number;
  /**
   * Stretches of the main spline (distance ranges) where this lane has traffic; everywhere if
   * left out. Traffic belongs on the traffic-heavy section of a lap, not in every hairpin.
   */
  sections?: [number, number][];
}

export interface HazardDef {
  /** A hazard kind (core/world/hazards.ts), e.g. 'log-truck', 'falling-sign'. */
  use: string;
  /** Where on the main spline: a range for roaming hazards, a point for fixed ones. */
  s: number | [number, number];
  side?: -1 | 1;
  /** Kind-specific numbers (mean interval, lifetime…). */
  params?: Record<string, number>;
  /** Only at this mayhem (the island's lava rain is chaos's alone); at every level but off by default. */
  mayhem?: 'normal' | 'chaos';
}

/**
 * Something you remember a lap by (PLAN phase 6): scenery only, built by the skin, the same every
 * race. Some move, and some show the race (a clock, the leader's plate).
 */
export interface LandmarkDef {
  /** Which landmark (LANDMARK_KINDS; the greybox builds each in render/skins/greybox/landmarks.ts). */
  kind: string;
  /** Where its middle stands, [x, z] in meters. */
  at: [number, number];
  /** Which way its front faces, radians about y (0: toward +z). */
  rot?: number;
  /**
   * Ground kept clear round it (m): the scenery leaves it empty, and the validator keeps every road
   * that far off. 0 for things with their own footprint check or none (a canal, the sea, the sky).
   */
  r: number;
  /** Kind-specific numbers (a height, a length), and `scale` for any kind. */
  params?: Record<string, number>;  /** Words it shows (the water tower's town name). */
  label?: string;
}

/** The landmark kinds a layout can use. */
export const LANDMARK_KINDS = [
  // Downtown
  'clock-tower', 'donut-shop', 'fountain', 'leader-board', 'canal',
  // Backroads
  'windmill', 'cow', 'water-tower', 'drive-in', 'scarecrow', 'balloon',
  // Paradise (its lighthouse is the island's own scenery)
  'shipwreck', 'tiki-head', 'surf-shack', 'whale', 'seaplanes',
] as const;

/**
 * A row of smashables (world/smash.ts): props of one kind on the verge of a stretch of road, every
 * `every` m, on one side or both.
 */
export interface SmashDef {
  kind: string;
  s: [number, number];
  every: number;
  side?: -1 | 1;
  /** Meters out past the road's edge (default: a little under halfway to the wall). */
  lateral?: number;
  /** On a branch instead of the main road. */
  spline?: string;
}

export interface TrackLayout {
  id: string;
  name: string;
  main: SplineDef;
  branches?: BranchDef[];
  zones?: ZoneDef[];
  walls?: { gaps?: WallGap[] };
  ramps?: RampDef[];
  /** 'auto' = every 1/8 of the main spline, or a list of main distances. */
  checkpoints?: 'auto' | number[];
  /** Traffic lanes on the main spline; density is cars per km per lane. */
  traffic?: { lanes: TrafficLaneDef[]; density: number };
  hazards?: HazardDef[];
  props?: PropDef[];
  landmarks?: LandmarkDef[];
  smashables?: SmashDef[];
  takedownSpots?: { s: number; name: string }[];
  /** Scenery the skin fills in beyond the walls (not gameplay). */
  scenery?: string;
  /** Surface between the road edge and the wall (default 'sidewalk'). */
  shoulderSurface?: string;
  /**
   * Shape of the land around the lap, for scenery only (the sim drives on the road): a river's
   * course as [x, z] points, how wide it is and where its water sits. An island has a sea level,
   * its coastline (a closed [x, z] loop; the sea is outside it), and maybe a volcano: a cone to
   * `h` m at its lip, `r` m out to its foot, with a crater `crater` m in radius.
   */
  terrain?: {
    river?: [number, number][];
    riverWidth?: number;
    riverY?: number;
    sea?: number;
    island?: [number, number][];
    volcano?: { x: number; z: number; r: number; h: number; crater: number };
  };
  /**
   * High bridges stand on timber bents, and the legs of one over another road stand on that road:
   * solid, like pillars (the Valley's trestle). Off, a flyover spans the road beneath (the city's).
   */
  trestles?: boolean;
  /**
   * Open ground (docs/AVALANCHE.md): a heightfield the car drives on everywhere, in the sim and
   * drawn, instead of the road's plane carried outward. Shaped round the main road: the road's
   * height along it, then off it whatever `GroundDef` adds. Out of bounds is the ground's walls.
   */
  ground?: GroundDef;
  /**
   * One run, not laps (docs/AVALANCHE.md): the main road is open, top to bottom, and a race is one
   * run from `start` to `finish` (m along it). The grid stands behind `start`; past `finish` is
   * the run-out. Without it the main road is a loop and the line is s = 0.
   */
  run?: { start: number; finish: number };
  /** Slalom gates on the main road (core/rules/slalom.ts): a pair of flags each, smashable. */
  slalom?: SlalomGate[];
  /** A ski jump on the main road: its lip's edge (m along it) and the landing hill below (m long), for the lines painted on it. */
  skiJump?: { lip: number; landing: number };
  /** One run's avalanche, at chaos (core/world/avalanche.ts). */
  avalanche?: AvalancheDef;
}

/** A slalom gate: its middle `lateral` m across the main road at `s`, its flags `gap` m apart. */
export interface SlalomGate {
  s: number;
  lateral: number;
  gap: number;
}

/** An avalanche down a run: it breaks away `behind` m above the start line, `delay` s after the green light, at about `speed` m/s on a 20% slope. */
export interface AvalancheDef {
  behind: number;
  delay: number;
  speed: number;
}

/**
 * Pines scattered on open ground (core/track/pines.ts): candidates every `spacing` m (jittered),
 * none within `clear` m of the piste's edge, thickening to `density` (0–1) over the next `thicken`
 * m and up the walls, in glades (noise `glade` m wide), from `seed`.
 */
export interface PinesDef {
  seed: number;
  spacing: number;
  clear: number;
  thicken: number;
  density: number;
  glade: number;
}

/** Open ground round the main road (core/track/ground.ts). Distances are along the main road (s) and across it (lateral, + right). */
export interface GroundDef {
  /** Grid cell (m). */
  cell: number;
  /** Past this far from the main road's middle the ground rises into walls, `wallRise` m per m. */
  wallFrom: number;
  wallRise: number;
  /** How far up the walls (m past `wallFrom`) the ground is drawn, plus 20 m, at its narrowest (default 25). All of it is in bounds. */
  wallOut?: number;
  /** Long, low rolls everywhere, the road too: this high (m, peak to trough), this wide (m). */
  swell?: { height: number; size: number };
  /** Bumps off the road: up to this high (m), this wide (m). */
  rough?: { height: number; size: number };
  /** Pines on the open snow (core/track/pines.ts), solid. */
  pines?: PinesDef;
  /** Mogul fields: bumps `height` m high, `spacing` m apart, over s × lateral. */
  moguls?: { s: [number, number]; lateral: [number, number]; height: number; spacing: number }[];
  /**
   * Canyons: a trench beside or along the road, a flat floor `floor` m wide and walls curving up
   * `depth` m (at most about 60° at the lip), centered `lateral` m across, easing in and out over
   * `ease` m at its ends.
   */
  canyons?: { s: [number, number]; lateral: number; floor: number; depth: number; ease: number }[];
}

export interface MapDef {
  id: string;
  name: string;
  layouts: string[];
  palette: string;
  /** The palette for a race at sunset, if the map has one (the lobby's Time). */
  sunset?: string;
  /** What weather it gets: `clear`, `rain`, and `shower` for rain that passes (world/weather.ts). */
  weather: string[];
  /**
   * Not for a release (docs/AVALANCHE.md): out of the lobby, the map lists and the validator. Its
   * layouts open from a link (`?mode=free&map=<key>`).
   */
  experimental?: boolean;
}

/** A race's time of day: a map with a sunset palette can be raced by day or at sunset. */
export type TimeOption = 'day' | 'sunset' | 'random';

/** The palette a race on `map` at `time` uses; random is seeded, so every player sees the same. */
export function paletteFor(map: MapDef, time: TimeOption, seed: number): string {
  if (!map.sunset || time === 'day') return map.palette;
  if (time === 'sunset') return map.sunset;
  return hash01(seed, 0x7143) < 0.35 ? map.sunset : map.palette;
}

export interface SurfaceDef {
  id: string;
  /** Multiplies the car's grip. */
  grip: number;
  /** Extra drag, 1/s. Negative speeds you up (boost pads). */
  drag: number;
  /** Multiplies drift mini-turbo charging. */
  driftCharge: number;
  /** How easily a drift starts (1 = asphalt). */
  looseness: number;
  offroad?: boolean;
  /**
   * How much the ground's slope pulls you along it (0–1, default 0): downhill faster, uphill
   * slower, sideways down a bank. Snow's 1; the roads' are 0, so the other maps drive as tuned.
   * Above top speed on it, the engine stops holding you back (a steep pitch takes you past it).
   */
  slide?: number;
  /** Greybox color. */
  color: string;
}

/**
 * Layout keys ("map/layout") that were renamed, old to new: links, saved choices and F8 reports
 * made before the rename still load (City became Downtown, Countryside became Backroads).
 */
export const LAYOUT_ALIASES: Readonly<Record<string, string>> = {
  'city/downtown': 'downtown/downtown',
  'countryside/valley': 'backroads/valley',
};
const MAP_ALIASES: Readonly<Record<string, string>> = { city: 'downtown', countryside: 'backroads' };

/**
 * The layout key `key` means, among `keys`: itself, what it was renamed to, or a map's first
 * layout for a bare map id ("downtown", or an old one like "city"). Undefined if none.
 */
export function resolveLayout(key: string | null | undefined, keys: readonly string[]): string | undefined {
  if (!key) return undefined;
  if (keys.includes(key)) return key;
  const renamed = LAYOUT_ALIASES[key];
  if (renamed && keys.includes(renamed)) return renamed;
  const map = MAP_ALIASES[key] ?? key;
  return keys.find((k) => k.startsWith(map + '/'));
}

/** Paint ids that were renamed, old to new. */
export const PAINT_ALIASES: Readonly<Record<string, string>> = { 'hot-pink': 'pink' };

/** Every car class, in picker order (content/cars/<id>.json). AI fields cycle through it. */
export const CLASS_ORDER = ['coupe', 'muscle', 'hatch', 'van', 'sedan', 'rally', 'bus', 'police'] as const;

export interface CarClass {
  id: string;
  name: string;
  /** One line for the car picker: what it's good at. */
  blurb?: string;
  /** m/s without boost */
  topSpeed: number;
  /** m/s² at low speed */
  accel: number;
  /** m/s² */
  brake: number;
  /** rad/s at low speed */
  turn: number;
  /** 1 = reference grip */
  grip: number;
  /** kg, for collisions */
  mass: number;
  /** boost meter size, seconds of boost from full */
  boostCapacity: number;
  /** multiplies drift charging */
  drift: number;
  /** how quickly the car reaches its drift angle, 1 = reference */
  driftRotation: number;
  /** how long the car carries its slide after a drift, 1 = reference (TUNING.driftExit) */
  driftCarry?: number;
  /** 0–1: how much of an offroad surface's lost grip and extra drag the car shrugs off (rally tyres). */
  offroad?: number;
  /** half extents in meters: width, length, height */
  size: Vec3;
}

export interface PaintDef {
  id: string;
  name: string;
  color: string;
  finish: 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome';
  secondary?: string;
  underglow?: string;
}
