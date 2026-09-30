// Summarizes local telemetry (SPEC §14): the dev server writes telemetry/<day>/<session>.jsonl;
// this reads them and prints what matters for tuning: laps, wrecks by cause and place, drifts,
// air, frame times and errors.
//
//   bun tools/telemetry.ts              the latest session
//   bun tools/telemetry.ts --all        every session today
//   bun tools/telemetry.ts <file.jsonl> one file
//   add --json for machine-readable output

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Rec = { t: string; tick: number; at: number; [k: string]: unknown };

const dir = join(import.meta.dir, '..', 'telemetry');
const args = process.argv.slice(2);
const json = args.includes('--json');
const all = args.includes('--all');
const explicit = args.find((a) => a.endsWith('.jsonl'));

function sessions(): string[] {
  if (explicit) return [explicit];
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .flatMap((d) => readdirSync(join(dir, d)).map((f) => join(dir, d, f)))
    .filter((f) => f.endsWith('.jsonl'))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  if (all) {
    const today = new Date().toISOString().slice(0, 10);
    return files.filter((f) => f.includes(today));
  }
  // The latest session with more than a start line in it.
  for (let k = files.length - 1; k >= 0; k--) if (readFileSync(files[k], 'utf8').split('\n').filter(Boolean).length > 1) return [files[k]];
  return files.slice(-1);
}

const files = sessions();
if (!files.length) {
  console.log('No telemetry yet. Run `bun run dev`, drive, and check telemetry/.');
  process.exit(0);
}
const recs: Rec[] = files.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Rec),
);
const of = (t: string) => recs.filter((r) => r.t === t);
const human = (r: Rec) => r.human === true;
const pct = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const count = <T>(xs: T[]) => xs.reduce<Record<string, number>>((m, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m), {});

const session = of('session')[0];
const laps = of('lap').filter(human);
const wrecks = of('wreck').filter(human);
const drifts = of('drift').filter(human);
const perf = of('perf');
const summary = {
  files: files.map((f) => f.replace(dir + '/', '')),
  session: session ? { build: session.build, gpu: session.gpu, device: session.device, layout: session.layout, layoutVersion: session.layoutVersion, cars: session.cars } : null,
  minutes: recs.length ? +((recs[recs.length - 1].at - recs[0].at) / 60000).toFixed(1) : 0,
  laps: laps.map((l) => l.time),
  bestLap: laps.length ? Math.min(...laps.map((l) => l.time as number)) : null,
  wrecks: { total: wrecks.length, byCause: count(wrecks.map((w) => w.cause)), where: wrecks.map((w) => `${w.cause} @ ${w.spline === 0 ? '' : `spline ${w.spline} `}s=${w.s}`) },
  // Wrecks bucketed into 100 m stretches of the main road: where the track bites.
  wreckHotspots: Object.entries(count(wrecks.filter((w) => w.spline === 0).map((w) => Math.floor((w.s as number) / 100) * 100)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s, n]) => `${s}–${Number(s) + 100} m: ${n}`),
  drifts: {
    count: drifts.length,
    meanDuration: +mean(drifts.map((d) => d.duration as number)).toFixed(2),
    stages: count(drifts.map((d) => d.stage)),
    spinOuts: of('spin_out').filter(human).length,
    longestChain: Math.max(0, ...drifts.map((d) => (d.chain as number) ?? 0)),
  },
  air: { jumps: of('air').filter(human).length, longest: Math.max(0, ...of('air').filter(human).map((a) => a.time as number)) },
  walls: { hits: of('wall').length, hardest: Math.max(0, ...of('wall').map((w) => w.impact as number)) },
  perf: perf.length
    ? { fps: +mean(perf.map((p) => p.fps as number)).toFixed(0), frameMsP95: pct(perf.map((p) => p.p95 as number), 0.5), worstP99: Math.max(...perf.map((p) => p.p99 as number)), simMs: +mean(perf.map((p) => p.simMs as number)).toFixed(3), draws: Math.max(...perf.map((p) => p.draws as number)) }
    : null,
  errors: of('error').map((e) => e.message),
};

if (json) console.log(JSON.stringify(summary, null, 2));
else {
  const s = summary;
  console.log(`${s.files.join(', ')}  (${s.minutes} min)`);
  if (s.session) console.log(`build ${s.session.build} · ${s.session.gpu} · ${s.session.device} · ${s.session.layout} ${s.session.layoutVersion}`);
  console.log(`laps: ${s.laps.length ? s.laps.map((t) => (t as number).toFixed(2)).join(', ') : 'none'}${s.bestLap ? `  best ${s.bestLap.toFixed(2)} s` : ''}`);
  console.log(`wrecks: ${s.wrecks.total} ${JSON.stringify(s.wrecks.byCause)}${s.wreckHotspots.length ? `  hotspots: ${s.wreckHotspots.join('; ')}` : ''}`);
  console.log(`drifts: ${s.drifts.count}, mean ${s.drifts.meanDuration} s, stages ${JSON.stringify(s.drifts.stages)}, spin-outs ${s.drifts.spinOuts}, longest chain ${s.drifts.longestChain}`);
  console.log(`air: ${s.air.jumps} jumps, longest ${s.air.longest.toFixed(2)} s · walls: ${s.walls.hits} hits, hardest ${s.walls.hardest} m/s`);
  if (s.perf) console.log(`perf: ${s.perf.fps} fps, p95 ${s.perf.frameMsP95} ms, worst p99 ${s.perf.worstP99} ms, sim ${s.perf.simMs} ms/tick, ${s.perf.draws} draws`);
  if (s.errors.length) console.log(`errors: ${s.errors.join(' | ')}`);
}
