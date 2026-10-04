# Handoff

Where racecar stands and what's next, for whoever picks it up (a person or a fresh Claude session).
The design is [SPEC.md](./SPEC.md): decisions in §17, and what building changed in "Changed while
building". This file is "where are we"; the spec is "what are we making".

**Last updated:** 2026-10-03 (Paradise Open merged in #81, untagged; the plan for the engine,
[CALDERA.md](./CALDERA.md), merged in #82; steps 0 and 0b merged in #83 and #84; 1a, 1b and 1c in
PRs #85, #86 and #87, merged; 1d merged in #88; 2a and 2b (feature modules) in #89 and #90; the
jungle's uneven mud in #91 and #92; 2c, overrides, in #93 and 2d, the lava stream, in #94, its
review's fixes in #95; off-road surfaces in #96; step 3a, indoors, in #97; 3b, breakable walls,
in #98; the berm out of the Lava Tube in #100; four new tracks in #99; all merged, untagged and
not deployed; a fifth track, `forward`, in #101, open; all five on the CDN; step 3c, the market
hall, in #102, open; see "Next: Caldera" below). Before that, `alpha-1.30`: Avalanche's snow and rumble quieter. The last tag is **`alpha-1.30`** (PR #77: the snow under the wheels and the avalanche's rumble about 4.5 dB down, the owner's ask). Before it, **`alpha-1.29`** (PRs #71–#74): **Avalanche**, the first open map, one 6.1 km run down a mountain (#74), and the Leap's kicker rounded and launchable from its sides (#71, #72), and PLAN's "Open, freeform maps" direction (#73).
Before it, `alpha-1.28` (PRs #67–#70: a press flash and a click on the menus' buttons; the title's
music from the start; Logger's Leap smoothed and bermed), `alpha-1.27` (PRs #63–#65), `alpha-1.26`
(PR #62: two new tracks), `alpha-1.25` (PR #61: boost, Overdrive, the slipstream) and `alpha-1.24`
(PRs #49–#60).
It's on the hosted build ("Hosted test build" below).

**Next: Caldera, the engine (2026-10-03).** The owner's call: engine first, before the rest of
Paradise Open. [CALDERA.md](./CALDERA.md) is the plan, reviewed and agreed: one engine for every
racecar map (pieces as one surface layer, routes as a graph, overrides as an escape hatch,
desktop only, refactor freely and keep the feel). Read its "Principles", "The core idea: pieces",
"Build order" and "How to work on it" before touching the engine.

**Step 0 is built and merged** (PR #83, 2026-10-03).
- **Golden fingerprints:** `bun tools/fingerprint.ts` checks every layout's roads, its open ground
  (by the answers to its questions, not how it's stored) and fixed drives (40 s from the grid, 15 s
  down each branch) to the last bit; `--update` records them. In the tests too
  (`test/golden.test.ts`). One recording, `test/golden/fingerprints.json`, for every platform.
- **The tools:** `bun tools/drive.ts` (place a car, run it headless, trace it), `bun tools/probe.ts`
  (what's at a point), `bun tools/shot.ts` (a PNG of a spot; needs `bun run dev`), and
  `window.__rc.dev` (`place`, `step`, `probe`, `state`, `shot`), all over `src/dev/`. CALDERA's
  "Developer tools" has the flags.
- **The allocation test** on Paradise Open and Avalanche. A 30 s per-test timeout (`bun run
  test`; CI uses it), since CI runs about 3x slower.

**Step 0b, the sim's own math, is built and merged** (PR #84, 2026-10-03). Step 0 found
floats differ in their last bits by OS and by CPU (Docker: Linux arm64 vs macOS arm64, emulated vs
CI's x64), so there was a recording per platform. Now `core/math.ts` has the sim's own `sin`, `cos`,
`tan`, `atan`, `atan2`, `exp`, `log`, `pow` and `hypot` (fdlibm's algorithms in `+ - * /` and
`sqrt`; `sq()` instead of `** 2`), and `test/math.test.ts` checks `src/core` and `src/dev` use nothing
else, the functions stay within an ulp of Math's (tan 3, pow a few more), and their bits stay put. One fingerprint file is
identical on macOS, Linux arm64 and x64 (Bun, in Docker) and in V8 (Node), so F8 replays are exact
across browsers and CI can't drift. The feel is unchanged: after 60 s of an 8-car field the cars
are picometres from where they were; lap floors and the field's results (5 seeds per map) match to
the tenth. `--from-ci` and the per-platform files are gone.

**Step 1a, the move onto pieces, is built** (PR #85, merged 2026-10-03), the
fingerprints identical on every layout. Layouts say `pieces` (`PieceDef`: a stretch of a road
with a floor or none, a ceiling, and how the ground falls away under it) instead of `GroundDef`'s
`decks`, `branchDecks` and `branchGaps`; `ground.ts` is a `ground/` folder; what's under a point is
one query, `ground.cast(x, y, z, out)`, which physics, the camera and the tools ask. CALDERA's
build order has what's in it and what isn't yet.

**Step 1b, portals, is built** (PR #86, merged 2026-10-03). The tube's
mouths, and where it comes out into the shaft, have the ground drawn cut to the tube's own outline
(`outlineAt` in core, which the tube's walls are built on too; `render/skins/greybox/portal.ts`
clips the terrain), and the shroud is gone. Past each open end the cut goes on to the arch's outer
face (1.5 m), so ground standing in the opening is cut too; only the finest level of detail is cut.
Drawing only, so the fingerprints stayed identical (CALDERA had planned to re-record them).

**Step 1c, branches own their heights, is built** (PR #87, merged
2026-10-03). `BranchDef.heights: 'own'`: the bake keeps a branch's heights as authored,
holding it to the main road's ground only where it's on the main road or its verge (no JOIN_FADE
fade; its bank still fades). The Lava Tube says it, and `gen-paradise-open.ts` writes the profile
it wants instead of inverting the pull (`LAND` is now its own choice: within 10 m of the rim road's
verge, the tube runs at the rim road's ground). The tube is within 8 cm of before; drives through
it, the lap floor (68.07) and the field (27 wrecks in 40 seeds, against 26) are the same.
Paradise Open's fingerprints re-recorded, the rest identical.

**Merging a stack:** `gh pr merge --delete-branch` on the bottom PR *closes* the one stacked on it
(GitHub doesn't retarget when gh deletes the branch). Instead: merge the bottom PR without
deleting its branch, `gh pr edit <next> --base main`, then delete the branch.

**Step 1d, one surface function, is built** (PR #88, merged 2026-10-03). `ground.kind` per grid point (`core/track/ground/surface.ts`: road, a branch's
road, sand, wet sand, verge) is what `snow.ts` colours and what `surfaceAt` drives off the asphalt
(it takes the car's x and z now: the point rebuilt from a far projection drifted). The coast's sand
drives as `sand`, the water's edge as `shore`, the beaches as drawn. Paradise Open 68.07 → 68.10 s,
the field 30 wrecks in 40 seeds (28 before, the same mix); a car on a piece (the Freeway's
shoulder) drives its verge, not the sand under it (`surfaceAt` takes y); only Paradise Open's fingerprints moved. That's step 1
done.

**Step 2a, feature modules' interface, is built** (PR #89, merged 2026-10-03). `core/track/features/`: a `Feature` (kind, and optional `shape`,
`surface`, `hazard`, `coast` hooks) that the ground runs in order. The volcano and
the coast moved onto it (`volcano.ts`, `coast.ts`), and `ground.hazard(x, y, z)` replaced
`inLava`. A clean-up: every fingerprint identical.

**Step 2b, the by-road features as modules, is built** (PR #90, merged
2026-10-03). Mogul fields, canyons and beaches are `GroundDef.features`
entries (`kind: 'moguls' | 'canyon' | 'beach'`), modules in `core/track/features/` with new hooks
(`rise`, `sunk`, `bare`, `side`). `ground.sunk(s, lat)` and `ground.bare(s, lat)` replaced
`canyonAt` (the avalanche's shelter, the trees); the AI reads a canyon's `def`. They stay placed
along the main road (CALDERA's note): a clean-up, every fingerprint identical.

**The jungle's mud, a little uneven** (the owner's ask; PRs #91 and #92, merged 2026-10-03): an
`uneven` feature (`features/uneven.ts`) on the red-earth road (2,092–2,746 m, found by the
generator from the road's surface): lumps up to 0.35 m, 7 m across, at half height on the banked
turns (at 0.7 the drift test fails: the bank's hold is lost). The island's road is drawn in 6
strips across there, following them. Floor 68.10 and the field unchanged. If the owner says it
still feels flat: `MUD` in `gen-paradise-open.ts` (height, size), and `ON_BANK` in `uneven.ts`.

**Step 2c, overrides, is built** (PR #93, merged 2026-10-03; CALDERA's "Overrides: the escape
hatch"). A layout's `overrides: [{ id, reason, region }]` (a box `[x0, z0, x1, z1]`, or a stretch of
a road: `road`, `s`, `lateral`; `s[0]` past `s[1]` runs through a loop's start line) name a map's
code in `core/maps/<map>/overrides.ts` (listed in `core/maps/index.ts`; core, because core imports
nothing outside it). `core/track/overrides.ts` binds them at bake (`track.overrides`) and their
hooks have the last word inside the region: `cast` (the floor: `ground.cast`, `top`, `topSlope`),
`surface` (`surfaceAt`), `hazard` (`ground.hazard`), `respawn` (a spot, then the engine's rules: the
avalanche, gaps), `step` (per tick, per car inside). `tune`, `walls` and `camera` wait for a first
use. `probe` says "override active: <id>", the debug drawing outlines them; `validate` wants code, a
reason and a region for each, lists them, and warns past five. The candidates stayed put: `pastGap`
is the engine's for any gap piece, and `LAND` is build-time authoring. No map has one: a clean-up,
every fingerprint identical. Tests: `test/overrides.test.ts`.

**Step 2d, the lava stream, is built** (PR #94, merged 2026-10-03; CALDERA's "A feature, end to
end"). `features/lava-stream.ts`: a channel along a path in world space (the first feature placed
there), its floor `width` m across and `depth` m down, banks eased over LAVA_BANK m of rock
(`KIND_LAVA_ROCK`, driven as `lava-rock`), lava LAVA_FILL m deep that wrecks you (`Cause.Hazard`),
no trees on it, coming out of the ground over its first 25 m. The skin draws it from a table by kind
(`render/skins/greybox/features.ts`; the cone's lava shader, shared). Paradise Open's runs from the
volcano's south-west flank to the sea by the bay (`LAVA` in the generator), the one way down that
crosses no road; the validator refuses one that crosses a road (bridges come with pieces). Driven:
below about 100 km/h you're in it, from about 130 you clear it. Lap floor 68.1 and the field (30 wrecks in
40 seeds) unchanged. Tests: `test/lava-stream.test.ts`. `tools/drive.ts` gained `--heading` and puts
`--at` exactly there. Found on the way, left for the owner (TECH_DEBT): the Lava Tube's verge is
`beach`.

**#94's fresh review finished after the owner merged it**; its findings are in #95 (merged): the
lava felt where it's drawn (level from the path's floor, not the grid's rounded edge), `drive --at`
on the ground far from roads, the validator's reach. The one it left for later (a point far from
every road projecting "onto" one) was fixed in #96. #93's review found nothing serious; its five small fixes are in.

**Off-road surfaces** (a tech-debt pass, the owner's choice before step 3; PR #96, merged
2026-10-03; the owner drove it: "this feels good"): `surfaceAt` ignores a projection that stopped
short of the point (round a bend, far off the road: `STRAY` in `query.ts`), using the ground's kind
or the nearest main-road sample's verge instead, and the Lava Tube's verge is `ash`. No sampled
point 3 m+ off the roads drives as asphalt now on Avalanche or Paradise Open (416 and 304 before).
Drives, floors, field unchanged. The rest of TECH_DEBT is code shape, left for when steps 3 and 6
touch it.

**Step 3a, indoors** (Caldera's step 3, in parts): in the Lava Tube the light, the fog and the
sound are a cave's. `PieceDef.indoor` names an enclosed piece's look (the skin's `INDOOR` in
`palettes.ts`: `tunnel` unless it says, `lava` for the tube); the renderer eases `indoor` in and out
from the camera's cast, the skin moves the fog and sky light to the look's and dims the sun, and the
engines and effects ring in a room's echo (`roomImpulse`). The chase camera is capped a metre under a
ceiling over the car (`cameraCeiling`). Drawing and sound only: fingerprints identical. Camera hints
wait for a spot that needs one.

**Step 3b, breakable walls** (#98, merged; the owner's review fixed in it): `TrackLayout.breakables`, walls in world space cut into
panels that each break on their own (`core/world/breakables.ts`, `collide/breakables.ts`): a wall
to a car slower than `breaks`, burst by a faster one (no boost, unlike smashables). Online a break is
a trigger, claimed like a traffic hit (`net/breakables.ts`). The first boards up the Lava Tube's
first mouth (`BOARDS` in the generator). Paradise Open 68.10 → 68.00 s, the field 28 wrecks in 40
seeds; fingerprints re-recorded for it only. A car through a panel breaks a hole its width at once
(every panel its footprint covers, at its angle), and a car deep in a panel goes through it only if
it was in it last tick too. The boards are inked like cars, in darker wood.

**The berm out of the Lava Tube** (#100, merged; the owner's idea): the left-hander where the tube
rejoins the rim road is banked into itself (`EXIT_BERM`), and the tube's road climbs to its high
outside edge (`EXIT_KICK`), so coming out you fly across the turn and going round it's a berm.
Paradise Open 68.00 → 67.67 s; the field 39 wrecks in 40 seeds (28): more traffic hits just past the
line. The owner may want it toned down after driving it (no air boost from it, or a lower lip).
PARADISE.md has the numbers.

**New tracks** (the owner's, 2026-10-03): `avalanche` and `winter-pursuit` are Avalanche's own,
`propulsion` and `escape` go anywhere (#99, merged), and `forward` too (#101, open: merge it). Each
WAV levelled to −15.8/−15.9 LUFS (ffmpeg's `ebur128`) and encoded with `afconvert -f m4af -d aac -b
128000`. All five are published to https://cdn.gamerelay.io/racecar/music/ (`tools/publish-assets.ts`,
checked: 200 with CORS); production plays them from the next deploy.

**Not deployed:** everything since `alpha-1.30` (Paradise Open, Caldera's steps, the boards, the berm,
the tracks) is on main only. Deploy and tag only when the owner asks.

**Step 3c, the market hall** (#102, open): buildings, `PieceDef.building`, enclosed pieces
built on the ground. Their walls are solid props on no road (`core/track/buildings.ts`), met as a
road's wall is from either side. A car in one stands on the ground, and the cast finds the room
(`Cast.room`). The first is Paradise Open's market hall on a street through Harbor Town
(`MARKET` in the generator), with shopfront glass (`look: 'glass'`) across its doors. Paradise Open
67.67 → 67.27 s (the AI takes the street; its floor's sand, the owner's call, slows it); the field 37 wrecks in 40 seeds (39); fingerprints
re-recorded for it only. CALDERA's 3c has what changed while building.

**Next, step 4:** moving pieces (a drawbridge), per CALDERA's build order. Or first, whatever the
owner says after driving the hall: its glass's speed (`MARKET.glass.breaks`), the hall's length,
and whether the street should be slower (it's about a second quicker than the road round). Camera
hints still wait for a spot that needs one. TECH_DEBT has the small things the reviews left.

**Working notes (2026-10-03):**
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

**Avalanche** (merged in #74, out of experimental on the owner's word): open ground you drive on
everywhere, slope gravity on snow, moguls, canyons, kickers, rocks, 18 slalom gates, about 650
solid pines, a ski jump, snowfall and tracks, the camera following the slope, and an avalanche at
chaos. The AI lets the slope carry it and rides the canyons. In the lobby, the vote and quick race,
racing to its own two tracks (`avalanche`, `winter-pursuit`, 2026-10-03) and the six any-map ones. Everything about it is [AVALANCHE.md](./AVALANCHE.md). The
owner drove it ("it feels good"); phones aren't a target for it. The `/code-review` found two
low-severity bugs, fixed before the merge.

**The owner's direction (2026-10-02): open maps, starting with Paradise.** The owner really liked
the Avalanche experiment ("this is really really awesome", "this map is amazing") and wants
**Paradise switched to the open model too, even if that means redesigning some or part of the
level.** Why Paradise first (Backroads was considered: its trestle and river and its flat infield
make it harder):
- **The sea is a natural edge.** It's an island: drive the beach and the shallows, and the sea is a
  respawn. No invisible walls, per AVALANCHE.md's philosophy ("if it's drawn, you can drive it").
- **Its land is already a formula** (the island's outline plus the volcano cone, `layout.terrain`),
  so the drivable ground can be built from what's drawn now. The island would look much the same,
  only solid.
- **Mostly open already:** most of its walls have gaps, and there are no roads over roads.
- **The volcano becomes the centerpiece:** up its flanks, off the crater rim, maybe lava as a
  wreck. With slope gravity on its rock and earth, a cut over its shoulder is a gamble, not a free
  shortcut across the loop.

Hard parts:
- **The Lava Tube is a real tunnel** through the cone's shoulder. The ground is one height per
  point, so it needs to step aside under a road (or be redesigned away: the owner's fine with
  redesigning).
- **Solid palms and rocks,** the pines way: one list, drawn and hit.
- **Cutting across the island** has to cost time, not skip half a lap.
- **Retuning:** its lap floor (71.52 s), the AI with more room, and grip in a shower off the road.

**Most maps go open (the owner, 2026-10-02):** "we are going to want to switch most maps to this
form and rely more on clever level design to prevent unfair races." The piece to solve first is
**a road over the ground**: a bridge or deck the car follows when it's on it, with the open ground
under it otherwise (Paradise's bridge, the Valley's Trestle on Backroads). "Once we figure out a
solution to that I think things will be good."

**The plan is [PARADISE.md](./PARADISE.md)** (2026-10-02, from the owner's sketch): a web of
routes between the old places, each stretch a road, a slower cut and sometimes a risky line (a
jump over the crater's lava, the Reef Run inside the bridge, a lava channel), a half-moon bridge
to drift, the mud like a messy mogul field, lava that changes lap to lap, more Hawaii, a little
zany, and no lighthouse. The owner's answers are in it: about today's length, experimental first
then replacing today's Paradise, some traffic, fresh shortcuts, the beach as open sand, one lava
spurt a race, and the crater jump in place of the Lava Tube.

**Paradise Open, where it stands (2026-10-03):** **merged** (#81, `faed2bc`, untagged: it's
in CHANGELOG's "Unreleased"). It began as four stacked PRs (#78–#81); #78–#80 are closed and folded into
#81. Its parts, in the order they were built:
- **The plan** (was #78): PARADISE.md and this file.
- **Step 0** (was #79): a road over the ground (decks), the sea, the Freeway as a
  deck with rails, the camera on decks, banked turns that hold a drift (`TUNING.bankHold`). The
  owner drove it: "feels a lot better", "plays nice".
- **The island** (was #80): the coast, the volcano with its lava lake, about
  2,400 solid palms and jungle trees, island colours, off-road slopes that pull
  (`TUNING.offroadSlope`).
- **The tube** (#81): the Lava Tube through the volcano, over the lava
  in its crater's shaft on a rock bridge; branches on open ground (tunnels and bridges, "a car is on
  the highest surface at or below it"). Since (2026-10-03, on the same branch):
  - **The jump** (the owner's answer to "too overpowered"): the bridge broken by a 40 m gap over
    the lava, a kicker up to it. Every car needs ~150 km/h off the lip, flat out they all have
    175+. A miss is a lava wreck, and you're back past the gap.
  - **The camera** through the tube, and **the tube's exit** (no more launch onto the rim road).
  - **Rock faces** (`ground.face`): the volcano's steep faces by the mouths are walls.
  - **A detail pass on the island:** a beach from Harbor Town to the Freeway, the roads laid crisp
    over the ground with no markings, the ash fading off its roads, the volcano in mixed tones.
  The owner: "this is looking a lot better", "functionally these work really well".

Every PR had `/code-review` and its findings fixed, the 2026-10-03 work too (five bugs fixed;
the code's shape went to TECH_DEBT.md, "Open ground and Paradise Open"). PARADISE.md's "Built so far" and "What we learned" have the detail, the numbers
and the known rough edges.

To try it: on `main`, `bun run dev`, and open
`?mode=free&map=paradise-open/open`. Add `&spawn=2600` to start just before the tube (dev only:
any distance along the main road). The map is generated: edit `tools/gen-paradise-open.ts` and run
it. Its tests are `test/deck.test.ts`.

Next (PARADISE.md's "Next" has the list; after the engine's first steps, the owner's call):
- **Fixed since the owner saw them:** the camera's hiccup at the tube's start, and the big rock box
  over the way in.
- **The eruption:** the race's one lava event; in the tube, a wreck.
- **Balance:** the hard AI makes the jump every lap, so the floor is 68.05 s (70.03 s without the
  tube; 68.07 s after review). For a player it's a gamble now; whether the AI should miss sometimes is the owner's call.
- **The rest of PARADISE.md's steps:** the routes from the sketch (step 2: today's island lap is
  still the only road), the half-moon bridge, real mud (the jungle road's lumps are in, #91; mud
that slows or slides isn't), the lava spurt, then Harbor Town and the
  dressing with colliders (step 8).

**What's left on Avalanche** (AVALANCHE.md has the detail):
- **Listen:** the owner liked the snow and the rumble, a little quieter (done, #77). The gate
  chime hasn't been heard by ear yet.
- **Ridge shortcuts:** the AI never takes them; watch whether players' ones need trees or rock.
- **The AI's corner speeds don't know the bank** (it hasn't mattered on a piste this wide).

Every release is in [CHANGELOG.md](../CHANGELOG.md): add to its "Unreleased" section as you go,
and retitle that section when you tag. [PLAN.md](./PLAN.md)'s six phases are all merged (it keeps
a pool of other ideas), how online works is [ONLINE.md](./ONLINE.md), how maps are made is
[MAPS.md](./MAPS.md), and suggestions for cleaning up the code are [TECH_DEBT.md](./TECH_DEBT.md)
(add to it as you go).

**Map names:** City is now **Downtown** and Countryside is **Backroads** (content in
`content/maps/downtown` and `content/maps/backroads`; keys `downtown/downtown`, `backroads/valley`;
old keys still resolve). The third map is **Paradise** (`content/maps/paradise`, key
`paradise/island`).

## Resume in five minutes

1. `cd ~/dev/racecar && bun install && bun run dev`, then open http://localhost:5178. For online
   lobbies, also run the gamerelay.io repo's server (`bun run dev` there, :8787), then use two tabs.
2. Read this file, then [ONLINE.md](./ONLINE.md) (how lobbies, hosts, parties and players work),
   SPEC §17 and the milestone 3 notes under "Changed while building".
3. The platform side is ready: SDK `0.1.0-alpha.5` has everything racecar uses (host controls,
   listings, parties, `lanRoute`), and the `racecar` instance has parties and Direct connections
   on (see "GameRelay side" below).
4. Before changing anything: `bun test && bun run typecheck && bun tools/validate.ts --ai`. All
   three are green on `main`. Branch off `main`, one PR per change, with CI, then
   `/code-review` with the PR's full URL. Merge, tag and deploy only when the owner asks.

## Where things stand

- **Repo:** `gamerelay/racecar`, private until milestone 3, cloned at `~/dev/racecar`. The default
  branch is `main`.
- **Milestones 1 and 2 are merged** (PRs #1 and #2, `alpha-1.0`), and so are all six of
  [PLAN.md](./PLAN.md)'s phases (PRs #14–#30, `alpha-1.8` to `alpha-1.12`).
- **Milestone 3 (online) is under way:** online lobbies, remote cars, P2P and the host's AIs are
  in (PRs #32–#42, `alpha-1.14` to `alpha-1.19`), and so are a hidden host tab that keeps
  racing, shared traffic, bumps and takedown credit (PRs #46 and #47, `alpha-1.22`), and one
  results table with a vote on the next race (PR #48, `alpha-1.23`). What's left is the milestone 3 list under "Next,
  in order".
- **Released 2026-10-02** (`alpha-1.24` to `alpha-1.27`, PRs #49–#65; CHANGELOG has each):
  - **Short invite links** (#50): `https://play.gamerelay.io/racecar/<link>`, previewed in chat
    apps; an Invite only lobby is link-only (SDK `0.1.0-alpha.5`).
  - **Menus and settings** (#51, #52, #54, [MENU.md](./MENU.md) steps 1–2): the mix (engines down,
    music up), one settings store and panel (sound sliders, a graphics preset, an analytics
    opt-out), a real in-race menu with a Controls screen, choosers instead of `<select>`s, and
    screen transitions.
  - **A codebase review** (#49, #55, #56): the online race code tidied, the clock tower's flicker
    and other z-fighting fixed, fixes across the menus, audio and online, 61 more tests, and
    clicks in the lobby no longer replaying its fade-in.
  - **A loading screen** (#57): the crossed flags pulse on the dark screen between pages (in
    `index.html`, so it's up from the first paint; `src/ui/fade.ts`), at least 0.7 s, and an
    offline race waits behind it.
  - **Paradise v2** (#58), below, and **no fence jutting into the road** at Backroads' Barn (#59).
  - **Six new tracks** (#53, #60, #62): Tokyo dubstep (Downtown), Hawaiian (Paradise), an acoustic
    one (Backroads), Relentless Pursuit and Half Time Surge (any map), and Pursuit Orchestra behind
    the menus (`TITLE_TRACKS`, taking turns with the title's own). Twelve in all, 35 MB on the CDN.
  - **Boost, Overdrive and the slipstream** (#61, SPEC "Changed while building"): boost easier to
    earn (`boostEarn` 1.2), a quarter longer (`boostDrain` 0.8) and stronger (`boostAccel` 18.5,
    `boostTop` 1.35); Overdrive, the top speed climbing 6% over 5 s flat out and clean on a
    straight (`cruise*`); the slipstream behind a car on a straight (+5% top, less drag) and its
    slingshot for pulling out to pass (+10% for 1.5 s, `slip*`, `sling*`). The AI uses all of it,
    and holds its boost while it gets round something.
  - **Docs** (#63, #64): PLAN's "Next up" from the playtest, a pickup truck and Avalanche (a
    planned Alps map); a tech-debt pass over the whole codebase (TECH_DEBT.md, 33 items).
  - **Fixes** (#65): the minimap was the track's mirror image (now `fitBox`, shared with the
    thumbnail), Overdrive re-popped, a slingshot survived a wreck.
- **Paradise v2** (PR #58, in alpha-1.24): playtest feedback was "the vibe is right, but the map is a
  little boring and hard to race". In thirteen commits:
  - **More swing:** deeper S-bends, sweepers 3 m wider (`driftWidth: 3`), the jungle's hairpins
    opened from 18–22 m to 37 m and more, and a bulge up the slope between them.
  - **Forgiving verges:** walls only where there's a drop, and the ground past the road is its
    own surface (`TrackPoint.verge`: `beach`, `undergrowth`, `ash`), which slows you without
    spinning you and throws up its own dust (`DUST` in `renderer.ts`).
  - **Secret shortcuts** (`BranchDef.secret`): the Beach Cut and Smugglers' Trail (a jump across
    the jungle's bulge, over a log). No sign, not on the minimap or thumbnail, and the AI takes
    them at 0.35× its usual rate.
  - **Lava:** rivers down the cone (scenery), and at chaos a soft lava rain
    (`HazardDef.mayhem`, `params.soft`).
  - **The jungle's road:** patchy laterite with worn ruts and mossy verges, and trees 10 m back.
  - **No walls at the shortcuts** (after a drive): the Sandbar, the Beach Cut and Smugglers'
    Trail have none (they jutted into the main road where a cut runs beside it), the Lava Tube
    keeps them only inside the rock, and Downtown's Alley drops its Boulevard-side wall past the
    last shop (with no wall, a car would drive through a shop: buildings don't collide).
  - **The grid in your own lane:** where the start has two-way traffic (every map), the grid
    lines up in the race's half, staggered (`gridOncoming` in `sim.ts`), so nobody starts facing
    oncoming cars. Field wrecks over 16 seeds: 18/20/10 (Paradise/Downtown/Backroads) against
    13/16/15, none at the start: noise.
  - The reasons and measurements are in SPEC "Changed while building" ("Paradise v2"), and the
    lessons (cuts only pay across a bulge; lay a hairpin as two nodes) in MAPS.md. Each piece is
    its own commit; after merging, the whole PR reverts with `git revert -m 1`.
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
    pillars over the bay, and a colour grade in the post pass. With PR #58: lava rivers down the
    cone (`lavaFlows`), the jungle road's laterite and ruts (`earth` in `track.ts`), verges in
    their own surface's colour, and a fallen log under Smugglers' Trail's hump.
  - **Landmarks and smashables** (`landmarks.ts`, `smash.ts`): built from layout data, a few
    instanced draws each.
- **UI** (`src/ui`): the title screen with the lobby list, Create lobby, the lobby with a car
  select (your car on a turntable, `src/render/showroom.ts`, with stat bars) and the plate
  editor (`menu.ts`), all over a live AI race on the lobby's map. Then the HUD, countdown lights,
  results table and minimap. A race's whole setup lives in the URL (`setup.ts`).
  - **Settings and menus** ([MENU.md](./MENU.md)): the settings store (`src/settings.ts`) and
    panel (`settings.ts`), the in-race menu and Controls screen (`controls.ts`), both on one
    `Overlay` base (`overlay.ts`: inert behind, focus back on close), choosers (`chooser.ts`),
    and the loading screen between pages (`fade.ts`, with its markup and logo in `index.html`).
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
| Lap length | 3.26 km | 2.92 km | 3.80 km (3.44 before PR #58) |
| AI lap floor (hard, empty track) | 57.9 s (58.6 before PR #61's boost) | 62.9 s (63.4) | 71.5 s (71.9; 66.8 before PR #58) |
| Wrecks per 8-AI race (`lap-report --field`, 16 seeds) | 1.3; 2.0 at chaos (`--chaos`) | 0.6; 0.6 at chaos (0.8 before PR #70) | 1.5, the tests' limit (1.1 before PR #61); 1.7 at chaos |
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

### The Paradise lap (Island v2, PR #58), in order

Clockwise round a tropical island, the volcano in the middle and the sea all round. Lava runs down
the cone's far flanks.

- **Harbor Town:** the start on the harbour front, two-way traffic, pastel houses both sides,
  the tiki bar on the sand and the pier with fishing boats. A deep S out of town, and the
  **Beach Cut** (secret) runs straight on along the sand inside it.
- **Coconut Coast:** the wide beach road (18.5 m, more in the sweepers) up the west shore, then an
  S over the headland and back to the water. The **Sandbar** runs straight on along the
  waterline on loose sand, with a dune to jump and wet sand (`shore`) at the water's edge.
  Coconuts drop off the palms before it.
- **The Freeway:** up a ramp to a deck 10–14 m over the bay, one long banked sweep round the
  north shore on concrete pillars. It's one-way, both lanes with the race, and the traffic
  keeps to the straights either side of its bend.
- **Jungle Switchbacks:** off the deck into the jungle on red earth: an open hairpin, a bulge up
  the slope and back, and a second hairpin, under a rope bridge, past a waterfall.
  **Smugglers' Trail** (secret) jumps straight across the bulge over a fallen log. At chaos,
  lava rain falls over the bulge's top.
- **Volcano Rim:** the climb round the cone's flank on lava rock, swinging in and out, over the
  shoulder's crest, with ash past its edges. The **Lava Tube** cuts through inside it, roofed with
  rock and lit by lava. Volcano bombs (two at a time) land on the rim road's last stretch, which
  the tube skips.
- **Lighthouse Point:** a jump off the rim (lava rain on the way down, at chaos), the lighthouse on
  its point, round it in two corners, the cliff road, and the S back into town.

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
- **What's there now:** `alpha-1.30` (PR #77, quieter snow; before it `alpha-1.29`, Avalanche), updated 2026-10-02 by the owner
  (the production database is theirs to write), with every track on the CDN. Keep it the one row: update Z442EE in place rather than adding a game.

## Next, in order

0. **Caldera, the engine** (now): [CALDERA.md](./CALDERA.md)'s build order, from step 0 (the
   safety net and the first tools). See "Next: Caldera" at the top.
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
   - **The race on `relay.tick`** (PR #46, `alpha-1.22`): an online race steps on the SDK's tick, a worker
     timer that keeps going in hidden tabs (`src/net/stepper.ts`), so a hidden host tab no longer
     freezes the AIs; drawing stays on `requestAnimationFrame`.
   - **Traffic, bumps and credit** (PR #47, `alpha-1.22`): the race's clock is the server's (traffic was
     15–20 m apart between screens), traffic hits are claimed (`src/net/traffic.ts`), and bumps
     and takedown credit cross screens (`src/net/contact.ts`).
   - **Results and the vote** (PR #48, `alpha-1.23`): one results table from each car's own screen, a vote
     on the next map on the results screen (`src/lobby/vote.ts`, `src/net/postrace.ts`), and
     straight into the next race.

   Next, in order:
   - **Names over cars** within ~60 m, from player data (PLAN phase 3), and **a net overlay**
     (pings, routes, entity ages, claims and bumps) to debug online races in playtests.
   - **Before the repo goes public:** a P2P opt-in (it shows IPs today), a filter on Public lobby
     names (strangers see them), and seat reservations for invite links if GameRelay adds them.
     Also: the git history's author email becomes public with it. Rewriting the history is the
     only fix, and that's the owner's call.
   - The repo goes public. Then milestone 3b: the neon skin on Downtown (SPEC's City), which is
     the launch. Touch controls first: phones will be much of the link's traffic.
2. **Drive the new feel (alpha-1.25):** boost, Overdrive and the slipstream are tuned against the
   AI only. Does boost now feel worth chasing? Does Overdrive's 6% read on a straight, and the
   "Slingshot!" when you pull out from behind a rival? The numbers are all in the F4 panel.
   Paradise's field is at 1.5 wrecks a race over 16 seeds, the field tests' limit, so a change
   that adds speed there has to give some back.
3. **PLAN.md's "Next up"** (from the playtest): the click effects, the title's music and Logger's
   Leap are done (`alpha-1.28`; listen to the clicks, and open the title in a fresh browser
   profile to see the music hint, neither checked by ear or eye here). Left: the traffic fading
   out in front of you (investigated: choose a fix from PLAN's options), Backroads by day (a
   maybe), and more particles and sounds when smashing props. Then the pickup truck. Avalanche is
   under way on its own experimental line (PR #74, above): items 1–7 of AVALANCHE.md's "Next: a
   loose plan" are built. What's left is listed above ("What's left on Avalanche"), and so is the
   owner's next direction, Paradise as an open map.
4. **Paradise v2 (alpha-1.24):** (the owner now wants Paradise opened up like Avalanche, above;
   this is for the current layout meanwhile) drive it. Do the Beach Cut and Smugglers' Trail feel
   like a fair gamble? The hard AI is about even on both (−0.4 s and level). Does the dust feel
   right running wide onto the beach and the jungle's edge? It isn't checked by eye: the poster
   scout's cars stand still, so tune `DUST` in `renderer.ts` from a drive. And is the lava rain at
   chaos enough, or too much?
5. **The menu plan, step 3** ([MENU.md](./MENU.md)): keyboard remapping on the Controls screen,
   hints built from the bindings, and gamepad deadzone, rumble and sensitivity.
6. **Playtest with a controller** whenever there's a build to try: tune with F4, and press F8 on
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
  - An online Create lobby can't be cancelled: Esc to the title, and if the create lands after,
    the menu opens the new lobby.
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
- **Found in the tech-debt pass (2026-10-02), not fixed yet** (the first three were, in PR #65):
  - A spurious run-off dust puff: `lastSurface` (renderer.ts) is only updated for cars in effects
    range and not wrecked, so a car that left the road out of range (or wrecked) and comes back
    still off it puffs as if it had just run off.
  - Maybe: the island's lava flows, crater pool and waterfall are `ShaderMaterial`s with no fog,
    so in rain (fog much nearer) they may stand out against fogged land. The lava may be meant
    to glow through; the waterfall probably isn't. Check in the browser.
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
