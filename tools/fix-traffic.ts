// Moves a layout's traffic section ends onto straights (see straightenSections), in place.
//
//   bun tools/fix-traffic.ts content/maps/countryside/valley.track.json

import { readFileSync, writeFileSync } from 'node:fs';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';

const file = process.argv[2];
const layout = JSON.parse(readFileSync(file, 'utf8'));
const before = JSON.stringify(layout.traffic?.lanes?.map((l: { sections?: unknown }) => l.sections));
straightenSections(layout, surfaces);
console.log(`${before}\n→ ${JSON.stringify(layout.traffic?.lanes?.map((l: { sections?: unknown }) => l.sections))}`);
writeFileSync(file, JSON.stringify(layout, null, 1) + '\n');
