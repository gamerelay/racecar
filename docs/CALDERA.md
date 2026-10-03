# Caldera: the engine under racecar

Caldera is the name for racecar's engine: the deterministic sim, the ground and roads it drives on,
the renderer, and the tools around them. It grew out of Avalanche and Paradise Open (the volcano is
where tubes, gaps and rock faces were first needed, hence the name). **It's a direction, not a
spec.** Details will change while building; note those changes in [SPEC.md](./SPEC.md) under
"Changed while building", as usual.

Started 2026-10-03, from the owner's brief:
- One engine for every racecar map: open ground, cities, and whatever comes next. **For racecar
  only**, not a general-purpose engine.
- It should handle **routes that aren't one loop** (a city, a car chase), **drawbridges**,
  **overhangs** (or at least invisible tubes), and **indoor moments**: cutting through a mall, a
  tunnel, the inside of the volcano.
- Built to be **easy for an LLM to work with**: helpers that render a screenshot, simulate a quick
  test, and report what happened as text.

## Principles

1. **Immersive.** The world should feel like a place, not a track with scenery around it. Going
   indoors changes the light, the sound and the camera; a bridge has a drop under it; the ground
   you see is the ground you drive on. When the sim and the picture disagree (a wall that isn't
   drawn, a slope drawn where the road is), the sim wins and the picture gets fixed.
2. **Flexible.** A race isn't always laps of one loop. The engine supports a loop with shortcuts
   (Paradise), a one-way run (Avalanche), and routes through a network with no track at all (a cop
   chase through a city). Game modes decide what "progress" and "winning" mean; the engine only
   says where a car is and what it's on.
3. **Modular.** Each feature (a volcano, a coast, moguls, a drawbridge, an avalanche, an eruption)
   is a module with a small set of hooks: shape the ground, add pieces, give the surface, step in
   the sim, draw itself. A map is a road network plus a list of features. Adding one means writing
   a module, not editing `buildGround`, the physics and the camera. A module places itself in
   world space, or along a street it names, **never by the main road**: the main road goes away
   with the road graph, and modules shouldn't go with it.
4. **Online first.** Every screen runs the same sim at 60 Hz and must agree. Everything the sim
   reads comes from the layout, the seed, the race clock and the inputs: plain float math in a
   fixed order, no physics engine, no `Math.random`, no render state leaking in. Moving things
   (a drawbridge, an avalanche, an eruption) are formulas of the race clock, so they need no
   networking at all. Cosmetic things (particles, light, sound) are free to differ.
5. **Telemetry built in.** The sim already emits events (wrecks, laps, air, drifts) and the dev
   server logs them. Every new feature should emit its own (entered a piece, jumped a gap, hit by
   the eruption), so playtests and tuning questions can be answered from the data.
6. **Easy for an LLM to drive.** Everything you'd check by playing can also be checked from the
   command line, with text output (and `--json`): place a car, run it, read what happened, render
   a picture. See "Developer tools" below.
7. **Move fast, refactor freely.** Racecar is a side project with one user, so old code, layouts,
   generators and links get reworked to fit the engine, with no compatibility layers. What's kept
   is the effect: each map plays the same, its lap floors hold, and online stays in sync.
   **Desktop only:** mobile isn't supported, so budgets (frame time, triangles, draw calls) are
   for desktop GPUs, and input is keyboard and gamepad.

## The core idea: pieces

Today every non-terrain surface is its own special case: decks (`GroundDef.decks`), a branch's
decks (tunnels and bridges), gaps, the kicker's ramp, tunnel mouths (`hole`), rock faces
(`face`). The question "what surface is under me" is answered in three places (`deckUnder`
in `ground.ts`, `slopeRise`/`clearView`/`cameraFloor` in `render/camera.ts`, `meetFace` in
`physics.ts`), and each new oddity adds a fourth.

Caldera replaces them with one layer. A **piece** is anything you can drive on:

- a **floor** following a curve (its width, bank and height along it);
- optional **walls** on either side;
- an optional **ceiling**: then it's **enclosed** (a tunnel, a mall, the inside of the volcano);
- a **surface** tag (tarmac, tile, sand, snow) and a **look** (drawn as road, as rock, or
  invisible);
- an optional **motion**: a transform as a function of the race clock.

The terrain heightfield is the default piece under everything. Pieces are built once at load
from the layout and put in a spatial index, so a query only checks the pieces near it.

Pieces are **the only way** to add a surface. Once they exist, `GroundDef`'s `decks`,
`branchDecks` and `branchGaps` are deleted (the layouts and generators say the same things as
pieces), so the type itself leaves no room for a fourth special case.

Everything asks one question, **cast down from (x, y, z)**, and gets back:
- the floor's height and slope there, and its surface;
- the ceiling over it, if it's enclosed;
- which piece it is (and where along it).

The rule stays the one we have: **a car is on the highest floor at or below it.** The physics
uses the query for driving and landing; the camera uses it to stay under a ceiling and out of the
rock; respawns use it to find a floor; the renderer uses "enclosed" to switch to indoor light.

How the owner's list falls out of it:

| Wanted | As pieces |
|---|---|
| **Overhangs** | A piece over the ground, drawn as rock or as a ledge. |
| **Invisible tubes** | An enclosed piece with an invisible look: it holds the car and the camera inside, and the scenery around it is decoration. |
| **Indoor moments** | Enclosed pieces. Inside, the camera stays under the ceiling, the light and fog switch to indoor, the sound gets reverb. A mall is enclosed pieces plus its scenery. |
| **Drawbridges** | A piece with a motion: its angle at time t is a formula. A car on it rides it; a car arriving while it's up jumps the gap or hits the edge. |
| **Cities and chases** | Streets are pieces joined at junctions: a graph (below). |

## Routes: a graph, not a loop

Today a track is one main road with branches that leave and rejoin it. The ground, the off-road
surfaces and out of bounds are all measured along and across the main road, and progress is
distance along it.

Caldera makes roads a **graph**: streets (splines) joined at **junctions**. A car knows which
street it's on from the pieces query, not from the main road. Then:
- **A race is a route**: an ordered list of checkpoints through the graph. Today's loops are
  routes; Avalanche's run is a route with no lap. This builds on what's there: the bake already
  makes checkpoints (`Track.checkpoints`) and `rules/progress.ts` already counts laps, runs and
  positions by them. What changes is that a checkpoint becomes a gate on a street, where today
  it's a distance along the main road.
- **A mode can ignore routes**: a cop chase needs only where the cars are and the street graph
  (for the cops' pathfinding and for respawns: "the nearest street").
- **The ground stops depending on the main road**: features say where they are in world space
  or along a named street (the volcano already does; feature modules are written that way from
  the start, see "Modular").

This is the biggest change, and the one that unlocks a city. So before building it, a cop chase
on Downtown as it is (step 5 in "Build order") checks that the mode is worth it.

## What it won't do

Kept out on purpose, so the engine stays small and deterministic:
- **No upside-down driving**: gravity is always down, so no loops or wall rides.
- **No ground that changes mid-race**: craters and landslides are out. The eruption is an
  event that wrecks cars, not lava that reshapes the land.
- **No streaming**: a map is built at load and fits in memory. Maps of a few km² are fine.
- **No mobile**: desktop browsers only.
- **No general physics engine**: the car model stays our own, so it stays deterministic.

## Developer tools (for people and LLMs)

The goal: anything you'd check by playing, an LLM can check from a shell, and read the answer as
text. The common shape: a `bun tools/<name>.ts` with plain-text output and `--json`, and the
same functions on `window.__rc` in the dev build.

Both are thin wrappers over **one dev module** (say `src/dev/`) that holds the helpers
themselves: place a car, step, probe, summarize a run. Written once, the browser and the command
line can't drift apart. The module stays free of the DOM (it works on the sim and the track), and
only the screenshot side needs a browser.

What exists today:
- `bun tools/lap-report.ts <map> [--field]`: AI laps, section times, wrecks and where.
- `bun tools/validate.ts`: checks every layout (and `--ai` lap floors).
- `bun tools/replay.ts`: re-runs an F8 report headless, tick by tick.
- `bun tools/telemetry.ts`: summarizes local telemetry (laps, wrecks, air, frame times).
- `bun tools/poster.ts --url 'poster.html?scout=<map>&s=<m>'`: a screenshot of any spot, in
  headless Chrome.
- `?spawn=<m>`: start a free-mode car that far along the main road.
- `window.__rc`: the sim, the renderer and `advance()`.

What to add (roughly in order of use):
- **`tools/drive.ts`**: place a car (map, class, spot or piece, speed, heading), give it inputs
  (held, scripted, or the AI), run N seconds headless, and print a trace (where, on what piece,
  speed, air, wrecks) and a summary. Most of the one-off scripts written while building the Lava
  Tube jump were this.
- **`tools/sweep.ts`**: run `drive` over a range (speeds, classes, lines) and tabulate the
  outcome: "which classes clear the jump from 150 km/h".
- **`tools/shot.ts`**: render a picture of any spot (map, position or distance, camera: chase,
  top-down, orbit, free; time; weather) to a PNG, headless. Built on poster.ts. With `--drive`,
  shots along a `drive` run (frames every second): a visual check of a jump or a tunnel.
- **`tools/probe.ts`**: what's at a point: the ground height, the pieces above and below, the
  surface, enclosed or not, the nearest street. The first thing to check when something feels
  wrong at a spot.
- **`tools/map.ts`**: a top-down image of a whole map (the ground's heights, pieces by kind,
  routes, checkpoints, features), and a text summary of its size and contents.
- **A determinism check**, grown from the test that's there: `test/core.test.ts` ("the same
  inputs from a snapshot give the same state") restores a snapshot on Downtown and compares three
  numbers at the end. Widen it to every map (pieces, moving pieces and features included), a
  hash of the whole sim state, compared every tick, so a mismatch names the tick it started.
  Online play depends on it.
- **Perf numbers from the command line**: triangles, draw calls, frame time for a map at a spot
  (what `renderer.info` gives in the browser, headless).
- **`window.__rc` made stable and documented**: `place`, `step(ticks)` (stepping the camera
  properly: `advance()` renders 30 frames per call, which skews its smoothing), `probe`,
  `shot()` (a data URL), `state()`. A background tab doesn't run `requestAnimationFrame`, so
  every helper must work by stepping by hand.

Lessons from building the Lava Tube that these tools encode: test the sim headless first (it's
the truth); sweep, don't guess (the jump's numbers came from a sweep); and check the camera by
stepping frames one at a time, not with `advance()`.

## Build order

Each step ships on its own, and the existing maps keep their lap floors throughout (Downtown
57.9, Backroads 62.82, Avalanche 93.07, Paradise 71.52, Paradise Open 68.07, as of 2026-10-03).

0. **Tools first, small:** `drive`, `probe` and `shot`, since every step below gets tested with
   them.
1. **The pieces layer and its one query**, with the Lava Tube moved onto it first: it has every
   hard case (a tube, a gap, a kicker, mouths, the camera). Done when the tube plays the same,
   the lap floors don't move, the three special cases in `ground.ts`, `camera.ts` and
   `physics.ts` are gone, and so are `GroundDef`'s `decks`, `branchDecks` and `branchGaps` (the
   layouts and generators moved to pieces). Clears most of TECH_DEBT's "Open ground and Paradise
   Open".
2. **Feature modules**: the volcano, coast, beaches, moguls, canyons, decks and the avalanche as
   modules over pieces, each placed in world space or along a named street, not by the main road
   (moguls and canyons are by the main road today, so they move). The eruption is the first new
   one.
3. **Enclosed spaces done properly**: the camera under the ceiling, indoor light and fog, reverb.
   Then a short indoor stretch on a map.
4. **Moving pieces**: a drawbridge.
5. **A cop chase on Downtown as it is**: the mode only (roles, busted, escape, a timer), with
   cops that chase along the track. A playtest: if the chase is fun, the road graph is worth
   building; if not, we've saved the biggest step.
6. **The road graph and routes**: streets, junctions, and checkpoints as gates on streets (the
   bake's checkpoints and `rules/progress.ts` carried over); today's maps as routes.
7. **The cop chase in a city**: a city map, cops pathfinding over the graph.

## See also

- [AVALANCHE.md](./AVALANCHE.md) and [PARADISE.md](./PARADISE.md): the two open maps it grew from.
- [TECH_DEBT.md](./TECH_DEBT.md), "Open ground and Paradise Open": what step 1 cleans up.
- [SPEC.md](./SPEC.md) §14: telemetry and reports.
