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
  /** Where the branch leaves, and where it rejoins: distances along `leaves` and `rejoins` (the main road's by default). */
  from: number;
  to: number;
  /**
   * The roads it leaves and rejoins, by id (the road graph, CALDERA step 6e: streets meeting
   * streets): the main road unless it says, or an earlier branch (a lane off the Stairs).
   */
  leaves?: string;
  rejoins?: string;
  /**
   * 'shortcut': the AI takes it now and then. 'alternate': the long way round something (a
   * drawbridge), taken when that's in the way. 'street': a side street, a loop off the main road and
   * back that traffic comes and goes by (TrafficLaneDef.streets); open to drive, never the AI's.
   */
  kind: 'shortcut' | 'alternate' | 'street';
  /** A secret one: no sign at its mouth, and not on the minimap or the map's thumbnail. */
  secret?: boolean;
  /**
   * Whose heights it has where it leaves and rejoins: by default the bake pulls it onto the main
   * road's ground, fading to its own over JOIN_FADE m as it pulls clear (bake.ts joinBranch).
   * 'own': its heights are as authored, held to the main road's ground only where it's on the main
   * road or its verge, so whatever authors it (a generator) says exactly what it drives. It must
   * meet the main road's ground where it leaves the verge, or that's a step. Its bank still fades.
   */
  heights?: 'own';
  /**
   * The fastest the AI takes it (m/s): its racing line's cap here, so how long it reckons the way
   * takes too (a road slower than its curves say: steps, walls close either side).
   */
  limit?: number;
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
  /**
   * Side streets it comes and goes by (docs/COASTAL.md, "Traffic from side streets"; branches of
   * kind 'street', on its own side of the road, in the order it passes them), instead of `sections`:
   * its cars come down the far half of each street but the last, along the main road, and off up
   * the near half of the next, fading in and out at the streets' middles, out of sight.
   */
  streets?: string[];
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

/**
 * A house on open ground (docs/COASTAL.md: the Riviera town): a solid block in world space, standing
 * on the lowest ground under it, met as a building's wall is (scraped along, a wreck only hit hard).
 * Trees keep off it; the validator keeps every road clear of it. The skin draws its look (a key of
 * its own, the Riviera's stucco houses by default).
 */
export interface HouseDef {
  /** Its middle, [x, z] (m). */
  at: [number, number];
  /** Across its front, deep, and high to its eaves (m). */
  size: [number, number, number];
  /** Which way its front faces, radians about y (0: toward +z). */
  rot: number;
  look?: string;
  /**
   * A terrace out over its front on columns, you drive under (Coastal's hotel, its porte-cochère):
   * `depth` m out from its front, `width` across, its underside `high` m up, on `columns` columns
   * along its front edge (solid: track/bake.ts's porchColumns). The terrace itself is scenery.
   */
  porch?: { depth: number; width: number; high: number; columns: number };
}

/** The landmark kinds a layout can use. */
export const LANDMARK_KINDS = [
  // Downtown
  'clock-tower', 'donut-shop', 'fountain', 'leader-board', 'canal',
  // Backroads
  'windmill', 'cow', 'water-tower', 'drive-in', 'scarecrow', 'balloon',
  // Paradise (its lighthouse is the island's own scenery)
  'shipwreck', 'tiki-head', 'surf-shack', 'whale', 'seaplanes',
  // Coastal
  'lighthouse', 'fort',
] as const;

/**
 * A row of smashables (world/smash.ts): props of one kind on the verge of a stretch of road, every
 * `every` m, on one side or both.
 */
export interface SmashDef {
  kind: string;
  /** A row along a road: from and to (m), one every `every` m (unused with `at`). */
  s: [number, number];
  every: number;
  /** Or at these spots on open ground instead ([x, z], on the ground there; needs `ground`): bushes over a hillside. */
  at?: [number, number][];
  side?: -1 | 1;
  /** Meters out past the road's edge (default: a little under halfway to the wall). */
  lateral?: number;
  /** On a branch instead of the main road. */
  spline?: string;
}

/**
 * A breakable wall (docs/CALDERA.md, step 3b): smashables grown into wall panels, placed in world
 * space. Each panel is a wall until a car meets it at `breaks` m/s or more, then it bursts and the
 * car goes through. Down for the race, or standing again `standsAgain` s later. Needs `ground`.
 */
export interface BreakableDef {
  id: string;
  /** How it's drawn, a key of the skin's looks ('boards': a barricade of planks; 'glass': a shopfront's panes). */
  look: string;
  /** Its foot, end to end: [x, y, z], y the floor it stands on there. */
  from: [number, number, number];
  to: [number, number, number];
  /** How tall it stands (m). */
  height: number;
  /** Panels about this wide (m; default 2.5): each breaks on its own. */
  panel?: number;
  /** The speed (m/s) a car has to meet it at, square on, to break a panel; slower, it's a wall. */
  breaks: number;
  /** Seconds a broken panel stays down; unset, for the rest of the race. */
  standsAgain?: number;
}

export interface TrackLayout {
  id: string;
  name: string;
  main: SplineDef;
  branches?: BranchDef[];
  zones?: ZoneDef[];
  walls?: { gaps?: WallGap[] };
  ramps?: RampDef[];
  /** Surfaces off the ground (docs/CALDERA.md, "The core idea: pieces"): decks, tunnels, gaps. Needs `ground`. */
  pieces?: PieceDef[];
  /** 'auto' = every 1/8 of the main spline, or a list of main distances. */
  checkpoints?: 'auto' | number[];
  /** Traffic lanes on the main spline; density is cars per km per lane. */
  traffic?: { lanes: TrafficLaneDef[]; density: number };
  hazards?: HazardDef[];
  props?: PropDef[];
  landmarks?: LandmarkDef[];
  /** Houses on open ground (docs/COASTAL.md, the Riviera waterfront): solid, in world space. */
  houses?: HouseDef[];
  smashables?: SmashDef[];
  /** Breakable walls, in world space (on open ground). */
  breakables?: BreakableDef[];
  takedownSpots?: { s: number; name: string }[];
  /**
   * How the AI times its ways at a fork (`wayCosts` in ai/racer.ts): as its class drives them (the
   * default), or 'line', by the racing line alone (a corner's speed and braking, no pulling away or
   * top speed), as before. Paradise and Backroads keep 'line': some of their shortcuts are slower
   * than the road, and their rivals take them anyway, now and then (the owner's call, 2026-10-05).
   */
  aiCosts?: 'line';
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
  /** The escape hatch (core/track/overrides.ts): the map's own code for a small region, by id (core/maps). Rare. */
  overrides?: OverrideDef[];
}

/**
 * An override (docs/CALDERA.md, "Overrides: the escape hatch"): its code is in
 * core/maps/<map>/overrides.ts under `id`, and runs only inside `region`. `reason` says what the
 * engine can't do yet ("the tube's exit crest throws cars, so cap the lift here").
 */
export interface OverrideDef {
  id: string;
  reason: string;
  /**
   * A box ([x0, z0, x1, z1], m), or a stretch of a road: `s` m along it (`road`: a branch's id;
   * unset, the main road) and a band `lateral` m across it (default its road and shoulder).
   */
  region: { box: [number, number, number, number] } | { road?: string; s: [number, number]; lateral?: [number, number] };
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
  /** What grows (default `pine`, snow-laden): `tropic` is palms along the coast and jungle inland (docs/PARADISE.md). */
  kind?: 'pine' | 'tropic';
  seed: number;
  spacing: number;
  clear: number;
  thicken: number;
  density: number;
  glade: number;
}

/**
 * A piece (docs/CALDERA.md, "The core idea: pieces"): something to drive on that isn't the ground,
 * and the only way to add one. Until the road graph (step 6) a piece carries a stretch of a road
 * (its floor is the road's own plane there); later it gets its own curve.
 *
 * - A **deck**: a floor (the default). Over the ground it's a bridge (the Freeway over the bay);
 *   under it, with a ceiling, a tunnel (the Lava Tube through the volcano). A car is on the
 *   highest floor at or below it, and off a floor's edge it falls to whatever's under it.
 * - A **gap**: `floor: false`, no road at all (the Lava Tube's jump): off the end of the road is
 *   down to whatever's there.
 *
 * On a branch, either way the branch doesn't shape the ground under it (the ground stays as it is).
 * On the main road the ground is the road's, so there a piece is a deck only, and `under` says how
 * the ground falls away beneath it; gaps and ceilings are on branches only, for now. Pieces of one
 * road may share an end, not overlap.
 */
export interface PieceDef {
  id: string;
  /** The road it carries: a branch's id, or the main road (unset). */
  road?: string;
  /** From and to, m along that road. */
  s: [number, number];
  /** Whether it has a floor (default true); false is a gap. */
  floor?: boolean;
  /** Enclosed: a ceiling this high (m) over its floor, a tunnel's (the camera stays under it, and at its mouths the ground's drawn cut to its outline). */
  ceiling?: number;
  /**
   * How it's lit and sounds inside, an enclosed piece's: a key of the skin's indoor looks ('lava':
   * the Lava Tube's glow; unset, a building's own look, else 'tunnel'). Drawing and sound only: the sim never reads it.
   */
  indoor?: string;
  /**
   * Built, not dug (docs/CALDERA.md step 3c): an enclosed piece that's a building standing on the
   * ground, a hall the road runs through (Paradise Open's market hall), not a tunnel through rock.
   * Its walls are solid from both sides for every car (the road's own walls are off along it), the
   * branch shapes the ground under it as anywhere, and under its roof is indoors with no ground
   * over it. A key of the skin's building looks ('market'). Needs a ceiling.
   */
  building?: string;
  /**
   * The ground under it falls to `floor` (its height, m), easing in over `ease` m from each end and
   * back up over `reach` m past the piece's edges (the bay under the Freeway). The main road only,
   * for now: there the ground is the road's, so it has to be told to fall away.
   */
  under?: { floor: number; ease: number; reach: number };
  /** A lifting span in it (docs/COASTAL.md's drawbridge): see LiftDef. The main road only, for now. */
  lift?: LiftDef;
}

/**
 * A drawbridge (docs/COASTAL.md, "The drawbridge"; World authority, docs/CALDERA.md "Things that
 * move"): two leaves over `s` (m along the piece's road, inside the piece), each half of it, hinged
 * at its own end and meeting in the middle. Its angle is a pure function of the seed and the race
 * clock: nothing is sent online. It lifts `twice` of races twice, else once: the first warning
 * `first` s into the race (a range, seeded), a second `again` s after the first. Each lift is a
 * warning (`warn` s, down), rising to `angle` (rad) over `rise` s, up for `up` s, and down over `fall`.
 * Up to `wall` (rad) a leaf is a ramp (a car rides it and flies off its tip); steeper, it's a wall
 * and the span between is a gap.
 */
export interface LiftDef {
  s: [number, number];
  angle: number;
  wall: number;
  warn: number;
  rise: number;
  up: number;
  fall: number;
  first: [number, number];
  again: [number, number];
  twice: number;
  /**
   * The boat it lifts for (drawn only): moored `boat[0]` m across the road (+ right) before the
   * first lift, and sailing under it to `boat[1]` m across in each lift, crossing the road halfway
   * through the leaves' time up; the next lift brings it back.
   */
  boat?: [number, number];
}

/** Open ground round the main road (core/track/ground). Distances are along the main road (s) and across it (lateral, + right). */
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
  /**
   * The map's features (core/track/features), in the order they shape the ground: mogul fields,
   * canyons, beaches, uneven stretches of road. Each is placed along the main road (its `s`, and `lateral` across it), until
   * the road graph names streets.
   */
  features?: FeatureDef[];
  /** The sea's level (m): water is drawn to it, and a car on the ground under it deeper than wading is in deep water (out of bounds). */
  sea?: number;
  /**
   * An island (docs/PARADISE.md): its coastline, a closed [x, z] loop with the sea outside it (set
   * `sea`). Off the roads, past it the ground falls away under the sea; along it, a beach.
   */
  coast?: [number, number][];
  /**
   * A volcano (core/track/island.ts's cone): its middle, the crater's radius, the lip's height over
   * the sea, its foot's radius. Off the roads the ground rises over it; in the crater a lava lake
   * `lava` m over the sea, and down in that is a wreck. With `pit`, the crater is a shaft, its
   * walls falling nearly sheer to a floor `pit` m over the sea.
   */
  volcano?: { x: number; z: number; crater: number; h: number; r: number; lava: number; pit?: number };
  /**
   * Hills (docs/COASTAL.md, core/track/features/hills.ts): round domes off the roads, each its
   * middle, its height over the sea and its foot's radius (m). Shaped before the coast, so the
   * land still falls into the sea past it.
   * Cut back to the main road only, as the volcano is: a branch or a deck across one gets its
   * full height under it, so keep them off the hills until the road graph.
   */
  hills?: { x: number; z: number; h: number; r: number }[];
  /**
   * Ground rising steeper than this (rise over run) is a rock face: a car meets it as a wall instead
   * of being lifted up it (the volcano's faces round the Lava Tube's mouths). Unset: every slope is
   * driven up (Avalanche's snow walls).
   */
  face?: number;
}

/** Mogul field: bumps `height` m high, `spacing` m apart, over s × lateral. */
export interface MogulsDef {
  kind: 'moguls';
  s: [number, number];
  lateral: [number, number];
  height: number;
  spacing: number;
}

/**
 * Canyon: a trench beside or along the road, a flat floor `floor` m wide and walls curving up
 * `depth` m (at most about 60° at the lip), centered `lateral` m across, easing in and out over
 * `ease` m at its ends. The AI may run its floor; the avalanche goes over a car down in it.
 */
export interface CanyonDef {
  kind: 'canyon';
  s: [number, number];
  lateral: number;
  floor: number;
  depth: number;
  ease: number;
}

/**
 * Beach along the main road (Paradise Open: town to the Freeway): off its `side` from `s[0]` to
 * `s[1]` m (wrapping past the line if `s[0]` is the larger), the ground between the road and the
 * sea is sand, drawn and driven. Its ends fade over BEACH_FADE m.
 */
export interface BeachDef {
  kind: 'beach';
  s: [number, number];
  side: 'left' | 'right';
}

/**
 * A sea wall (docs/COASTAL.md, "The sea wall"; Coastal's waterfront, the owner: water, not a
 * beach, against a retaining wall): off one side of the main road from `s[0]` to `s[1]` m (through
 * the lap's end if `s[0]` > `s[1]`), the ground drops sheer just past the road's verge (a quay's
 * edge, features/seawall.ts SEAWALL_LEDGE) to `floor` m (under the sea), easing back to the
 * ground's own a few tens of meters out. The layout keeps a wall on that side there; a stone ledge
 * runs from it to the quay's edge and a stone face down into the water.
 */
export interface SeawallDef {
  kind: 'seawall';
  s: [number, number];
  side: 'left' | 'right';
  floor: number;
}

/**
 * An uneven stretch of the main road (Paradise Open's jungle mud), from `s[0]` to `s[1]` m: lumps
 * up to about `height` m peak to trough, `size` m across, on the road and its shoulder.
 */
export interface UnevenDef {
  kind: 'uneven';
  s: [number, number];
  height: number;
  size: number;
}

/**
 * A lava stream (docs/CALDERA.md, "A feature, end to end"): a channel `width` m wide (its floor)
 * and `depth` m deep along `path` ([x, z] points, in world space), its banks rock, lava in it.
 * Off the roads: the validator wants it clear of every road.
 */
export interface LavaStreamDef {
  kind: 'lava-stream';
  path: [number, number][];
  width: number;
  depth: number;
}

export type FeatureDef = MogulsDef | CanyonDef | BeachDef | UnevenDef | LavaStreamDef | SeawallDef;

export interface MapDef {
  id: string;
  name: string;
  layouts: string[];
  palette: string;
  /** The palette for a race at sunset, if the map has one (the lobby's Time). */
  sunset?: string;
  /** What weather it gets: `clear`, `rain`, `shower` for rain that passes, and `rare` for it seldom (world/weather.ts). */
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
