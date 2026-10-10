# Online Getaways on Splash City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An online lobby race on Splash City (`heist/city`) is a getaway for every player in it: each runner has their own host-driven cops, cops go for any runner near them, out is out, the longest run wins.

**Architecture:** `core/rules/getaway.ts` goes from one player to a list of runs (one per runner), each with its own cop pool; single player is the one-run case. Online, the room's host drives every cop and sends them as `cop` host entities (`net/cops.ts`, shaped like `net/rivals.ts`); each runner's own screen decides their end and sends it on their car's entity (`net/cars.ts`). The vote opens once one runner is left; until then those out watch the rest (`ui/watch.ts`, `ui/race.ts`, `main.ts`).

**Tech Stack:** TypeScript, Bun tests (`bun run test`, 30 s timeout), Vite, three.js, `@gamerelay/sdk` (entities, host role).

**Spec:** `docs/superpowers/specs/2026-10-09-online-getaway-design.md`

## Global Constraints

- The map's id stays `heist`; its name is **Splash City** (done in `0bc868d`).
- `MAX_CARS` (`src/core/sim.ts`) is **32**.
- Pool per runner: `min(10, floor((MAX_CARS − runners) / runners))`: 1→10, 2→10, 3→9, 4→7, 8→3.
- Out per heat: `heat + 1` per runner, up to that runner's pool (today's rule).
- A cop goes for another runner within **40 m** (`NEAR_TARGET`) in its sight; back to its own past **60 m** (1.5×) or out of sight.
- Busting counts **any** cop near you, whoever it's after.
- Single player (Single player, Quick race, `?start=getaway`, the X card) plays exactly as today: every existing test in `test/getaway.test.ts` passes unchanged.
- AI rivals are never in a getaway: its cast is the players.
- Online runs never write the device best (`racecar.getaway.<layout>`).
- Comments and names follow the repo's voice: plain sentences, the owner's words dated where they're quoted, `(docs/CHASE_MODE.md)`-style pointers.
- Run tests with `bun run test` (it sets `--timeout 30000`); plain `bun test` times out the slow getaway tests at 5 s.

## Review Focus

- **A remote runner who never shows up** (their seat in the link, their page never connects): their run must not hold the race open forever. Covered: Task 2's `NetCars` "gone" path only fires once seen, so the vote's `VOTE_MAX_MS` (60 s from the vote opening) is the backstop; Task 4's test pins that the vote opens with one runner left.
- **The host role moving mid-chase:** the next host must drive the cops on from their entities, not snap them back to the start or call out new ones. Task 3's handover test.
- **The race opening with host cops already active on a non-host screen** (it joined late): `startCops` must not place or activate cops that are the host's. Task 1's `startCops` skips `c.remote[i]`; Task 3's "elsewhere" test checks no cop jumps at green.
- **Eight runners at the Bank:** four rows back must not start anyone inside a building or on another car. Task 1's start test steps four runners for 1 s and expects no wreck; Task 7's manual check does eight.
- **Watching when the runner you watch goes out:** the camera must move on to someone still going, not stay on a wreck. Task 5's `leader`/`cycle` tests.

---

### Task 1: The getaway rules for many runners

**Files:**
- Modify: `src/core/rules/getaway.ts` (whole file, below)
- Modify: `src/core/sim.ts:37` (`MAX_CARS`), `src/core/sim.ts:522-523` (`controlsFor`)
- Test: `test/getaway.test.ts`

**Interfaces:**
- Consumes: `Sim.cops: (CopDriver | null)[]` (by car index), `Sim.addCar`, `Streets.clear(x1, z1, x2, z2)`.
- Produces:
  - `export const MAX_CARS = 32` (sim.ts)
  - `export const NEAR_TARGET = 40`
  - `export const poolFor(runners: number): number`
  - `export interface Run { car: number; cops: number[]; drivers: CopDriver[]; time: number; busted: number; end: GetawayEnd | null; calledAt: number }`
  - `class Getaway`: `constructor(sim: Sim, runners: number | readonly number[])`; `heat: number`; `readonly runs: Run[]`; `readonly runners: readonly number[]`; `readonly cops: number[]` (every cop, run by run); `readonly player: number` (this screen's runner); getters `time`, `busted`, `end` (the player's run); `get going(): number`; `get allOut(): boolean`; `runOf(car: number): Run | undefined`; `endRemote(car: number, end: GetawayEnd, time: number): void`; `step(dt)`, `atStart()` as before.

- [ ] **Step 1: Write the failing tests**

Add to `test/getaway.test.ts`: the imports, the helpers under the existing `getaway()` helper, and a new `describe` at the end of the file.

```ts
// (with the other imports)
import { NEAR_TARGET, poolFor } from '../src/core/rules/getaway';
```

```ts
/** A getaway for `n` runners on the test city (cars 0..n−1, all driven from here), the lights already green. */
function runners(n: number, seed = 1): { sim: Sim; g: Getaway } {
  const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed, traffic: 0, mayhem: 'off', weather: 'clear' });
  for (let k = 0; k < n; k++) sim.addCar({ cls: 'coupe', human: true });
  const g = new Getaway(sim, Array.from({ length: n }, (_, k) => k));
  sim.startRace(3, 0.05);
  while (g.heat === 0) sim.step([]);
  return { sim, g };
}

/** Car `i` stood at (x, z) on the ground, stopped. */
function stand(sim: Sim, i: number, x: number, z: number): void {
  const c = sim.cars;
  const ground = sim.track.ground;
  c.x[i] = c.px[i] = x;
  c.z[i] = c.pz[i] = z;
  if (ground) c.y[i] = c.py[i] = ground.height(x, z);
  c.vx[i] = c.vz[i] = 0;
}
```

```ts
describe('the getaway online: a run for each runner (the owner, 2026-10-09)', () => {
  test('each runner has their own cops, as many as fit in 32 cars, up to the pool', () => {
    expect([1, 2, 3, 4, 8].map(poolFor)).toEqual([10, 10, 9, 7, 3]);
    const { sim, g } = runners(3);
    expect(g.runs.map((r) => r.cops.length)).toEqual([9, 9, 9]);
    expect(g.cops).toHaveLength(27);
    expect(sim.cars.count).toBe(30);
    for (const r of g.runs) {
      expect(r.cops.filter((i) => sim.cars.active[i])).toHaveLength(2);
      for (const i of r.cops) expect(sim.cops[i]!.target).toBe(r.car);
    }
  });

  test('runners start apart outside the Bank, and standing there wrecks nobody', () => {
    const { sim, g } = runners(4);
    const c = sim.cars;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(Math.hypot(c.x[a] - c.x[b], c.z[a] - c.z[b])).toBeGreaterThan(4);
    for (let k = 0; k < 60; k++) sim.step([]);
    expect(g.runs.map((r) => r.end)).toEqual([null, null, null, null]);
  });

  test("a cop goes for another runner near it in its sight, and back to its own once they're away", () => {
    const { sim, g } = runners(2);
    const c = sim.cars;
    const cop = g.runs[0].cops.find((i) => c.active[i])!;
    const home = [c.x[1], c.z[1]] as const;
    // Runner 1, 12 m from runner 0's cop, somewhere it can see down a street.
    const st = new Streets(city.getaway!, city.houses ?? []);
    const spot = [0, 1, 2, 3]
      .map((q) => [c.x[cop] + Math.sin((q * Math.PI) / 2) * 12, c.z[cop] + Math.cos((q * Math.PI) / 2) * 12] as const)
      .find(([x, z]) => st.clear(c.x[cop], c.z[cop], x, z))!;
    expect(12).toBeLessThan(NEAR_TARGET);
    stand(sim, 1, spot[0], spot[1]);
    sim.step([]);
    expect(sim.cops[cop]!.target).toBe(1);
    // Back at the Bank, far off: its own runner again.
    stand(sim, 1, home[0], home[1]);
    sim.step([]);
    expect(sim.cops[cop]!.target).toBe(0);
  });

  test("a runner's wreck is their run over, and their cops leave the city; everyone else's go on", () => {
    const { sim, g } = runners(2);
    wreckCar(sim, 1, Cause.Wall, 0, 0, -1);
    sim.step([]);
    expect(g.runs[1].end).toBe('wrecked');
    expect(g.runs[1].cops.some((i) => sim.cars.active[i])).toBe(false);
    expect(g.runs[0].end).toBeNull();
    expect(g.runs[0].cops.some((i) => sim.cars.active[i])).toBe(true);
    expect(g.going).toBe(1);
    expect(g.allOut).toBe(false);
    // The last one out is first: runner 1 is behind runner 0, who's still going.
    expect(sim.cars.place[1]).toBe(2);
  });

  test("any cop on you counts toward busted, whoever's it is", () => {
    const { sim, g } = runners(2);
    const c = sim.cars;
    const cop = g.runs[0].cops.find((i) => c.active[i])!;
    // Runner 0's cop pulled up beside runner 1, on the side away from runner 0.
    const dx = c.x[1] - c.x[0];
    const dz = c.z[1] - c.z[0];
    const d = Math.hypot(dx, dz) || 1;
    for (const i of g.cops) sim.cops[i]!.stop = true;
    stand(sim, cop, c.x[1] + (dx / d) * 4, c.z[1] + (dz / d) * 4);
    for (let k = 0; k < 60 * (BUSTED + 0.5) && !g.runs[1].end; k++) sim.step([]);
    expect(g.runs[1].end).toBe('busted');
  });

  test("another screen's runner isn't out on this screen's say: their own screen's word ends it", () => {
    const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off', weather: 'clear' });
    sim.addCar({ cls: 'coupe', human: true });
    sim.addCar({ cls: 'coupe', human: true, remote: true });
    const g = new Getaway(sim, [0, 1]);
    expect(g.player).toBe(0);
    sim.startRace(3, 0.05);
    while (g.heat === 0) sim.step([]);
    // (A remote car is in once its entity shows: net/cars.ts.)
    sim.cars.active[1] = 1;
    wreckCar(sim, 1, Cause.Wall, 0, 0, -1);
    sim.step([]);
    expect(g.runs[1].end).toBeNull();
    g.endRemote(1, 'busted', 42.5);
    expect(g.runs[1]).toMatchObject({ end: 'busted', time: 42.5 });
    expect(sim.cars.finishTime[1]).toBe(42.5);
    // Not twice, and never for this screen's own runner.
    g.endRemote(1, 'wrecked', 50);
    g.endRemote(0, 'wrecked', 1);
    expect(g.runs[1].end).toBe('busted');
    expect(g.runs[0].end).toBeNull();
  });

  test('one runner is single player as it was: the whole pool, two out, the same getters', () => {
    const { sim, g } = getaway();
    expect(g.runs).toHaveLength(1);
    expect(g.cops).toHaveLength(COP_POOL);
    expect(g.player).toBe(0);
    expect(g.time).toBe(g.runs[0].time);
    expect(g.cops.filter((i) => sim.cars.active[i])).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test test/getaway.test.ts`
Expected: FAIL. `poolFor` and `NEAR_TARGET` aren't exported, and `g.runs` is undefined.

- [ ] **Step 3: `MAX_CARS` to 32, and `controlsFor` per run**

`src/core/sim.ts:37`:

```ts
export const MAX_CARS = 32;
```

`src/core/sim.ts:522-523`, replace the two lines

```ts
    // A getaway that's over: the car pulls up, whatever you press.
    if (this.getaway?.end && i === this.getaway.player) {
```

with

```ts
    // A getaway run that's over: the car pulls up, whatever you press.
    if (this.getaway?.runOf(i)?.end) {
```

- [ ] **Step 4: Rewrite `src/core/rules/getaway.ts`**

Replace the whole file with:

```ts
// A getaway (docs/CHASE_MODE.md): a map whose race is a run from the cops, not laps (its layout's
// `getaway`). You're away on green with two cruisers behind you; the heat goes up a level every
// minute and never comes down, and each level calls out another cop (a pool of cars added at the
// start, out of the race until they're called) and makes them all quicker and harder (ai/cop.ts).
// Your first wreck is the end of it, whatever wrecked you; so is being stopped with a cop on you
// for BUSTED s. The score is how long you lasted. A cop that wrecks or sticks comes back out of your
// sight; one that's fallen far behind is brought up closer.
//
// Online (the owner, 2026-10-09: "competitive survival and we add more cops"): a run for each
// runner, each with their own pool of cops; a cop goes for any runner near it, not only its own,
// and any cop on you counts toward busted. Each runner's own screen says when they're out (another
// screen's runner ends by `endRemote`, from their car's entity: net/cars.ts), and the room's host
// drives every cop (net/cops.ts): a cop that's the host's (`remote`) isn't called out here.

import { newCop, type CopDriver } from '../ai/cop';
import { Ev } from '../events';
import { atan2, cos, hypot, sin } from '../math';
import { Rng } from '../rng';
import { MAX_CARS, type Sim } from '../sim';
import { newHit, projectGlobal } from '../track/query';
import { Streets } from '../world/streets';

/** The heat goes up a level every this many seconds. */
export const HEAT_EVERY = 60;
/** How many cops are out at each heat: one more than the heat, up to the pool. */
const COPS_FOR = (heat: number) => heat + 1;
/** The cars kept for each runner's cops, at most (a lone getaway car and these fill MAX_CARS with room to spare). */
export const COP_POOL = 10;
/** Each runner's cops: the pool, or as many as fit with every runner in MAX_CARS. */
export const poolFor = (runners: number): number => Math.min(COP_POOL, Math.floor((MAX_CARS - runners) / runners));
/** A new cop is called out at most this often (s), so the heat's cops don't all turn up at once. */
const CALL_EVERY = 3;
/**
 * Where cops are called out: this far from you (m), at a crossing out of your sight; behind you at
 * heat 1, and from heat 2 ahead of you too, but never nearer than CALL_AHEAD (m) ahead (CHASE_MODE's
 * "fair, not cheap").
 */
const CALL_NEAR = 150;
const CALL_FAR = 300;
const CALL_AHEAD = 220;
/** The first two start this far behind you on the road (m), one after the other. */
const START_BEHIND = [130, 150];
/** Online, runners start in pairs this far either side of the Bank's spot (m), a row this far back for each pair. */
const START_SIDE = 2.4;
const START_ROW = 7;
/** Stopped (under BUSTED_SPEED m/s) with a cop within BUSTED_NEAR m for BUSTED s: busted. */
export const BUSTED = 2;
const BUSTED_SPEED = 2.5;
const BUSTED_NEAR = 7.5;
/** A cop goes for another runner this near (m) in its sight, and back to its own once they're 1.5 times as far, or out of sight. */
export const NEAR_TARGET = 40;
/** A wrecked cop comes back (out of sight) this long after (s), a stuck one after this long stuck, a cop further than FAR m off is brought closer. */
const COP_WRECK = 1.4;
const COP_STUCK = 2.5;
const FAR = 320;
/** Cops' boost fills this much a second (from heat 3 they use it to close in). */
const COP_BOOST = 0.06;

/** How a run ended: wrecked (a crash of any kind), or busted (stopped with the cops on you). */
export type GetawayEnd = 'wrecked' | 'busted';

/** One runner's run: their car, their cops, how it's going. */
export interface Run {
  car: number;
  /** Their cops (car indexes), and the cops' drivers, in the same order. */
  cops: number[];
  drivers: CopDriver[];
  /** How long they've lasted (s): the score. */
  time: number;
  /** How close they are to being busted (0..1). */
  busted: number;
  /** How it ended, once it has. */
  end: GetawayEnd | null;
  /** When their last new cop was called out (sim time). */
  calledAt: number;
}

export class Getaway {
  /** The heat now (1 up; 0 before the green light): the race's, every runner's. */
  heat = 0;
  readonly runs: Run[];
  /** The runners' cars, in seat order. */
  readonly runners: readonly number[];
  /** Every cop, run by run: the same order on every screen (net/cops.ts names them by it). */
  readonly cops: number[];
  /** This screen's runner (the first not driven from another screen), or the first. */
  readonly player: number;
  private readonly streets: Streets;
  private readonly rng: Rng;
  private readonly hit = newHit();

  /**
   * The getaway on `sim` for the car or cars `runners` (a race on a map with one): each one's cops
   * added to the sim (out of the race until called) and the rules in place. Before the race starts.
   */
  constructor(
    private readonly sim: Sim,
    runners: number | readonly number[],
  ) {
    const def = sim.track.layout.getaway!;
    this.streets = new Streets(def, sim.track.layout.houses ?? []);
    this.rng = Rng.stream(sim.seed, 'getaway');
    this.runners = typeof runners === 'number' ? [runners] : [...runners];
    const pool = poolFor(this.runners.length);
    this.runs = this.runners.map((car) => {
      const run: Run = { car, cops: [], drivers: [], time: 0, busted: 0, end: null, calledAt: -Infinity };
      for (let k = 0; k < pool; k++) {
        const cop = newCop(this.streets, car);
        const i = sim.addCar({ cls: 'police', cop });
        sim.cars.active[i] = 0;
        run.cops.push(i);
        run.drivers.push(cop);
      }
      return run;
    });
    this.cops = this.runs.flatMap((r) => r.cops);
    this.player = this.runners.find((i) => !sim.cars.remote[i]) ?? this.runners[0];
    sim.getaway = this;
  }

  /** Car `car`'s run, if it's a runner. */
  runOf(car: number): Run | undefined {
    return this.runs.find((r) => r.car === car);
  }

  private get mine(): Run {
    return this.runOf(this.player)!;
  }

  /** How long this screen's runner has lasted (s). */
  get time(): number {
    return this.mine.time;
  }

  /** How close this screen's runner is to being busted (0..1). */
  get busted(): number {
    return this.mine.busted;
  }

  /** How this screen's runner's run ended, once it has. */
  get end(): GetawayEnd | null {
    return this.mine.end;
  }

  /** How many runners are still going. */
  get going(): number {
    let n = 0;
    for (const r of this.runs) if (!r.end) n++;
    return n;
  }

  /** Every run's over. */
  get allOut(): boolean {
    return this.going === 0;
  }

  /** The rules, once a tick (sim.ts's rules system), after the cars have moved. */
  step(dt: number): void {
    const sim = this.sim;
    const c = sim.cars;
    if (sim.race.phase !== 'racing' || this.allOut) return;
    // Green: away, each with the first two behind them.
    if (this.heat === 0) {
      this.heat = 1;
      for (const run of this.runs) this.startCops(run);
    }
    const time = sim.time - sim.race.goTime;
    const heat = 1 + Math.floor(time / HEAT_EVERY);
    if (heat > this.heat) {
      this.heat = heat;
      const p = this.player;
      sim.events.push(sim.tick, Ev.Heat, p, c.x[p], c.y[p], c.z[p], heat);
    }
    for (const run of this.runs) for (const d of run.drivers) d.heat = this.heat;
    for (const run of this.runs) if (!run.end) this.stepRun(run, time, dt);
  }

  /** Another screen's runner is out, as their car's entity says (net/cars.ts), after `time` s. */
  endRemote(car: number, end: GetawayEnd, time: number): void {
    const run = this.runOf(car);
    if (!run || run.end || !this.sim.cars.remote[car]) return;
    this.over(run, end, time);
  }

  /** One run's tick: is it over, which runner each of its cops is after, and its cops out and back. */
  private stepRun(run: Run, time: number, dt: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    run.time = time;
    // Another screen's runner: their own screen says when they're out (endRemote).
    if (!c.remote[p]) {
      // Any crash is the end of it (a reset too: there's no road back to put you on).
      if (c.wreck[p]) return this.over(run, 'wrecked', time);
      // Stopped with a cop on you: any cop, whoever it's after.
      const speed = hypot(c.vx[p], c.vz[p]);
      let near = false;
      for (const i of this.cops) if (c.active[i] && !c.wreck[i] && hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) < BUSTED_NEAR) near = true;
      run.busted = near && speed < BUSTED_SPEED ? run.busted + dt / BUSTED : Math.max(0, run.busted - (dt * 2) / BUSTED);
      if (run.busted >= 1) return this.over(run, 'busted', time);
    }
    this.retarget(run);
    // The heat's number of them out, and any wrecked, stuck or far behind back in the chase.
    let out = 0;
    for (let k = 0; k < run.cops.length; k++) {
      const i = run.cops[k];
      if (!c.active[i]) continue;
      out++;
      // The host's to drive (net/cops.ts): it calls them out and brings them back.
      if (c.remote[i]) continue;
      c.boost[i] = Math.min(1, c.boost[i] + COP_BOOST * dt);
      const far = hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) > FAR;
      if ((c.wreck[i] && c.wreckT[i] > COP_WRECK) || c.stuckT[i] > COP_STUCK || far) this.callOut(run, k);
    }
    if (out < Math.min(COPS_FOR(this.heat), run.cops.length) && sim.time - run.calledAt > CALL_EVERY) {
      const k = run.cops.findIndex((i) => !c.active[i] && !c.remote[i]);
      // (Only a new cop starts the wait for the next: bringing one back doesn't.)
      if (k >= 0) this.callOut(run, k), (run.calledAt = sim.time);
    }
  }

  /**
   * Each of the run's cops after the nearest other runner within NEAR_TARGET it can see (kept while
   * they're within 1.5 times that), else its own runner. With one runner, always its own.
   */
  private retarget(run: Run): void {
    if (this.runs.length < 2) return;
    const c = this.sim.cars;
    const st = this.streets;
    for (let k = 0; k < run.cops.length; k++) {
      const i = run.cops[k];
      const d = run.drivers[k];
      if (!c.active[i] || c.remote[i]) continue;
      let to = run.car;
      let toD = Infinity;
      for (const other of this.runs) {
        if (other === run || other.end) continue;
        const j = other.car;
        const dist = hypot(c.x[i] - c.x[j], c.z[i] - c.z[j]);
        const reach = d.target === j ? NEAR_TARGET * 1.5 : NEAR_TARGET;
        if (dist < reach && dist < toD && st.clear(c.x[i], c.z[i], c.x[j], c.z[j])) (to = j), (toD = dist);
      }
      if (to === d.target) continue;
      d.target = to;
      // (A new way to them, planned on its next tick.)
      d.pathLen = 0;
      d.planAt = 0;
      d.lookAt = 0;
    }
  }

  /**
   * The runners where the layout says they start (outside the Bank), facing its way, stopped: after
   * the grid's put them on the main road (sim.ts's startRace). Online, in pairs either side of that
   * spot, a row back for each pair.
   */
  atStart(): void {
    const start = this.sim.track.layout.getaway!.start;
    if (!start) return;
    const [x0, z0] = start.at;
    const h = start.heading;
    const many = this.runs.length > 1;
    this.runs.forEach((run, r) => {
      const back = Math.floor(r / 2) * START_ROW;
      const side = many ? (r % 2 ? 1 : -1) * START_SIDE : 0;
      this.put(run.car, x0 - sin(h) * back + cos(h) * side, z0 - cos(h) * back - sin(h) * side, h);
    });
  }

  /** A run's two at the start: behind its runner (in the streets if they start in them, else on the road), facing their way. */
  private startCops(run: Run): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    const main = sim.track.main;
    run.calledAt = sim.time;
    if (sim.track.layout.getaway!.start) {
      // The crossings behind them, the nearest first past START_BEHIND[0].
      const st = this.streets;
      const hx = sin(c.h[p]);
      const hz = cos(c.h[p]);
      const behind = Array.from({ length: st.n }, (_, n) => n)
        .filter((n) => (st.x(n) - c.x[p]) * hx + (st.z(n) - c.z[p]) * hz < 0 && hypot(st.x(n) - c.x[p], st.z(n) - c.z[p]) > START_BEHIND[0] * 0.7)
        .sort((a, b) => hypot(st.x(a) - c.x[p], st.z(a) - c.z[p]) - hypot(st.x(b) - c.x[p], st.z(b) - c.z[p]));
      // Two each, at crossings no other runner's cop has taken.
      for (let b = 0, k = 0; k < 2 && b < behind.length; b++) {
        const n = behind[b];
        if (this.cops.some((j) => c.active[j] && hypot(c.x[j] - st.x(n), c.z[j] - st.z(n)) < 12)) continue;
        const i = run.cops[k++];
        // The host's (net/cops.ts) are where it puts them.
        if (c.remote[i]) continue;
        this.put(i, st.x(n), st.z(n), atan2(c.x[p] - st.x(n), c.z[p] - st.z(n)));
        c.active[i] = 1;
      }
      return;
    }
    START_BEHIND.forEach((back, k) => {
      const i = run.cops[k];
      if (c.remote[i]) return;
      sim.placeCar(i, 0, (((c.s[p] - back) % main.length) + main.length) % main.length, c.lateral[p], 0);
      c.active[i] = 1;
      c.boost[i] = 0;
    });
  }

  /**
   * A run's cop `k` out at a crossing out of its runner's sight, CALL_NEAR to CALL_FAR m from them,
   * behind them if there's one, facing them; anywhere far enough if none is out of sight.
   */
  private callOut(run: Run, k: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    const st = this.streets;
    const hx = sin(c.h[p]);
    const hz = cos(c.h[p]);
    let best = -1;
    let bestScore = -Infinity;
    for (let n = 0; n < st.n; n++) {
      const dx = st.x(n) - c.x[p];
      const dz = st.z(n) - c.z[p];
      const d = hypot(dx, dz);
      if (d < CALL_NEAR) continue;
      // Out of sight, not too far, behind them at first (ahead later, not too close), and a little luck.
      const ahead = dx * hx + dz * hz > 0;
      if (ahead && d < CALL_AHEAD) continue;
      // (Never as far as FAR: it'd be far again at once, and called out again every tick.)
      if (d > FAR - 10) continue;
      let score = this.rng.next() * 40 - Math.max(0, d - CALL_FAR);
      if (this.heat <= 1 ? !ahead : ahead) score += 60;
      if (!st.clear(c.x[p], c.z[p], st.x(n), st.z(n))) score += 100;
      // Not on top of another cop.
      for (const j of this.cops) if (c.active[j] && hypot(c.x[j] - st.x(n), c.z[j] - st.z(n)) < 12) score -= 200;
      if (score > bestScore) (bestScore = score), (best = n);
    }
    // (None in the ring: the nearest crossing past CALL_NEAR, so a far cop is always brought back.)
    if (best < 0)
      for (let n = 0; n < st.n; n++) {
        const d = hypot(st.x(n) - c.x[p], st.z(n) - c.z[p]);
        if (d >= CALL_NEAR && (best < 0 || d < hypot(st.x(best) - c.x[p], st.z(best) - c.z[p]))) best = n;
      }
    if (best < 0) return;
    const i = run.cops[k];
    const x = st.x(best);
    const z = st.z(best);
    this.put(i, x, z, atan2(c.x[p] - x, c.z[p] - z));
    c.active[i] = 1;
    c.boost[i] = 0;
    // (Back after its own runner, on a new way to them planned on its next tick.)
    const d = run.drivers[k];
    d.target = p;
    d.pathLen = 0;
    d.planAt = 0;
    d.lookAt = 0;
  }

  /** Car `i` at (x, z) on the ground, facing `h`, stopped: everything about it reset (placeCar), then where it really is. */
  private put(i: number, x: number, z: number, h: number): void {
    const sim = this.sim;
    const c = sim.cars;
    // (On the main road where it's nearest, so its place along it, and a respawn, are near where it is.)
    projectGlobal(sim.track.main, x, z, this.hit);
    sim.placeCar(i, 0, this.hit.s, 0, 0);
    const ground = sim.track.ground;
    c.x[i] = c.px[i] = x;
    c.z[i] = c.pz[i] = z;
    c.y[i] = c.py[i] = ground ? ground.height(x, z) : 0;
    c.h[i] = c.ph[i] = h;
  }

  /** A run over: its time kept, its car finished, and its cops stopped (alone) or out of the city (online). */
  private over(run: Run, end: GetawayEnd, time: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    run.end = end;
    run.time = time;
    c.finished[p] = 1;
    c.finishTime[p] = time;
    // The last out is first: one place behind everyone still going.
    c.place[p] = this.going + 1;
    sim.race.finishedCount++;
    if (this.runs.length === 1) for (const d of run.drivers) d.stop = true;
    // (The host's take theirs off: net/cops.ts.)
    else for (const i of run.cops) if (!c.remote[i]) c.active[i] = 0;
    sim.events.push(sim.tick, Ev.Busted, p, c.x[p], c.y[p], c.z[p], time, end === 'busted' ? 1 : 0);
  }
}
```

- [ ] **Step 5: Run the getaway tests**

Run: `bun run test test/getaway.test.ts`
Expected: PASS, the new tests and every existing one. If "runners start apart … wrecks nobody" fails because a runner starts in a building, make `START_ROW` smaller (not under 5.5) or `START_SIDE` smaller (not under 2.2) until it passes, and say which in the commit message.

- [ ] **Step 6: Run the whole suite and the type check**

Run: `bun run typecheck && bun run test`
Expected: PASS. With `MAX_CARS` at 32, the golden and render tests must still pass. If one fails on a fixed car count, fix the count it assumed. Don't change the golden data.

- [ ] **Step 7: Commit**

```bash
git add src/core/rules/getaway.ts src/core/sim.ts test/getaway.test.ts
git commit -m "The getaway for many runners: a run and cops each, cops go for the near one, 32 cars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A runner's end on their car's entity

**Files:**
- Modify: `src/net/wire.ts` (add `readRunEnd`, `readTarget`)
- Modify: `src/net/cars.ts` (`NetCars`: `out` and `runT` on your car; `endRemote` from theirs)
- Test: `test/net.test.ts`

**Interfaces:**
- Consumes: `Getaway.runOf`, `Getaway.endRemote`, `GetawayEnd` (Task 1); `sim.getaway`.
- Produces:
  - `export function readRunEnd(out: unknown, runT: unknown): { end: GetawayEnd; time: number } | null` (wire.ts)
  - `export function readTarget(v: unknown, runners: readonly number[]): number | null` (wire.ts)
  - `export const RUN_FIELDS` (cars.ts): `{ out: int, runT: num }` on the `car` kind.

- [ ] **Step 1: Write the failing tests**

In `test/net.test.ts`, add `readRunEnd, readTarget` to the `../src/net/wire` import. Then add this at the end of the file:

```ts
describe("a getaway runner's end, on their car", () => {
  test('read as wrecked (1) or busted (2) with the time lasted; anything else is still going, or nonsense', () => {
    expect(readRunEnd(1, 61.25)).toEqual({ end: 'wrecked', time: 61.25 });
    expect(readRunEnd(2, 5)).toEqual({ end: 'busted', time: 5 });
    expect(readRunEnd(0, 30)).toBeNull();
    expect(readRunEnd(3, 30)).toBeNull();
    expect(readRunEnd(1.5, 30)).toBeNull();
    expect(readRunEnd(1, -1)).toBeNull();
    expect(readRunEnd(1, NaN)).toBeNull();
    expect(readRunEnd(1, 1e9)).toBeNull();
    expect(readRunEnd('1', 30)).toBeNull();
  });

  test("a cop's target is one of the runners, or nothing", () => {
    expect(readTarget(2, [0, 1, 2])).toBe(2);
    expect(readTarget(5, [0, 1, 2])).toBeNull();
    expect(readTarget(1.5, [0, 1, 2])).toBeNull();
    expect(readTarget('1', [0, 1, 2])).toBeNull();
  });

  test("your run's end goes out on your car, and theirs ends their run on your screen", () => {
    const hub = new Hub();
    const make = (meSeat: 0 | 1) => {
      const sim = citySim();
      const ids = ['ada', 'bo'];
      sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
      sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
      const g = new Getaway(sim, [0, 1]);
      sim.startRace(3, 0.05);
      const net = new NetCars(hub.room(ids[meSeat]), () => hub.now, sim, meSeat, new Map([[ids[1 - meSeat], 1 - meSeat]]));
      return { sim, g, net, me: meSeat };
    };
    const ada = make(0);
    const bo = make(1);
    const both = () => {
      for (const p of [ada, bo]) {
        p.net.beforeStep();
        p.sim.step([]);
        p.net.afterStep();
      }
    };
    while (ada.g.heat === 0 || bo.g.heat === 0) both();
    for (let k = 0; k < 30; k++) both();
    wreckCar(ada.sim, 0, Cause.Wall, 0, 0, -1);
    both();
    expect(ada.g.runs[0].end).toBe('wrecked');
    both();
    expect(bo.g.runs[0].end).toBe('wrecked');
    expect(bo.g.runs[0].time).toBeCloseTo(ada.g.runs[0].time, 2);
    expect(bo.g.runs[1].end).toBeNull();
  });
});
```

Add the imports this needs at the top of `test/net.test.ts`:

```ts
import { Getaway } from '../src/core/rules/getaway';
```

`citySim` is already imported from `./helpers`. Check that it builds `heist/city`:

Run: `grep -n "export function citySim" -A6 test/helpers.ts`

If it builds a different city, use the `getaway.test.ts` way instead: `new Sim(bakeTrack(layout('heist/city'), SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off', weather: 'clear' })`, with `Sim`, `bakeTrack`, `layout` and `SURFACES` imported as `getaway.test.ts` does.

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test test/net.test.ts`
Expected: FAIL, because `readRunEnd` and `readTarget` aren't exported.

- [ ] **Step 3: The readers in `src/net/wire.ts`**

Add next to `readHandover`, using the helpers `finite` and `intIn` that the file already has:

```ts
import type { GetawayEnd } from '../core/rules/getaway';

/** The longest run another screen may say its runner lasted (s): ten hours. */
const MAX_RUN = 36_000;

/** A getaway runner's end from their car's entity: `out` 1 wrecked, 2 busted, with the time lasted; still going (0) or nonsense, null. */
export function readRunEnd(out: unknown, runT: unknown): { end: GetawayEnd; time: number } | null {
  if (out !== 1 && out !== 2) return null;
  const t = finite(runT);
  if (t === null || t < 0 || t > MAX_RUN) return null;
  return { end: out === 1 ? 'wrecked' : 'busted', time: t };
}

/** A cop's runner, from its entity: one of `runners` (car indexes), or null. */
export function readTarget(v: unknown, runners: readonly number[]): number | null {
  return typeof v === 'number' && Number.isInteger(v) && runners.includes(v) ? v : null;
}
```

If `finite` takes `unknown` and returns `number | null`, use it as it is. If its signature is different, match it as `readHandover` does.

- [ ] **Step 4: `NetCars` sends your end and reads theirs (`src/net/cars.ts`)**

Add after `CAR_FIELDS`:

```ts
/** A getaway runner's run on their car (rules/getaway.ts): 0 going, 1 wrecked, 2 busted, and how long they've lasted (s). */
export const RUN_FIELDS = {
  out: { type: 'number', precision: 1, smooth: false },
  runT: { type: 'number', precision: 0.01, smooth: false },
} as const;
```

In `NetCars`, add a field `/** Each other runner's time lasted, as last sent: their time if they go. */ private runT = new Map<string, number>();` and change these:

```ts
    this.kind = room.define('car', { ...CAR_FIELDS, ...RUN_FIELDS }, { rate: CAR_RATE });
    this.mine = this.kind.spawn(this.fields());
```

```ts
  /** Your car's fields, with your getaway run's end and time (0, 0 when it isn't one). */
  private fields(): Record<string, number | boolean> {
    const run = this.sim.getaway?.runOf(this.me);
    return { ...carFields(this.sim, this.me), out: run?.end === 'busted' ? 2 : run?.end ? 1 : 0, runT: run?.time ?? 0 };
  }
```

In `beforeStep`, inside the loop after `this.sim.controls[i].steer = remoteSteer(e);`:

```ts
      // A getaway: their screen says when they're out.
      const g = this.sim.getaway;
      if (g) {
        const t = finiteOr(e.runT, 0);
        this.runT.set(e.owner.id, t);
        const end = readRunEnd(e.out, e.runT);
        if (end) g.endRemote(i, end.end, end.time);
      }
```

Replace the "gone for good" line with:

```ts
    for (const [id, i] of this.remote)
      if (this.seen.has(id) && !here.has(id)) {
        this.sim.cars.active[i] = 0;
        // Gone mid-getaway: out, at the time they'd lasted when last heard from.
        this.sim.getaway?.endRemote(i, 'wrecked', this.runT.get(id) ?? 0);
      }
```

In `afterStep`, change `const f = carFields(this.sim, i);` to `const f = this.fields();`.

Add `readRunEnd` to the imports from `./wire`. `finiteOr` is already imported from `./check`.

- [ ] **Step 5: Run the tests**

Run: `bun run test test/net.test.ts`
Expected: PASS, the new tests and every existing one. Remote cars outside a getaway now send `out: 0, runT: 0`, and nothing reads them there.

- [ ] **Step 6: Commit**

```bash
git add src/net/wire.ts src/net/cars.ts test/net.test.ts
git commit -m "A getaway runner's end goes out on their car, and ends their run on every screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The host drives the cops (`net/cops.ts`)

**Files:**
- Create: `src/net/cops.ts`
- Create: `test/hub.ts` (move `class Hub` out of `test/net.test.ts`)
- Create: `test/net-cops.test.ts`
- Modify: `src/net/rivals.ts` (export `HANDOVER`, `HANDOVER_FIELDS`)
- Modify: `src/net/contact.ts:40-49` (`carNames` takes cops; `c:` names are the host's)
- Modify: `src/net/join.ts` (make `NetCops`; `NetLayers.cops`)
- Modify: `src/net/online.ts` (`beforeStep`/`afterStep` call `cops`)
- Modify: `test/net.test.ts` (import `Hub` from `./hub`)

**Interfaces:**
- Consumes: `Getaway.cops`, `Getaway.runners`, `Sim.cops[i].target` (Task 1); `readTarget` (Task 2); `CAR_FIELDS`, `CAR_RATE`, `carFields`, `predict`, `predictLead`, `remoteSteer`, `TELEPORT_M`, `NetRoom`, `NetKind`, `NetEntity` (cars.ts).
- Produces:
  - `export const HANDOVER`, `export const HANDOVER_FIELDS` (rivals.ts)
  - `export const COP_FIELDS`, `export class NetCops { constructor(room: NetRoom, now: () => number, sim: Sim, race: string); beforeStep(): void; afterStep(): void }` (cops.ts)
  - `carNames(me, myId, remote, aiSeats, cops: readonly number[] = [])`: a cop is `c:<k>`, its index in `Getaway.cops`
  - `NetLayers.cops: NetCops | null`

- [ ] **Step 1: Move the stand-in room**

Cut `class Hub { … }` (the whole class, from its doc comment `/** A room's entities, shared by every player's view of it …` to its closing brace) out of `test/net.test.ts` into a new file, `test/hub.ts`:

```ts
// A stand-in for the SDK's room and entities (the network left out), shared by the net tests.

import type { NetEntity, NetKind, NetRoom } from '../src/net/cars';

/** A room's entities, shared by every player's view of it: the SDK, minus the network. */
export class Hub {
  // … the class body, unchanged …
}
```

In `test/net.test.ts`, add `import { Hub } from './hub';` and remove `NetEntity, NetKind, NetRoom` from the `../src/net/cars` import if nothing else there uses them.

Run: `bun run test test/net.test.ts`
Expected: PASS, the same tests as before.

- [ ] **Step 2: Write the failing tests**

Create `test/net-cops.test.ts`:

```ts
// The cops online (docs/superpowers/specs/2026-10-09-online-getaway-design.md): the room's host
// drives every runner's cops and sends them as `cop` entities; everyone else has them where the
// host's sim puts them. These run two screens through the stand-in room.

import { describe, expect, test } from 'bun:test';
import { Getaway } from '../src/core/rules/getaway';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { NetCars } from '../src/net/cars';
import { NetCops } from '../src/net/cops';
import { carNames } from '../src/net/contact';
import { CLASSES, SURFACES, layout } from './helpers';
import { Hub } from './hub';

const city = layout('heist/city');

/** Ada (seat 0) and Bo (seat 1), each a runner on their own screen with the other remote, and the cops. */
function chase() {
  const hub = new Hub();
  const make = (meSeat: 0 | 1) => {
    const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 7, traffic: 0, mayhem: 'off', weather: 'clear' });
    const ids = ['ada', 'bo'];
    sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    const g = new Getaway(sim, [0, 1]);
    sim.startRace(3, 0.05);
    const room = hub.room(ids[meSeat]);
    const net = new NetCars(room, () => hub.now, sim, meSeat, new Map([[ids[1 - meSeat], 1 - meSeat]]));
    const cops = new NetCops(room, () => hub.now, sim, 'r1');
    return { sim, g, net, cops };
  };
  return { hub, ada: make(0), bo: make(1) };
}

type Screen = ReturnType<typeof chase>['ada'];

function step(p: Screen): void {
  p.net.beforeStep();
  p.cops.beforeStep();
  p.sim.step([]);
  p.net.afterStep();
  p.cops.afterStep();
}

const copsIn = (hub: Hub) => hub.entities.filter((e) => e.kind === 'cop' && !e.removed);
const gap = (a: Sim, b: Sim, i: number) => Math.hypot(a.cars.x[i] - b.cars.x[i], a.cars.z[i] - b.cars.z[i]);

describe('cops online', () => {
  test("the host drives every cop, and the other screen has them where the host's sim puts them", () => {
    const { hub, ada, bo } = chase();
    for (let k = 0; k < 600; k++) step(ada), step(bo);
    // One entity a cop, the host's, for every runner's pool.
    expect(copsIn(hub)).toHaveLength(ada.g.cops.length);
    expect(copsIn(hub).every((e) => e.owner === 'host')).toBe(true);
    const active = ada.g.cops.filter((i) => ada.sim.cars.active[i]);
    expect(active.length).toBeGreaterThanOrEqual(4);
    for (const i of ada.g.cops) {
      expect(ada.sim.cars.remote[i]).toBe(0);
      expect(bo.sim.cars.remote[i]).toBe(1);
      expect(bo.sim.cars.active[i]).toBe(ada.sim.cars.active[i]);
    }
    // Bo's copy of each is Ada's, a step behind at most.
    for (const i of active) expect(gap(ada.sim, bo.sim, i)).toBeLessThan(Math.hypot(ada.sim.cars.vx[i], ada.sim.cars.vz[i]) / 60 + 0.05);
    // And who each is after, so a new host carries on.
    for (const i of active) expect(bo.sim.cops[i]!.target).toBe(ada.sim.cops[i]!.target);
  });

  test("until the host's cops show up, every screen drives them itself, from the same start", () => {
    const { hub, ada, bo } = chase();
    hub.host = 'nobody';
    for (let k = 0; k < 300; k++) step(ada), step(bo);
    expect(copsIn(hub)).toHaveLength(0);
    for (const i of ada.g.cops) expect(bo.sim.cars.remote[i]).toBe(0);
    const active = ada.g.cops.filter((i) => ada.sim.cars.active[i]);
    expect(active.length).toBeGreaterThanOrEqual(4);
    // The same cops called out to the same places (the runners parked on both screens).
    for (const i of active) expect(gap(ada.sim, bo.sim, i)).toBeLessThan(0.5);
  });

  test('when the host role moves, the next host drives them on from where they are: no new cops, no jump', () => {
    const { hub, ada, bo } = chase();
    for (let k = 0; k < 600; k++) step(ada), step(bo);
    const before = copsIn(hub).length;
    const i = ada.g.cops.find((j) => ada.sim.cars.active[j])!;
    const was = { x: bo.sim.cars.x[i], z: bo.sim.cars.z[i] };
    hub.host = 'bo';
    step(bo);
    expect(bo.sim.cars.remote[i]).toBe(0);
    expect(Math.hypot(bo.sim.cars.x[i] - was.x, bo.sim.cars.z[i] - was.z)).toBeLessThan(2);
    for (let k = 0; k < 60; k++) step(ada), step(bo);
    expect(copsIn(hub)).toHaveLength(before);
    expect(ada.sim.cars.remote[i]).toBe(1);
  });

  test("a cop's name is its place among the getaway's cops, the host's to tell", () => {
    const names = carNames(0, 'ada', new Map([['bo', 1]]), new Map(), [2, 3, 4]);
    expect(names.name(3)).toBe('c:1');
    expect(names.index('c:2')).toBe(4);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `bun run test test/net-cops.test.ts`
Expected: FAIL, because the module `../src/net/cops` isn't there.

- [ ] **Step 4: Export the handover from `src/net/rivals.ts`**

Replace the `HANDOVER` and `RIVAL_FIELDS` declarations with:

```ts
/**
 * What the next host needs to drive a rival on from where it is, besides its pose: its wreck (how
 * long, why, and the tumble's spin), its boost and its last good spot on the road (a respawn goes
 * there). Every screen copies these into its sim as they come, so it has them when the role
 * arrives. (The AI's stuck recovery starts over: it's a second or two of state at most.) A cop's
 * the same (net/cops.ts).
 */
export const HANDOVER = ['wreckT', 'wreckCause', 'wx', 'wy', 'wz', 'boost', 'lastSpline', 'lastS', 'lastLat'] as const;

/** The handover's entity fields. */
export const HANDOVER_FIELDS = {
  wreckT: num,
  wreckCause: int,
  wx: num,
  wy: num,
  wz: num,
  boost: num,
  lastSpline: int,
  lastS: num,
  lastLat: num,
} as const;

/**
 * A rival's entity: its car, the lobby seat it's in (the same on every screen), the race it's in
 * (a room's host entities outlive a race: the last race's are someone else's), and the handover.
 */
export const RIVAL_FIELDS = {
  ...CAR_FIELDS,
  seat: int,
  race: 'text',
  ...HANDOVER_FIELDS,
} as const;
```

- [ ] **Step 5: Create `src/net/cops.ts`**

```ts
// The cops online (docs/superpowers/specs/2026-10-09-online-getaway-design.md): the room's host
// drives every runner's cops (rules/getaway.ts), so every screen is chased by the same ones. Each
// cop is a host entity (`cop`: a car's fields, its place among the getaway's cops, whether it's out,
// who it's after, and the rivals' handover), written from the host's sim after each step; everyone
// else has it as a remote car, put where its entity says.
//
// As with the rivals (net/rivals.ts): the host role moves by itself and its entities go with it. A
// cop plans its way again every half second (ai/cop.ts), so whoever holds the role drives them on
// from where they are. Until the host's cops show up, every screen drives them itself.

import type { Sim } from '../core/sim';
import { CAR_FIELDS, CAR_RATE, carFields, predict, predictLead, remoteSteer, TELEPORT_M, type NetEntity, type NetKind, type NetRoom } from './cars';
import { HANDOVER, HANDOVER_FIELDS } from './rivals';
import { readHandover, readTarget } from './wire';

const int = { type: 'number', precision: 1, smooth: false } as const;

/** A cop's entity: its car, its place among the getaway's cops, the race, whether it's out, its runner, and the handover. */
export const COP_FIELDS = {
  ...CAR_FIELDS,
  slot: int,
  race: 'text',
  active: 'flag',
  target: int,
  ...HANDOVER_FIELDS,
} as const;

export class NetCops {
  private kind: NetKind;
  /** Where each cop was after the last step it was written in, to tell a call-out from a drive. */
  private last = new Map<number, { x: number; z: number }>();

  constructor(
    private room: NetRoom,
    /** The server's clock (ms). */
    private now: () => number,
    private sim: Sim,
    /** This race, the same on every screen (its seed and start). */
    private race: string,
  ) {
    this.kind = room.define('cop', COP_FIELDS, { rate: CAR_RATE });
  }

  /** This race's cop entities by slot: the first of each (two hosts at once, for a moment, can both spawn one). */
  private bySlot(list: NetEntity[]): Map<number, NetEntity> {
    const n = this.sim.getaway?.cops.length ?? 0;
    const out = new Map<number, NetEntity>();
    for (const e of list) {
      const k = e.slot;
      if (e.race === this.race && typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < n && !out.has(k)) out.set(k, e);
    }
    return out;
  }

  /** Before each step: drive them here (you're the host, or nobody's sending them), or put them where the host says. */
  beforeStep(): void {
    const g = this.sim.getaway;
    if (!g) return;
    const c = this.sim.cars;
    if (this.room.isHost) {
      for (const i of g.cops) c.remote[i] = 0;
      return;
    }
    this.last.clear();
    const lead = predictLead(this.room, this.now());
    const theirs = this.bySlot(this.kind.all().filter((e) => e.owner.id === this.room.hostId));
    g.cops.forEach((i, k) => {
      const e = theirs.get(k);
      // Not sent (yet): this screen drives it, as the host would.
      if (!e) {
        c.remote[i] = 0;
        return;
      }
      c.remote[i] = 1;
      c.active[i] = e.active ? 1 : 0;
      const target = readTarget(e.target, g.runners);
      if (target !== null) this.sim.cops[i]!.target = target;
      if (!e.active) return;
      this.sim.setPose(i, predict(e, lead));
      this.sim.controls[i].steer = remoteSteer(e);
      for (const f of HANDOVER) {
        const v = readHandover(f, e[f], this.sim.track.splines.length);
        if (v !== null) c[f][i] = v;
      }
    });
  }

  /** After each step, on the host: every cop as it is now, out or not, for everyone else (spawned the first time). */
  afterStep(): void {
    const g = this.sim.getaway;
    if (!g || !this.room.isHost) return;
    const c = this.sim.cars;
    const ours = this.kind.mine();
    const bySlot = this.bySlot(ours);
    // A second host's cops for the same slots, and the last race's: done with.
    for (const e of ours) if (bySlot.get(e.slot as number) !== e) e.remove();
    g.cops.forEach((i, k) => {
      const f: Record<string, number | boolean | string> = { ...carFields(this.sim, i), slot: k, race: this.race, active: c.active[i] === 1, target: this.sim.cops[i]!.target };
      for (const h of HANDOVER) f[h] = c[h][i];
      let e = bySlot.get(k);
      if (!e) {
        e = this.kind.spawn(f, { owner: 'host' });
      } else {
        for (const key in f) e[key] = f[key];
        // Called out (or brought back): a jump, not a drive across the city.
        const was = this.last.get(k);
        if (was && Math.hypot(c.x[i] - was.x, c.z[i] - was.z) > TELEPORT_M) e.teleport();
      }
      this.last.set(k, { x: c.x[i], z: c.z[i] });
    });
  }
}
```

- [ ] **Step 6: Cops' names in `src/net/contact.ts`**

Replace `carNames` and `ownerOf` (lines 40-49) with:

```ts
export function carNames(me: number, myId: string, remote: ReadonlyMap<string, number>, aiSeats: ReadonlyMap<number, number>, cops: readonly number[] = []): CarNames {
  const byName = new Map<string, number>([[`p:${myId}`, me]]);
  for (const [id, i] of remote) byName.set(`p:${id}`, i);
  for (const [seat, i] of aiSeats) byName.set(`s:${seat}`, i);
  // A getaway's cops, by their place among its cops (the same on every screen: rules/getaway.ts).
  cops.forEach((i, k) => byName.set(`c:${k}`, i));
  const byIndex = new Map([...byName].map(([n, i]) => [i, n]));
  return { name: (i) => byIndex.get(i) ?? null, index: (n) => byName.get(n) };
}

/** Who to tell about a car: its player, or the host for an AI or a cop. */
const ownerOf = (name: string): string => (name.startsWith('s:') || name.startsWith('c:') ? 'host' : name.slice(2));
```

Also update the file's header comment line `// A car is named the same on every screen: …` to:

```ts
// A car is named the same on every screen: `p:<player id>` for a player's, `s:<seat>` for an AI,
// `c:<k>` for a getaway's cop.
```

- [ ] **Step 7: Make it in `src/net/join.ts` and call it in `src/net/online.ts`**

`join.ts`: add `import { NetCops } from './cops';`, add `cops: NetCops | null;` to `NetLayers` (doc: `/** A getaway's cops, driven by the host (null when the race isn't one). */`), and in `joinRace`:

```ts
    const cops = sim.getaway ? new NetCops(room, now, sim, race) : null;
```

(right after `rivals`), then:

```ts
    const contact = shared ? new NetContact(room, sim, carNames(j.me, room.me, j.remote, j.aiSeats, sim.getaway?.cops)) : null;
    j.onNet({ cars: net, rivals, cops, traffic, walls, contact, tick: relay.tick ? (rate, fn) => relay.tick!(rate, fn) : null });
```

`online.ts`:

```ts
  beforeStep(): void {
    this.layers?.cars.beforeStep();
    this.layers?.rivals?.beforeStep();
    this.layers?.cops?.beforeStep();
  }
```

and in `afterStep`, after `l.rivals?.afterStep();`:

```ts
    l.cops?.afterStep();
```

Find any test that builds a `NetLayers` literal and add `cops: null`:

Run: `grep -rn "rivals: null\|rivals," test/*.ts | grep -v "^test/net-cops"`

- [ ] **Step 8: Run the net tests**

Run: `bun run typecheck && bun run test test/net-cops.test.ts test/net.test.ts`
Expected: PASS. If the handover test's "no jump" check fails by a few metres, look at whether `beforeStep`'s `predict` lead is being applied on the new host. It shouldn't be, because the host branch returns before predicting. Fix that. Don't loosen the 2 m.

- [ ] **Step 9: Commit**

```bash
git add src/net/cops.ts src/net/rivals.ts src/net/contact.ts src/net/join.ts src/net/online.ts test/hub.ts test/net.test.ts test/net-cops.test.ts
git commit -m "The getaway's cops online: the host drives them, everyone else has them as it says

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The vote waits for the last runner

**Files:**
- Modify: `src/lobby/vote.ts` (`voteStep(…, chase)`)
- Modify: `src/net/postrace.ts` (`PostRaceDeps.chase`; `tick` passes it)
- Modify: `src/net/online.ts` (`results` passes `chase: !!sim.getaway`)
- Test: `test/vote.test.ts`

**Interfaces:**
- Produces: `voteStep(lobby: Lobby, now: number, seed: () => number, chase = false): LobbyAction | null`. In a chase, the vote opens once all but one runner are out (or the only runner, in a lobby of one), for `VOTE_MAX_MS` at most. `PostRaceDeps.chase?: boolean`.

- [ ] **Step 1: Write the failing test**

Look at how `test/vote.test.ts` builds a racing lobby with results (its own helpers). Using those, add:

```ts
  test("a getaway's vote opens once one runner's left, not at the first out (the owner, 2026-10-09)", () => {
    // Three runners racing; one out.
    let l = racingLobbyWith(3);
    l = withResult(l, 0, 40);
    expect(voteStep(l, 1000, () => 1, true)).toBeNull();
    // Two out: the last one's still going, and the rest vote.
    l = withResult(l, 1, 55);
    expect(voteStep(l, 1000, () => 1, true)).toEqual({ type: 'voteEnds', ends: 1000 + VOTE_MAX_MS });
    // And a race's opens at the first, as ever.
    expect(voteStep(withResult(racingLobbyWith(3), 0, 40), 1000, () => 1)).toEqual({ type: 'voteEnds', ends: 1000 + VOTE_MAX_MS });
  });

  test("a lobby of one's getaway opens its vote when they're out", () => {
    const l = withResult(racingLobbyWith(1), 0, 12);
    expect(voteStep(l, 0, () => 1, true)).toEqual({ type: 'voteEnds', ends: VOTE_MAX_MS });
  });
```

`racingLobbyWith(n)` and `withResult(lobby, seat, time)` stand for whatever the file already uses to build a lobby in `phase: 'racing'` with a `seed`, `n` player seats `racing: true`, and a `result` row applied for one seat. If the file has no helpers, write these two at the top of the file with `createLobby` and `apply` from `../src/lobby/lobby`, the way its existing tests build lobbies.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test test/vote.test.ts`
Expected: FAIL. The first `voteStep(…, true)` returns `voteEnds` with one runner out, because the extra argument is ignored.

- [ ] **Step 3: `voteStep` in `src/lobby/vote.ts`**

Add this line to the header comment's list:

```ts
//   - A getaway (the owner, 2026-10-09): it opens once one runner's left, not at the first out.
```

Change the function to:

```ts
/** What the host sends now, if anything, for the lobby's vote at server time `now` (ms). A getaway's (`chase`) waits for its last runner. */
export function voteStep(lobby: Lobby, now: number, seed: () => number, chase = false): LobbyAction | null {
  if (lobby.phase !== 'racing' || lobby.seed === undefined) return null;
  const rs = racers(lobby);
  if (!rs.length) return null;
  const done = new Set((lobby.results ?? []).filter((r) => r.time !== null).map((r) => r.seat));
  const finished = rs.filter((p) => done.has(seatIndex(lobby, p.id))).length;
  const vote = lobby.vote;
  if (!vote) return finished >= (chase ? Math.max(1, rs.length - 1) : 1) ? { type: 'voteEnds', ends: now + VOTE_MAX_MS } : null;
  if (now >= vote.ends) return { type: 'next', map: tally(lobby), seed: seed() };
  if (finished < rs.length) return null;
  const voted = rs.every((p) => vote.votes[p.id]);
  const by = now + (voted ? VOTED_MS : VOTE_MS);
  // Only ever sooner (and not again for a second's difference).
  return vote.ends > by + 1000 ? { type: 'voteEnds', ends: by } : null;
}
```

- [ ] **Step 4: Pass it through**

`src/net/postrace.ts`: in `PostRaceDeps`, add

```ts
  /** A getaway: the vote waits for the last runner (lobby/vote.ts). */
  chase?: boolean;
```

and in `tick`, change the `voteStep` call to `voteStep(this.lobby ?? l, this.d.now(), this.d.seed ?? (() => Math.floor(Math.random() * 2 ** 31)), this.d.chase)`.

`src/net/online.ts` `results()`: add `chase: !!sim.getaway,` to the `new PostRace({ … })` object.

- [ ] **Step 5: Run the tests**

Run: `bun run typecheck && bun run test test/vote.test.ts test/net.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lobby/vote.ts src/net/postrace.ts src/net/online.ts test/vote.test.ts
git commit -m "A getaway's vote opens once one runner's left

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Watching the rest, and the getaway's results table

**Files:**
- Create: `src/ui/watch.ts`
- Modify: `src/ui/race.ts` (the `you`, `watching`, `onWatch` fields; the watch strip; the getaway table)
- Modify: `src/ui/hud.css` (`#watchStrip`)
- Test: `test/getaway.test.ts` (`leader`, `cycle`, `standings`)

**Interfaces:**
- Consumes: `Getaway.runs`, `Run` (Task 1); `ResultRow` (lobby.ts).
- Produces (watch.ts):
  - `leader(g: Getaway): number`: the first runner still going, or −1.
  - `cycle(g: Getaway, from: number, dir: 1 | -1): number`: the next runner still going after `from`, wrapping round; `from` if nobody is going.
  - `standings(g: Getaway, official: ReadonlyMap<number, ResultRow>): { car: number; time: number; going: boolean }[]`: those still going first, then the longest-lasting.
- Produces (RaceUi): `you: number` (−1 means the focus), `watching: boolean`, `onWatch: (dir: 1 | -1) => void`.

- [ ] **Step 1: Write the failing tests**

In `test/getaway.test.ts`, add `import { cycle, leader, standings } from '../src/ui/watch';` and, inside the online `describe`:

```ts
  test('watching: the first runner still going, cycled through those still going, wrapping', () => {
    const { sim, g } = runners(3);
    expect(leader(g)).toBe(0);
    expect(cycle(g, 0, 1)).toBe(1);
    expect(cycle(g, 0, -1)).toBe(2);
    wreckCar(sim, 0, Cause.Wall, 0, 0, -1);
    sim.step([]);
    // The one out isn't watched any more: on to who's left.
    expect(leader(g)).toBe(1);
    expect(cycle(g, 0, 1)).toBe(1);
    expect(cycle(g, 2, 1)).toBe(1);
    wreckCar(sim, 1, Cause.Wall, 0, 0, -1);
    wreckCar(sim, 2, Cause.Wall, 0, 0, -1);
    sim.step([]);
    expect(leader(g)).toBe(-1);
    expect(cycle(g, 2, 1)).toBe(2);
  });

  test("the getaway's standings: still going first, then the longest run, the lobby's word over this screen's", () => {
    const { sim, g } = runners(3);
    for (let k = 0; k < 60; k++) sim.step([]);
    wreckCar(sim, 2, Cause.Wall, 0, 0, -1);
    sim.step([]);
    for (let k = 0; k < 60; k++) sim.step([]);
    wreckCar(sim, 0, Cause.Wall, 0, 0, -1);
    sim.step([]);
    const order = standings(g, new Map()).map((s) => s.car);
    expect(order).toEqual([1, 0, 2]);
    // The lobby says runner 2 lasted longer than this screen saw: it ranks on that.
    const off = new Map([[2, { seat: 2, time: 999, best: null, takedowns: 0, wrecks: 1, score: 0 }]]);
    expect(standings(g, off).map((s) => s.car)).toEqual([1, 2, 0]);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test test/getaway.test.ts`
Expected: FAIL, because the module `../src/ui/watch` isn't there.

- [ ] **Step 3: Create `src/ui/watch.ts`**

```ts
// An online getaway once you're out (the owner, 2026-10-09: "watch the rest then shared results"):
// who the camera follows, who's next, and the results' order. Pure: main.ts and race.ts use it.

import type { ResultRow } from '../lobby/lobby';
import type { Getaway } from '../core/rules/getaway';

/** Who to watch: the first runner still going (they all started on the same green, so any of them has lasted longest), or −1. */
export function leader(g: Getaway): number {
  return g.runs.find((r) => !r.end)?.car ?? -1;
}

/** The next runner still going after `from` (`dir` 1 on, −1 back), wrapping round; `from` if nobody's going. */
export function cycle(g: Getaway, from: number, dir: 1 | -1): number {
  const going = g.runs.filter((r) => !r.end).map((r) => r.car);
  const n = going.length;
  if (!n) return from;
  const at = going.indexOf(from);
  if (at >= 0) return going[(at + dir + n) % n];
  // (`from` out: the next one going after its seat, or before it going back, wrapping.)
  return dir > 0 ? (going.find((car) => car > from) ?? going[0]) : ([...going].reverse().find((car) => car < from) ?? going[n - 1]);
}

/** The getaway's results order: those still going first, then the longest run; each time the lobby's word where it has it. */
export function standings(g: Getaway, official: ReadonlyMap<number, ResultRow>): { car: number; time: number; going: boolean }[] {
  return g.runs
    .map((r) => ({ car: r.car, time: official.get(r.car)?.time ?? r.time, going: !r.end }))
    .sort((a, b) => Number(b.going) - Number(a.going) || b.time - a.time);
}
```

Check `cycle(g, 0, 1)` with runner 0 out and 1, 2 going. `at` is −1, so it returns the first going after seat 0, which is 1 ✓. `cycle(g, 2, 1)` with `going = [1, 2]`: `at` = 1, and (1 + 1) % 2 = 0 gives 1 ✓. `cycle(g, 0, -1)` with all three going: (0 − 1 + 3) % 3 = 2 ✓.

- [ ] **Step 4: Run the tests**

Run: `bun run test test/getaway.test.ts`
Expected: PASS.

- [ ] **Step 5: The watch strip and the getaway table in `src/ui/race.ts`**

Add `import { standings } from './watch';` and these fields, next to `shown`:

```ts
  /** Your car (main.ts): the results are yours, whoever the camera's on. −1: the focus's. */
  you = -1;
  /** An online getaway: you're out, watching the rest (main.ts moves the camera). */
  watching = false;
  /** Watch the next runner (1) or the last (−1) (main.ts). */
  onWatch: (dir: 1 | -1) => void = () => {};
  /** An online getaway's table is up (all out, or the vote's open). */
  private tableUp = false;
  private readonly strip: HTMLDivElement;
```

In the constructor's `insertAdjacentHTML`, add `<div class="hud" id="watchStrip"></div>` after `<div id="results"></div>`, then:

```ts
    this.strip = document.getElementById('watchStrip') as HTMLDivElement;
```

Add the getter:

```ts
  /** Whose results these are: yours, or (attract) the focus's. */
  private get mine(): number {
    return this.you >= 0 ? this.you : this.focus;
  }
```

In `update()`, change `if (sim.cars.finished[this.focus] && !this.shown && this.resultsOn) {` to `if (sim.cars.finished[this.mine] && !this.shown && this.resultsOn) {`. Change the live-refresh condition `this.open && !sim.getaway && …` to `this.open && (!sim.getaway || this.tableUp) && …`. Then add the following after that refresh block:

```ts
    // An online getaway, you out: the others' runs on the strip, then the table once only one's left.
    const g = sim.getaway;
    if (g && g.runs.length > 1 && this.watching) {
      if (!this.tableUp && (g.allOut || this.vote())) {
        this.watching = false;
        this.strip.classList.remove('on');
        this.showTable();
      } else if (performance.now() > this.refreshAt) {
        this.refreshAt = performance.now() + 250;
        const run = g.runOf(this.focus);
        this.strip.innerHTML = `<button id="wBack" aria-label="Watch the last runner">◀</button><span>Watching <span class="plate">${esc(this.names[this.focus] ?? '')}</span> · Heat ${g.heat} · ${fmt(run?.time ?? 0)}</span><button id="wNext" aria-label="Watch the next runner">▶</button>`;
        (document.getElementById('wBack') as HTMLButtonElement).onclick = () => this.onWatch(-1);
        (document.getElementById('wNext') as HTMLButtonElement).onclick = () => this.onWatch(1);
      }
    }
```

In `showGetaway()`, change `c.takedowns[this.focus]` to `c.takedowns[this.mine]`. Then add the following after its last line (`… .focus();`):

```ts
    // Online, others still going: the card for a moment, then watch them.
    if (g.runs.length > 1 && !g.allOut && !this.vote()) {
      setTimeout(() => {
        if (this.tableUp) return;
        this.results.classList.remove('on');
        this.watching = true;
        this.strip.classList.add('on');
      }, 3000);
    }
```

If `g.allOut` or the vote has already opened when your card would show, show the table instead. At the top of `showResults()`, replace `if (this.sim.getaway) return this.showGetaway();` with:

```ts
    const g = this.sim.getaway;
    if (g && g.runs.length > 1 && (g.allOut || this.vote())) return this.showTable();
    if (g) return this.showGetaway();
```

Add the table:

```ts
  /** An online getaway's results (the owner, 2026-10-09): everyone's run, the longest first, and the vote. */
  private showTable(): void {
    this.tableUp = true;
    this.results.innerHTML = `<div class="card results"><h1 id="rPlace">Getaway</h1>
      <table><thead><tr><th></th><th>Driver</th><th>Car</th><th>Lasted</th><th>Takedowns</th><th>Wrecks</th></tr></thead><tbody id="rRows"></tbody></table>
      <div id="rVote"></div>
      <div class="row"><button id="rSetup">${this.setupLabel}</button></div></div>`;
    this.voteHtml = '';
    this.rows();
    this.renderVote();
    this.results.classList.add('on');
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (document.getElementById('rSetup') as HTMLButtonElement).focus();
  }
```

At the top of `rows()`, send a getaway to its own rows:

```ts
    if (this.sim.getaway) return this.getawayRows();
```

and add:

```ts
  /** An online getaway's rows: still going first (their time running), then the longest run. */
  private getawayRows(): void {
    const g = this.sim.getaway!;
    const c = this.sim.cars;
    const off = this.official();
    const list = standings(g, off);
    const h1 = document.getElementById('rPlace');
    const at = list.findIndex((s) => s.car === this.mine);
    if (h1 && at >= 0 && !list[at].going) h1.textContent = ordinal(at + 1);
    document.getElementById('rRows')!.innerHTML = list
      .map(
        (s, k) =>
          `<tr class="${s.car === this.mine ? 'me' : ''}"><td>${s.going ? '–' : k + 1}</td><td><i class="dot" style="background:${this.colors[s.car]}"></i><span class="plate">${esc(this.names[s.car])}</span></td><td>${this.classes[c.cls[s.car]].name}</td><td>${s.going ? `<span class="muted">${fmt(s.time)} · going</span>` : fmt(s.time)}</td><td>${off.get(s.car)?.takedowns ?? c.takedowns[s.car]}</td><td>${off.get(s.car)?.wrecks ?? c.wrecks[s.car]}</td></tr>`,
      )
      .join('');
  }
```

- [ ] **Step 6: The strip's look in `src/ui/hud.css`**

Add near the getaway rules (after `body.getaway #posBadge`):

```css
/* An online getaway, you out: whose run you're watching, and the buttons to move on. */
#watchStrip { display: none; position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); align-items: center; gap: 12px; padding: 8px 14px; border-radius: 12px; background: rgba(18, 10, 32, 0.8); color: #fff6ee; font-size: 15px; z-index: 30; }
#watchStrip.on { display: flex; }
#watchStrip button { min-width: 40px; padding: 6px 10px; }
@media (max-width: 480px) { #watchStrip { left: 16px; right: 16px; transform: none; justify-content: space-between; font-size: 13px; } }
```

- [ ] **Step 7: Type check and the suite**

Run: `bun run typecheck && bun run test`
Expected: PASS. Single player shows the same card as today, because `g.runs.length > 1` is false.

- [ ] **Step 8: Commit**

```bash
git add src/ui/watch.ts src/ui/race.ts src/ui/hud.css test/getaway.test.ts
git commit -m "Out of an online getaway: watch the rest, then everyone's runs, the longest first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: An online lobby race on Splash City is a getaway (`main.ts`)

**Files:**
- Modify: `src/main.ts:116-127` (the cast and the chase), `:223-245` (the best only in single player), the frame loop near `:443` (the camera while watching), and the key handling (← / →).

**Interfaces:**
- Consumes: `Getaway(sim, runners)` (Task 1), `NetCops` via `OnlineRace` (Task 3), `RaceUi.you`, `.watching`, `.onWatch` (Task 5), `leader` and `cycle` (Task 5).

- [ ] **Step 1: The cast and the chase**

Replace lines 116-127 (from `const cast = roster(…)` to the end of `chase?.cops.forEach(…)`) with:

```ts
/**
 * A getaway (docs/CHASE_MODE.md): a race on its map is you and the cops; online (the owner,
 * 2026-10-09), every player's a runner, each with their own cops. The AIs sit it out, and so do
 * other players when it isn't online (a race of your own from an online lobby).
 */
const chaseMap = !!layout.getaway && run.mode === 'race' && !attract && run.seats.includes('p');
const castSeats = chaseMap ? run.seats.replace(onlineRace ? /[^pr]/g : /[^p]/g, 'x') : run.seats;
// The seats become the cars, in grid order; behind the menu, eight AIs of every skill.
const cast = roster(castSeats, CLASSES.map((c) => c.id), PAINTS.length, { ...run, plate }, run.others);
const getaway = chaseMap && cast.me >= 0;
const { specs, names, me: you, remote, rivals: aiSeats } = cast;
for (const s of specs) sim.addCar(s);
/** Its rules, and its cops: added after the runners, their plates the police's. */
const chase = getaway ? new Getaway(sim, specs.map((_, i) => i)) : null;
const colors = specs.map((x) => PAINTS[(x.paint ?? 0) % PAINTS.length].color);
chase?.cops.forEach(() => {
  names.push('PD 911');
  colors.push('#3b6cff');
});
```

Single player is unchanged. Its seats `p…` become `p` plus `x`s, so the cast is `[you]`, `me` is 0, and there are no remote cars or rivals, the same as the old special case. Check that line 116's comment ("The seats become the cars…") isn't left duplicated above.

- [ ] **Step 2: The best is single player's**

Change `if (chase) {` (line 225) to `if (chase && !onlineRace) {`, and in `keepGetaway` change `if (!chase?.end || getawayKept) return;` to `if (!chase?.end || onlineRace || getawayKept) return;`.

- [ ] **Step 3: Your results, and the camera while watching**

After `raceUi.focus = me` is set (the `if (you >= 0) { renderer.focus = hud.focus = raceUi.focus = me; … }` block near line 253), add:

```ts
raceUi.you = you;
/** An online getaway, you out: the camera on another runner, ← / → (or the strip's buttons) to the next. */
function watch(car: number): void {
  if (car < 0 || car === renderer.focus) return;
  renderer.focus = hud.focus = raceUi.focus = car;
  renderer.snapCamera();
}
raceUi.onWatch = (dir) => chase && watch(cycle(chase, renderer.focus, dir));
if (chase && chase.runs.length > 1)
  window.addEventListener('keydown', (e) => {
    if (!raceUi.watching || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    raceUi.onWatch(e.key === 'ArrowRight' ? 1 : -1);
  });
```

Add `import { cycle, leader } from './ui/watch';` to the imports.

In the frame loop, after the `if (attract) { … }` block (near line 443), add:

```ts
    // Watching an online getaway: off a runner who's out, on to one still going.
    if (chase && raceUi.watching && chase.runOf(renderer.focus)?.end) watch(leader(chase));
```

- [ ] **Step 4: Type check and the suite**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 5: Single player in the browser**

Run: `bun run dev`. Open the printed URL with `?start=getaway`, drive for 30 s, and crash. Expected: the same as before this branch. You start outside the Bank with two cops behind and see the "Wrecked! You got away for …" card with "Go again". There's no watch strip, and your best is kept. (Use the `run` skill to drive the browser if you have it.)

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "An online lobby race on Splash City is a getaway for every player in it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Online in the browser, the 32-car cost, and the docs

**Files:**
- Modify: `docs/CHASE_MODE.md` (a dated "Built so far" entry)
- Modify: `docs/HANDOFF.md` (a new top entry)

- [ ] **Step 1: Two players online, locally**

`.env.development` points at the local GameRelay server (see `docs/ONLINE.md` for starting it). Run `bun run dev`. In two browser windows (one of them private, so they're two players), create a Public lobby in one window, pick Splash City, and join it from the other. Start the race. Check each of these, and write down what you saw:
1. Both start outside the Bank, side by side, each with two cops behind.
2. Drive one window's car past the other's cops: they turn on it (within about 40 m).
3. Wreck one: its cops leave, its card shows for 3 s, and then the strip says "Watching <other plate>". ← / → do nothing more with one runner left.
4. With one runner left, the results table and the vote open in the out window. The still-going row reads "… · going".
5. Wreck the other: its table shows both runs, the longest first, and the next race comes from the vote.
6. Close the host's window mid-chase (with a third window in it, if you can): the cops keep chasing from where they were.

- [ ] **Step 2: Eight runners, and the draw-call budget**

With 8 windows (or as many as the machine runs), start a Splash City race and check that nobody starts inside a building or on another car. In one window, read the draw calls and frame time the way `docs/HANDOFF.md`'s draw-call table was measured (its row for Splash City). Expected: within that table's numbers plus the extra cars (about 350 in the chase view with the field on screen). If it's well over, note the number in HANDOFF under "What's next" rather than tuning it here.

- [ ] **Step 3: The docs**

In `docs/CHASE_MODE.md`, add a "Built so far" entry dated 2026-10-09 in the file's voice. Cover: Heist renamed to Splash City (id `heist`); online getaways (each runner's own cops, `poolFor`, cops going for the near one, any cop counting toward busted, host-driven cops in `net/cops.ts`, the runner's end on their car, the vote opening at one left, and watching); `MAX_CARS` 32. Also replace the decisions table's "Online, cops would be host-run … later" line with a pointer to the new entry, and fix the line in the "In the lobby" section that says an online race is laps of the outer loop.

In `docs/HANDOFF.md`, add a top entry in the same shape as the ones below it: what changed, the owner's words, where the code is, what you measured in Steps 1-2, and what's next (the spec's "Not in this" list).

- [ ] **Step 4: Commit**

```bash
git add docs/CHASE_MODE.md docs/HANDOFF.md
git commit -m "CHASE_MODE, HANDOFF: online getaways on Splash City

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
