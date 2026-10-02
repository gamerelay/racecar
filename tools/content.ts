// The game's content read from disk, for tools and tests (the game itself bundles it through
// src/content.ts): the car classes in CLASS_ORDER, the surfaces, the paints, and the layouts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASS_ORDER, resolveLayout, type CarClass, type MapDef, type PaintDef, type SurfaceDef, type TrackLayout } from '../src/core/content';

export const CONTENT = join(import.meta.dir, '..', 'content');

const read = <T>(...path: string[]): T => JSON.parse(readFileSync(join(CONTENT, ...path), 'utf8')) as T;

export const CLASSES: CarClass[] = CLASS_ORDER.map((id) => read<CarClass>('cars', `${id}.json`));
export const SURFACES: SurfaceDef[] = read<SurfaceDef[]>('surfaces.json');
export const PAINTS: PaintDef[] = read<PaintDef[]>('cars', 'paints.json');

/** Every map's map.json, the experimental ones too (docs/AVALANCHE.md). */
export const ALL_MAPS: MapDef[] = readdirSync(join(CONTENT, 'maps')).map((map) => read<MapDef>('maps', map, 'map.json'));
/** The maps in the game: not the experimental ones (the validator, the lap report and the tests run these). */
export const MAPS: MapDef[] = ALL_MAPS.filter((m) => !m.experimental);

const keysOf = (maps: MapDef[]) =>
  maps.flatMap((m) =>
    readdirSync(join(CONTENT, 'maps', m.id))
      .filter((f) => f.endsWith('.track.json'))
      .map((f) => `${m.id}/${f.replace('.track.json', '')}`),
  );
/** Every layout's key ("downtown/downtown"), map by map: the maps in the game. */
export const LAYOUT_KEYS: string[] = keysOf(MAPS);
/** The experimental maps' layouts. */
export const EXPERIMENTAL_KEYS: string[] = keysOf(ALL_MAPS.filter((m) => m.experimental));

/** A fresh copy of the layout at `key` ("backroads/valley", an old key, or a map id): safe to edit. */
export function layout(key: string): TrackLayout {
  const [map, name] = (resolveLayout(key, [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS]) ?? key).split('/');
  return read<TrackLayout>('maps', map, `${name}.track.json`);
}
