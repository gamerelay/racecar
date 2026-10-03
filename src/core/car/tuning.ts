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

  /** Boost's push and its top speed over the class's (playtest 2026-10-02: 16 and 1.3 felt weak). */
  boostAccel: 18.5,
  boostTop: 1.35,
  /** A full meter lasts the class's boostCapacity / boostDrain seconds (it was 1: it ran out too fast). */
  boostDrain: 0.8,
  /**
   * The slipstream: tucked in behind another car (within slipRange m ahead, slipWidth m either
   * side of your line, both over slipMinSpeed) the air drag drops by slipDrag and the top speed
   * rises by slipTop, easing in and out over about a third of a second. Held slipCharge s, pulling
   * out to pass is a slingshot: the top speed is slingTop over the class's for slingTime s (not
   * boost: the AI boosting past the car it was behind took it down, and the field wrecked half
   * again as often).
   */
  slipRange: 25,
  slipWidth: 2.2,
  slipMinSpeed: 20,
  slipDrag: 0.4,
  slipTop: 0.05,
  slipCharge: 1.2,
  slingTop: 0.1,
  slingTime: 1.5,
  /**
   * The straight-line build: flat out (cruiseAt of the class's top or more: drag holds a car to
   * 89–93% of it on the throttle alone), not braking, drifting or steering past cruiseSteer, on the
   * road, the top speed climbs to cruiseTop over the class's over cruiseBuild s. Braking, a drift,
   * a spin, leaving the road or a hit (a wall, a car, or the speed under cruiseLose of where the
   * build starts) ends it at once; easing off or steering lets it fade.
   */
  cruiseAt: 0.86,
  cruiseSteer: 0.35,
  cruiseTop: 0.06,
  cruiseBuild: 5,
  cruiseLose: 0.95,
  cruiseFade: 0.5,
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
  /**
   * Air time pays on a clean landing: this much meter per second in the air, for flights of at
   * least airMin s (a drift's hop and a kerb's bump don't count). Wreck on the way down and it's gone.
   */
  boostFromAir: 0.15,
  airMin: 0.45,
  /** Points per second of air, on the landing. */
  airPoints: 500,
  /**
   * A Superman: boosting through the air (at least supermanMin s of the flight) pays the air
   * time's boost this many times over, and the HUD says so.
   */
  supermanMin: 0.25,
  supermanPay: 1.5,
  /** Drift points per second at full angle and 40 m/s (the pace a drift's rewards are measured at). */
  driftPoints: 400,
  /**
   * Drift chains: start the next drift within this many seconds of the last one's end and it links
   * (an S-bend is one chain). The clock only runs between drifts.
   */
  chainWindow: 1.6,
  /** Each link multiplies a drift's points by 1 + this per link so far. */
  chainPoints: 0.25,
  /** …and its banked boost, up to chainBoostMax times. */
  chainBoost: 0.2,
  chainBoostMax: 2,

  boostFromNearMiss: 0.05,
  /** Through a slalom gate (rules/slalom.ts): boost and points, the points growing with gates in a row. */
  boostFromGate: 0.04,
  gatePoints: 200,
  boostFromOncoming: 0.04,
  boostFromCheck: 0.06,
  /**
   * Boost earned from moves (drifts, air, near misses, oncoming, checks) is scaled by race
   * position, from this for the leader to boostPlaceLast for last place: a little help to catch up.
   * All of it is boostEarn times what each move says (playtest 2026-10-02: too hard to get).
   */
  boostEarn: 1.2,
  boostPlaceLead: 0.9,
  boostPlaceLast: 1.35,
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
