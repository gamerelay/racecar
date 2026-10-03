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

/** Every map, the experimental ones too (docs/AVALANCHE.md): for a link straight to one. */
export const ALL_MAPS: MapDef[] = Object.values(mapFiles);
/** The maps in the game: the lobby's, the vote's, the results'. Not the experimental ones. */
export const MAPS: MapDef[] = ALL_MAPS.filter((m) => !m.experimental);

/** Layouts by "map/layout", e.g. "downtown/downtown". */
export const LAYOUTS: Record<string, TrackLayout> = Object.fromEntries(
  Object.entries(layoutFiles).map(([path, layout]) => {
    const m = path.match(/maps\/([^/]+)\/([^/]+)\.track\.json$/)!;
    return [`${m[1]}/${m[2]}`, layout];
  }),
);
