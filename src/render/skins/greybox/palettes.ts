// Palettes from the prototype. Dusk is City's signature look; midnight its rain/night variant.

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
}

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
  },
};
