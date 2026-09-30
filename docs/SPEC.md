# racecar: design

> **Status (2026-09-29): spec only, nothing built.** A loose outline: when building teaches us
> something, we change it here and say so under "Changed while building".
>
> racecar (working title, see "Name") is a cel-shaded arcade street racer for the browser,
> online through GameRelay, for up to 12 players. It grows out of the "Neon Wreck" prototype (one
> endless straight road, near misses, boost, takedowns, aftertouch) into a real game: circuits,
> maps, modes, a lobby you live in between races, controllers.

## The pitch

**Burnout 3's crashes, Mario Kart's party, with some Need for Speed and Forza sprinkled on top.**
You open the link, land in the lobby, jump into a party, race, the group votes on the next map,
and you race again. No menus between you and the next race.

| From | We take | We leave |
|---|---|---|
| **Burnout 3** | Takedowns, aftertouch, boost earned by driving dangerously, traffic checks, slow-mo wreck cam, revenge takedowns, signature takedowns per map, Crash mode | Long single-player career |
| **Mario Kart** | 12 racers, party-first flow, drift mini-turbo, start boost, catch-up (boost fills faster at the back), items (a lobby toggle), readable cartoon look, anyone can pick it up | Kart-only physics, character roster |
| **Need for Speed** | Nitrous feel, night cities, cops in a Pursuit mode, visual customization (paint, underglow, rims, decals) | Story, open world |
| **Forza** | Handling that feels good on a controller, car classes with real stat trade-offs, rewind in single player, photo mode | Simulation, tuning sheets |

## Goals

1. **A real game first.** It has to be fun on its own, with friends or alone, or it's not a
   good demo. Party-game energy: 30 seconds from link to racing, crashes are the fun part.
2. **Show off GameRelay.** Every online feature uses the public SDK as any customer would:
   rooms, room lists, entities, events, host entities, state, timers, claims, invite links,
   chat, leaderboards. No private APIs, no game server of our own. Where the SDK falls short,
   we add the feature to GameRelay for everyone (§6, "Platform asks"), not a hack in the game.
3. **Calibrate the network.** The game ships a net overlay and headless bots, so we can load-test
   rooms and relays and measure what players actually feel (§10).
4. **Open-source example.** `gamerelay/racecar`, MIT, readable, small. Someone should be able to
   read `src/net/` in an evening and learn how to build a multiplayer game on GameRelay.
5. **Fast and small.** 60 fps on a mid laptop and a 2021 phone; lobby on screen in under 2 s,
   first race in under 3 s. Budgets in §11 are enforced in CI, not hoped for.

Not goals (v1): realistic driving sim, a career, tuning sheets, native apps, anti-cheat for
ranked play (§5, "Trust").

## What we keep from the prototype

- **Art direction:** toon ramp lighting (3 steps), ink outlines, dusk/midnight palettes, neon
  signs, synthwave sun, fog, the post pass (radial blur, chromatic split, speed lines, slow-mo
  grade, impact flash). HUD: skewed panels, Bungee + Chakra Petch, pops ("Takedown!").
- **Core loop:** drive dangerously (near miss, oncoming lane, drafting, drifting, air) → fill
  boost → spend it → ram rivals for takedowns → takedowns refill boost. Crash → slow-mo wreck
  cam with aftertouch.
- **Everything procedural.** No texture or model downloads: canvas textures, box-built cars,
  generated buildings. It's why the prototype loads instantly; keep it that way (glTF allowed
  later only inside the asset budget).

What changes: the endless straight road becomes closed circuits built from a spline (§3), the
lane-snapped car becomes a real arcade car with drift and stats (§4), and the single 1,000-line
file becomes modules with hard boundaries (§2).

## §1 Stack

- **TypeScript, Vite, Bun** (tests, bots, scripts). Three.js current release (WebGL2), imported
  per module so tree shaking works. WebGPU renderer is a later experiment, not a dependency.
- **`@gamerelay/sdk`** from npm, same as any customer.
- UI and HUD are **DOM**, not canvas (cheap, accessible, easy to style, easy to drive with a
  controller via a focus system, §8). No UI framework: plain TS components. Revisit only if
  menus outgrow that.
- Repo **`gamerelay/racecar`**, next to `sdk` and `resonance`. Private until milestone 2 is
  playable, then public. Deployed as static files at `racecar.gamerelay.io`, itch.io later.

## §2 Architecture

One rule makes the rest work: **`core/` is pure TypeScript with no Three.js, no DOM, no
network.** It runs in the browser, in Bun tests, and in headless bots.

```
src/
  core/        simulation: math, fixed-step loop, car physics, track, collisions, spatial index,
               traffic, items, AI drivers, race progress. Deterministic given inputs + seed.
  net/         GameRelay adapter: lobby, party, entity kinds, events, clock, remote-car
               prediction, traffic sync, votes.
  render/      Three.js: renderer, toon/outline materials, post pass, car meshes, world chunks,
               particles, camera rigs. Reads core state; never writes it.
  maps/        one folder per map (city/, countryside/): track data, prop kit, palette, traffic.
  modes/       one file per mode (race.ts, takedown.ts, …) behind a Mode interface.
  cars/        car classes: stats + the box-built model + paint slots.
  input/       keyboard, gamepad, touch → one Controls object; menu navigation.
  ui/          screens (lobby, party, garage, settings, HUD, results, vote) as DOM components.
  audio/       engine synth, SFX, music.
  settings.ts  persisted settings (localStorage, GameRelay player data when signed in).
  main.ts      wires it together.
tools/
  bots/        headless GameRelay clients driven by core/ AI (load tests, fill rooms).
  track-view/  a 2D debug view of a track's spline, walls, checkpoints, grid.
```

Dependency direction: `ui, render, net, input → core`; `maps, modes, cars → core` (+ `render`
for a map's prop kit, loaded lazily). Enforced with an import lint rule.

**Loop:** `relay.tick(60, step)` (or a local fixed-step loop offline) runs `core` at 60 Hz;
`requestAnimationFrame` renders, interpolating between the last two sim steps. Slow-mo scales
sim `dt` for *your* car's wreck and the camera only; remote cars and traffic keep real time
(slow-mo can't pause other people). In single player it slows the whole world, as Burnout does.

### Extension points

```ts
interface MapDef {
  id: 'city' | 'countryside' | string;
  name: string;
  layouts: TrackLayout[];        // forward, reverse, short: spline + widths + lanes + banking (§3)
  palette: Palette[];            // dusk, midnight, …
  traffic: TrafficProfile;       // density, vehicle mix, lane speeds
  thumbnail: () => Promise<string>; // rendered once, cached: lobby cards and the vote screen
  kit: () => Promise<PropKit>;   // lazy: builds the scenery for this map (render side)
}

interface Mode {
  id: string;
  players: [min: number, max: number];
  options: ModeOption[];                   // laps, time limit, items on/off, traffic density…
  setup(ctx: ModeContext): void;           // spawn grid, rules, timers
  onEvent(ev: GameEvent, ctx): void;       // takedown, lap, wreck, finish…
  standings(ctx): Standing[];              // for HUD + results
  isOver(ctx): boolean;
  hud: HudWidget[];                        // which HUD pieces this mode shows
}
```

Adding a map = one folder + one line in the map registry. Adding a mode = one file. Nothing
else changes.

## §3 Tracks and maps

- **A track is a closed spline** (centripetal Catmull-Rom) with per-point width, lane count,
  elevation and bank. From it we bake, at load:
  - the road mesh, curbs, barriers (render);
  - wall polylines along both edges (collision);
  - a **distance table**: arc length `s` ↔ point/tangent, for progress, positions, spawning,
    AI lines, item boxes, and the minimap;
  - **chunks** of ~60 m along `s`, each holding its merged scenery and props (for culling).
- **Race progress** is `lap * length + s`. Position is a sort on that. Checkpoints every ~1/8
  of a lap stop corner-cutting from counting.
- **Shortcuts and ramps** are optional side splines that rejoin the main one. Every map should
  have at least one risky shortcut (Mario Kart) and one signature takedown spot (Burnout: a
  pillar, a drop, a gas station).
- **Grid width:** 12 cars start in a staggered 2-wide grid (6 rows); starting straights are
  long enough for that.
- **v1 maps:**
  - **City** (the prototype, grown up): neon downtown, two lanes each way, oncoming traffic,
    wide boulevard, a tunnel, a hairpin under an overpass. Palettes: dusk, midnight.
  - **Countryside**: a winding two-lane road through fields, a village, a bridge, a forest
    section, hills with crests (air time). Fewer walls, more ways to fly off the road.
    Palettes: golden hour, overcast.
- **Later maps** (same pipeline): harbor/docks (containers, cranes), desert canyon, snowy
  mountain pass. Five total is the target.
- Each map gets 1–2 layouts (forward, reverse, short) from the same spline, cheaply.

## §4 Driving, cars and collisions (core/)

- **Car model:** arcade, on a plane that follows the road's height. State: position, heading,
  velocity (2D), yaw rate, boost meter, wreck state. Grip model with a drift state (drift
  button or hard steer at speed). Speed ~0–300 km/h with boost. Tuned for feel on a controller,
  not realism. Off-road (grass, gravel) slows and shakes.
- **Boost** (Burnout + Mario Kart): the meter fills from near misses, oncoming, drafting, air,
  drifting and takedowns. Drifts also charge a mini-turbo in two stages (blue, orange) released
  when the drift ends. Tapping throttle on "GO" gives a start boost. **Catch-up:** the meter
  fills faster the further back you are (tunable, off in Time Trial).
- **Car classes** (v1: 4–6 cars, all box-built like the prototype): stats for top speed,
  acceleration, handling, boost capacity and **weight**. Weight matters in collisions: a van
  shoves a coupe around, a coupe out-turns a van. Everyone picks a car in the garage; the class
  shows on the lobby roster.
- **Customization** (NFS): paint, underglow color, rims, a decal, a horn. Stored in settings,
  sent as the car's `skin` value. Cosmetic only.
- **Wrecks** switch the car to a simple 3D rigid body (position, velocity, spin, gravity,
  bounce) for 2–3 s, with aftertouch steering, then respawn on the track at the last `s`,
  facing forward, with a short ghost (no collisions) period.
- **Collision shapes:** cars are oriented boxes (OBB, SAT test); walls are segments; props are
  circles or boxes. The prototype's axis-aligned overlap test isn't enough once cars turn.
- **Response:** impulse along the contact normal, scaled by the weight ratio, with extra
  lateral push for side swipes. **Takedown rule** (tunable): the victim wrecks if the relative
  speed along the normal is above a threshold, or it's pushed into a wall/traffic while being
  hit, or the attacker is boosting. Otherwise it's a bump (sparks, shake, small loss of speed).
- **Revenge:** whoever took you down last is marked on your screen; taking them down is a
  "Revenge" (extra points and boost).
- **Items** (Mario Kart, a lobby toggle, off by default in Race so Burnout purists get a clean
  race): item boxes at fixed `s` values; a small set that fits the crash theme: oil slick,
  shockwave (bumps nearby cars), homing EMP, shield, instant full boost. Catch-up weighting on
  what you roll, like Mario Kart.
- **Near miss / oncoming / drafting / air** are scored from the same broadphase queries.

### Spatial index: grid, not quadtree

We need fast "what's near this car" for collisions, near misses, items, audio, and culling.
For this game a **uniform grid (spatial hash) rebuilt every tick** beats a quadtree:

- Everything dynamic is about the same size (cars, 2–10 m), there are ~120 of them (12 players,
  AI, ~60 traffic cars, items), and they all move every tick. A grid rebuild is O(n) with no
  allocation (typed arrays, cell size ~16 m); a quadtree rebalances and allocates.
- Static colliders (walls, props) go in a **separate grid baked at load**, bucketed by chunk,
  never rebuilt.
- The track's `s` gives a free 1D index too: "cars within 50 m of me along the road" is a
  window on a sorted array, which is what near-miss, AI and positions actually want.

A quadtree stays on the table for maps with very uneven density (a sparse countryside with a
dense village) if the grid measures worse there. `core/spatial.ts` hides the choice behind one
interface so swapping is cheap.

Network-side "interest management" (only send nearby cars) doesn't pay off at 12 players: every
player needs every car for the minimap and positions, and 12 cars at 30 Hz is small (§5). It
would matter for 32+ player free roam, which is a good future test for the SDK, not for v1.

## §5 Online racing (net/)

**Shape: players own their cars** (GameRelay's "players own avatars"), the **host owns the
world** (AI rivals, race phase, votes). That's the responsive choice for a racer: your car
never waits for the network.

- **Rooms of 12.** One GameRelay room is one party: it lives through many races (the lobby,
  the race, the vote, the next race), so players never re-matchmake. Note: the LAN/relay
  shortcut covers rooms of up to 8, so 9–12 player rooms go through the server only. That's a
  real test of the server route, and a reason to consider raising the shortcut's limit.
- **Entity kinds:**
  - `car` (player-owned, `rate: 30`): `x, y, z` number, `h` angle, `vx, vz` number (for
    prediction), `boost`, `drift`, `wrecked` flags, `item` text, `skin` value. ~40 bytes a
    message after the SDK's compact envelope, so 11 other cars ≈ 13 KB/s down per player.
  - `rival` (host-owned, `rate: 30`): AI cars filling empty grid slots when the party wants
    them (a lobby toggle), simulated by the host with the same `core` AI. Host migration keeps
    them driving.
  - `item` (owned by whoever fired it): homing EMPs and dropped oil, short-lived.
- **State** (host): `phase` (lobby / countdown / racing / results / vote), `map`, `layout`,
  `mode`, `options`, `ready` (who's ready), `startAt` (a `relay.now()` time: everyone's lights
  go green on the same server tick), `results`, `votes`, `session` (points across races).
  Timers for countdown, the race time limit, the results screen and the vote.
- **Events:** `bump {impulse, contact}` (to the car's owner), `wrecked {by, kind}`,
  `takedown`, `lap`, `finish {t}` (server-clock time), `traffic_hit {id, impulse}`,
  `item_use`, horn/emotes.
- **Remote cars are predicted, not only interpolated.** The SDK draws others ~100 ms in the
  past; for a car at 250 km/h that's 7 m, which makes close racing and rams feel wrong. `net/`
  extrapolates each remote car from its interpolated state by its age using `vx, vz` (dead
  reckoning), blends corrections over ~150 ms, and uses the extrapolated pose for collisions.
  Built in the game first; once it's proven, it moves into the SDK as an opt-in `predict` for
  fast kinds (§6).
- **Collisions between players:** each client tests *its own* car against predicted remote
  cars. On contact it applies its own impulse and sends `bump` to the other owner, who applies
  theirs. **The victim decides whether it wrecks** (it owns its car) and emits `wrecked {by}`,
  which awards the takedown. Credit per wreck is a `room.claim(wreckId)` so a pile-up can't be
  counted twice.
- **Traffic costs no bandwidth.** Traffic cars drive fixed lanes at fixed speeds, so a car's
  position is a pure function of `(room.seed, carIndex, relay.now())`: every client computes
  the same traffic with zero messages. When someone hits one, `traffic_hit` turns it into a
  local cosmetic wreck on everyone's screen, and it respawns on schedule. The first hitter wins
  the points via `room.claim`. Item boxes work the same way: fixed places, `room.claim` per
  box per respawn.
- **Mid-race joiners** spectate (cycle through cars) until the next race.
- **Leaderboards:** best lap per map/layout, takedowns per week, Crash mode scores.
- **Trust:** players-own-avatars means a modified client can drive fast or refuse to wreck.
  Fine for parties. If we ever want ranked, the host-simulates-from-inputs shape is the path,
  and it's a good second example for the repo; not v1.

## §6 Menus and the party flow

The game opens **straight into the lobby**, like Counter-Strike's server browser, not a title
screen. Everything is reachable by mouse, touch and controller (§8).

### Main menu = the lobby

```
┌ RACECAR ───────────────────────────────────────────────── [Settings] [ada ✎] ┐
│  [ HOST A PARTY ]   [ QUICK RACE ]   [ SINGLE PLAYER ]   [ JOIN BY CODE ]   │
│                                                                              │
│  PARTIES                                     filter: [all modes ▾] [open ▾]  │
│  ─────────────────────────────────────────────────────────────────────────── │
│  🔓 ada's party          City · Race · 3 laps     racing    9/12   [Spectate]│
│  🔓 Friday wrecks        Countryside · Takedown   in lobby  4/12   [Join]    │
│  🔒 kev + friends        City · Knockout          in lobby  6/12   locked    │
│  ...                                                                         │
│                                                    [Garage]   47 online      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **The list** shows each public party's name, map, mode, phase (in lobby / racing, with lap),
  players / 12, and locked. It refreshes every few seconds while visible. Full and locked
  parties stay in the list, greyed out, so the lobby looks alive.
- **Host a party**: name (defaults to "ada's party"), public or private (private = invite
  link only), mode, map. You land in the party screen as host.
- **Quick race**: joins the fullest open public party in its lobby phase, or hosts one.
- **Single player** (§7) and **Join by code**.
- **Garage**: pick your car and paint it; the preview spins on the menu.
- Name editing inline; signed-in GameRelay players keep their name and settings across devices.

### Party screen (between races)

- **Roster**: 12 slots, each with name, car, ready state, ping, host crown. Empty slots show
  "AI" when AI fill is on.
- **Host controls:** map and layout, mode and its options (laps, items, traffic, catch-up, AI
  fill), **lock** (no new joiners; people already in stay), **public/private**, **kick** (with
  "and ban from this party"), **pass host** to someone else, **start** (enabled when everyone
  is ready, or force-start after 10 s).
- **Everyone:** ready toggle, change car, **share** (`room.shareInvite()`: share sheet on
  phones, copies the link elsewhere; also the 4–6 character code on screen), chat
  (GameRelay chat), leave.
- A **session scoreboard**: points across races since the party formed.

### After a race: results → vote → next race

1. **Results** (10 s): finishing order, best lap, takedowns, "most wrecked", photo-finish
   replay of the last 5 s, points added to the session.
2. **Vote** (15 s): three cards (map + layout + mode) plus "random". The host sets the pool:
   rotate through everything, or only the current mode. Each player gets one vote, changeable
   until the timer ends; ties break randomly with `room.seed`. The host can skip the vote and
   pick.
3. **Next race** starts automatically; players who didn't ready up in time spectate one race.

Votes go through `room.request('vote', …)` to the host, which keeps the tally in state (so a
host change mid-vote keeps it).

### Settings

- **Graphics:** quality preset (auto / low / med / high), resolution scale, outlines, post FX,
  motion blur, palette choice, FPS cap, show FPS.
- **Controls:** remap keyboard and gamepad, steering sensitivity and dead zone, rumble,
  auto-accelerate (touch), invert look-back.
- **Audio:** master, music, SFX, engine volume.
- **Gameplay:** units (km/h, mph), camera distance and FOV, HUD scale, minimap on/off.
- **Accessibility:** reduced motion (softens shake, blur and flashes), colorblind-safe HUD
  colors, larger text.
- **Network:** show net overlay, region (later, when there's more than one).

### Platform asks (build in GameRelay, not in the game)

The party screen needs things the SDK doesn't have today. These are small, useful to every
customer, and each one gets a proper change to the server + SDK + docs:

| Need | Today | Ask |
|---|---|---|
| Host kicks a player | Only the game owner, with the secret key | `room.kick(playerId, { ban })`, host only, server-enforced |
| Lock a party | `public` is set at creation only | `room.setAccess({ locked, public })`, host only; joins fail with `locked` |
| Server browser rows | `listRooms` gives code, players, max, tag | Host-set listing info: `room.setListing({ name, meta })` (small JSON: map, mode, phase), shown in `listRooms` |
| Show full/locked parties | `listRooms` hides full rooms | `listRooms(tag, { includeFull: true })`, with a `locked` flag |
| Online count | none | a player count for the instance (cheap, cached) |
| Pass host | host changes only on leave/freeze | `room.transferHost(playerId)` |
| Close fast cars' 100 ms gap | interpolation only | opt-in `predict` per kind (after racecar proves it) |
| 12-player shortcut | LAN/relay route up to 8 | consider raising (measure first) |

Until each lands, the game shows the control disabled rather than faking it (a client-side
"kick" anyone can ignore would be a bad example to open-source).

## §7 Modes

| Mode | Players | Idea | v |
|---|---|---|---|
| **Race** | 1–12 (+AI) | 3 laps, traffic on, takedowns refill boost, items optional | 1 |
| **Takedown** | 2–12 | 3 min on the circuit, most takedowns wins; getting wrecked costs points | 1 |
| **Knockout** | 3–12 | Race; last place at each lap's end is wrecked out | 1.1 |
| **Time trial** | 1 | No traffic, best lap, ghost of your best, leaderboard | 1.1 |
| **Pursuit** | 4–12 | Teams (`assignTeams`): racers vs. cops; cops win by wrecking every racer before the timer | later |
| **Crash mode** | 1–12 | A junction full of traffic, one run each, biggest pile-up wins | later |

Knockout and Pursuit should need no new core features: that's the test of the Mode interface.

**Single player** is the same modes offline against AI (no relay, `net/` not loaded), plus a
short **challenge ladder**: a fixed list of events per map (win a race, 10 takedowns in
Takedown, beat a lap time) with 1–3 stars, progress saved locally. Rewind (Forza) is on in
single player only. Enough to learn the game; not a career.

## §8 Input, camera, feel

- **Controls object** (`steer -1..1, throttle 0..1, brake 0..1, boost, drift, item, lookBack,
  reset, horn, pause`), fed by:
  - **Gamepad API** (standard mapping): stick/triggers analog, dead zones, hot-plug, rumble via
    `vibrationActuator` on bumps/wrecks/boost. Xbox, PlayStation and Switch Pro prompts.
  - Keyboard (WASD/arrows, Space boost, Shift drift, E item) with steering smoothing.
  - Touch: tilt or on-screen buttons (prototype layout), auto-accelerate option.
- **Menus by controller:** a small focus system over the DOM (d-pad/stick moves between
  focusable elements by position, A selects, B backs out, bumpers switch tabs). Every screen is
  tested by controller only.
- **Local split-screen** (2 players, two gamepads) is a later stretch; the architecture allows
  it because `Controls` and camera are per player.
- Camera: chase cam with speed FOV, boost pull-back, shake, look-back; wreck orbit cam;
  photo-finish replay (core state ring buffer); photo mode in single player.
- Audio: engine as a Web Audio synth (pitch by rpm, no samples), tire squeal, impacts, boost
  whoosh, music with a low-pass on slow-mo.

## §9 Name

"racecar" stays the repo and code name. The title on screen is open. Some candidates that fit
Burnout-meets-Mario-Kart and a party lobby:

- **Neon Wreck**: the prototype's name; strong for the city, weaker once there's a countryside.
- **Wreck Room**: a party you hang out in, where you wreck each other (a pun on "rec room").
- **Full Send**: short, loud, what the game wants you to do.
- **Pile Up**: plain, funny, says exactly what happens.
- **Takedown Tour**: says the mechanic and the map rotation.

Check trademarks and existing games before picking; the name only touches the title screen,
the page title and the landing page, so it can land late.

## §10 Network calibration

The game is also our test rig.

- **Net overlay** (`?net=1`, or Settings → Network): RTT, route (server / LAN / relay), entity
  age, prediction error (m), bytes in/out, dropped updates, per remote car.
- **Telemetry** (opt-in, aggregated): prediction error and correction size per race; it tells
  us what latency players actually feel, by region and route.
- **Bots** (`tools/bots/`): headless Bun clients running the core AI on a real track, joining
  real rooms. Use: fill 12-player rooms for load tests, soak tests on relays (Resonance),
  regression on every SDK release (same idea as `examples/cycles-bot.ts`), and a live lobby
  for demos.
- Standard scenarios run with `simulate: { latency, jitter, loss }` in CI to catch netcode
  regressions (prediction error under 1 m at 150 ms RTT, say).

## §11 Performance budgets

| Budget | Target |
|---|---|
| Frame | 60 fps mid laptop (integrated GPU), 60 fps 2021 phone at medium tier, 12 cars on screen |
| Draw calls | < 250 per frame (instancing for cars, traffic, props; merged chunks) |
| Sim step | < 2 ms for 12 players + 60 traffic + items, zero allocation per tick |
| JS | < 200 KB gzipped for game code, Three.js tree-shaken separate; menus load before Three.js |
| Load | lobby < 2 s, first race < 3 s on 20 Mbps; maps lazy-loaded |
| Network | < 20 KB/s down, < 3 KB/s up per player in a 12-player race |

How:
- The lobby is plain DOM and shows before Three.js finishes loading; the 3D garage preview and
  map thumbnails fill in after.
- Instanced meshes for traffic and props; one merged mesh per chunk for static scenery;
  distance + frustum culling per chunk.
- **Outlines:** the prototype's inverted hull doubles draw calls. Try a screen-space edge pass
  (depth + normal) in the post shader instead; keep hull outlines for cars only if it looks
  better. Measure both.
- Quality tiers (low / med / high) picked by a short benchmark, plus dynamic resolution when
  frame time slips. Post pass has a cheap path (fewer blur taps) for low.
- Particles: one pooled `Points` buffer (as the prototype does), capped.
- CI runs a headless perf scene and fails on draw call and bundle size regressions.

## §12 Milestones

1. **Extract**: repo, the prototype split into `core/render/input/ui`, one City circuit from
   a spline, new car model and OBB collisions, drift and boost, gamepad. Single player against
   AI. *Playable.*
2. **Online race**: the lobby list, host a party, party screen (roster, ready, share, chat),
   `net/` cars with prediction, bumps and takedowns, deterministic traffic, countdown on server
   time, results, vote, next race. Net overlay. Platform asks for kick, lock and listing info
   land in GameRelay alongside. *The demo; repo goes public.*
3. **Countryside + maps pipeline**: second map through `MapDef`, lazy loading, thumbnails,
   track-view tool, palettes. Bots for load tests and filling the lobby.
4. **Modes and cars**: Takedown, then Knockout and Time trial; car classes with weight;
   garage and paint; leaderboards; single-player challenge ladder.
5. **Polish**: settings screen complete, audio, controller navigation everywhere, items,
   perf tiers, mobile touch, photo-finish replay, landing page, open-source README.
6. **More maps** to five; Pursuit; Crash mode; split-screen.

Each milestone ends deployed and playable.

## Open questions

- The name (§9).
- Items: on by default in Race, or off with a toggle? Leaning off for Race, on in a separate
  "Party Race" preset.
- AI fill: fill every race to 12, or only when there are fewer than 4 humans?
- Should the lobby show parties from every mode together (one busy list) or tabs per mode?
  Leaning one list with a filter while player counts are low.

## Changed while building

(nothing yet)
