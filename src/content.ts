// All content, bundled. Layouts are picked up by glob, so a new layout file needs no code change,
// and in dev an edited layout hot-reloads (main.ts accepts this module).

import bus from '../content/cars/bus.json';
import coupe from '../content/cars/coupe.json';
import hatch from '../content/cars/hatch.json';
import muscle from '../content/cars/muscle.json';
import paints from '../content/cars/paints.json';
import rally from '../content/cars/rally.json';
import sedan from '../content/cars/sedan.json';
import van from '../content/cars/van.json';
import surfaces from '../content/surfaces.json';
import type { CarClass, MapDef, PaintDef, SurfaceDef, TrackLayout } from './core/content';

export const CLASSES = [coupe, muscle, hatch, van, sedan, rally, bus] as CarClass[];
export const PAINTS = paints as PaintDef[];
export const SURFACES = surfaces as SurfaceDef[];

const mapFiles = import.meta.glob<MapDef>('../content/maps/*/map.json', { eager: true, import: 'default' });
const layoutFiles = import.meta.glob<TrackLayout>('../content/maps/*/*.track.json', { eager: true, import: 'default' });

export const MAPS: MapDef[] = Object.values(mapFiles);

/** Layouts by "map/layout", e.g. "city/downtown". */
export const LAYOUTS: Record<string, TrackLayout> = Object.fromEntries(
  Object.entries(layoutFiles).map(([path, layout]) => {
    const m = path.match(/maps\/([^/]+)\/([^/]+)\.track\.json$/)!;
    return [`${m[1]}/${m[2]}`, layout];
  }),
);
