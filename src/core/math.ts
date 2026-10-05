// Small numeric helpers. Everything here works on plain numbers so the hot path never allocates.
// Below them, the sim's own sin, cos, exp and the rest: src/core uses those, never Math's.

const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v < 0 ? -1 : 1);

/** Moves `v` toward `target` by at most `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Frame-rate independent exponential smoothing factor for a rate in 1/s. */
export const damp = (rate: number, dt: number): number => 1 - exp(-rate * dt);

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Headings: 0 faces +z, and h grows toward +x, which is the car's left (y up, right-handed).
// forward = (sin h, cos h), right = (-cos h, sin h). Steering right (steer > 0) lowers h.

/** Meters per second to miles per hour: what the speedometer reads. */
export const MPH = 2.2369363;

// ---------------------------------------------------------------------------------------------
// The same math on every platform (docs/CALDERA.md, "Same math in every browser").
//
// JavaScript lets Math.sin, Math.exp, `**` and the like differ in their last bits between
// engines, OSes and CPUs (the golden fingerprints showed it: macOS and Linux disagree on the same
// CPU). So src/core never calls them (test/math.test.ts checks), only these: fdlibm's algorithms,
// which most engines started from, written with + - * / and Math.sqrt alone, which IEEE 754 makes
// exact everywhere. Every platform then computes the same bits: one set of golden fingerprints,
// replays exact across browsers. Each is within an ulp of Math's (tan 3; pow up to ~40 squaring a
// whole power, more by exp and log for big ones: see it), test/math.test.ts measures them.

/** x², without `**`, whose pow isn't the same everywhere. */
export const sq = (x: number): number => x * x;

/** The length of (x, y) or (x, y, z): the plain sqrt of the sum (no overflow at the game's sizes). */
export const hypot = (x: number, y: number, z = 0): number => Math.sqrt(x * x + y * y + z * z);

// A double's bits, for exp's scaling and log's reduction. Big-endian on purpose, so it reads the
// same on every CPU.
const bits = new DataView(new ArrayBuffer(8));

/** 2^k for an integer k in [-1022, 1023], exactly. */
function pow2(k: number): number {
  bits.setUint32(0, (k + 1023) << 20);
  bits.setUint32(4, 0);
  return bits.getFloat64(0);
}

// sin, cos and tan: x less a whole number n of π/2 (Cody-Waite: π/2 in 33-bit parts, so each
// n·part is exact), then fdlibm's kernels on [-π/4, π/4].
const PIO4 = 0.7853981633974483;
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417; // π/2's first 33 bits
const PIO2_2 = 6.0771005063039659766e-11; // the next 33
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21; // and the next
const PIO2_3T = 8.47842766036889956997e-32;
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin(x + y) for |x + y| ≤ π/4, y being x's tail. */
function kSin(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x + y| ≤ π/4. */
function kCos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const one = 1 - hz;
  return one + (((1 - one) - hz) + (z * r - x * y));
}

// What reduce() leaves, so nothing allocates: the reduced angle (head and tail) and the quarter turn.
let rHi = 0;
let rLo = 0;
let quarter = 0;

function reduce(x: number): void {
  // Past 2^20·π/2 (or not finite), wrap by TAU first: no angle in the game gets there, so out
  // there it's far from Math's (TAU isn't 2π exactly) but still the same everywhere (`%` is exact
  // in IEEE 754; NaN and ±Infinity stay NaN).
  if (!(x < 1647099 && x > -1647099)) x %= TAU;
  const n = Math.round(x * INV_PIO2);
  const t = x - n * PIO2_1; // exact
  const w2 = n * PIO2_2;
  let r = t - w2;
  let w = n * PIO2_2T - ((t - r) - w2);
  rHi = r - w;
  // Near a multiple of π/2 most bits cancel: once more, with the next part (fdlibm's third round).
  if (Math.abs(rHi) < Math.abs(x) * 1.7763568394002505e-15) {
    const t3 = r;
    const w3 = n * PIO2_3;
    r = t3 - w3;
    w = n * PIO2_3T - ((t3 - r) - w3);
    rHi = r - w;
  }
  rLo = (r - rHi) - w;
  quarter = n & 3;
}

export function sin(x: number): number {
  if (x < PIO4 && x > -PIO4) return x < 7.45e-9 && x > -7.45e-9 ? x : kSin(x, 0);
  reduce(x);
  switch (quarter) {
    case 0:
      return kSin(rHi, rLo);
    case 1:
      return kCos(rHi, rLo);
    case 2:
      return -kSin(rHi, rLo);
    default:
      return -kCos(rHi, rLo);
  }
}

export function cos(x: number): number {
  if (x < PIO4 && x > -PIO4) return x < 7.45e-9 && x > -7.45e-9 ? 1 : kCos(x, 0);
  reduce(x);
  switch (quarter) {
    case 0:
      return kCos(rHi, rLo);
    case 1:
      return -kSin(rHi, rLo);
    case 2:
      return -kCos(rHi, rLo);
    default:
      return kSin(rHi, rLo);
  }
}

/** tan, as sin over cos from one reduction. */
export function tan(x: number): number {
  if (x < PIO4 && x > -PIO4) return x < 7.45e-9 && x > -7.45e-9 ? x : kSin(x, 0) / kCos(x, 0);
  reduce(x);
  const s = kSin(rHi, rLo);
  const c = kCos(rHi, rLo);
  return quarter & 1 ? -c / s : s / c;
}

// atan: fdlibm's, in four bands around 0.5, 1, 1.5 and ∞, with a polynomial on what's left.
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;

export function atan(x: number): number {
  if (x !== x) return x;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e19) return neg ? -(ATAN_HI[3] + ATAN_LO[3]) : ATAN_HI[3] + ATAN_LO[3];
  let id = -1;
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x;
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return neg ? -(a - a * (s1 + s2)) : a - a * (s1 + s2);
  const r = ATAN_HI[id] - ((a * (s1 + s2) - ATAN_LO[id]) - a);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16; // π - Math.PI

/** The angle of (x, y), as Math.atan2 gives it, signed zeros and infinities included. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : 1 / y > 0 ? Math.PI : -Math.PI;
  if (x === 0) return y > 0 ? Math.PI / 2 : -Math.PI / 2;
  const ay = y < 0 ? -y : y;
  const ax = x < 0 ? -x : x;
  if (ax === Infinity) {
    if (ay === Infinity) return x > 0 ? (y > 0 ? PIO4 : -PIO4) : y > 0 ? 3 * PIO4 : -3 * PIO4;
    return x > 0 ? (y > 0 ? 0 : -0) : y > 0 ? Math.PI : -Math.PI;
  }
  if (ay === Infinity) return y > 0 ? Math.PI / 2 : -Math.PI / 2;
  const ratio = ay / ax;
  if (ratio > 18446744073709551616) return y > 0 ? Math.PI / 2 : -Math.PI / 2; // past 2^64, as fdlibm
  const z = x < 0 && ratio < 5.421010862427522e-20 ? 0 : atan(ratio);
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? Math.PI - (z - PI_LO) : (z - PI_LO) - Math.PI;
}

// exp: x = k·ln 2 + r with |r| ≤ ln 2 / 2, a rational approximation of e^r, then times 2^k.
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  if (x !== x) return x;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  let hi = x;
  let lo = 0;
  let k = 0;
  if (x > 0.34657359027997264 || x < -0.34657359027997264) {
    k = Math.round(x * INV_LN2);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  } else if (x < 3.725290298461914e-9 && x > -3.725290298461914e-9) return 1 + x;
  const xx = x * x;
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  if (k === 0) return y;
  // In two steps where 2^k alone would leave the normal doubles.
  if (k > 1023) return y * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return y * pow2(k + 1000) * pow2(-1000);
  return y * pow2(k);
}

// log: x = 2^k·m with m in [√2/2, √2], then fdlibm's series in s = (m - 1)/(m + 1).
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    k = -54;
    x *= 18014398509481984; // 2^54: out of the subnormals
  }
  bits.setFloat64(0, x);
  let hx = bits.getUint32(0) + (0x3ff00000 - 0x3fe6a09e);
  k += (hx >>> 20) - 0x3ff;
  hx = (hx & 0x000fffff) + 0x3fe6a09e;
  bits.setUint32(0, hx);
  const f = bits.getFloat64(0) - 1;
  const hfsq = 0.5 * f * f;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  return s * (hfsq + (t2 + t1)) + k * LN2_LO - hfsq + f + k * LN2_HI;
}

/**
 * x to the power y, with Math.pow's special values. Whole powers up to 64 by squaring (each
 * squaring doubles the error, so no further), y = 0.5 as sqrt, otherwise e^(y·ln x), which loses up
 * to about 2·|y·ln x| ulp (12 at worst at the game's sizes).
 */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === Math.floor(y) && y >= -64 && y <= 64) {
    let r = 1;
    let b = x;
    for (let n = y < 0 ? -y : y; n > 0; n >>= 1) {
      if (n & 1) r *= b;
      b *= b;
    }
    // A negative power whose x^|y| overflowed would come out 0, not subnormal: exp scales it below.
    if (y > 0 || Math.abs(r) !== Infinity) return y < 0 ? 1 / r : r;
  }
  const ax = x < 0 ? -x : x;
  if (y === Infinity || y === -Infinity) return ax === 1 ? NaN : ax > 1 === y > 0 ? Infinity : 0;
  // A whole y here is past 64 (or under -64, or overflowed); an odd one keeps x's sign.
  const odd = y === Math.floor(y) && y % 2 !== 0;
  if (ax === Infinity || x === 0) {
    const big = ax === Infinity === y > 0;
    return x < 0 || Object.is(x, -0) ? (odd ? (big ? -Infinity : -0) : big ? Infinity : 0) : big ? Infinity : 0;
  }
  if (x > 0) return y === 0.5 ? Math.sqrt(x) : exp(y * log(x));
  if (y !== Math.floor(y)) return NaN;
  const r = exp(y * log(-x));
  return odd ? -r : r;
}
