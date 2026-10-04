# Technical debt: suggestions

Things that might be worth refactoring, drying up, combining, adding or improving. **None of it
is decided.** It's a running collection of what we've noticed while building, so that when
there's enough of it to see the whole picture we can plan what to do about it, and in what order.

How to use it:

- **Add to it as you go.** Noticed something awkward while working on a feature? A line here,
  with where it is and why it bothers you, is enough. No fix needed.
- **Strike or delete what's done or no longer true**, and say which PR handled it.
- **It isn't a to-do list.** An item can stay here forever if it never starts to hurt. Bugs and
  gameplay gaps go in [HANDOFF.md](./HANDOFF.md)'s "Smaller follow-ups"; this is about the code.
- **Each item says roughly what it'd take** (small, medium, large) and what it would buy, so it
  can be weighed against features later.

Last updated 2026-10-03 ("Open ground and Paradise Open", from a review of PRs #79–#81). Before
that, 2026-10-02: a quick pass over the whole codebase after alpha-1.26 (the sim, the rendering
and the page; its bugs went to HANDOFF's "Smaller follow-ups").

## Online (`src/net`, `src/lobby`)

The net layer grew one module per problem during milestone 3 (cars, rivals, stepper, traffic,
contact, join). It works and each part is tested, but some patterns repeat.

- **One name for a car across screens.** contact.ts names cars `p:<player id>` / `s:<seat>`
  (`carNames`); rivals.ts goes by seat, cars.ts by owner id, and join.ts holds the maps. One
  `CarNames` made in join.ts and handed to every layer would remove the parallel lookups, and
  the net overlay (HANDOFF) would want it too. *Small.*
- **One event pump for the net layers.** `NetTraffic`, `NetContact` (and telemetry) each keep a
  cursor on the sim's event queue and filter it themselves. A single after-step dispatch (event
  type → handlers) would read the queue once and make it obvious who reacts to what. *Medium.*
- **`RoomLike` (lobby/relay.ts) and `NetRoom` (net/cars.ts) are two views of the SDK's room**, and
  join.ts casts one to the other. One `RoomLike` that declares what both use (`define`,
  `renderTime`, `hostId`, `claim`, `emit`, `on`) would drop the cast; the cost is every test fake
  growing those. *Medium.*
- **Two test fakes of the SDK.** `test/relay.test.ts` (Hub, FakeRoom, FakeClient, FakeRelay) and
  `test/net.test.ts` (another Hub) each fake part of GameRelay. One shared fake in
  `test/fake-relay.ts`, with claims, events, entities and host changes, would keep their behaviour
  in step with the SDK's and with each other. *Medium.*
- **The relay tests sleep** through the listing's 1 s throttle (about 4 s of the run) and use
  tight real-time waits; an injected clock (as presence.ts has) would make them faster and
  steadier. *Small to medium.*
- **Net layers aren't closed.** `NetTraffic.close`, `NetContact.close`, `NetCars.dispose` and
  `PostRace.close` exist but nothing calls them, since the race page lives as long as its race. Harmless now; it matters if a race ever
  restarts in place (Race again online). *Small.*
- **The results screen only redraws in frames:** a hidden tab reports and runs the vote (on the
  relay's tick, `net/online.ts`), but can't show or take a vote. Fine for people; worth knowing
  in tests. *Small.*
- **The vote's map list is "every map, in name order"** (`OnlineRace.results`, net/online.ts). If maps grow past a handful,
  it wants a pick of three (the current one and two others, by the seed). *Small.*
- **Votes aren't checked against the ballot:** `readAction`'s vote and `readVote` check a map
  key's shape, and `tally` counts any key, so a modified page can vote for a map that isn't on
  offer (or doesn't exist: every screen falls back to the default the same way, so no desync,
  just a wasted vote). The host could drop votes outside `PostRaceDeps.maps`. *Small.*
- **Three lap ceilings:** `apply` clamps to 5 (`lobby.ts`), the wire readers allow 9
  (`lobby/wire.ts`), and `MAX_LAPS` is 5 (`ui/setup.ts`). One constant. *Small.*
- **Two sets of untrusted-value helpers:** `lobby/wire.ts` (`obj`, `str`, `int`, `time`) repeats
  `net/check.ts` (`fields`, `shortText`, `intIn`, `finite`); the "Done" item below only covered the
  race's side. *Small.*
- **`OnlineRace` (net/online.ts) has no tests:** the switch from the page timer to the relay's
  tick, and the results wiring. *Small to medium.*
- **Positions from other screens aren't checked**, only speeds and turns. A pose near the track,
  and near where that car last was, is the next check (also in HANDOFF). *Medium.*

## The sim and the AI (`src/core`)

- **The top speed is worked out twice, and the two already differ.** `physics.ts` multiplies
  the class's by boost, mini-turbo, slipstream, slingshot and Overdrive; `ai/racer.ts` writes it
  out again for the AI's speed cap and leaves out `miniTurboTop` (which the start boost gives
  even with `TUNING.miniTurbo` off). Every new modifier goes in both. A `topSpeed(sim, i, cls)`
  in physics.ts for both. *Small.*
- **The steering model is copied three times:** `turn / (1 + (v / steerFalloff)² · 0.9)` in
  `physics.ts` and twice in `racer.ts` (`cornerSpeed`, `maxYaw`), the 0.9 written out each time.
  Change the physics and the AI's speed profile silently goes stale. A `maxYawRate(turn, v)`,
  with the 0.9 in TUNING. *Small.*
- **`SKILL[].brake` is never read:** easy, normal and hard set 18 / 22 / 26, but `racingLine`
  brakes at a fixed 22 (and assumes a turn rate of 2.4) and is cached per spline, so every
  difficulty and class brakes at the same points. Delete the field, or cache the line per
  (spline, brake, turn). *Small.*
- **The slipstream's and Overdrive's other thresholds aren't in TUNING:** the "ahead" bounds
  (−2, 3 m), the straight test (0.98, about 11°), "beside" (3 × `slipWidth`), the ease (3/s), the
  drag cut's 0.85 of top, Overdrive's throttle 0.9 (`physics.ts`). The F4 panel can't reach them
  and a replay's TUNING copy doesn't carry them. *Small.*
- **"The sample at distance s" by hand:** `sampleIndex` (`bake.ts`) exists, but `lineAt`
  (`racer.ts`), `slipstream` (`physics.ts`, clamps without wrapping) and `straightenSections`
  (`validate.ts`) each work it out again. One place to decide the wrap. *Small.*
- **The AI's shortcut choice hangs on branch order:** `hash01(seed, i * 131 + b, lap)` with `b`
  the branch's index (`racer.ts`), so adding or reordering a branch reshuffles every AI's choices
  and moves the lap floors and field reports with no change to the driving. Hash the branch's
  id. (And `validate --ai` says the floor is "every shortcut"; the hard AI takes each 85% of the
  time, a secret one about 30%.) *Small.*
- **Branches by position and by fractions of their length,** in the generators and the skins:
  `splines[1]`, `[2]`, `[3]` in `gen-paradise.ts`, `gen-countryside.ts` and `gen-city.ts` (beside
  `.find` by id in the same files); the Lava Tube's 0.22–0.78 written in `gen-paradise.ts` (the
  wall gaps, baked to meters) and three times in `island.ts` (the rock, the roof, the rain
  cover), with nothing tying them together; the Barn's 0.28 / 0.7, the Alley's 0.76. Reorder or
  reroute a branch and walls and roofs move apart silently. A `splineById`, and the tube's span
  as data on the layout (`cover: [from, to]` on the branch) for the skin and the walls to share,
  with a test that the walls are where the roof is. *Small to medium.*
- **Props at absolute lap distances:** hay bales and mailboxes (`gen-countryside.ts`) and fruit
  stands (`gen-paradise.ts`) are at fixed meters where everything around them uses `sAt(x, z)`;
  a change to an earlier node slides them along the lap. *Small.*
- **The generators share boilerplate:** `puddle` is copied word for word in all three,
  `gen-city.ts` writes its own `sAt` instead of `onLap`, and each repeats the ending (straighten,
  write, bake again, print). `puddle` and a `writeLayout` in `tools/lib/lap.ts`. *Small.*
- **The validator doesn't check what points at a branch, or the verges:** a `spline` id on a
  wall gap, ramp, zone or prop that matches nothing is dropped when baking (`pick` in `bake.ts`),
  so a typo in `'lava-tube'` quietly puts its walls back; ramps and zones on a branch are checked
  against the main road's length. A bad `verge` falls back to the shoulder surface and a bad
  `shoulderSurface` to index 0 (asphalt), both without a word (Paradise has 123 verge entries).
  `shoulderSurface` is also looked up three times (`track.ts`, twice in `sim.ts`): once, on
  `Track`. *Small.*
- **Results passed through shared scratch and module globals:** `gridCar` (`sim.ts`) reads
  `this.hitA` after `placeCar`, which only works because `placeCar` happens to leave the same
  sample there; `avoid()` (`racer.ts`) hands back `avoidCap`, `lastT` and `mk` through module
  variables. `placeCar` returning its hit, and a small result record for `avoid`. *Small.*
- **Two hand-kept reset lists:** `placeCar` (`sim.ts`) and `respawn` (`physics.ts`) each list
  which car fields to clear, and they differ (the slingshot bug in HANDOFF). A
  `clearTransient(cars, i)` both call. `gridOncoming` checks fixed points (L−50 … 30) where a
  16-car grid reaches L−77, and assumes the oncoming lane is the left one. *Small.*
- **Per-tick scans in the AI:** `avoid()` loops over every prop on the track for every AI every
  tick (the Trestle's legs too), filtering by spline as it goes, and samples every hazard piece.
  A per-spline prop list on `Track`. *Small.*

## The page (`src/main.ts`, `src/ui`)

- **main.ts still does a lot** (572 lines): setup from the URL, the sim, the renderer and audio,
  the step loop, menus and pause, system keys, the editor, the dev hook. The online part is out
  (`net/online.ts`); the step loop (`stepOnce`, the stepper, the catch-up after a hidden stretch)
  could follow into `race/loop.ts`. *Small to medium.*
- **The frame-side event readers** (renderer, HUD, race UI, audio, rumble, the greybox world)
  each keep their own cursor and lean on `EventQueue.skip` after a hidden stretch. Anything that
  keeps *state* from events (like the renderer's crumple and repair) needs its own catch-up
  (`renderer.catchUp`). Reading state rather than events where it matters (as the results now do
  with `finished[]`) is the safer pattern; worth a sweep. *Small to medium.*
- **No DOM in the tests**, so the race UI, HUD and menu screens are only checked in the browser.
  A light DOM (happy-dom) for a few UI tests (results on finish, the lobby's seat table) would
  catch regressions there. *Medium.*
- **menu.ts is 696 lines** of screens as HTML strings with handlers wired after. Fine while it's
  one person's code; a tiny per-screen split (title, create, lobby, plate editor) would help
  once more people touch it. *Medium.*

- **Two places for some settings:** M and N (`racecar.audio`) sit beside the store's volumes,
  and analytics is kept twice (`settings.analytics` and `racecar.telemetry`, the old key, still
  read by the sink). Two sources of truth are what let F6 and the opt-out drift before this
  review's fixes. Fold mute and music into the store, and the old key into a one-time
  migration. *Medium.*
- **The settings listener re-applies everything** (`main.ts`, `settings.onChange`) on every
  slider tick: the renderer's quality, the FPS counter, the opt-out (a storage read). Per-section
  diffs would make a tick only touch the audio. *Small.*
- **The overlay order is spread out:** `openMenu()` and the back/Esc branches in main.ts's
  `input.on` decide who's on top (the F8 form, Settings or Controls, the pause menu, results, the
  menu). A pure `topOverlay(state)` would be one place to read, and testable (it would have
  caught the gamepad going to the menu under the F8 form). *Small.*
- **Little helpers written more than once:** the id-plus-handler helper (`menu.ts` `on` and
  `change`, `settings.ts` `on`), the reduced-motion check (`fade.ts`, `menu.ts`), the on/off
  options (`settings.ts`, `menu.ts`), the `key.startsWith(map + '/')` layout lookups (`main.ts`,
  `menu.ts`), and a localStorage try/catch in main.ts that `storage()` already does. *Small.*
- **`<select>` leftovers:** the only one left is the editor's, but `nav.ts` and `isTyping`
  (`input.ts`) still handle selects. Harmless; drop when the editor's goes. *Small.*
- **Back/forward cache:** if the browser restores a menu page from it (the back button), the fade
  comes off but `Menu.going` stays true, so the lobby stops redrawing and Start does nothing. Not
  seen yet; `location.reload()` on a persisted `pageshow` would cover it. *Small.*
- **Settings values off their lists:** a stored resolution that isn't one of the chooser's (0.75)
  shows as the first option; `parseSettings` could snap it. `SettingsStore.set` doesn't clamp
  volumes (only `parseSettings` does). *Small.*
- **The gamepad's menu actions** (`Input.buttons`: press edges, stick to direction) could be a
  pure `padActions(prev, buttons, menuOpen)` with tests on fake button arrays. *Small.*
- **One game event, four switches:** the HUD's pops (`hud.ts`), the audio's cues (`audio.ts`),
  the rumble (`main.ts`) and telemetry (`telemetry.ts`) each switch on `Ev`, and nothing says a
  new event reached them all: Slingshot and Overdrive got a pop and a sound but no rumble or
  record. One table by `Ev`, or the switches with an exhaustive check; a pure `popFor(event)`
  would make the HUD's testable without a DOM. *Medium.*
- **Telemetry misses the newer moments:** Slingshot, Overdrive, DriftChain, DriftBoost,
  ChainLost, AirBoost, MiniTurbo and Smash fall to `default` in `telemetry.ts`, so PostHog can't
  say whether the slipstream, Overdrive or drift chains get used, which is what tuning needs.
  *Small.*
- **The keys are written down in five places:** `KEYS`, `SYSTEM`, `MENU_KEYS`, `PAD_NAV` and
  inline pad button numbers (`input.ts`), the Controls screen's prose (`controls.ts`), "M mutes…"
  in `settings.ts`, the toasts in `main.ts`, and `input.ts`'s header. Remapping (MENU.md step 3)
  needs one `BINDINGS` table (action, keys, pad buttons, label) that `Input` reads and Controls
  draws. *Medium.*
- **The pause menu and How to play are inline in main.ts** (`setPaused`): the only overlay that
  isn't an `Overlay` like Settings and Controls, with the tips as HTML in a template (and not
  following TUNING: they'd mention a mini-turbo that's off). A `ui/pause.ts`, and the tips as data
  (`ui/help.ts`) that loading or title tips could share. *Small.*
- **A new map touches the music code and two tests:** `TRACKS` and `MAP_TRACKS` are keyed by map
  id (`soundtrack.ts`), the audio test wants a `MAP_TRACKS` entry named after each map, the lobby
  test hard-codes each layout's `LAP_KM`, and the default map is set twice (`DEFAULT_LAYOUT` in
  `main.ts`, `DEFAULT_OPTIONS.map` in `lobby.ts`). A `music` list on the map's content, with
  `TRACKS` derived from it, and the tests reading the maps. *Small to medium.*
- **The race options' values are defined five times:** the labels in `menu.ts`, the `oneOf`
  lists and unions in `setup.ts`, the unions in `lobby.ts`, the wire readers' lists in
  `lobby/wire.ts`, and `TimeOption` in `core/content.ts`. A new one (snow, night) touches all
  five, and a missed one is a silent fallback to the default. One `RACE_OPTIONS` table, with the
  types and readers from it. *Small.*
- **Storage keys, store types and test fakes are scattered:** five key names in five files, two
  identical interfaces (`SettingsStorage`, `KeyValue`), the audio and PostHog code on the global
  `localStorage` (so they can't take an injected store), and four hand-rolled memory stores in
  the tests. One `KeyValue`, a keys module, and a shared `test/fake-storage.ts`. *Small.*
- **The results table's logic is mixed into its HTML:** `rows()` (`race.ts`) sorts (official
  times, then place, then progress), places, finds the fastest lap and writes the gaps inside one
  template, untested. It decides what online players see as their result. A pure
  `resultTable()` with tests, and `rows()` only drawing. *Small.*
- **The menu's in-flight flags:** `going`, `sitting`, `backing`, `entering`, `leaving`
  (`menu.ts`), and `if (this.screen !== screen) return` after each await. Every new async step
  has to remember both (the stale-screens bug was one that didn't). A per-`show()` token, and one
  transition state. *Medium.*
- **Held keys are the module's:** `held` (`input.ts`) is shared by every `Input`, the
  constructor adds window listeners with no `dispose`, and the input tests fire `blur` to reset
  it between them. `fakeBrowser` lives in `test/fake-audio.ts`. An instance field, a `dispose()`,
  and `test/fake-browser.ts`. *Small.*

## Rendering and content

From the two code reviews of the art work (moved from HANDOFF; none of it is a bug):

- **One road spatial index** for `cityscape.ts` (Corridors), `forest.ts`, `island.ts` and
  `terrain.ts`: the forest and the island each hash the road the same way. *Medium.*
- **One instancing builder** for `scenery.boxes()` and `forest.instanced()` (the island uses the
  latter), and a `gantry()` helper. *Small to medium.*
- **Split the two biggest functions:** `buildCar` (`car/build.ts`, ~680 lines: body, cabin,
  lamps, wheels, glows) and `buildCityscape` (`cityscape.ts`, ~680: buildings, signs, streets,
  ambience). *Medium.*
- **A shared `lateralOf(sp, i, x, z)`** in `query.ts` for the ~8 hand-written lateral
  projections. *Small.*
- **`src/content.ts` (the bundle loader) and `src/core/content.ts` (types) share a name**, and
  `src/content.ts` (Vite's glob) and `tools/content.ts` (readdir) each build the classes, surfaces,
  paints and maps, with the map order from glob order in one and readdir order in the other. One
  shared key, path and order helper. *Small.*
- **Depth precision:** the camera's near plane is 10 cm and far 3 km, so surfaces a few
  centimetres apart flicker from a couple of hundred metres (1 cm at ~130 m, 5 cm at ~290 m,
  10 cm at ~410 m). This review fixed the ones that showed (the clock, the start line, markings,
  trench lips, the fountain, a few signs) and lit signs now use polygon offset (`lit` in
  `landmarks.ts`). Still close: the city billboards' faces (10 cm off their frames,
  `cityscape.ts`), the leader board and drive-in screens (10 cm), the towers' lit crown bands, the
  Skyway gantry sign (5 cm), the water tower's name band (5 cm), a branch's deck where it merges
  (`SINK`, 5 cm), and the cars' plate text and seams (4 to 9 mm; only rivals far off). A global
  fix (reversed-Z, or a nearer-far split) has catches: raising `near` clips the car select's
  table (`showroom.ts`'s SCALE would need to grow with it), and a logarithmic depth buffer breaks
  `post.ts`'s `invZ`/`carAt`. *Small per surface, medium for a global fix.*
- **A class with no mass** would make `cars.ts`'s `sqrt(mVic / mAtt)` NaN; the content validator
  doesn't check mass. *Small.*
- **Dust lives in the renderer, the ground in content** (PR #58): `DUST` in `renderer.ts` is
  keyed by surface id, with a fallback to dirt, so a new surface in `surfaces.json` silently
  throws dirt. A `dust` block (or a style name) on the surface would keep the two together.
  The skids' tint (`'grass'` or `offroad`) and the `'puddle'` checks (`renderer.ts`, `track.ts`)
  are the same coupling. *Small.*
- **The island's earth styling keys off `surf.offroad`** (`earth` in `track.ts`: patchy deck,
  wandering ruts, earth kerbs), and Smugglers' Trail's "jungle closes in" keys off a secret
  branch's surface not being sand. Both are rules of thumb that a new surface could trip; a
  look on the surface (or the branch) would say it. *Small.*
- **`roadGap` in `island.ts` reports its nearest road through closure variables**
  (`nearX`, `nearZ`, `nearSecret`), read straight after each call. A returned record would be
  harder to misuse. *Small.*
- **Set pieces found by id:** the barn (`forest.ts`, `'barn'`), the creek (`'creek'`), the Lava
  Tube (`island.ts`, `'lava-tube'`), the jungle (wherever the surface is `'red-earth'`: the rope
  bridge and the waterfall) and the signs (`sandbar`, `lava-tube`). Rename a branch or retexture
  a stretch and the piece disappears, with no error and no failing test. A tag on the branch or
  stretch in the layout, or at least a validator warning when a known one is missing.
  *Small to medium.*
- **`buildForest` (~650 lines) and `buildIsland` (~585)** are as long as the two above, and
  `buildTerrain` is ~315: each one closure over ~20 `Part[]` lists and shared `keep`/`roadGap`
  state, where order matters and nothing says so (logs and huts before the tree scatter, so trees
  avoid them). Sections (town, volcano, tube, jungle, trees, signs) taking a shared context, the
  scatter last. *Medium.*
- **The road's looks are hex strings in nested ternaries** in `buildChunk` (`track.ts`, ~210
  lines): concrete, earth and timber against city, country and island, none from `Palette`. Each
  new look (Avalanche's snow road) is another branch in each. A `RoadStyle` record per scenery
  (verge, kerb, barrier, drop, deck, underside), like the railings' `STEEL` and `TIMBER`.
  *Medium.*
- **A new smash kind crashes the skin:** `smash.ts` calls `MODELS[id]()` for every id in
  `SMASH_IDS` and the validator accepts any of them, so a kind with no model throws when the world
  is built; its burst colour is repeated by hand in `renderer.ts` (`SMASH_BURST`), and the hay
  bale's yaw is special-cased by id. One record per kind (model, burst colour, yaw), typed so a
  missing one doesn't compile. Worth doing with PLAN's "more particles and sounds when smashing".
  *Small.*
- **Rock or slab by whether it has a `roll`:** `island.ts` sends `tubeRock` parts with a `roll`
  to icosahedra and the rest to boxes, on one list shared by the tube's walls, its rubble, the
  rope bridge's stacks and the waterfall's cliff. Give a wall `roll: 0` to tilt it and it's a
  rock. Two lists, or a `shape`. *Small.*
- **The rear wheels are placed by hand twice** in `renderer.ts` (dust and smoke at `size[0]`
  across, skids at `size[0] − 0.2`, both at `size[1] − 0.6` back), apart from the car models'
  own wheels. A car built differently (the bus, the planned pickup) throws dust and skids from
  the wrong place. A `rearWheels()` helper, or wheel offsets on the design. *Small.*
- **Two canvas-texture helpers:** `canvas` (`scenery.ts`) and `liveCanvas`/`staticCanvas`
  (`landmarks.ts`) do the same (anisotropy 4, redraw when the fonts are ready). One, so a fake 2D
  context for tests stubs one place. *Small.*

## Open ground and Paradise Open (`core/track/ground/`, the open-ground renderers)

From a review of the Paradise Open work (PRs #79–#81, 2026-10-03). It all works and is tested;
this is about shape. Caldera's step 1a cleared three: `buildGround` is split (`ground/`), what's
under a point is one query (`ground.cast`), and the lateral projection and `smooth` have one home
each (`track/frame.ts`, `math.ts`'s `smoothstep`; `query.ts`'s own projections remain, see "A
shared `lateralOf`").

- **`snow.ts` draws every open ground**, Paradise's island too: its colours (sand, beach, grass,
  the verges, the volcano's rock), and its roads laid over the ground. Rename it (`openGround.ts`),
  and move the island's colouring next to `openIsland.ts`. *Small.*
- **The verge off the sand is still the road's** (`surfaceAt` takes it from the nearest road's
  sample, the drawing from the main road's nearest the grid point): the two can differ beside a
  branch. The volcano's rock is a colour over the verge (ash), not a surface. *Small.*
- **Overlapping features (none yet):** two beaches each claim sand by their own table while the
  palms read the merged `ground.beach` (they'd disagree where beaches overlap); two canyons' tree
  test is per canyon, not on their sum. `side` and the AI reading a canyon's `def` are one-feature
  hooks: tidy when a second user turns up (palms asking per point; the canyon list on `Ground`).
  *Small.*
- **Wrapping past the line is inconsistent:** beaches wrap (`s[0] > s[1]`); pieces (`definePieces`,
  `runIn`, `pull`) don't, so a piece across s = 0 can't be said (the validator rejects `s[0] > s[1]`). The generator's
  `beside` doesn't wrap either (fine at 2,685 and 3,255 m). *Small.*
- **`pastGap` (respawns) finds the jump's kicker by its ramp heights** (`sp.ramp`). A gap with no
  kicker, or a kicker not at a gap, would surprise it. A gap could carry its run-up. *Small.*
- **`physics.ts` and `collide/walls.ts` import each other** (`hitFace`), and `walls.ts`'s
  `bounce` takes `reach` and `side` only to place the hit's event. *Small.*
- **`buildOpenIsland` also runs on Avalanche** (`sea !== undefined || track.pines`), coming out
  empty, and `track.ts`'s `if (isle) update = ...` replaces any `update` before it. *Small.*
- **`finishProjection` calls `top(x, z, cy + 0.5)` with the road's height**, not the car's: an
  extra deck query on every projection, for a value only the skid marks read. *Small.*
- **`terrain.ts` re-exports `coneHeight` and `loopDist`** from `core/track/island.ts`; import
  them from there. And `bake.ts`'s `buildPines` verge callback is a dense inline expression
  (a named helper). *Small.*
- **The Lava Tube's verge is `beach`** (the layout's `shoulderSurface`, Paradise's), so off the
  tube on the volcano's flank you drive "beach" (probe at 98, -104). Give the tube's points a
  `verge` (ash). *Small, but it changes driving there.*
- **A lava stream can't cross a road** (the validator refuses it): a bridge over one, a deck
  piece where the road crosses the channel (CALDERA's "A feature, end to end", item 3), when a
  stream needs to. *Medium.*
- **The ground's kinds are per grid point** (2.5 m): a lava stream's rock meets the grass in
  steps, softened by the surface noise; the sand's edges too. *Small.*
- **Paradise Open's tests live in `deck.test.ts`** (~700 lines: decks, the island, the tube, the
  jump). A `paradise-open.test.ts` of their own. *Small.*

## Performance

Nothing here is a problem today (the game holds the display's 120 fps on the dev Mac), but these
are the known costs that grow with content:

- **Tile the Valley's terrain** (one 256k-triangle mesh, never culled). *Medium.*
- **Upload only what's live:** ambient cars and particles upload whole buffers each frame.
  Ambient city cars could also animate in the vertex shader (they're only posed within 420 m of
  the camera; out-of-range ones are written as zero-scale instances): write the near ones
  compactly and set `count`. *Medium.*
- **`logTruck.at` rescans traffic every tick** for its truck: remember it on the occurrence.
  *Small.*
- **Loading a layout builds all of Downtown in ~200 ms.** Fine per editor edit; cache it if it
  ever runs per frame. *Small when needed.* But the lobby's time of day calls `renderer.setMap`
  (`main.ts`), rebuilding the whole map to swap a palette, a hitch on every change behind the
  lobby. A palette-only path. *Medium.*
- **Post targets stay allocated with post effects off** (`setQuality`): the full-size HalfFloat
  MSAA target and the ink target are kept and resized. Memory only. *Small.*
- **Music in every build:** `public/music` (22 MB) is copied into `dist/` and `dist-single/`,
  though production streams it from the CDN (`VITE_MUSIC_URL`). Serve it in dev from outside
  `public/`, or skip the copy when the CDN is set. *Small.*
- **Telemetry in a hidden tab:** records are queued per step but only flushed from frames, so an
  online race in a background tab queues the whole race (and, with `?trace=1`, a 60 Hz trace)
  until it's shown or the page goes. Flush from the step when it's been a few seconds. *Small.*
- **Measure again:** the frame rate hasn't been measured since the detailed cars went in, nor
  online with 8 cars, traffic hits and bumps on the wire. *Small.*
- **Instance uploads with nothing to upload:** `world.ts` flags the logs' and signs' matrices
  every frame, even at count 0; `smash.ts` runs `computeBoundingSphere()` over every instance on
  each dirty frame (every frame of a 0.35 s pop) on meshes with `frustumCulled = false`, so the
  sphere is never used, and its `update` allocates a closure per kind per frame. *Small.*

## Tooling

- **Paradise's generator places secret cuts by hand-picked points** (`secret()` in
  `gen-paradise.ts`), and any change to a node near one moves its mouths. The lap had to be
  re-plotted (top-down, by a scratch script) after each change to see them. A `tools/plot.ts`
  that draws a layout's splines, distances and tight corners to an SVG would save that. *Small.*

- **No linter.** tsc's `noUnusedLocals`/`noUnusedParameters` are the only lint, and they don't
  see unused exports: about 70 exports are only used in their own file (this review removed the
  ones used nowhere). A minimal
  Biome or ESLint config (unused code, no floating promises, consistent imports) would catch the
  kind of thing reviews have caught by hand. *Small.*
- **Tests that fail on the old code are checked by hand** (stash, run, restore). A note in the PR
  template, or a script that runs a test file against `main`'s source, would make it routine.
  *Small.*
- **Test gaps in pure logic:** still untested: `telemetry/telemetry.ts` (the record mapping, the
  inputs window, `report()`), PostHog's throttle and send path (its key is read when the module
  loads), and the `core/collide` modules (only through the sim). The renderer's surfaces (the
  z-fighting gaps) aren't checked either: the landmarks draw on a canvas, so a test needs a fake
  2D context. *Small each.*
- **The suite takes ~20 s,** 7 s of it the relay tests' sleeps (above), then the map tests
  (2.5 to 3 s each, building their worlds). *Small to medium.*
- **Two copies of `env()`** in `tools/publish-assets.ts` and `tools/lib/s3.ts`; the dev
  endpoints in `vite.config.ts` take any size of body, and a missing `session` writes
  `undefined.jsonl`. Dev only. *Trivial.*
- **Browser checks are manual** (two tabs through the Chrome extension, or puppeteer from
  asleepace.com's `node_modules`). A small script that opens two headless pages on the local
  relay, makes a lobby and starts a race would make online checks one command. *Medium.*

## Ideas, not debt

Not problems, but places where a little work would make the code easier to build on:

- **A net overlay** (pings, routes, entity ages, claims held, bumps sent and applied), already on
  HANDOFF's list: it would make every online item above easier to see working.
- **A recorded online race:** each screen's events and messages to JSONL (telemetry already
  writes local events), so a desync in a playtest can be replayed and compared screen by screen.

## Done

What's been handled, so the list above stays the open ones.

- After the tech-debt pass of 2026-10-02 (PR #65):
  - **One fit-to-box for the minimap and the thumbnail:** `fitBox` in `ui/thumb.ts` (the minimap
    had come out the track's mirror image).
  - **The respawn clears the slipstream, slingshot and Overdrive** (one of the two reset lists'
    differences; the shared `clearTransient` is still open above).

- The codebase review after the menus and settings (2026-10-01):
  - **One overlay for Settings and Controls:** `src/ui/overlay.ts` (focus back to the opener,
    even after a redraw, and what's behind it inert while it's up).
  - **The HUD's dead key strip** (`hud.keys`, `setDevice`) and the `.card select` styles are gone.
  - **Unused exports removed:** `forwardX`, `forwardZ`, `headingOf`, `KMH` (`core/math.ts`),
    `HAZARD_KINDS`.
  - **Lit signs share one material** (`lit` in `landmarks.ts`, with polygon offset).
  - **Tests for what had none:** the audio's event handling and the music sequencer (on a fake
    Web Audio, `test/fake-audio.ts`), `net/check.ts`, the lobby's wire readers, PostHog's
    opt-out, the spline and `locateCar`, the keyboard input, and more of the settings and
    choosers (61 tests). One found a bug: a stored quality of `constructor` or `toString` passed
    as a preset (`in` instead of `Object.hasOwn`).
  - Fixed along the way (CHANGELOG): the audio burst after a mute, the menu's stale screens after
    an await, the overlay order under the F8 form, F6 against the settings, the opt-out with
    blocked storage, slow short-link joins, Invite only's code fallback, the race page's pings,
    and other players' plates.

- After `alpha-1.23` (the online cleanup PR):
  - **One untrusted-number helper:** `src/net/check.ts` (`finite`, `intIn`, `shortText`, `clamp`, `fields`), used by the race's readers.
  - **The race's message readers in one place:** `src/net/wire.ts` (traffic hits, bumps, takedowns, the rivals' handover), next to `lobby/wire.ts`.
  - **`CarContact`'s `b` is named:** `Contact` in `core/events.ts`.
  - **The race's clock has its own module:** `src/net/clock.ts`.
  - **The online wiring is out of main.ts:** `src/net/online.ts` (`OnlineRace`: the join, the net layers around each step, the post-race).
