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
  /** Drift charge and the release mini-turbo. Off: a drift is only a way round a corner (playtest). */
  miniTurbo: false,
  miniTurboAccel: 20,
  miniTurboTop: 1.15,
  miniTurboTimes: [0, 0.5, 1.0, 1.5],

  driftMinSpeed: 16,
  driftMinSteer: 0.6,
  driftHop: 1.4,
  /** Drift angle band in radians: counter-steer … full lock. */
  driftAngleMin: 0.26,
  driftAngleMax: 0.87,
  /** How fast the car's travel direction turns while drifting, rad/s: wide … tight. */
  driftArcMin: 0.15,
  driftArcMax: 1.25,
  /** Assist: how fast the body settles to the target angle, rad/s. */
  driftSettle: 1.7,
  /** Seconds over which the drift's arc builds up after entry, so it doesn't snap into the turn. */
  driftEase: 0.35,
  /** How fast steering changes the drift's tightness, per second (smooths the arc and angle). */
  driftSteerRate: 3,
  /** After a drift: seconds for grip to come back, so the car carries its slide out of the turn. */
  driftExit: 1.1,
  /** Grip at the moment of release, as a fraction of normal; it eases back to 1 over driftExit. */
  driftExitGrip: 0.05,
  /** Slip scrub while recovering, as a fraction of normal (a slide shouldn't dump speed). */
  driftExitScrub: 0.15,
  /** While recovering, the nose also swings back toward where the car is going, rad/s at release. */
  driftExitStraighten: 0.45,
  driftScrub: 0.06,
  driftStages: [0.8, 1.8, 3.0],
  spinAngle: 1.22,
  spinTime: 1.1,

  /**
   * Boost a drift banks per second at full angle and 40 m/s; paid into the meter when the drift
   * ends cleanly, lost on a spin-out or wreck. No kick on release, just meter (playtest).
   */
  boostFromDrift: 0.18,
  /** Smallest bank that pays out (a tap-drift earns nothing). */
  driftBankMin: 0.02,
  boostFromAir: 0.08,
  /** Drift points per second at full angle and 30 m/s. */
  driftPoints: 400,
  chainWindow: 1.0,

  boostFromNearMiss: 0.05,
  boostFromOncoming: 0.04,
  boostFromCheck: 0.06,
  nearMissGap: 1.4,
  /** Closing speed into traffic that wrecks you (unless you're checking it). */
  trafficWreck: 21,
  takedownPoints: 2000,
  /** Boost a takedown gives the attacker (Burnout gives a full bar). */
  takedownBoost: 0.5,
  /** Boost every car starts a race with. */
  startBoost: 0.2,
  startBoostWindow: 0.6,
  stallEarly: 1.6,

  wallRestitution: 0.2,
  wallScrape: 0.12,
  /** Impact speed into a wall (m/s along its normal) that wrecks you. */
  wallWreck: 25,
  carRestitution: 0.3,
  /** Closing speed that wrecks the car being hit. */
  takedown: 16,
  takedownBoosting: 9,

  wreckTime: 2.6,
  wreckSlowTime: 1.3,
  wreckSlowScale: 0.3,
  aftertouch: 14,
  respawnSpeed: 22,
  /**
   * Catch-up: boost a wreck pays on respawn in a race (not a manual reset). Everyone gets the base;
   * the rest scales with how far behind the leader you are, full at respawnBoostGap meters.
   */
  respawnBoost: 0.1,
  respawnBoostBehind: 0.5,
  respawnBoostGap: 400,
  ghostTime: 1.5,
  resetCooldown: 3,
  outOfBounds: 25,
};

export type Tuning = typeof TUNING;
