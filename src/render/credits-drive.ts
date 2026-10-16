// The credits' stunt driver (render/credits.ts): a car doing figure 8s round two cones, and every
// figure 8 and a half, donuts round one of them. No physics, just a driver: the course steers for the
// cone's circle (for the point where it meets the circle while it's outside it), a speed, and a
// drift angle from how hard it's turning that swings through as the turn flips. Deterministic: the
// same steps give the same show, so a still (reduced motion) is always the same frame.
//
// Angles are the car's: 0 faces +z, and a positive angle turns toward +x (a car's yaw).

/** A cone the car circles: where it is, and which way round (the sign of the turn). */
interface Lap {
  cone: number;
  turn: 1 | -1;
}

export interface StuntOptions {
  /** How far the cones are from the middle, along x (m). */
  coneX: number;
  /** The figure 8's circles' radius, and the donuts' (m). */
  wide: number;
  tight: number;
}

export const STUNT: StuntOptions = { coneX: 19, wide: 5, tight: 2.4 };

/** Speeds (m/s): round the 8, through the middle on the boost, and in the donuts. */
const SPEED_WIDE = 11;
const SPEED_STRAIGHT = 17;
const SPEED_TIGHT = 8;
/** Turn rate per radian off course (1/s), and the tightest it turns, as a share of the circle's radius. */
const STEER_GAIN = 3.2;
const TIGHTEST = 0.75;
/** Drift angle per unit of turn rate (s), its limit (rad), and how fast it follows (s). */
const SLIP_PER_YAW = 0.42;
const SLIP_MAX = 1.2;
const SLIP_LAG = 0.16;
/** How many turns of donuts, and how far round its cone the car goes before it may leave for the other one (rad). */
const DONUTS = 3;
const MIN_ROUND = Math.PI * 0.9;
/** Off its course by less than this toward the next cone's circle (rad): it goes. */
const ALIGNED = 0.06;
/** Front wheels' lock (rad), as the visual's steer of 1. */
const LOCK = 0.45;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where the car is and what it's doing: what the visual needs. */
export interface Pose {
  x: number;
  z: number;
  /** Which way it's going (rad), and which way it's pointing: the course turned by the slip. */
  course: number;
  heading: number;
  speed: number;
  /** How fast the course turns (rad/s). */
  yawRate: number;
  /** The drift angle (rad): heading minus course, the same sign as the turn. */
  slip: number;
  /** Front wheels, −1 to 1 of full lock: counter-steering, along the course. */
  steer: number;
  /** On the boost (the straight through the middle). */
  boost: boolean;
  /** In the donuts. */
  donuts: boolean;
}

/** The course that takes a car at (x, z) onto a circle of radius `r` round (cx, cz), going round it `turn` ways. */
export function courseFor(x: number, z: number, cx: number, cz: number, r: number, turn: 1 | -1): number {
  const dx = x - cx;
  const dz = z - cz;
  const rho = Math.hypot(dx, dz);
  const theta = Math.atan2(dx, dz);
  // Outside: for the point where a straight line meets the circle (the tangent). Inside: along it,
  // turned out the more it's in.
  if (rho >= r) return wrap(theta + Math.PI - turn * Math.asin(r / rho));
  return wrap(theta + turn * (Math.PI / 2 - (1.2 * (r - rho)) / r));
}

export class StuntDriver {
  readonly pose: Pose;
  private lap: Lap = { cone: 0, turn: 1 };
  /** How far round the current cone (rad), and whether the donuts are done at this one. */
  private round = 0;
  private visits = 0;
  private spun = 0;
  private radius: number;
  private readonly cones: [number, number][];

  constructor(readonly opts: StuntOptions = STUNT) {
    this.cones = [
      [-opts.coneX, 0],
      [opts.coneX, 0],
    ];
    this.radius = opts.wide;
    // On the left circle's far side, going round it.
    const [cx, cz] = this.cones[0];
    const course = courseFor(cx, cz - opts.wide, cx, cz, opts.wide, 1);
    this.pose = { x: cx, z: cz - opts.wide, course, heading: course, speed: SPEED_WIDE, yawRate: 0, slip: 0, steer: 0, boost: false, donuts: false };
  }

  /** Each third cone, donuts there: every figure 8 and a half, so at one cone then the other. */
  private get donutLap(): boolean {
    return this.visits % 3 === 2;
  }

  step(dt: number): void {
    const p = this.pose;
    const { tight, wide } = this.opts;
    const [cx, cz] = this.cones[this.lap.cone];
    const next: Lap = { cone: 1 - this.lap.cone, turn: this.lap.turn === 1 ? -1 : 1 };

    // The donuts: in from the 8 halfway round, three turns, and back out to it.
    const donuts = this.donutLap && this.round > Math.PI * 0.5 && this.spun < DONUTS * Math.PI * 2;
    const target = donuts ? tight : wide;
    this.radius += (target - this.radius) * (1 - Math.exp(-dt * 1.6));

    // Off round the next cone, once far enough round this one and pointing at the next one's circle.
    const [nx, nz] = this.cones[next.cone];
    const toNext = courseFor(p.x, p.z, nx, nz, wide, next.turn);
    const leaving = !donuts && this.round > MIN_ROUND && (!this.donutLap || this.spun > 0) && Math.abs(wrap(toNext - p.course)) < ALIGNED;
    if (leaving) {
      this.lap = next;
      this.visits++;
      this.round = 0;
      this.spun = 0;
    }
    const [ax, az] = this.cones[this.lap.cone];
    const want = leaving ? toNext : courseFor(p.x, p.z, ax, az, this.radius, this.lap.turn);

    const most = p.speed / (this.radius * TIGHTEST);
    p.yawRate = clamp(STEER_GAIN * wrap(want - p.course), -most, most);
    p.course = wrap(p.course + p.yawRate * dt);
    const turned = Math.abs(p.yawRate * dt);
    this.round += turned;
    if (donuts) this.spun += turned;
    // Between the circles it's nearly straight: on the boost.
    p.boost = !donuts && Math.abs(p.yawRate) < 0.35 && Math.hypot(p.x - cx, p.z - cz) > wide * 1.1;
    const speed = donuts || this.radius < wide * 0.7 ? SPEED_TIGHT : p.boost ? SPEED_STRAIGHT : SPEED_WIDE;
    p.speed += (speed - p.speed) * (1 - Math.exp(-dt * 1.4));
    p.x += Math.sin(p.course) * p.speed * dt;
    p.z += Math.cos(p.course) * p.speed * dt;

    const slip = clamp(p.yawRate * SLIP_PER_YAW, -SLIP_MAX, SLIP_MAX);
    p.slip += (slip - p.slip) * (1 - Math.exp(-dt / SLIP_LAG));
    p.heading = wrap(p.course + p.slip);
    // The fronts point the way it's going: against the slip, up to full lock.
    p.steer = clamp(-p.slip / LOCK, -1, 1);
    p.donuts = donuts;
  }

  /** Runs `seconds` in fixed steps. */
  run(seconds: number, dt = 1 / 120): void {
    for (let t = 0; t < seconds; t += dt) this.step(dt);
  }
}
