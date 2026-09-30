// Content formats (SPEC §5, principle 7): tracks, surfaces and cars are JSON; these are their types.
// `validateLayout` in track/validate.ts checks a layout against them and the gameplay rules.

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
  takedownSpots?: { s: number; name: string }[];
  /** Scenery the skin fills in beyond the walls (not gameplay). */
  scenery?: string;
  /** Surface between the road edge and the wall (default 'sidewalk'). */
  shoulderSurface?: string;
  /**
   * Shape of the land around the lap, for scenery only (the sim drives on the road): a river's
   * course as [x, z] points, how wide it is and where its water sits.
   */
  terrain?: { river?: [number, number][]; riverWidth?: number; riverY?: number };
  /**
   * High bridges stand on timber bents, and the legs of one over another road stand on that road:
   * solid, like pillars (the Valley's trestle). Off, a flyover spans the road beneath (the city's).
   */
  trestles?: boolean;
}

export interface MapDef {
  id: string;
  name: string;
  layouts: string[];
  palette: string;
  weather: string[];
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
  /** Greybox color. */
  color: string;
}

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
