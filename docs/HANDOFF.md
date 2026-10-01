# Handoff

Where racecar stands and what's next, for whoever picks it up (a person or a fresh Claude session).
The design is [SPEC.md](./SPEC.md): decisions in §17, and what building changed in "Changed while
building". This file is "where are we"; the spec is "what are we making".

**Last updated:** 2026-10-01. `main` is tagged **`alpha-1.21`** (PRs #43–#45: a cleanup pass, the soundtrack, and the music from the games CDN).
Every release is in [CHANGELOG.md](../CHANGELOG.md): add to its "Unreleased" section as you go,
and retitle that section when you tag. [PLAN.md](./PLAN.md)'s six phases are all merged (it keeps
a pool of other ideas), how online works is [ONLINE.md](./ONLINE.md), and how maps are made is
[MAPS.md](./MAPS.md).

**Map names:** City is now **Downtown** and Countryside is **Backroads** (content in
`content/maps/downtown` and `content/maps/backroads`; keys `downtown/downtown`, `backroads/valley`;
old keys still resolve). The third map is **Paradise** (`content/maps/paradise`, key
`paradise/island`).

## Resume in five minutes

1. `cd ~/dev/racecar && bun install && bun run dev`, then open http://localhost:5178. For online
   lobbies, also run the gamerelay.io repo's server (`bun run dev` there, :8787), then use two tabs.
2. Read this file, then [ONLINE.md](./ONLINE.md) (how lobbies, hosts, parties and players work),
   SPEC §17 and the milestone 3 notes under "Changed while building".
3. The platform side is ready: SDK `0.1.0-alpha.4` has everything racecar uses (host controls,
   listings, parties, `lanRoute`), and the `racecar` instance has parties and Direct connections
   on (see "GameRelay side" below).
4. Before changing anything: `bun test && bun run typecheck && bun tools/validate.ts --ai`. All
   three are green on `main`. Branch off `main`, one PR per change, with CI, then
   `/code-review` on the PR.

## Where things stand

- **Repo:** `gamerelay/racecar`, private until milestone 3, cloned at `~/dev/racecar`. The default
  branch is `main`.
- **Milestones 1 and 2 are merged** (PRs #1 and #2, `alpha-1.0`), and so are all six of
  [PLAN.md](./PLAN.md)'s phases (PRs #14–#30, `alpha-1.8` to `alpha-1.12`).
- **Milestone 3 (online) is under way:** online lobbies, remote cars, P2P and the host's AIs are
  in (PRs #32–#42, `alpha-1.14` to `alpha-1.19`). What's left is the milestone 3 list under "Next,
  in order".
- **What exists, by area** (details in "What's built" below and in SPEC "Changed while
  building"):
  - **Maps:** Downtown, Backroads and Paradise, each with landmarks and smashables, traffic,
    hazards and weather. Paradise has passing showers and a sunset (the lobby's Time option).
  - **Cars:** eight classes, each within ±5% of the mean lap, with paints and license plates
    (your name is a plate). How they're built is [CARS.md](./CARS.md).
  - **Front door:** the title screen with the lobby list, Create lobby, the lobby (seats,
    options, the car turning on a table) and the plate editor. Quick race skips lobbies.
  - **Online:** a lobby is a GameRelay room (and a party, for P2P); other players' cars and the
    host's AIs are entities. [ONLINE.md](./ONLINE.md) has the whole picture.
  - **Art and hosting:** marketing shots and link previews (`poster.html`, `bun tools/poster.ts`,
    `public/og.png`), and the hosted test build (below).
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
    seeded weather (with Paradise's passing showers), hazards (the log truck on Downtown and
    Backroads, the falling sign on Downtown only, volcano bombs and coconuts on Paradise), and
    smashables (`core/world/smash.ts`).
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
  - **Downtown** (`cityscape.ts`, `city.ts`, `track.ts`):
    - A street grid out to the fog, with buildings by district, rooftop clutter, neon blade signs,
      billboards, awnings, parked and background cars, trees, lamps, steam, blinking lights and
      searchlights.
    - Raised roads are decks on pillars with a steel railing, sunken roads are trenches, and deep
      ones are a lit tunnel with portals.
    - The Alley has shopfronts and strung lights.
    - All of it is built from the track, not authored, and it's the same every race.
  - **Backroads** (`terrain.ts`, `forest.ts`, `track.ts`):
    - Real land: a heightfield that meets every road, with hills and mountains beyond and the river
      carved in, drawn as water that mirrors in any weather.
    - Roads over the river or over another road come out as bridges: a covered bridge for a short
      crossing, timber trestle bents for a long, high one.
    - Pine forest with clearings and autumn broadleaves; the village (houses with windows and
      smoking chimneys, a church, a sawmill, pastures), the barn over the Barn shortcut.
    - Chevrons round every tight corner, telegraph poles and wires, a fire lookout, a campsite with
      a fire and fireflies, birds, and mist on the river.
    - Dirt roads have ruts and timber guardrails, and cars throw dust on dirt and clods off grass.
  - **Paradise** (`island.ts`, `terrain.ts`, `track.ts`): the island's land, sea and volcano
    (`terrain.island`/`sea`/`volcano`), beaches and waves, palms and jungle, the Freeway on
    pillars over the bay, and a colour grade in the post pass.
  - **Landmarks and smashables** (`landmarks.ts`, `smash.ts`): built from layout data, a few
    instanced draws each.
- **UI** (`src/ui`): the title screen with the lobby list, Create lobby, the lobby with a car
  select (your car on a turntable, `src/render/showroom.ts`, with stat bars) and the plate
  editor (`menu.ts`), all over a live AI race on the lobby's map. Then the HUD, countdown lights,
  results table and minimap. A race's whole setup lives in the URL (`setup.ts`).
- **Lobbies** (`src/lobby`): the lobby model and its host rules (`lobby.ts`, one `apply`), your
  own lobby in localStorage or a GameRelay room (`backend.ts`, `relay.ts`), the P2P party
  (`party.ts`), pings and Away (`presence.ts`), checking what other players send (`wire.ts`), and
  plates (`plate.ts`). How it works: [ONLINE.md](./ONLINE.md).
- **Online race** (`src/net`): each player's car is an entity, a remote car in everyone else's
  sim (`cars.ts`), and the SDK's host drives the AIs for everyone as `rival` entities
  (`rivals.ts`). See [ONLINE.md](./ONLINE.md).
- **Tools:**
  - The level editor (backquote key).
  - A live tuning panel (F4).
  - F8 "felt wrong?" reports, replayed headless with `bun tools/replay.ts`.
  - Local telemetry as JSONL files.
  - A PostHog sink, off until `VITE_POSTHOG_KEY` is set.
  - The garage at `/cars.html`: every car and traffic kind on a road with the game's post effects.
    T shows traffic, W crashes a car.

### Numbers to know

| | Downtown | Backroads (Valley) | Paradise (Island) |
|---|---|---|---|
| Lap length | 3.26 km | 2.92 km | 3.44 km |
| AI lap floor (hard, empty track) | 58.6 s | 63.4 s | 66.8 s |
| Wrecks per 8-AI race (`lap-report --field --seed N`) | 1.0, 16 seeds (0.88 on seeds 1–8) | 1.13, 16 seeds (0.88 on seeds 1–8) | ~1.2 with the hazards, 16 seeds (0.5 without) |
| Draw calls | ~90–415 | ~65–330 | ~35–150 for the world; ~350 in the chase view with the field on screen (mostly cars) |
| Scenery build (per editor edit) | ~200 ms | ~150 ms | ~600 ms (land and scenery, measured in bun) |

The game holds 120 fps (the display's cap) on the dev Mac, rain included. The frame rate hasn't
been measured since the detailed cars went in, so watch it. Downtown has 150 draw calls on the grid in
the rain with all 8 new cars, and up to ~415 with detailed traffic around (60 fps in a background
tab, which is Chrome's cap there).

### The Downtown lap (v2), in order

- **Boulevard:** four lanes, traffic, and the finish line. The Skyway crosses overhead on pillars
  in the median; the median pillars are a takedown spot.
- **Climb:** an avenue ramp up to the Skyway.
- **Skyway:** 12 m up. A long banked right-hand sweeper, then a two-way straight with traffic that
  crosses over the Boulevard. Railings let you see down.
- **Market:** street level. Tight two-lane streets, a stone hump bridge to fly off, and the Alley
  shortcut through the middle.
- **Underpass:** a sunken road into a covered tunnel (neon strips, orange lamps, portals), then up
  over a crest just before the line.

The Downtown layout is generated by `tools/gen-city.ts`. Rerunning it overwrites hand edits made in the
editor.

### The Backroads lap (Valley v3), in order

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
- **The music** (17 MB) isn't in the single file: it's on the games CDN,
  **https://cdn.gamerelay.io/racecar/music/** (`VITE_MUSIC_URL` in `.env.production`).
  - **The CDN** is gamerelay.io's caching proxy (its `apps/server/src/cdn.ts`; setup and
    behaviour in its `docs/INFRASTRUCTURE.md`, "Asset CDN", live since 2026-10-01). It fronts the
    asset store, a DigitalOcean Space (`asleepace-storage-bucket`, sfo3): `cdn.gamerelay.io/<x>`
    is the Space's `assets/<x>`. Other sites get their own `assets/<name>/`.
  - **Upload:** `bun --env-file=../asleepace.com/.env tools/publish-assets.ts` (`--dry` to see,
    `--cors` to set the Space's CORS rule again). To change a track, give it a new name, or wait:
    the proxy keeps a file 10 minutes, browsers an hour.
  - **Why not the Space's own CDN** (`….cdn.digitaloceanspaces.com`): it caches one copy per URL
    whatever the request's Origin, and the Space only sends the CORS header to a request with an
    Origin, so a plain request (a link, a curl) leaves a copy without it, and Web Audio can't play
    the track for an hour. The proxy always sends it.
  - **CORS on the Space** (GET and HEAD from any origin) stays: it lets a build read the Space's
    origin directly too, if the CDN is ever down.
- **What's there now:** `main` after `alpha-1.21` (PR #46: the online race on `relay.tick`), updated 2026-10-01. Keep it the
  one row: update Z442EE in place rather than adding a game.

## Next, in order

1. **Milestone 3 (online).** How it all works, end to end, and what Xbox Live does for each
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
   - **The AIs online** (PR #42, `alpha-1.19`): the SDK's host drives the AIs and sends them as
     `rival` host entities (`src/net/rivals.ts`), so every screen has the same bots; the next host
     drives them on.
   - **The cleanup pass** (PR #43, `alpha-1.20`): everything other players send is checked all
     through (names are plates and escaped, the lobby in state, map keys, rivals only from the
     host role, remote poses capped), the race page's join is `net/join.ts` with tests, and the
     docs caught up with milestone 3.
   - **The soundtrack** (PRs #44 and #45, `alpha-1.20`/`alpha-1.21`): the owner's tracks, a
     playlist per race with no repeats, played from https://cdn.gamerelay.io (gamerelay.io's
     caching proxy for the games' asset store: "Hosted test build" below).
   - **The race on `relay.tick`** (unreleased): an online race steps on the SDK's tick, a worker
     timer that keeps going in hidden tabs (`src/net/stepper.ts`), so a hidden host tab no longer
     freezes the AIs; drawing stays on `requestAnimationFrame`.
   - **Traffic, bumps and credit** (unreleased): the race's clock is the server's (traffic was
     15–20 m apart between screens), traffic hits are claimed (`src/net/traffic.ts`), and bumps
     and takedown credit cross screens (`src/net/contact.ts`).

   Next, in order:
   - **Results written by the host** (Xbox's arbitration), together with **a vote on the next
     race**: one results-to-lobby flow.
   - **Names over cars** within ~60 m, from player data (PLAN phase 3), and **a net overlay**
     (pings, routes, entity ages) to debug the two above in playtests.
   - **Before the repo goes public:** a P2P opt-in (it shows IPs today), a filter on Public lobby
     names (strangers see them), and seat reservations for invite links if GameRelay adds them.
     Also: the git history's author email becomes public with it. Rewriting the history is the
     only fix, and that's the owner's call.
   - The repo goes public. Then milestone 3b: the neon skin on Downtown (SPEC's City), which is
     the launch. Touch controls first: phones will be much of the link's traffic.
2. **Playtest with a controller** whenever there's a build to try: tune with F4, and press F8 on
   anything odd. Still open: whether ~1 wreck a race on Downtown is too tame (add denser traffic
   on the straights rather than sections in corners), and whether each car's drift carry feels
   right (`driftExit*`, `boostFromDrift`).

### Smaller follow-ups

- **Online:**
  - A traffic hit isn't checked against who holds its claim (`room.claimed`): a forged one only
    wrecks a traffic car early.
  - Remote poses are capped now (speed, turn, steering; rivals' handover range-checked), but not
    their position: a modified client can still put its car anywhere, on top of yours too. A
    position near the track (and near where it last was) is the next check.
  - `RoomLike` (relay.ts) doesn't declare the SDK room's `define`, `renderTime` and `hostId`, so
    net/join.ts casts the room to `NetRoom`. Declaring them means every test's fake room grows
    them too.
  - An online Create lobby can't be cancelled: Esc to the title, and if the create lands after,
    the menu opens the new lobby.
  - The relay tests sleep through the listing's 1 s throttle (about 4 s of the run) and use tight
    real-time waits; an injected clock (as presence.ts has) would make them faster and steadier.
  - Lobby names aren't filtered like plates (`cleanName` in `lobby.ts` only trims and cuts to 32
    characters), and Public ones are listed to strangers.
- **Performance:**
  - Tile the Valley's terrain (one 256k-triangle mesh, never culled); upload only live ambient
    cars and particles instead of whole buffers each frame.
  - Ambient city cars could animate in the vertex shader instead of on the CPU (they're only
    posed within 420 m of the camera). Out-of-range ones are still written as zero-scale
    instances and the whole buffer is uploaded each frame: write the near ones compactly and set
    `count` instead.
  - `logTruck.at` rescans traffic every tick for its truck: remember it on the occurrence.
  - Loading a layout builds the whole of Downtown in about 200 ms. That's fine per editor edit
    (edits apply when you let go of a point); if it ever runs per frame, cache it.
- **Code organisation** (from the two reviews; no bugs):
  - One road spatial index for `cityscape.ts` (Corridors), `forest.ts`, `island.ts` and
    `terrain.ts` (the forest and the island each hash the road the same way); one instancing
    builder for `scenery.boxes()` and `forest.instanced()` (the island uses the latter); a
    `gantry()` helper.
  - Split the two biggest functions: `buildCar` (`car/build.ts`, ~680 lines: body, cabin, lamps,
    wheels, glows) and `buildCityscape` (`cityscape.ts`, ~680: buildings, signs, streets,
    ambience).
  - A shared `lateralOf(sp, i, x, z)` in `query.ts` for the ~8 hand-written lateral projections.
  - `src/content.ts` (the bundle loader) and `src/core/content.ts` (types) share a name.
- **Content and visual:**
  - Traffic has silhouette ink only: no window or panel ink, and no crumple on wreck.
  - Downtown has 4 puddles, all in corners; a few on straights would add rain atmosphere.
  - The tunnel lost its traffic section, which was too short to keep a straight at both ends.
  - The AI never drifts, so it never earns drift boost. That's an edge for a player who drifts
    well; a drifting AI needs its drift controller tuned against the lap report.
  - Logs from the log truck's spill roll through the Trestle's legs (hazard pieces don't collide
    with props). The one AI reset left in the field tests is a car the spill shoved off the road
    the wrong way.
  - The police car's lights always flash; a siren and a pursuit mode would suit it.
  - A wrecked car sitting on its wheels loses its shadow too (it goes with `onRoad`).
  - Unused surfaces (`ice`, `oil`, `lava-crust`, `boost-pad`) wait for a map that uses them.
  - Downtown's and the Valley's lap floors (58.6, 63.4 s) are under SPEC's 70–100 s target;
    Paradise's (66.8 s) is close. Validate warns only under 55 s.
  - The land over the Lava Tube is still cut open (every road caps the land below it), so the
    tube reads as a roofed cutting, not a tunnel under the cone. A branch that's a tunnel would
    need to leave the land alone over its middle and draw portals.
  - The falling sign's and log truck's markers use the road's centre height, like the bombs did
    before; on a banked stretch their rings would sink. Neither sits on a steep bank today.
- **Controls:**
  - Touch controls: phones can't drive yet.

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
  ~/dev/gamerelay.io). An online race steps by itself in a hidden tab (on `relay.tick`), so both
  tabs race without `__rc.advance`; the title and lobby pages still need it there. And
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
