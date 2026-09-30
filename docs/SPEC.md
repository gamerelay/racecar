# racecar: design

> **Status (2026-09-29): spec only, nothing built.** A loose outline: when building teaches us
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
| **Mario Kart** | Party-first flow, drift mini-turbo, start boost, catch-up, shortcuts everywhere, hazards that are part of the track, items (a lobby toggle), anyone can pick it up | Kart physics, character roster |
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
2. **Every system is declared up front** (§3): what it owns, what it reads, when it runs, and
   how it syncs. A new feature starts by adding a row to that table.
3. **Shared world = function of (seed, race time).** Traffic, hazards, weather and item boxes
   are computed from `room.seed` and the shared race clock on every client, so they cost zero
   bandwidth and can never disagree (§4). Only players' own cars and the things they set off go
   over the network.
4. **One owner per piece of data.** A car is written by its player; the world by the clock;
   race facts by the host. Nobody writes what they don't own (the SDK enforces this anyway).
5. **No allocation in the hot path.** The sim uses fixed-capacity pools and typed arrays; a
   test asserts zero allocations per tick after warm-up.
6. **Data, not code, for content.** Tracks, surfaces, hazards and car stats are JSON files
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
content/
  maps/<map>/      map.json, <layout>.track.json, hazards.json
  cars/*.json      car classes
  surfaces.json    the surface table
tools/
  bots/            headless GameRelay clients driven by core/ai (load tests, filling rooms)
  validate.ts      content validator (runs in CI)
```

Dependency direction: `ui, render, net, input, editor → core`; `modes → core`. `core` imports
nothing outside itself. `render/skins/*` only implement the `Skin` interface. Enforced with an
import lint rule.

### Loop

- `relay.tick(60, step)` (or a local fixed-step loop offline) runs `core/sim.ts` at 60 Hz.
- `requestAnimationFrame` renders, interpolating between the last two sim states.
- Render, audio, HUD and net read the tick's **event queue** (a typed ring buffer, not
  callbacks), so the sim never calls into them and a slow renderer can't stall a tick.
- Slow-mo scales `dt` for *your* car's wreck and the camera only online (others keep real
  time); in single player it slows the whole world, as Burnout does.

### Data layout

Hot data lives in struct-of-arrays pools with fixed capacity, indexed by handle
(index + generation):

| Pool | Capacity | Notes |
|---|---|---|
| cars | 8 + 8 ghosts | players and AI; ghosts for Time Trial and spectating |
| traffic | 128 | only the ones near someone are simulated; the rest are closed-form |
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
| 4 | Traffic | `core/world/traffic` | seed, race time, lanes | traffic poses (closed-form), wreck overrides | **D** + **T** for hits |
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

Rules for adding a system: it gets a row, a slot in the order, a sync category, a pool (if it
has many things), and a test that runs it headless.

## §4 Sync categories

Every piece of game data is in exactly one of these:

| Cat | What | How | Cost |
|---|---|---|---|
| **O** | Things a player owns: their car, their fired items | GameRelay entity, player-owned, 30 Hz | ~40 B × 30/s per car |
| **H** | Things the host runs: AI rivals | GameRelay entity, `owner: 'host'` (migrates with the host) | same |
| **D** | The deterministic world: traffic, scheduled and random hazards, weather, item box spawns | Pure function of `(seed, raceTime)`; nothing sent | 0 |
| **T** | Triggers: someone set something off, or took something | `room.claim(key)` decides who; the winner emits the event; everyone runs it from the event's server time (`meta.at`) | one claim + one event |
| **E** | Moments: bumps, wrecks, takedowns, laps, finishes, horns | `room.emit` | tiny, rare |
| **S** | Race facts: phase, map, options, ready, results, votes, session points | `room.state`, host-written, timers for phases | rare |
| **L** | Local only: particles, camera, debris after a wreck, audio | never sent | 0 |

**The shared race clock.** `raceTime = relay.now() - state.startAt`, quantized to 60 Hz ticks.
Clients agree on `relay.now()` to within a few ms, so a 20 m/s truck is within ~10 cm on every
screen. D-systems are written as **closed-form functions of time** (where is this truck at
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
never drop below one car's width plus margin, checkpoints are in order, every hazard's range is
on the track, traffic lanes are inside the road, the AI can finish a lap, and the lap time is in
the target range.

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
| **City** (neon downtown) | ~85 s | alley through a parking garage, rooftop jump off a ramp, subway tunnel | falling sign, oil spill, container drop at the docks edge | clear, rain | the overpass pillars |
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
- **Car classes** (v1: 4, JSON): top speed, acceleration, handling, boost capacity, **weight**.
  A van shoves a coupe; a coupe out-turns a van.
- **Customization:** paint, underglow, rims, decal, horn; sent as `skin`; cosmetic only.
- **Wrecks:** the car becomes a simple 3D rigid body for 2–3 s with aftertouch, then respawns
  on the track at the last `s`, facing forward, ghosted (no collisions) for 1.5 s.
- **Collision shapes:** cars are oriented boxes (SAT test); walls are segments; props, hazard
  pieces and traffic are boxes or circles.
- **Response:** impulse along the contact normal scaled by weight ratio, extra lateral push for
  side swipes. **Takedown rule** (tunable): the victim wrecks if relative normal speed is over a
  threshold, or it's pushed into a wall/traffic/hazard while being hit, or the attacker is
  boosting. Otherwise it's a bump.
- **Revenge:** whoever took you down last is marked; taking them down is a "Revenge".
- **Items** (lobby toggle, off by default): boxes at fixed places; oil slick, shockwave, homing
  EMP, shield, full boost; weighted by position.

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
- **Entity kinds:** `car` (player, 30 Hz): `x, y, z`, `h`, `vx, vy, vz`, flags `boost`, `drift`,
  `wrecked`, `ghost`, `item` text, `skin` value. `rival` (host, 30 Hz): AI cars. `projectile`
  (owner, 30 Hz): homing EMPs.
- **State:** `phase` (lobby / countdown / racing / results / vote), `map`, `layout`, `mode`,
  `options` (laps, items, mayhem, weather, traffic, catch-up, AI fill), `ready`, `startAt`,
  `results`, `votes`, `session`. Timers drive the countdown, the race limit, results and vote.
- **Events:** `bump`, `wrecked {by, cause}`, `takedown`, `lap`, `finish {t}`, `traffic_hit`,
  `hazard {id, n}`, `item_use`, `horn`.
- **Remote cars are predicted.** Others are drawn ~100 ms in the past (7 m at 250 km/h).
  `net/predict` extrapolates each one from its interpolated state by its age using velocity,
  blends corrections over ~150 ms, and collisions use the predicted pose. Built here first,
  then offered to the SDK as an opt-in `predict` per kind.
- **Player-vs-player contact:** each client tests *its own* car against predicted remote cars,
  applies its own impulse, and sends `bump` to the other owner, who applies theirs. **The victim
  decides whether it wrecks** and emits `wrecked {by}`; takedown credit is a
  `room.claim(wreckId)`.
- **Traffic hits:** your car hits a traffic car (D) → `room.claim('traffic:<i>:<epoch>')` →
  winner emits `traffic_hit`; everyone overrides that car with a local wreck (L) and the
  formula respawns it later.
- **Finishing:** each client emits `finish {t}` with its server-clock time; the host writes
  results to state (after a sanity check against the lap count and track length).
- **Mid-race joiners** spectate until the next race.
- **Leaderboards:** best lap per layout, takedowns per week, Crash mode scores.
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

- **Roster:** 8 slots: name, car, ready, ping, host crown; "AI" in empty slots when AI fill is on.
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
| Host kicks a player | only the game owner, with the secret key | `room.kick(playerId, { ban })`, host only, server-enforced |
| Lock a party | `public` set at creation only | `room.setAccess({ locked, public })`, host only; joins fail with `locked` |
| Server browser rows | code, players, max, tag | `room.setListing({ name, meta })` (small JSON: map, mode, phase, lap), in `listRooms` |
| Show full/locked parties | `listRooms` hides full rooms | `listRooms(tag, { includeFull: true })` with a `locked` flag |
| Online count | none | players online for the instance (cached) |
| Pass host | host changes only on leave/freeze | `room.transferHost(playerId)` |
| Fast cars' 100 ms gap | interpolation only | opt-in `predict` per kind, once racecar proves it |

Each is a normal GameRelay change (server, SDK, docs, tests). Until one lands, the game shows
that control disabled rather than faking it.

## §12 Modes and single player

```ts
interface Mode {
  id: string;
  players: [min: number, max: number];
  options: ModeOption[];                   // laps, time limit, items, mayhem, weather…
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
| **Crash mode** | 1–8 | one run into a junction full of traffic; biggest pile-up | 6 |

**Single player:** the same modes offline against AI (`net/` not loaded), plus a challenge
ladder per map (win a race, 10 takedowns, beat a lap time) with 1–3 stars saved locally. Rewind
and photo mode in single player only.

## §13 Input, camera, audio

- **Controls** (`steer, throttle, brake, boost, drift, item, lookBack, reset, horn, pause`) from:
  - **Gamepad API**, standard mapping: analog stick and triggers, dead zones, hot-plug, rumble
    (`vibrationActuator`), Xbox / PlayStation / Switch prompts.
  - Keyboard (WASD/arrows, Space boost, Shift drift, E item) with steering smoothing.
  - Touch: tilt or on-screen buttons, auto-accelerate option.
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
- **Telemetry** (opt-in, aggregated): prediction error per race; wreck and slow-spot positions
  (feeds the editor heatmap).
- **Bots** (`tools/bots/`): headless Bun clients running `core/ai` on real layouts in real rooms:
  load tests, relay soak tests (Resonance), SDK release regression, and a lively lobby for demos.
- CI scenarios with `simulate: { latency, jitter, loss }`: prediction error under 1 m at 150 ms
  RTT; D-systems agree across two clients to within 0.2 m.

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

Greybox until milestone 5. Each milestone ends deployed and playable.

1. **Sandbox**: repo, `core` skeleton (clock, pools, events, sim pipeline), track format +
   baking + validator, greybox skin, car physics (drift, boost, air, wrecks), OBB collisions,
   gamepad and keyboard, editor v0 (edit spline + widths, drive it). One City layout.
2. **The world**: surfaces and weather, traffic (closed-form + LOD), hazards framework with
   log-truck and falling sign, AI drivers and the AI lap report, laps/positions/scoring,
   single-player Race vs AI. City fully laid out; Countryside blocked in.
3. **Online**: lobby list, host/join/quick race, party screen, `net/` (cars, prediction, bumps,
   takedowns, triggers, traffic hits), countdown on the race clock, results, vote, next race,
   net overlay. The platform asks land in GameRelay alongside. **Repo goes public.**
4. **Modes and content**: Takedown, Knockout, Time trial; car classes; Countryside finished;
   reverse layouts; train, rockfall, oil spill; leaderboards; challenge ladder; bots.
5. **Skins**: the neon City skin (the prototype's look), Countryside skin, post FX, audio,
   garage and paint, settings complete, controller navigation everywhere, perf tiers.
6. **More**: Volcano, Harbor, Alpine (greybox → skin), items, Pursuit, Crash mode, landing page.

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
| Remote cars | predicted in `net/` first, then offered to the SDK |
| Sim / send rate | sim 60 Hz; cars sent at 30 Hz |
| Spatial index | uniform grids (dynamic + static) + `s` index; quadtree only if measured better |
| Hazards | kinds in code, instances in JSON; periodic / random / trigger / always; always telegraphed |
| Mayhem, weather | lobby options: Mayhem off / normal (default) / chaos; weather clear / rain / random (default random) |
| Items | built in milestone 6, lobby toggle, **off by default** (hazards already bring the chaos) |
| AI fill | on by default, fills the grid to 8; host can set 0–8 |
| Lobby list | one list with a mode filter (split into tabs only if it gets crowded) |
| Missing SDK features | built into GameRelay (§11), never faked in the game |
| Trust | party-grade; host sanity-checks finishes; ranked is out of scope |
| Maps | City, Countryside (v1), then Volcano, Harbor, Alpine |
| Car classes | 4 in v1 |
| Mobile | supported (touch, tilt); controller and keyboard are the primary targets |
| Hosting | `racecar.gamerelay.io`, static files |

Still open, and fine to leave open until they matter:

- The exact takedown and boost numbers: tuned in milestones 1–2 with the AI lap report and
  playtests, not decided on paper.
- Whether split-screen is worth it: revisit after milestone 5.

## Changed while building

(nothing yet)
