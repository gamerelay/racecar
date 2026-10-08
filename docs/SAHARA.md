# Sahara: a loose plan for a desert map made to drift

The owner's brief (2026-10-07): "a new desert themed map called Sahara using the Caldera engine
... very good for drifting, have lots of jumps and berms, sand dunes, possibly a river, maybe
pyramids as a set piece or something you can drive up, lots of twists and turns, highly
technical and a touch of verticality." Fingerprints held off for now (the owner's word).

It's a **direction, not a spec**: what building changes goes in "Built so far", as on the other
maps. Read [MAPS.md](./MAPS.md) first, then [CALDERA.md](./CALDERA.md) for the engine.

## The idea in one paragraph

One lap of open ground (Avalanche's heightfield, as Paradise and Riviera are), all of it sand to
drive on, laid as a serpentine across a desert basin ringed by high dunes: three passes east and
west joined by bermed hairpins, so there's always a corner coming (one every 100 m or so). Packed-
sand roads drift loose; the asphalt stretches (the Caravan Road, Giza) are where you catch the
car. Dune crests throw you on every leg of the Dune Sea, kickers sit on the straights, and the
lap climbs from the oasis (3 m) onto the Giza plateau (16 m) and the Mesa (25 m), and drops off
the Mesa's edge onto the run home. The set piece is the Great Pyramid: the Pyramid Run, a shortcut
straight up its north face, over its top and off its south face, while the road goes round it.

## The lap (step 1, as built)

4.04 km, run clockwise, in order (distances along the main road):

| Section | From | What | Signature |
|---|---|---|---|
| **The Caravan Road** | 0 m | asphalt north along the oasis, a long right, a left and a right | the start; later, the river beside it |
| **The Dune Sea** | ~370 m | packed sand, an S-chain of five legs east | a dune crest to fly off on every leg |
| **The Berm** | ~1110 m | a hairpin, banked hard (0.26 rad) | the first berm |
| **The Oasis Bends** | ~1340 m | sweepers west, a kicker | a drift chain |
| **The second hairpin** | ~1800 m | banked hard, round to head east | |
| **The plateau** | ~2000 m | asphalt S-bends up to 16 m, a kicker | climbing toward the pyramids |
| **Giza** | ~2420 m | a right onto the road south, an S out round the Great Pyramid | **the Pyramid Run** |
| **The Wadi** | ~2850 m | narrower (12 m) packed sand, four flicks west, two crests | quick and committing |
| **The Mesa** | ~3390 m | two bermed switchbacks up to 25 m, across its top | |
| **The Mesa Drop** | ~3870 m | a kicker off the Mesa's north edge, 17 m down its face | the last jump, 150 m from the line |

- **The Pyramid Run:** 253 m against the road's 358 m. The Great Pyramid is 76 m across and 14 m
  high, its faces 0.42 up (about 23°), on the run's line; the AI takes it and flies about 1.6 s
  off its top. Two smaller pyramids (the queens') stand inside the loop, off every road, to drive
  up for the fun of it.
- **Numbers:** hard-AI floor 79.25 s; field races on seeds 1–4 finished with no wrecks.
- **Surfaces:** asphalt; `packed-sand` (the dunes, the wadi, the mesa: grip 0.8, loose); `sand`
  off the roads (drag 0.3: wide costs time, it doesn't spin you); `sandstone` (new: the
  pyramids' faces, grip 0.9).

## What it uses from Caldera, and what's new

- **Open ground:** `GroundDef` with `swell` (rolls over everything, the road too) and `rough`
  (the dunes off the road); its walls past 260 m rise as the basin's high dunes.
- **A pyramid feature (new, `features/pyramid.ts`):** a square stone pyramid in world space
  (`PyramidDef`: middle, foot and top half-widths, height, its foot's height, heading); its faces
  are ground (`KIND_STONE`, driven as `sandstone`), cut back to the main road as a hill is; a
  branch over it shapes its own way. The generator sets each foot from the ground there and keeps
  every pyramid 15 m off the road.
- **The desert's look (drawn only, `snow.ts`):** scenery `desert`: the sand in two tones in broad
  drifts, wind ripples by each pixel's position (faint on packed sand, none on asphalt), each
  pyramid's faces in courses of stone by height over its foot (the `desert()` material's
  uniforms), and the roads laid over the sand as Paradise's are (painted on its grid, the
  asphalt's edges were a saw). A palette, `sahara`: a hazy noon, violet-blue shade.

## Steps, one PR each

1. **The lap** (this one): the serpentine, the dunes, crests, kickers, berms, the Mesa Drop, the
   Great Pyramid and the Pyramid Run, two queens' pyramids, the palette and the ground's look.
   Experimental: open it from a link (`?mode=free&map=sahara/dunes`).
2. **The river and the diamonds** (built, below): the oasis river, crossed at a ford and on a
   bridge; small pyramids by the road to jump off. Palms and reeds along it come with step 3.
3. **Giza dressed** (built, below): the Sphinx, obelisks, palms along the river; the pyramids'
   capstones, market stalls of smashables either side of the Sphinx avenue. Still to come: reeds.
4. **More of what drifts:** tune the berms by driving them (bank, width, the outside's lip),
   and maybe a slot canyon in the Wadi (rock walls close either side, `GroundDef.face`).
5. **Life:** a camel caravan and dust devils, a sandstorm weather and a sunset (built, below).
6. **Fingerprints, tests and the lobby** (done for alpha-1.38): its fingerprints recorded, in the
   lobby (the owner: "this map is good enough to merge, deploy and tag"). Still to add: tests
   that a hard lap flies the crests and the drop clean, and the berms bank the right way.

## Questions for the owner

- **Surfaces:** more of the lap on packed sand (looser, more drift) or more asphalt to catch it?

## The owner's answers (2026-10-07)

- **Length:** "the length feels good": 4.04 km stays.
- **The river:** "maybe 2 different river crossings so we can use both": a ford and a bridge.
- **The pyramids:** drivable, but "you probably won't drive them unless you can approach at an
  angle and use a side as a jump": the diamonds, by the road.

## Built so far

### Step 1, the lap (2026-10-07, experimental)

As in "The lap" above. The AI's costs are driven (the default): the Pyramid Run is quicker for the
hard AI, which takes it. Fingerprints not recorded yet (the owner: hold off), so the golden test
skips a layout with none.

### Step 2, the river and the diamonds (2026-10-07, experimental)

- **The oasis river** (a new ground feature, `RiverDef`, `features/river.ts`): it rises south of
  the Wadi, runs north under the Wadi's bridge, through the basin and west across the Caravan
  Road at the ford, out into the low ground. A channel 12 m wide along a path in world space (its
  corners cut, Chaikin's, square to each road it crosses), its water 1.1 m deep at a level falling
  from 6.5 m to 2.5 m along it, its banks at least a levee over the water, green (the oasis's:
  `KIND_OASIS`, driven as `undergrowth`) 10 m past them. In it is the new `river` surface (grip
  0.55, drag 0.9): slow wading, never a wreck. Unlike a lava stream it may cross a road, and the
  road says how:
  - **The ford** (Caravan Road, ~320 m): the road dips 0.35 m under the water (its points every
    3 m there, so the water's edge is where it's drawn), a `ford` zone (new surface: grip 0.72,
    drag 0.45). The car splashes down into it and hops out the far side.
  - **The bridge** (the Wadi, ~3240 m): a deck piece 44 m long over the gorge (`under`: the ground
    down to the river's floor), on the Wadi's crest, so it's a hump you fly off.
  - Drawn: the water level across, deep in the middle and pale at its edges, opaque (the post pass
    reads a cleared alpha as a mirror); a white spray off a ford or the river; a desert's steep
    banks warm rock, not the mountains' grey.
- **The diamonds** (`DIAMONDS` in the generator): four small pyramids (26 m across, faces 0.55 up)
  on the outsides of corners at 150, 1500, 2150 and 3640 m, turned 45° to the road, a corner 2 m
  off its shoulder. Run wide at 12–28° and you're up a face and off its ridge: 0.7–1.1 s of air,
  no wreck.
- **Numbers:** floor 78.85 s; field races on seeds 1–8 with no wrecks. Full suite 721 pass.

### Step 3, Giza dressed (2026-10-07, experimental)

The owner: "let's dress up Giza with the Sphinx and palms".
- **The Sphinx** (landmark `sphinx`, its solid block a house, look `landmark`): a lion lying on a
  stone plinth on the plateau north of the road up to Giza, paws out, a man's head in a striped
  nemes headdress, worn and noseless, facing the road from about 48 m. About 34 m long, 12 m high.
  The queens' pyramid that stood there moved west, to (225, 112).
- **Obelisks** (landmark `obelisk`, solid): two pairs either side of the road, 55 m before and
  after the Sphinx, 7 m past the shoulder: tapering granite on plinths, gilded tips.
- **Palms along the river:** 292, planted (`PinesDef.plant`, `kind: 'tropic'` with no trees of
  its own), both banks, in groves, none within 6 m of any road's shoulder, on the water, a
  pyramid or by a house. Solid, as Paradise's are. (openIsland.ts: with no coast to lean out to,
  a palm leans any way.)
- **Numbers:** floor 78.85 s; field races on seeds 1–8 with no wrecks. Full suite 722 pass.

### In the lobby (2026-10-07, alpha-1.38)

The owner: "this map is good enough to merge, deploy and tag". Out of experimental, its
fingerprints recorded (every other map's unchanged). It has no music of its own yet: a race on it
plays the eight tracks for any map (test/audio.test.ts takes a map with none).

### Step 3, the rest: the avenue (2026-10-07)

- **The market** (two new smashables): stalls under red-and-cream awnings (`market-stall`, as a
  fruit stand: 200 points) every 14 m either side of the Sphinx avenue past the shoulder, and clay
  pots (`clay-pots`) on the shoulder between them.
- **No colonnade:** seven columns stood down the avenue's middle for a drive. The owner: "this
  section looks a little crowded, maybe we remove the columns from the middle of the road".
- **Capstones:** each pyramid's top 1.8 m gilded (the desert shader). It now draws all seven
  pyramids in courses (it took four; three diamonds were plain sand).
- **The Pyramid Run's walls, gone** (the owner: "there is an invisible wall on this pyramid
  jump"): a branch is walled unless the layout opens it, and the run never was, so a rail stood
  invisible 8 m either side of its middle over 173 m of it, across both of the Great Pyramid's
  faces. Open now, as the main road is (a test holds every road on Sahara open).
- **Numbers:** floor 78.85 s; field races on seeds 1–8 with no wrecks. Sahara's fingerprint
  re-recorded (every other map's unchanged); full suite 725 pass.

### Step 5, life: the caravan and the dust devils (2026-10-07)

The owner: "let's do the camel caravan and dust devils next".
- **The caravan** (traffic, a new kind `camel`, `animal`): strings of five camels, 3.6 m nose to
  nose, walking toward you at 2.2 m/s down the left edge of the Caravan Road's opening straight
  (30–120 m; one string on it at a time, about). Two new lane options do it, `kinds` (only
  camels) and `string` (`[count, gap]`); with neither, a lane draws as before (every other map's
  traffic identical). Hit a camel and it scatters (a cloud of sand, a soft thump), back as a
  wrecked car comes back; you keep 80% of your speed. Never a wreck, nothing tumbles.
  - Tried and dropped: a caravan each way the whole road to the ford. Bunched on the first lap, the
    field crashed into itself behind them (a dozen wrecks in eight races).
- **Dust devils** (hazard `dust-devil`): a whirlwind rises beside the road (2.5 s, a marker, the
  funnel growing), wanders across it at a slant over 10 s and dies on the far side. Inside one
  you're shoved round with its wind and out from its middle (up to 16 m/s² at its middle) and
  turned a little; never a wreck. About every 18 s somewhere on the Dune Sea (400–1080 m), every
  30 s on the Mesa's top (3480–3840 m). Off at mayhem 'off'. Drawn as a dark funnel of sand
  (three turning cones and a skirt).
- **Numbers:** floor 78.77 s. Field races wreck a little more than before: 8 wrecks in 12 races
  (seeds 1–12), every one car on car, about as Paradise, Riviera and Downtown do (0.5 a race).
  Most come at 358–368 m, the left onto the Dune Sea, two slower cars side by side into it. One at
  2124 m (the plateau's corner by a diamond) was there before any of this (1 race in 12): one for
  the berms (step 4). Sahara's fingerprint re-recorded, every other map's unchanged; full suite
  728 pass.

### Step 5, the skies: a sandstorm and a sunset; devils that throw you; splashes (2026-10-07)

The owner: "could we next add a sandstorm and a sunset, also I think the dust devils need to throw
/ spin you a little more, maybe make them had a little more effects, also when splashing in water
it would be cool to have some subtle effects too".
- **The sandstorm** (map.json's weather lists `sand`; the lobby's Weather: Random, Clear,
  Sandstorm): on Random about one race in three, it blows in somewhere in the first two laps over
  15 s, lasts 35–60 s and blows over in 20 s (as a shower does on Paradise). Nothing gets wet; grip
  drops 6%; the fog closes to about 350 m, ochre, and the sky goes the same dust. Sand streaks past
  on a gusting east-north-east wind, thickest low, with clouds of dust rolling through, and a gale
  howls under the engine (`sim.fall`: rain, snow or sand; the skin's `update` takes it).
- **The sunset** (`sahara-sunset`, the lobby's Time): a low sun into the dunes, the sky burnt
  orange into violet, copper light and purple shade.
- **Dust devils throw you now:** a harder shove (26 m/s² at the middle, was 16), twice the turn
  and more (`DEVIL_SPIN`), and near the eye a lift off the ground (`DEVIL_LIFT`, up to 5 m/s): a
  hop out the side, still never a wreck. Drawn with grains of sand spiralling up each funnel and
  flung off the top; caught in one, sand churns round the car, the camera shakes, and its roar
  rises as it closes from 40 m.
- **Splashes** (every map's water: a river, a ford, a puddle): driving or landing in it throws a
  ring of spray up and a ripple out (and a splash you hear); wading leaves rings spreading on the
  water, a wake behind you at speed, and a bow wave off the nose. A puddle's are smaller.
- **Numbers:** field races, seeds 1–12: 11 wrecks (8 before), the three new ones on the devils'
  stretches (802 m car on car; resets at 992 m and 3638 m), about one race in four. Fingerprints
  unchanged (they race at mayhem off, in clear weather).
