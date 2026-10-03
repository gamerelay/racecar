# Caldera: the engine under racecar

Caldera is the name for racecar's engine: the deterministic sim, the ground and roads it drives on,
the renderer, and the tools around them. It grew out of Avalanche and Paradise Open (the volcano is
where tubes, gaps and rock faces were first needed, hence the name). **It's a direction, not a
spec.** Details will change while building; note those changes in [SPEC.md](./SPEC.md) under
"Changed while building", as usual.

**Status (2026-10-03):** reviewed and agreed (PR #82, merged). **Step 0 is built and merged** (PR #83): the
golden fingerprints, the allocation test on the open maps, `tools/drive.ts`, `tools/probe.ts`,
`tools/shot.ts` and `window.__rc.dev`, over `src/dev/`. Recommended next: our own math for the
sim (see "Same math in every browser"; the fingerprints showed floats differ by OS and CPU),
then step 1a. HANDOFF has the detail.

**Reading it:** "Principles" and "The core idea: pieces" are the design; "Build order" and "How
to work on it" are what to do; the rest is reference (moving things, routes, a worked example,
overrides, industry tricks, limitations, budgets, tools, decisions).

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
   (Paradise), a one-way run (Avalanche), and routes through a network of streets (a city). Game
   modes decide what "progress" and "winning" mean; the engine only says where a car is and what
   it's on. (A cop chase is one such mode, a concept for now, not a requirement.)
3. **Modular.** Each feature (a volcano, a coast, moguls, a drawbridge, an avalanche, an eruption)
   is a module with a small set of hooks: shape the ground, add pieces, give the surface, step in
   the sim, draw itself. A map is a road network plus a list of features. Adding one means writing
   a module, not editing `buildGround`, the physics and the camera. A module places itself in
   world space, or along a street it names, **never by the main road**: the main road goes away
   with the road graph, and modules shouldn't go with it. For the one spot nothing else fits,
   there's an escape hatch: an override (see "Overrides").
4. **Online first.** Online play follows SPEC §4's sync categories. The ones that matter to the
   engine:
   - **Your car (O)** is yours: your screen steps its physics and sends its pose 30 times a
     second. Other players' cars are those poses on your screen.
   - **The world (D)** is a pure function of the seed and the race clock, so nothing about it is
     sent: pieces, moving pieces (a drawbridge's angle at t), spreading hazards (a lava flow, the
     avalanche, the eruption). Closed-form functions of time, not integrated, so float
     differences between browsers can't build up. Randomness comes from the seed's streams.
   - **Triggers (T):** something a car sets off that changes the world for everyone, like
     breaking a wall open. It happens at once on the screen of the car that did it (each screen
     collides only its own cars); that screen claims it (`room.claim`), and the winner's time is
     shared, so every screen runs it from then and a screen that also hit it but lost the claim
     takes the winner's time. That's how traffic hits work (`net/traffic.ts`).
   - **The host (H)** runs the AI, sent as entities; see "Things that move" for other host-run
     things. **Moments (E)**, like bumps and wrecks, are sent as events (`net/contact.ts`).
   - **Local (L):** particles, light, sound, debris, the camera: free to differ.

   Inside the sim, plain float math in a fixed order: no physics engine, no `Math.random`, no
   render state leaking in, and **no allocation per tick** (SPEC §15). That keeps the world
   agreeing online, and replays (F8 reports) and tests exact in the same JavaScript engine.
5. **Telemetry built in.** The sim already emits events (wrecks, laps, air, drifts) and the dev
   server logs them. Every new feature should emit its own (entered a piece, jumped a gap, hit by
   the eruption), so playtests and tuning questions can be answered from the data.
6. **Easy for an LLM to drive.** Everything you'd check by playing can also be checked from the
   command line, with text output (and `--json`): place a car, run it, read what happened, render
   a picture. See "Developer tools" below.
7. **Move fast, refactor freely.** Racecar is a side project with one user, so old code, layouts,
   generators and links get reworked to fit the engine, with no compatibility layers. What's kept
   is the effect: each map plays the same, its lap floors hold, and online stays in sync.
   **Desktop only** (decided 2026-10-03, in SPEC "Changed while building"): mobile isn't
   supported, so budgets are for a desktop or laptop, and input is keyboard and gamepad.

## The core idea: pieces

Today every non-terrain surface is its own special case: decks (`GroundDef.decks`), a branch's
decks (tunnels and bridges), gaps, the kicker's ramp, tunnel mouths (`hole`), rock faces
(`face`). The question "what surface is under me" is answered in three places (`deckUnder`
in `ground.ts`, `slopeRise`/`clearView`/`cameraFloor` in `render/camera.ts`, `meetFace` in
`physics.ts`), and each new oddity adds a fourth.

Caldera replaces them with one layer. A **piece** is anything you can drive on:

- a **floor** following a curve (its width, bank and height along it);
- optional **walls** on either side, which can be **breakable** (a shop window: solid until a
  car hits it fast enough, then gone; online, the break is a trigger, see "Online first");
- an optional **ceiling**: then it's **enclosed** (a tunnel, a mall, the inside of the volcano);
- a **surface** tag (tarmac, tile, sand, snow) and a **look** (drawn as road, as rock, or
  invisible);
- an optional **motion**: a transform over time, and who decides it (a formula of the race
  clock, a kick, the host: see "Things that move");
- an optional **camera hint** (below).

The terrain heightfield is the default piece under everything. Pieces are built once at load
from the layout and put in a spatial index, so a query only checks the pieces near it. The sim
already has one for things that move, `SpatialGrid` (`core/collide/grid.ts`, SPEC §9), and the
deck sample buckets in `ground.ts` are another; pieces get a static grid of the same kind.

Pieces are **the only way** to add a surface. Once they exist, `GroundDef`'s `decks`,
`branchDecks` and `branchGaps` are deleted (the layouts and generators say the same things as
pieces), so the type itself leaves no room for a fourth special case.

### The queries

The main question is **cast down from (x, y, z)**, and it gets back:
- the floor's height and slope there, and its surface;
- the ceiling over it, if it's enclosed (the point's **space**: open air, inside a tube, or in
  the rock);
- any **hazard** there (lava, deep water);
- which piece it is (and where along it).

And two more, from the same index: **the walls near a point** (for the physics to bounce off,
breakable or not), and **a line between two points** (is it clear: the camera's view of the car,
an AI's line of sight). Remote cars use the cast too, to sit on the right floor between poses.

The cast runs for every wheel of every car each tick, and 16 times a frame for the camera's line
of sight, so **queries write into a scratch result the caller owns** (as `newHit` and
`sim.hitA` do today) and allocate nothing.

**What's drawn is what's driven:** the surface comes from one function of the point, used by
both the physics and the renderer. Today they disagree: off-road surfaces go by the nearest
main-road sample and side, so sand painted along the coast drives as grass. With one function,
patches of mud or sand can be any shape, and the coast's sand drives as sand (decided: see
"Decisions").

The rule stays the one we have: **a car is on the highest floor at or below it.** The physics
uses the cast for driving and landing; the camera uses it to stay under a ceiling and out of the
rock; respawns use it to find a floor; the renderer uses "enclosed" to switch to indoor light.

### Where a car is, meanwhile

Today a car also knows where it is by road: `cars.spline`, `cars.s` and `cars.lateral`, found by
`core/track/locate.ts` (which road it's more inside of, near a junction). A lot hangs off that:
the road-edge walls (`collide/walls.ts`, by lateral distance on the car's spline), smashables (hit
only from their own spline), progress (`mainDistance`), the AI's racing line, respawns.

Pieces come in **beside** that, not instead of it. Through steps 1–5 a car has both: the cast
says what it's on (floor, ceiling, hazard, piece), and the spline position still drives walls,
progress and the AI. The road-edge walls stay rails on splines; pieces' walls are the new ones
(a tube's, a mall's, a breakable). **Step 6 (the road graph)** is where `locate` and the
road-edge walls move onto pieces and streets, and the spline position goes.

### Camera hints

Decided (2026-10-03): **automatic by default, a hint where it's tricky.** The camera works things
out from the queries (stay under the ceiling, keep the car in sight, look at the road ahead), and
a piece or an area can carry a hint that overrides it there: a distance, a height, a look-at
point (the landing past a jump). Most pieces need none.

### Portals

Where a piece goes into the ground (a tunnel's mouth, a mall's door), it gets a **portal**: the
ground cut to the piece's own outline (not whole grid squares) and stitched to its rim, with a
frame of rock or a doorway over the seam. Every tunnel and entrance then meets the land cleanly
with no per-map fix. (Today's Lava Tube has a stopgap: a shroud of rock over the tube where the
slope's cut open, so no sky shows through.)

### What the owner's list becomes

| Wanted | As pieces |
|---|---|
| **Overhangs** | A piece over the ground, drawn as rock or as a ledge. |
| **Invisible tubes** | An enclosed piece with an invisible look: it holds the car and the camera inside, and the scenery around it is decoration. |
| **Indoor moments** | Enclosed pieces. Inside, the camera stays under the ceiling, the light and fog switch to indoor, the sound gets reverb. A mall is enclosed pieces plus its scenery, with breakable windows to crash through. |
| **Drawbridges** | A piece with a motion: its angle at time t is a formula. A car on it rides it; a car arriving while it's up jumps the gap or hits the edge. |
| **Breakable walls** | A wall that breaks when hit hard enough, grown from today's smashables (`core/world/smash.ts`: where each stands comes from the layout, when it broke is state saved in snapshots, the shatter is the renderer's). Each says whether it **stays broken for the race** (a shortcut you made) or **stands again** after a time (as smashables do, 30 s). Smashables break on each screen by itself (remote cars don't smash things, and they never block anyone); a wall changes where you can drive, so its break is a trigger online. |
| **Hazards that spread** | A lava flow down the volcano onto a road, the avalanche: a path from the layout, how far along it is a formula of the race clock (and the seed, for which flank and when). A car in it wrecks. A crust that cools into something to drive on is a piece that appears at a set time. |
| **Cities** | Streets are pieces joined at junctions: a graph (below). |

### The types, sketched

Names and shapes to start from, not final:

```ts
/** Anything you can drive on: a strip along a curve. */
interface Piece {
  id: string;
  curve: Curve;                   // along it: position, tangent, width, bank, height
  surface: SurfaceId;
  look: 'road' | 'rock' | 'invisible' | string;
  walls?: { left?: WallDef; right?: WallDef };
  ceiling?: number;               // height over the floor: enclosed
  motion?: Motion;                // see "Things that move"
  camera?: CameraHint;            // overrides the automatic camera here
}

interface WallDef { height: number; breakable?: { speed: number; regrow?: number } } // regrow: s, or never

/** What a cast down from a point found. Filled in place: the caller owns it. */
interface Cast {
  y: number; slopeX: number; slopeZ: number;
  surface: SurfaceId;
  space: 'open' | 'enclosed' | 'rock';
  ceiling: number;                // NaN when open
  hazard: 'none' | 'lava' | 'water';
  piece: number;                  // -1 for the terrain
  along: number;                  // m along the piece
}

interface World {
  cast(x: number, y: number, z: number, out: Cast): Cast;
  walls(x: number, z: number, r: number, out: WallHits): WallHits;
  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean;
}

/** A map feature: a volcano, a lava stream, a drawbridge. Each hook is optional. */
interface Feature {
  shape?(g: GroundBuilder): void;            // carve or raise the heightfield, at load
  pieces?(add: (p: Piece) => void): void;    // at load
  surface?(x: number, z: number): SurfaceId | undefined;
  hazard?(x: number, y: number, z: number, t: number): Hazard | undefined;
  step?(sim: Sim): void;                     // per tick, no allocation
  draw?(skin: SkinContext): Object3D[];      // the renderer's part, kept out of core/
}

/** Who decides where a moving thing is (see "Things that move"). */
type Motion =
  | { by: 'world'; at(t: number, out: Pose): Pose }
  | { by: 'kick'; rest: Pose }                // its path comes from the claimed hit
  | { by: 'host' }
  | { by: 'relay' };

/** The escape hatch: one map's code for one small region (see "Overrides"). */
interface Override {
  id: string;
  reason: string;                            // why the engine can't do this yet
  region: Box | { street: string; s: [number, number]; lateral?: [number, number] };
  // Each hook runs only inside the region, after every feature's, and wins. All optional.
  cast?(out: Cast, x: number, y: number, z: number, t: number): void;   // floor, surface, hazard
  tune?(out: CarTuning, car: number, sim: Sim): void;                   // lift cap, grip, gravity
  walls?(x: number, z: number, on: boolean): boolean;               // on or off here
  camera?: CameraHint;
  respawn?: Pose;
  step?(sim: Sim, car: number): void;        // per tick, for each car inside, no allocation
}
```

## Things that move: who decides

Not built yet, but the engine leaves room for it. Every moving thing in the world (a piece, a
prop, a hazard) says **who decides where it is**. The rest of the engine reads it the same way
whichever it is: its pose at a tick, its collision shape, its state in snapshots. What differs is
**what happens when a car hits it**, which depends on who decides.

| Authority | Who moves it | When a car hits it | Online cost | For |
|---|---|---|---|---|
| **World** (today) | A formula of the seed and the race clock (SPEC §4's D) | Nothing moves it: the car bounces or wrecks | Nothing sent | Drawbridges, the avalanche, lava, traffic |
| **Kick** | A canned path from the hit's time, speed and angle, the same formula on every screen | The hit is a trigger (T): at once on the hitter's screen, the winner's hit shared | One claim and one event per hit | A barrel or a cone sent flying, a gate knocked off its hinges |
| **Host** | The host's page steps it and sends it as an entity, like the AI (H) | A non-host car's contact goes to the host, the way `net/contact.ts` sends bumps: a round trip of lag for the pusher | An entity's updates while it moves | Something shoved for a while: a ball, a car on a trailer |
| **Relay** (later) | A Resonance node near the players steps it, if Resonance ever runs game code | Like Host, with less lag | Like Host, and no host leaving | The same, when it matters |

What keeps that room open, from the start:
- **One interface for moving things:** pose at a tick, collision shape, snapshot state. A
  drawbridge (world) and a ball (host) look the same to the physics, the renderer and snapshots.
- **Kicks are formulas from the hit:** where the thing is at t is a closed-form function of the
  hit's time, position, speed and angle (a ballistic arc, a bounce or two, then rest), so the
  claimed event is all that's sent.
- **The state is small and plain:** what a host or a relay would send fits an entity (a pose,
  a velocity, a few flags), so moving something from World to Host to Relay is a change of
  authority, not a rewrite.
- **Ask GameRelay for what's missing:** if a relay-run object needs something the SDK lacks (an
  entity owned by the room, not a player), it gets built into GameRelay (SPEC §11's "Platform
  asks"), not faked in the game.

## Routes: a graph, not a loop

Today a track is one main road with branches that leave and rejoin it. The ground, the off-road
surfaces and out of bounds are all measured along and across the main road, and progress is
distance along it.

Caldera makes roads a **graph**: streets (splines) joined at **junctions**. A car knows which
street it's on from the pieces, not from the main road. Then:
- **A race is a route**: an ordered list of checkpoints through the graph. Today's loops are
  routes; Avalanche's run is a route with no lap. This builds on what's there: the bake already
  makes checkpoints (`Track.checkpoints`) and `rules/progress.ts` already counts laps, runs and
  positions by them. What changes is that a checkpoint becomes a gate on a street, where today
  it's a distance along the main road.
- **A mode can ignore routes**: a chase needs only where the cars are and the street graph
  (for the AI's pathfinding and for respawns: "the nearest street").
- **The ground stops depending on the main road**: features say where they are in world space
  or along a named street (the volcano already does; feature modules are written that way from
  the start, see "Modular").

This is the biggest change. It's what a city map needs (and any map whose routes cross and
rejoin freely), and it would carry a chase mode. A quick chase mode on Downtown as it is (step
5 in "Build order") is a cheap way to find out how much that matters before building it.

## A feature, end to end: lava streams

The first new feature module (step 2), and the template for the rest. The owner wants a static
stream from the volcano toward the reef: a barrier to drive round, or a risky line to jump.

1. **In the layout:** `features: [{ kind: 'lava-stream', path: [[x, z], …], width: 8,
   depth: 3 }]`. In world space, not by the main road.
2. **`shape`:** carves a channel along the path into the heightfield at load: `depth` m down,
   its banks eased out over a few meters.
3. **`pieces`:** where a road crosses the channel, the road over it becomes a short deck piece
   (a bridge), so it doesn't dip into the lava.
4. **`hazard`:** a point in the channel below the lava's level is lava. A car whose cast says
   lava wrecks, as in the crater's lake today. (A `Lava` wreck cause, beside `Hazard` and
   `OutOfBounds` in `core/events.ts`, would let telemetry tell lava from the rest.)
5. **`surface`:** the banks are rock.
6. **`draw`:** a glowing ribbon along the channel's floor, the banks darker, glow points along
   it (as the tube's gap has).
7. **Telemetry:** wrecks in it carry the cause and where, so `tools/map.ts` shows them.
8. **Proved by:**
   - `tools/probe.ts` at a point in the channel says `hazard: lava`; on the bridge, the bridge;
   - `tools/drive.ts` across the bridge flat out survives, and into the channel wrecks;
   - `tools/shot.ts` of the crossing looks right (glow, banks, bridge);
   - the fingerprints change on purpose (re-recorded), the lap floor too if the stream crosses
     a route (re-recorded, with why), and every other map's stay identical.

## Overrides: the escape hatch

Complex maps will have spots nobody planned for, where adding an engine feature for one corner
isn't worth it. An **override** is the escape hatch: one map's own code that changes specific
behaviour in one small region. Meant to be rare. (Like a level script in Unreal, not like
swizzling: it never replaces an engine function, so what a function does is always what it
says.)

- **Declared in the layout:** `overrides: [{ id, reason, region }]`. The region is a box, or a
  stretch of a street (a spline's id until the road graph) and a band across it. The reason says what the engine can't do yet:
  "the tube's exit crest throws cars, so cap the lift here".
- **Its code lives with the map**, say `src/maps/<map>/overrides.ts`, keyed by id: never a patch
  to the engine's files.
- **Only through fixed hooks** (the `Override` type above): the cast's result (floor, surface,
  hazard), a car's tuning while it's inside (the lift cap, grip, gravity), walls on or off, a
  camera hint, a respawn spot, and a per-tick step for the cars inside. They run after every
  feature's hooks, inside the region only, and win. Nothing outside the region changes, and
  nothing outside those hooks can be reached.
- **The same rules as everything else:** a pure function of position, time and seed; no
  allocation per tick; deterministic, so online and replays don't notice it's there.
- **Visible everywhere:** `tools/probe.ts` says "override active: <id>" at a point inside;
  `tools/map.ts` and the debug drawing outline the regions; `tools/validate.ts` lists every
  override per map with its reason, and warns past a handful on one map.
- **Each one is a to-do.** When the same kind of override turns up twice, it becomes an engine
  feature (a hook, a piece property, a module) and the overrides are deleted.

They also give today's one-off fixes a home. The candidates, looked at in step 2: `pastGap`'s
respawn rule for the Lava Tube's jump (it finds the kicker by its ramp heights), and the
generator's `LAND` shaping of the tube's entry crest.

## Tricks from the industry

Common practice in racing and open-world games, and where each fits here. Some we already do.

**Already doing:** a fixed 60 Hz step with the picture interpolated between steps
(`renderer.frame(alpha, …)`); a world that's a function of time and seed (SPEC §4); splines as
the source of roads; instancing for scenery; a uniform grid for things that move; fog to hide the
draw distance; a greybox skin separate from the gameplay.

**The world and its surfaces**
- **Seams get a frame, not perfect geometry.** Games rarely stitch terrain to tunnels exactly:
  a rock frame, a doorway or a "skirt" (a strip hanging under a mesh's edge, as terrain tiles
  use between levels of detail) covers the join. The portal is this; the Lava Tube's shroud is
  the same trick.
- **Junctions as their own pieces.** Road tools (Unreal's, Houdini's) build each street from
  its spline and each junction as a separate patch the streets end at. Streets stay simple
  strips; the patch handles the corners, the kerbs and the sharing of surfaces.
- **Kill and respawn volumes, and a "last safe spot" trail.** Racers keep a short ring of recent
  positions where the car was grounded on a road and pointing the right way, and respawn at the
  newest one far enough back from the hazard. That replaces per-feature rules like `pastGap`.

**Camera, light and sound**
- **Camera hints on the world**, over an automatic camera: see "Camera hints" above.
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
  to a junction ahead of you. "Heat" levels raise the pressure over time. (If a chase mode is
  built, the cops are AI.)
- **Catch-up, honestly.** Most arcade racers help the cars at the back (rubber banding). Boost by
  position already does this; for a chase, cops faster when far behind keeps it tense.

**Testing and tools**
- **Debug drawing.** A key that draws what the engine thinks: pieces' outlines, the floor under
  each car, the camera's line of sight, the AI's line and target. On in `tools/shot.ts` too, so
  an LLM can see it.
- **Golden replays.** Record a few human runs (the jump, a tunnel, a shortcut) once, replay them
  in the tests, and compare where they end: catches changes to the feel that AI lap floors miss.
  (Step 0's golden fingerprints are the scripted version of this.)
- **Heatmaps from telemetry.** Wrecks, respawns and air plotted on the map's top-down image
  (`tools/map.ts`): where players actually struggle.
- **Same math in every browser.** `Math.sin`, `Math.exp` and the like aren't required to give
  the same last digit in every JavaScript engine. SPEC already records it: an F8 report from
  Chrome replayed in Bun ended 1.6 cm off after 30 s, while the same engine is exact. The world
  tolerates it (it's closed-form, nothing builds up). If replays need to be exact across
  engines, the fix is our own `sin`/`cos`/`exp` in `core/math.ts` for the sim. **Step 0 found
  it goes further** (2026-10-03): the last bits differ by OS and by CPU (Linux arm64 vs macOS
  arm64; emulated vs CI's Linux x64), so the golden fingerprints need one recording per
  platform, and CI's could drift if GitHub changes runners. Our own math fixes all of it; it's
  recommended before step 1a.

## Limitations

### By design

Kept out on purpose, so the engine stays small and deterministic:
- **No upside-down driving**: gravity is always down, so no loops, wall rides or half-pipes.
- **No sculpting the terrain mid-race**: the heightfield is fixed at load, so a crater dug
  wherever a car crashes is out. Anything else that changes during a race is a hazard, a piece
  or a breakable, driven by the race clock, the seed or a claimed hit (a lava flow, the
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
| The ground, off-road surfaces and out of bounds are measured from the main road | `ground.ts` places every point by its nearest main-road sample | Steps 1d and 2 (surfaces, then features), then 6 |
| No road network: one loop plus branches, progress by distance along the main road | Branches leave and rejoin the main road; checkpoints are main-road distances | Step 6 (the road graph) |
| Indoors looks and sounds like outdoors | One light for everything; the camera only knows the Lava Tube | Step 3 |
| Nothing you drive on moves (only the avalanche, traffic and hazards do) | No moving surfaces | Step 4 |
| Only small round props break (smashables), in rows along a road | `smash.ts` touches a radius, and a prop is hit only from its own spline | Step 3 (breakable walls, placed in world space) |
| Big air is hard: the road lifts a car at most 8 m/s | The vertical speed cap keeps cars on the road over bumps | Tuning per feature (the jump's kicker was sized by a sweep) |
| The car is one body with a heading: no wheels leaving the ground one by one, no rolling over, no stacking | Our own simple car model | Not planned |
| Contact between players' cars is approximate online: another player's car is a pose 30 times a second, and a bump is agreed between the two screens (`net/contact.ts`) | Each player owns their car | Not planned (it's the right trade for 8 players) |
| Nothing in the world can be pushed by a car | Online, not the engine: offline the sim could push things exactly, but online each screen sees other players' cars only as poses, so each would push a thing a little differently and they'd drift apart (SPEC §4) | Room left for it: a **kick**, a **host** entity, or later a **relay**-run one (see "Things that move") |
| Deep water is just out of bounds: no wading physics, boats or tides | No water in the sim | Not planned |
| The AI follows racing lines on the roads: it can't cut across open ground or plan a route | Lines are per spline | Step 7 (pathfinding over the graph) |
| Features are authored in generator scripts, which sometimes work around the bake (the tube's ends) | No editor for ground features; the bake pulls branches toward the main road | Step 1c (branches own their heights), then 2 |

### Performance budgets

SPEC §15's budgets, for desktop now that phones are out:

| Budget | Target |
|---|---|
| Frame | 60 fps on a mid laptop with an integrated GPU, at 1080p, 8 cars and traffic on screen |
| Draw calls | under 250 a frame |
| Triangles drawn | under 1 M a frame (proposed: Paradise Open draws ~720 k) |
| Sim tick | under 2 ms for 8 cars, traffic and hazards; no allocation after warm-up |

The perf tool checks against these. The numbers below were measured on a much faster machine,
so they show the shape of the cost, not whether a mid laptop holds 60 fps: that wants measuring
on one.

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
- `bun tools/poster.ts --url 'poster.html?scout=<map>/<layout>&s=<m>'`: a screenshot of any
  spot, in headless Chrome.
- `?spawn=<m>` (dev): start your car, offline, that far along the main road.
- `window.__rc`: the sim, the renderer and `advance()`.

Built in step 0 (`src/dev/`, shared by the tools and `window.__rc.dev`):
- **Golden fingerprints:** `bun tools/fingerprint.ts` checks every layout's roads, its open
  ground and fixed drives (40 s from the grid, 15 s down each branch) against this platform's
  recording and says what moved; `--update` records them. `test/golden.test.ts` runs them with
  the tests. They fingerprint **behaviour, not storage**: the ground by the answers to its
  questions (height, slope, decks, what's on top, coast, lava, surfaces), asked along every road
  and over a grid, so step 1a can change how the ground is stored and keep them identical.
  **One recording per platform** (`test/golden/fingerprints.<platform>-<arch>.json`): floats
  differ in their last bits between macOS and Linux (`Math.sin` and the rest). A platform with
  none skips the check; one that misses or is off prints its fresh fingerprints. **A change
  meant to move a map** re-records both: `--update` here (the Mac's), push, and when CI fails on
  Linux's, `bun tools/fingerprint.ts --from-ci` writes them from its log; check the diff names
  only the maps meant to move, then push again.
- **`bun tools/drive.ts <map> …`**: place a car (`--road id --s m --lat m`, or `--at x,z[,y]`;
  `--kmh`, `--class`, `--reverse`), give it inputs (`--ai`, or held `--throttle --brake --steer
  --boost --drift`), run it (`--seconds`, `--every`), and get a trace (where, on what, speed, air,
  surface), the events (repeats collapsed) and a summary. `--json` too.
- **`bun tools/probe.ts <map> --at x,z[,y]`** (or `--road id --s m --lat m`): the road nearest
  and where on it, the surface, and on open ground the ground's height and grade, what a car at
  that height stands on (deck or ground), the highest deck there, a tunnel's mouth, the beach,
  the coast, the lava.
- **`bun tools/shot.ts <map> --s m[,m…]`** (`--road`, `--lat`, `--cam chase|high|side|top|front`
  or `--back --up --side --ahead --fov`, `--out`): a PNG through the poster studio's scout page,
  headless; needs the dev server. Default output `telemetry/shots/`.
- **`window.__rc.dev`** in the dev build: `place(spot, kmh)`, `step(ticks, controls)` (a frame
  rendered per tick, so the camera's smoothing is right), `probe(x, z, y)`, `state()`, `shot()`
  (a PNG data URL).
- **The allocation test** runs on Paradise Open and Avalanche too.

What to add (roughly in order of use):
- **`tools/drive.ts` by piece and scripted inputs:** once pieces exist, `--piece`; and a script
  of timed inputs from a file (the module takes a function of time already).
- **`tools/shot.ts --drive`:** frames along a drive (every second): a visual check of a jump or
  a tunnel.
- **`tools/sweep.ts`**: run `drive` over a range (speeds, classes, lines) and tabulate the
  outcome: "which classes clear the jump from 150 km/h".
- **`tools/probe.ts` on pieces:** the cast (floor, space, hazard, surface, piece), any override
  active there, the pieces above and below, the nearest street.
- **`tools/map.ts`**: a top-down image of a whole map (the ground's heights and surfaces,
  pieces by kind, gaps, lava, trees, routes, checkpoints, the AI's racing line, and where cars
  wrecked), and a text summary of its size and contents. For designing routes without opening
  the browser.
- **A recipe doc** for the common jobs: making a map open, adding a feature module. Plus shared
  test helpers, and each map's tests in a file of their own (Paradise Open's are in
  `deck.test.ts` today).
- **A determinism check**, grown from the test that's there: `test/core.test.ts` ("the same
  inputs from a snapshot give the same state") restores a snapshot on Downtown and compares three
  numbers at the end. Widen it to every map (pieces, moving pieces and features included), a
  hash of the whole sim state, compared every tick, so a mismatch names the tick it started.
  Replays, the AI reports and the world agreeing online all depend on it.
- **Perf numbers from the command line**: triangles, draw calls, frame time and sim time for a
  map at a spot (what `renderer.info` gives in the browser, headless), against the budgets.

Lessons from building the Lava Tube that these tools encode: test the sim headless first (it's
the truth); sweep, don't guess (the jump's numbers came from a sweep); and check the camera by
stepping frames one at a time, not with `advance()`.

## How to work on it

For each change, in this order:

1. **Say what it means to change.** A clean-up changes nothing; a feature changes a map on
   purpose. Write which, in the PR.
2. **Before:** the fingerprints and lap floors are green on `main`.
3. **While building:** `drive` and `probe` for behaviour (headless first: the sim is the truth),
   `sweep` for anything tuned, `shot` for how it looks, one frame at a time for the camera.
4. **After:**
   - `bun test`, `bun run typecheck`, `bun tools/validate.ts`;
   - fingerprints identical for a clean-up; for a feature, re-recorded, and only for the maps it
     meant to change;
   - lap floors (`bun tools/lap-report.ts <map>`) unchanged, or re-recorded here with why;
   - the field's wrecks (`--field`) no worse;
   - on an open map, the allocation test.
5. **Write it down:** CHANGELOG's "Unreleased", the map's doc (PARADISE.md, AVALANCHE.md),
   SPEC's "Changed while building" for anything that changes a rule, and this doc's status and
   build order.

## Build order

Each step ships on its own. The existing maps keep their lap floors (the best AI lap, in
seconds: Downtown 57.9, Backroads 62.82, Avalanche 93.07, Paradise 71.52, Paradise Open 68.07, as
of 2026-10-03), unless a step means to change a map (the coast's sand driving as sand, a lava
stream across a route): then the new floor is recorded, with why.

0. **A safety net and tools first** (built, PR #83). The golden fingerprints for each open map, and the
   allocation test on them. Clean-up steps must leave the fingerprints identical to the last
   bit (any change at all fails a test, so refactors can move fast); steps that mean to change
   the game re-record them on purpose. Then `drive`, `probe` and `shot`, since every step below
   gets tested with them.
1. **The pieces layer and its queries**, with the Lava Tube moved onto it first: it has every
   hard case (a tube, a gap, a kicker, mouths, the camera). In four parts, so each can be
   checked on its own:
   - **1a, the move (changes nothing):** `ground.ts` (692 lines, six jobs) split into a
     `ground/` folder, the helpers copied across five files (the lateral projection, `smooth`)
     given one home, and the decks, the tube and the gap moved onto pieces, with the minimum of
     the "shape the ground" hook that decks need (they also shape the land under them: `floor`,
     `ease`, `reach`). The three special cases in `ground.ts`, `camera.ts` and `physics.ts` go,
     and so do `GroundDef`'s `decks`, `branchDecks` and `branchGaps`. **The fingerprints stay
     identical**, which means reproducing today's tolerances exactly (`DECK_CATCH`,
     `DECK_SLACK`, the sinking check in `meetFace`).
   - **1b, portals:** the tube's mouths cut to its outline and stitched; the shroud goes.
     Changes the ground: fingerprints re-recorded.
   - **1c, branches own their heights:** the generator stops working backwards from the bake.
     The tube should drive the same: fingerprints re-recorded, lap floors checked.
   - **1d, one surface function** for drawing and driving. The coast's sand drives as sand
     (decided): fingerprints and Paradise Open's floor re-recorded.

   Clears most of TECH_DEBT's "Open ground and Paradise Open".
2. **Feature modules**: the volcano, coast, beaches, moguls, canyons and the avalanche as
   modules over pieces, each placed in world space or along a named street, not by the main road
   (moguls and canyons are by the main road today, so they move), plus the rest of decks' ground
   shaping. **Overrides** come with them (the hooks, the layout field, `validate`'s list), and
   today's one-offs are looked at. The first new modules: **lava streams** (see "A feature, end
   to end"; the static stream from the volcano toward the reef is the first), then the eruption
   and a lava flow onto a road.
3. **Enclosed spaces done properly**: the camera under the ceiling (with hints where it's
   tricky), indoor light and fog, reverb, and breakable walls (smashables grown into wall
   panels, placed in world space, staying broken or standing again as each says, their break a
   trigger online). Then a short indoor stretch on a map: a mall to cut through.
4. **Moving pieces**: a drawbridge.
5. **A quick chase mode on Downtown as it is** (optional): the mode only (roles, busted,
   escape, a timer), with AI cops that chase along the track. A cheap playtest of whether a
   chase is fun, before the road graph.
6. **The road graph and routes**: streets, junctions, and checkpoints as gates on streets (the
   bake's checkpoints and `rules/progress.ts` carried over); `locate` and the road-edge walls
   move onto pieces and streets, and the spline position goes; today's maps as routes.
7. **A city map**, and if the chase is wanted, the chase in it: AI cops pathfinding over the
   graph.

## Decisions

The owner's, 2026-10-03:
- **For racecar only**, not a general-purpose engine. The name: Caldera.
- **Refactor freely**: old code, layouts and generators get reworked; the effect is what's kept.
- **Desktop only.** Mobile is dropped (SPEC "Changed while building").
- **Camera hints: automatic by default**, a manual hint only where it's tricky.
- **A chase mode is a concept**, not a requirement; if built, the cops are AI and it's a game
  mode.
- **Breakables choose**: stay broken for the race, or stand again after a time.
- **Room for pushable things** (kicks, host entities, later Resonance relays), not built now.
- **The coast's sand drives as sand** (step 1d); Paradise Open's floor may move, and is
  re-recorded if it does. A Sandbar-style beach road (packed `beach` through soft `sand`) goes
  in PARADISE.md's next steps.
- **An escape hatch:** overrides, for the rare spot nothing else fits.

## Open questions

None right now.

## See also

- [AVALANCHE.md](./AVALANCHE.md) and [PARADISE.md](./PARADISE.md): the two open maps it grew from.
- [TECH_DEBT.md](./TECH_DEBT.md), "Open ground and Paradise Open": what step 1 cleans up.
- [SPEC.md](./SPEC.md) §4: the sync categories every feature has to fit; §9: the spatial index;
  §11: "Platform asks"; §14: telemetry and reports; §15: performance budgets.
- [ONLINE.md](./ONLINE.md): how online play is put together, file by file.
