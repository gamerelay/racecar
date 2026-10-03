// The golden fingerprints (docs/CALDERA.md, step 0; src/dev/fingerprint.ts): every layout's bake,
// its open ground and fixed drives, hashed. Checks them against this platform's recording
// (test/golden/fingerprints.<platform>-<arch>.json: floats differ in their last bits between
// platforms), or records them. `--print` writes them out (CI prints its own when it has none).
//
//   bun tools/fingerprint.ts                 check every layout, say what moved
//   bun tools/fingerprint.ts --update        record them (only when a change means to move a map)
//   bun tools/fingerprint.ts paradise-open/open --update   one layout
//   bun tools/fingerprint.ts --print         print them (to record another platform's from its output)
//   bun tools/fingerprint.ts --from-ci [run]  write CI's (linux-x64) from its latest run's log on this
//                                            branch (or run id): CI prints them when they're off
//   add --json for machine-readable output

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, type Fingerprint } from '../src/dev/fingerprint';
import { CLASSES, EXPERIMENTAL_KEYS, LAYOUT_KEYS, SURFACES, layout } from './content';

export const PLATFORM = `${process.platform}-${process.arch}`;
export const GOLDEN = join(import.meta.dir, '..', 'test', 'golden', `fingerprints.${PLATFORM}.json`);
export const GOLDEN_KEYS = [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS];
/** What test/golden.test.ts prints before a platform's fresh fingerprints (one line of JSON after it). */
export const FRESH_MARK = 'Fresh golden fingerprints for';

/** The fresh fingerprints a CI run printed, and its platform, from its log (`gh run view --log`). */
export function fromCiLog(log: string): { platform: string; prints: Record<string, Fingerprint> } {
  const lines = log.split('\n').map((l) => l.replace(/^[^\t]*\t[^\t]*\t\S+Z /, ''));
  const k = lines.findIndex((l) => l.startsWith(FRESH_MARK));
  if (k < 0) throw new Error("no fresh fingerprints in that run's log (they're printed only when they're missing or off)");
  const platform = lines[k].slice(FRESH_MARK.length).trim().split(' ')[0];
  const json = lines.slice(k + 1).find((l) => l.startsWith('{'));
  if (!json) throw new Error('the fingerprints after the mark are missing');
  return { platform, prints: JSON.parse(json) as Record<string, Fingerprint> };
}

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
  if (was.wrecks !== now.wrecks) out.push(`wrecks ${was.wrecks} → ${now.wrecks}`);
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const json = args.includes('--json');
  const print = args.includes('--print');
  const keys = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--from-ci')) {
    const id = keys[0] ?? JSON.parse(execSync('gh run list --limit 1 --json databaseId --branch "$(git branch --show-current)"', { encoding: 'utf8' }))[0]?.databaseId;
    if (!id) throw new Error('no CI run on this branch');
    const { platform, prints } = fromCiLog(execSync(`gh run view ${id} --log`, { encoding: 'utf8', maxBuffer: 256 << 20 }));
    const file = join(import.meta.dir, '..', 'test', 'golden', `fingerprints.${platform}.json`);
    writeFileSync(file, `${JSON.stringify(prints, null, 1)}\n`);
    console.log(`wrote ${file} (${Object.keys(prints).length} layouts, from run ${id})`);
    process.exit(0);
  }
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
  if (update) writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`);
  if (json) console.log(JSON.stringify(report, null, 1));
  else
    for (const [key, parts] of Object.entries(report))
      console.log(`${key}: ${parts.length ? `${update ? 'recorded; it had moved: ' : 'MOVED: '}${parts.join('; ')}` : 'identical'}`);
  if (!update && Object.values(report).some((p) => p.length)) process.exit(1);
}
