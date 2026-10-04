// Indoors (docs/CALDERA.md step 3): inside an enclosed piece the light, the fog and the sound change,
// and the camera stays under the ceiling. In the Lava Tube, Paradise Open's one enclosed piece.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three';
import { GameAudio, type AudioFrame } from '../src/audio/audio';
import { bakeTrack } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { cameraCeiling, indoorAt } from '../src/render/camera';
import { INDOOR } from '../src/render/skins/greybox/palettes';
import { fakeBrowser, type FakeTarget } from './fake-audio';
import { CLASSES, SURFACES, citySim, layout } from './helpers';

const open = layout('paradise-open/open');
const track = bakeTrack(open, SURFACES);
const g = track.ground!;
const tube = track.splines.find((s) => s.id === 'lava-tube')!;
/** A point `up` m over the tube's road at `s` m along it. */
const at = (s: number, up: number) => {
  const k = Math.round(s / tube.step);
  return { x: tube.px[k], y: tube.py[k] + up, z: tube.pz[k], road: tube.py[k] };
};

describe('indoors', () => {
  test('under the volcano, in the Lava Tube, is indoors with its lava look; out at its mouth and in the open shaft, not', () => {
    for (const s of [120, 180, 350, 390]) {
      const p = at(s, 3);
      expect([s, indoorAt(g, p.x, p.y, p.z)?.indoor]).toEqual([s, 'lava']);
    }
    // Before the rock comes over the road, and out over the shaft's lava (open to the sky): over the
    // gap, and on the bridges either side of it (enclosed pieces still, but no rock over them).
    for (const s of [20, 220, 250, 280]) {
      const p = at(s, 3);
      expect([s, indoorAt(g, p.x, p.y, p.z)]).toEqual([s, null]);
    }
    // Every look a layout names is one the skin has (and an enclosed piece says none: a tunnel).
    for (const p of g.pieces.list) if (p.indoor) expect(INDOOR[p.indoor]).toBeDefined();
  });

  test("the camera stays a metre under the tube's ceiling; out under the sky, no limit", () => {
    const p = at(150, 0);
    expect(cameraCeiling(g, p.x, p.road, p.z)).toBeCloseTo(p.road + 7 - 1, 3);
    for (const s of [20, 220, 280]) {
      const out = at(s, 0);
      expect([s, cameraCeiling(g, out.x, out.road, out.z)]).toEqual([s, Infinity]);
    }
  });

  test('the validator wants a ceiling for an indoor look, and room under a ceiling', () => {
    // (And a ceiling with room under it for a car and the camera.)
    const pieces = [...open.pieces!, { id: 'shed', road: 'lava-tube', s: [10, 30] as [number, number], indoor: 'tunnel' }, { id: 'low', road: 'lava-tube', s: [430, 450] as [number, number], ceiling: 2 }];
    const problems = validateLayout({ ...open, pieces }, SURFACES, CLASSES).map((p) => p.message);
    expect(problems.some((m) => m.includes('"indoor" is how an enclosed piece is lit inside'))).toBe(true);
    expect(problems.some((m) => m.startsWith('piece low') && m.includes('at least 3 m over it'))).toBe(true);
  }, 30_000);
});

describe('the sound indoors', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  beforeEach(() => (browser = fakeBrowser()));
  afterEach(() => browser.restore());

  test('the engines and effects ring in a room’s echo as the camera goes in, and stop ringing out of it', () => {
    const audio = new GameAudio(citySim());
    (browser.window as FakeTarget).fire('keydown');
    audio.settings.music = false;
    if (audio.settings.muted) audio.toggleMute();
    const frame: AudioFrame = { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: false };
    const echo = () => (audio as unknown as { g: { reverb: { gain: { value: number } } } }).g.reverb.gain.value;
    audio.update(1 / 60, frame);
    expect(echo()).toBe(0);
    audio.update(1 / 60, { ...frame, indoor: 1 });
    expect(echo()).toBeGreaterThan(0.3);
    audio.update(1 / 60, { ...frame, indoor: 0.5 });
    const half = echo();
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.3);
    // Behind a menu, none.
    audio.update(1 / 60, { ...frame, indoor: 1, menu: true });
    expect(echo()).toBe(0);
  });
});
