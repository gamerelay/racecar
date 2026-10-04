// Buildings (docs/CALDERA.md step 3c; PieceDef.building, core/track/buildings.ts): an enclosed piece
// built on the ground, a hall a road runs through. Paradise Open's market hall, on Harbor Town's
// market street: its walls solid from both sides, the ground its floor, indoors under its roof with
// nothing over it, and shopfront glass across its doors.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { BUILDING_WALL } from '../src/core/track/buildings';
import { newCast } from '../src/core/track/ground';
import { newHit, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { panelLook } from '../src/core/world/breakables';
import { run, setup } from '../src/dev/drive';
import { cameraCeiling, clearView, indoorAt } from '../src/render/camera';
import { INDOOR } from '../src/render/skins/greybox/palettes';
import { CLASSES, SURFACES, layout } from './helpers';

const open = layout('paradise-open/open');
const track = bakeTrack(open, SURFACES);
const g = track.ground!;
const street = track.splines.find((s) => s.id === 'market-street')!;
const hall = g.pieces.list.find((p) => p.building)!;
const walls = track.props.filter((p) => p.kind === 'building-wall');
/** A point `lat` m across the street (+ right) and `up` m over it, `s` m along it. */
const at = (s: number, lat = 0, up = 0) => {
  const h = sampleAt(street, s, newHit());
  return { x: h.cx - h.tz * lat, y: h.cy + up, z: h.cz + h.tx * lat, heading: (Math.atan2(h.tx, h.tz) * 180) / Math.PI };
};
const mid = (hall.s[0] + hall.s[1]) / 2;
const edge = street.width[Math.round(mid / street.step)] / 2 + street.shoulder[Math.round(mid / street.step)];

describe('buildings', () => {
  test("the market hall: a building on the market street, lit as a market inside; the street's own walls off along it", () => {
    expect(hall).toMatchObject({ id: 'market-hall', building: 'market', indoor: 'market' });
    expect(INDOOR[hall.indoor]).toBeDefined();
    expect(hall.spline).toBe(street.index);
    for (let i = Math.ceil(hall.s[0] / street.step); i <= Math.floor(hall.s[1] / street.step); i++) expect([i, street.wallL[i], street.wallR[i]]).toEqual([i, 0, 0]);
  });

  test('its walls are solid props on no road, both sides, the whole way along it, out from its edge', () => {
    expect(walls.length).toBeGreaterThan(20);
    for (const w of walls) {
      expect(w).toMatchObject({ solid: true, wall: true, spline: -1 });
      expect(Math.abs(w.lateral)).toBeCloseTo(edge + BUILDING_WALL / 2, 1);
      expect(w.s).toBeGreaterThanOrEqual(hall.s[0]);
      expect(w.s).toBeLessThanOrEqual(hall.s[1]);
    }
    // Every metre of it walled on each side.
    for (let s = hall.s[0] + 0.5; s < hall.s[1]; s += 1)
      for (const side of [-1, 1]) {
        const p = at(s, side * (edge + BUILDING_WALL / 2));
        const inside = walls.some((w) => {
          const dx = p.x - w.x;
          const dz = p.z - w.z;
          const along = dx * Math.sin(w.heading) + dz * Math.cos(w.heading);
          const across = dx * Math.cos(w.heading) - dz * Math.sin(w.heading);
          return Math.abs(along) <= w.hz && Math.abs(across) <= w.hx + 0.01;
        });
        expect([s, side, inside]).toEqual([s, side, true]);
      }
  });

  test('it stands on the ground: the floor in it is the ground, shaped to the street, and its space is a room under its ceiling', () => {
    const c = newCast();
    for (const s of [hall.s[0] + 1, mid, hall.s[1] - 1]) {
      const p = at(s, 2);
      g.cast(p.x, p.y + 0.3, p.z, c);
      expect(c.piece).toBe(-1);
      expect(c.floor).toBeCloseTo(p.y, 1);
      expect(c.space).toBe('enclosed');
      expect(c.room).toBe(hall.index);
      // Over its roof, outside.
      g.cast(p.x, p.y + hall.ceiling + 1, p.z, c);
      expect([c.space, c.room]).toEqual(['open', -1]);
    }
  });

  test('under its roof is indoors with nothing over it; out past its doors, not; the camera stays under its ceiling', () => {
    for (const s of [hall.s[0] + 2, mid, hall.s[1] - 2]) {
      const p = at(s, 0, 3);
      expect([s, indoorAt(g, p.x, p.y, p.z)?.id]).toEqual([s, 'market-hall']);
      expect(cameraCeiling(g, p.x, p.y - 3, p.z)).toBeCloseTo(p.y - 3 + hall.ceiling - 1, 1);
    }
    for (const s of [hall.s[0] - 6, hall.s[1] + 6]) {
      const p = at(s, 0, 3);
      expect([s, indoorAt(g, p.x, p.y, p.z)]).toEqual([s, null]);
      expect(cameraCeiling(g, p.x, p.y - 3, p.z)).toBe(Infinity);
    }
  });

  test("the chase camera stops short of its walls (in the hall, swung out to the side, it would be outside)", () => {
    const car = at(mid, 3);
    const out = at(mid - 6, edge + 6, 3);
    const cam = { x: out.x, y: out.y, z: out.z };
    clearView(g, car.x, car.y, car.z, cam, walls);
    // Back on this side of the wall, in the hall.
    const lat = (cam.x - car.x) * -Math.cos((car.heading * Math.PI) / 180) + (cam.z - car.z) * Math.sin((car.heading * Math.PI) / 180);
    expect(Math.abs(lat)).toBeLessThan(edge + 3 - 0.01);
    expect(Math.hypot(cam.x - car.x, cam.z - car.z)).toBeLessThan(Math.hypot(out.x - car.x, out.z - car.z));
    // Down the hall, nothing in the way: as it was.
    const back = at(mid - 8, 0, 3);
    const free = { x: back.x, y: back.y, z: back.z };
    clearView(g, car.x, car.y, car.z, free, walls);
    expect(free).toEqual({ x: back.x, y: back.y, z: back.z });
  });

  test('its doors are glass: through at speed, both smashed, no hop at its doors; slowly, a wall', () => {
    const glass = (track.layout.breakables ?? []).filter((b) => b.look === 'glass');
    expect(glass.map((b) => b.id)).toEqual(['market-hall-in', 'market-hall-out']);
    const fast = { throttle: 1 };
    const sim = setup(track, CLASSES, SURFACES, { road: 'market-street', s: hall.s[0] - 25 }, fast, { kmh: 110 });
    const { summary, events } = run(sim, fast, 3.5, 0.5);
    expect(summary.wrecks).toEqual([]);
    const broke = events.filter((e) => e.type === 'wall_break');
    expect(broke.length).toBeGreaterThanOrEqual(2);
    // (The walls' panels, by look: both glass.)
    const br = sim.world!.breakables;
    for (let k = 0; k < br.n; k++) if (glass.some((b) => track.layout.breakables!.indexOf(b) === br.wall[k])) expect(panelLook(track.layout.breakables, br, k)).toBe('glass');
    // Its doors' thresholds are the street: no takeoff at them (a floor's plane at a door kicked cars up).
    expect(events.filter((e) => e.type === 'takeoff')).toEqual([]);
    const crawl = { throttle: 0.05 };
    const slow = run(setup(track, CLASSES, SURFACES, { road: 'market-street', s: hall.s[0] - 6 }, crawl, { kmh: 12 }), crawl, 4, 0.5);
    expect(slow.events.filter((e) => e.type === 'wall_break')).toEqual([]);
    expect(slow.summary.end.s).toBeLessThan(hall.s[0] + 1);
  }, 30_000);

  test('from outside, off the road into its side: a wall, not a way in', () => {
    const p = at(mid, -(edge + BUILDING_WALL + 8));
    const input = { throttle: 0.5 };
    // Heading across the street, toward its left wall from outside it.
    const d = run(setup(track, CLASSES, SURFACES, { x: p.x, z: p.z, heading: at(mid).heading - 90 }, input, { kmh: 50 }), input, 2, 0.25);
    expect(d.events.some((e) => e.type === 'wall_hit')).toBe(true);
    const end = d.summary.end;
    const lat = (end.x - at(mid).x) * -Math.cos((at(mid).heading * Math.PI) / 180) + (end.z - at(mid).z) * Math.sin((at(mid).heading * Math.PI) / 180);
    expect(lat).toBeLessThan(-(edge + BUILDING_WALL));
  }, 30_000);

  test("scraped along inside, it's a road's wall: a hit as it's met, not one a tick (a pillar's)", () => {
    const input = { throttle: 0.5, steer: 0.6 };
    const d = run(setup(track, CLASSES, SURFACES, { road: 'market-street', s: hall.s[0] + 20, lateral: 2 }, input, { kmh: 80 }), input, 2, 0.25);
    const hits = d.events.filter((e) => e.type === 'wall_hit').length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(20);
    expect(d.summary.wrecks).toEqual([]);
  }, 30_000);

  test('the validator wants a ceiling on a building', () => {
    const bad = { ...open, pieces: open.pieces!.map((p) => (p.id === 'market-hall' ? { ...p, ceiling: undefined, indoor: undefined } : p)) };
    const problems = validateLayout(bad, SURFACES, CLASSES).map((p) => `${p.level}: ${p.message}`);
    expect(problems.some((p) => p.startsWith('error: piece market-hall: "building"'))).toBe(true);
  }, 60_000);
});
