// The golden fingerprints (docs/CALDERA.md, step 0; src/dev/fingerprint.ts): every layout's bake,
// its open ground and fixed drives, hashed. Checks them against the recording
// (test/golden/fingerprints.json, the same on every platform since the sim does its own math), or
// records them.
//
//   bun tools/fingerprint.ts                 check every layout, say what moved
//   bun tools/fingerprint.ts --update        record them (only when a change means to move a map)
//   bun tools/fingerprint.ts paradise-open/open --update   one layout
//   bun tools/fingerprint.ts --print         print them
//   add --json for machine-readable output

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveLayout } from '../src/core/content';
import { fingerprint, type Fingerprint } from '../src/dev/fingerprint';
import { CLASSES, EXPERIMENTAL_KEYS, LAYOUT_KEYS, SURFACES, layout } from './content';

export const GOLDEN = join(import.meta.dir, '..', 'test', 'golden', 'fingerprints.json');
export const GOLDEN_KEYS = [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS];
export function readGolden(): Record<string, Fingerprint> {
  return existsSync(GOLDEN) ? (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, Fingerprint>) : {};
}

/** What differs between a recorded fingerprint and a fresh one: the parts that moved. */
export function moved(was: Fingerprint | undefined, now: Fingerprint): string[] {
  if (!was) return ['not recorded'];
  const out: string[] = [];
  if (was.track !== now.track) out.push('track (the bake: roads, checkpoints, zones…)');
  if (was.ground !== now.ground) out.push('ground (heights, decks, holes, beaches…)');
  if (was.branches !== now.branches) out.push('branches (the drives down each branch)');
  if (was.drive !== now.drive) {
    const at = now.marks.find((m, k) => JSON.stringify(m) !== JSON.stringify(was.marks[k]));
    out.push(`drive${at ? ` (by ${at.t} s: was ${JSON.stringify(was.marks.find((m) => m.t === at.t))}, now ${JSON.stringify(at)})` : ' (in the last bits)'}`);
  }
  if (was.lifts !== now.lifts) out.push('lifts (the drawbridges: when, how far, their floors)');
  if (was.wrecks !== now.wrecks) out.push(`wrecks ${was.wrecks} → ${now.wrecks}`);
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const json = args.includes('--json');
  const print = args.includes('--print');
  const unknown = args.filter((a) => a.startsWith('--') && !['--update', '--json', '--print'].includes(a));
  if (unknown.length) throw new Error(`unknown flag${unknown.length > 1 ? 's' : ''}: ${unknown.join(' ')}`);
  // Each as the golden file keys it ("downtown" is "downtown/downtown"): else it reads as never recorded, and --update writes a stray entry.
  const keys = args
    .filter((a) => !a.startsWith('--'))
    .map((a) => {
      const key = resolveLayout(a, GOLDEN_KEYS);
      if (!key) throw new Error(`no layout "${a}" (layouts: ${GOLDEN_KEYS.join(', ')})`);
      return key;
    });
  if (print) {
    const all: Record<string, Fingerprint> = {};
    for (const key of keys.length ? keys : GOLDEN_KEYS) all[key] = fingerprint(layout(key), CLASSES, SURFACES);
    console.log(JSON.stringify(all, null, 1));
    process.exit(0);
  }
  const golden = readGolden();
  const report: Record<string, string[]> = {};
  for (const key of keys.length ? keys : GOLDEN_KEYS) {
    const now = fingerprint(layout(key), CLASSES, SURFACES);
    report[key] = moved(golden[key], now);
    if (update) golden[key] = now;
  }
  if (update) mkdirSync(dirname(GOLDEN), { recursive: true });
  if (update) writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`);
  if (json) console.log(JSON.stringify(report, null, 1));
  else
    for (const [key, parts] of Object.entries(report))
      console.log(`${key}: ${parts.length ? `${update ? 'recorded; it had moved: ' : 'MOVED: '}${parts.join('; ')}` : 'identical'}`);
  if (!update && Object.values(report).some((p) => p.length)) process.exit(1);
}
