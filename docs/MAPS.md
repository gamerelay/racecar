# Map design

How Racecar's maps are made and what makes a good one, from building Downtown and Backroads. Read
this before starting a map; the reasons behind each rule are in [SPEC.md](./SPEC.md) under "Changed
while building".

Maps live in `content/maps/<map>/`: a `map.json` (name, palette, weather, its layouts) and a
`<layout>.track.json` per lap, made by a generator in `tools/`. Keys are `map/layout`, like
`backroads/valley`.

## What makes a lap fun

The best moments come from systems meeting: a drift chain through an S that ends at a jump, a
near miss on the oncoming lane under the Trestle's legs, a rival shoved into a pillar. A lap is
a sequence of those chances, with a rhythm.

- **Rhythm:** sweepers to drift through, a straight to breathe on (and to boost and fight on), a
  jump, a shortcut, then back into the corners. Aim for a corner every 100–150 m and no straight
  longer than ~350 m (the Valley v2's 454 m straight dragged).
- **Corners you can drift:** most corners are sweepers (35–110 m radius) and S-bends, which hold
  a drift and link into chains. Keep hairpins and kinks rare, as punctuation.
- **Width:** wide roads (14–20 m) for fights and overtakes, wider still through the sweepers
  (+1.5 m on the Valley). Narrow only where the point is commitment (the Alley, the Creek Bed).
- **Height:** crests, drops and kickers change how a straight feels. Air time pays boost now,
  so every map wants a few honest jumps: take-off on a crest, and a flat, straight landing.
- **Shortcuts:** each one a gamble. It's faster if you hit it right (a jump, loose ground, a tight
  gap) and it costs you if you don't. Two or three a lap.
- **Something to dodge:** traffic on the straights (never through a fast bend: Paradise's
  Freeway wrecked the field five times a race until its bend was left clear), solid props (pillars, trestle legs) that
  split the road into lanes, and a hazard or two at readable spots.
- **One signature moment per section:** the Skyway's crossing, the Trestle over the start road,
  Logger's Leap. Players name sections after these.
- **Landmarks:** a small, distinct thing per section (a barn, a clock tower, a shipwreck), so
  every stretch is recognisable at speed.

## Laying out a lap

Write a generator (`tools/gen-<map>.ts`), not hand points. Rerunning it is how a lap changes;
editor edits are for trying things and get overwritten.

- **Nodes filleted into arcs:** list the corners as nodes with a radius; the generator fillets
  each into an arc between straights. Spline points come from the arcs, so corners have a
  constant radius and don't wobble.
- **Width by corner type:** drift corners (sweepers) get `DRIFT_WIDTH` extra; hairpins and kinks
  don't.
- **Banking into the turn:** a corner banks toward its inside (a left turn lowers the left
  side, a negative bank). About 0.06 rad for hairpins and 0.1 for sweepers, and 0 where a flick
  shouldn't bank. Bank rolls over at under 0.5° per metre, so an S rolls from one side to the
  other rather than flipping.
- **Smooth by distance, not by sample:** bank, width and height are Gaussian-smoothed over
  metres of road, with values between samples interpolated. Sample-count smoothing does nothing
  where samples are sparse.
- **Crests anchored to samples:** a crest's height sits on the nearest sample, so a kicker is
  where you put it.

## Height and land

- **Terrain follows the banked road:** the land under and beside a road is the road's banked
  surface, so no terrain pokes through a banked corner.
- **Grass banks, not drops:** a road above the land meets it on a 1:2.5 grass bank; one below
  cuts a bank. Sheer edges read as walls.
- **Bridges come from height:** a road high over the ground for long enough is a deck.
  - In the country, a short low one is a covered bridge; a long or high one is a timber trestle.
  - In the city, decks stand on pillars, a short hump is a solid stone embankment, sunken roads
    are trenches, and deep ones are tunnels.
- **Laps may cross themselves.** Every whole-track search takes height into account. Where a
  road passes more than 6 m over another:
  - In the city, the flyover spans it, and pillars stay off the road below.
  - With `trestles: true`, the baker stands the bridge on bents every 7 m, and the legs on the
    lower road are solid props (`supports()` in `bake.ts`). The renderer draws its bents on the
    same grid, so what you see is what you hit.

- **Islands:** `terrain.island` is the coastline, `sea` its level and `volcano` a cone. Past
  the coast the land drops under the sea; inland it never goes below it. A road out over the
  water is a deck, so an elevated road over a bay is just a road over the sea (Paradise's
  Freeway), with its ramps on embankments.

## Shortcuts

- **Slip roads:** the baker adds a slip point so a branch leaves along the main road instead of
  at an angle (`SLIP`, 24 m).
- **Flush joins:** `joinBranch` matches the branch's height and bank to the main road's where
  they overlap, fading to its own over `JOIN_FADE` (20 m). The verge and wall open on the side
  where the branch leaves.
- **Forks under 35°:** the validator warns about a sharper fork (`MAX_FORK`). Put the first point
  further along and closer in.
- **Checkpoints:** they sit outside every shortcut's span, so no branch can skip one. None listed
  means one every 1/8 lap, stepped past the shortcuts.
- **The AI takes them** by skill (`SKILL.shortcut`). Check with the lap report that a hard lap
  takes every one clean.

## Traffic, hazards and props

- **Traffic lives in lane sections** (`traffic.lanes[].sections`), and each section starts and
  ends on a straight. Traffic fades in and out at a section's ends, and a section in a corner is
  a car appearing in front of you mid-drift. `tools/fix-traffic.ts` moves ends onto straights,
  and the validator warns.
- **Two-way roads** give the oncoming bonus only where the oncoming lane has traffic.
- **Hazards at readable spots,** placed by measuring. For the Valley's falling sign, a sweep of
  positions with the field report found one with 0.4 hazard wrecks a race against 8–40 at the
  others (SPEC, "Valley v3"). Re-sweep when the road near a hazard changes.
- **Solid props** (pillars, trestle legs) split a road into lanes. The AI's racing line threads
  the gaps and its avoidance steers round them. Leave at least one gap a car wide plus 2 m.
- **Watch what's near what:** a hazard just past a colonnade pinned AI cars between the two.
- **A shortcut's mouth is a speed step:** the AIs that take a shortcut slow to its speed before
  they reach it. If its first stretch is slow (a kink, a zigzag), they brake in the fast line and
  the pack runs into them. Paradise's old Sandbar did that (1.6 wrecks a race, nearly all at its
  mouth on lap 1). Fork where the main road runs straight, and check the branch's speed profile.
- **Measure over enough seeds:** 8 field races swing by ±0.3 wrecks a race. Confirm a
  placement on 16.

## Scenery and landmarks

- **Built from the track,** never authored per race: buildings, forest, poles and chevrons are
  placed along the splines with a seeded RNG, so a map is the same every race.
- **Instanced:** one draw per kind of thing. Budget about 400 draw calls at worst (Downtown peaks
  near 415 with detailed traffic around).
- **Clear of the road:** scenery keeps off every road's footprint and verge (`roadGap`) and off
  the water.
- **Landmarks:** one per section, distinct in silhouette. A few move (a windmill, a whale), and
  small props you can smash make the verge part of the game.

## Measuring

Nothing ships on feel alone. The checks CI runs, plus the lap report:

- `bun tools/validate.ts --ai`: the layout is valid (forks, sections, checkpoints, hazards), and
  the hard AI finishes a lap.
- `bun tools/lap-report.ts <map>`: the lap floor (hard AI, empty track, every shortcut) and
  section times.
- `--field --seed N`: an 8-car race with traffic and hazards. Run several seeds and look at
  wrecks, where they happen, and resets.
- `--cars`: every class's lap floor. The classes stay within ±5% of the mean (the rally car
  within 7% on dirt).

Good numbers today:

| | Target | Downtown | Backroads | Paradise |
|---|---|---|---|---|
| Lap length | 2.9–3.8 km | 3.26 km | 2.92 km | 3.44 km |
| Hard-AI lap floor | 70–100 s (SPEC) | 58.6 s | 63.4 s | 66.8 s |
| AI wrecks per 8-car race | ≤ 1.5 | ~1.6 | ~1 (2 on seeds 1–8) | ~1.2 with its hazards (0.5 without) |
| AI resets | ~0 | rare | ≤ 1 in 6 races | none in 8 |

Tests hold what matters for each map: land below every road, bridges detected, a hard lap that
flies the jumps and takes the shortcuts clean, corners banked the right way, and shortcuts that
meet the road flush (`test/track.test.ts`, `test/countryside.test.ts`, `test/paradise.test.ts`).

## A new map, step by step

1. Sketch the lap: sections, each with its signature moment, a landmark and a mood.
2. Write `tools/gen-<map>.ts` on `tools/lib/lap.ts` (the Valley's and Paradise's generators
   are examples): nodes with radii, surfaces, widths, crests, branches, traffic sections and
   hazards.
3. Add `content/maps/<map>/map.json` with a palette and weather. A new look means a scenery
   module in `src/render/skins/greybox/`.
4. Generate, then run `validate --ai` and `lap-report` until the lap floor and field wrecks are
   in range.
5. Drive it with a controller: drift every sweeper, take every shortcut, fly every jump. Press
   F8 on anything that feels wrong.
6. Sweep hazard positions and check traffic sections.
7. Add the map's tests, and a section to this file if it taught us something new.
