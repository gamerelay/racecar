// The game's content read from disk, for tools and tests (the game itself bundles it through
// src/content.ts): the car classes in CLASS_ORDER, the surfaces, the paints, and the layouts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASS_ORDER, resolveLayout, type CarClass, type PaintDef, type SurfaceDef, type TrackLayout } from '../src/core/content';

export const CONTENT = join(import.meta.dir, '..', 'content');

const read = <T>(...path: string[]): T => JSON.parse(readFileSync(join(CONTENT, ...path), 'utf8')) as T;

export const CLASSES: CarClass[] = CLASS_ORDER.map((id) => read<CarClass>('cars', `${id}.json`));
export const SURFACES: SurfaceDef[] = read<SurfaceDef[]>('surfaces.json');
export const PAINTS: PaintDef[] = read<PaintDef[]>('cars', 'paints.json');

/** Every layout's key ("downtown/downtown"), map by map. */
export const LAYOUT_KEYS: string[] = readdirSync(join(CONTENT, 'maps')).flatMap((map) =>
  readdirSync(join(CONTENT, 'maps', map))
    .filter((f) => f.endsWith('.track.json'))
    .map((f) => `${map}/${f.replace('.track.json', '')}`),
);

/** A fresh copy of the layout at `key` ("backroads/valley", an old key, or a map id): safe to edit. */
export function layout(key: string): TrackLayout {
  const [map, name] = (resolveLayout(key, LAYOUT_KEYS) ?? key).split('/');
  return read<TrackLayout>('maps', map, `${name}.track.json`);
}
