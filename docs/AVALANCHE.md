# Avalanche: a plan for the first open map

The fourth map, and the first built on PLAN's "Open, freeform maps" direction. Up a mountain road in
the Swiss Alps, then down the snow, more like a snowboarding game than a road race. **It's an
outline, not a spec.** Details will change while building; note those changes in
[SPEC.md](./SPEC.md) under "Changed while building", as usual.

Started 2026-10-02. The owner's brief:
- Try the open direction on a **new map first**, and leave the three maps we have as they are.
- **Start small:** a simple snow surface to drive on, to find out how it feels.
- Then **moguls**, **several winding routes down** like a real ski mountain, and **little canyons
  that work almost like halfpipes**.

PLAN's [Avalanche](./PLAN.md) section has the first sketch: the road up, the routes down, snow,
hazards and scenery. This file is how to build it.

## The idea in one paragraph

There's still a track: a road winds up the mountain, and the groomed pistes are the fastest way
down. But the whole mountainside is snow you can drive on. You can take a canyon instead of a piste,
cut through powder (slower), ride a halfpipe wall for air, skip over moguls, or clip a jump from an
angle. Trees, rocks, cliffs, fences and the avalanche itself are what make a bad line cost you. The
pistes are always quickest, so the AI can race them, and players who know the mountain can find
lines the AI doesn't.

## What the game can't do yet

Reading the code for this, there are four gaps. Each one is a step below.

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
4. **Obstacles are only drawn.** The forests' trees and rocks have nothing to hit in the sim. Off
   the pistes, hitting things is the cost of a bad line, so they need **colliders**.

Everything else carries over:
- **Splines:** for the road up, the pistes, the AI's lines, checkpoints and progress.
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
  (the road up, bridges, a tunnel) the road wins, blended over its shoulder. In `finishProjection`
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

### Laps on an open map

- **Checkpoints become gates:** a line across the whole mountain at each stage of the lap, the
  full width, so every route passes through it. The bake already steps checkpoints past
  branches, and gates on the snow are that, made wide.
- **No cheating:** missing a gate doesn't count the lap. The gates stop you skipping the road up.
- **Lap shape:** a loop. The road up (asphalt switchbacks, about 40% of the lap) and the way down
  (about 60%), back onto the road at the valley station.

## Gameplay ideas

### The way down

- **Pistes:** wide (25–40 m), groomed (packed snow, fast), and gently banked into their turns.
  They're the AI's lines.
- **Routes that split and rejoin**, like a ski area's map:
  - a blue cruiser;
  - a red with more turns;
  - a black that drops steeply (faster and riskier).

  The routes are branches, and "mini-routes" are short branches off them.
- **Canyons (halfpipes):** a flat floor 8–12 m wide, with curved walls 4–6 m high, no steeper than
  about 60°. Ride a wall up: slope gravity brings you back down, and off the lip you get air.
  Air already pays boost, so a canyon pays for itself if you ride it well, and it's a slower line
  if you don't. One canyon could hold a frozen stream (ice) along its floor.
- **Moguls:** a field of bumps, about 1 m high and 5–7 m apart, beside or across a piste. The
  wheelbase smoothing makes them a rhythm. Clip the tops at speed for small hops, or go round on
  the slower powder.
- **Powder:** everything off the groomed snow. Slower, looser, and a big spray. A short powder cut
  can still pay on a tight turn: "micro-cuts" on snow.
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

### The way up

- **The road:** asphalt switchbacks with stone walls on the drop side, a couple of tunnels and
  snow banks, built the way Paradise's rim road is (`tools/lib/lap.ts`).
- **Ice:** on one hairpin, in the shade.
- **Slope gravity makes the road up slower than the way down:** about right, since the climb is
  the "breather". Check that the slowest class (the bus) doesn't crawl.

### Hazards and mayhem

- **The avalanche:** at mayhem, a wall of snow comes down one piste. It's a hazard moving down the
  spline at a fixed speed, closed-form in time like traffic, so it's the same on every screen.
  If it catches you, you wreck. You outrun it or bail into a canyon. It's the map's name.
- **Snowballs:** they roll down the routes and grow, like Paradise's boulders. Hit one and you
  wreck.
- **Falling rock** on the road up.
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

1. **The slope** (dev only, not in the lobby yet). One straight mountainside, 600 m long, a
   single wide piste spline for the start and progress, with:
   - the ground in the sim (`ground.ts`) and the renderer drawing the same;
   - slope gravity turned on for this layout;
   - one mogul field and one canyon;
   - the wheelbase smoothing;
   - plain white and grey, no scenery.

   Reached by URL, in free drive (`?mode=free&map=avalanche/slope`). **The owner drives it, and we tune
   how snow feels before anything else.**
2. **The AI on the snow.** A loop: the slope, plus a flat return. Then:
   - the lap report;
   - the hard AI's line and braking with gravity;
   - wreck rates;
   - whether it uses the canyon or keeps to the piste.
3. **The mountain's shape.** The generator (`tools/gen-avalanche.ts`), with:
   - the road up;
   - three routes down that split and rejoin;
   - gates across the whole mountain;
   - bounds and cliffs;
   - respawns.

   The lap time target is about 70–90 s.
4. **Snow and the look.** Packed snow, powder and ice surfaces, the spray, snowfall, the palette,
   and the camera's pitch.
5. **Things to hit.** The colliders, a forest from the same list, rocks, fences, and slalom gates
   for boost.
6. **Hazards.** The avalanche, snowballs and falling rock, tuned at normal and chaos.
7. **Scenery, the lobby and tuning.** The summit station, the lift, chalets and the ski jump; the
   map's music; its thumbnail and minimap; validation; the release.

Steps 1 and 2 decide the rest: if snow doesn't feel good, or the AI can't race it, we change the
plan before building the mountain.

## Questions for the owner

- **Laps, or a run down?** A loop keeps it like the other maps (a lobby's laps and the results).
  A point-to-point run, with a lift back up between races, would be new.
- **How steep, and how fast?** Real pistes run about 10–35°. Too steep, and slope gravity makes
  the way down a drag race.
- **How much should powder cost?** It's the main lever between "open" and "the track's still the
  fastest".
- **Slope gravity on the other maps later?** It would make Backroads' crests and Paradise's volcano
  feel more real, but it changes their tuning. Not now; worth knowing for later.
