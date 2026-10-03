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
4. **Online first.** Online play follows SPEC §4's sync categories: your car is yours (its pose
   sent 30 times a second), the host runs the AI, and **the world is a pure function of the seed
   and the race clock**, so nothing about it is sent. Every engine feature has to fit one of them:
   - **The world (D):** pieces, moving pieces (a drawbridge's angle at t), spreading hazards (a
     lava flow, the avalanche, the eruption): closed-form functions of time, not integrated, so
     float differences between browsers can't build up. Randomness comes from the seed's streams.
   - **Triggers (T):** something a car sets off that changes the world for everyone, like
     breaking a wall open: one screen claims it (`room.claim`) and everyone runs it from a start
     time a moment ahead, as traffic hits do.
   - **Local (L):** particles, light, sound, debris, the camera: free to differ.

   Inside the sim, plain float math in a fixed order: no physics engine, no `Math.random`, no
   render state leaking in. That keeps the world agreeing online, and replays (F8 reports) and
   tests exact.
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
- optional **walls** on either side, which can be **breakable** (a shop window: solid until a
  car hits it fast enough, then gone; online, the break is a claimed trigger, see "Online first");
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

And two more, from the same index: **the walls near a point** (for the physics to bounce off,
breakable or not), and **a line between two points** (is it clear: the camera's view of the car,
an AI's line of sight). Remote cars use the cast too, to sit on the right floor between poses.

Where a piece goes into the ground (a tunnel's mouth, a mall's door), it gets a **portal**: the
ground cut to the piece's own outline (not whole grid squares) and stitched to its rim, with a
frame of rock or a doorway over the seam. Every tunnel and entrance then meets the land cleanly
with no per-map fix. (Today's Lava Tube has a stopgap: a shroud of rock over the tube where the
slope's cut open, so no sky shows through.)

The rule stays the one we have: **a car is on the highest floor at or below it.** The physics
uses the query for driving and landing; the camera uses it to stay under a ceiling and out of the
rock; respawns use it to find a floor; the renderer uses "enclosed" to switch to indoor light.

How the owner's list falls out of it:

| Wanted | As pieces |
|---|---|
| **Overhangs** | A piece over the ground, drawn as rock or as a ledge. |
| **Invisible tubes** | An enclosed piece with an invisible look: it holds the car and the camera inside, and the scenery around it is decoration. |
| **Indoor moments** | Enclosed pieces. Inside, the camera stays under the ceiling, the light and fog switch to indoor, the sound gets reverb. A mall is enclosed pieces plus its scenery, with breakable windows to crash through. |
| **Drawbridges** | A piece with a motion: its angle at time t is a formula. A car on it rides it; a car arriving while it's up jumps the gap or hits the edge. |
| **Breakable walls** | A wall that breaks when hit hard enough, grown from today's smashables (`core/world/smash.ts`: where each stands comes from the layout, when it broke is state saved in snapshots, the shatter is the renderer's). Smashables break on each screen by themselves (they never block anyone); a wall changes where you can drive, so its break is claimed online. It can stay broken for the race: a shortcut you made. |
| **Hazards that spread** | A lava flow down the volcano onto a road, the avalanche: a path from the layout, how far along it is a formula of the race clock (and the seed, for which flank and when). A car in it wrecks. A crust that cools into something to drive on is a piece that appears at a set time. |
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

## Tricks from the industry

Common practice in racing and open-world games, and where each fits here. Some we already do.

**Already doing:** a fixed 60 Hz step with the picture interpolated between steps
(`renderer.frame(alpha, …)`); a world that's a function of time and seed (SPEC §4); splines as
the source of roads; instancing for scenery; fog to hide the draw distance; a greybox skin
separate from the gameplay.

**The world and its surfaces**
- **Seams get a frame, not perfect geometry.** Games rarely stitch terrain to tunnels exactly:
  a rock frame, a doorway or a "skirt" (a strip hanging under a mesh's edge, as terrain tiles
  use between levels of detail) covers the join. The portal is this; the Lava Tube's shroud is
  the same trick.
- **A uniform grid (spatial hash) for lookups.** For a world that's mostly flat and a few km
  across, a grid of buckets beats a tree: simple, fast, and the same on every screen. The deck
  sample buckets in `ground.ts` are one already; the pieces' index should be the same.
- **Junctions as their own pieces.** Road tools (Unreal's, Houdini's) build each street from
  its spline and each junction as a separate patch the streets end at. Streets stay simple
  strips; the patch handles the corners, the kerbs and the sharing of surfaces.
- **Kill and respawn volumes, and a "last safe spot" trail.** Racers keep a short ring of recent
  positions where the car was grounded on a road and pointing the right way, and respawn at the
  newest one far enough back from the hazard. That replaces per-feature rules like `pastGap`.

**Camera, light and sound**
- **Camera hints on the world.** Instead of the camera working out where it is, areas carry
  hints: in this tunnel, sit lower and closer; on this jump, look at the landing. Pieces can
  carry them (an enclosed piece's own camera distance and height), which removes most camera
  special cases.
- **Volumes for light, fog and reverb, blended at their edges.** Entering an enclosed piece
  fades to its light and its reverb over a second, not at a hard line.
- **Portal culling indoors.** Deep inside a mall or a tube, the outside isn't drawn (you can
  only see it through the portals), and outside, the inside isn't: a big saving for indoor
  stretches.
- **Lighting baked into vertex colours.** For the toon look, darkening by ambient occlusion and
  a glow from lava or neon, painted into the vertices at build time, is nearly free and reads as
  lit. Real-time lights only for headlights and flashes.
- **Readability over realism.** Chevrons, lights and colour lead the eye to the line, the
  shortcut, the jump's lip (the kicker's chevrons already do).

**Performance**
- **Level of detail and impostors.** Far trees as a flat image facing the camera, near ones as
  models; the far ones are most of Paradise Open's triangles.
- **Dynamic resolution.** Lower the render resolution a little when a frame runs long, then
  raise it back: weaker laptops hold 60 fps with no settings.

**AI and modes**
- **Pursuit AI uses "last known position."** Chase games (Need for Speed's police, for one) have
  cops head for where they last saw you, search when they lose you, and call in roadblocks or
  spike strips ahead on your likely route. With a road graph, cutting you off is a path search
  to a junction ahead of you. "Heat" levels raise the pressure over time.
- **Catch-up, honestly.** Most arcade racers help the cars at the back (rubber banding). Boost by
  position already does this; for a chase, cops faster when far behind keeps it tense.

**Testing and tools**
- **Debug drawing.** A key that draws what the engine thinks: pieces' outlines, the floor under
  each car, the camera's line of sight, the AI's line and target. On in `tools/shot.ts` too, so
  an LLM can see it.
- **Golden replays.** Record a few human runs (the jump, a tunnel, a shortcut) once, replay them
  in the tests, and compare where they end: catches changes to the feel that AI lap floors miss.
- **Heatmaps from telemetry.** Wrecks, respawns and air plotted on the map's top-down image
  (`tools/map.ts`): where players actually struggle.
- **Same math in every browser.** `Math.sin`, `Math.exp` and the like aren't required to give
  the same last digit in every JavaScript engine (Chrome's V8, Safari's and Bun's
  JavaScriptCore, Firefox's SpiderMonkey). The world tolerates that (it's closed-form, nothing
  builds up), but a replay re-run in Bun of a race played in Chrome could drift over a long
  window. If `tools/replay.ts` ever reports a mismatch, the fix is our own `sin`/`cos`/`exp` in
  `core/math.ts` for the sim.

## Limitations

### By design

Kept out on purpose, so the engine stays small and deterministic:
- **No upside-down driving**: gravity is always down, so no loops, wall rides or half-pipes.
- **No sculpting the terrain mid-race**: the heightfield is fixed at load, so a crater dug
  wherever a car crashes is out. Anything else that changes during a race is a hazard, a piece
  or a breakable, driven by the race clock, the seed or a claimed crash (a lava flow, the
  avalanche, a drawbridge, a cooling crust, a smashed window), so every screen agrees.
- **No streaming**: a map is built at load and fits in memory. Maps of a few km² are fine.
- **No mobile**: desktop browsers only.
- **No general physics engine**: the car model stays our own, so it stays deterministic.

### Hard today

What the engine struggles with now, and the build step that lifts it (if any):

| Limit | Why | Lifted by |
|---|---|---|
| Every new surface (a deck, a tube, a gap, a kicker) is custom code in the ground, the physics and the camera | No shared surface layer; three places answer "what's under me" | Step 1 (pieces) |
| One height per point of land: no overhangs, arches or caves in the ground itself | The ground is a heightfield | Step 1 (pieces over the ground) |
| The ground, off-road surfaces and out of bounds are measured from the main road | `ground.ts` places every point by its nearest main-road sample | Steps 2 and 6 |
| No road network: one loop plus branches, progress by distance along the main road | Branches leave and rejoin the main road; checkpoints are main-road distances | Step 6 (the road graph) |
| Indoors looks and sounds like outdoors | One light for everything; the camera only knows the Lava Tube | Step 3 |
| Nothing moves but the avalanche and traffic | No moving surfaces | Step 4 |
| Only small round props break (smashables), placed in rows along a road | `smash.ts` touches a radius and places by the main road | Steps 2 and 3 (breakable walls, placed in world space) |
| Big air is hard: the road lifts a car at most 8 m/s | The vertical speed cap keeps cars on the road over bumps | Tuning per feature (the jump's kicker was sized by a sweep) |
| The car is one body with a heading: no wheels leaving the ground one by one, no rolling over, no stacking | Our own simple car model | Not planned |
| Contact between players' cars is approximate online: another player's car is a pose 30 times a second, and a bump is agreed between the two screens (`net/contact.ts`) | Each player owns their car | Not planned (it's the right trade for 8 players) |
| Nothing in the world can be pushed by a car: a pushed thing would differ between screens | The world is a function of time (SPEC §4); a pushable thing would have to be a host entity | Not planned (one-offs as host entities) |
| Deep water is just out of bounds: no wading physics, boats or tides | No water in the sim | Not planned |
| The AI follows racing lines on the roads: it can't cut across open ground or plan a route | Lines are per spline | Step 7 (pathfinding over the graph) |
| Features are authored in generator scripts, which sometimes work around the bake (the tube's ends) | No editor for ground features; the bake pulls branches toward the main road | Steps 1–2 (pieces own their heights) |

### Size and performance (measured 2026-10-03)

On an M5 Max at full Retina resolution (3456 × 1994), dev build:

| | Paradise Open | Avalanche |
|---|---|---|
| Open ground | 1.36 × 1.40 km, 2.5 m cells, 0.31 M points | 0.72 × 5.70 km, 0.66 M points |
| Triangles drawn per frame | ~720 k | ~180 k |
| Triangles in the scene | 1.4 M | 2.2 M |
| Draw calls per frame | 139 | 203 |
| Geometry memory | 42 MB | 81 MB |
| CPU time per frame | 7.7 ms | 5.5 ms |

Everything is built at load and drawn at full detail (no level of detail): a tree 2 km away
costs as much as one beside you. Fog ends at 2.3 km and the camera draws to 3 km. Most of
Paradise Open's triangles are its palms (two instanced meshes of 885). The first limits to hit
as maps grow: scenery (fix with lower-detail models at a distance or billboards), resolution on
weaker laptops (cap the pixel ratio), then world size past roughly 5–10 km² (streaming, which is
out by design). The sim's cost is small: the heightfield is a few MB and its queries are cheap.

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
  Replays, the AI reports and the world agreeing online all depend on it.
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
1. **The pieces layer and its queries**, with the Lava Tube moved onto it first: it has every
   hard case (a tube, a gap, a kicker, mouths, the camera). Its mouths become portals (the
   shroud goes). Done when the tube plays the same,
   the lap floors don't move, the three special cases in `ground.ts`, `camera.ts` and
   `physics.ts` are gone, and so are `GroundDef`'s `decks`, `branchDecks` and `branchGaps` (the
   layouts and generators moved to pieces). Clears most of TECH_DEBT's "Open ground and Paradise
   Open".
2. **Feature modules**: the volcano, coast, beaches, moguls, canyons, decks and the avalanche as
   modules over pieces, each placed in world space or along a named street, not by the main road
   (moguls and canyons are by the main road today, so they move). The eruption (and a lava flow
   onto a road) is the first new one.
3. **Enclosed spaces done properly**: the camera under the ceiling, indoor light and fog, reverb,
   and breakable walls (smashables grown into wall panels, placed in world space, their break a
   claimed trigger online). Then a short indoor stretch on a map: a mall to cut through.
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
