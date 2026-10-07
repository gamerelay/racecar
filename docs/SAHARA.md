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
2. **The river:** an oasis river (the Nile's green strip) down the low west side by the Caravan
   Road, crossed twice: a ford (shallow water on the road: a splash, a little drag, grip down)
   and a bridge (a deck piece). A `river` feature like the lava stream's channel, water in it,
   drawn with the sea's water; palms and reeds along it.
3. **Giza dressed:** the pyramids' capstones, the Sphinx as the plateau's landmark, obelisks,
   a ruined colonnade (solid props splitting the road into lanes), market stalls of smashables.
4. **More of what drifts:** tune the berms by driving them (bank, width, the outside's lip),
   and maybe a slot canyon in the Wadi (rock walls close either side, `GroundDef.face`).
5. **Life:** a camel caravan crossing (traffic on a side street), dust devils (a hazard), a
   sandstorm weather, a sunset palette.
6. **Fingerprints, tests and the lobby:** record its fingerprints, its own tests (the run
   flown, the crests and the drop clean, berms banked the right way), and out of experimental
   when the owner says.

## Questions for the owner

- **Length:** 4.04 km is past MAPS.md's 2.9–3.8 km; trim a pass, or keep it long and technical?
- **The river:** a ford to splash through, a bridge, or both? And should it be on the lap
  (the Caravan Road) or a shortcut along it?
- **The pyramids:** go over the Great Pyramid (as built), or up a face and off a ramp into the
  air? Should the off-road pyramids be climbable, as now, or walls?
- **Surfaces:** more of the lap on packed sand (looser, more drift) or more asphalt to catch it?

## Built so far

### Step 1, the lap (2026-10-07, experimental)

As in "The lap" above. The AI's costs are driven (the default): the Pyramid Run is quicker for the
hard AI, which takes it. Fingerprints not recorded yet (the owner: hold off), so the golden test
skips a layout with none.
