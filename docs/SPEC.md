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
  A later playtest asked for closer still, for immersion: 4.7 m back and 1.85 m up (was 5.9 and
  2.35), with a 60° base FOV (was 62°). It then got tugged back under acceleration: it chased a
  world point, which lags by about speed ÷ rate (~5 m at 180 km/h). It now follows in the car's
  frame with only the distance smoothed, so the gap stays 4.7–5.5 m at any speed, and the speed and
  boost FOV widen less (+4° and +3.5°).
- **Drift smoothed, and the slide carries after release** (playtest: "too snappy… carry sideways
  momentum, especially after releasing"). Before, letting go took a 50° slide to straight in under
  0.1 s. Now:
  - The drift angle builds and settles smoothly, and steering changes the tightness gradually.
  - For 1.1 s after release, grip comes back from 5% of normal.
  - The nose also swings back toward the direction of travel, so the car keeps going the way the
    slide was taking it. The slide straightens in 0.5–0.6 s without losing speed.
  - The numbers are in TUNING (`driftEase`, `driftSteerRate`, `driftExit*`) and can be changed live
    with F4. The AI doesn't drift, so its lap floors are unchanged.
- **Drift boost is back, as a bank** (playtest: "add back drift for boost"). The earlier
  complaint was the kick after release. Now:
  - A drift banks boost as it goes, by angle, speed, surface and the car's `drift` rating. It shows
    as a pale segment past the boost meter's fill.
  - A clean release pays the bank into the meter with a "Drift boost +N%" pop.
  - A spin-out or wreck loses the bank, and a tap-drift earns nothing (`driftBankMin`).
  - There's still no mini-turbo. A 1.5 s full drift at speed banks 9–17% of a bar, depending on
    the car.
- **Countryside v2: tighter, higher, mostly dirt, on real land** (playtest: give it "the same
  treatment" as City, with "a lot of dirt roads, jumps, shortcuts and other small map details",
  more verticality, and a focus on "tight corners, drifting, dirt roads, jumps"). The Valley is
  now 2.88 km (was 3.79), and the AI's floor is 68 s because the corners are tight.
  - **The lap:** the village on asphalt; a covered bridge; dirt switchbacks, four hairpins and
    45 m of climb; a ridge with two kickers on crests; asphalt S-bends down to a trestle 27 m over
    the river and the start road; dirt hairpins through Pine Hollow.
  - **Three shortcuts:** the Barn, Logger's Leap (a jump off the ridge) and the Creek Bed (a wet
    ford, then a drop onto the run home).
  - **Land:** open-country layouts get real terrain in the skin (`terrain.ts`, scenery only). It
    meets every road at its edges, rises into hills and mountains toward the map's edge, and has
    a `terrain.river` carved in.
    - Roads that cross the river or another road are left out of the land's shape, so they become
      bridges: covered if short, timber trestles if long and high.
    - A headless test holds the land below every road's surface.
  - **The forest and the village are built from the track** (`forest.ts`), like the city is.
    Everything that moves is animated in the shader. Houses, the barn and the lookout aren't solid
    (the city's blocks sit behind walls).
  - **Surfaces:** dirt roads get ruts instead of paint, and grass verges; walls in the country are
    timber guardrails. Cars kick up dust on dirt and clods off grass.
  - **Water mirrors in any weather.** The post pass mirrors wherever alpha is cleared when the
    scene has water (`uWater`), not only in the rain.
- **Review before `alpha-1.0`** (fixes, not design changes):
  - **Traffic and AI:**
    - Traffic is drawn at the render time, between ticks like the cars, using `Traffic.poseAt`,
      which is pure and doesn't touch the sim's pool.
    - The AI now sees cars and pillars across the start/finish seam (`signedGap`, now shared by
      every loop-distance check).
  - **Leaks and replays:**
    - An editor rebuild frees instanced buffers and rebuilds the world visual.
    - Restoring a snapshot doesn't re-fire hazard telegraphs.
    - `placeCar` clears transient driving state.
  - **Attract mode:** the player's input and rumble no longer reach AI car 0.
  - **Performance:** the AI no longer allocates closures each tick. The HUD writes only what
    changed, the minimap's roads are drawn once, and ambient city cars move as a function of
    time, posed only near the camera.
  - **Drift details:**
    - Tire smoke continues through the slide after a drift.
    - The "Drift boost" pop shows what was actually added to the meter.
- **Each car carries its slide differently** (`driftCarry` in the car file). It stretches the
  release grip, looseness and straightening. A 50° slide straightens in:
  - 0.37 s on the hatch (quick),
  - 0.48 s on the coupe,
  - 0.65 s on the van,
  - 0.72 s on the muscle car (long and lazy).
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
- **Sedan, bus and rally designs** (branch `car-variety`): a three-box sedan, a 10.4 m city bus
  and a jacked-up rally hatch, in the same style as the first four.

Polish (2026-09-30):

- **Rain stops under cover**: the track visual reports where roads are roofed (the City tunnel,
  every bridge deck) and the rain skips drops beneath it.
- **The speedometer reads mph on a dial** scaled to the car's boosted top speed; the range only
  boost reaches is marked pink. A "✕ Menu" button quits to the main menu from any race.
- **Drifts bank more boost** (`boostFromDrift` 0.1 → 0.18 a second at full angle and pace).
- **Catch-up boost on respawn**: a wreck in a race pays 10% of a bar, plus up to 50% more
  by how far behind the leader you are (full at 400 m), for AI and people alike. A manual reset
  pays nothing, so resetting isn't a way to farm boost. The Respawn event carries the amount; the
  HUD pops it.

Seven cars (2026-09-30):

- **Sedan, rally and bus are player and AI classes** (Cruiser, Mudlark, Route 88), from the
  `car-variety` designs. Race traffic draws a kind with a racer design as that car (sedan, van,
  bus, and the compact as the hatch), flattened to one instanced mesh per material and ink id;
  the box truck and the city's ambient cars keep the cheap one-draw models from `car/traffic.ts`.
- **Cars are balanced by the lap report**, not by feel alone: `bun tools/lap-report.ts --cars`
  runs a hard AI lap in every class on every layout and prints each against the mean, plus
  0–100 km/h. Every class is within ±5% on both layouts (`test/cars.test.ts` holds it); the
  rally car's dirt edge on the Valley (about −5%) is the one allowed outlier, bounded at ±7%.
  The AI laps on grip, so drift stats don't show in these numbers: they're tuned by hand.
- **Each car has a job**, said in one line on the picker (`blurb`): coupe all-rounder, muscle top
  speed, hatch nimble and quick off the line, van heavy hauler, sedan boost car (biggest light
  meter, fastest drift bank), rally dirt specialist, bus wrecking ball (6 t, 5.5 s of boost).
- **`offroad` (0–1) is a new class stat**: how much of dirt and grass's lost grip and extra drag a
  car shrugs off. Rally 0.25, van and bus 0.3 (the van's is why it keeps up on the Valley).
- **Very long cars lift the chase camera** and look further ahead, so the bus's roof doesn't
  hide the road.

Traffic that doesn't pop (2026-09-30):

- **Traffic fades instead of popping.** Measured first (three AI races a layout, cars within
  160 m of the leader): the City had 31 pops, 24 at lane-section edges (often 10–20 m away) and
  7 at the start grid's clear zone; the Valley's were cars near in a straight line but over
  350 m away by road, so never posed. Now a car's visibility (0–1) is part of the traffic formula
  (`Traffic.visibility`): it fades in over 45 m of road before its section, out over 45 m after,
  out of and back into the grid's clear zone, and back over a second after a wreck. Only fully
  visible cars are solid (collisions, near misses, the AI), so the sections play as before.
  Measured again: 0 pops.
- **The renderer draws traffic near the camera, not the sim's pool**: every car within 500 m
  with any visibility, the fading ones through a see-through copy of each part (`render/fade.ts`:
  opacity per instance, no depth write). A screen-door dither was tried first: the depth outlines
  ink every dithered pixel, so a fading car went solid black.
- **The sim's pool also takes cars within 250 m in a straight line** of a racer, for laps that
  fold back or cross.

Audio (2026-09-30):

- **All synthesized on Web Audio, no samples** (`src/audio/`): `model.ts` is the pure part
  (tested: a fake gearbox from speed to revs with a drop at each shift, pitch per class, pan and
  distance falloff, Doppler), `synth.ts` the voices and one-shots, `music.ts` a small sequencer,
  `audio.ts` the mix.
- **What plays:** the focus car's engine (three oscillators through a low-pass that opens with
  throttle; the revs climb free in the air), asphalt squeal by slip, gravel on dirt and grass,
  wind with speed, a boost roar, the horn (H); the three nearest rivals' engines, panned and
  Doppler-shifted; one-shots from events (hits by impact speed, wrecks with glass, landings,
  boost, drift-boost and mini-turbo chimes, near-miss whoosh and horn, traffic checks, takedown
  stinger, spin-outs, a two-tone alert for every hazard telegraph, countdown beeps and GO, lap and
  final-lap chimes, a finish fanfare, the catch-up chime).
- **Music:** Am–F–C–G synthwave at 112 bpm, scheduled on the audio clock. Pad and bass behind the
  menu (muffled), drums and arp in a race, the arp up an octave on the final lap, muffled in
  slow-mo.
- **Starts on the first key or click** (browsers' rule), suspends when paused, hidden or in the
  editor. M mutes, N toggles music, remembered on the device.

Review pass (2026-09-30), four parallel reviews (core, track and AI, render, UI), each finding
checked before fixing, each fix with a test that fails without it:

- **Rules:** lap times are world time (slow-mo inflated every lap); a wall-cancelled drift can't
  restart next tick; finished cars rank by place; same-tick finishes by who crossed first;
  checkpoints on the line are dropped; `startRace` clamps laps and resets slow-mo; `placeCar`
  clears every transient.
- **AI:** cars can reverse from rest; a pinned AI backs out before resetting; obstacles are
  measured from its nose; it watches the road it's on, not the shortcut it picked. Valley resets:
  11 in 12 seeds to 0. Triggers fire only from the main road (shortcut cars dropped the sign).
- **Render:** the wet mirror no longer breaks under additive glows; old traffic meshes leave the
  ink registry; the world stops when paused; the camera stays outside every car
  (`render/camera.ts`); shader patches throw on a missing chunk (`render/shader.ts`).
- **UI:** menus work by pad and arrows (`ui/nav.ts`); URL setups are validated; results are
  live with the fastest lap; lap pops show deltas; small screens don't overlap.

Valley v3 and smooth shortcut joins (2026-09-30), from play feedback: the city's wide roads,
gradients and tunnel work; the Valley wanted more corners to lean a drift into, a slightly wider
road, and smoother edges; shortcuts (the city's alley most) met the main road roughly.

- **Shortcut joins (every map, in the baker):** where a branch overlaps the main road it takes
  the main road's ground (height and bank), fading to its own once clear, so there's no step (the
  alley met the road 1.7 m below its surface, and you drove up out of it). A slip point keeps a
  branch on the main road's heading for its first and last ~24 m when its end points leave room.
  The kerb and verge the two decks run through are open: drawn flush and paved like the road, no
  kerb across a mouth, no edge line over the main road (`openL`/`openR` on the baked spline). The
  validator warns when a branch forks off at more than 35°.
- **Valley v3 (`tools/gen-countryside.ts`):** same valley, regions and shortcuts, re-laid:
  28 corners (v2: 18), 20 of them 35–110 m sweepers (v2: 8), 64% of the lap curved (v2: 41%),
  the longest straight 308 m (v2: 454). The village is a flowing S; sweepers into and out of the
  covered bridge; three hairpins up the switchbacks, each leg with a flick; the ridge sweeps over
  its crests; S-bends down the descent; a kink onto the home straight. Roads 14.5 m (asphalt) and
  13 m (dirt), v2's were 13 and 11, and 1.5 m more through the sweepers. Corners bank into the
  turn (5.7° sweepers, 3.4° hairpins), smoothed by distance so an S rolls over (under 0.5°/m).
- **Edges:** the land follows the banked road instead of its centerline, and a country road with
  no rail runs down to the land on a grass bank (1 in 2.5) instead of a sheer drop, which read as
  a ledge wherever a crest lifted the road.
- **Moved to fit:** the falling sign to the home straight (in the new S it dropped where no one
  could dodge it; just past the Barn's exit, cars leaving the barn don't see it in time);
  the Trestle's traffic on a straight trestle after a curve (traffic sections need straights).
  AI wrecks per race: v2 0.76, v3 0.88; the lap is 7 s quicker (77.5 to 70.6 s, AI field).
- **HUD:** the key hints left the bottom-left corner for the pause menu (Esc or ✕ Menu), for the
  device in use; the lap moved there instead, as a bigger badge, gold on the final lap.

Compact, truck and police designs (from branch `car-fleet`, 2026-09-30):

- **Every traffic kind now has its own design**, so none borrow another's: the compact is a short
  tall city car with big round lamps (it used to be drawn as the hatch); the truck is a cab plus a
  separate cargo box (`cargo` in the design, a second extrusion) with twin rear tyres and a
  slatted grille (it used to be a one-draw box). Both are drawn at their traffic kind's sim size.
- **The police car** is the sedan's shell with a black-and-white livery, a push bar and a roof
  light bar whose red and blue lenses double-blink in `update(dt)`; the bar and push bar come off
  in a wreck. Garage-only (key `-`) for now: no sim class, no traffic kind (a pursuit mode could
  use it).

Drift chains and skid marks (2026-09-30), the next of the "lean into the loop" ideas:

- **Drift chains pay now.** Start the next drift within 1.6 s of the last one's end (was 1 s)
  and it links; an S-bend is one chain. Each link multiplies a drift's points by 1 + 0.25 a link
  (as before) and now its banked boost by 1 + 0.2 a link, up to double (`chainBoost`,
  `chainBoostMax`). When a chain of two drifts or more runs out cleanly it pops "Drift chain ×N"
  with its points (`Ev.DriftChain`) and a rising chime, a note a drift; a spin-out, wreck or wall
  in the middle of one loses it ("Chain lost", `Ev.ChainLost`). The HUD's drift readout shows the
  chain's running points, ×N, and a bar draining the time left to link the next.
- **Fixed:** the chain's clock ran during the next drift too, so any drift longer than the window
  dropped the chain it was part of: in practice chains of long drifts never held. It runs only
  between drifts now (`test/drift.test.ts` fails on the old clock).
- **Skid marks** (`render/skids.ts`): the rear wheels lay rubber in a drift, the slide out of one,
  a spin, or a hard stop, for cars within 220 m of the camera. One ring of 6000 quads, one draw;
  each wheel joins its own strip, a strip fades in from nothing, a teleport starts a new one, and
  marks fade out over their last 10 of 30 s. They multiply the ground they're on (dark on asphalt,
  churned brown on dirt, green-dark on grass, none in water), so they read in shadow, lit or wet,
  and they leave the post pass's mirror mask alone. Presentation only; the sim never sees them.
- **Compact, truck and police designs** came in from branch `car-polish` (with its polish pass:
  clean ink, one detail language, reflective glass). Traffic draws the compact and the truck as
  their own designs now; the police car was garage-only (it became a class after, below).

Second review pass (2026-09-30), four parallel reviews again (core, render, UI and audio, project
shape), each finding checked before fixing; the notable ones, with tests where they can have one:

- **Core:** the main road's wall opened on the wrong side at a shortcut's mouth on a curve (the
  Barn); replays drifted from the live run because the sim stepped on unrounded input (human input
  is quantized on the way in now, to what reports record); a reset no longer slows the world; an
  empty checkpoint list falls back to automatic; a respawn clears the AI's stuck timers; a wall
  knock between drifts loses the chain.
- **Render:** scenery, rain and flames run on world time (they carried on while paused); skid
  marks fade into the fog; particle rates hold below 60 fps; far traffic skips the ink pass; the
  blur takes one tap where there's none.
- **UI and audio:** the F8 form owns the controls while up (the pad could unpause the game behind
  it); dropdowns in menus don't trap the arrows, and Space presses buttons; a hidden tab or mute
  suspends audio (the engine droned on in background tabs); one-shots end on the audio clock
  (music cut out after every unpause).
- **Project:** one content loader for tools and tests (`tools/content.ts`), the lap report split
  from its CLI (`tools/lap.ts`), replay loads all seven classes (it loaded four), validate and a
  test check `content/cars` against `CLASS_ORDER`, three.js in its own chunk, the dev save endpoint
  checks its path and origin.

The larger refactors it suggested (splitting `buildCar` and `buildCityscape`, one road index for
the scenery) are in HANDOFF's follow-ups.

Police car, Trestle legs, air boost and boost by position (2026-09-30, playtest):

- **The police car is a player class**, the Interceptor (`content/cars/police.json`, eighth in
  `CLASS_ORDER`): 66 m/s, 1750 kg with the push bar, a 3.8 s tank, for chases and takedowns. It
  laps 2.5–2.8% under the mean floor, with the muscle car. AI fields cycle through all eight
  classes, so the 8-car field has one of each.
- **Trestle legs:** the Trestle crosses the home stretch 22 m up, and its bents stood on the road
  but cars drove through them. A layout's `trestles: true` (the Valley's) has the baker stand every
  bridge more than 6 m over another road on bents 7 m apart (`BENT`), four legs across; the legs
  on the road beneath are solid props (`trestle-leg`), so clipping one wrecks you like a pillar.
  The forest draws its bents on the same grid, from the same numbers, and keeps cross beams 5 m
  over the road. The city leaves its flyovers' pillars off the roads below, so it's off there.
  Three rows of legs split the home stretch into two lanes and the verges.
- **The AI through the legs:** the racing line threads the nearest gap between solid props,
  eased over 40 m (it used to swerve at the last moment, onto the traffic lane). Avoidance judges
  a threat by where the car will be when it gets there, on the way to its target at ~3 m/s, not
  only at the target: it cut across a slower car's lane into its tail (7 wrecks in 36 hard laps,
  none after). After backing out of a pin it holds the other side of the road for 2.5 s, and may
  back out again after 2 s instead of 4 (the fallen sign past the legs pinned cars until reset).
- **Air boost pays on the landing:** `boostFromAir` (0.15 of a bar a second of air) and
  `airPoints` (500/s) are paid on a clean landing after at least `airMin` (0.45 s) in the air,
  with an "Air 0.8s +12%" pop and a chime (`Ev.AirBoost`). It used to trickle in while airborne
  at 0.08/s with no feedback, and a wreck on landing kept it.
- **Boost by position:** boost from moves (drifts and chains, air, near misses, oncoming, traffic
  checks) is scaled from ×0.9 for the leader to ×1.35 for last place (`boostPlaceLead`,
  `boostPlaceLast`), by a live `rank` the sim keeps each tick. The start boost, takedowns and the
  respawn catch-up boost aren't scaled; outside a race nothing is.
- **Contact shadow:** fades out when a car is tipped past ~30° or in the air (it hung off the floor
  pan like a black slab when a car flipped) and back in on its wheels. The fade is a pure
  function (`car/shadow.ts`) so it's tested without a DOM.
- **Tests** (`test/boost.test.ts`, and in `track`, `cars` and `render`): air pays on landing and
  not for a hop; position scales a move's boost, and a real drift's payout, by the lead-to-last
  ratio; ranks follow the race order; the legs are solid, leave gaps, wreck you, and aren't in the
  city; the racing line clears every leg; hard AIs pass under the Trestle clean on four seeds and
  three cars; the police class; the shadow on its wheels, flipped, on its side and in the air.
- **Changelog:** releases are recorded in `CHANGELOG.md` at the repo root from here on.

Quick wins (2026-09-30, PLAN phase 1):

- **Maps renamed:** City is Downtown (`downtown/downtown`), Countryside is Backroads
  (`backroads/valley`). `resolveLayout` (core/content.ts) takes a full key, an old one
  (`LAYOUT_ALIASES`) or a bare map id, old or new; the game, the setup reader, the lap report and
  the tools' `layout()` all go through it. Layout ids (`city-downtown`, `countryside-valley`) and
  scenery kinds (`city`, `countryside`) didn't change: the city's scenery is seeded from its
  layout id, and F8 reports name it, so both stay as they were.
- **Paints:** one-word names and ids (`hot-pink` became `pink`, with `PAINT_ALIASES`); the game
  picks paints by index, so saved races are unaffected.
- **HUD:** the position is the big badge bottom left (`#posBadge`); the lap is the first card top
  left (`#statLap`), gold on the final lap.
- **Controls share one style** (hud.css): menu buttons (sun yellow, a pink drop that presses in),
  ghost buttons, and fields (dark panels with an ink border, cyan when focused; selects draw
  their own arrow). The in-race menu button is a small menu button.
- **MAPS.md** holds map design and technique; PLAN.md the next phases.

Title screen and local lobbies (2026-09-30, PLAN phase 2):

- **Every race is a lobby.** The setup card is gone. The title screen (`ui/menu.ts`) shows the
  RACECAR wordmark over the attract race, the lobby list, a big Create lobby button, and Quick
  race and Free drive. Quick race starts your lobby as it's set (making one with seven open
  seats if there isn't one); Free drive is outside lobbies, as before.
- **The model is `src/lobby/lobby.ts`, pure:** a `Lobby` (name, host, visibility, phase, options,
  eight seats) changed only by `apply(lobby, actor, action)`, which holds the host rules. Only
  the host sets seats and options, starts, kicks and ends. A player's seat can't be turned into
  an AI, only kicked. Start waits for every other player to be ready, and a new car un-readies
  you. The host leaving passes the lobby on. A backend just stores lobbies and passes actions,
  so the relay one in milestone 3 sends the same actions to the room.
- **`LocalBackend`** (`src/lobby/backend.ts`) keeps one lobby in localStorage, so it's still
  there after a race (a race is a page load). Storage that throws falls back to memory. The
  lobby screen's URL is `?lobby=local`, so a reload lands back in it, with its map behind.
- **Seats in the race link:** `seats` replaces `opponents` and `difficulty`. It has one letter
  a seat: `p` you, `e`/`n`/`h` an AI, `o` open (a normal bot) and `x` closed. `roster()` turns
  them into the grid in seat order, so you can be in any seat. Seat `s` drives class `s` in your
  paint plus `s`, named `AI_NAMES[s − 1]`: exactly the rival an old link had in that place, so a
  seat keeps its rival from race to race.
- **Old links still work:** `opponents`/`difficulty` become `legacySeats` (free drive keeps its
  three rivals), and a bad `seats` value falls back the same way.
- **After a race** the pause menu's Main menu, the ✕ Menu button and the results' Back to lobby
  go to `?lobby=<id>`, and the lobby leaves its racing phase. A race without a lobby goes back
  to the title, as before.
- **Other players' seats are closed in a local race link** until online races land: a local
  race can't drive them.
- **Esc (and Start) go back a screen** in the menus; the pad's B already did.
- **Map thumbnails** (`ui/thumb.ts`) are SVG drawn from the layout's control points, with no
  baking. They appear in the list rows and on the lobby's map card, with the lap length.
- **From the review:** whenever the menu opens it ends your lobby's race (a tab closed
  mid-race used to leave it in `racing`, refusing Start). The camera, HUD, results and audio
  follow your car in whichever seat it's in. Free drive takes your lobby's settings over the
  last link's.
- **Not yet:** changing the map in the lobby doesn't swap the race behind it until a reload
  (phase 4's live preview does that). Lobby-list filters wait until there's more than your own
  lobby to filter.

License plates (2026-09-30, PLAN phase 3):

- **Your name is a plate** (`src/lobby/plate.ts`): up to seven characters, A–Z, 0–9 and single
  spaces, uppercase. A new player gets `RC` and four digits, kept in localStorage
  (`racecar.plate`), and changes it from the plate button on the title screen. The field types
  in plate form as you go. The plate is your seat's name in the lobby (a `name` action) and
  your name in the results.
- **The blocklist is small on purpose.** It checks with spaces removed and look-alike digits
  read as letters (0 O, 1 I, 3 E, 4 A, 5 S, 7 T, 8 B). Short words, and words that sit inside
  ordinary ones (RAPE in GRAPE, SPIC in SPICY), only count as the whole plate. Words people
  use for themselves (GAY, JEW) are never on it.
- **AI plates are per class** (`AI_PLATES`: VANTA 1, BRUTE, ZIPZAP, HAULR 2, CRUZN, MUD LRK,
  RT 88, PD 911). They replace the old AI names (Nova, Rook…): a seat drives its class, so a
  seat keeps its plate from race to race, like its car.
- **On the car, for no draw calls:** the cars' shared unlit material (lamps, lenses, plates) is
  mapped with one canvas atlas (`car/plates.ts`). It has 16 cells of 256×64 in the top half,
  and the bottom half is white. A plate's lettering is a quad in that same mesh with uvs into
  its car's cell, and every other vertex samples the white half, so its colour is unchanged.
  No mesh is added, so no draw call either.
  - Identical plates share a cell, and a cell is freed when the last car using it is disposed.
  - A full atlas gives blank plates.
  - Traffic keeps its blank plates (no lettering), and its instanced geometry keeps the uv, so
    it samples white.
- **Plates look like their map's:** Downtown's are white-lilac with navy lettering and a pink
  DOWNTOWN across the top. Backroads' are cream with green lettering and a rust BACKROADS.
  Other maps get a stock grey. Each has a bevel, a border and bolts, and the lettering is
  squeezed to fit seven characters. They're redrawn once Chakra Petch has loaded.
- **Wrecks:** the rear plate was already a part that breaks away. Its lettering is in that part,
  so it flies off and lands with it.
- **From the review:** your lobby follows your plate. A new plate renames your seat, and
  renames the lobby while it's still called `‹old plate›'s lobby`. Lobbies saved before plates
  (a seat called "You") take your plate when the menu opens. The plate field keeps the cursor
  where you were typing when it drops a character (`typedPlate`).
- **Not yet:** names over cars online (milestone 3). The garage viewer's cars have blank plates.

Car select (2026-09-30, PLAN phase 4):

- **The lobby is the car select.** It docks to the left (a column 440–600 px wide), and your car
  turns on a table in the rest of the screen, over the lobby's map. Under the car is a panel
  with its name and job, the car and paint pickers, and five stat bars (speed, accel, handling,
  weight, boost; `ui/stats.ts`, each against the range across the classes). The pickers moved
  there from your seat row, which now shows your car like everyone else's.
- **The table is a small model in the world's own scene** (`render/showroom.ts`): 1:50,
  held a hand's length in front of the world camera, so the same camera draws it into the same
  depth buffer, lit by the same lights. The post pass (ink, wet reflections, grade, grain) and
  the weather treat it like everything else, so the preview looks like the game and dims in
  the rain with the world. Behind the lobby the camera is a crane above the traffic, so nothing
  in the world comes that close to it.
  - **From the review:** the first version was a scene of its own, drawn over the world with
    the depth cleared. That wiped the world's depth before the post pass read it, so the race
    behind lost its outlines and reflections. It also left the table lit at dry strength in the
    rain. The model in the world fixes both.
- **CSS decides where the car goes:** the lobby has an empty `.stage` box, and the table is
  framed into it each frame (`frameStage`: where on screen, and a distance that fits the table
  to the box). So the same code puts it beside the menu on a desktop and above it on a phone.
  - On a phone (760 px and under), it's one column that scrolls, with a 16 px gutter: the car,
    then its panel, then the lobby.
  - The lobby's first focus no longer scrolls, so a phone opens at the top, on the car.
- **A new car drives up; a new paint or plate swaps in place.** The drive-up starts with the
  car's nose at the table's rim (the table floats over the race, so there's nothing past it to
  drive on). It eases to a stop in 0.9 s, with the wheels turning, the boost on at the start
  and the brake lights at the end. The table and camera ease to a new car's size (the bus needs
  the biggest).
- **Behind the lobby, the world is calm.** A slow crane camera moves down the lap, over the
  left edge of the road and above the traffic, instead of a chase camera filling the screen,
  and the post pass has no speed blur, boost, flash or slow-mo grade. The title screen keeps the
  chase camera.
- **Another map swaps in place** (`swapMap` in `main.ts`). This fixes the lobby's one gap: the
  race behind only changed map on a reload.
  - The sim takes the new track (`setTrack` now also updates the shoulder surface) and the
    map's weather (`setWeather`), and restarts the race from the grid.
  - The renderer takes the new sky and light (`setMap`: the greybox skin's `environment` can
    run again and replaces its sky and lights), then the track and world, and rebuilds the
    cars' visuals so their plates name the new map.
  - The lobby's weather is shown too: Rain makes it rain behind the lobby.
- **The pad:** left and right change a dropdown's value, so the car and paint pickers sit one
  above the other, and up and down move between them. Right from the lobby's buttons reaches
  them, and up from them goes back into the lobby.


Paradise, part 1: the lap and the land (2026-09-30, PLAN phase 5):

- **One lap-laying library for every map** (`tools/lib/lap.ts`): filleted arcs, drift-corner
  widths, banks into the turn, height between anchors, smoothing by distance, crests on the road,
  and then `onLap` (`sAt`, `yAt`, `fork`) and `wallGaps` for shortcuts and walls. It came out of
  the Valley's generator unchanged: the Valley regenerates byte-for-byte.
- **The Island** (`tools/gen-paradise.ts`, `content/maps/paradise`): 3.44 km, clockwise, a hard-AI
  floor of 68.2 s (the first map near SPEC's 70–100 s). Harbor Town, Coconut Coast (the Sandbar
  runs straight on along the waterline while the road swings inland round a headland), the
  Freeway, the Jungle Switchbacks (two wide hairpins on red earth), the Volcano Rim (lava rock
  round the cone; the Lava Tube is a chord inside it), and Lighthouse Point (a jump off the rim,
  the point, and the cliff road home).
- **New surfaces:** `sand` (loose, like dirt; the verges and the Sandbar), `red-earth` (between
  dirt and asphalt), `lava-rock` (a touch grippier than asphalt, for the climb), and `shore`
  (the wet sand at the Sandbar's waterline, always slippery, a zone like the Creek Bed's ford).
- **An island is terrain with a coastline** (`terrain.sea`, `island`, `volcano`): past the coast
  the land drops under the sea, a beach band runs round it, and it never dips under the sea
  inland. The volcano is a cone steepening to its lip, with a bowl in the crater, and black rock
  on its upper slopes. The Valley's land is unchanged (all of it is behind the island fields).
- **Bridges come from height and water:** a road over the sea is a deck, like one over the river.
  That's what makes the Freeway a deck over the bay, with ramps up on embankments either side.
  Its pillars come from `deckPillars` (`track.ts`), which the city's pillars now use too.
- **The island's roads are concrete where the country's are timber:** white barriers, a
  concrete deck and verge on bridges, and sandy verges.
- **The sea** is a grid over the land tinted by the depth beneath (turquoise over the sand, deep
  blue past the reef, foam at the waterline and a line of surf further out) inside a plane out
  to the horizon. Its alpha is the post pass's mirror mask, like the river's.
- **`tropic`, and a daytime sky:** a palette can set `day`, which puts the sun high and whole
  with a wide glare, and turns off the stars. Paradise's plates are white and teal with a coral
  tag.
- **Traffic in fast corners wrecks the field:** the Freeway's traffic first ran through its bend
  over the bay, and the field wrecked about five times a race there (traffic hit at the apex at
  200 km/h). Two sections on the straights either side, and a one-way freeway (both lanes run
  with the race), took it to 0.75 a race over eight seeds.
- **The bus got a little quicker** (accel 13 → 14): the Island is a fast lap and the bus sat at
  +5.8% of the mean; it was already +4.5% on the other two. Now +4.8%, +4.1% and +3.0%.
- **Still to come** (the next PRs of the phase): the scenery (palms, huts, jungle, the lava tube's
  tunnel and glow, the lighthouse), waves on the beach, the hazards (volcano bombs, coconuts),
  the passing shower and the sunset palette.

Paradise, part 2: the scenery (2026-09-30, PLAN phase 5):

- **`island.ts` dresses the island** from the track and its land, like the forest dresses the
  Valley: seeded, the same every race, one draw per kind of thing (about 50–150 draw calls for
  the world; the rest are the cars).
  - **Palms** on the beaches lean out to sea; right by the road they lean over it. Inland there
    are some palms in the jungle, with broadleaf crowns and bushes, thickest in clumps.
  - **Everything that grows sways** in the vertex shader (`swaying`: a toon material whose
    instances bend more the higher the vertex), so the wind costs no CPU.
  - **Harbor Town:** pastel houses (some with a second storey) both sides of the start, the tiki
    bar on the sand with four torches, a pier out from the harbour front with five fishing boats
    moored along it, umbrellas and towels on the beach, thatched huts, and gulls circling.
  - **The volcano:** black boulders over the upper cone, a churning lava pool in the crater, a
    glow round the lip, and a plume of smoke (a new `plume` point mode, 140 m tall, leaning
    downwind).
  - **The Lava Tube** is roofed over: rock walls and a roof along its middle, rubble heaped on top,
    a seam of lava low on each wall, and glowing lights. The land over it is still cut open (the
    road caps the land), so it reads as a tunnel in a cutting.
  - **The jungle:** a rope bridge high over the first leg of the switchbacks between two rock
    stacks, and a waterfall down a cliff outside a hairpin, into a pool, with mist.
  - **The lighthouse** stands on the point: the lap's last third furthest from the island's middle.
    Red and white, with a lamp and a slow sweeping beam.
  - **Signs** at the Sandbar's and the Lava Tube's mouths, in teal and sand.
- **Waves:** the sea's vertex shader lifts a swell over the shallows. It's gone in the deep, and
  at the waterline, so the sea never lifts off the beach.
- **The day sun is its own colour:** the synthwave sky's pink sunset tint is off by day.
- **A test builds the scenery without a DOM** (a stand-in canvas): nothing stands on a road
  surface (the rope bridge and the tube's roof are over it), and the same seed builds the same
  island. The distance is to the nearest road sample: `projectGlobal`'s lateral is small for a
  point far along a hairpin's tangent, which flagged trees 40 m away.
- **A grade per map** (owner, 2026-09-30: Paradise looked "a little grayscale", and the aim is a
  2000s sunny-beach, blue-sky look). The post pass has a grade a palette can set: saturation,
  contrast about mid-grey, a tint multiplied into the shadows, and the vignette's strength. With
  none, the image is as rendered, so Downtown and Backroads don't change. `tropic` has 1.3×
  saturation, 1.08 contrast, blue-green shadows and a light vignette (0.22). Its sky went deeper
  blue with a clearer, bluer haze (fog out to 2.3 km), a lighter fill, a brighter sun, whiter sand
  and greener grass. The grey was the pale haze and the flat fill washing the colors out, with
  grey toon shadows and a heavy vignette on top.
- **Review fixes (PR #22):**
  - Shortcut signs stood on the wrong side, on the Valley too (the Barn, Logger's Leap and the
    Creek Bed as well as the Sandbar). The side was read 4 m into the branch, where it's still
    on the main road and the road's own curve decided it. `branchSide` (`scenery.ts`) reads it
    30 m in, like the baker's `sideOf`, and a test holds it to where the main road's verge opens.
  - The lighthouse had house windows (its stripes were drawn with the house texture).
  - The jungle crowns barely swayed: a crown is a unit ball, so it sways as if it were 3 units up its trunk.
  - Beach huts could stand on a palm: they're placed before the trees now.

Paradise, part 3a: weather and time of day (2026-09-30, PLAN phase 5):

- **Tropical showers:** a map whose `weather` lists `shower` (Paradise) gets passing showers
  for random weather instead of the other maps' rain rolling in to stay. 40% of races stay
  clear; the rest get one shower that starts 40–120 s in, takes 15 s to arrive, lasts 35–60 s
  and clears over 20 s, so it's over before a 3-lap race is. Puddles are on while it lasts. The
  plan gained `t2`/`t3` (drying) and stays a pure function of the seed and time. Rain chosen
  outright is still rain all race, and the other maps' random weather is unchanged, seed for seed.
- **The sky responds to rain on every map** (from PR #21's review: a bright sun in the rain). The
  sky shader greys its gradient toward cloud and hides the sun and its glare, and the page
  background follows the fog. A palette's `overcast` (default 1) scales it, and how much the
  light dims: Downtown and Backroads cloud over, while Paradise's shower keeps the sun out
  (`overcast` 0.3) and thickens the haze less.
- **Sunset:** a second palette for Paradise (`sunset`), a low whole sun over the sea (no
  synthwave bands, no stars), a pink-to-orange sky, warm light from the sun's side
  (`sunFrom`), a warmer sea (`seaLight`), and a grade with violet shadows. A map names it as
  `sunset` in its map.json, and the lobby's new **Time** option (Random, Day, Sunset) picks it.
  Time is off on maps without one. Random is a third of races, seeded (`paletteFor`), so every
  player sees the same. It's in race links (`time=`), and lobbies saved by an older build get it
  filled in.
- **No rain in the Lava Tube:** the scenery can roof a stretch of road (`covers`: the tube's
  roofed middle), and the rain's roof map takes those as well as decks and the city's tunnel.
- **Lap lengths per map** in the lobby's thumbnail test: each within 3% of MAPS.md's figure,
  instead of one 2.7–3.8 km bound for all.

Paradise, part 3b: hazards and tuning (2026-09-30, PLAN phase 5):

- **Volcano bombs** (`volcano-bombs`, a scheduled kind): every ~45 s the volcano throws three
  glowing rocks onto the rim road. For 2 s they arc in from the crater while rings grow on the
  road where each will land (the telegraph), then they lie there, solid, cooling from yellow to
  dark rock, for 10 s. Each lands in its own third of the range, clear of the road's edges. They
  come from the seed like every scheduled hazard, so online they land at the same moment on
  every screen with nothing to send. They sit on the rim's last stretch before the jump, inside
  the Lava Tube's span, so the tube skips them. The AI steers round a bomb from the moment it's
  in the air: pieces in flight carry where they'll land.
- **Coconuts** (`coconuts`, a trigger): the first car past s 560 on the beach road shakes 2–3
  loose from the palms. They drop behind it onto the half of the road under the palms, bounce
  and roll a little way in. Running one over is a new kind of contact, a bump (`Solid.Bump`): a
  hop, 10% of your speed and a small nudge off line, never a wreck, and traffic ignores them.
  They're green, which reads on asphalt where brown didn't. About 1.7 are run over a race.
- **Hazards sit on the banked road:** a banked corner's edge is well off the centre's height, so
  the rings and rocks take the road's bank into account (the rings sank under the rim road at
  first). The rings sit a little higher off every road now.
- **The Sandbar, re-laid** (found by the sweep): the field's baseline was **1.63 wrecks a race**
  (seeds 1–8, no hazards; the ~0.75 in the notes was other seeds). Nearly all were on lap 1 at
  the Sandbar's mouth. The old Sandbar zigzagged, riding the road inland round the headland then
  swinging back out to the water, so the AIs that took it braked to 120 km/h in the fast line
  and the pack ran into them at 185. It forks earlier now, where the coast road still runs
  straight, and follows the waterline to where the road comes back to the water (355 m against
  411 m of road). It profiles at 165 km/h or faster all the way, the baseline is 0.5 a race, and
  the hard lap floor went from 68.2 to 66.8 s.
- **Placed by sweeps** (field report, 8 then 16 seeds). Bombs higher up the rim cost 0.5–1.25
  hazard wrecks a race; the rim's last stretch cost 0.13. Coconuts wreck no one anywhere, so they
  went where every car meets them, before the Sandbar. With both, the field wrecks **1.25 times a
  race** (0.44 from hazards; 16 seeds), with 0.9 m rocks that wreck above 18 m/s closing. Classes
  hold within ±5% on all three maps (van +4.8%, bus +4.9% on Paradise).
- **Review fixes (PRs #23 and #24):**
  - The coconuts never showed their rings: the fall (0.9 s) was longer than the telegraph (0.7 s),
    so the warning never drew. The telegraph is 1.3 s now: 0.4 s of rings, then the fall.
  - Coconuts spun forever after they stopped rolling; their spin follows the roll now.
  - With Time on Random, the lobby showed the background race's pick, which could differ from the
    race's own (a new seed at the start). The lobby shows the day for Random.

HUD tweaks (owner, 2026-09-30):

- **"Drift boost" is now "Powerglide":** the pop when a clean drift release pays the meter.
- **A Superman:** boosting through the air (at least 0.25 s of a flight, `supermanMin`) pays that
  flight's air boost and points 1.5× (`supermanPay`) on a clean landing, with a "Superman!" pop
  and a longer chime. The AI boosts over jumps now and then too; lap floors didn't move.
- **The countdown's number shows its outline:** a stroke under the fill only shows its outer
  half (1.5 px), which was lost on the night sky, so it's 7 px, ringed in outline shadows as well.


The lobby's layout (owner, 2026-09-30):

- **Three panels, nothing scrolls:** the seats alone dock left, their rows sharing the window's
  height (40–58 px) with the buttons at the bottom. Your car turns in the middle, between the
  seats and the options. The race's options float top right. Below 1000 × 560 it's the one
  column a phone gets, which scrolls without a bar.
- **The options are the host's:** the host gets the six dropdowns. Everyone else gets the map
  and a line of chips (laps, weather, time, mayhem, traffic).
- **The car is cycled, not picked from a list:** arrows either side of the table cycle the car
  (A and D, or the pad's bumpers), and a row of swatches under its stat bars sets the paint (W
  and S cycle it). The car and paint dropdowns are gone. W, A, S and D are `pick-*` menu
  actions now. When there's nothing to pick (the title, or no seat in the lobby) they move focus
  as before, and the arrows and d-pad always do. Quick presses build on the last pick sent, so
  none are lost while the lobby echoes the change back.
- **Races default to 2 laps** (`DEFAULT_OPTIONS`, and a link without `laps`). A lobby already
  saved keeps its laps.

Landmarks, part 1: Downtown (PLAN phase 6):

- **Landmarks are layout data** (`landmarks: [{ kind, at, rot, r, params }]`), placed by the
  generators, the same every race, and scenery only. The greybox builds each kind in
  `render/skins/greybox/landmarks.ts`. `r` is the ground each keeps clear: the validator keeps
  every road that far off, and the city leaves it empty (`Keep`: no buildings, sidewalk slabs,
  parked cars, trees or lamps). `params.view` also keeps a sight line clear in front of a
  landmark, so the road sees it. `params.scale` scales any kind.
- **The scenery sees the race:** the track visual's update gets a `SceneLive` from the renderer
  each frame, with the race time, the leader's plate and the wetness.
- **Downtown's five:**
  - A **clock tower** at the end of the Boulevard. Its long hand is the race's seconds, its short
    hand the minutes, and a lit readout under each dial shows m:ss.
  - The **leader billboard** past the Skyway straight's west end. It shows LEADER and the leading
    car's plate, and is straight ahead the whole way along the straight.
  - In the Market: a **fountain plaza** inside the loop, west of the Alley, and the **donut shop**,
    a giant iced donut on its roof, on your right as you fly the hump.
  - A **canal with a drawbridge.** The PLAN put it by the Underpass, but the Underpass is a
    trench, and its walls hide anything beside it. So the canal runs down a row of blocks inside
    the Skyway's sweeper, under the Skyway twice, where you look down on it from 12 m up. Its
    drawbridge lifts for a tug that runs up it every few minutes. It cuts the streets' ground for
    its water, and a flat bridge crosses it at each side street.
- **Cost:** each landmark's still boxes are one instanced mesh, and the clock's four dials, four
  readouts and eight hands are three draws. All five together are ~11 draw calls.

The lobby's header, and who can join (playtest, 2026-10-01):

- **Who can join is three ways, not two:** Public (listed online), Invite only (anyone with the
  link, not listed: what "private" meant before) and Private, which is the spec's **lock**:
  nobody new sits down (`apply` refuses a `join`), and those in keep their seats. Someone who
  opens a private lobby's link watches without a seat, and sits down if it opens up again. The
  host clicks the header's button to cycle them; everyone else sees it as a label. Create lobby
  offers the same three words: Public, Invite only, or Private, which there is the local lobby
  (you and bots, in this browser: nobody else can join that either). Its header says Private.
- **A lobby an older build made `private` is read as `invite`**, in its room's state and in
  actions, since that's what it meant then. The lock (Private) is its own value, `locked`, so a
  lobby that lives through a deploy doesn't shut its friends out.
- **The header is just that and the invite link** (gone while it's Private). The cars on the grid
  and the room code were noise next to the seats.
- **The turntable is in the middle of everything right of the seats**, lower, clear of the
  options card, and bigger: the table spans the stage's height (`frameStage`, 0.5 of it as its
  radius, up from 0.36), still never more than 0.36 of its width. The car's panel is centered
  under it.
- **The header says how you reach the others:** LAN (every pair direct, across one network),
  Relay (some pair through the TURN relay) or Server (some pair with no channel yet), the slowest
  pair's way, from `room.lanRoute`, shown as a button like the others. It updates every second, and there's none while you're
  alone. The SDK doesn't say a relay's region, so it doesn't show one yet (HANDOFF's GameRelay
  side).
- **Pings: each player measures their own and tells the room.** The SDK only knows your ping
  (`relay.ping()`), so every lobby page measures it every 3 s and sends `{ type: 'ping', ms }` to
  everyone (`room.send`); each screen shows them in the seats' Ping column, in cyan, checked as
  they come in. It's each player's round trip to the server, not to each other. Your own lobby
  has no Ping column. The 4th column is headed Status.
- **The seats panel:** an open seat says "Random bot" by a gray dot, the last seat has no rule
  under it, and Start (or Ready) and Leave are stacked, each the panel's width.
- **You start a lobby in a random car and paint**, creating it or sitting down in one. The
  turntable changes it.
- **Only Public lobbies are listed, by two checks.** The room is unlisted (`setAccess`, tried
  again if it fails), and the listing's meta says who can join, so the list drops one that isn't
  Public even while its room is still listed.
- **Your own lobby isn't in the list, and closes when you leave it.** With you gone only bots are
  left. Its Title button is gone (Leave, now Close lobby, and Esc both close it), and a stale one
  in storage (a closed tab) isn't listed.
- **Quick race skips lobbies:** you and seven normal bots, a random map, random weather and time,
  the default laps. Its results go to the main menu.
- **A lobby everyone left isn't listed.** GameRelay keeps an empty room for its idle time (two
  minutes), listed as it last was ("1/8"). The list skips rooms the server counts nobody in, and
  the last one out unlists the room as they go (`setAccess({ public: false })`).

Online races don't pause, and the lobby says who's still racing (playtest, 2026-10-01):

- **Switching away doesn't pause an online race.** It's shared, so it goes on, and the pause menu
  would only be in the way when you came back. Esc still opens it as "Menu": the race goes on and
  your car coasts until you resume.
- **No Restart or Race again online.** A race everyone's in can't be restarted for one of them:
  the host's Restart gave them a race of their own, and from there Back to lobby reopened the
  lobby while the others were still racing. The menu and the results offer Back to lobby
  instead, and the next race is the lobby's.
- **The lobby says who's still racing.** The start marks every seated player `racing`, and each
  clears it when their lobby screen opens again (`{ type: 'racing', racing }`, their own seat
  only). Their seat shows "Racing". Since the end un-readies everyone, the host's Start waits
  for them.

Remote cars (milestone 3, part 2, 2026-10-01):

- **Every player owns their car** (`src/net/cars.ts`, `NetCars`). Yours is a GameRelay entity
  (`car`, 30 Hz): pose, velocity, yaw rate, pitch and roll, the wreck tumble, steering, and the
  grounded, drift, boost and wreck flags. It's written from your sim after each step. A jump over
  12 m in one step (a reset) is a `teleport`, so everyone snaps instead of sliding.
- **Everyone else's car is a remote car in your sim** (`CarSpec.remote`). Before each step it's
  put where its entity says (`sim.setPose`), predicted forward from the SDK's ~100 ms render delay
  to now: straight on from its velocity, turning at its yaw rate, at most 0.25 s, and not at all
  while it's wrecked. Steering, drift and the track aren't in the prediction yet. Your sim only
  finds it on the track (`locateCar`: progress, laps, rank). It doesn't drive it, wall it or put
  it through hazards and traffic.
- **Contact:**
  - Your car is pushed and bumped off theirs (its own share of the impulse). Theirs isn't moved
    at all, since it's where its owner says, and their own sim bumps it off yours on their screen.
  - Your sim never wrecks another player's car: the victim decides (§10).
  - Two remote cars touching is left to their screens.
  - Bump dedupe (±150 ms) and credit for wrecks are still to come.
- **The race link carries the others** (`others`: seat, id, car, paint, plate). Their seats are
  `r`, which the roster makes remote cars in their own grid slots, so every screen's grid is the
  same. A Restart or Race again from an online race is a race of your own (the `r` seats close).
- **The lights go green together.** The host's Start stamps `startAt` 6 s ahead on the server's
  clock (`relay.now()`), and the race page holds its countdown (READY) until it's connected. The
  net layer then sets green from the server's clock on every countdown step. Every step, not just
  once, because a tab in the background doesn't step and its sim's clock falls behind; it catches
  up on the first step it gets. If not connected within 8 s, the race starts anyway, with your
  car not going out.
- **An online race doesn't pause.** The pause menu still opens, but your car coasts on neutral
  controls and the others keep driving.
- **A player's car joins the race when it first shows up**, and leaves it when their entity goes.
  `addCar` leaves a remote car out until then, so one who never connects isn't a car parked on
  the grid (where it would be a wall: your car takes all the push off a remote one).
- **From the review:**
  - An online race has no world slow-mo for your wreck. Your sim would run slow, you'd crawl on
    everyone else's screen, and your race clock (and finish time) would fall behind theirs.
  - A respawned car's ghost goes out with it (`ghost`), so you pass through it as its owner does.
  - Race again from an online race is a race of your own: the net layer needs the link's online
    parts (`others` or `at`). That page only keeps your seat in the room; it doesn't send a car
    into the others' race.
- **Not yet:** the AIs are each client's own (the same seed, but they drift apart as players race
  differently). Traffic hits, hazards and finishes are each screen's own too, as are results.
  Next come host-owned rival entities, `room.claim` for traffic, and the host's results.

Online lobbies (milestone 3, part 1, 2026-09-30):

- **A lobby is a GameRelay room** (`src/lobby/relay.ts`, `RelayBackend`), tagged `race`. The
  lobby lives in `room.state.lobby`, and only the SDK's host writes it. Everyone else sends
  their actions to that host (`room.request('lobby', …)`), and it applies them with the same
  `apply` a local lobby uses. So the rules (who sets seats, who starts) are one piece of code.
- **The SDK's host isn't the lobby's host.** The SDK's role moves on its own: a reload, a hidden
  tab, and every race is a reload. The lobby's host (`lobby.host`, who sets the seats and starts)
  changes only when they leave. Whoever holds the SDK's role applies the actions, and `apply`
  checks the lobby's host, so the role can hop mid-lobby and nothing changes.
- **Actions from others are checked first** (`readAction`): shapes, ranges and known values, and
  a join is always the sender's own (the id the server vouches for, not the one in the action).
  A room's listing is a host's JSON, so the list checks it too (`readListing`).
- **The room lists show the lobby's summary** (`setListing`: name, plus map, laps, phase, pips,
  players), sent when it changes and at most once a second (the SDK allows 10 in a row, then one a
  second). A private lobby is an unlisted room (`setAccess({ public })`), joined by its link.
- **Your own lobby stays local.** `Lobbies` (backend.ts) puts both behind the screens: `local` is
  this browser's, and every other id is a room code. Quick race and free drive still use yours.
  Create lobby asks who can join: anyone (listed online), friends (by link), or just you. The
  interface's `you` became `youIn(id)`, since online your id is the relay's.
- **A race keeps your seat.** A race is still a page load. The race page joins the room again (a
  reload resumes the same player), so the room lives through many races. The host's Start
  carries a seed (`{ type: 'start', seed }`, kept as `lobby.seed`), and everyone seated follows
  the lobby into the same race when it turns `racing`. Only that change moves you: opening a
  lobby that's already racing doesn't. When the lobby's host comes back to it, it's reopened.
  Players still racing come back to it when they finish.
- **Between races** (from the review): the end un-readies everyone but the host, so the host
  can't start the next race while others are still racing this one. If the lobby's host leaves
  mid-race, the lobby passes to someone waiting in it, and their screen reopens it. Back (Esc)
  from an online lobby leaves it, so a look doesn't hold a seat. Someone watching a full or
  racing lobby takes a seat when one opens between races, and Leave puts them out of the room
  whether or not they had a seat. A lobby whose seats all emptied goes to whoever sits down
  next. A kick aimed at the player holding the SDK's role (which can't kick itself) is carried
  out by that player: they hand the lobby on, then go.
- **Not yet: other players' cars.** Each player races the same race (same map, seed, AIs and
  weather) with the others' seats empty. Remote cars are the `net/` layer, next.
- **Someone gone for good gives up their seat.** On `player_left` (after the SDK's 30 s grace),
  and when the SDK's role passes to someone, the host opens the seats of anyone no longer in the
  room. A kick also puts them out of the room (not banned).
- **Offline is fine.** Without `VITE_GAMERELAY_KEY` there's no relay, and the title says so. With
  one and no server, the list shows your own lobby and "Can't reach the lobby server". Online
  calls the screens wait on give up after 5 s. `.env.development` points dev at the local
  GameRelay server (`gr_pub_dev`, `http://localhost:8787`), and `.env.production` has the
  `racecar` instance's public key on gamerelay.io (8 players; allowed origins only
  `http://localhost` until racecar is hosted somewhere).
- **The SDK is a dependency now** (`@gamerelay/sdk` 0.1.0-alpha.4, 28 KB gzipped).
  `bunfig.toml` exempts it from the global 7-day `minimumReleaseAge`, since it's ours and every
  release is newer than that.

Downtown's field wrecks (sweep, 2026-09-30):

- **1.0 a race over 16 seeds** (0.88 on seeds 1–8; 1.13 at `alpha-1.11`, before the landmarks
  and smashables). The ~1.6 that MAPS.md and HANDOFF quoted dated from the quick wins and was
  never re-measured. Downtown is under MAPS.md's 1.5 and didn't change.
- **The one cluster** is at 150–250 m, where the start's traffic meets the colonnade (pillars at
  239–261 m): 7 of the 16 wrecks. Ending that traffic at 150 m gave 1.06 a race, and taking the
  pillars out gave 0.88. Both are inside the ±0.3 that seeds swing by, and each just moved the
  wrecks to the Market's traffic (1,550–1,950 m), so the colonnade stays.
- A test holds the 8-seed field to 1.5, like the Valley's.

The Valley's field wrecks (sweep, 2026-09-30):

- **2.5 wrecks a race over 16 seeds** (2.0 on seeds 1–8). Two thirds of them were in 100 m of
  the home stretch: the Trestle's legs, the home straight's traffic appearing at 2,722 m (among
  and just past the legs, in the lane the field threads them in), and the falling sign at
  2,707 m.
- **Traffic starts past the legs** (2,782 m). With the later start alone, the pile-up at the
  legs went away.
- **The falling sign is gone from the Valley.** With the traffic fixed, the sign was then most of
  what was left, wherever it stood: 3.5 a race at the Village S (200 m), 3.9 at 1,000 m, and 2.3 at
  2,860 m, against 1.25 with none. That's half a 14.5 m road blocked with 0.5 s of warning, at up
  to 200 km/h, and a city's sign never belonged in the country anyway. (The sweep that placed it,
  "Valley v3", ran before the home stretch changed.)
- **Now 1.13 a race over 16 seeds** (0.88 on seeds 1–8), and a test holds the 8-seed field to 1.5.
  The lap and its floor (63.4 s) are unchanged.

Landmarks, part 2: Backroads (PLAN phase 6):

- **In the village:** a giant fibreglass **cow** (Big Bessie) on a plinth, and a **water tower**
  with the town's name, Millbrook (`label`, a landmark's words). The cow started behind the
  houses that line the road and couldn't be seen. It's in front of them now, and its ground
  keeps the houses out.
- **Off the home straight:** a **scarecrow** in a patch of corn, swaying in the wind with crows
  circling. Across the river stands a farm **windpump** whose wheel spins faster in the rain,
  since rain is the wind we have. It gusts, and its head hunts.
- **On the flats below Pine Hollow:** a **drive-in** with a flickering film (Attack of the 50 ft
  Combine), a projection booth and its beam, and rows of cars facing the screen.
- **Over the Ridge:** a striped **hot-air balloon** drifting in a slow loop, its burner flaring
  now and then.
- **The country keeps landmark ground clear** (`buildForest`'s `marks`): no trees, houses or
  pastures in it. Builders get the ground under their own points (`ctx.ground`), so the
  drive-in's cars and the corn stand on the slope.
- **No imports from the car models:** the drive-in's cars are boxes of their own. Importing the
  traffic models pulled the car builder into every scenery test.

Landmarks, part 3: Paradise (PLAN phase 6):

- **The lighthouse** was already the island's scenery. Its beam is now two cones back to back,
  and in a shower's gloom it's brighter (opacity 0.1 → 0.32) and a quarter longer.
  `buildIsland`'s update gets the wetness.
- **Off Coconut Coast:** a **shipwreck** heeled over in the shallows, its sail stirring. Out beyond
  it, a **whale** breaches every 80 s: up nose first, over, and back in on its back, in a splash
  (a one-shot `splash` point mode on its own clock). It blows at the surface halfway between.
- **On the coast road's beach:** a **surf shack** on stilts, with its boards stuck in the sand.
- **At the Lava Tube's mouth:** a **tiki head**, placed from the fork (20 m right of the road, 4 m
  before it) and facing the cars coming at it. Its eyes glow and its torches flicker.
- **On the lagoon under the Freeway:** two **seaplanes** moored at a jetty, bobbing, and a third
  flying circuits over the bay.
- Builders get the sea's level (`ctx.sea`), so things that float float. The island keeps landmark
  ground clear of palms, huts and houses (`marks`, like the forest).

Smashables (PLAN phase 6):

- **Sim pieces, like hazard pieces** (`core/world/smash.ts`), so they're the same online.
  - Where they stand comes from the layout: `smashables` rows give a kind, a stretch of road, a
    spacing and a side.
  - Each stands on the verge, a little under halfway to the wall, with a seeded jitter along the
    road so a row isn't a picket fence.
  - Their state is when each was smashed (`brokenAt`), carried in snapshots (`smashed`). A
    smashed one stands again 30 s later (`SMASH_RESPAWN`).
- **A hit** is any car whose box, grown by the prop's radius, reaches it (a respawning ghost goes
  through). It fires `Ev.Smash`, and pays a pinch of boost (0.02–0.05 of a bar, by kind, through
  the boost-by-position scale) and 50–200 points. It costs 1–7% of the car's speed and never
  wrecks. A wrecked car tumbling through smashes it, for nothing.
- **The six kinds:**
  - Downtown: newspaper boxes along the Boulevard's sidewalks, and cones in the Market (the x =
    -120 street and the outside of the dog-leg).
  - Backroads: hay bales through the village S, and mailboxes along the home straight and the
    start.
  - Paradise: beach umbrellas on the coast road's sea side, and fruit stands through Harbor
    Town.
  - 66, 23 and 22 props per map.
- **On screen:** one instanced mesh per kind, each model a few coloured parts merged. The
  renderer bursts one in its colour and shakes the camera a little. The HUD pops "Smash!" (once a
  second at most, so a row of cones isn't a flood), and there's a crunch.
- The AI doesn't aim for them or avoid them. The lap floors didn't move, and the field tests still
  hold.

Review fixes (PRs #26–#30):

- **A Smash event has no `other`.** It carried the prop's index there, and the renderer and the
  audio read `other` as a car. An AI smashing prop #0 shook the camera of whoever drove car 0,
  and played the crunch as theirs.
- **No smashables on another road.** Four of Paradise's beach umbrellas stood on the Sandbar's
  roadway, and two of the Valley's props by the Barn shortcut stood on its road. Hits are only
  checked on the car's own road, so a car on the branch drove through them. A prop that would
  land on any other road (within its width and shoulder, at the same level) is left out.
- **The canal cuts only its own footprint from a sidewalk slab.** At the canal's two ends the
  cut ran across the whole slab. It subtracts the canal's rectangle now, leaving up to four
  pieces round it.
