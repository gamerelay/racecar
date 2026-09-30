# Handoff

Where racecar stands and what's next. The design is [docs/SPEC.md](./docs/SPEC.md) (decisions in
§17, what building changed in "Changed while building"); this file is just "where are we".

**Last updated:** 2026-09-30 (milestone 2 in PR #2 with PR #3 merged into it, CI green, not merged).

## Where things stand

- **Repo:** `gamerelay/racecar` (private until milestone 3), cloned at `~/dev/racecar`.
- **Milestone 1 (greybox sandbox): merged** (PR #1). Core sim in `src/core` (pure TS, no
  Three.js/DOM/network, enforced by a test), greybox renderer, keyboard + gamepad, editor, local
  telemetry, F8 replayable reports.
- **Milestone 2 (the world): PR #2, open, CI green.** Branch `m2-world`.
  - Traffic (closed-form, per-lane `sections`, LOD), weather (seeded plan), hazards (log truck,
    falling sign; kinds in `core/world/hazards.ts`, instances in layout JSON).
  - Racing AI (`core/ai/racer.ts`): racing line + speed profile, Stanley-style path tracking,
    time-to-contact avoidance over 7 candidate lines, 0.8 s lane commitment (`aiLat`/`aiHold`
    in the car pool), shortcut choice, boost, catch-up. No AI drifting yet.
  - Race phases in the sim (`startRace`, countdown, start boost/stall, finish order), setup
    screen over an attract-mode AI race (`src/ui/setup.ts`, setup lives in the URL), results,
    minimap, rain/traffic/hazard visuals, Countryside blocked in (golden palette, trees).
  - PostHog sink wired, off until `VITE_POSTHOG_KEY` is set (no racecar PostHog project yet).
  - 26 tests incl. exact replay of a full race and zero allocation over the full world.
- **Numbers to know:** City is 3.26 km (v2: the Skyway, Market, Underpass), AI lap floor 58 s;
  Countryside 3.79 km, 63 s. 8-AI race wrecks (8 seeds): City ~0.5, Countryside ~5, since traffic
  sections now start and end on straights. City draws ~90–250 calls and holds 120 fps on the dev
  Mac. Since then: detailed cars and traffic (PR #3 merged in), wet reflections, the Skyway
  railing, the Alley dressed, tunnel portals.
  Tick 0.025 ms with 8 AI + traffic + chaos + rain. Greybox draws ~40–140 calls.
- **Not yet done by a human:** nobody has played milestone 1 or 2 for feel. Drift/boost/takedown
  numbers are first guesses (F4 tuning panel, F8 reports).

## GameRelay side (the platform asks, SPEC §11)

- **asleepace/gamerelay.io PR #30** (`room-host-controls`): `room.kick`, `room.setAccess({ locked,
  public, maxPlayers })`, `room.setListing({ name, meta })`, `room.transferHost`,
  `relay.listRooms(tag, { includeFull })` (listings gain name, meta, locked, hostName),
  `relay.online()`. New error code `locked`. Built by a background agent; 904 tests pass.
- A fresh review found nothing blocking but six fixes, which the builder agent is applying on the
  same branch (as of this handoff; check the PR for whether they landed):
  1. a refused join (locked/banned/full) drops you from your current room first → `Room.canEnter`
     before `leaveRoom`;
  2. party moves into a locked/banned room strand followers;
  3. kicking a disconnected player doesn't stick on reconnect (ban:false → new seat; ban → closes
     as 'lost', message lost);
  4. docs: bans are per player id (anonymous players dodge them in a private window); lock is the
     reliable tool; 5. docs: escape `meta`/`name`; 6. log host kicks with `by`.
- Not merged, deployed, or released. Racecar's lobby needs the server deployed and an SDK release
  (docs/PUBLISH.md in gamerelay.io).

## Next, in order

1. **Playtest milestone 2** (`bun run dev`, http://localhost:5178), tune with F4, F8 anything odd;
   then merge PR #2.
2. **Finish PR #30**: confirm the review fixes landed and tests pass, merge, deploy (deploy only
   when asked; see gamerelay memory/HANDOFF), release an SDK alpha with the host controls.
3. **Milestone 3 (online)**: lobby list (`listRooms('race', { includeFull: true })`), host a party,
   party screen with Civilization-style seats, `net/` (car entities at 30 Hz with steer/throttle,
   prediction in-game, bump dedupe ±150 ms, victim decides wrecks, traffic hits and triggers via
   `room.claim`, shared moments scheduled ~250 ms ahead on the server clock), vote → next race,
   net overlay, bots. Repo goes public. Then 3b: the neon dusk City skin (the launch).

## Working notes

- Testing in Chrome: the MCP tab is "hidden", so requestAnimationFrame doesn't run. Drive it with
  `window.__rc.advance(seconds, controls)` (steps the sim, renders a frame); `__rc.sim.racers[0] =
  { difficulty: 2 }` lets the AI drive your car (to reach the results screen).
- Restart the dev server after changing `vite.config.ts` (the `__BUILD_TIME__` define).
- Diagnose AI with `bun tools/lap-report.ts [--field]` and `debugAi(true)` in `core/ai/racer.ts`
  (records each AI's last decision).
- Content generators: `tools/gen-city.ts`, `tools/gen-countryside.ts` overwrite the layouts; after
  hand edits in the editor, don't rerun them.
