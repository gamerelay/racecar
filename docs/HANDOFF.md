# Handoff

Where racecar stands and what's next, for whoever picks it up (a person or a fresh Claude session).
The design is [SPEC.md](./SPEC.md): decisions in §17, and what building changed in "Changed while
building". This file is "where are we"; the spec is "what are we making".

**Last updated:** 2026-10-01. `main` is tagged **`alpha-1.18`**: milestone 2 (PR #2, tagged
`alpha-1.0`), Countryside v2 (PR #4, `alpha-1.1`), seven cars plus polish (PR #6, `alpha-1.2`),
traffic that fades instead of popping (PR #7, `alpha-1.3`), audio plus a review pass (PR #9, `alpha-1.4`), Valley v3 with smooth shortcut joins (PR #10, `alpha-1.5`), drift chains, skid marks, new car designs and a second review pass (PR #12, `alpha-1.6`), the police car, solid Trestle legs, air boost and boost by position (PR #13, `alpha-1.7`), the quick wins plus the title screen and local lobbies (PRs #14 and #16, `alpha-1.8`), license plates, the lobby polish, the cars doc `docs/CARS.md`, marketing art with link previews and the car select (PRs #18, #19, #15, #17 and #20, `alpha-1.9`), Paradise's lap, land and scenery (PRs #21 and #22, `alpha-1.10`), and Paradise's weather, sunset, hazards and tuning plus the Powerglide and Superman HUD tweaks (PRs #23 and #24, `alpha-1.11`), the lobby layout (PR #25), and landmarks on every map, smashables and the Valley's wrecks (PRs #26–#30, `alpha-1.12`), Downtown's field-wreck sweep (PR #31, `alpha-1.13`), online lobbies (PR #32, `alpha-1.14`), remote cars (PR #33, `alpha-1.15`), the single-file build with online pause fixes (PRs #34 and #35, `alpha-1.16`), and the lobby cleaned up: who can join, pings, the connection, Quick race without a lobby (PR #36, `alpha-1.17`), and P2P, the online review (docs/ONLINE.md) and the title's flags (PRs #37–#40, `alpha-1.18`). Every release is in [CHANGELOG.md](../CHANGELOG.md): add to its "Unreleased" section as you go, and retitle that section when you tag. What's next is [PLAN.md](./PLAN.md) (phase 1, the quick wins, merged as PR #14; phase 2, the title screen and local lobbies, merged as PR #16; phase 3, license plates, merged as PR #18; phase 4, the car select, merged as PR #20; phase 5, Paradise: parts 1 and 2, the lap, land and scenery, merged as PRs #21 and #22; part 3, weather, sunset, hazards and tuning, merged as PRs #23 and #24; phase 6, landmarks and smashables, merged as PRs #26–#30), and how maps are made is [MAPS.md](./MAPS.md).

**Map names:** City is now **Downtown** and Countryside is **Backroads** (content in
`content/maps/downtown` and `content/maps/backroads`; keys `downtown/downtown`, `backroads/valley`;
old keys still resolve). This file still says City and Countryside in places; they're the same maps.
The third map is **Paradise** (`content/maps/paradise`, key `paradise/island`).

## Resume in five minutes

1. `cd ~/dev/racecar && bun install && bun run dev`, then open http://localhost:5178. For online
   lobbies, also run the gamerelay.io repo's server (`bun run dev` there, :8787), then use two tabs.
2. Read this file, then [ONLINE.md](./ONLINE.md) (how lobbies, hosts, parties and players work),
   SPEC §17 and the milestone 3 notes under "Changed while building".
3. The platform side is ready: SDK `0.1.0-alpha.4` has everything racecar uses (host controls,
   listings, parties, `lanRoute`), and the `racecar` instance has parties and Direct connections
   on (see "GameRelay side" below).
4. Before changing anything: `bun test && bun run typecheck && bun tools/validate.ts --ai`. All
   three are green on `main` (247 tests). Branch off `main`, one PR per change, with CI, then
   `/code-review` on the PR.

## Where things stand

- **Repo:** `gamerelay/racecar`, private until milestone 3, cloned at `~/dev/racecar`. The default
  branch is `main`.
- **Milestone 1 (greybox sandbox): merged** (PR #1).
- **Marketing art and link previews: merged** (PR #17): `poster.html` (dev) stages shots on the
  real renderer, `bun tools/poster.ts` renders them into `marketing/` through headless Chrome,
  and `public/og.png` plus the Open Graph and Twitter tags are on `index.html`. There are also
  favicons, a web manifest and JSON-LD.
- **Cars doc: merged** (PR #15): `docs/CARS.md`, how the cars are designed and built, and adding
  one.
- **Paradise, parts 1–3: merged** (PRs #21–#24, PLAN phase 5, `alpha-1.10` and `alpha-1.11`). Part 1, the
  Island (`tools/gen-paradise.ts`, `content/maps/paradise`): 3.44 km clockwise, a 68.2 s hard-AI
  floor (66.8 s after part 3's Sandbar), the Sandbar and the Lava Tube. The shared lap-laying is
  `tools/lib/lap.ts` (the Valley regenerates byte-for-byte). The land is `buildTerrain` with
  `terrain.island`/`sea`/`volcano`: the sea, a beach, the cone; roads over the sea are decks, so
  the Freeway stands on `deckPillars` over the bay. New surfaces `sand`, `red-earth`,
  `lava-rock`, `shore`; the `tropic` palette with a daytime sky (`day`). The bus's accel went 13
  → 14 for balance. SPEC "Paradise, part 1". Part 2 (PR #22) is the scenery (`island.ts`),
  waves, and a color grade palettes can set in the post pass (Paradise's vivid 2000s-beach look;
  the other maps have none). SPEC "Paradise, part 2". Part 3 (`alpha-1.11`) came in two PRs. The first,
  weather and time (PR #23), adds passing tropical showers (`shower` in a
  map's weather), a sky that clouds over in the rain on every map (`overcast` per palette), the
  `sunset` palette with a lobby Time option (`paletteFor`), and no rain in the Lava Tube
  (`covers`). SPEC "Paradise, part 3a". The second (PR #24) is the hazards and tuning: volcano bombs on the rim (a scheduled kind), coconuts on the beach
  road (a trigger, and a new bump contact, `Solid.Bump`), and the Sandbar re-laid straight along
  the waterline. The old one was most of the field's wrecks. SPEC "Paradise, part 3b". Paradise
  now wrecks the AI field ~1.25 times a race with its hazards (16 seeds), and classes hold ±5%.
  Also in #24, the HUD tweaks: "Powerglide" (was "Drift boost"), a **Superman** for boosting
  through the air (`superT`, 1.5× air pay, `supermanMin`/`supermanPay`), and a bold outline
  on the countdown's numbers. SPEC "HUD tweaks".
- **Smashables: merged** (PR #30, `alpha-1.12`). These close PLAN
  phase 6. Sim pieces (`core/world/smash.ts`), placed from the layout's `smashables` rows, carried
  in snapshots, back 30 s after a hit. A hit pays a pinch of boost and costs a little speed.
  Greybox models in `render/skins/greybox/smash.ts`. SPEC "Smashables".
- **Landmarks, part 3 (Paradise): merged** (PR #29, `alpha-1.12`). A shipwreck, a breaching whale, a surf shack, a tiki head and seaplanes,
  plus the lighthouse beam in the rain. Builders get `ctx.sea`. SPEC "Landmarks, part 3".
- **Landmarks, part 2 (Backroads): merged** (PR #28, `alpha-1.12`). A cow, a water tower (`label`), a scarecrow, a windpump, a drive-in and a
  balloon. The forest keeps their ground (`marks`), and builders get `ctx.ground`. SPEC
  "Landmarks, part 2".
- **Valley field wrecks: merged** (PR #27, `alpha-1.12`).
  The Valley wrecked the field 2.5 times a race over 16 seeds. Traffic now starts past the
  Trestle's legs and the falling sign is gone: 1.13 a race, held by a test. SPEC "The Valley's
  field wrecks". Downtown's sweep (since) found 1.0 a race, not ~1.6: SPEC "Downtown's field
  wrecks".
- **Landmarks, part 1 (Downtown): merged** (PR #26, `alpha-1.12`). Layouts
  carry `landmarks` (kind, at, rot, r, params), built by `render/skins/greybox/landmarks.ts`. The
  validator keeps roads `r` off them, the city leaves their ground empty (`Keep`), and the track
  visual's update gets `SceneLive` (race time, leader plate, wetness). Downtown has a clock tower,
  a leader billboard, a fountain, a donut shop and a canal with a drawbridge. SPEC "Landmarks,
  part 1". Next: Backroads, Paradise, then smashables.
- **Lobby layout: merged** (PR #25, `alpha-1.12`). The seats alone dock left and fit the
  window, the car sits between them and the options (top right, the host's to set; guests see
  chips), arrows and A/D cycle the car, W/S and swatches the paint (`pick-*` menu actions,
  `Menu.pick`), and races default to 2 laps. SPEC "The lobby's layout".
- **Car select: merged** (PR #20, PLAN phase 4, `alpha-1.9`). The lobby docks left and your car turns on a table
  beside it (`src/render/showroom.ts`), a 1:50 model held in front of the world camera, so the
  post pass and weather treat it like the world, framed into the lobby's `.stage` box so CSS places it (beside the menu, or above it
  on a phone). The race behind swaps map and weather in place (`swapMap` in `main.ts`,
  `Sim.setTrack`/`setWeather`, `GameRenderer.setMap`/`setPlates`), under a slow crane camera.
  Stat bars in `src/ui/stats.ts`. SPEC "Car select". 159 tests.
- **Lobby polish: merged** (PR #19): capitalised labels, a spaced subheader, 56 px seat rows, and a
  roomier map card.
- **License plates: merged** (PR #18, PLAN phase 3): your name is a plate (`src/lobby/plate.ts`:
  rules, blocklist, AI plates per class, storage). Every car's plates are drawn from one canvas
  atlas that maps the cars' shared lamp material (`car/plates.ts`), so they cost no draw calls.
  SPEC "License plates". 151 tests.
- **Title screen and local lobbies: merged** (PR #16, PLAN phase 2) and tagged `alpha-1.8`: every race is a lobby. The
  model is `src/lobby/lobby.ts`: a pure `apply(lobby, actor, action)` with the host rules, and
  seats become the race's cars through `roster()`. `LocalBackend` keeps your lobby in
  localStorage. The screens are `src/ui/menu.ts`, and race links carry `seats`
  (`p`/`e`/`n`/`h`/`o`/`x`); old `opponents` links still work. SPEC "Title screen and local
  lobbies". 142 tests.
- **Quick wins: merged** (PR #14, PLAN phase 1): Downtown and Backroads, one-word paints, the HUD
  swap, one control style, MAPS.md and PLAN.md.
- **Police car, Trestle legs, air boost, boost by position: merged** (PR #13) and tagged
  `alpha-1.7`: the Interceptor is the eighth class, the Trestle's legs on the home
  stretch are solid (crash if you clip one), air time pays on a clean landing, boost from moves
  is scaled ×0.9 (leading) to ×1.35 (last), and the contact shadow fades when a car flips. SPEC
  "Police car, Trestle legs, air boost and boost by position". 126 tests.
- **Drift chains, skid marks, the new car designs and a second review pass: merged** (PR #12)
  and tagged `alpha-1.6`: chains that link S-bends and pay boost and a pop, rubber
  on the road, the compact, truck and police designs plus the car polish pass from `car-polish`,
  and the fixes from a four-way review. SPEC "Drift chains and skid marks", "Second review pass".
  113 tests.
- **Valley v3 and smooth shortcut joins: merged** (PR #10) and tagged `alpha-1.5`: the Valley
  re-laid for drifting (more sweepers, wider road, banked corners, grass banks at the edges),
  shortcuts that meet the main road flush on every map, and the HUD's key hints moved to the
  pause menu with a bigger lap badge bottom left. SPEC "Changed while building", Valley v3. 97 tests.
- **Audio and a review pass: merged** (PR #9) and tagged `alpha-1.4`: synthesized audio
  (`src/audio/`: engines, tyres, impacts, cues, a music loop; M mutes, N music) and the fixes
  from a four-way code review (SPEC "Review pass"). 88 tests.
- **Traffic fades instead of popping: merged** (PR #7) and tagged `alpha-1.3`: visibility is part
  of the traffic formula (45 m fades at lane sections and the grid, 1 s back after a wreck), the
  renderer draws fading cars see-through, and `test/traffic.test.ts` holds it (0 pops measured).
  Follow-up: AI resets near the Valley's finish (lap-report seeds 2 and 4), same on `alpha-1.2`
  (now a rate test: at most one reset in six field races; the one left is a car shoved off the
  road the wrong way by the log spill).
- **Seven cars and polish: merged** (PR #6) and tagged `alpha-1.2`:
  - sedan (Cruiser), rally (Mudlark) and bus (Route 88) join as player and AI classes; race
    traffic is drawn from the racer designs (sedan, van, bus, the compact as the hatch);
  - every class balanced to within ±5% of the mean lap on both layouts (`bun tools/lap-report.ts
    --cars`, held by `test/cars.test.ts`), each with a job on the picker; a new `offroad` stat;
  - an mph dial, a Menu button, no rain under roofs, more drift boost, and catch-up boost on
    respawn after a wreck (10% plus up to 50% by how far behind the leader).
- **Countryside v2: merged** (PR #4) and tagged `alpha-1.1`: the Valley rebuilt on real terrain
  (see "The Countryside lap" below).
- **Milestone 2 (the world): merged** (PR #2) and tagged `alpha-1.0`. It contains everything
  below; PR #3 (detailed cars, car ink, visible wrecks) was merged into it first. Just before the
  tag it had a code review, and these were fixed:
  - traffic posed between ticks like the cars;
  - the AI seeing across the start/finish seam;
  - GPU leaks on editor rebuilds;
  - hazard telegraphs firing twice after a restore;
  - rumble and input reaching AI car 0 in attract mode;
  - per-tick closures in the AI;
  - the HUD and minimap redrawing everything each frame.
- **Played by a human:** the owner has driven it and steered the look and tuning (the notes under
  "Changed while building" quote them). Drift, boost and crash feel still want more hands on a
  controller.

### What's built

- **Core sim** (`src/core`): pure TypeScript with no Three.js, DOM or network (a test enforces it).
  It runs at a fixed 60 Hz, keeps cars in a struct-of-arrays pool and allocates nothing per tick.
  An 8-car race with traffic, hazards and rain costs 0.025 ms a tick, and a full race replays
  exactly.
  - **Cars:** eight classes (`content/cars`, in `CLASS_ORDER`), the police Interceptor the latest.
    Grip-alignment handling, and a hold-to-drift that is only a cornering tool. There's no
    mini-turbo; a drift banks boost that a clean release pays into the meter (a spin-out loses
    it). `TUNING.miniTurbo: false` keeps the mini-turbo code for later. Each car carries its slide
    differently (`driftCarry`).
    Boost, air, wrecks with aftertouch, slow-mo, and collisions between cars. Boost is earned
    from drifts and drift chains, air time (paid on a clean landing), near misses, oncoming and
    traffic checks, all scaled by race position (×0.9 leading to ×1.35 last, `earnBoost`).
  - **Track:** baked Catmull-Rom splines with branches for shortcuts. Laps may cross over
    themselves: whole-track searches, pillars and the validator all take height into account.
    With `trestles: true` (the Valley), a bridge high over another road stands on solid legs
    there (`supports` in `bake.ts`, drawn by `forest.ts` on the same grid).
  - **World:** traffic that is a pure function of time and only exists in per-lane sections,
    seeded weather, and hazards (log truck, falling sign).
  - **Racing AI** (`core/ai/racer.ts`): a racing line that threads solid props, path tracking,
    time-to-contact avoidance (judged where the car will be, not just where it's aiming),
    shortcut choice, boost and catch-up. It doesn't drift.
  - **Races:** countdown, perfect start or stall, laps, finish order.
- **Rendering** (`src/render`, and the greybox skin in `src/render/skins/greybox`):
  - **Cel look:** a three-step toon ramp, and ink outlines drawn in the post pass from depth
    (`post.ts`). A second outline pass, for cars only, inks windows, panels and creases (`ink.ts`).
  - **Screen effects:** speed blur, color split, boost speed lines, slow-mo grade, vignette, grain.
  - **Wet reflections** in the post pass: a streaky sheen on every flat surface, and sharp mirrors
    in puddles. Puddles clear the render target's alpha, which is the post pass's mirror mask.
  - **Cars** (`car/build.ts`, `designs.ts`, `paint.ts`, `wreck.ts`): profile-extruded bodies with
    per-class rear detail and paint finishes. Wrecks crumple the body, throw parts and spray
    shards; respawn repairs the car. The contact shadow fades when a car flips or flies
    (`car/shadow.ts`).
  - **Traffic** (`car/traffic.ts`): sedan, compact, van, box truck and bus in the same style. Each
    kind is one instanced draw; a vertex mask picks which parts take the paint and which glow.
  - **City** (`cityscape.ts`, `city.ts`, `track.ts`):
    - A street grid out to the fog, with buildings by district, rooftop clutter, neon blade signs,
      billboards, awnings, parked and background cars, trees, lamps, steam, blinking lights and
      searchlights.
    - Raised roads are decks on pillars with a steel railing, sunken roads are trenches, and deep
      ones are a lit tunnel with portals.
    - The Alley has shopfronts and strung lights.
    - All of it is built from the track, not authored, and it's the same every race.
  - **Countryside** (`terrain.ts`, `forest.ts`, `track.ts`):
    - Real land: a heightfield that meets every road, with hills and mountains beyond and the river
      carved in, drawn as water that mirrors in any weather.
    - Roads over the river or over another road come out as bridges: a covered bridge for a short
      crossing, timber trestle bents for a long, high one.
    - Pine forest with clearings and autumn broadleaves; the village (houses with windows and
      smoking chimneys, a church, a sawmill, pastures), the barn over the Barn shortcut.
    - Chevrons round every tight corner, telegraph poles and wires, a fire lookout, a campsite with
      a fire and fireflies, birds, and mist on the river.
    - Dirt roads have ruts and timber guardrails, and cars throw dust on dirt and clods off grass.
- **UI** (`src/ui`): a setup menu over an attract-mode AI race (the setup lives in the URL), HUD,
  countdown lights, results table and minimap.
- **Tools:**
  - The level editor (backquote key).
  - A live tuning panel (F4).
  - F8 "felt wrong?" reports, replayed headless with `bun tools/replay.ts`.
  - Local telemetry as JSONL files.
  - A PostHog sink, off until `VITE_POSTHOG_KEY` is set.
  - The garage at `/cars.html`: every car and traffic kind on a road with the game's post effects.
    T shows traffic, W crashes a car.

### Numbers to know

| | City (Downtown) | Countryside (Valley) | Paradise (Island) |
|---|---|---|---|
| Lap length | 3.26 km | 2.92 km | 3.44 km |
| AI lap floor (hard, empty track) | 58.6 s | 63.4 s | 66.8 s |
| Wrecks per 8-AI race (`lap-report --field --seed N`) | 1.0, 16 seeds (0.88 on seeds 1–8) | 1.13, 16 seeds (0.88 on seeds 1–8) | ~1.2 with the hazards, 16 seeds (0.5 without) |
| Draw calls | ~90–415 | ~65–330 | ~35–150 for the world; ~350 in the chase view with the field on screen (mostly cars) |
| Scenery build (per editor edit) | ~200 ms | ~150 ms | ~600 ms (land and scenery, measured in bun) |

The game holds 120 fps (the display's cap) on the dev Mac, rain included. The frame rate hasn't
been measured since the detailed cars went in, so watch it. City has 150 draw calls on the grid in
the rain with all 8 new cars, and up to ~415 with detailed traffic around (60 fps in a background
tab, which is Chrome's cap there).

### The City lap (v2), in order

- **Boulevard:** four lanes, traffic, and the finish line. The Skyway crosses overhead on pillars
  in the median; the median pillars are a takedown spot.
- **Climb:** an avenue ramp up to the Skyway.
- **Skyway:** 12 m up. A long banked right-hand sweeper, then a two-way straight with traffic that
  crosses over the Boulevard. Railings let you see down.
- **Market:** street level. Tight two-lane streets, a stone hump bridge to fly off, and the Alley
  shortcut through the middle.
- **Underpass:** a sunken road into a covered tunnel (neon strips, orange lamps, portals), then up
  over a crest just before the line.

The City layout is generated by `tools/gen-city.ts`. Rerunning it overwrites hand edits made in the
editor.

### The Countryside lap (Valley v3), in order

- **The Village:** the start, on the asphalt river road with traffic, then a flowing S through the
  village square. The **Barn** shortcut goes straight on through the barn.
- **The Covered Bridge:** a long right onto the bridge over the river, then two sweepers.
- **The Switchbacks:** dirt, three hairpins up the ridge's flank, each leg with a flick in it,
  with guardrails.
- **The Ridge:** dirt along the top at about 52 m, sweeping over two crests with kickers.
  **Logger's Leap** jumps off the edge to cut the corner onto the Descent.
- **The Descent:** asphalt S-bends down, then a curve onto **the Trestle**, straight and high over
  the river and the start road, with traffic. Its legs stand on the home stretch below: three
  rows to thread, and solid.
- **Pine Hollow:** dirt hairpins down to the flats. The **Creek Bed** cuts across the stream
  (always wet). A kink puts you onto the home straight.

`tools/gen-countryside.ts` generates it; the river's course is `terrain` in the layout.

### The Paradise lap (Island), in order

Clockwise round a tropical island, the volcano in the middle and the sea all round.

- **Harbor Town:** the start on the harbour front, two-way traffic, pastel houses both sides,
  the tiki bar on the sand and the pier with fishing boats. A flowing S out of town.
- **Coconut Coast:** the wide beach road (18.5 m, 20 in the sweepers) up the west shore, palms
  leaning over it, round a headland inland. The **Sandbar** runs straight on along the
  waterline on loose sand, with a dune to jump and wet sand (`shore`) at the water's edge.
  Coconuts drop off the palms before it.
- **The Freeway:** up a ramp to a deck 10–14 m over the bay, one long banked sweep round the
  north shore on concrete pillars. It's one-way, both lanes with the race, and the traffic
  keeps to the straights either side of its bend.
- **Jungle Switchbacks:** off the deck into the jungle, two wide hairpins on red earth, under a
  rope bridge, past a waterfall.
- **Volcano Rim:** the climb round the cone's flank on lava rock, over the shoulder's crest. The
  **Lava Tube** cuts through inside it, roofed with rock and lit by lava. Volcano bombs land on
  the rim road's last stretch, which the tube skips.
- **Lighthouse Point:** a jump off the rim, the lighthouse on its point, the cliff road, and the
  S back into town.

`tools/gen-paradise.ts` generates it on `tools/lib/lap.ts`; the coastline, sea and volcano are
`terrain` in the layout, and the dressing is `island.ts`.

## GameRelay side (the platform asks, SPEC §11)

- **Host controls are live:** asleepace/gamerelay.io PR #30 (`room-host-controls`) is merged and
  deployed, and **SDK `0.1.0-alpha.4`** is released with them (see the gamerelay HANDOFF):
  - `room.kick`, `room.setAccess({ locked, public, maxPlayers })`, `room.setListing({ name, meta })`
    and `room.transferHost`;
  - the server browser: `listRooms` with listing info, including full rooms;
  - a player kicked while offline gets `closed('kicked', message)` when they reconnect.
- Bans are per player id (lock the room to keep strangers out), and games render room names and
  meta as text.
- So milestone 3's lobby isn't blocked on the platform any more: the `relay` LobbyBackend can be
  built against the published SDK.
- **The `racecar` instance** (`ins_qnGcfcjInJCg8dTr`, 8 players): parties on, Direct
  connections on (for P2P), allowed origins `http://localhost` and `https://asleepace.com`. Its
  public key is in `.env.production`.
- **Asks, none blocking** (ONLINE.md "Asks for GameRelay"):
  - direct connections between a room's players, with no party (a party drags its members into
    its leader's next room, so racecar has to make sure it never outlives the lobby);
  - whether a direct channel is across one network or over the internet, and a relayed one's
    region, so the connection button can say LAN, P2P or the region (it says P2P, Relay or
    Server today);
  - seat reservations for invite links.

## Hosted test build

- **https://asleepace.com/games/Z442EE** (since 2026-10-01): asleepace.com's games library, a
  row in its `games` table (title Racecar, the marketing screenshot as its cover and link
  preview, public, marked multiplayer). Online lobbies run on gamerelay.io's `racecar` instance,
  whose allowed origins are `http://localhost` and `https://asleepace.com`.
- **The file:** `bun run build:single` → `dist-single/racecar.html`, the production build as one
  classic script with the CSS inline (asleepace.com takes a game as one HTML document, and its
  sanitizer checks each inline script with `new Function`, so no modules). It leaves out the
  page's own preview tags and icons; the host adds them from the row.
- **Update it** (asleepace.com repo, its `publishing-games` skill): run the sanitizer on the new
  file, then `UPDATE games SET html = … WHERE id = 'Z442EE'`. It's live at once; players get it
  when they reload. Don't run its multiplayer injection: racecar brings GameRelay's SDK.
- **What's there now:** `main` at PR #40 (alpha-1.17 plus P2P, the online review and the title's flags), updated 2026-10-01. Keep it the
  one row: update Z442EE in place rather than adding a game.

## Next, in order

1. **PLAN phase 6 is done** (PRs #26–#30, merged and tagged `alpha-1.12`): the last of PLAN's
   phases. Worth doing next:
   - Downtown's field wrecks were swept: 1.0 a race over 16 seeds (the ~1.6 was stale), so no
     map is over MAPS.md's 1.5 and nothing moved. A test holds it (SPEC "Downtown's field wrecks").
   - gamerelay.io's four audit follow-ups (its PR #35) are merged and deployed (production on
     `df1f6a2`). The relays didn't need it: they run the Rust `resonance-node`, which already
     metered signed requests.
   - PLAN's "Other ideas" (stunt air, rivals, map vote cards...).
2. **Milestone 3 (online).** How it all works, end to end, and what Xbox Live does for each
   part: [ONLINE.md](./ONLINE.md). Done so far:
   - **Online lobbies** (PR #32, `alpha-1.14`): a lobby is a room (`src/lobby/relay.ts`), the
     SDK's host applies everyone's actions with `apply`, Start takes everyone into the same race,
     and the race page keeps the seat.
   - **Remote cars** (PR #33, `alpha-1.15`): each player's car is an entity at 30 Hz
     (`src/net/cars.ts`), a remote car in everyone else's sim, predicted to now. Green is on the
     server's clock.
   - **The lobby, cleaned up** (PR #36, `alpha-1.17`): Public, Invite only or Private (the host
     cycles it from the header), only Public listed, your own lobby local and closed when you
     leave, Quick race without a lobby, a ping per player and the connection type, your plate
     editable from your seat, a random car when you sit down. As it was signed off:
     `screenshots/lobby-desktop.png`.
   - **P2P** (PRs #37 and #38, `alpha-1.18`): each online lobby is also a party (`Lobby.party`,
     `src/lobby/party.ts`), and the client connects with `lan: { direct: 'party' }`. It shows
     players each other's IP, without asking.
   - **The online review** (PR #39, `alpha-1.18`): the SDK host role moving re-tidies the lobby
     (`host_changed`), room changes run one at a time, a join the menu gives up on leaves, Away
     for a dropped player, and relay.ts split into wire, party, presence and relay.

   Next, in order:
   - **The AIs as host-owned `rival` entities**, so every screen has the same bots (today each
     screen runs its own).
   - **Traffic hits through `room.claim`**, then bump dedupe (±150 ms) and wreck credit (the
     victim decides wrecks already).
   - **Results written by the host** (Xbox's arbitration), so everyone's results agree.
   - **Names over cars** within ~60 m, from player data (PLAN phase 3).
   - **A vote on the next race**, and a net overlay.
   - **Before the repo goes public:** a P2P opt-in (it shows IPs today), and seat reservations
     for invite links if GameRelay adds them.
   - The repo goes public. Then milestone 3b: the neon City skin, which is the launch.
3. **Playtest with a controller** whenever there's a build to try: tune with F4, and press F8 on
   anything odd. Still open: whether ~1 wreck a race on Downtown is too tame (add denser traffic
   on the straights rather than sections in corners), and whether each car's drift carry feels
   right (`driftExit*`, `boostFromDrift`).

### Smaller follow-ups

- From the review, not done yet (organization and perf, no bugs):
  - One road spatial index for `cityscape.ts` (Corridors), `forest.ts`, `island.ts` and
    `terrain.ts` (the forest and the island each hash the road the same way); one instancing
    builder for `scenery.boxes()` and `forest.instanced()` (the island uses the latter); a
    `gantry()` helper.
  - Tile the Valley's terrain (one 256k-triangle mesh, never culled); upload only live ambient
    cars and particles instead of whole buffers each frame.
  - Touch controls: phones can't drive yet.

- Traffic has silhouette ink only: no window or panel ink, and no crumple on wreck.
- City has 4 puddles, all in corners; a few on straights would add rain atmosphere.
- The tunnel lost its traffic section, which was too short to keep a straight at both ends.
- The AI never drifts, so it never earns drift boost. That's an edge for a player who drifts
  well; a drifting AI needs its drift controller tuned against the lap report.
- Ambient city cars could animate in the vertex shader instead of on the CPU (they're only posed
  within 420 m of the camera). Out-of-range ones are still written as zero-scale instances and the
  whole buffer is uploaded each frame: write the near ones compactly and set `count` instead.
- From PR #13:
  - Logs from the log truck's spill roll through the Trestle's legs (hazard pieces don't collide
    with props). The one AI reset left in the field tests is a car the spill shoved off the road
    the wrong way.
  - The police car's lights always flash; a siren and a pursuit mode would suit it.
  - A wrecked car sitting on its wheels loses its shadow too (it goes with `onRoad`).
- From the second review (2026-09-30), not done:
  - Split the two biggest functions: `buildCar` (`car/build.ts`, ~665 lines: body, cabin, lamps,
    wheels, glows) and `buildCityscape` (`cityscape.ts`, ~675: buildings, signs, streets, ambience).
  - A shared `lateralOf(sp, i, x, z)` in `query.ts` for the ~8 hand-written lateral projections.
  - `logTruck.at` rescans traffic every tick for its truck: remember it on the occurrence.
  - `src/content.ts` (the bundle loader) and `src/core/content.ts` (types) share a name.
  - Unused surfaces (`ice`, `oil`, `lava-crust`, `boost-pad`) wait for a map that uses them.
  - Downtown's and the Valley's lap floors (58.6, 63.4 s) are under SPEC's 70–100 s target;
    Paradise's (68.2 s) is close. Validate warns only under 55 s.
- From Paradise part 2: the land over the Lava Tube is still cut open (every road caps the land
  below it), so the tube reads as a roofed cutting, not a tunnel under the cone. A branch that's
  a tunnel would need to leave the land alone over its middle and draw portals.
- The falling sign's and log truck's markers use the road's centre height, like the bombs did
  before; on a banked stretch their rings would sink. Neither sits on a steep bank today.
- Loading a layout builds the whole City in about 200 ms. That's fine per editor edit (edits
  apply when you let go of a point); if it ever runs per frame, cache it.

## Working notes

- **Testing in Chrome.** A background tab pauses requestAnimationFrame, so drive the game
  through the dev hook:
  - `window.__rc.advance(seconds, controls)` steps the sim and renders one frame.
  - `__rc.sim.racers[0] = { difficulty: 2 }` lets the AI drive your car, e.g. to reach the results
    screen.
  - `__rc.renderer.freeCamera = true` leaves the camera where you put it, for fly-overs and
    screenshots.
  - `__rc.sim.placeCar(i, spline, s, lateral, speed)` teleports a car.
- **Testing online in Chrome:** two tabs are two players (the local server: `bun run dev` in
  ~/dev/gamerelay.io). A hidden tab doesn't run the net hooks until you `__rc.advance` it, and
  the extension's key presses don't reach the page (dispatch `KeyboardEvent`s on `window`, or click
  through `document.getElementById(...)`). On the race page, `__rc.net.room` is the SDK's room
  (`lanRoute`, `players`). To drop a player's connection without leaving (Away, then their seat
  freed after the server's 30 s grace), send their tab to another site; the extension can't open
  `about:blank`.
- **After `/code-review`,** check the repo is still on your branch: a review once left it on a
  detached HEAD.
- **URL flags:** `&ink=0`, `&post=0`, `&trace=1`. A race's whole setup, weather included, lives in
  the query string.
- **Checks worth running after track or AI changes:**
  - `bun tools/validate.ts --ai`: layout rules and the AI lap floor.
  - `bun tools/lap-report.ts [layout] --field`: an 8-AI race with wreck locations.
  - The validator warns when a traffic section ends in a corner.
    `bun tools/fix-traffic.ts <layout>` moves the ends onto straights, and `gen-city.ts` does it
    automatically.
- **Content generators:** `tools/gen-city.ts`, `tools/gen-countryside.ts` and
  `tools/gen-paradise.ts` overwrite their layouts. The last two lay laps with `tools/lib/lap.ts`.
- **Dev server:** restart it after changing `vite.config.ts` (the `__BUILD_TIME__` define).
- **Diagnosing AI:** `debugAi(true)` in `core/ai/racer.ts` records each AI's last decision.
- **Conventions:**
  - Build over plan: the spec is a loose outline.
  - Record design changes in the spec's "Changed while building".
  - Each milestone is a PR with CI.
  - Merge, deploy and release only when the owner asks.
  - Notes go in SPEC "Changed while building", CHANGELOG "Unreleased" and here.
  - `git add -A` would sweep up `dist-single/` if `.gitignore` didn't list it (it does).
