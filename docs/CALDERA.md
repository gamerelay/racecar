# Caldera: the engine under racecar

Caldera is the name for racecar's engine: the deterministic sim, the ground and roads it drives on,
the renderer, and the tools around them. It grew out of Avalanche and Paradise Open (the volcano is
where tubes, gaps and rock faces were first needed, hence the name). **It's a direction, not a
spec.** Details will change while building; note those changes in [SPEC.md](./SPEC.md) under
"Changed while building", as usual.

**Status (2026-10-03):** reviewed and agreed (PR #82, merged). **Steps 0 to 3c are built and
merged** (#83–#98, #102) and released in `alpha-1.31` (#78–#105), on the hosted build:
- **0, 0b:** the safety net and tools, and the sim's own math (one fingerprint file for every
  platform).
- **1a–1d:** pieces, portals, branches' own heights, one surface function.
- **2a–2d:** feature modules, overrides and the lava stream.
- **3a–3c:** indoors, breakable walls and buildings (Paradise Open's market hall).

**Step 4, moving pieces, is built** on a new map, Coastal ([COASTAL.md](./COASTAL.md)): its
drawbridge (`PieceDef.lift`, #109), and the Basin Road round it (#111). Traffic now runs over more
than one road: a lane by side streets (`TrafficLaneDef.streets`, #112), towards step 6's road graph.
The main road takes a ceiling now (Coastal's Rock Tunnel, #113: its rock kept over it).
**Step 6, the road graph, is under way** (the owner's call, 2026-10-05: on Coastal, before step 5):
6a, the graph as data (`Track.graph`, `core/track/graph.ts`, #119): every map's roads as streets
between nodes, and its race as a route, its checkpoints gates on streets; 6b, a car located over it
(any road to any other at a node, #120); 6c, progress counted along the route (#121); 6d, the AI
picks its way by cost (#122); 6e, branches off branches.
HANDOFF has the detail and the lap floors.

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

Before step 1a, every non-terrain surface was its own special case (this section's "today" is then): decks (`GroundDef.decks`), a branch's
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
with no per-map fix. (Built in step 1b: an enclosed piece's outline is core's `outlineAt`, the
tube's walls are built on it, and the drawn ground is clipped to it, `render/skins/greybox/portal.ts`;
the arches stay as the frame. It's drawing only: the sim's ground is untouched, since a car in
there is in the piece's space by the cast.)

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

/** The escape hatch: one map's code for one small region (see "Overrides"; built in step 2c). */
interface Override {
  id: string;
  reason: string;                            // why the engine can't do this yet
  region: { box: [x0, z0, x1, z1] } | { road?: string; s: [number, number]; lateral?: [number, number] };
  // Each hook runs only inside the region, after every feature's, and wins. All optional.
  cast?(out: Cast, x: number, y: number, z: number): void;               // floor, piece, space
  surface?(surface: SurfaceId, x: number, y: number, z: number): SurfaceId;
  hazard?(hazard: Hazard, x: number, y: number, z: number, t: number): Hazard;
  respawn?: { road?: string; s: number; lateral: number };      // then the engine's rules apply
  step?(sim: Sim, car: number): void;        // per tick, for each car inside, no allocation
  // Not yet, added with their first use: tune (lift cap, grip, gravity: there's no per-car
  // tuning to change), walls (on or off), camera (camera hints aren't built).
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
- **Its code lives with the map**, in `src/core/maps/<map>/overrides.ts` (core, because core
  imports nothing outside it), keyed by id and listed in `core/maps/index.ts`: never a patch to
  the engine's files.
- **Only through fixed hooks** (the `Override` type above): the cast's result (floor), the
  surface, the hazard, a respawn spot, and a per-tick step for the cars inside; later a car's
  tuning while it's inside (the lift cap, grip, gravity), walls on or off, a camera hint. They run after every
  feature's hooks, inside the region only, and win. Nothing outside the region changes, and
  nothing outside those hooks can be reached.
- **The same rules as everything else:** a pure function of position, time and seed; no
  allocation per tick; deterministic, so online and replays don't notice it's there.
- **Visible everywhere:** `tools/probe.ts` says "override active: <id>" at a point inside;
  `tools/validate.ts` lists every override per map with its reason, wants code, a reason and a
  region for each, and warns past five on one map. The debug drawing (the HUD's debug key)
  outlines each region in magenta.
- **Each one is a to-do.** When the same kind of override turns up twice, it becomes an engine
  feature (a hook, a piece property, a module) and the overrides are deleted.

They also give today's one-off fixes a home. The candidates looked at in step 2c stayed where
they are: `pastGap`'s respawn rule is the engine's for any gap piece and its kicker (no longer the
Lava Tube's alone), and the generator's `LAND` is how the tube is authored at build time, not
anything at run time. So no map has an override yet.

## Tricks from the industry

Common practice in racing and open-world games, and where each fits here. Some we already do.

**Already doing:** a fixed 60 Hz step with the picture interpolated between steps
(`renderer.frame(alpha, …)`); a world that's a function of time and seed (SPEC §4); splines as
the source of roads; instancing for scenery; a uniform grid for things that move; fog to hide the
draw distance; a greybox skin separate from the gameplay.

**The world and its surfaces**
- **Seams get a frame, not perfect geometry.** Games rarely stitch terrain to tunnels exactly:
  a rock frame, a doorway or a "skirt" (a strip hanging under a mesh's edge, as terrain tiles
  use between levels of detail) covers the join. Our portal goes one better (the ground clipped to
  the outline, step 1b) and keeps the frame anyway, which covers what's left of the seam.
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
  tolerates it (it's closed-form, nothing builds up). Step 0 found it goes further: the last
  bits differed by OS and by CPU (Linux arm64 vs macOS arm64; emulated vs CI's Linux x64), so
  the golden fingerprints needed one recording per platform. **Done in step 0b** (2026-10-03):
  the sim's own `sin`, `cos`, `tan`, `atan`, `atan2`, `exp`, `log`, `pow` and `hypot` in
  `core/math.ts`, and a test that `src/core` uses nothing else. One fingerprint file now holds on
  macOS, Linux arm64 and x64, and in V8.

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
| Indoors looks and sounds like outdoors | One light for everything; the camera only knows the Lava Tube | Step 3 (3a built: indoor light, fog, echo) |
| Nothing you drive on moves (only the avalanche, traffic and hazards do) | No moving surfaces | Step 4 |
| Only small round props break (smashables), in rows along a road | `smash.ts` touches a radius, and a prop is hit only from its own spline | Step 3 (3b built: breakable walls, placed in world space) |
| Big air is hard: the road lifts a car at most 8 m/s | The vertical speed cap keeps cars on the road over bumps | Tuning per feature (the jump's kicker was sized by a sweep) |
| The car is one body with a heading: no wheels leaving the ground one by one, no rolling over, no stacking | Our own simple car model | Not planned |
| Contact between players' cars is approximate online: another player's car is a pose 30 times a second, and a bump is agreed between the two screens (`net/contact.ts`) | Each player owns their car | Not planned (it's the right trade for 8 players) |
| Nothing in the world can be pushed by a car | Online, not the engine: offline the sim could push things exactly, but online each screen sees other players' cars only as poses, so each would push a thing a little differently and they'd drift apart (SPEC §4) | Room left for it: a **kick**, a **host** entity, or later a **relay**-run one (see "Things that move") |
| Deep water is just out of bounds: no wading physics, boats or tides | No water in the sim | Not planned |
| The AI follows racing lines on the roads: it can't cut across open ground or plan a route | Lines are per spline | Step 7 (pathfinding over the graph) |
| Features are authored in generator scripts | No editor for ground features (a branch can own its heights since step 1c) | Step 2 |

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
  ground and fixed drives (40 s from the grid, 15 s down each branch) against the recording and
  says what moved; `--update` records them. `test/golden.test.ts` runs them with
  the tests. They fingerprint **behaviour, not storage**: the ground by the answers to its
  questions (height, slope, decks, what's on top, coast, lava, surfaces), asked along every road
  and over a grid, so step 1a can change how the ground is stored and keep them identical.
  **One recording for every platform** (`test/golden/fingerprints.json`), since the sim does its
  own math (step 0b). **A change meant to move a map** re-records it with `--update`; check the
  report names only the maps meant to move.
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
seconds: Downtown 57.9, Backroads 62.82, Avalanche 93.07, Paradise 70.3 (71.52 before the mud went slippery), Paradise Open 66.35 (67.27 before the mud
and the Freeway's bank, 68.07 before step 1d's
sand, 68.10 before 3b's boards, 68.00 before the tube's berm, 67.67 before 3c's market street), as of 2026-10-03), unless a step means to change a map (the coast's sand driving as sand, a lava
stream across a route): then the new floor is recorded, with why.

0. **A safety net and tools first** (built, PR #83), and **0b, the sim's own math** (built, PR #84), so
   the fingerprints are the same bits on every platform. The golden fingerprints for each open map, and the
   allocation test on them. Clean-up steps must leave the fingerprints identical to the last
   bit (any change at all fails a test, so refactors can move fast); steps that mean to change
   the game re-record them on purpose. Then `drive`, `probe` and `shot`, since every step below
   gets tested with them.
1. **The pieces layer and its queries**, with the Lava Tube moved onto it first: it has every
   hard case (a tube, a gap, a kicker, mouths, the camera). In four parts, so each can be
   checked on its own:
   - **1a, the move (changes nothing)** (built): `ground.ts` (692 lines, six jobs) split into a
     `ground/` folder, the helpers copied across five files (the lateral projection, `smooth`)
     given one home, and the decks, the tube and the gap moved onto pieces, with the minimum of
     the "shape the ground" hook that decks need (they also shape the land under them: `floor`,
     `ease`, `reach`). The three special cases in `ground.ts`, `camera.ts` and `physics.ts` go,
     and so do `GroundDef`'s `decks`, `branchDecks` and `branchGaps`. **The fingerprints stay
     identical**, which means reproducing today's tolerances exactly (`DECK_CATCH`,
     `DECK_SLACK`, the sinking check in `meetFace`).

     **Built** (2026-10-03), fingerprints identical on every layout:
     - `TrackLayout.pieces` (`PieceDef`): a piece carries a stretch of a road (`road`, `s`); a floor
       or none (`floor: false`, a gap); `ceiling` makes it enclosed; `under` is the shaping hook
       (main road only for now). Paradise Open has four: `freeway`, `lava-tube-in`, `lava-jump`
       and `lava-tube-out`. `validate` checks them.
     - `core/track/ground/`: `land.ts`, `shape.ts`, `branches.ts`, `pieces.ts`, `plane.ts`,
       `search.ts` and `index.ts`. `track/frame.ts` holds `along` and `across`. `smooth` is
       `math.ts`'s `smoothstep` everywhere (the ground, the island, the pines, the renderers, the
       generator).
     - **One question, `ground.cast(x, y, z, out)`**: what a point stands on (`floor`, `piece`),
       the ground, the piece floor under it (`over`) and its `ceiling`, and its `space` (open,
       enclosed, rock). `deckUnder` is gone; physics (`meetFace`, the wheels, the landing catch),
       the camera (`cameraFloor`, `clearView`, `slopeRise`) and the tools all ask the cast.
       `pieceFloor` (was `deck`) is the floor query with slack; `top` and `topSlope` stay. The
       sinking check stays in `meetFace` (a rule of the physics, now in terms of the cast).
     - Not yet, by design: pieces are still found by their road (the ground grid's nearest
       main-road sample, a branch's floor samples bucketed), not a spatial grid of their own, and
       they have no `look` or camera hint (the renderer still knows a tube from a deck by its road).
       Both come when pieces get their own curves.
     - Two small camera changes, the same rare spot (the camera inside a slope beside the
       Freeway): its "inside a tube" rule now holds only under an enclosed piece's ceiling, not
       6 m over any deck, so `clearView` pulls it in there, and `cameraFloor` keeps it over that
       slope rather than over the deck. The camera only; nothing drives differently.
   - **1b, portals** (built): the tube's mouths cut to its outline and stitched; the shroud goes.
     Planned as a change to the ground; built as drawing only, so the fingerprints stayed
     identical. `outlineAt` (core) is an enclosed piece's cross-section, the tube's walls are
     built on it, and the terrain's cells near it are split finer and clipped to it, the cut
     found by bisection on a signed distance (`portal.ts`). Past each open end the end's outline is
     carried on as far as its arch reaches (1.5 m), so ground standing in front of the opening is
     cut too; the arches sit on the end rings. Only the finest level of detail is cut (further off
     a 7 m mouth is a few pixels, and cutting coarse quads cracked them against their neighbours).
     `test/portal.test.ts` checks nothing is drawn inside the outline (but where the cut stops, at
     an arch's outer face), the ground in front of the openings is cut, and the tube's walls lie on
     the outline.
   - **1c, branches own their heights:** the generator stops working backwards from the bake.
     The tube should drive the same: fingerprints re-recorded, lap floors checked. *Built:*
     `BranchDef.heights: 'own'` (held to the main road's ground only on it or its verge, no fade);
     the generator writes the tube's profile as it wants it. Within 8 cm of before; the lap floor
     and the field unchanged.
   - **1d, one surface function** for drawing and driving. The coast's sand drives as sand
     (decided): fingerprints and Paradise Open's floor re-recorded. *Built:* `ground.kind` per
     grid point (`ground/surface.ts`), coloured by the renderer and driven by `surfaceAt`;
     Paradise Open 68.10 s (was 68.07).

   Clears most of TECH_DEBT's "Open ground and Paradise Open".
2. **Feature modules**: the volcano, coast, beaches, moguls, canyons and the avalanche as
   modules over pieces, each placed in world space or along a named street, not by the main road
   (moguls and canyons are by the main road today, so they move), plus the rest of decks' ground
   shaping. **Overrides** come with them (the hooks, the layout field, `validate`'s list), and
   today's one-offs are looked at. The first new modules: **lava streams** (see "A feature, end
   to end"; the static stream from the volcano toward the reef is the first), then the eruption
   and a lava flow onto a road.
   - **2a, the interface** (merged, #89): `core/track/features/`, a `Feature` with optional `shape`,
     `surface`, `hazard` (and `coast`) hooks the ground runs in order; the volcano and the coast
     moved onto it, the fingerprints identical. `ground.hazard(x, y, z)` replaces `inLava`. The
     skin still colours the volcano from the layout (a `draw` hook comes with the lava stream,
     which needs one). `shape` gets where a point is by the main road (s, lateral, edge, the
     deck run-in); `hazard` gets the time. Open for 2d: `surface` returns a ground kind, so the
     stream's rock banks add a kind, or it becomes a surface id.
   - **2b, the by-road features as modules** (merged, #90): mogul fields, canyons and beaches are
     `GroundDef.features` (`{ kind: 'moguls' | 'canyon' | 'beach', … }`), modules with new hooks:
     `rise` (added with the swell), `sunk` (the avalanche's shelter), `bare` (no trees), `side`
     (a beach's side, for palms), and `surface` gets the main road's sample and lateral. The AI
     reads a canyon's `def` for its line. *Changed while building:* they stay placed along the main
     road (s and lateral): that is "along a named road", and a mogul field or a canyon belongs by
     its piste. So nothing moved: every fingerprint identical. World-space placement (a path)
     starts with the lava stream.
   - **2c, overrides** (built): `TrackLayout.overrides`, `core/track/overrides.ts` (regions
     as a box or a stretch of a road, bound to their code at bake), the hooks `cast`, `surface`,
     `hazard`, `respawn` and `step`, probe's "override active", `validate`'s checks and list.
     *Changed while building:* the code lives in `core/maps/` (core imports nothing outside
     core); `tune`, `walls` and `camera` wait for a first use. `pastGap` and `LAND` stay (see
     "Overrides"), so no map has one: a clean-up, every fingerprint identical.
   - **2d, the lava stream** (built): Paradise Open's, out of the volcano's south-west flank and
     down to the sea by the bay, end to end as above. *Changed while building:*
     - **No bridge piece:** the main road rings the volcano, so a stream to the sea either
       crosses it or takes the one way down that doesn't. It takes that one (at least 34 m from
       every road), and the validator refuses a stream that crosses or touches a road until a
       bridge over one is a piece.
     - **Its banks are a new ground kind** (`KIND_LAVA_ROCK`, driven as `lava-rock`), the 2a
       question settled: `surface` still returns a kind.
     - **`hazard` gets the ground's height** there (lava is LAVA_FILL m over the channel's
       floor, wherever that is); **`bare` gets x and z** (a feature in world space).
     - **The draw hook is the skin's table** (`render/skins/greybox/features.ts`, by kind),
       not a hook on core's `Feature`: core has no Three.js. The cone's lava shader is shared.
     - **Lava wrecks with `Cause.Hazard`**, as the crater's lake: telemetry already tells it
       from out of bounds, so no `Lava` cause. `tools/map.ts` isn't built.
     - **The numbers came from driving it** (`tools/drive.ts`, which gained `--heading` and an
       exact `--at`): a 10 m floor 3 m deep couldn't be jumped at all (the sim's gravity is
       about 2.5 g); a 6 m floor 4 m deep with 0.6 m of lava is cleared from about 130 km/h,
       and below about 100 km/h you're in it. It comes out of the flank over its first 25 m (a vent,
       not a pit).
3. **Enclosed spaces done properly** (built: 3a–3c, #97, #98, #102): the camera under the ceiling (with hints where it's
   tricky), indoor light and fog, reverb, and breakable walls (smashables grown into wall
   panels, placed in world space, staying broken or standing again as each says, their break a
   trigger online). Then a short indoor stretch on a map: a mall to cut through.
   - **3a, indoors** (built): inside an enclosed piece the light, fog and sound change, and the
     camera stays under the ceiling. *Built:* `PieceDef.indoor` names the look (the skin's
     `INDOOR` table in `palettes.ts`: `tunnel` by default, `lava` for the Lava Tube); the renderer
     eases `indoor` (0 to 1, about half a second) from `indoorAt` at the camera (the cast: enclosed,
     over the piece's floor); the skin eases the fog and the sky light to the look's and dims the
     sun to a sliver; the engines and effects get a room's echo (a convolver, `roomImpulse`);
     `cameraCeiling` caps the chase camera a metre under a ceiling over the car (the tube's 7 m
     never needed it; a mall's lower one will). Drawing and sound only: every fingerprint
     identical. *Changed while building:* camera hints wait for a spot that needs one (the
     tube's camera already works it out, the jump included), so the `camera` override hook waits
     too; `tools/shot.ts` draws a still fully indoors.
   - **3b, breakable walls** (built): `TrackLayout.breakables` (`BreakableDef`: a wall in world
     space, its foot `from` and `to`, a `height`, a `look`, the speed that `breaks` it, and
     `standsAgain` or down for the race), cut into panels (`core/world/breakables.ts`) that each
     break on their own (`collide/breakables.ts`): slower than `breaks` a panel is a wall (the road
     walls' `bounce`), faster it bursts (`Ev.WallBreak`) and the car keeps 93% of its speed. Saved
     in snapshots. Online it's a trigger, claimed as traffic hits are (`net/breakables.ts`). Probe
     lists walls near a point; the validator wants open ground, a size and each panel's foot on a
     floor. The first one boards up the Lava Tube's first mouth (`BOARDS` in the generator: 15 m,
     six planked panels, broken from about 43 km/h, down for the race). Paradise Open re-recorded:
     its floor 68.10 → 68.00 s (lap 1 about 0.2 s slower through the boards; the next laps' boost
     falls differently), the field 28 wrecks in 40 seeds (30), none at the boards.
     *Changed while building:*
     - **No boost for a break**, unlike a smashable: paid for it, the tube got faster (67.98 s,
       top speed up 8 km/h), and it's already a strong line.
     - **A panel breaks by how fast the car goes across the wall's line**, not into the panel where
       they touch: a wide car (the bus) through a one-panel hole met the next panels on their ends,
       slowly, and wedged there.
     - **At an angle, the hole runs as far as the car slides along the wall while it crosses**
       (the review, 2026-10-04): its footprint's hole fell behind it, and it met the next panel's
       end slowed and bounced, often a wreck. The panels it sweeps past break without slowing it.
     - **The `walls` override hook still waits:** walls on or off in a region has no first use.
   - **3c, an indoor stretch** (built): a building, `PieceDef.building` (a key of the skin's
     building looks: `market`), an enclosed piece built on the ground rather than dug into it.
     `core/track/buildings.ts` stands its walls along the road's edges as solid props on no road
     (`BakedProp.wall`: met as a road's wall, from either side, for every car), and the bake turns
     the road's own walls off along it. The branch shapes the ground under it as anywhere. The cast
     finds its room (`Cast.room`, for the camera, the light and the echo), but a car in it stands on
     the ground, and `pieceFloor` doesn't see it. `indoorAt` and `cameraCeiling` take a building's
     roof as cover, as they do the rock over a tunnel, and `clearView` keeps the chase camera out of
     its walls. The skin draws it (`render/skins/greybox/building.ts`) and has a `market` indoor
     look, plus a `glass` look for breakable walls, with its own shards and smash. The first:
     Paradise Open's **market hall**, on a 251 m street (`market-street`) through Harbor Town,
     about 34 m shorter than the road round: an 80 m hall with a 7 m ceiling, shopfront glass
     across both doors, smashed from 8 m/s (about 29 km/h), its floor sand (a zone). Paradise
     Open's floor 67.67 → 67.27 s (the AI takes it), and the field 37 wrecks in 40 seeds (39).
     A building's indoor look is its own unless it says (`indoor` defaults to `building`), and the
     validator wants its walls on no other road (the AI and a respawn don't see them).
     *Changed while building:*
     - **A building has no floor of its own.** Drawn as a deck, its plane at the doors kicked cars
       into the air: a car's rear wheels were still on the ground while its middle was on the
       deck. It stands on the ground, which the street shapes flat under it.
     - **Its walls are props, not the road's walls**, so a car outside, off the road beside it,
       meets them too. They take the road walls' `bounce`: a pillar's response fired a hit every
       tick along a scrape.
     - **No mall, and no camera hints yet:** the owner's mall waits for another map. The hall is
       straight, and the chase camera needs no hint in it. The `camera` override hook still waits.
     - **It stands on the beach:** the sea side of the harbour front is sand.
     - **Its floor is sand** (the owner, having driven it: through it flat out felt a little broken
       for racing). On tiles the floor was 66.72 s, the street a second quicker than the road round;
       on sand about 0.4 s.
     - **The street's road walls are off** (as every road's on the island but the Freeway's): on,
       they were invisible rails along the beach either side of the hall, and the owner ran into
       both. Only the hall has walls.
     - **A branch's road is drawn on into its junctions** (the skin's draped strip): left to the
       ground's cells there, its edge was a staircase where it peeled off the main road.
4. **Moving pieces**: a drawbridge. *Built on Coastal* (2026-10-04: `PieceDef.lift`,
   `core/world/lifts.ts`; COASTAL "Built so far" has the detail). What it was planned as:
   - **What it is:** a piece with a motion, World authority ("Things that move"): its pose at
     race time t is a formula of the seed and the clock, the same on every screen, nothing sent.
     A car on it rides it; a car arriving while it's up jumps the gap off its lip or hits its
     edge (a wall, by the road walls' `bounce`). Its state needs nothing in snapshots if it's a
     pure function of t.
   - **Where:** on Coastal, a new experimental map built for it ([COASTAL.md](./COASTAL.md),
     the owner, 2026-10-03): a bascule leaf over a harbour mouth, with a detour round the inner
     harbour. Coastal's own fingerprints are re-recorded as it changes, while every other map's
     stay identical, so the feature can be found fast without disturbing Paradise Open. (Paradise
     Open's Freeway span was the earlier idea. Downtown's canal drawbridge, in SPEC's "Downtown's
     five", is a landmark only and waits for the road graph.)
   - **First, the main road takes a gap** (found building Coastal's lap, COASTAL "Built so
     far"): on the main road a piece is a deck only, because the ground there is the road's. A
     raised leaf leaves a gap over the harbour, so the main road needs gaps (and, for Coastal's
     tunnel, ceilings) as branches have them.
   - **What it touches:** `PieceDef` (a motion: its hinge, its up and down times, its angle), the
     floor query and `ground.cast` (a floor that tilts with t: the cast takes t, or the span's
     pose is set each tick before the cars step), `topSlope` (the tilt), the gap's `pastGap`
     respawn rule, the AI (it should know a raised span: lift off, or slow), the skin (the span
     drawn at its pose, its counterweight and towers), the fingerprints (a moving piece's pose at
     a few t), and probe and drive (`--t`).
   - **The rules to keep:** a pure function of t (no state, no allocation per tick), core's own
     math, and the lap floors (a raised span on the line may move the AI's lap: say so if it does).
5. **A quick chase mode on Downtown as it is** (optional): the mode only (roles, busted,
   escape, a timer), with AI cops that chase along the track. A cheap playtest of whether a
   chase is fun, before the road graph.
6. **The road graph and routes**: streets, junctions, and checkpoints as gates on streets (the
   bake's checkpoints and `rules/progress.ts` carried over); `locate` and the road-edge walls
   move onto pieces and streets, and the spline position goes; today's maps as routes.
   In slices, each with every map's fingerprint identical until one is meant to move:
   - **6a, the graph as data** (built): `Track.graph` from the baked roads: nodes (a junction where
     a branch leaves or rejoins, two at one spot one; the line; an open road's ends), streets (the
     main road cut at every node on it, none wrapping; each branch whole), and the route: its start
     and finish (a run's are nodes, so its way adds up to it), each node's distance along it, its
     way (the main road's streets in order), every street between two of its nodes (the Basin Road
     is; a side street isn't), and its gates (the checkpoints and the finish). The validator now
     refuses a branch across the line (it would miss the finish). `tools/plan.ts` draws it.
   - **6b, where a car is** (built): `locate` walks the graph's links (`RoadGraph.links`: at each
     node on a road, every other road there and where it is on it). Near a node, a car is on
     whichever road meeting there it's most inside of, so it goes from any road to any other there,
     not only from a branch back to the main road (a test has two branches meeting at one junction).
     Its guess at where it is on the other road: as far past the node, or from a branch onto the
     road it spans, as far through that span (`Link.scale`, as before). Every fingerprint identical.
   - **6c, progress by gates** (built): laps, checkpoints, positions, the finish, the grid and the
     results' gaps count the route (`RoadGraph.along`: how far along it a car is, on the main road
     its distance from the start, on a street between two of its nodes as far through the route
     between them; `Gate.at`), not the main road's distances. Exactly the old numbers on every map
     today (a test checks every road to the bit), so every fingerprint is identical; what changes
     is that a route needn't be the main road. Main-road distances still run the hazards, traffic,
     the avalanche and the AI's marks (they're on the main road).
   - **6d, the AI picks its way by cost** (built): at a node ahead it takes the quickest way it
     knows on to the finish: each street's time by the racing line, and from each node the quickest
     on by the route's streets (`wayCosts` in ai/racer.ts), plus what a drawbridge would hold it
     there (`liftWait`: the wait, to a hundredth, and stopping's cost, `STOP_COST`). Every driver
     knows the main road and a detour; a shortcut it knows on its roll (skill), as before. A
     shortcut slower than what it skips, nobody takes.
     **Driven costs** (after alpha-1.32): a street's time is as the car's class drives it, not
     the racing line alone. The line's speeds are a corner's and its braking, up to 120 m/s on a
     straight, with no pulling away: on Coastal they came to 84 s a lap against 108 s driven, and
     short straights read as near free. Now each road's line is capped at the class's top speed,
     braked for and pulled away from with the sim's own pull (physics.ts: less toward the top,
     air drag, rolling, a surface's drag), a branch starts at what the road it leaves allows and
     pays the braking down to it, and pays the pull back up on the road it rejoins. On Riviera, a
     hard coupe: the main road's streets it drove in a lap, 105.7 s by costs against 107.7 driven
     (84.4 by the line); a cut from 150 m before to 250 m past it within 0.25 s; the Rocks'
     saving 2.73 s against 2.72 driven. Off-road cuts read slower than they drive (Paradise's
     sandbar 1.8 s slower than the road by costs, 0.8 driven): grip and rough ground aren't in
     the line's corner speeds. `STOP_COST` went from
     4.28 to 3.26 s with it, swept over the lift's cycle for every class (the quicker way at
     every start time, within 0.45 s). Paradise and Backroads keep the racing line
     (`TrackLayout.aiCosts: 'line'`, the owner's call): driven, four of their shortcuts are
     slower than the road (the sandbar, the beach cut, Smugglers' Trail, the barn), and their
     rivals take them now and then, as before. Every fingerprint identical, and Riviera's field
     results: no race changes today; it's for the cuts to come.
   - **6e, branches off branches** (built): `BranchDef.leaves` and `rejoins` name the road a branch
     leaves and rejoins (the main road unless they say, or an earlier branch), `from` and `to`
     along those. The bake forks it off, joins its ground and opens the walls on those roads;
     the graph cuts every road at the nodes on it (a junction partway along a branch, as far along
     the route and the main road as it is through the branch); `locate` and the AI's choice work
     from any road (a way off is a branch; where a road ends there's no choice). Main-road readers
     still get `mainFrom`/`mainTo` (off a branch, where that is on its span). The validator keeps a
     branch off an earlier one, not a side street, 30 m clear of its ends. Tested on Backroads with
     a lane off the barn shortcut (`test/fixtures-lane.ts`); every fingerprint identical.
   - Then Coastal uses it (#126): the Stairs up the Old Town, two flights through a crossroads on
     the middle row (one branch's end and the next one's start, half a metre apart: one node) and
     an arm off the first flight, a lane off a branch (COASTAL's step 7). With it `BranchDef.limit`:
     the fastest the AI takes a road (its racing line's cap, so its costs too), for a road slower
     than its curves say. #125 fixed #123's review (the editor's reanchor in rounds over
     `bakeRoads`, `Link.scale`, the choice window).
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
