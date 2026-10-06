import type { Grade } from '../../skin';

// Palettes from the prototype. Dusk is City's signature look; midnight its rain/night variant.
// Tropic is Paradise's high noon, a 2000s-postcard beach: a deep blue sky, a hard sun, a clear
// turquoise sea and saturated greens, graded rich with blue-green shadows and a light vignette.
// Sunset is its evening: a low whole sun over the sea, a pink-to-orange sky and violet shadows.
// Riviera is the Côte d'Azur's (docs/COASTAL.md, "The look and the sound"): a dry, bright summer
// day, olive and sage on the hills, warm stone, and a deep blue sea, clear only by the shore.

export interface Palette {
  top: number;
  mid: number;
  horizon: number;
  sun: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  dir: number;
  dirIntensity: number;
  /** Greybox building tints. */
  blocks: number[];
  ground: number;
  /** Outline ink. */
  ink: number;
  /** Lit-window brightness on city blocks (0: none). */
  windows: number;
  /** A daytime sky: the sun high and whole, no stars. */
  day?: boolean;
  /** A sunset sky: the sun low but whole (no synthwave bands), a wide glow, no stars. */
  sunset?: boolean;
  /** Where the sun light comes from, relative to the camera (default high behind: -300, 400, -800). */
  sunFrom?: [number, number, number];
  /**
   * How far rain clouds the sky over and dims the light, 0–1 (default 1). A tropical shower is
   * low: the sun stays out.
   */
  overcast?: number;
  /** Multiplies the sea's color (a warm, dimmer sea at sunset). */
  seaLight?: number;
  /** The sea's colors by depth: over the sand, out past it, the deep (default Paradise's turquoise lagoon). Raw: written out as given, not converted from sRGB like the rest. */
  sea?: [number, number, number];
  /** How some surfaces are drawn here, by id (default each one's own color: content/surfaces.json). Drawn only. */
  surfaces?: Record<string, string>;
  /** The post pass's grade (none: as rendered). */
  grade?: Grade;
}

/** Riviera's pavements pale, warm stone, and its asphalt a warm grey (the city's are purple). */
const RIVIERA_SURFACES = { sidewalk: '#c8b89a', asphalt: '#4f4b50' };

export const PALETTES: Record<string, Palette> = {
  dusk: {
    top: 0x1b0b45,
    mid: 0xa4247a,
    horizon: 0xff8a3d,
    sun: 0xffd23f,
    fog: 0xc2406f,
    fogNear: 120,
    fogFar: 900,
    hemiSky: 0xffb0d8,
    hemiGround: 0x2a1045,
    hemiIntensity: 1.4,
    dir: 0xffd6a8,
    dirIntensity: 1.9,
    blocks: [0x3b2a5c, 0x2e3b63, 0x5a2f55, 0x24324a, 0x46345e, 0x33264a, 0x402a48],
    ground: 0x1c1432,
    ink: 0x120a20,
    windows: 1,
  },
  golden: {
    top: 0x2d4f9a,
    mid: 0xe49a6a,
    horizon: 0xffcf7a,
    sun: 0xfff2b8,
    fog: 0xe6b98a,
    fogNear: 160,
    fogFar: 1100,
    hemiSky: 0xffe6bf,
    hemiGround: 0x4a5a2e,
    hemiIntensity: 1.5,
    dir: 0xffe2b0,
    dirIntensity: 2.2,
    blocks: [0x3f6b3a, 0x4f7d3a, 0x2f5a32, 0x5b7f36, 0x8a6a45],
    ground: 0x5f7d3c,
    ink: 0x2a1c14,
    windows: 0.4,
  },
  tropic: {
    top: 0x0a4fd0,
    mid: 0x2f97f2,
    horizon: 0x8fdcff,
    sun: 0xfff6d0,
    fog: 0x86d2f2,
    fogNear: 320,
    fogFar: 2300,
    hemiSky: 0xc4ecff,
    hemiGround: 0x2f7a3a,
    hemiIntensity: 1.3,
    dir: 0xfff0c8,
    dirIntensity: 2.7,
    blocks: [0xf2a7a0, 0x9fd9c8, 0xf6d38a, 0xa7c4f2, 0xf0b6d6, 0xbfe3a0],
    ground: 0x3fae3a,
    ink: 0x14282a,
    windows: 0.2,
    day: true,
    overcast: 0.3,
    grade: { saturation: 1.3, contrast: 1.08, shadow: 0x7fc8e6, vignette: 0.22 },
  },
  riviera: {
    top: 0x1748b0,
    mid: 0x3f8ee4,
    horizon: 0xc4e2f6,
    sun: 0xfff6dc,
    fog: 0xbcd8ec,
    fogNear: 320,
    fogFar: 2300,
    hemiSky: 0xdcecff,
    hemiGround: 0x8a7650,
    hemiIntensity: 1.3,
    dir: 0xfff0d2,
    dirIntensity: 2.7,
    blocks: [0xf2a7a0, 0x9fd9c8, 0xf6d38a, 0xa7c4f2, 0xf0b6d6, 0xbfe3a0],
    ground: 0x7f8f4c,
    ink: 0x2a2018,
    windows: 0.2,
    day: true,
    overcast: 0.3,
    sea: [0x5cc9c6, 0x1c62a8, 0x0a2c6a],
    surfaces: RIVIERA_SURFACES,
    grade: { saturation: 1.14, contrast: 1.1, shadow: 0x6f8cc8, vignette: 0.22 },
  },
  // Riviera's evening: the sunset's sky over its own sea and hills.
  'riviera-sunset': {
    top: 0x23307e,
    mid: 0xd9608c,
    horizon: 0xffa048,
    sun: 0xffe0a0,
    fog: 0xf2a27a,
    fogNear: 280,
    fogFar: 2100,
    hemiSky: 0xffc2a8,
    hemiGround: 0x4a3a5a,
    hemiIntensity: 1.2,
    dir: 0xffb27a,
    dirIntensity: 2.5,
    blocks: [0xf2a7a0, 0x9fd9c8, 0xf6d38a, 0xa7c4f2, 0xf0b6d6, 0xbfe3a0],
    ground: 0x747f44,
    ink: 0x2a1426,
    windows: 0.6,
    sunset: true,
    sunFrom: [300, 200, -800],
    overcast: 0.35,
    seaLight: 0xffc8b0,
    sea: [0x5cc9c6, 0x1c62a8, 0x0a2c6a],
    surfaces: RIVIERA_SURFACES,
    grade: { saturation: 1.18, contrast: 1.07, shadow: 0x7a5cc0, vignette: 0.3 },
  },
  // Avalanche (docs/AVALANCHE.md): a cold, bright day on snow, blue in the shade.
  alpine: {
    top: 0x1f5fc4,
    mid: 0x5b9be6,
    horizon: 0xcfe6ff,
    sun: 0xfffbe8,
    fog: 0xd6e6f7,
    fogNear: 260,
    fogFar: 1900,
    hemiSky: 0xe8f2ff,
    hemiGround: 0x6f86a6,
    hemiIntensity: 1.25,
    dir: 0xfff6e6,
    dirIntensity: 2.3,
    blocks: [0x8a8f9a, 0x6f7480, 0xa3a8b2, 0x5a5f6b],
    ground: 0xeef4fb,
    ink: 0x1c2a3c,
    windows: 0.2,
    day: true,
    overcast: 0.4,
    grade: { saturation: 1.1, contrast: 1.06, shadow: 0x8fb4e0, vignette: 0.2 },
  },
  sunset: {
    top: 0x23307e,
    mid: 0xd9608c,
    horizon: 0xffa048,
    sun: 0xffe0a0,
    fog: 0xf2a27a,
    fogNear: 280,
    fogFar: 2100,
    hemiSky: 0xffc2a8,
    hemiGround: 0x3a3a6a,
    hemiIntensity: 1.2,
    dir: 0xffb27a,
    dirIntensity: 2.5,
    blocks: [0xf2a7a0, 0x9fd9c8, 0xf6d38a, 0xa7c4f2, 0xf0b6d6, 0xbfe3a0],
    ground: 0x5a9a3a,
    ink: 0x2a1426,
    windows: 0.6,
    sunset: true,
    // Low, from the sun on the horizon.
    sunFrom: [300, 200, -800],
    overcast: 0.35,
    seaLight: 0xffc8b0,
    grade: { saturation: 1.22, contrast: 1.07, shadow: 0x7a5cc0, vignette: 0.3 },
  },
  midnight: {
    top: 0x02030f,
    mid: 0x0b1a4a,
    horizon: 0x1f6f9e,
    sun: 0x9ef6ff,
    fog: 0x123a66,
    fogNear: 90,
    fogFar: 700,
    hemiSky: 0x7ab0ff,
    hemiGround: 0x05040f,
    hemiIntensity: 1.1,
    dir: 0xa8c2ff,
    dirIntensity: 1.2,
    blocks: [0x1c2440, 0x222c52, 0x2a2244, 0x18203a, 0x262e56],
    ground: 0x080a18,
    ink: 0x02030a,
    windows: 1.35,
  },
};

/**
 * Inside an enclosed piece (PieceDef.indoor; docs/CALDERA.md step 3): the fog and the light the
 * map's palette eases to as the camera goes in. The sun is mostly gone (`sun`: what share of it
 * still reaches in, round the mouths); the sky light becomes the space's own.
 */
export interface IndoorLook {
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
}

export const INDOOR: Record<string, IndoorLook> = {
  // A road tunnel: sodium lamps overhead, a sooty haze.
  tunnel: { fog: 0x3a3228, fogNear: 40, fogFar: 420, hemiSky: 0xffd49a, hemiGround: 0x5a4a36, hemiIntensity: 1.7, sun: 0.1 },
  // The Lava Tube: dark rock, lit from below by the lava in its cracks, in a smoky red haze.
  lava: { fog: 0x4a1c0c, fogNear: 30, fogFar: 380, hemiSky: 0xd6a088, hemiGround: 0xff7a2a, hemiIntensity: 2.1, sun: 0.08 },
  // Harbor Town's market hall: lanterns strung under a timber roof, a little daylight through its
  // skylights, a warm haze of cooking smoke.
  market: { fog: 0x6a4e34, fogNear: 50, fogFar: 460, hemiSky: 0xffe2b0, hemiGround: 0xc0844a, hemiIntensity: 1.9, sun: 0.3 },
};
