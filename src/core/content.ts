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
  /** -1 left, 1 right. */
  side: -1 | 1;
  /** Meters beyond the wall (default 2). */
  offset?: number;
  size: Vec3;
  spline?: string;
}

export interface TrafficLaneDef {
  /** Lateral offset of the lane center. */
  offset: number;
  /** 1 = with the track direction, -1 = oncoming. */
  dir: 1 | -1;
  /** m/s */
  speed: number;
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
  traffic?: { lanes: TrafficLaneDef[]; density: number };
  props?: PropDef[];
  takedownSpots?: { s: number; name: string }[];
  /** Scenery the skin fills in beyond the walls (not gameplay). */
  scenery?: string;
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

export interface CarClass {
  id: string;
  name: string;
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
