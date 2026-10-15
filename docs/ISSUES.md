# Issues noticed while driving

Things the owner noticed in play (a bounce, a shake, a car that felt wrong), each with what it
looked like, what it actually was, the fix and the test that guards it. Two issues can look alike
and have different causes: before calling one "back", check its entry's guard test still passes and
compare the cause.

Newest first. Bugs found by reading code go in HANDOFF's follow-ups; clean-ups in TECH_DEBT.

## How to look into one

1. **Get a report.** F8 in the game ("Felt wrong?") saves the last 30 s: inputs, the state and
   events, and the frame times (`perf` records). The released build downloads it
   (`~/Downloads/racecar-report-*.json`); the dev server saves it to `telemetry/reports/`.
2. **Replay it:** `bun tools/replay.ts <report.json>` re-runs it headless and says whether it ended
   where the game did (`exact` means the sim is the game's). `--trace` prints the car every 10 ticks.
3. **Rule things out:**
   - Frames: the report's `perf` records (fps, p50/p95/p99 frame ms). Steady 120 fps means the
     problem is motion, not stutter.
   - Hops: `takeoff`/`land` events, and `grounded` in the trace.
   - A regression or not: every map's fingerprints `identical` since a tag means the AI drives the
     same; `git diff <tag>..main` on `src/render/camera.ts`, `renderer.ts` (`updateCamera`, `frame`)
     and `src/core/car/physics.ts` says whether the camera or the car changed.
4. **Measure what the eye sees.** The sim's numbers are the car's; the screen is the camera's. Run
   the renderer's chase camera math over the replay at 120 fps (position from `chaseOffset`,
   `follow`, `slopeRise`, the guards; the aim from `look`) and measure the view's angle, not only the
   car's height.

## A drift was slow to start on the keyboard (2026-10-14)

- **Looked like:** the drift "slightly slower to react than normal", from the key to the car;
  noticed around Splash City's draw call pass (alpha-1.47), and more in the Brute.
- **Was:** a drift starts once the steer is past `driftMinSteer` (0.6), and keyboard steering eases
  in: 9/s for its first frame from straight, then 4.5/s, so 0.6 takes about 133 ms. Pressing drift
  then a steer key, the drift came 7–9 ticks after the steer key in both of the owner's reports
  (with the steer already held, 0–3). Not new: the easing is the first build's, and nothing in
  input or the drift changed since alpha-1.44. A pad's stick has no easing, so it never waited.
- **Fix:** with drift held, a steer key goes straight past the threshold while the car could start
  a drift (`readyToDrift` in `src/input/input.ts`, set from `canStartDrift` in `physics.ts`): the
  drift starts on the next tick. Mid-drift counter-steering, and steering without drift held, ease
  as before.
- **Guard:** `test/input.test.ts`, "drift held, then a steer key: the drift starts on the next tick"
  (the real Input and Sim: 0 ticks; with it off, the old wait).

## The view nodded with the road (2026-10-14, PR #176)

- **Looked like:** on Riviera, a bob or chop while driving, "more visible with the Brute", worst
  past the Rock Tunnel and when drifting or on the Stairs. Taken at first for the tunnel hop below
  coming back.
- **Was:** the chase camera's height eased toward the car (`damp(5)`), but the point it looked at
  was the car's height plus an offset, unsmoothed. Every rise and dip in the road tipped the view:
  0.15–0.20° RMS over a lap, 0.5° past the tunnel (1805–1850 m: flat, then up 11%, the bank
  swinging from −7° to +5°). The Brute, the fastest car, crosses them quickest. Not a regression:
  the same since before alpha-1.36, and not the tunnel hop (its test passes; the car never left the
  ground in either report).
- **Fix:** the camera's height and its aim follow the car at one rate (`followCar` and
  `FOLLOW_RATE` in `src/render/camera.ts`), so the view holds its angle and the car moves on the
  screen instead. Over the owner's two reports: 0.15 → 0.02° and 0.20 → 0.04°. The aim trails no
  more than `AIM_TRAIL` (1.5 m): eased with no limit, off a long drop it lost the car off the bottom
  of the screen.
- **Guard:** `test/render.test.ts`, "the view doesn't nod with the road" (through `followCar`, as the
  renderer runs it, on a road like the one past the tunnel at the Brute's top speed: the aim on the
  car tips the view over 0.5°, eased under 0.05°), and "off a long drop the aim trails no more than
  AIM_TRAIL".

## The car hopped at the Rock Tunnel's mouths (2026-10-07, PR #150)

- **Looked like:** on Riviera, the car (and so the camera) bounced a little just before the
  tunnel.
- **Was:** on open ground a car's height is the mean of its four wheels' ground (`wheelGround` in
  `src/core/car/physics.ts`). Half into the tunnel, a wheel still outside it read the tunnel floor's
  height at the car's middle, about 12 cm too high up the 9% grade: the car rose 7 cm in one tick
  and flew about 15 m. Every class, at both mouths.
- **Fix:** a wheel off the piece reads its own ground, unless that's more than a hard landing from
  the deck (a car hanging off a bridge's edge still reads the deck).
- **Guard:** `test/coastal.test.ts`, "through the Rock Tunnel on the AI, no class leaves the ground
  at its mouths".
