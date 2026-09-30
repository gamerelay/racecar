# Handoff

Where racecar stands and what's next, for whoever picks it up (a person or a fresh Claude session).
The design is [SPEC.md](./SPEC.md): decisions in §17, and what building changed in "Changed while
building". This file is "where are we"; the spec is "what are we making".

**Last updated:** 2026-09-30. `main` is tagged **`alpha-1.4`**: milestone 2 (PR #2, tagged
`alpha-1.0`), Countryside v2 (PR #4, `alpha-1.1`), seven cars plus polish (PR #6, `alpha-1.2`),
traffic that fades instead of popping (PR #7, `alpha-1.3`), and audio plus a review pass (PR #9).

## Resume in five minutes

1. `cd ~/dev/racecar && bun install && bun run dev`, then open http://localhost:5178.
2. Read this file, then SPEC §17 and the milestone 2 notes under "Changed while building".
3. Check the open platform PR: in `~/dev/gamerelay.io`, `gh pr view 30` (the host controls
   racecar's lobby needs).
4. Before changing anything: `bun test && bun run typecheck && bun tools/validate.ts`. All three
   are green on `main` at `alpha-1.4`. Branch off `main` for milestone 3.

## Where things stand

- **Repo:** `gamerelay/racecar`, private until milestone 3, cloned at `~/dev/racecar`. The default
  branch is `main`.
- **Milestone 1 (greybox sandbox): merged** (PR #1).
- **Valley v3 and smooth shortcut joins: on branch `valley-v3`** (PR, not merged): the Valley
  re-laid for drifting (more sweepers, wider road, banked corners, grass banks at the edges) and
  shortcuts that meet the main road flush on every map. SPEC "Changed while building", Valley v3.
- **Audio and a review pass: merged** (PR #9) and tagged `alpha-1.4`: synthesized audio
  (`src/audio/`: engines, tyres, impacts, cues, a music loop; M mutes, N music) and the fixes
  from a four-way code review (SPEC "Review pass"). 88 tests.
- **Traffic fades instead of popping: merged** (PR #7) and tagged `alpha-1.3`: visibility is part
  of the traffic formula (45 m fades at lane sections and the grid, 1 s back after a wreck), the
  renderer draws fading cars see-through, and `test/traffic.test.ts` holds it (0 pops measured).
  Follow-up: AI resets near the Valley's finish (lap-report seeds 2 and 4), same on `alpha-1.2`.
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
  - **Cars:** grip-alignment handling, and a hold-to-drift that is only a cornering tool. There's no
    mini-turbo; a drift banks boost that a clean release pays into the meter (a spin-out loses
    it). `TUNING.miniTurbo: false` keeps the mini-turbo code for later. Each car carries its slide
    differently (`driftCarry`).
    Boost, air, wrecks with aftertouch, slow-mo, and collisions between cars.
  - **Track:** baked Catmull-Rom splines with branches for shortcuts. Laps may cross over
    themselves: whole-track searches, pillars and the validator all take height into account.
  - **World:** traffic that is a pure function of time and only exists in per-lane sections,
    seeded weather, and hazards (log truck, falling sign).
  - **Racing AI** (`core/ai/racer.ts`): racing line, path tracking, time-to-contact avoidance,
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
    shards; respawn repairs the car.
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

| | City (Downtown) | Countryside (Valley) |
|---|---|---|
| Lap length | 3.26 km | 2.88 km |
| AI lap floor (hard, empty track) | 58.8 s | 68.2 s |
| Wrecks per 8-AI race (8 seeds; `lap-report --field --seed N`) | ~1 | ~1.6 |
| Draw calls | ~90–415 | ~65–330 |
| Scenery build (per editor edit) | ~200 ms | ~150 ms |

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

### The Countryside lap (Valley v2), in order

- **The Village:** the start, on the asphalt river road with traffic, then an S through the
  village square. The **Barn** shortcut goes straight on through the barn.
- **The Covered Bridge:** right over the river.
- **The Switchbacks:** dirt, four hairpins up the ridge's flank, 45 m of climb, with guardrails.
- **The Ridge:** dirt along the top at about 52 m. Two kickers sit on crests (the first gives
  about 0.9 s of air). **Logger's Leap** jumps off the edge to cut the corner onto the Descent.
- **The Descent:** asphalt S-bends down to **the Trestle**, 27 m over the river and over the start
  road, which runs under it.
- **Pine Hollow:** dirt hairpins down to the flats. The **Creek Bed** cuts across the stream
  (always wet) and drops you onto the run home.

`tools/gen-countryside.ts` generates it; the river's course is `terrain` in the layout.

## GameRelay side (the platform asks, SPEC §11)

- **asleepace/gamerelay.io PR #30** (`room-host-controls`), open, 2 commits:
  - `room.kick`, `room.setAccess({ locked, public, maxPlayers })`, `room.setListing({ name, meta })`
    and `room.transferHost`.
  - `relay.listRooms(tag, { includeFull })`, whose listings gain name, meta, locked and hostName,
    and `relay.online()`. New error code `locked`.
- **The six review fixes have landed** (commit `5aca55c`):
  - A refused join (locked, full or banned) leaves the player in the room they were in.
  - A party only moves if every member can get in, and the error names the member who can't.
  - A player kicked while offline ends with `closed('kicked', message)` when they reconnect.
  - Docs: bans are per player id (lock the room to keep strangers out), and games should render
    room names and meta as text.
  - Host kicks are logged with who did it.
- **Tests:** 914 pass, 0 fail; the end-to-end suite has 33 pass. One transfer-host test failed once
  in three full runs under load, noted in the PR.
- **Not done:** not merged, deployed or released. Racecar's lobby needs the server deployed and an
  SDK alpha published (`docs/PUBLISH.md` in gamerelay.io). Deploy only when the owner asks.

## Next, in order

1. **Playtest milestone 2 with a controller.** Tune with F4, and press F8 on anything odd. Two
   things to decide:
   - Is ~1 wreck a race on City too tame now that traffic can't pop in on corners? If so, add
     denser traffic on the straights rather than moving section ends back into corners.
   - Drift boost is banked and paid on a clean release, and the slide carries after release,
     with each car set differently by `driftCarry`. Does each car feel right? Tune it with the
     `driftExit*` values and `boostFromDrift` in F4.
2. **Finish PR #30:** merge, deploy (only when asked; see the gamerelay HANDOFF and deploy notes),
   then release an SDK alpha with the host controls.
3. **Milestone 3 (online), per the spec:**
   - A lobby list (`listRooms('race', { includeFull: true })`) and hosting a party.
   - A party screen with Civilization-style seats (Open, AI with a difficulty, Closed).
   - The `net/` layer:
     - car entities at 30 Hz with steer and throttle, and prediction in-game,
     - bump dedupe within ±150 ms, and the victim decides wrecks,
     - traffic hits and triggers resolved with `room.claim`,
     - shared moments scheduled about 250 ms ahead on the server clock.
   - A vote on the next race, a net overlay, and bots. The repo goes public.
   - Then milestone 3b: the neon City skin, which is the launch.

### Smaller follow-ups

- From the review, not done yet (organization and perf, no bugs):
  - One road spatial index for `cityscape.ts` (Corridors), `forest.ts` and `terrain.ts`; one
    instancing builder for `scenery.boxes()` and `forest.instanced()`; a `gantry()` helper.
  - Tile the Valley's terrain (one 256k-triangle mesh, never culled); upload only live ambient
    cars and particles instead of whole buffers each frame.
  - Touch controls: phones can't drive yet.

- Traffic has silhouette ink only: no window or panel ink, and no crumple on wreck.
- City has 4 puddles, all in corners; a few on straights would add rain atmosphere.
- The tunnel lost its traffic section, which was too short to keep a straight at both ends.
- The AI never drifts, so it never earns drift boost. That's an edge for a player who drifts
  well; a drifting AI needs its drift controller tuned against the lap report.
- Review leftovers, not done:
  - A shared `instanced(geo, mat, items, pose)` helper would replace about 8 hand-rolled
    instanced-mesh setups in `cityscape.ts`, `track.ts` and `world.ts`.
  - Ambient city cars could animate in the vertex shader instead of on the CPU. They're now only
    posed within 420 m of the camera.
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
- **URL flags:** `&ink=0`, `&post=0`, `&trace=1`. A race's whole setup, weather included, lives in
  the query string.
- **Checks worth running after track or AI changes:**
  - `bun tools/validate.ts --ai`: layout rules and the AI lap floor.
  - `bun tools/lap-report.ts [layout] --field`: an 8-AI race with wreck locations.
  - The validator warns when a traffic section ends in a corner.
    `bun tools/fix-traffic.ts <layout>` moves the ends onto straights, and `gen-city.ts` does it
    automatically.
- **Content generators:** `tools/gen-city.ts` and `tools/gen-countryside.ts` overwrite their
  layouts.
- **Dev server:** restart it after changing `vite.config.ts` (the `__BUILD_TIME__` define).
- **Diagnosing AI:** `debugAi(true)` in `core/ai/racer.ts` records each AI's last decision.
- **Conventions:**
  - Build over plan: the spec is a loose outline.
  - Record design changes in the spec's "Changed while building".
  - Each milestone is a PR with CI.
  - Merge, deploy and release only when the owner asks.
