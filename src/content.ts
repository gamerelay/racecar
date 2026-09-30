// All content, bundled. Layouts are picked up by glob, so a new layout file needs no code change,
// and in dev an edited layout hot-reloads (main.ts accepts this module).

import paints from '../content/cars/paints.json';
import surfaces from '../content/surfaces.json';
import { CLASS_ORDER, type CarClass, type MapDef, type PaintDef, type SurfaceDef, type TrackLayout } from './core/content';

const carFiles = import.meta.glob<CarClass>('../content/cars/*.json', { eager: true, import: 'default' });
export const CLASSES: CarClass[] = CLASS_ORDER.map((id) => carFiles[`../content/cars/${id}.json`]);
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
