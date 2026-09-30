import { describe, expect, test } from 'bun:test';
import { LANDMARK_KINDS, type TrackLayout } from '../src/core/content';
import { validateLayout } from '../src/core/track/validate';
import { clockText, landmarkKeeps } from '../src/render/skins/greybox/landmarks';
import { CLASSES, DOWNTOWN, SURFACES, layout } from './helpers';

// Landmarks (PLAN phase 6): scenery placed by the layout. The validator keeps roads off them, the
// city leaves their ground empty, and the clock tower reads the race time.

const landmarkProblems = (l: TrackLayout) => validateLayout(l, SURFACES, CLASSES).filter((p) => p.message.startsWith('landmark'));

describe('landmarks', () => {
  test('Downtown has them all, each a known kind, and every one clear of the road', () => {
    const kinds = (DOWNTOWN.landmarks ?? []).map((m) => m.kind);
    expect(kinds.sort()).toEqual(['canal', 'clock-tower', 'donut-shop', 'fountain', 'leader-board']);
    for (const k of kinds) expect(LANDMARK_KINDS as readonly string[]).toContain(k);
    expect(landmarkProblems(DOWNTOWN)).toEqual([]);
  });

  test('Backroads has its six, clear of the road; the water tower says the town', () => {
    const valley = layout('backroads/valley');
    const kinds = (valley.landmarks ?? []).map((m) => m.kind);
    expect(kinds.sort()).toEqual(['balloon', 'cow', 'drive-in', 'scarecrow', 'water-tower', 'windmill']);
    for (const k of kinds) expect(LANDMARK_KINDS as readonly string[]).toContain(k);
    expect(landmarkProblems(valley)).toEqual([]);
    expect(valley.landmarks!.find((m) => m.kind === 'water-tower')!.label).toBe('MILLBROOK');
  });

  test('Paradise has its five (the lighthouse is the island\'s own), clear of the road, the tiki head at the Lava Tube\'s mouth', () => {
    const island = layout('paradise/island');
    const kinds = (island.landmarks ?? []).map((m) => m.kind);
    expect(kinds.sort()).toEqual(['seaplanes', 'shipwreck', 'surf-shack', 'tiki-head', 'whale']);
    expect(landmarkProblems(island)).toEqual([]);
    const tiki = island.landmarks!.find((m) => m.kind === 'tiki-head')!;
    const tube = island.branches!.find((b) => b.id === 'lava-tube')!;
    const mouth = tube.points[0].p;
    expect(Math.hypot(tiki.at[0] - mouth[0], tiki.at[1] - mouth[2])).toBeLessThan(40);
  });

  test('the validator refuses one on the road, and a kind it doesn\'t know', () => {
    const onRoad: TrackLayout = { ...DOWNTOWN, landmarks: [{ kind: 'fountain', at: [0, 200], r: 10 }] };
    expect(landmarkProblems(onRoad)[0].message).toContain('needs 10 m clear');
    const unknown: TrackLayout = { ...DOWNTOWN, landmarks: [{ kind: 'pyramid', at: [5000, 5000], r: 1 }] };
    expect(landmarkProblems(unknown)[0].message).toContain('unknown kind "pyramid"');
  });

  test('the ground each keeps: a footprint square, a sight line out in front, a canal\'s whole length (cut)', () => {
    const l: TrackLayout = {
      ...DOWNTOWN,
      landmarks: [
        { kind: 'fountain', at: [10, 20], r: 5 },
        { kind: 'leader-board', at: [0, 0], rot: Math.PI / 2, r: 2, params: { w: 10, view: 40 } },
        { kind: 'canal', at: [100, 0], r: 0, params: { len: 200, w: 10 } },
      ],
    };
    const [sq, board, sight, canal] = landmarkKeeps(l);
    expect(sq).toEqual({ x0: 5, x1: 15, z0: 15, z1: 25 });
    expect(board).toEqual({ x0: -2, x1: 2, z0: -2, z1: 2 });
    // Faces +x, so the sight line runs 40 m that way, as wide as the board.
    expect(sight.x0).toBeCloseTo(0);
    expect(sight.x1).toBeCloseTo(40);
    expect(sight.z0).toBeCloseTo(-5);
    expect(sight.z1).toBeCloseTo(5);
    // Along z (unturned): its water plus a wall each side, and it cuts the streets' ground.
    expect(canal).toEqual({ x0: 93.8, x1: 106.2, z0: -100, z1: 100, cut: true });
  });

  test('the clock tower\'s readout: minutes and seconds of race time', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(9.9)).toBe('0:09');
    expect(clockText(76.4)).toBe('1:16');
    expect(clockText(600)).toBe('10:00');
    expect(clockText(-3)).toBe('0:00');
  });
});
