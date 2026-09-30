# Changelog

What changed in each release of racecar, newest first. Releases are git tags on `main`; the
reasons behind each change are in [docs/SPEC.md](./docs/SPEC.md) under "Changed while building",
and where things stand is [docs/HANDOFF.md](./docs/HANDOFF.md).

## Unreleased

Phase 1 of [docs/PLAN.md](./docs/PLAN.md), the quick wins.

### Changed
- **Map names:** City is now **Downtown** and Countryside is **Backroads**, in the menu and in
  links (`?map=downtown`, `?map=backroads`, or a full `map/layout` key). Old links, saved choices
  and F8 reports still load.
- **Paint names are one word:** Pink, Cyan, Sunburst, Lime, Violet, Ember, Chrome, Midnight and
  Snow (`hot-pink` is `pink`).
- **HUD:** the race position is now the big badge bottom left, and the lap sits top left (gold
  on the final lap).
- **One style for every control:** buttons, selects and text fields in the menu, the pause
  menu, the results, the F8 form and the in-race menu button share the menu's look. Selects
  draw their own arrow, fields light up cyan when focused, and buttons press in.
- The game is called **Racecar** on the title and the tab.

### Added
- **docs/MAPS.md:** how maps are made and what makes a good lap (rhythm, drift corners, width,
  banking, height, shortcuts, traffic, hazards, scenery, measuring, and a new-map checklist).
- **docs/PLAN.md:** the plan for lobbies, plates, the car select screen, Paradise and landmarks.

## alpha-1.7: police car, Trestle legs, air and position boost

PR #13.

### Added
- **The police car is playable:** the Interceptor, the eighth car class. It's fast and heavy
  (66 m/s, 1750 kg with the push bar), for chases and takedowns, and has its own engine sound.
  AI fields now have one of each car.
- **Air-time boost you can see:** a clean landing after at least 0.45 s in the air pays boost
  (0.15 of a bar per second of air) and points, with an "Air 0.8s +12%" pop and a chime. Wreck on
  the way down and it's lost.
- **Boost by position:** boost from drifts and chains, air, near misses, oncoming and traffic
  checks is scaled from ×0.9 for the leader to ×1.35 for last place, so whoever is behind can catch
  up. The start boost, takedowns and the respawn boost aren't scaled.
- **Solid Trestle legs:** the Valley's timber Trestle crosses the home stretch, and its legs on
  the road are now solid. Clip one and you crash. Three rows split the road into two lanes.
  Layouts opt in with `trestles: true`.

### Changed
- The AI's racing line threads the gaps between solid props, easing in over 40 m.
- AI avoidance checks where the car will be when it reaches a threat, not only its target line:
  it used to cut across a slower car's lane into its tail.
- A pinned AI tries the other side of the road after backing out, and can back out again sooner.
- Air boost used to trickle in while airborne with no feedback; it pays on landing now.

### Fixed
- The contact shadow fades out when a car flips, rolls onto its side or leaves the ground. It
  hung off a flipped car like a black box in the air.

## alpha-1.6: drift chains, skid marks, new cars

PR #12.

- **Drift chains:** drifts that start within 1.6 s of the last one link up, bank more boost each
  (up to ×2), and pay a pop when the chain runs out. A spin-out or a wall knock loses the chain.
  A chain bar sits in the HUD.
- **Skid marks:** rubber on the road under sliding, drifting and braking wheels, dark on asphalt
  and churned on dirt and grass, fading out with age and into the fog.
- **New car designs:** the compact, truck and police car, plus the car polish pass (clean ink,
  one detail language, reflective glass). Traffic uses the compact and truck designs.
- **Second review pass:** walls open on the right side at a shortcut's mouth on a curve, replays
  match the live run, audio suspends in a hidden tab, one content loader for tools and tests, and
  more.

## alpha-1.5: Valley v3

PR #10.

- **Valley v3:** re-laid for drifting, with more sweepers, a wider road, corners banked into the
  turn, and grass banks at the edges instead of drops.
- **Smooth shortcut joins:** shortcuts meet the main road flush on every map, with no kerb or
  step across the mouth.
- **HUD:** the key hints moved to the pause menu, and the lap badge is bigger, bottom left.

## alpha-1.4: audio and a review pass

PR #9.

- **Audio:** synthesized engines with gears, tyres, wind, impacts, cues and a music loop.
  M mutes, N toggles music.
- **Review pass:** lap times in world time, photo finishes, AI that gets unstuck, render and UI
  fixes, menus by controller and keyboard. 88 tests.

## alpha-1.3: traffic fades

PR #7.

- Traffic fades in and out at lane sections and after a wreck instead of popping, with
  regression tests.

## alpha-1.2: seven cars

PR #6.

- The sedan, rally car and bus join as racers, all balanced by the lap report.
- Traffic is drawn from the racer designs.
- Also: an mph dial, a menu button, a dry tunnel, more drift boost, and catch-up boost on respawn.

## alpha-1.1: Countryside v2

PR #4.

- The Valley on real terrain: a tighter, higher, mostly-dirt lap with forest, a village, a covered
  bridge and the Trestle, jumps and three shortcuts.

## alpha-1.0: milestone 2, the world

PR #2.

- **World systems:** traffic, weather, hazards (the log truck and the falling sign), a racing AI,
  race phases, and the AI lap report.
- **Races:** single-player races with a setup menu, countdown and results, and a minimap.
- **City v2:** a 3.3 km lap with the Skyway, the Market, the Alley and the Underpass.
- **Visuals:** a cel look with ink outlines, wet reflections, detailed cars with visible wrecks,
  and the garage viewer.
- **Driving:** a drift that banks boost and pays it out on a clean release.

## Milestone 1: greybox sandbox

PR #1.

- A deterministic 60 Hz core sim with track baking, an arcade car with drift and boost, air and
  wrecks, collisions and laps.
- The greybox renderer, HUD, input, editor, tuning panel, telemetry and F8 reports, and CI.
