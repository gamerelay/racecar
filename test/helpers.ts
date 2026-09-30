import bus from '../content/cars/bus.json';
import coupe from '../content/cars/coupe.json';
import hatch from '../content/cars/hatch.json';
import muscle from '../content/cars/muscle.json';
import rally from '../content/cars/rally.json';
import sedan from '../content/cars/sedan.json';
import van from '../content/cars/van.json';
import downtown from '../content/maps/city/downtown.track.json';
import surfaces from '../content/surfaces.json';
import type { CarClass, SurfaceDef, TrackLayout } from '../src/core/content';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';

// The game's order (src/content.ts).
export const CLASSES = [coupe, muscle, hatch, van, sedan, rally, bus] as CarClass[];
export const SURFACES = surfaces as SurfaceDef[];
export const DOWNTOWN = downtown as unknown as TrackLayout;

export function citySim(seed = 1, slowmo: 'world' | 'wreck' = 'world'): Sim {
  return new Sim(bakeTrack(DOWNTOWN, SURFACES), CLASSES, SURFACES, { seed, slowmo });
}

/** A wide ring (default radius 200 m, 60 m road) for physics tests that shouldn't hit walls. It turns left. */
export function ringSim(seed = 1, radius = 200, width = 60): Sim {
  const points = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2;
    return { p: [Math.sin(a) * radius, 0, Math.cos(a) * radius] as [number, number, number], width, lanes: 4 };
  });
  const layout: TrackLayout = { id: 'ring', name: 'Ring', main: { points } };
  return new Sim(bakeTrack(layout, SURFACES), CLASSES, SURFACES, { seed });
}
