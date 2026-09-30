// Every feel number in one place. The dev tuning panel edits this object live, and reports carry
// a copy so a replay drives with the same numbers. Car classes (content/cars) scale these.

export const TUNING = {
  gravity: 24,
  /** How fast velocity swings round to where the car points, rad/s at grip 1. */
  gripAlign: 7.5,
  /** Speed lost per second per radian of slip. */
  slipScrub: 0.7,
  /** Steering: yaw rate falls off with speed as turn / (1 + (v / steerFalloff)²·0.9). */
  steerFalloff: 30,
  steerResponse: 12,
  airDrag: 0.0008,
  rolling: 0.25,
  reverseSpeed: 9,

  boostAccel: 16,
  boostTop: 1.3,
  miniTurboAccel: 20,
  miniTurboTop: 1.15,
  miniTurboTimes: [0, 0.5, 1.0, 1.5],

  driftMinSpeed: 16,
  driftMinSteer: 0.35,
  driftHop: 2.6,
  /** Drift angle band in radians: counter-steer … full lock. */
  driftAngleMin: 0.26,
  driftAngleMax: 0.87,
  /** How fast the car's travel direction turns while drifting, rad/s: wide … tight. */
  driftArcMin: 0.45,
  driftArcMax: 1.25,
  /** Assist: how fast the body settles to the target angle, rad/s. */
  driftSettle: 3.5,
  driftScrub: 0.15,
  driftStages: [0.8, 1.8, 3.0],
  spinAngle: 1.22,
  spinTime: 1.1,

  boostFromDrift: 0.07,
  boostFromAir: 0.14,
  /** Drift points per second at full angle and 30 m/s. */
  driftPoints: 400,
  chainWindow: 1.0,

  wallRestitution: 0.2,
  wallScrape: 0.12,
  /** Impact speed into a wall (m/s along its normal) that wrecks you. */
  wallWreck: 19,
  carRestitution: 0.3,
  /** Closing speed that wrecks the car being hit. */
  takedown: 13,
  takedownBoosting: 7,

  wreckTime: 2.6,
  wreckSlowTime: 1.3,
  wreckSlowScale: 0.3,
  aftertouch: 14,
  respawnSpeed: 22,
  ghostTime: 1.5,
  resetCooldown: 3,
  outOfBounds: 25,
};

export type Tuning = typeof TUNING;
