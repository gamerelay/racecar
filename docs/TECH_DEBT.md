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

Last updated 2026-10-01 (`alpha-1.22`).

## Online (`src/net`, `src/lobby`)

The net layer grew one module per problem during milestone 3 (cars, rivals, stepper, traffic,
contact, join). It works and each part is tested, but some patterns repeat.

- **One "untrusted number" helper.** The same `typeof v === 'number' && Number.isFinite(v)`
  check is written five times (`net/cars.ts`, `net/contact.ts`, `net/traffic.ts`,
  `net/rivals.ts`, `ui/setup.ts`), with different fallbacks (null, 0, clamp). A small
  `src/net/check.ts` (`finite`, `clamped`, `int`, `oneOf`) next to `lobby/wire.ts`'s readers would
  make every message reader look the same. *Small.*
- **Message readers in one place.** `lobby/wire.ts` checks everything for the lobby; the race's
  messages are checked inline (`readHit` in traffic.ts, the body of `bumped`/`tookDown` in
  contact.ts, `handover` in rivals.ts). A `net/wire.ts` with a reader per message would make
  "everything another player sends is checked" easy to audit. *Small to medium.*
- **One name for a car across screens.** contact.ts names cars `p:<player id>` / `s:<seat>`
  (`carNames`); rivals.ts goes by seat, cars.ts by owner id, and join.ts holds the maps. One
  `CarNames` made in join.ts and handed to every layer would remove the parallel lookups, and
  the net overlay (HANDOFF) would want it too. *Small.*
- **One event pump for the net layers.** `NetTraffic`, `NetContact` (and telemetry) each keep a
  cursor on the sim's event queue and filter it themselves. A single after-step dispatch (event
  type → handlers) would read the queue once and make it obvious who reacts to what. *Medium.*
- **`CarContact`'s `b` is a little code**: 0 world, 1/2 which car attacked, 3/4 the same from a
  bump another screen sent. Named constants (or a separate `Ev.RemoteBump`) would be clearer.
  *Small.*
- **`syncClock` lives in cars.ts** but is the race's clock, not a car's. A `net/clock.ts` (with
  `startDelay`, `CLOCK_SNAP`) would match SPEC §4's "shared race clock". *Small.*
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
- **Net layers aren't closed.** `NetTraffic.close` and `NetContact.close` exist but nothing calls
  them, since the race page lives as long as its race. Harmless now; it matters if a race ever
  restarts in place (Race again online). *Small.*
- **The post-race's timer is wired in main.ts** (a page timer until the page is in, then the
  relay's tick, through `whenTick`), and the results screen only redraws in frames: a hidden tab
  reports and runs the vote, but can't show or take a vote. Fine for people; worth knowing in
  tests, and a candidate for the `race/online.ts` split above. *Small.*
- **The vote's map list is "every map, in name order"** (main.ts). If maps grow past a handful,
  it wants a pick of three (the current one and two others, by the seed). *Small.*
- **Positions from other screens aren't checked**, only speeds and turns. A pose near the track,
  and near where that car last was, is the next check (also in HANDOFF). *Medium.*

## The page (`src/main.ts`, `src/ui`)

- **main.ts does a lot** (545 lines): setup from the URL, the sim, the renderer and audio, the
  step loop and stepper, the net wiring, menus and pause, system keys, the editor, the dev hook.
  Splitting out `race/loop.ts` (stepping, catch-up, `stepOnce`) and `race/online.ts` (the join,
  the net layers) would make the next online features land somewhere other than main. *Medium.*
- **The frame-side event readers** (renderer, HUD, race UI, audio, rumble, the greybox world)
  each keep their own cursor and lean on `EventQueue.skip` after a hidden stretch. Anything that
  keeps *state* from events (like the renderer's crumple and repair) needs its own catch-up
  (`renderer.catchUp`). Reading state rather than events where it matters (as the results now do
  with `finished[]`) is the safer pattern; worth a sweep. *Small to medium.*
- **No DOM in the tests**, so the race UI, HUD and menu screens are only checked in the browser.
  A light DOM (happy-dom) for a few UI tests (results on finish, the lobby's seat table) would
  catch regressions there. *Medium.*
- **menu.ts is 637 lines** of screens as HTML strings with handlers wired after. Fine while it's
  one person's code; a tiny per-screen split (title, create, lobby, plate editor) would help
  once more people touch it. *Medium.*

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
- **`src/content.ts` (the bundle loader) and `src/core/content.ts` (types) share a name.**
  *Small.*

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
  ever runs per frame. *Small when needed.*
- **Measure again:** the frame rate hasn't been measured since the detailed cars went in, nor
  online with 8 cars, traffic hits and bumps on the wire. *Small.*

## Tooling

- **No linter.** tsc's `noUnusedLocals`/`noUnusedParameters` are the only lint. A minimal
  Biome or ESLint config (unused code, no floating promises, consistent imports) would catch the
  kind of thing reviews have caught by hand. *Small.*
- **Tests that fail on the old code are checked by hand** (stash, run, restore). A note in the PR
  template, or a script that runs a test file against `main`'s source, would make it routine.
  *Small.*
- **Browser checks are manual** (two tabs through the Chrome extension, or puppeteer from
  asleepace.com's `node_modules`). A small script that opens two headless pages on the local
  relay, makes a lobby and starts a race would make online checks one command. *Medium.*

## Ideas, not debt

Not problems, but places where a little work would make the code easier to build on:

- **A net overlay** (pings, routes, entity ages, claims held, bumps sent and applied), already on
  HANDOFF's list: it would make every online item above easier to see working.
- **A recorded online race:** each screen's events and messages to JSONL (telemetry already
  writes local events), so a desync in a playtest can be replayed and compared screen by screen.
