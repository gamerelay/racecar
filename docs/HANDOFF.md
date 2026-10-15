# Handoff

Where racecar stands and what's next, for whoever picks it up (a person or a fresh Claude session).
The design is [SPEC.md](./SPEC.md): decisions in §17, and what building changed in "Changed while
building". This file is "where are we"; the spec is "what are we making".

**Last updated:** 2026-10-15. **The hosted build is `main` at `35122ca`:** `v1.0.1` plus **PRs
#174–#179** (GameRelay's test bots and SDK `0.1.0-alpha.11`, Esc from Create, the camera, drift and
steering on the keyboard, the version on the title; "Hosted test build" below). **`v1.0.1` is tagged** (2026-10-14): **PR
#172**, SDK `0.1.0-alpha.10` and the three online fixes the two-browser check below found, on top
of `v1.0` (2026-10-12, PRs #168–#170, merged in that stack: `splash-city-online`, then
`public-ready`, then `public-polish`). Checked before the deploy: typecheck and `bun run test`
(833); after it, the live page loads with no console errors, serves SDK alpha.10 and lists
lobbies. In `v1.0`:

- **Online getaways on Splash City** (#168): Heist is **Splash City**, and an online lobby race on
  it is a getaway for every player (the owner: "Make the default mode chase when you select from
  the normal menu", then "competitive survival and we add more cops", "each player gets their own
  cops, but cops will also attack you when nearby", "watch the rest then shared results").
  Details in [CHASE_MODE.md](./CHASE_MODE.md)'s "Online getaways, and Splash City".
  - **Code:** `rules/getaway.ts` (a run per runner, `poolFor`, `NEAR_TARGET`), `net/cops.ts` (host
    cops), `net/cars.ts` (`out`/`runT`), `lobby/vote.ts` (`chase`), `ui/watch.ts`, `ui/race.ts`
    (strip, `showTable`), `main.ts`. `MAX_CARS` is 32.
  - **Not checked yet:** a getaway online with 2+ players (a plain race online is, below) on the local relay, 8 runners at the Bank, the 32-car draw calls against the table below, and
    single player's crash card in a visible window.
  - **Next (not in this):** AI runners online, players as cops. (The online leaderboard is Time
    trial's lap boards: SPEC "Online leaderboard (2026-10-15)".)
- **Ready for the public** (#169, #170; [the spec](./superpowers/specs/2026-10-10-public-polish-design.md)):
  no analytics (PostHog is gone, and an older build's id and opt-out are cleared from the
  browser); host controls (Kick, banned on a second kick; Make host with `transferHost`; Private
  locks the room at the server; told why you're out); Credits, Privacy and Terms pages from the
  title (`ui/pages.ts`, the text in `PRIVACY.md` and `TERMS.md`).
  - **Checked 2026-10-13** with two headless Chromes (separate profiles) on a local server at
    gamerelay master: create, list and join; ready, start, and each sees the other's car; Kick (a
    second press, "Removed by the host", back in from the list), the second kick's ban (refused
    again), Make host (lobby and SDK host move), and Private (locked, gone from the list, a code
    refused). The same on SDK alpha.10 for create to race, where P2P also comes up on the race
    page (on alpha.7 it does in the lobby, but the race runs over the server). No page or server
    errors. What it found is fixed in #172 (three `/code-review` rounds, then the same check
    again, all passing): the list's row caught up late after a race started (`relist`: only the
    host sends, a failed write is tried once more, `not_host` is left to the new host); a code
    into a Private lobby, or a link to a closed one, now says so; and getting into a lobby waits
    20 s while no connection is up (5 s once one is), saying "didn't answer in time" if it gives up.
- **Checked on `main` (2026-10-13):** `bun run test` (818), typecheck, `tools/validate.ts --ai`,
  every map `identical` in `tools/fingerprint.ts`, and CI.
- **SDK alpha.10** (#172): `bun run build` emits the SDK's P2P code as its own chunk, and
  `build:single` inlines it (no `import()` left; Vite's preload helper warns about `import.meta`
  in the IIFE, but with no deps it never reaches that code). P2P now comes up on the race page
  too (on alpha.7 only in the lobby). On this machine, `bun add` of a new SDK needs
  `--min-release-age=0` for a week after its release (`~/.npmrc`).

From `alpha-1.47` (2026-10-11), still open:

- **To look into: maybe some lag.** The owner, after the deploy: "it def feels slower and choppier
  now", "even on other maps", with the F2 overlay showing 120 fps; then, comparing builds, "can't
  really tell right now ... maybe there is some lag on the newer version and we can investigate
  later". Not reproduced. What's known:
  - **Headless Chrome** (SwiftShader, capped at 60 fps) shows no long frames on the live page, and
    the per-frame CPU work (sim + render submit) is lower in 1.47 than 1.44–1.46 (Heist: about 2
    ms against 3.5).
  - **The SDK isn't it:** it's bundled at `0.1.0-alpha.5` (since Oct 1). On the live page its
    websocket is quiet (a keep-alive every few seconds), with no reconnects or errors. The host
    page only adds meta tags.
  - **Shared by every map since 1.44:**
    - 1.45: the keys card and the −/+ track keys, a couple of cheap checks a frame (`keysFrame`,
      `openMenu`'s `#keys.on`).
    - 1.46: the smashables' grid (`Smashables.near`: a small sort per car per tick).
    - 1.47: traffic merged per material, its ink ids as ink-only meshes; every landmark flattened.
  - **Next:** a real-GPU profile on the owner's machine (Chrome's Performance panel, 120 Hz), and
    an A/B of the single-file builds of 1.44–1.47 (`git worktree add <dir> alpha-1.4N && bun run
    build:single` in it). A smooth 1.44 and a choppy 1.47 would point at 1.47's GPU side (the ink
    pass, merged meshes no longer culled per part); all four alike would point outside the game.

## Resume in five minutes

1. `cd ~/dev/racecar && bun install && bun run dev`, then open http://localhost:5178. For online
   lobbies, also run the gamerelay.io repo's server (`bun run dev` there, :8787), then use two tabs.
2. Read this file, then [ONLINE.md](./ONLINE.md) (how lobbies, hosts, parties and players work),
   SPEC §17 and the milestone 3 notes under "Changed while building".
3. The platform side is ready: SDK `0.1.0-alpha.10` (bundled) has everything racecar uses (host controls,
   listings, parties, `lanRoute`), and the `racecar` instance has parties and Direct connections
   on (see "GameRelay side" below).
4. Before changing anything: `bun run test && bun run typecheck && bun tools/validate.ts --ai`
   (`bun run test`, never bare `bun test`: it sets the per-test timeout CI uses), and
   `bun tools/fingerprint.ts` (every map `identical` unless a change means to move one). All
   three are green on `main`. Branch off `main`, one PR per change, with CI, then
   `/code-review` with the PR's full URL. Merge, tag and deploy only when the owner asks.

## Where things stand

- **Repo:** `gamerelay/racecar`, public since 2026-10-05 (code MIT, music reserved), cloned at
  `~/dev/racecar`. The default branch is `main`. Milestones 1–3 are done (online lobbies, remote
  cars, P2P, the host's AIs, host controls); `v1.0` is the first public release.
- **Maps in the lobby:** Downtown, Backroads, Paradise (`paradise-open`), Riviera (`coastal`),
  Avalanche, Sahara and Splash City (`heist`, online getaways). Paradise Classic (the old island
  lap, `paradise`) is experimental. All of them run on Caldera, the one engine
  ([CALDERA.md](./CALDERA.md)), with the road graph (its step 6).
- **Cars:** eight classes (`CLASS_ORDER`: coupe, muscle, hatch, van, sedan, rally, bus, police),
  how they're built in [CARS.md](./CARS.md). Up to 32 cars in a getaway (`MAX_CARS`).
- **Online:** [ONLINE.md](./ONLINE.md) (lobbies, hosts, parties, getaways, host controls). No
  analytics since `v1.0`.
- **The docs:** the design is [SPEC.md](./SPEC.md); maps [MAPS.md](./MAPS.md) and each map's own
  (PARADISE, COASTAL, AVALANCHE, SAHARA, CHASE_MODE); [TECH_DEBT.md](./TECH_DEBT.md); issues
  noticed while driving, their causes and guards, in [ISSUES.md](./ISSUES.md);
  every release in [CHANGELOG.md](../CHANGELOG.md). What was built and when, with the numbers of
  the time, is [HISTORY.md](./HISTORY.md) (moved out of this file on 2026-10-14).

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
- **The music** (35 MB) isn't in the single file: it's on the games CDN,
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
- **What's there now:** `main` at `35122ca` (`v1.0.1` plus #174: an agent's test bot (GameRelay's
  `add_bot`) takes an AI car in an online race this screen hosts, on SDK `0.1.0-alpha.11`
  (`src/net/bots.ts`, the sample brain `bots/follow-the-road.js`); #175: Esc from Create gives up the
  lobby being made, and a lobby picked after it gets you in; #176: the chase camera's aim eases
  with its height, so the view doesn't nod with the road; #177: with drift held, a steer key starts
  the drift on the next tick; #178: a steer key starts at `KEY_ONSET` (0.3), so steering takes
  sooner on the keyboard; #179: the title's foot shows the build's version (`git describe` at build
  time); untagged, in CHANGELOG's "Unreleased"), updated 2026-10-15 with `./deploy-hosted.sh`
  (`v1.0.1-26-g35122ca`), with every track on the CDN. Checked after: the live page serves that
  version and alpha.11, shows the version on the title, lists lobbies, and logs no errors through
  a reload. Bots only play where the host is a bot host (the game on localhost, or `botHost`), so
  the hosted build never runs one. #174 was tried end to end before the merge: the dev build on
  production GameRelay, our own invite-only lobby, `add_bot`/`update_bot`/`remove_bot` through the
  account MCP (its description has the run).
  `v1.0.1` is #172 (SDK alpha.10 and the online fixes, on `v1.0`'s online getaways,
  public-ready, host controls and no analytics). Keep it the one row: update Z442EE in place rather than adding a game.

## Next, in order

1. **v1.0's open checks and next steps:** its "Not checked yet" and "Next (not in this)" (top of
   this file), and the lag check from `alpha-1.47` (above).
2. **Online, still open:** names over cars within ~60 m and a net overlay (pings, routes, entity
   ages, claims and bumps) for playtests: neither is built. A filter on Public lobby names
   (`cleanName` in `lobby.ts` only trims and cuts; strangers see them); P2P shows players each
   other's IP, which the Privacy page now says, with no opt-in; seat reservations for invite links
   if GameRelay adds them. Touch controls: phones can't drive yet.
3. **Per map:**
   - **Next on Sahara:** reeds; the berms tuned by driving them (358–368 m and 2124 m wrecks).
   - **Next on Paradise** (the owner's order): the finish; maybe more palms on the front road; the
     lava bombs at 3150–3200 m are most of the field's wrecks now.
   - **Riviera:** **Optional:** a poster for it (the plan's "into the lobby" step had one; nothing in the game
     shows a map's poster, so the owner's call). It's in the lobby already.
   - **Next on the road graph,** when a map needs it: CALDERA's step 6 leftovers (hazards, traffic and
     the AI's marks off main-road distances; the road-edge walls onto streets), then step 7, a city map.
   - **What's left on Avalanche** (AVALANCHE.md has the detail):
     - **Listen:** the owner liked the snow and the rumble, a little quieter (done, #77). The gate
       chime hasn't been heard by ear yet.
     - **Ridge shortcuts:** the AI never takes them; watch whether players' ones need trees or rock.
     - **The AI's corner speeds don't know the bank** (it hasn't mattered on a piste this wide).
4. **Older asks from the playtests (2026-10-02), still open:**
   - **Drive the new feel (alpha-1.25):** boost, Overdrive and the slipstream are tuned against the
      AI only. Does boost now feel worth chasing? Does Overdrive's 6% read on a straight, and the
      "Slingshot!" when you pull out from behind a rival? The numbers are all in the F4 panel.
      Paradise's field is at 1.5 wrecks a race over 16 seeds, the field tests' limit, so a change
      that adds speed there has to give some back.
   - **PLAN.md's "Next up"** (from the playtest): the click effects, the title's music and Logger's
      Leap are done (`alpha-1.28`; listen to the clicks, and open the title in a fresh browser
      profile to see the music hint, neither checked by ear or eye here). Left: the traffic fading
      out in front of you (investigated: choose a fix from PLAN's options), Backroads by day (a
      maybe), and more particles and sounds when smashing props. Then the pickup truck. Avalanche is
      under way on its own experimental line (PR #74, above): items 1–7 of AVALANCHE.md's "Next: a
      loose plan" are built. What's left is listed above ("What's left on Avalanche"), and so is the
      owner's next direction, Paradise as an open map.
   - **The menu plan, step 3** ([MENU.md](./MENU.md)): keyboard remapping on the Controls screen,
      hints built from the bindings, and gamepad deadzone, rumble and sensitivity.
   - **Playtest with a controller** whenever there's a build to try: tune with F4, and press F8 on
      anything odd. Still open: whether ~1 wreck a race on Downtown is too tame (add denser traffic
      on the straights rather than sections in corners), and whether each car's drift carry feels
      right (`driftExit*`, `boostFromDrift`).

### Smaller follow-ups

Bugs and gameplay gaps. Refactors, duplication, performance and tooling go in
[TECH_DEBT.md](./TECH_DEBT.md), a running list of suggestions (not decisions) to plan from later.

- **Online:**
  - A traffic hit isn't checked against who holds its claim (`room.claimed`): a forged one only
    wrecks a traffic car early.
  - Remote poses are capped now (speed, turn, steering; rivals' handover range-checked), but not
    their position: a modified client can still put its car anywhere, on top of yours too. A
    position near the track (and near where it last was) is the next check.
  - Lobby names aren't filtered like plates (`cleanName` in `lobby.ts` only trims and cuts to 32
    characters), and Public ones are listed to strangers.
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
  - Downtown's and the Valley's lap floors (57.9, 62.9 s since alpha-1.25's boost) are under
    SPEC's 70–100 s target; Paradise's is in it (71.5 s). Validate warns only under 55 s.
  - Paradise's lap is at the top of MAPS.md's length target (3.80 km, the test's bound is
    3.8): anything that lengthens it has to give some back elsewhere.
  - The AI takes a secret shortcut but drives it no better than a signed one: the Beach Cut costs
    the hard AI 0.4 s. A player who knows the line beats that; whether rivals should is open.
  - The land over the Lava Tube is still cut open (every road caps the land below it), so the
    tube reads as a roofed cutting, not a tunnel under the cone. A branch that's a tunnel would
    need to leave the land alone over its middle and draw portals.
  - The falling sign's and log truck's markers use the road's centre height, like the bombs did
    before; on a banked stretch their rings would sink. Neither sits on a steep bank today.
- **Found in the engine's review (2026-10-04):**
  - A car stopped in the hole of a panel that stands again round it is pushed out by up to 0.7 m
    in one tick as it leaves. Only with `standsAgain`, which no wall uses yet.
  - (Decided, the owner: Paradise Open's lava stream may end in the coast's sand, its last ~40 m,
    and a car in the sea at its mouth may wreck as lava rather than out of bounds.)
- **Found in the tech-debt pass (2026-10-02), not fixed yet** (the first three were, in PR #65):
  - A spurious run-off dust puff: `lastSurface` (renderer.ts) is only updated for cars in effects
    range and not wrecked, so a car that left the road out of range (or wrecked) and comes back
    still off it puffs as if it had just run off.
  - Maybe: the island's lava flows, crater pool and waterfall are `ShaderMaterial`s with no fog,
    so in rain (fog much nearer) they may stand out against fogged land. The lava may be meant
    to glow through; the waterfall probably isn't. Check in the browser.
- **Controls:**
  - Touch controls: phones can't drive yet.

## Known rough edges

**Known rough edges:**
- The lap is long (106.0 s since the Old Town's switchbacks, the Stairs and the cape's loop, against 58–93 for the rest): a Descent row or an S-bend could go, or the
  race fewer laps, if the owner wants it shorter.
- A car that runs wide just before a rock rail can end up behind it, grinding along to its end.
- The AI never takes the Stairs' arm: by driven costs the rest of the flight is 0.3 s quicker, and
  forced drives agree it's a wash at best (the muscle, bus and police lose about 3 s on it). Turning
  up the second flight off the row it comes in too fast and clips the walls (1.8 s lost): that's
  its target speed there (the racing line's), not its costs.
- Who wrecks on the Rocks flat out depends on exactly where a car meets the ridges, and the
  Stairs' times on where their houses landed: re-measure after changing either. A wreck respawns
  you quickly, so a fluffed cut costs little more than the road.
- A car crawling up a drawbridge leaf as it passes 30° falls in (the AI never does).
- Houses have no roof collider (walls to the eaves); nothing near the town flies that high.
- A thin white band of surf at the sea wall's foot (the water's shore foam along the coast): it
  reads as water lapping from the race camera; the owner may want it gone.
- With the oncoming lane only on the waterfront, the racers' side of the boulevard has no traffic.
- Hills are cut back to the main road only: keep branches and decks off them.
- `top(x, z)` with no height over a main-road tunnel is the rock's top: anything placed by it (props,
  slalom gates, `drive`'s x/z spots) must pass the road's height.
- A faint inked line across the road where the Rock Tunnel's own road starts (drawn 4 cm up).
- Paradise Open's Lava Tube lets cars on the volcano sink into it, about one in nine of a sweep
  (older than #131, which left it as it was).
- Anything placed by `top()`/`height()` with no height in a main-road tunnel's mouths stands 0.3 m
  up (`MOUTH_CLEAR`): nothing is, today.
- Camera hints still wait for a spot that needs one; TECH_DEBT has the small things the reviews left.

**Lap floors** (as of 2026-10-06; Sahara 78.85 s and Paradise Open 67.37 s since; later numbers are in HISTORY.md's release notes) (the best AI lap, solo hard coupe): Downtown 57.9, Backroads 62.82, Avalanche
93.07, Paradise 70.3, Paradise Open 66.35, Riviera (coastal/riviera) 106.22 s. Paradise Open's field: 34 wrecks in 40 seeds.

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
- **Looking at a spot without driving there:** `poster.html?scout=paradise/island&s=2350,2500`
  draws a car at each distance from a chase camera, and works in a hidden tab. `&spline=N` is
  a branch (by its index in the baked track), and `&side=-30&ahead=2&up=6` turns the camera to
  look across the road (the volcano from town, say).
- **Measuring a layout change:** `bun tools/lap-report.ts paradise --field --seed N` (or
  `--chaos`), summed over 16 seeds as MAPS.md says. Section times on lap 1 show what a shortcut
  costs the AI, when it took one.
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

**Working notes (2026-10-03 to 2026-10-05):**
- The fingerprints cover a solo lap and a drive down each branch, not the field: an AI change can
  keep them identical and still move a race (#122's drawbridge window did). Check races too, and
  check the check can tell: #122's 2-lap race reports couldn't see the bad version either. The
  reviewer's sweep (8 cars through the drawbridge at 341 lift times, and 8 four-minute races,
  hashed) did; it's a few lines with `setup(..., { t, rivals: 7 })`.
- A tunnel's mouth up a sheer face: the ground cut (`portal.ts`) splits a clipped triangle with a
  side through the outline (#118). If something stands in a mouth, raycast from the camera
  (headless: build the skin's meshes with a stubbed `document`) to name the mesh before guessing.
- The fingerprint's track hash hashes every field of every baked road: a new field moves every
  map. Skip it in `src/dev/fingerprint.ts` only if it's derived from what's already hashed.
- Two-way traffic on a narrow road, or through a bend, boxes the AI in: it brakes rather than move
  over, into head-ons. Keep it on straights, 20 m wide or more (MAPS.md's rule, and #112's lesson).
- A tool's flags must all be read before `a.rest()`, which refuses any left over (`shot --t` was
  refused until #111).
- Don't `git checkout <file>` to undo one edit in a file with other uncommitted work: it threw away
  a session's generator changes once. Commit work in progress first.
- Check a drive tool's option names (`Spot` is `x`, `z`, `heading`): an unknown one is silently
  ignored, and a test can pass without doing what it says.
- An AI held at a standstill on the brake reverses (brake past zero is reverse): to hold a car still,
  brake only while it rolls forward. It cost a long chase on the drawbridge's queue.
- `drive`'s `t` option and `shot --t` put the world at a race time (a drawbridge up); `shot
  --traffic` shows the traffic (the poster stage has none by default).
- `tools/plan.ts` draws a layout from above (`--at x,z --size m` for a close-up): the quickest way
  to see a lap's shape while laying it out.
- One PR per step, a fresh reviewer at the end (it found real bugs every time: in 0b, 1a and 1b),
  then the owner merges. The PR says whether it's a clean-up (fingerprints identical) or a change.
- After moving a file into a folder, restart `bun run dev`: Vite keeps the old path cached and
  `tools/shot.ts` hangs.
- `tools/shot.ts` back to back sometimes fails ("Bun v1.3.13" and no file); run them one at a time.
  A contact sheet (`--s 50,60,70`) is one run.
- For anything drawn, a headless check beats screenshots: 1b's cut was checked by sampling the
  terrain against the outline (`test/portal.test.ts`), which found two bugs no screenshot showed.
- Working on two things at once: a `git worktree` in the scratchpad, `node_modules` symlinked from
  the main checkout, and its own Vite (`./node_modules/.bin/vite --port 5179 --strictPort`, then
  `tools/shot.ts --port 5179`). Reviewers get their own worktree too, so nobody stashes over you.
- `git checkout <file>` to undo a quick experiment throws away *all* the file's changes: copy the
  file aside and back instead (it cost a redo in 1c).
- Field wrecks over 40 seeds move by ±2 with any change to a lap's timing (wrecks shift around the
  map): diff them by seed and place (`lap-report --field --seed N`) before calling it a regression.

**Merging a stack:** `gh pr merge --delete-branch` on the bottom PR *closes* the one stacked on it
(GitHub doesn't retarget when gh deletes the branch). Instead: merge the bottom PR without
deleting its branch, `gh pr edit <next> --base main`, then delete the branch.

The owner keeps tweaking it now it's live: each change re-records only `coastal/riviera`'s
fingerprints, every other map's identical, and checks the floor and field races.

Every release is in [CHANGELOG.md](../CHANGELOG.md): add to its "Unreleased" section as you go,
and retitle that section when you tag. [PLAN.md](./PLAN.md)'s six phases are all merged (it keeps
a pool of other ideas), how online works is [ONLINE.md](./ONLINE.md), how maps are made is
[MAPS.md](./MAPS.md), and suggestions for cleaning up the code are [TECH_DEBT.md](./TECH_DEBT.md)
(add to it as you go).
