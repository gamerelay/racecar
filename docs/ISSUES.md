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

## Camels and traffic faded in right in front of you (2026-10-15)

- **Looked like:** on Sahara's opening straight, the camels "always seem to phase in when you are
  nearby", half see-through as you pass (a screenshot at 0:03.6 of lap 1); traffic did it too.
- **Was:** two things. On the first lap, every car near the start grid was faded out for its first
  10 s and back in after, wherever it was, and the Caravan Road (30–120 m) is all inside that zone.
  Every lap, a lane's cars fade over 45 m past each section end, and nearly every end sits on an
  open straight, seen from the whole 250 m before it.
- **Fix:** the grid is kept clear by where each lane's cars start (`Traffic.gridSlots`), not by a
  fade, and camels only keep off the grid itself; section ends move where their fades are least
  seen (`hideSections`: only Downtown's two starts could). SPEC "Fades out of sight (2026-10-15)".
- **Guard:** `test/traffic.test.ts` ("the start grid on every map": no car seen near the grid in
  the clear time but a lane that can't start clear of it). How many fades a racer sees:
  `bun tools/fades.ts [map]`.
- **Still there:** fades at section ends on straights (Downtown 6 a lap with its buildings counted,
  Backroads 6), and wrecks coming back where they were (most of Heist's 1). Sahara's camels since
  walk a loop from the oasis and never fade (2026-10-16, SPEC "Traffic that leaves instead of
  fading"; guard: `test/sahara.test.ts`, "camels never fade"). Downtown's cars turning off by side
  streets was tried: no fade seen, but the field wrecked a third more (the owner's call).

## Steering on the keyboard had a slight delay before it took (2026-10-14)

- **Looked like:** "a slight initial delay" from a steer key to the car turning; noticed around
  Splash City (alpha-1.47), the same feel as the slow drift start below.
- **Was:** the keyboard's easing (the drift fix below skipped it only with drift held). From
  straight, the steer went on at 4.5/s (9/s for the first frame), so full lock took about 210 ms. The
  Brute at 140 km/h turned its first 3° in 10 ticks against a pad's 5 at full lock, and the chase
  camera (heading `damp(6)`, about 170 ms behind) turned 3° in 16 against 11. The car's own response
  was quick (yaw on target in 2 ticks), and so was the frame loop (controls read before the step).
  Not new: the easing is the first build's. A pad's stick has no easing.
- **Fix:** a steer key from straight starts at `KEY_ONSET` (0.3) and eases on at 7/s: full lock in
  about 100 ms (`src/input/input.ts`). The Brute at 140 km/h: 3° in 7 ticks, the camera 13. Letting
  go eases as before (7/s). Turning the other way eases to the middle as before (9/s), then steps out
  to 0.3 on the other side, as a press from straight does. 0.3 is under `cruiseSteer` (0.35), so a
  one-frame tap keeps the straight-line build climbing; a 50 ms tap is over it for 2 ticks (before,
  none) and leaves the build about 0.02 of its 1 lower (about 0.1 s of its 5 s climb).
- **Guard:** `test/input.test.ts`, "a steer key turns the car its first 3° within 3 ticks of a pad at
  full lock" (the real Input and Sim: 7 ticks against the pad's 5; eased from 0, 10).

## A drift was slow to start on the keyboard (2026-10-14)

- **Looked like:** the drift "slightly slower to react than normal", from the key to the car;
  noticed around Splash City's draw call pass (alpha-1.47), and more in the Brute.
- **Was:** a drift starts once the steer is past `driftMinSteer` (0.6), and keyboard steering eases
  in: 9/s for its first frame from straight, then 4.5/s, so 0.6 takes about 133 ms. Pressing drift
  then a steer key, the drift came 7–9 ticks after the steer key in both of the owner's reports
  (with the steer already held, 0–3). Not new: the easing is the first build's, and nothing in
  input or the drift changed since alpha-1.44. A pad's stick has no easing, so it never waited.
- **Fix:** with drift held (a key or the pad's), a steer key goes straight past the threshold while
  the car could start a drift (`readyToDrift` in `src/input/input.ts`, set from `canStartDrift` in
  `physics.ts`: on the ground, out of a spin-out, not drifting, off the cooldown, fast enough): the
  drift starts on the next tick. Mid-drift counter-steering, steering in the air or a spin-out, and
  steering without drift held, ease as before. (Since the keyboard's `KEY_ONSET`, above: they start
  at 0.3, and not ready to drift, the steer reaches the threshold in 3 ticks, not 7–9.)
- **Guard:** `test/input.test.ts`, "drift held, then a steer key: the drift starts on the next tick"
  (the real Input and Sim: 0 ticks; with it off, the old wait), and "in the air or spinning out, a
  car isn't ready to drift".

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
