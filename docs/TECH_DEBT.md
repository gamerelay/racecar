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

Last updated 2026-10-01 (after the menus and settings, and a review of the whole codebase).

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

## Tooling

- **No linter.** tsc's `noUnusedLocals`/`noUnusedParameters` are the only lint, and they don't
  see unused exports: about 70 exports are only used in their own file (this review removed the
  ones used nowhere). A minimal
  Biome or ESLint config (unused code, no floating promises, consistent imports) would catch the
  kind of thing reviews have caught by hand. *Small.*
- **Tests that fail on the old code are checked by hand** (stash, run, restore). A note in the PR
  template, or a script that runs a test file against `main`'s source, would make it routine.
  *Small.*
- **Test gaps in pure logic:** no tests import `telemetry/telemetry.ts` (the record mapping, the
  inputs window, `report()`), `telemetry/posthog.ts` (the throttle, the opt-out), `net/check.ts`,
  `audio/music.ts` (step and chord indexing), the audio's event handling (it needs a fake
  AudioContext; this review's mute bug lived there), `core/track/spline.ts`, `locate.ts`, the
  `core/collide` modules (only through the sim), or `input/input.ts`. *Small each.*
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

- The codebase review after the menus and settings (2026-10-01):
  - **One overlay for Settings and Controls:** `src/ui/overlay.ts` (focus back to the opener,
    even after a redraw, and what's behind it inert while it's up).
  - **The HUD's dead key strip** (`hud.keys`, `setDevice`) and the `.card select` styles are gone.
  - **Unused exports removed:** `forwardX`, `forwardZ`, `headingOf`, `KMH` (`core/math.ts`),
    `HAZARD_KINDS`.
  - **Lit signs share one material** (`lit` in `landmarks.ts`, with polygon offset).
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
