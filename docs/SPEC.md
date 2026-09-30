# racecar: design

> **Status (2026-09-30): milestone 1 merged; milestone 2 (the world) built on branch `m2-world`.** A loose outline: when building teaches us
> something, we change it here and say so under "Changed while building". Decisions made so far
> are in §17.
>
> racecar is an arcade street racer for the browser, online through GameRelay, for up to 8
> players. It grows out of the "Neon Wreck" prototype (one endless straight road, near misses,
> boost, takedowns, aftertouch) into a real game: long circuits with shortcuts, traffic,
> hazards and weather; several modes; a lobby you live in between races; controllers.

## The pitch

**Burnout 3's crashes, Mario Kart's party, with some Need for Speed and Forza sprinkled on top.**
You open the link, land in the lobby, jump into a party, race through mayhem, the group votes
on the next map, and you race again. No menus between you and the next race.

| From | We take | We leave |
|---|---|---|
| **Burnout 3** | Takedowns, aftertouch, boost earned by driving dangerously, traffic checks, slow-mo wreck cam, revenge takedowns, signature takedown spots, Crash mode | Long single-player career |
| **Mario Kart** | Party-first flow, drift mini-turbo, start boost, catch-up, shortcuts everywhere, hazards that are part of the track, anyone can pick it up | Kart physics, character roster, items (for now) |
| **Need for Speed** | Nitrous feel, night cities, rain, cops in a Pursuit mode, visual customization | Story, open world |
| **Forza** | Handling that feels good on a controller, car classes with real trade-offs, rewind in single player, photo mode | Simulation, tuning sheets |

## Goals

1. **A real game first.** Fun on its own, with friends or alone, or it's not a good demo.
   30 seconds from link to racing; crashes are the fun part; every lap is different because of
   traffic, hazards and weather.
2. **Show off GameRelay.** Every online feature uses the public SDK as any customer would. No
   private APIs, no game server of our own. Where the SDK falls short, we add the feature to
   GameRelay for everyone (§11, "Platform asks"), not a hack in the game.
3. **Calibrate the network.** The game ships a net overlay and headless bots, so we can load-test
   rooms and relays and measure what players actually feel (§14).
4. **Open-source example.** `gamerelay/racecar`, MIT, readable, small. Someone should be able to
   read `src/net/` in an evening and learn how to build a multiplayer game on GameRelay.
5. **Fast and small.** 60 fps on a mid laptop and a 2021 phone; lobby on screen in under 2 s,
   first race in under 3 s. Budgets in §15 are enforced in CI, not hoped for.

Not goals (v1): realistic driving sim, a career, tuning sheets, native apps, anti-cheat for
ranked play (§10, "Trust").

## Principles

These decide the arguments before they happen.

1. **Greybox first, skin later.** Gameplay, level design and netcode are built and tuned on
   flat-shaded geometry. The prototype's look (toon ramp, ink, neon, post FX) is a *skin*
   applied afterwards through one interface (§6). No gameplay code may depend on a skin.
   **Feel is not a skin:** speed lines, FOV kick, camera shake, sparks, boost flames, hit-stop
   and sound are how the game tells you what's happening, so they're in the greybox from day
   one. Only the look (materials, lighting, scenery art, palettes) waits.
2. **Every system is declared up front** (§3): what it owns, what it reads, when it runs, and
   how it syncs. A new feature starts by adding a row to that table.
3. **Shared world = function of (seed, race time).** Traffic, hazards, weather and item boxes
   are computed from `room.seed` and the shared race clock on every client, so they cost zero
   bandwidth and can never disagree (§4). Only players' own cars and the things they set off go
   over the network.
4. **Shared moments are scheduled, not reported.** Anything everyone must see at the same
   instant (the start lights, a triggered hazard, the next race) is announced with a server-clock
   time slightly in the *future*, so every screen, the sender's included, starts it together.
5. **One owner per piece of data.** A car is written by its player; the world by the clock;
   race facts by the host. Nobody writes what they don't own (the SDK enforces this anyway).
6. **No allocation in the hot path.** The sim uses fixed-capacity pools and typed arrays; a
   test asserts zero allocations per tick after warm-up.
7. **Data, not code, for content.** Tracks, surfaces, hazards and car stats are JSON files
   validated by a schema, edited in our own editor (§6). Code defines *kinds* of things;
   data places them.

## §1 Stack

- **TypeScript, Vite, Bun** (tests, bots, scripts). Three.js current release (WebGL2), imported
  per module so tree shaking works.
- **`@gamerelay/sdk`** from npm, same as any customer.
- UI and HUD are **DOM**, not canvas. No UI framework: plain TS components with a controller
  focus system (§13).
- Schemas for content with a small validator (no runtime dependency; types generated from the
  same source).
- Repo **`gamerelay/racecar`**, private until the online milestone is playable, then public.
  Deployed as static files at `racecar.gamerelay.io`, itch.io later.

## §2 Architecture

`core/` is pure TypeScript with no Three.js, no DOM, no network. It runs in the browser, in Bun
tests, in the editor, and in headless bots.

```
src/
  core/
    clock.ts       race time, ticks
    rng.ts         seeded streams, one per system (§4)
    pools/         fixed-capacity SoA stores: cars, traffic, colliders, zones
    track/         layout loading, baking (distance table, walls, chunks), queries by s
    car/           physics, drift, boost, wreck body, stats
    world/         traffic, hazards, weather, surfaces, item boxes (all deterministic)
    collide/       OBB/segment tests, spatial grids, contact resolution
    rules/         progress, laps, positions, scoring (near miss, takedown, air…)
    ai/            racing line, drivers, rubber-band
    events.ts      the per-tick event queue
    sim.ts         the tick pipeline (§3) that runs all of the above in order
  modes/           one file per mode, behind the Mode interface
  net/             GameRelay adapter: lobby, party, entities, prediction, triggers, votes
  render/
    scene.ts       renderer, cameras, chunk culling, instancing
    skins/
      greybox/     flat-shaded, colored by surface, shows triggers and zones (the default)
      neon/        the prototype's look (later)
  editor/          the level editor (dev builds only, §6)
  input/           keyboard, gamepad, touch → Controls; menu focus
  ui/              screens: lobby, party, garage, settings, HUD, results, vote
  audio/           engine synth, SFX, music
  telemetry/       events → local files (dev) / PostHog (playtests); reports (§14)
content/
  maps/<map>/      map.json, <layout>.track.json, hazards.json
  cars/*.json      car classes
  surfaces.json    the surface table
tools/
  bots/            headless GameRelay clients driven by core/ai (load tests, filling rooms)
  validate.ts      content validator (runs in CI)
  telemetry.ts     summarizes local telemetry files
  replay.ts        re-runs a saved report headless
```

Dependency direction: `ui, render, net, input, editor → core`; `modes → core`. `core` imports
nothing outside itself. `render/skins/*` only implement the `Skin` interface. Enforced with an
import lint rule.

### Loop

- `relay.tick(60, step)` (or a local fixed-step loop offline) runs `core/sim.ts` at 60 Hz.
- `requestAnimationFrame` renders, interpolating between the last two sim states.
- Render, audio, HUD and net read the tick's **event queue** (a typed ring buffer, not
  callbacks), so the sim never calls into them and a slow renderer can't stall a tick.
- **Slow-mo is a property of the wreck, not of your screen.** Online, a wrecked car's body
  runs at ~0.35× for its first ~1.3 s *for everyone*: others see your car tumble in slow motion
  while they race past at full speed, and your aftertouch steers the same wreck they see. (A
  slow-mo that only your screen showed would put your wreck behind where everyone else sees
  it.) Your camera frames it; the world doesn't slow down. In single player the whole world
  slows, as Burnout does.

### Data layout

Hot data lives in struct-of-arrays pools with fixed capacity, indexed by handle
(index + generation):

| Pool | Capacity | Notes |
|---|---|---|
| cars | 8 + 8 ghosts | players and AI; ghosts for Time Trial and spectating |
| traffic | 128 posed | the whole track's traffic is a formula; only cars within ~300 m of a local car are posed into the pool each tick |
| colliders (dynamic) | 256 | hazard pieces (logs, rocks, lava bombs), item projectiles |
| zones (dynamic) | 64 | oil slicks, lava crust, puddles |
| particles | render-side | one pooled buffer, never touched by core |

## §3 Systems

This table is the contract for how everything fits together. Order is the order within a tick.

| # | System | Module | Reads | Writes | Sync (§4) |
|---|---|---|---|---|---|
| 1 | Input | `input/` | devices | `Controls` per local player | local |
| 2 | Clock | `core/clock` | `relay.now()`, `state.startAt` | race time, tick number | shared clock |
| 3 | Weather | `core/world/weather` | seed, race time, map weather profile | grip multiplier, wet flag, visibility | **D** deterministic |
| 4 | Traffic | `core/world/traffic` | seed, race time, lanes, the hazard *schedule* | traffic poses (closed-form), wreck overrides | **D** + **T** for hits |
| 5 | Hazards | `core/world/hazards` | seed, race time, hazards.json, trigger log | dynamic colliders, zones, telegraphs | **D** + **T** for triggers |
| 6 | Item boxes | `core/world/items` | seed, race time, claims | box availability | **T** |
| 7 | Own car | `core/car` | Controls, surfaces, weather | own car state | **O** owned entity |
| 8 | AI cars | `core/ai` + `core/car` | track, cars, traffic | AI car state (host only) | **H** host entity |
| 9 | Remote cars | `net/predict` | entity snapshots | predicted poses | received |
| 10 | Broadphase | `core/collide/grid` | all poses | dynamic grid | local |
| 11 | Collisions | `core/collide` | grids, static walls | contacts, impulses on own/AI cars | **E** bump events |
| 12 | Rules | `core/rules` | cars, contacts, track | progress, laps, positions, scores | **E** + **S** results |
| 13 | Mode | `modes/*` | rules output, events | mode state, end condition | **S** host state |
| 14 | Events | `core/events` | everything above | the tick's event queue | local |
| 15 | Net flush | `net/` | own/AI car state, queue | entity writes, emitted events | out |

Render, audio and HUD run per frame after this, reading state and the queue.

D-systems may read each other as long as there's no cycle: traffic reads the hazard
*schedule* (a function of the seed alone) so a car in a rockslide's path is wrecked by it on
every screen, and hazards read traffic *poses* so the log truck is a real car in traffic.

Rules for adding a system: it gets a row, a slot in the order, a sync category, a pool (if it
has many things), and a test that runs it headless.

## §4 Sync categories

Every piece of game data is in exactly one of these:

| Cat | What | How | Cost |
|---|---|---|---|
| **O** | Things a player owns: their car, their fired items | GameRelay entity, player-owned, 30 Hz | ~40 B × 30/s per car |
| **H** | Things the host runs: AI rivals | GameRelay entity, `owner: 'host'` (migrates with the host) | same |
| **D** | The deterministic world: traffic, scheduled and random hazards, weather, item box spawns | Pure function of `(seed, raceTime)`; nothing sent | 0 |
| **T** | Triggers: someone set something off, or hit a traffic car | `room.claim(key)` decides who; the winner emits the event with a start time ~250 ms in the future on the server clock; everyone, the winner included, runs it from then | one claim + one event |
| **E** | Moments: bumps, wrecks, takedowns, laps, finishes, horns | `room.emit` | tiny, rare |
| **S** | Race facts: phase, map, options, ready, results, votes, session points | `room.state`, host-written, timers for phases | rare |
| **L** | Local only: particles, camera, debris after a wreck, audio | never sent | 0 |

**The shared race clock.** `raceTime = relay.now() - state.startAt`, quantized to 60 Hz ticks.
Clients agree on `relay.now()` to within a few ms, so a 20 m/s truck is within ~10 cm on every
screen. When the SDK re-measures the clock (every 20 s, and after a reconnect) the offset can
move; `core/clock` slews toward the new value over ~1 s and never runs backwards, so traffic
doesn't jump. D-systems are written as **closed-form functions of time** (where is this truck at
t? where is this log at t?), not as integrations, so floating-point drift between browsers
can't build up.

**Seeded streams.** `rng.ts` derives one stream per system from `room.seed` (traffic, hazards,
weather, items, …), so adding a hazard never changes where traffic spawns.

**Design rule that keeps D cheap:** deterministic things don't get pushed around by cars. A log
off a truck follows its own canned path and comes to rest; cars bounce off it or wreck on it,
but can't shove it. The rare thing that must be pushable (a ball in a future mode) becomes a
host entity (H).

## §5 Tracks

### Size and shape

- **Laps of 70–100 s** at race pace (roughly 3.5–5 km), races of 3 laps (4–5 minutes). Short
  layouts (~45 s laps) for Knockout and quick races.
- Each track is a **closed main spline** plus **branch splines** (shortcuts, alternate routes)
  that leave and rejoin it. Progress is always measured on the main spline: a branch maps its
  own distance onto the main one's, so positions stay right while someone takes a shortcut.
- **Every lap should have:** 2–3 shortcuts (at least one risky: a jump, a narrow alley, a
  hazard in the way), a signature takedown spot, a long straight for boost and slipstreams, a
  technical section for drifting, and a traffic-heavy section (oncoming lanes).
- The start grid is 2-wide × 4 rows.
- **Traffic** drives the main spline only, in its lanes, and may change lanes at seeded times
  (still closed-form). It never reacts to players: it can't brake for you. That's what keeps it
  free over the network, and it's also Burnout's traffic.
- **Out of bounds:** kill volumes (water, lava, off a cliff) and a "too far from any spline"
  check wreck you; the respawn goes to the last valid point on whichever spline you were on,
  branches included. A reset button does the same, with a 3 s cooldown.

### Layout format (`<layout>.track.json`)

```jsonc
{
  "id": "city-downtown",
  "main": { "points": [ { "p": [x, y, z], "width": 16, "lanes": 4, "bank": 0, "surface": "asphalt" }, … ] },
  "branches": [ { "id": "alley", "from": 820, "to": 1150, "points": […], "kind": "shortcut" } ],
  "zones":    [ { "s": [1200, 1400], "lateral": [-8, -2], "surface": "dirt" },
                { "s": [2100, 2160], "lateral": [-8, 8], "surface": "puddle", "when": "wet" } ],
  "walls":    { "default": "barrier", "gaps": [ { "s": [3000, 3080], "side": "left" } ] },
  "ramps":    [ { "s": 2500, "height": 2.5, "length": 12 } ],
  "checkpoints": "auto",               // every 1/8 of the main spline, or a list of s
  "traffic":  { "lanes": [ { "offset": -6, "dir": -1, "speed": 24 }, … ], "density": 0.6 },
  "hazards":  [ { "use": "log-truck", "s": [1800, 2600] }, { "use": "lava-bombs", "s": [0, 900] } ],
  "itemBoxes": [ { "s": 600, "lateral": [-6, -2, 2, 6] } ],
  "props":    [ { "kind": "building", "s": 40, "side": 1, "size": [18, 40, 20] }, … ],
  "takedownSpots": [ { "s": 1500, "name": "Pillar" } ]
}
```

Baked at load into: a distance table (`s` ↔ point, tangent, width, height), wall segments,
surface lookup, and ~60 m **chunks** holding static colliders and props for culling. Props are
gameplay boxes in the layout (they block or they don't); skins decide what they look like.

### Surfaces (`surfaces.json`)

One table, used by physics, AI, audio and skins:

| Surface | Grip | Drag | Notes |
|---|---|---|---|
| asphalt | 1.0 | 0 | |
| wet asphalt | 0.75 | 0 | whole road while raining; spray |
| puddle | 0.45 | 0.1 | only when wet; aquaplane wobble |
| dirt / gravel | 0.7 | 0.25 | dust, drift-friendly |
| grass | 0.6 | 0.4 | |
| ice | 0.3 | 0 | mountain pass |
| oil | 0.2 | 0 | dynamic zone (item, spill) |
| lava crust | 0.8 | 0.5 | dynamic zone; wrecks you if you stop on it |
| boost pad | 1.0 | −0.5 | refills a little boost |

Lookup is by zone first (dynamic, then authored), then the spline point's default surface.

### Validation (`tools/validate.ts`, on save and in CI)

Schema check, then gameplay checks: the grid fits the start straight, branches rejoin, widths
never drop below one car's width plus margin, checkpoints are in order and every branch
passes the checkpoints it skips on the main spline (or none sit inside its span), every hazard's range is
on the track, traffic lanes are inside the road, the AI can finish a lap, and the lap time is in
the target range. The fastest AI lap (hard, every shortcut, clear weather) is recorded per
layout as its **lap floor**, used to reject impossible leaderboard times (§10).

## §6 Level editor and the greybox workflow

The point is to design a lap, drive it, change it, and drive it again within seconds, with no
art in the way.

- **Where:** `/editor` in dev builds, served by the Vite dev server. Not shipped to players.
- **Views:** top-down 2D (the whole track, fast to edit) and a 3D greybox preview.
- **Editing:** drag spline points; set width, lanes, height and bank per point; add branches
  by dragging from the main spline; paint surface zones; place ramps, walls and gaps, props,
  item boxes, traffic lanes, hazards (with their range and schedule shown), takedown spots.
- **Drive it:** one key drops a car at the cursor, facing along the track, with the current
  weather and hazards running; another key returns to editing at the same spot. Scrub race
  time to see where hazards and traffic are at any moment (they're functions of time, §4).
- **AI lap report:** the AI drives the layout and reports lap time, average speed, time per
  section and where it crashed, so lap length and difficulty are numbers, not guesses.
- **Saving:** writes the JSON into `content/maps/…` through the dev server; the game hot-reloads
  it; the validator runs and shows problems on the map.
- **Later:** a heatmap of real players' wrecks and slow spots from telemetry (§14).

### Skins

```ts
interface Skin {
  id: string;
  load(map: MapDef): Promise<void>;
  buildChunk(chunk: BakedChunk): Object3D;     // road, walls, props for one chunk
  car(stats: CarClass, paint: Paint): Object3D;
  hazard(kind: string): HazardVisual;          // pieces + telegraph
  traffic(kind: string): InstancedMesh;
  sky(weather: WeatherState, t: number): void;
  post?: PostPass;                             // optional full-screen pass
}
```

- **Greybox** is the default skin in every build until a map has its own: flat shading, one
  color per surface, translucent volumes for checkpoints, triggers, hazard ranges and
  shortcuts. Readable, and fast on any machine.
- **Neon** (the prototype's look) becomes the City skin later; each map gets its own skin in
  the art milestone. Skins can't change gameplay: same colliders, same timings.
- **Dusk is City's signature look**: the prototype's dusk palette (purple-to-orange sky, the
  banded synthwave sun, pink fog, warm lamps, lit windows) is City's default; midnight is its
  rain/night variant. The greybox borrows the dusk sky, fog and lighting from day one (they're
  cheap), so even flat-shaded City feels like City while we build it.

## §7 Hazards, events and weather

Mayhem is a system, not one-off scripts. Every hazard is a **kind** in code and **instances**
in data.

```ts
interface HazardKind {
  id: string;                          // 'log-truck', 'lava-bombs', 'rockfall', …
  schedule: 'periodic' | 'random' | 'trigger' | 'always';
  telegraph: number;                   // seconds of warning before it's dangerous
  // Pure function: what exists at time t since this occurrence started.
  at(occ: Occurrence, t: number, out: HazardFrame): void;  // colliders, zones, visuals
  onContact: 'wreck' | 'bump' | 'surface';
}
```

- **Periodic**: every N s with a seeded offset (a train crossing, a drawbridge, an eruption).
- **Random**: seeded times with a mean interval (a log truck spills, a rockslide).
- **Trigger**: a car drives through a trigger volume → `room.claim('trig:<id>:<n>')` → the
  winner emits `hazard {id, n}` → everyone runs it from `meta.at`. Triggers are designed to
  hit the people *behind* you (knock down a sign, drop a crane's container), which hides the
  round trip and is the Burnout joke.
- **Always**: moving parts that loop (swinging crane, rotating windmill on a jump).
- **Telegraphs** always come first: a shadow where a lava bomb will land, a rumble and dust
  before a rockslide, the truck's straps snapping. Unfair deaths aren't fun.
- **Points:** a rival wrecked by a hazard you triggered counts as your takedown.
- **Lobby option "Mayhem"**: off / normal / chaos (scales frequency and which kinds run).

Hazard kinds for v1 (more with each map):

| Kind | Schedule | What happens |
|---|---|---|
| log-truck | random | a truck in traffic sheds logs that bounce and roll to a stop across lanes |
| lava-bombs | periodic (eruption) | bombs land on shadowed spots, leave lava crust for 10 s |
| rockfall | random / trigger | boulders roll down onto the road from a slope |
| train | periodic | a level crossing with barriers; beat it or wait |
| drawbridge | periodic | the bridge rises: a jump if you're fast, a wall if not |
| falling sign | trigger | the first car past knocks it onto the road behind |
| container drop | trigger | a crane drops a container into one lane |
| oil spill | random | a tanker leaks an oil zone |

**Weather** is a deterministic timeline per race (a D-system): clear / rain / fog / snow per
map, and optionally changing mid-race (rain starts on lap 2). It sets the global grip
multiplier, switches `when: "wet"` zones on, lowers visibility (and AI speed), and tells the
skin what to draw. Lobby option: clear / rain / random.

## §8 Maps

Five maps, each with 1–2 layouts plus a short layout, built greybox first. v1 ships City and
Countryside; the rest follow through the same pipeline.

| Map | Lap | Shortcuts | Hazards | Weather | Signature spot |
|---|---|---|---|---|---|
| **City** (neon downtown at dusk) | ~85 s | alley through a parking garage, rooftop jump off a ramp, subway tunnel | falling sign, oil spill, container drop at the docks edge | clear, rain | the overpass pillars |
| **Countryside** (valley) | ~90 s | dirt track through a barn, field cut across a hairpin, jump over a creek | log-truck, train crossing, rockfall at the quarry | clear, rain, fog | the narrow stone bridge |
| **Volcano island** | ~80 s | lava tube tunnel, a jump over a lava river | lava bombs (eruptions), rockfall, lava crust | clear, ash (fog) | the crater rim |
| **Harbor** | ~75 s | through a warehouse, across moored barges | drawbridge, container drop, swinging cranes, oil spill | clear, rain, fog | the drawbridge |
| **Alpine pass** | ~95 s | frozen lake crossing, avalanche tunnel | rockfall, avalanche (trigger), ice zones | snow, clear | the hairpin switchbacks |

City and Countryside each get a reverse layout early: it's the cheapest way to double the
content.

## §9 Driving, cars and collisions

- **Car model:** arcade, on a plane that follows the road's height (with real air off crests
  and ramps). State: position, heading, velocity (2D + vertical when airborne), yaw rate, boost,
  drift charge, wreck state. Grip comes from surface × weather × car. Drift by button or hard
  steer at speed. Tuned for feel on a controller.
- **Boost:** fills from near misses, oncoming, drafting, air, drifting and takedowns. Drifts
  charge a two-stage mini-turbo. Start boost on "GO". **Catch-up:** fills faster the further
  back you are (off in Time Trial).
- **Drift** is a core mechanic, detailed below.
- **Four cars in v1** (JSON), each a clear pick rather than a small stat difference: top speed,
  acceleration, handling, boost capacity, **weight**. A van shoves a coupe; a coupe out-turns a
  van. Working set: a light coupe (handling), a muscle car (top speed), a hot hatch
  (acceleration, drift), a van (weight, takedowns).
- **Paint:** every car has several coats: a color plus a finish (gloss, metallic, matte, pearl,
  chrome), two-tone on some bodies, underglow color. Rims, a decal and a horn come later. All
  sent as the car's `skin` value; cosmetic only. Greybox skins show the base color, so paint
  works from milestone 1.
- **Wrecks:** the car becomes a simple 3D rigid body for 2–3 s with aftertouch, then respawns
  on the track at the last `s`, facing forward, ghosted (no collisions) for 1.5 s.
- **Collision shapes:** cars are oriented boxes (SAT test); walls are segments; props, hazard
  pieces and traffic are boxes or circles.
- **Response:** impulse along the contact normal scaled by weight ratio, extra lateral push for
  side swipes. Online, each side resolves the contact for its own car from its own view (§10). **Takedown rule** (tunable): the victim wrecks if relative normal speed is over a
  threshold, or it's pushed into a wall/traffic/hazard while being hit, or the attacker is
  boosting. Otherwise it's a bump.
- **Revenge:** whoever took you down last is marked; taking them down is a "Revenge".
- **Items** (not in the current plan; kept here so they can come later as a lobby toggle): boxes at fixed places; oil slick, shockwave, homing
  EMP, shield, full boost; weighted by position.

### Drift

Drifting should be easy to start, satisfying to hold, and worth the risk: the Mario Kart
mini-turbo, Burnout's boost for driving on the edge, and Need for Speed's drift chains.

- **Entry:** hold **Drift** (RB / Shift / a touch button) while steering above ~60 km/h. The
  car does a small hop and kicks its tail out toward the turn. Alternatives in settings:
  brake-tap + steer (NFS style), or drift on handbrake only. Loose surfaces (dirt, wet, ice)
  also break traction on their own.
- **Holding it:** while drifting, the stick sets the **drift angle** inside a band (~15°–50°):
  steer into the turn to tighten, counter-steer to widen. Throttle holds speed; lifting
  tightens the line. A drift assist (settings: full / light / off) keeps the car from spinning
  inside the band; with it off, past ~70° you spin out.
- **Exit:** release Drift to straighten. A hard wall hit or over-rotation ends it in a spin.
- **Payoff:**
  - **Mini-turbo** charges with time × angle × speed in three stages (blue ~0.8 s, orange
    ~1.8 s, pink ~3 s), released as a 0.5 / 1 / 1.5 s boost when the drift ends. The sparks
    under the car show the stage.
  - **Boost meter** fills the whole time you drift (Burnout).
  - **Drift chains** (NFS): drift points multiply when you chain drifts without straightening
    for more than ~1 s, and with near misses mid-drift. A crash loses the chain.
  - **Drift takedown:** side-swiping a rival mid-drift counts as extra weight for the takedown
    rule, so a good drift through a pack is an attack.
- **Per car:** the hatch drifts easiest and charges fastest; the van is heavy and slow to
  rotate; the muscle car drifts wide and fast; the coupe is precise.
- **Surfaces:** dirt and wet are easier to enter and slower to charge; ice is very easy to
  enter and hard to hold; asphalt is the reference.
- **Tracks:** the baker marks corners by radius as drift corners; the AI drifts those (more at
  higher difficulty), and the AI lap report shows time spent drifting per corner, so we can
  see which corners work.
- **Online:** the `drift` flag and `steer` in the car entity are enough for others to predict
  the arc and draw smoke and skid marks locally (skid marks are L).
- **Later:** a **Drift Attack** mode (score run, leaderboard) and drift challenges in the
  single-player ladder.

### Spatial index: grids, not a quadtree

- **Dynamic grid** (spatial hash, ~16 m cells, typed arrays) rebuilt every tick for cars,
  nearby traffic, hazard pieces and projectiles: around 100 similar-sized, always-moving
  things, where an O(n) rebuild with no allocation beats a quadtree's rebalancing.
- **Static grid** baked at load from each chunk's walls and props, never rebuilt.
- **The track's `s`** is a free 1D index: "cars within 50 m along the road" is a window on a
  sorted array (near miss, AI, positions, audio).
- Hidden behind `core/collide/spatial.ts` so a quadtree can replace a grid if a map measures
  worse (very uneven density).
- **Traffic LOD:** only traffic within ~300 m of *any local car* gets posed and put in the grid
  each tick; the rest is a formula nobody evaluates.
- No network "interest management": all 8 cars are needed everywhere (minimap, positions) and
  cost ~8 KB/s.

## §10 Online (net/)

**Shape: players own their cars (O), the host runs AI and race facts (H, S), the world runs
itself (D, T).**

- **Rooms of 8.** One GameRelay room is one party and lives through many races. 8 is inside
  the LAN/relay shortcut's limit, so every pair can use the fastest route.
- **Entity kinds:** `car` (player, 30 Hz): `x, y, z`, `h`, `vx, vy, vz`, `steer`, `throttle`,
  flags `boost`, `drift`, `wrecked`, `ghost`, `skin` value. Sending steering lets prediction
  follow a curve instead of a straight line, which is most of its accuracy in corners. `rival` (host, 30 Hz): AI cars. `projectile`
  (owner, 30 Hz): homing EMPs.
- **State:** `phase` (lobby / countdown / racing / results / vote), `map`, `layout`, `mode`,
  `options` (laps, mayhem, weather, traffic, catch-up, AI fill), `seats` (open / AI + difficulty /
  closed per seat), `ready`, `startAt`,
  `results`, `votes`, `session`. Timers drive the countdown, the race limit, results and vote.
- **Events:** `bump`, `wrecked {by, cause}`, `takedown`, `lap`, `finish {t}`, `traffic_hit`,
  `hazard {id, n}`, `item_use`, `horn`.
- **Remote cars are predicted.** Others are drawn ~100 ms in the past (7 m at 250 km/h).
  `net/predict` takes each car's smoothed state at `room.renderTime` and runs it forward to now
  with a cut-down car model (velocity, steering, the track's surface), blends corrections over
  ~150 ms, and collisions use the predicted pose. The horizon is the SDK's ~100 ms delay
  whatever the ping, so accuracy doesn't fall off on slow connections. It stays in the game:
  how to extrapolate is specific to cars (it knows about steering, drift and the track), so it's
  not an SDK feature.
- **Player-vs-player contact:** each client tests *its own* cars (its player car, plus AI cars
  on the host) against the predicted others and applies the impulse to its own car only. It
  also sends `bump {pair, t, impulse}` to the other owner. The receiver applies a bump only if
  it hasn't seen that contact itself within ±150 ms; otherwise the two views would push twice.
  So a contact both sides see is resolved once on each side, and one only one side saw still
  reaches both cars.
- **Wrecks and credit:** **the victim decides whether it wrecks** (it owns its car) and emits
  `wrecked {by, cause}`, crediting its last contact within 1 s (a car, a hazard someone
  triggered, traffic, a wall). Only the victim emits it, so no claim is needed.
- **Traffic hits:** your car hits a traffic car (D) → `room.claim('traffic:<i>:<epoch>')` →
  the winner emits `traffic_hit {i, epoch, at, impulse}`; everyone overrides that car with a
  local wreck (L) from `at`, and the formula respawns it later. Until the event lands, others
  still see that car driving for a moment; it's cosmetic, and the claim makes sure only one
  wreck happens.
- **AI after a host change:** AI cars are host entities, so the next host carries on writing
  them, but the AI's own memory (its line, its target, its rubber-band) isn't in the entity.
  The AI is written to rebuild that from the car's pose and the track in one tick, so it has
  no hidden state worth losing.
- **Seats are game state, not SDK slots.** The host assigns each joining player a seat in
  `state.seats` (the first open one); the SDK's `slot` isn't used for seats because it doesn't
  know which seats are closed or AI.
- **Finishing:** each client emits `finish {t}` with its server-clock time; the host writes
  results to state (after a sanity check against the lap count and track length).
- **Mid-race joiners** spectate until the next race.
- **Leaderboards:** best lap per layout **from Time Trial only** (clear weather, no traffic or
  hazards, so laps are comparable), rejected below the layout's lap floor (§5); takedowns per
  week; Crash mode scores. GameRelay's leaderboard rules hold the floor server-side.
- **Trust:** a modified client can drive fast or refuse to wreck. Fine for parties; the host's
  finish check catches the lazy cases. Ranked play would need host-simulates-inputs; not v1.

## §11 Menus and the party flow

The game opens **straight into the lobby**, like Counter-Strike's server browser. Everything
works by mouse, touch and controller.

### Main menu = the lobby

```
┌ RACECAR ───────────────────────────────────────────────── [Settings] [ada ✎] ┐
│  [ HOST A PARTY ]   [ QUICK RACE ]   [ SINGLE PLAYER ]   [ JOIN BY CODE ]   │
│                                                                              │
│  PARTIES                                    filter: [all modes ▾] [open ▾]   │
│  ─────────────────────────────────────────────────────────────────────────── │
│  🔓 ada's party          City · Race · 3 laps      racing L2   7/8   [Watch] │
│  🔓 Friday wrecks        Countryside · Takedown    in lobby    4/8   [Join]  │
│  🔒 kev + friends        Harbor · Knockout         in lobby    6/8   locked  │
│                                                   [Garage]      31 online    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **The list:** name, map, mode, phase (in lobby / racing with lap), players / 8, locked.
  Refreshes every few seconds while visible. Full and locked parties stay listed, greyed out.
- **Host a party:** name, public or private (invite link only), mode, map.
- **Quick race:** the fullest open public party in its lobby phase, or host one.
- **Single player** (§12), **Join by code**, **Garage** (car, paint), inline name edit.

### Party screen (between races)

- **Seats, Civilization-style:** 8 seats, each one **Open** (a player can join), **AI** (an AI
  driver, with a difficulty: easy / normal / hard), or **Closed** (empty, nobody can join). The
  host sets each seat from its row; a player's seat shows name, car, ready, ping and a host
  crown. Closing seats makes a smaller party (a 1v1 with two open seats and six closed). A
  player who joins takes the first open seat; AI seats stay AI unless the host opens them.
  Defaults: 8 open, and when the race starts, open seats nobody took are filled by AI (the
  host can turn that off).
- **Host:** map, layout, mode and options; **lock**; **public/private**; **kick** (optionally
  banned from this party); **pass host**; **start** (when all ready, or force after 10 s).
- **Everyone:** ready, change car, **share** (`room.shareInvite()` plus the code on screen),
  chat, leave. A session scoreboard across races.

### After a race: results → vote → next race

1. **Results** (10 s): order, best lap, takedowns, "most wrecked", photo-finish replay, points.
2. **Vote** (15 s): three cards (map + layout + mode) plus "random", drawn from the host's pool
  (everything, or this mode only). One vote each, changeable until the timer ends; ties broken
  with `room.seed`. The host can skip and pick.
3. **Next race** starts on its own; anyone not ready spectates one race.

Votes are `room.request('vote', …)` to the host, tallied in state (survives a host change).

### Settings

- **Graphics:** skin (greybox / map skin), quality preset (auto / low / med / high),
  resolution scale, outlines, post FX, motion blur, FPS cap, show FPS.
- **Controls:** remap keyboard and gamepad, steering sensitivity and dead zone, rumble,
  auto-accelerate (touch).
- **Audio:** master, music, SFX, engine.
- **Gameplay:** units, camera distance and FOV, HUD scale, minimap.
- **Accessibility:** reduced motion (softer shake, blur, flashes), colorblind-safe HUD, larger
  text.
- **Network:** net overlay.

Saved in localStorage; in GameRelay player data too for signed-in players.

### Platform asks (build in GameRelay, not in the game)

| Need | Today | Ask |
|---|---|---|
| **Must have for milestone 3:** | | |
| Host kicks a player | only the game owner, with the secret key | `room.kick(playerId, { ban })`, host only, server-enforced |
| Lock a party | `public` set at creation only | `room.setAccess({ locked, public })`, host only; joins fail with `locked` |
| Server browser rows | code, players, max, tag | `room.setListing({ name, meta })` (small JSON: map, mode, phase, lap), in `listRooms` |
| Show full/locked parties | `listRooms` hides full rooms | `listRooms(tag, { includeFull: true })` with a `locked` flag |
| Close seats | `maxPlayers` set at creation only | `room.setAccess({ maxPlayers })`, host only, not below the players in the room; listings show open seats |
| **Nice to have:** | | |
| Online count | none | players online for the instance (cached) |
| Pass host | host changes only on leave/freeze | `room.transferHost(playerId)` |
| **Later:** | | |
| Spectators | a watcher takes one of the 8 seats | a spectator role: joins without a seat, can't own entities, doesn't count toward `maxPlayers` |

Each is a normal GameRelay change (server, SDK, docs, tests), built in the gamerelay repo during
milestone 2 so they're released before milestone 3 needs them; `setAccess` covers lock,
public and seats in one call. Until one lands, the game shows that control disabled rather than
faking it. Until spectators exist, "Watch" only works on a party with a free seat, and a
watcher gives the seat back when the next race starts if a player wants it.

## §12 Modes and single player

```ts
interface Mode {
  id: string;
  players: [min: number, max: number];
  options: ModeOption[];                   // laps, time limit, mayhem, weather…
  setup(ctx: ModeContext): void;           // grid, rules, timers
  onEvent(ev: GameEvent, ctx): void;       // reads the event queue
  standings(ctx): Standing[];
  isOver(ctx): boolean;
  hud: HudWidget[];
}
```

| Mode | Players | Idea | Milestone |
|---|---|---|---|
| **Race** | 1–8 (+AI) | 3 laps, traffic, hazards, takedowns refill boost | 2 |
| **Takedown** | 2–8 | 3 min on the circuit, most takedowns wins; being wrecked costs points | 4 |
| **Knockout** | 3–8 | last place at each lap's end is out (short layouts) | 4 |
| **Time trial** | 1 | no traffic or hazards, best lap, ghost, leaderboard | 4 |
| **Pursuit** | 4–8 | teams: racers vs. cops; cops win by wrecking every racer before the timer | 6 |
| **Crash mode** | 1–8 | one run each into a junction full of traffic; biggest pile-up | 6 |
| **Drift attack** | 1–8 | a timed run, drift points only; leaderboard per layout | 6 |

Crash mode is the one place traffic must react (a pile-up is traffic crashing into
traffic), which closed-form traffic can't do. Each run is simulated locally by the player
making it, like a turn, and everyone else watches a replay of it; only the score and the
replay's inputs go over the network. No new sync category needed.

**Single player:** the same modes offline against AI (`net/` not loaded), plus a challenge
ladder per map (win a race, 10 takedowns, beat a lap time) with 1–3 stars saved locally. Rewind
and photo mode in single player only.

## §13 Input, camera, audio

- **Controls** (`steer, throttle, brake, boost, drift, item, lookBack, reset, horn, pause`) from:
  - **Gamepad API**, standard mapping: analog stick and triggers, dead zones, hot-plug, rumble
    (`vibrationActuator`), Xbox / PlayStation / Switch prompts.
  - Keyboard (WASD/arrows, Space boost, Shift drift, E item) with steering smoothing.
  - Touch: tilt or on-screen buttons, auto-accelerate option.
- **Mobile, without costing desktop.** Phones get additions, never a smaller desktop game:
  a touch layer, the low quality tier, a HUD layout for small screens. No gameplay, map or
  effect is cut or simplified for everyone to suit phones; if something can't run on a phone,
  the phone gets a lighter version of it. Phones are tested every milestone, but desktop with
  keyboard or controller decides every trade-off.
- **Menus by controller:** a focus system over the DOM (stick/d-pad moves by position, A
  selects, B backs, bumpers switch tabs). Every screen is tested controller-only.
- **Split-screen** (2 local players) later; `Controls` and camera are already per player.
- **Camera:** chase cam with speed FOV and boost pull-back, shake, look-back, wreck orbit cam,
  photo-finish replay from a state ring buffer.
- **Audio:** Web Audio engine synth (pitch by rpm), tire squeal by surface, impacts, boost,
  hazard cues (every telegraph has a sound), music ducked in slow-mo.

## §14 Network calibration

- **Net overlay** (`?net=1`): RTT, route (server / LAN / relay), entity age, prediction error
  (m), bytes in/out, dropped updates, clock offset, per remote car.
- **Telemetry**: see "Telemetry pipe" below.
- **Bots** (`tools/bots/`): headless Bun clients running `core/ai` on real layouts in real rooms:
  load tests, relay soak tests (Resonance), SDK release regression, and a lively lobby for demos.
- CI scenarios with `simulate: { latency, jitter, loss }`: prediction error under 1 m at 150 ms
  RTT; D-systems agree across two clients to within 0.2 m.

### Telemetry pipe

We need to know how the game actually plays while we build it, in a form Claude can read
directly and the team can query. One module, `src/telemetry/`, three destinations:

| Where | When | Sink | How we read it |
|---|---|---|---|
| **Local files** | every dev build, from milestone 1 | the Vite dev server takes `POST /__telemetry` and appends to `telemetry/<date>/<session>.jsonl` (gitignored) | Claude reads the files straight from the repo; `bun tools/telemetry.ts` summarizes them (lap times, wrecks by spot, drift stats, frame times) |
| **PostHog** | playtest and production builds, from milestone 2 | batched events to a racecar PostHog project (anonymous id, opt-out in settings) | SQL over the events (Claude has PostHog access), dashboards for the team |
| **GameRelay** | later, if it earns it | a "game events" feature for every customer (a platform ask) | the account MCP, like logs today |

- **Events** (small, typed, versioned): `session` (build, device, GPU tier, input device),
  `perf` every 5 s (fps, frame ms p50/p95, sim ms, draw calls), `race` (map, layout, mode,
  options, players, AI, result), `lap` (time, sections, shortcuts taken), `wreck` (where by
  `s`, cause, speed), `drift` (entry, duration, angle, stage, spin-out), `contact`,
  `net` every 5 s (RTT, route, prediction error, corrections, bytes), `error` (uncaught
  exceptions with stack).
- **Local files get more**: full per-tick traces of your own car on demand (`?trace=1`) for
  tuning handling, too big to send anywhere else.
- **"Something felt wrong" key** (F8 / Select+Start): saves the last 30 s: telemetry, the
  state ring buffer, your inputs, the seed and the layout version. In dev it lands in
  `telemetry/reports/` with a one-line note you type; in playtests it uploads to PostHog as a
  report. Since the sim runs from inputs and the seed, `bun tools/replay.ts <report>`
  re-runs the moment headless (same JS engine: exact; across engines: close), so a bug or a
  handling complaint can be reproduced and stepped through instead of guessed at.
- **Budget**: telemetry never runs in the tick; it reads the event queue after the frame and
  batches (PostHog: at most one request every 10 s, plus on page hide).
- The editor heatmap (§6) reads the same `wreck`/`lap` events.

## §15 Performance budgets

| Budget | Target |
|---|---|
| Frame | 60 fps mid laptop (integrated GPU), 60 fps 2021 phone at medium, 8 cars + traffic on screen |
| Draw calls | < 250 per frame |
| Sim tick | < 2 ms for 8 cars + nearby traffic + hazards; zero allocation after warm-up |
| JS | < 200 KB gzipped game code, Three.js separate; menus load before Three.js |
| Load | lobby < 2 s, first race < 3 s on 20 Mbps; maps lazy-loaded |
| Network | < 12 KB/s down, < 3 KB/s up per player in a full race |

How: instancing for traffic, props and hazard pieces; one merged mesh per chunk; chunk culling
by distance and frustum; quality tiers and dynamic resolution; screen-space outlines measured
against inverted hulls when skins land; CI fails on sim-time, draw-call and bundle regressions.

## §16 Milestones

Greybox until 3b (City) and 5 (the rest). Each milestone ends deployed and playable.

1. **Sandbox**: repo, `core` skeleton (clock, pools, events, sim pipeline), track format +
   baking + validator, greybox skin, car physics (drift, boost, air, wrecks), OBB collisions,
   gamepad and keyboard, editor v0 (edit spline + widths, drive it), the drift model with
   mini-turbo, local telemetry files and the F8 report. One City layout under the dusk sky.
2. **The world**: surfaces and weather, traffic (closed-form + LOD), hazards framework with
   log-truck and falling sign, AI drivers and the AI lap report, laps/positions/scoring,
   single-player Race vs AI. City fully laid out; Countryside blocked in. PostHog telemetry
   for playtest builds; replaying reports headless. Alongside, in the
   gamerelay repo: the must-have platform asks, released in an SDK alpha.
3. **Online**: lobby list, host/join/quick race, party screen, `net/` (cars, prediction, bumps,
   takedowns, triggers, traffic hits), countdown on the race clock, results, vote, next race,
   net overlay, bots. **Repo goes public** (open source), but we don't promote it yet.
   **3b. City gets the neon skin**: the prototype's look already exists, so porting it onto the
   City layout is cheap, and it's what people see first. **This is the launch**: the first build
   we show off.
4. **Modes and content**: Takedown, Knockout, Time trial; car classes; Countryside finished;
   reverse layouts; train, rockfall, oil spill; leaderboards; challenge ladder.
5. **Skins and polish**: Countryside skin, audio, garage and paint screens, settings complete,
   controller navigation everywhere, perf tiers.
6. **More**: Volcano, Harbor, Alpine (greybox → skin), Pursuit, Crash mode, landing page. Items only if we decide we want them.

## §17 Decisions

What we've settled, so nobody re-argues it. Changing one is fine; say so here.

| Question | Decision |
|---|---|
| Repo | `gamerelay/racecar`, private until milestone 3, then public, MIT |
| Name and title | **racecar** |
| Players per room | **8** (fits the LAN/relay shortcut; the grid is 2 × 4) |
| Graphics | greybox first; skins are a separate layer and milestone (§6) |
| Level design | our own in-browser editor over JSON tracks; no external tools (Blender etc.) needed |
| Lap length | 70–100 s, 3 laps default; short layouts ~45 s |
| Network shape | players own cars; host owns AI and race facts; the world is `f(seed, raceTime)` |
| Who decides a wreck | the victim (it owns its car); takedown credit by `room.claim` |
| Remote cars | predicted in `net/`; stays in the game (car-specific), not an SDK feature |
| Sim / send rate | sim 60 Hz; cars sent at 30 Hz |
| Spatial index | uniform grids (dynamic + static) + `s` index; quadtree only if measured better |
| Hazards | kinds in code, instances in JSON; periodic / random / trigger / always; always telegraphed |
| Mayhem, weather | lobby options: Mayhem off / normal (default) / chaos; weather clear / rain / random (default random) |
| Items | **left out for now**; the design (§9) stays so they can come later as a lobby toggle |
| Seats | Civilization-style: each of 8 seats Open / AI (easy, normal, hard) / Closed; unfilled open seats become AI at the start (host can turn off) |
| Lobby list | one list with a mode filter (split into tabs only if it gets crowded) |
| Missing SDK features | built into GameRelay (§11), never faked in the game |
| Trust | party-grade; host sanity-checks finishes; ranked is out of scope |
| Maps | City, Countryside (v1), then Volcano, Harbor, Alpine |
| Cars | 4 in v1 (coupe, muscle, hatch, van), several paint coats each (color + finish) |
| Laps | 3 by default |
| Mobile | supported as long as it takes nothing from desktop (§13) |
| Hosting | `racecar.gamerelay.io`, static files |
| GameRelay account | racecar is a normal instance on a paid plan (dogfooding billing and limits); bots run on a separate instance so load tests don't eat players' capacity |
| Launch | after 3b: online City race with the neon skin. The repo is public from 3, but promoted at 3b |
| Wreck slow-mo online | the wreck itself runs slow for everyone; the world doesn't slow |
| Contacts | each owner resolves its own car; bumps deduped within ±150 ms |
| Leaderboard laps | Time Trial only, above the layout's AI lap floor |
| City look | dusk (the prototype's palette) by default, midnight for rain/night; greybox uses the dusk sky from day one |
| Drift | hold-to-drift with a small hop, angle band set by the stick, 3-stage mini-turbo, drift chains, assist setting (§9) |
| Telemetry | local JSONL files in dev (Claude reads them directly), PostHog for playtests, F8 reports replayable headless (§14) |

Still open, and fine to leave open until they matter:

- The exact takedown and boost numbers: tuned in milestones 1–2 with the AI lap report and
  playtests, not decided on paper.
- Whether split-screen is worth it: revisit after milestone 5.

## Changed while building

Milestone 1 (2026-09-30):

- **Walls are tested by lateral distance on the car's current spline**, not a list of wall
  segments: the wall is where the shoulder ends, a car's reach is its box's lateral extent at its
  angle to the road. Same result, far cheaper. Segments come back for props in milestone 2.
- **Near a junction a car is on whichever road it's more inside of**, with hysteresis, and no
  wall applies while it's inside both (`core/track/locate.ts`). Branch ends are glued to the main
  road by the baker, and the main road's wall opens automatically on the branch's side.
- **Auto checkpoints step past shortcuts**, so no branch can skip one (the validator caught the
  first City layout doing exactly that).
- **Distance-anchored things re-anchor on edit** (`core/track/anchor.ts`): moving an early point
  changes every distance after it, so branch ends, ramps, zones, gaps and props are moved back to
  where they were in the world. Without it, the alley jumped when the boulevard moved.
- **Drift arc range widened** to 0.15–1.25 rad/s: with a narrower range, even full counter-steer
  circled at ~108 m, too tight to drift a fast sweeper.
- **Replays across JS engines are close, not exact**: an F8 report from Chrome replayed in Bun
  ended 1.6 cm off after 30 s (trig functions differ in the last bits). Same engine is exact.
  Good enough to debug a moment; worth knowing before trusting a replay for minutes.
- **Milestone 1's "AI" is a pace car** (`core/ai/follow.ts`): lane-following pure pursuit with
  corner slowdown and a stuck reset. The real AI builds on it in milestone 2.
- **A dev hook** (`window.__rc.advance(seconds, controls)`) steps the sim and renders a frame,
  so tests and Claude can drive the game even in a background tab where requestAnimationFrame
  doesn't run.
- The greybox City draws in 20–110 calls, well under the 250 budget; a tick with 9 cars is under
  0.5 ms in Bun.

Milestone 2 (2026-09-30):

- **Traffic sections start and end on straights.** Traffic pops in where its section starts
  and out where it ends; oncoming traffic pops in at the end, driving at you. Every section on
  both maps ended in a corner, which made blind pop-in head-ons the biggest cause of wrecks. The
  validator now warns about a section ending in a corner, and `straightenSections` (in the City
  generator, and `bun tools/fix-traffic.ts <layout>`) slides the ends onto straights. AI wrecks
  per 8-car race over 8 seeds: City 7 to 0.5, Countryside 13 to 4.8. The tunnel's section was too
  short to keep.
- **Traffic in the car style.** Each traffic kind (sedan, compact, van, box truck, bus) is one
  merged mesh, built from a side profile like the racers (arches, glass, bumpers, wheels, lamps).
  A kind is one instanced draw however many are posed. A vertex mask picks which parts take the
  instance's paint and which glow (lamps), and lamp glow sprites go on posed traffic. Wreck
  debris, and the city's parked and background cars, use the same models. The garage
  (`cars.html`) shows them all with T.
- **Rain shows on the road.** A screen-space reflection pass (in the post pass, from the depth
  buffer) gives every flat surface a wet sheen, smeared into vertical streaks like wet asphalt.
  Puddles are sharp mirrors. The puddle zones were slippery but invisible; now they're drawn as
  dark water, and each one clears the render target's alpha where it's drawn, which the post pass
  reads as "mirror here". So a mirror always means low grip. Bridges now have a low barrier with a
  steel railing on top (collision unchanged), so you can see over the Skyway's edge.
- **City v2: smaller, wider, and in three dimensions** (playtest: "some parts feel empty",
  "make the maps 1/4 smaller", "play with verticality"). Downtown is 3.26 km (was 4.3). Roads are
  wider: 26 m for the Boulevard, 20 m for avenues and the Skyway, 17 m in the Market. The lap
  climbs onto the Skyway, 12 m up, which crosses over the start Boulevard. It drops to street
  level for the Market (a hump bridge and the Alley shortcut), then into a trench and a covered
  tunnel, and comes out over a crest just before the line. A lap that crosses itself needed three
  engine changes: whole-track searches (spawn, teleport, reanchor) weigh height, solid props only
  touch cars at their own level, and the validator rejects roads that overlap with under 7 m of
  headroom. Per-tick tracking was already height-safe, since it follows each car's own spline.
  The oncoming bonus now only counts where that lane has traffic; before, the empty Market's left
  lane was free boost.
- **The city is scenery built from the track, not authored.** A street grid fills the fog
  distance around the lap, with blocks and lots kept clear of every road and further back from
  raised ones so the Skyway has a view. Buildings are sized by district: towers with setbacks
  round the middle of the lap, low shops wherever the streets are narrow (the Market). Roofs carry
  clutter, water towers, masts and blinking lights. Buildings near the road get neon blade signs,
  billboards and awnings. The side streets have lamps, trees, parked cars and ambient traffic,
  and a few manholes steam; searchlights sweep the sky. Raised roads render as decks on pillars,
  sunken ones as trenches with retaining walls, and deep ones as a lit tunnel with neon strips.
  All of it is instanced (about 40 draw calls), the same every race, and animated by a few
  uniforms and one instance buffer (the ambient cars).
- **Playtest tuning, first round.** Drift is now only a better way round a corner: no charge,
  no mini-turbo on release, no boost from drifting (`miniTurbo: false` keeps the code for later),
  less scrub so it keeps its speed, and harder to trigger by accident (more steer to enter, a
  smaller hop, a slower angle settle). Less boost: every source roughly halved, a takedown gives
  half a bar instead of a full one, and races start at 0.2. Tougher cars: a wreck takes 25 m/s
  into a wall (was 19), 21 closing on traffic (was 16), 16 from a rival (was 13, 9 boosting).
  Across six seeds, AI wrecks per 8-car race fell on Countryside (15.8 to 10.5) and hardly moved
  on City (22 to 21), where nearly all of them are head-ons with traffic, which still wreck by
  design. The chase camera sits closer and pulls back and widens much less with speed and boost.
- **The greybox got the prototype's cel look early** (asked for in playtesting): a three-step
  toon ramp on every lit surface, ink outlines, lit windows and street lamps in City, and glow
  on head and tail lights with a headlight beam on the road. Outlines are drawn in the post pass
  from the depth buffer (the Laplacian of 1/z, which is zero across any flat face), not with
  the prototype's inverted hulls, so instanced traffic, merged road chunks and city blocks all
  get them with no extra draw calls; F6 or `&ink=0` turns them off. Windows are computed in the
  shader from world position, so the instanced blocks need no UVs. City's draw calls barely
  move (lamps and windows are about five for the lap).
- **Traffic lives in sections, not the whole lap.** With traffic everywhere, the AI (and
  anyone) hit head-ons in every narrow two-way hairpin: carrying speed through one puts you on
  the inside, which is the oncoming lane. Lanes now take `sections` (distance ranges on the
  main spline), which is what §5 already said a lap wants ("a traffic-heavy section"). Sections
  also stay off blind crests: landing into traffic you couldn't see isn't fair. Traffic outside
  its sections is simply absent (still a pure function of seed and time).
- **The AI steers by path tracking, not pure pursuit.** Pure pursuit aims at a point ahead and
  cuts every corner, straight into the oncoming lane. A Stanley-style controller (match the
  road's heading and curvature ahead, steer out the sideways error) follows the line.
- **The AI judges threats by time to contact, over seven candidate lines**, including the lines
  it must cross to get to one, and commits to a choice for 0.8 s (without that it dithered
  between gaps until it hit something). The committed line is in the car pool (`aiLat`,
  `aiHold`), so it's snapshotted; a host change that loses it only costs one decision.
  Result in a full 8-AI race: City from ~75 wrecks to ~8, Countryside from ~65 to ~16.
- **Checkpoints stepped off a shortcut are de-duplicated**, and progress counts every checkpoint
  a car passes in one tick: two checkpoints landing past the same shortcut made every lap take
  two trips round (found by the AI lap report: "lap 160 s").
- **Hazards schedule "starts in the future"** as §4 said, and triggered occurrences are part of
  the snapshot. A full race (AI, traffic, chaos hazards, random weather) replays exactly from a
  mid-race snapshot (test/world.test.ts).
- **Zero allocation holds for the full world** (8 AI, traffic, chaos, rain): 0.025 ms a tick in
  Bun. The first version allocated ~480 bytes a tick (forEach closures and small arrays in the
  hazard and traffic checks); the allocation test now runs the full world.
- **Race phases are in the sim** (`startRace`, countdown, start boost / stall, finish order),
  since they change how cars move; the race UI reads them.
- **AI drifting is left for later**: the AI takes corners on grip. Drifting AI needs the drift
  controller tuned against the lap report; not needed for a good race yet.
- **Countryside laps are short**: the AI floor is 62 s (people ~70 s). Worth lengthening in the
  editor before skins; `tools/validate.ts --ai` warns below 55 s.
- **Single player has a setup screen over an attract mode** (an AI race behind the menu), and
  the setup lives in the URL, so every race is a clean start and a shareable link. The lobby
  replaces the setup screen in milestone 3.
- **PostHog is wired but off**: it needs `VITE_POSTHOG_KEY` (a racecar project) at build time.
- **The platform asks are built** in GameRelay PR #30 (host kick, lock, `setAccess`,
  `setListing`, `listRooms(includeFull)`, plus `transferHost` and `online()`), not yet merged,
  deployed or released.

Car art (branch `car-models`, 2026-09-30):

- **Greybox cars are built from side profiles, not boxes** (`render/skins/greybox/car/`): each
  class's design is a side outline extruded with chamfers, arches and a plan-view pinch, plus
  per-class rear detail (the chase camera's view), a finish-aware toon paint (gloss, metallic,
  pearl, matte, chrome) and a livery in the shader. Static parts merge per material, ~25 draws a
  car. `cars.html` is a garage for working on them (old vs new, all views, wreck test).
- **Cars get a second ink pass** (`render/ink.ts`): marked meshes render a part id and normal,
  and the post pass inks id changes and sharp creases, which depth alone never sees (windows,
  lamps, lids, door cuts as ink-only seams). One draw per near car mesh, only with ink on.
- **Wrecks are visible on the car** (SPEC §9), all cosmetic: the body crumples toward the hit,
  lids spring open or tear off, wing, mirrors, plate, splitter and sometimes a wheel fly off,
  glass cracks and shards spray. The renderer infers where the car was hit (the other car, or
  the nose for walls) from the Wreck event, so the sim is unchanged; `repair()` on Respawn.
