# Avalanche: a plan for the first open map

The fourth map, and the first built on PLAN's "Open, freeform maps" direction: one long run down a
mountain in the Swiss Alps, more like a snowboarding game than a road race. **Experimental:** it's
built on its own branch and PRs marked experimental, not slated for a release, and it stays out of
the lobby until the owner says so. **It's an outline, not a spec.** Details will change while building; note those changes in
[SPEC.md](./SPEC.md) under "Changed while building", as usual.

Started 2026-10-02. The owner's brief:
- Try the open direction on a **new map first**, and leave the three maps we have as they are.
- **Start small:** a simple snow surface to drive on, to find out how it feels.
- Then **moguls**, **winding routes** like a real ski mountain, and **little canyons that work
  almost like halfpipes**.

And the owner's answers (2026-10-02):
- **One route down, no laps.** A race is a single run from the top to the bottom, with no road up.
- **Long:** about as long as two laps of a course, so about 6–7 km and two minutes or so.
- **Its shape:** some pitches steep, some a gradual bunny slope, and a few short stretches that go
  back uphill a little.
- **Powder:** it costs a little, because it's light. It's slower than the piste, but not a wall.

PLAN's [Avalanche](./PLAN.md) section has the first sketch (it had a road up and several routes:
both dropped). This file is how to build it.

## The idea in one paragraph

There's still a track: one groomed piste, top to bottom, the fastest way down. But the whole
mountainside around it is snow you can drive on. You can cut a turn through the powder (a little
slower), drop into a canyon beside the piste and ride its walls for air, skip over moguls, or clip a
jump from an angle. Trees, rocks, cliffs, fences and the avalanche itself are what make a bad line
cost you. The piste is always quickest, so the AI can race it, and players who know the mountain
can find lines the AI doesn't.

## The run

About 6–7 km from the summit to the valley, in stretches like a real piste's:
- **Steep pitches,** 25–35°, where slope gravity takes you past any car's top speed: the fast,
  scary part, with a long run-out after each.
- **Bunny slopes,** 5–10°, gentle and wide: drifting, carving and catching up.
- **Short climbs,** a few meters back uphill over a ridge or a bridge between two valleys: you
  carry speed in or lose time, and a crest at the top to jump.
- **Canyons** beside the piste, halfpipes to ride as an alternative line, rejoining it.
- **Mogul fields** across or beside the piste: hop the tops or go round in the powder.
- **Jumps** you can hit from any angle (kickers with flanks, rollers, a ski jump near the end).
- **The finish** in the valley, by the chalets, where the run-out is flat.

## What the game can't do yet

Reading the code for this, there are five gaps. Each one is a step below.

1. **There's no ground off the road.** Beside a road, the physics' ground is that road's surface
   carried flat outward (`finishProjection` in `src/core/track/query.ts`). The land you see
   (`src/render/skins/greybox/terrain.ts`) is only drawn, so a car on open snow would drive on
   thin air or through a hill. An open mountain needs **one heightfield**, used by both the physics
   and the renderer.
2. **Slopes don't speed you up or slow you down.** Hills move a car up and down
   (`followGround` in `physics.ts`) but never change its speed. Downhill doesn't pull you, and
   climbing doesn't slow you. That pull is what makes a snow run flow and a halfpipe work: you go
   up the wall, slow, and come back down. Avalanche needs **slope gravity**.
3. **Out of bounds is 25 m past a road's shoulder** (`outOfBounds` in `tuning.ts`): a wreck and a
   respawn. Here the edges are the map's: cliffs, a crevasse, the boundary fence.
4. **A race is laps on a closed loop.** The main spline is always closed (`bakeTrack`), and the
   start grid, lap counting, progress, checkpoints, the AI's look-ahead and traffic all wrap round
   it. One run, top to bottom, needs an **open main road**: a start at one end, a finish at the
   other, one "lap".
5. **Obstacles are only drawn.** The forests' trees and rocks have nothing to hit in the sim. Off
   the pistes, hitting things is the cost of a bad line, so they need **colliders**.

Everything else carries over:
- **Splines:** for the piste, the AI's line, checkpoints and progress.
- **Branches:** for the alternative routes.
- **Surfaces, boost, drifting and air:** air time already pays boost, and a "Superman" (boosting
  while airborne) pays extra.
- **The rest:** ramps with flanks (PR #72), the lap report, the poster scout and free drive.

## How it fits in the code (the architecture)

### A ground that the sim and the renderer share

- **`src/core/world/ground.ts`** (new): `height(x, z)`, plus its slope (the gradient), from a
  grid baked once from the layout. Bilinear, about 4 m cells (a 1.6 × 1.2 km mountain is about
  120,000 cells), as a `Float32Array`.
- **Built from features, not stored:** the layout lists what shapes the mountain, and the grid is
  built from that list at load:
  - the base slope, and large noise from a seed (the existing `hash01`, never `Math.random`);
  - the pistes and routes carved in along their splines, smooth across;
  - canyons, with a halfpipe cross-section;
  - mogul fields;
  - kickers and drops;
  - cliffs.

  The same function feeds the renderer's land, so what you see is what you drive on. Building it
  keeps the content files small and lets the editor rebuild it as it does the land now.
- **The ground query:** a layout with a ground uses it everywhere off a road's deck. On a deck
  (a bridge, a tunnel, the start pad) the road wins, blended over its shoulder. In `finishProjection`
  that's one branch: `track.ground ? ground.height(x, z) : road plane`.
- **Determinism:**
  - Each client simulates its own car and sends it (`src/net/cars.ts`), so tiny floating-point
    differences between browsers' `Math.sin` don't desync anything. Traffic is closed-form, and
    there's no traffic on the snow.
  - Build the grid with plain arithmetic where possible anyway, and test that it's identical
    across two builds.
- **The car's tilt from the ground's slope:** pitch and roll come from the gradient. This
  generalizes the flank fix in PR #72, and halfpipe walls need it.

### Slope gravity, only where it's turned on

- **What it does:** add `g × slope` along the ground, for downhill acceleration, the uphill
  slow-down and sliding sideways down a wall. Grip resists the sideways part, as it does in a
  drift now.
- **Turned on per layout** (`physics: { slopeGravity: 1 }`) or per surface (snow slides, asphalt
  doesn't). The three existing maps keep their tuning: their crests would otherwise change every
  lap time and wreck rate.
- **Measure it on its own:** the lap floor, and whether the hard AI's braking still fits. The AI's
  speed plan is about curvature today, and downhill it will need to plan for gravity too.

### Smoothing the bumps over the car's length

- **The problem:** the car follows a single point of ground. At 30 m/s over moguls about 6 m
  apart, it would be launched five times a second.
- **The fix:** sample the ground at the four wheels, or average it over the wheelbase, so bumps
  shorter than a car are soaked up the way suspension would. Moguls then feel like rhythm, not
  rattle. Tune the mogul size against this.

### Open ground: bounds, "on no route", respawns

- **Bounds:** they come from the ground itself, not 25 m past a road. That's the map's edge, a
  cliff's foot (a drop past a threshold is a wreck) and crevasses (zones).
- **Location:** a car always has its nearest route (for progress, laps and the minimap), but
  being far from every route isn't out of bounds on a layout with a ground. The car is located
  as now: the spline it's most inside, otherwise the nearest.
- **Respawns:** on the nearest piste, facing down it.

### Colliders for things on the mountain

- **What:** a static list of circles and boxes (trees, rocks, pylons, chalets, fences), placed by
  the generator from the seed. The renderer draws its forest from the same list, so every
  visible trunk can be hit.
- **Lookup:** bucketed in a grid, so a car checks only the cells around it. Hits use the props'
  wreck rules (`Cause` in `events.ts`), with small things smashable (signs, flags, snowmen).

### One run: an open main road

- **`main.closed: false`** in a layout: the main spline has two ends. The race is one "lap" from
  s = 0 to the end. The grid stands at the top (behind s = 0 means above the start: a flat start
  pad there), and the finish is crossing the end.
- **What has to stop wrapping:** `wrap` and `signedGap` on the main road, progress and places,
  checkpoints, the grid's placement, the AI's look-ahead (it slows to a stop past the end), the
  minimap (an open line, not a loop), and respawns near the ends. Traffic is off on this map.
- **The lobby's laps** don't apply: a race on this map is one run, and the lobby says so.
- **Checkpoints become gates:** lines across the whole mountain at stages of the run, the full
  width, so every line down passes through them. The bake already steps checkpoints past
  branches; gates on the snow are that, made wide.
- **No cheating:** missing a gate doesn't count. There's nothing much to skip on a run down, but
  a canyon or a cut mustn't skip a gate.
- **Until then (step 1):** a loop, the run down and a plain return road back up, driven in free
  drive. Enough to tune how snow feels.

## Gameplay ideas

### The way down

- **The piste:** wide (25–40 m), groomed (packed snow, fast), and gently banked into its turns.
  It's the AI's line.
- **One route, with lines:** a canyon or a mogul field beside it is a line, not a second route:
  short branches where the AI should know about them, open snow where it needn't.
- **Canyons (halfpipes):** a flat floor 8–12 m wide, with curved walls 4–6 m high, no steeper than
  about 60°. Ride a wall up: slope gravity brings you back down, and off the lip you get air.
  Air already pays boost, so a canyon pays for itself if you ride it well, and it's a slower line
  if you don't. One canyon could hold a frozen stream (ice) along its floor.
- **Moguls:** a field of bumps, about 1 m high and 5–7 m apart, beside or across a piste. The
  wheelbase smoothing makes them a rhythm. Clip the tops at speed for small hops, or go round on
  the slower powder.
- **Powder:** everything off the groomed snow. A little slower (it's light: a small drag, less
  grip, not grass's), looser, and a big spray. A short powder cut can pay on a tight turn:
  "micro-cuts" on snow.
- **Jumps from any angle:** kickers with flanks (PR #72) and natural rollers and spines you can
  hit from different lines. One big jump near the bottom, like a ski jump you can fly off, as a
  landmark.
- **Drops and cliffs:** small drops (1–3 m) with clean run-outs are fun. Big cliffs are the edge,
  with a fence or a sign.
- **Slalom gates:** pairs of flags down a piste. Pass between them for a little boost, as SSX's
  gates do. They make a good racing line visible, and they're cheap to build (trigger zones).
- **Carving:** drifting on packed snow charges boost a little faster than on asphalt. It's one
  surface setting (`driftCharge` in `surfaces.json`), and it makes the way down feel like
  carving.

### The short climbs

- **Slope gravity slows you on them:** that's the point (carry speed in, or lose time). Keep them
  short, a few meters of height, so the slowest class (the bus) doesn't crawl.
- **Ice:** one shaded stretch, maybe on a climb.

### Hazards and mayhem

- **The avalanche:** at mayhem, a wall of snow comes down one piste. It's a hazard moving down the
  spline at a fixed speed, closed-form in time like traffic, so it's the same on every screen.
  If it catches you, you wreck. You outrun it or bail into a canyon. It's the map's name.
- **Snowballs:** they roll down the routes and grow, like Paradise's boulders. Hit one and you
  wreck.
- **Falling rock** under the cliffs.
- **A snowcat** grooming the piste (traffic on the snow, closed-form).

### The look and feel

- **Snow spray:** a dust kind for snow (`DUST` in `renderer.ts`), bigger in powder.
- **Tracks that last:** skid marks on snow that stay for the race.
- **Snowfall:** as weather.
- **A bright, cold palette:** white, blue shade, grey rock and dark pines, with maybe a pink dusk.
- **Scenery:** a summit station, a gondola or chairlift on cables over the routes (scenery: a
  moving lift you could jump past), chalets at the bottom, and pines heavy with snow.
- **The camera:** it follows the slope's pitch, so a steep run looks steep, and leans with a
  halfpipe wall.
- **Sound:** a crunch on snow and a hiss in powder.
- **Music:** the owner's own track for the map.

## Steps, one PR each

1. **The slope** (experimental, not in the lobby). A loop, about 1.5 km: a run down with a steep
   pitch, a bunny slope and a short climb, and a plain return road back up. A wide piste spline
   for progress, with:
   - the ground in the sim (`ground.ts`) and the renderer drawing the same;
   - slope gravity turned on for this layout;
   - one mogul field and one canyon;
   - packed snow on the piste and powder off it;
   - the wheelbase smoothing;
   - plain white and grey, no scenery.

   Reached by URL, in free drive (`?mode=free&map=avalanche/slope`). **The owner drives it, and we tune
   how snow feels before anything else.**
2. **The AI on the snow.** On the step 1 loop:
   - the lap report;
   - the hard AI's line and braking with gravity;
   - wreck rates;
   - whether it uses the canyon or keeps to the piste.
3. **One run.** An open main road (above): the start at the top, the finish at the bottom, no
   laps; the grid, progress, the AI and the minimap without wrapping; gates.
   - Then the mountain's shape: the generator (`tools/gen-avalanche.ts`), 6–7 km, with the steep
     pitches, bunny slopes, short climbs, canyons and moguls; bounds and cliffs; respawns.
   - The target is about two minutes for the hard AI.
4. **Snow and the look.** Packed snow, powder and ice surfaces, the spray, snowfall, the palette,
   and the camera's pitch.
5. **Things to hit.** The colliders, a forest from the same list, rocks, fences, and slalom gates
   for boost.
6. **Hazards.** The avalanche, snowballs and falling rock, tuned at normal and chaos.
7. **Scenery, the lobby and tuning.** The summit station, the lift, chalets and the ski jump; the
   map's music; its thumbnail and minimap; validation; the release.

Steps 1 and 2 decide the rest: if snow doesn't feel good, or the AI can't race it, we change the
plan before building the mountain.

## Built so far

### Step 1, the slope (2026-10-02, experimental)

Open it in free drive: `?mode=free&map=avalanche/slope` on the dev server. The poster scout works
too (`poster.html?scout=avalanche/slope&s=…`).

- **The ground** (`src/core/track/ground.ts`): a 2 m grid (340 × 890 points, about 0.2 s to build),
  shaped round the main road:
  - the road's own height on the road and its shoulder;
  - off it, the land between the roads: the road's plane carried out, then relaxed smooth on an
    8 m grid (300 passes), blended in across the rough snow. Carried out alone, the plane jumped
    where two stretches were equally near: cliffs up to 136 m on the ridge between the run and the
    road back. Relaxed, nowhere steps more than 2.5 m between points 2 m apart;
  - rough snow off it (up to 1.2 m, 18 m across);
  - a mogul field (1.6 m bumps, 10 m apart, rows offset; 1.1 m and 7 m before the owner's drive);
  - a canyon: a 10 m floor, 5 m deep, quarter-circle walls about 60° at the lip, easing in over
    30 m;
  - walls rising 0.8 m per m from 70 m out.

  Every ground query reads it on a layout with `ground` (`finishProjection`), and the renderer draws
  the same grid (`snow.ts`) in 128 m tiles the camera culls: the road's surface on the road, powder
  off it, grey rock where it's steep. The roads' own decks aren't drawn on it; a road that isn't
  snow has its lines painted on the ground (edges, a dashed yellow middle), and the finish is
  checkered across the piste.
- **Bounds:** 25 m up the walls past their foot (`GroundDef.wallOut`, `Ground.outside`) is out of
  bounds, a wreck and a respawn on the piste. Before that, a car flat out climbed the walls and
  drove off the grid onto flat ground forever (550 m out in a test).
- **Slope gravity** (`SurfaceDef.slide`): snow and powder slide (1), every other surface doesn't
  (0), so the other three maps drive exactly as before (their lap floors are unchanged). On a
  sliding surface the engine doesn't hold you at top speed, so a steep pitch takes you past it.
- **Wheels:** the ground under a car is the mean of its four wheels'. Through the moguls at
  20 m/s you're airborne about a third of the time; at 30 m/s you skip across the tops, airborne
  about four fifths of it in half-second hops.
- **The body** follows the ground's slope along and across the car.
- **Surfaces:**
  - `snow`, groomed: grip 0.8, a little drag, drifting charges 15% faster ("carving");
  - `powder`: grip 0.7, drag 0.12 (it costs a little: dirt's is 0.25, grass's 0.45), off-road.
- **The layout** (`tools/gen-avalanche.ts`, `content/maps/avalanche/`): a 3.6 km loop.
  - The run down is about 1.4 km, 200 m of drop: a start pad, a bunny slope (12%), a steep pitch
    (about 40%), a run-out, a short climb to a crest, a second steep pitch (about 30%), the
    moguls, the canyon, and a gentle finish.
  - Then an asphalt road back up, over the ridge (it doesn't slide).
  - The `alpine` palette.
- **Experimental:** `experimental: true` in `map.json` keeps it out of `MAPS` (the lobby, the vote,
  the results), the validator and the every-layout lap report. `ALL_MAPS` and `EXPERIMENTAL_KEYS`
  reach it, and the lap report runs it when it's named.
- **Snow spray** (`DUST` in `renderer.ts`): powder throws a big white spray, and a burst as you
  run into it; groomed snow throws a smaller one only in a carve or a slide.
- **The hard AI** gets round clean: 62.3 s a lap, top speed 228 km/h (past the coupe's top, down
  the steep pitches).
- **Tests** (`test/ground.test.ts`): the ground is the road along its middle and walls far out;
  snow pulls you down a slope and asphalt doesn't; the canyon's profile; it's experimental; the
  hard AI gets round.

Not done yet:
- **Feel:** nothing is tuned by a drive yet. That's the owner's next step. Each of these is one
  number: how hard snow pulls (`slide`), powder's cost (its `drag`), the moguls' height and spacing,
  the canyon's depth, how steep the pitches are (the generator's heights).

### The owner's drive (2026-10-02)

- **It feels good.** The snow, the pull of the slope and the moguls work.
- **Moguls:** bigger and further apart. Now 1.6 m high and 10 m apart.
- **The camera uphill:** going up a climb, the camera's angle makes it hard to see over the top.
  The owner likes that on the other maps (a blind crest), so it stays. Come back to it for this
  map: a camera that follows the slope's pitch (step 4).
- **One run, straight down:** a single run from the top to the bottom, with more verticality,
  more uneven ground, and small tilts and gradual banks that wind and switch. That's step 3, next.

### Looking ahead (from step 1's review)

- **A 6–7 km run's ground.** The grid covers the road's bounding box. A run zigzagging down a
  1.5 × 3 km mountain at 2 m is about 1.1 million points: about 13 MB of arrays and some 260
  tiles, too much to draw at once and slow to build (about 0.7 s). For step 3: keep the 2 m grid
  only in tiles that come within the walls' reach of the road (a corridor, about a third of the
  box), draw a coarse 8 m mesh beyond, and draw far tiles coarser (a level of detail per tile).
  The tiles are already the unit for that.
- **One run (step 3)** needs nothing new from the ground: it reads `main.closed`, and the land's
  relaxation fills the ground between a switchback's legs as it does the ridge now. A layout's
  switchbacks can come within the walls of each other, and the ground between them is then
  drivable snow, a cut. Gates (step 3) are what stop a cut from skipping the run.
- **The AI (step 2):** its speed plan is about curvature. Downhill it has more speed than it
  planned, and it's clean today only because the piste is wide. Plan the braking with the slope
  in it before the run gets steeper or narrower.
- **Respawns** put you back on the piste where you left it, facing down it. Out of bounds
  in a canyon or up a wall needs no more than that.

### Step 3, one run (2026-10-02, experimental, in PR #74)

Brought forward on the owner's drive: the map is one run, summit to valley, with more verticality
and uneven ground. Open it as before, `?mode=free&map=avalanche/slope`.

- **An open main road** (`layout.run: { start, finish }`): the main spline isn't closed, the grid
  stands behind `start` at the top, and crossing `finish` after every checkpoint is the run's one
  "lap" (`runProgress` in `rules/progress.ts`). A race on it is one run, whatever the lobby asks
  for. Past the finish is a 220 m run-out; the AI plans to stop by the road's end. In free drive,
  4 s past the finish you're back at the top for another run, your best kept.
- **Checkpoints** sit evenly between the start and the finish; nothing wraps.
- **The run** (`tools/gen-avalanche.ts`): 6.2 km, 1,225 m of drop, in 19 stretches: a start pad, bunny
  slopes, five steep pitches (45%, 55%, a 70% wall, 50%, 40%), three short climbs to crests, a
  long winding stretch, the valley and a run-out. Grades are smoothed where they meet, so crests
  throw you. The piste winds (30–42 m wide, narrower on the steepest), banks into its turns, and
  tilts a little side to side between them, switching as it goes.
- **The ground:** swells over everything, the piste too (1.4 m, 45 m across: small tilts you feel);
  rougher powder (2.6 m); two mogul fields (one beside the piste, one across it); two canyons (one
  each side); walls from 80 m out. A 2.5 m grid, 0.48 million points, about 0.6 s to build.
- **Kickers** with flanks on the top of two climbs and in the valley. Their height now runs out
  past the piste's edge on the ground (8 m unless set): before, a kicker on open ground stood as a
  ridge across the whole mountain.
- **The AI:** the hard coupe gets down clean in 97 s (268 km/h at the fastest). A full field of
  eight, normal and chaos, gets down clean, every class between 93 and 107 s.
- **Tests:** it's one run (open, 6 km and 1,000 m of drop or more, the grid behind the start); a
  race is one run and finishes at the line; free drive starts you again at the top; the kicker's
  height runs out off the piste; the AI gets down clean.

Not done yet:
- **The HUD** still says "Lap 1/1": it could say "Run" and show the distance to the bottom.
- **The camera uphill** (the owner's note, above) and the camera's pitch down a steep run (step 4).
- **The ground's size:** fine at 6 km (0.48 million points). The corridor and the far tiles'
  coarser mesh ("Looking ahead") are for a wider mountain.
- **Gates** across the whole mountain: nothing to skip yet, the checkpoints are enough.

### Rocks on the piste (2026-10-02, experimental, in PR #74)

The owner's ask after driving the run: a few snow-capped rocks and ridges in the middle of the
piste, to go round left or right, or crash. The first of step 5's "things to hit".

- **Nine of them** (`tools/gen-avalanche.ts`): seven rocks (4–6 m across, 2–3 m high) and two
  ridges (3.5 m across, 18 and 22 m long), on the bunny slopes, the run-outs, the rollers, the
  winding stretch, beside a canyon and in the valley. None on a kicker's approach or landing,
  in the moguls across the piste, or near the grid and the finish. The ridge in the rollers leaves
  the clean way round on the left; the right goes through the moguls.
- **Solid props** (`kind: 'rock'`, on the road with a `lateral`), as the city's pillars are: a
  hard hit wrecks you, a glancing one bounces you off. On open ground a prop stands on the ground,
  not the road's line under it, and you can jump one (its top is 2 × its half height).
- **Drawn** (`snow.ts`): lumpy, half buried, filling their colliders; snow on the faces flat enough
  to hold it, dark rock on the steep sides.
- **The AI**, on open ground only (the other maps' lines and lap floors are unchanged):
  - its line round a rock is clear of it well before (by 30 m) and held past it, eased in over
    80 m, and keeps 1.5 m further off;
  - a rock's width is its size across the piste (a ridge's length doesn't push the line into the
    moguls);
  - off the line, round another car, it goes back to the line only on the side of the rock it's on;
  - it aims a little up the slope against the snow's sideways pull (before, it ran 3 m downhill of
    its line on the banks and swells, into a rock).
- **Measured:** the hard coupe gets down clean in 98.3 s. A field of eight in normal and chaos
  hits no rocks: one car-on-car takedown a race. (The field runs the same on every seed: no
  traffic or weather here to vary it.)
- **Tests:** a few rocks, solid, on the piste and on the ground, a ridge among them; driven straight
  at, one wrecks you.

## Next: a loose plan (2026-10-02)

The owner picked these after driving the run with its rocks ("this amount of rocks looks good").
Loose, like the rest of this file: an order and a sketch of each, not specs. One PR each, all on
the experimental line (PR #74) until the owner says it's ready. Measure every change with the lap
report (`bun tools/lap-report.ts avalanche/slope`, `--field`, `--chaos`) and check the other maps'
lap floors haven't moved.

### The feel first

Items 1 and 2 are built (2026-10-02, on PR #74):

- **The run reads as a run.** The HUD's lap box is "To go", the distance to the bottom (km, then
  m), and a run's pop is "Run 1:38.2" / "Best run!". The results say "Best run". The generator puts
  a gate over the start and the finish: solid timber posts (`gate-post` props) just off the piste
  either side, which `snow.ts` draws with a beam and a banner, striped red at the top and checkered
  at the bottom, high enough to drive under. The lobby says "one run" and puts "Length: One run"
  in place of the laps chooser. Nobody sees that yet, because the lobby doesn't list experimental
  maps; it's ready for item 10.
- **The camera follows the slope**, on open ground only (`slopeView` in `camera.ts`). The look
  point follows the ground a look-distance and two ahead, smoothed, so the wall looks down onto
  the valley. Uphill it lifts the camera up to 2.5 m (a quarter of the rise) to see over the top.
  It also stays 1.2 m above the snow, since behind a car on a steep pitch it was inside the slope.
  The other maps' camera is unchanged.
- The lap report is unchanged (98.32 s; the field and chaos the same), and so are the other maps'
  floors.

Item 3 is built too (2026-10-02):

- **Tracks that last.** Every rear wheel on snow leaves a track, not just a slide's: faint and
  narrow on the groomed piste, deeper and wider in powder, darker in a slide. They're in a second
  skid ring (`Skids(24000, 900, 1.2)`: 15 minutes, a segment every 1.2 m), made the first time a
  map has snow, so the other maps don't carry it. There's no rubber on snow.
- **Snow sounds.** A crunch on the groomed piste (band-passed noise that flutters frame to frame),
  a hiss in powder (no gravel there any more), no tyre squeal on snow. A landing on snow, even a
  mogul's hop, is a soft whump.
- **Snowfall.** A map whose weather lists `snow` gets snow wherever another gets rain
  (`WeatherPlan.snow`). Grip drops a tenth, where rain takes a fifth. Puddles stay off, and so does
  the wet-road sheen. The sky goes fully overcast, and the fog closes in, whiter. Round flakes sway
  down in an 80 m box around the camera, and a car drives through them. The lobby's "Rain" reads
  "Snow" there. Avalanche's map.json is now `['clear', 'snow']`.
- The lap report takes `--weather rain` (snow where the map snows). In snow: 99.47 s, clean. The
  snowy field and chaos: no wrecks.

Item 4, the avalanche, is built (2026-10-02):

- **Closed-form in time** (`core/world/avalanche.ts`), so it's in the same place on every screen.
  Its front breaks away 80 m above the start line 4 s after the green light. It goes down the main
  road at `56 × (0.7 + 1.5 × grade)` m/s (clamped to 0.5–1.9×), from a table of arrival times
  built once. It runs out 50 m above the finish line, so a car ahead of it can always finish.
  It's only at chaos, only while racing, and only on a layout with `avalanche` (Avalanche's
  generator sets `{ behind: 80, delay: 4, speed: 56 }`).
- **Buried:** each tick, a car of this screen's behind the front is wrecked (`Cause.Hazard`,
  thrown down the slope). Its respawn moves it 60 m ahead of the front, and never within 15 m of
  the finish. One run's progress counts the checkpoints a respawn like that skips. Any other
  respawn still counts nothing.
- **A canyon is a way out:** more than 4 m down in a canyon (`canyonAt` in `ground.ts`), and not
  in the air over it, a car is under the avalanche.
- **Drawn** as a churning band of unlit white blobs across the piste and 35 m past each edge,
  with a translucent powder cloud billowing over and ahead of it. **Heard** as a low rumble from
  500 m behind you, louder as it closes. The HUD shows "Avalanche! 120 m" within 300 m, pulsing
  faster within 100 m, and a burial pops "Buried!".
- **Tuned:** in the chaos field it buries one car a race. That's a car just taken down behind it,
  which is the design: wreck and it gets you. The bus at the back stays clear on a clean run.
  Below 54 m/s it never catches anyone, and above 58 it catches the slow cars again and again.
  The field's finishing times are within 0.5 s of chaos without it.

Item 5, slalom gates, is built (2026-10-02):

- **18 gates** (`layout.slalom`): five down the first bunny slope (14 m wide), ten down the winding
  stretch (11 m), three after the moguls on the second bunny slope (13 m). Each is nudged toward
  the inside of the turn 40 m ahead and weaves 4 m left and right of it, so the gates show the
  fast line. None is within 30 m of a rock.
- **Flags** are smashables (`gate-red` and `gate-blue`, gate by gate, 3.2 m tall with a panel square
  to the road). Clipping one knocks it flat (it stands again 30 s later), never a wreck.
- **Through a gate** (`rules/slalom.ts`): `boostFromGate` 0.04 of a bar (scaled by position, like
  any boost you earn), and 200 points × the gates in a row, up to 5. A miss ends the streak and
  costs nothing else. The pop says "Gate ×3", and a chime climbs a step a gate.
- **The AI** takes a gate when its line goes through. A hard driver also bends its line into a gate
  it would miss by up to 5 m. One run: easy and normal take 13 of 18, hard 15 (a best streak of
  7). The hard floor is 97.75 s (98.32 without gates). The field and chaos: no wrecks.

The sketches as they were:

1. **It reads as a run.**
   - The HUD: "Run" instead of "Lap 1/1", and a meter of the distance to the bottom (or a thin
     bar of the run with every car on it, which the minimap nearly is already).
   - A start gate at the top (a timber arch, banners) and a finish arch in the valley, drawn from
     `track.run`; the results say "run", not "lap", and a best run is a best lap's slot.
   - The lobby says "one run" for this map and hides the laps chooser.
   - Small: `src/ui/hud.ts`, `src/ui/race.ts`, `src/ui/menu.ts`, `snow.ts`.
2. **The camera follows the slope.**
   - Pitch it with the ground ahead (smoothed), so a 70% wall looks like one and a crest hides
     what's past it. Only where the layout has a ground: the other maps' camera stays as it is.
   - The owner's note: uphill, it's hard to see over the top. They like that on the other maps,
     so on this one only, try lifting the camera a little as the slope ahead rises.
   - Where: `src/render/camera.ts`. Check it in the poster scout at the walls' tops.
3. **Snow you feel and hear.**
   - Tracks that last: skid marks on snow and powder that stay the whole race (the skids'
     ring buffer, bigger, or a second one for snow), fainter on groomed snow.
   - Sound: a crunch on groomed snow, a hiss in powder, a thump on a mogul landing (beside the off-road gravel layer in
     `src/audio/audio.ts`, which powder gets now).
   - Snowfall as weather (`weather: ['clear', 'snow']`): flakes like the rain, a little less grip
     (`weatherGrip`), and fog that closes in.

### Gameplay a run is made for

4. **The avalanche** (at mayhem).
   - A wall of snow coming down the run behind the field, closed-form in time like traffic (its s
     is a function of the race clock), so it's the same on every screen with nothing to sync.
   - It starts behind the grid a few seconds after green, runs a little slower than the leaders and
     faster than the back of the field, and speeds up on the steep pitches. Caught: you wreck
     (`Cause.Hazard`) and respawn ahead of it.
   - Drawn as a churning white front with a powder cloud, a rumble that grows as it closes, and a
     warning on the HUD ("Avalanche!", its distance behind you).
   - A canyon is a way out: the avalanche runs the piste, and the canyon's floor is below it.
   - Off at normal mayhem, on at chaos; tune so it catches a car a race or so, not the field.
5. **Slalom gates.**
   - Pairs of flags across the piste, a gap 10–14 m wide, sometimes offset left or right. Through
     one: a little boost (like a near miss's). Missed: nothing lost, only the boost.
   - They show the fast line down the bunny slopes and the winding stretch, and they reward
     driving it cleanly. Cheap: a trigger zone and two poles (smashable, so a missed gate isn't a
     wreck).
   - The AI takes them when its line passes through, and at hard steers for them a little.
6. **Pines off the piste.**
   - Forests on the open snow, with colliders (circles, bucketed in a grid, as AVALANCHE's
     "Colliders" section sketches). A powder cut is then a gamble through the trees, not just a
     little slower.
   - Snow-laden pines from one list, the renderer drawing exactly what's solid. Thin near the
     piste, dense up the walls (and they hide the walls, which look bare now).
   - Keep the piste's edges and the canyons' mouths clear, and check the AI never needs to leave
     the piste.
7. **A ski jump near the bottom.**
   - One big kicker as the run's landmark: a long in-run, a lip, and a steep landing hill below
     it, so the flight is long but the landing is soft (land on a slope, not a flat).
   - Superman it (boost in the air) for the big payout. The AI flies it too.
   - With a tower and flags, seen from up the mountain.

### Before it could ship

8. **The AI downhill** (the plan's step 2).
   - Its speed plan is about corners; downhill it carries more speed than it planned. Plan the
     braking with the slope in it (the braking pass's `brake` less the downhill pull), and the
     corner speeds with the bank.
   - Sometimes take a canyon line (as a branch the AI knows, at a skill-based chance, like
     shortcuts), so a canyon's a real alternative and you see rivals ride it.
   - Then narrower and steeper stretches are safe to build.
9. **On a phone.**
   - Measure: the ground's build (0.6 s on a desktop), its draw (0.48 million points in 128 m
     tiles), the rocks and the snow spray, on a mid-range phone.
   - If it's slow: "Looking ahead"'s corridor (only the tiles near the road at 2.5 m, a coarse
     mesh past them) and a level of detail per tile, and build the ground in a worker or once and
     cache it.
10. **Release.**
    - The lobby (one run), the map's thumbnail and minimap for an open run, the validator taught
      about `layout.run` (it assumes a loop: the grid 50 m behind s = 0, checkpoints wrapping).
    - The map's music (the owner's own track), the attract mode and the map vote.
    - Then take `experimental: true` off, and it's a map.

### Later

- **What Avalanche taught, on the other maps:** slope gravity on Backroads' crests and Paradise's
  volcano, open ground for fields you can cut across. Their own experiment, once this settles: it
  changes their tuning.

## Questions for the owner

Answered 2026-10-02: one run, no laps; about two laps' length; steep, bunny and short uphill
stretches; powder costs a little. Still open:

- **How fast on the steep pitches?** Past a car's top speed is the thrill, but too much and the
  run's a drag race. Tune it in step 1.
- **Slope gravity on the other maps later?** It would make Backroads' crests and Paradise's volcano
  feel more real, but it changes their tuning. Not now; worth knowing for later.
