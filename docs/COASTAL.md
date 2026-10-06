# Coastal: a loose plan for a harbour town on the sea

A new open map, built on Caldera from the start: a harbour town on a rocky headland under blue
skies. It has yachts in the marina, terraced houses climbing the hill, a road cut into the cliffs,
a lighthouse on the point and a **drawbridge** over the harbour mouth. The mood is Monaco and the
Riviera, not Hawaii: stone, ochre and white, a deep blue sea, bright sun and long shadows.

**It's an outline, not a spec.** The owner's brief (2026-10-03) is the starting point. Details will
change while building; note them in [SPEC.md](./SPEC.md) under "Changed while building", as usual.
The engine is [CALDERA.md](./CALDERA.md); how open maps work, and why, is
[AVALANCHE.md](./AVALANCHE.md) and [PARADISE.md](./PARADISE.md).

## Why a new map

Caldera's next steps (moving pieces first, the drawbridge) were going to land on Paradise Open.
But Paradise Open is now dense and heavily tested:
- its golden fingerprints;
- a lap floor and a field result to hold;
- the Lava Tube, the berm, the market hall;
- tests that pin exact metres along its road.

Every engine change there means re-recording, re-measuring and checking that nothing moved. That's
slow when the feature itself is still being found.

Coastal gives the engine a fresh place to grow:
- **It's experimental** (`map.json`'s `experimental: true`, so it's out of the lobby until it's
  ready). It has its own fingerprints, and they're re-recorded as often as it changes. The rule
  stays the same for everything else: an engine change keeps every other map's fingerprints
  identical. That's a stronger check, not a weaker one. The drawbridge can change shape ten times
  on Coastal while Paradise Open proves that the shared code didn't move.
- **It's Caldera-native.** Paradise Open grew out of a walled lap and still carries that history:
  the Freeway as a deck on the main road, and features placed along the main road. Coastal is laid
  out in world space from the first commit (CALDERA's Principle 3), with pieces, features and
  buildings as the only ways to say things. Where the engine is awkward to use from a clean start,
  that shows quickly here.
- **It's another map.** Players get a new place, the `coastal` track gets a home, and the
  lighthouse finally gets its map. PARADISE.md said it was "saved for another map".

## The idea in one paragraph

A lap of a harbour town on a headland. From the start on the quay, the race crosses the harbour
mouth on a drawbridge, climbs the old town's switchbacks and carries on up a mountain road through
a rock tunnel. From the top it dives down the mountainside over the sea in stacked switchbacks,
rounds the lighthouse on the point, drops to the beach and runs home along the promenade. Every few laps the drawbridge lifts for a boat. Then the
choice is:
- go the long way round the inner harbour;
- or catch the leaf while it's still low, and jump the gap.

## The lap, a first sketch

North is up; the sea is south and west. The headland points south-west. About 3–3.5 km, so a lap
of 60–70 s, like the other maps. All of it is open ground: the sea is the edge (shallows, then a
respawn), and the land behind the town rises into hills you can't usefully climb.

1. **The Quay** (the start): a wide, straight harbour front with the grid on it. Yachts are moored
   along the sea side and café terraces line the town side. Breathing room, and the lap's main
   straight for boosting and fighting.
2. **The Harbour Bridge** (the signature moment): at the quay's end, the road crosses the harbour
   mouth on a bascule drawbridge: one leaf, hinged on the far side, with a tower and a
   counterweight. See "The drawbridge".
   - **When it's down,** it's just a bridge: a slight hump and a fast kink onto the far quay.
   - **When it's up,** you have two choices. The **Basin Road** turns inland round the inner
     harbour: up one side, a long bend round its head by the fish market and down the other,
     slow and safe. Or you **jump it**: in the first
     seconds of a lift, the leaf is a ramp and the gap is short.
3. **The Old Town**: a climb up the hill, a bend each way, narrow and cobbled, between ochre
   and pastel houses.
   - **A plaza** with a fountain, round it either way: a roundabout.
   - **An arcade** (a building piece, step 3c's kind): a covered gallery one switchback runs
     through. Its café glass smashes.
   - **The Stairs** (a risky cut): a stepped lane straight up the hill that skips a switchback.
     It's steep, bumpy and narrow; the AI only takes it on a good line.
4. **The Mountain Road** (the owner, 2026-10-04: the hillside was too linear; 2026-10-05: wind
   it like an S, and climb more): on up past the town in big S-bends, each the other way, to the
   top of the mountain at about 130 m.
   - **The Rock Tunnel** on it: through a spur of rock, lit by orange lamps. It's dark inside and
     bright at the far end, so you come out of it blinking (indoors, step 3a: the light, the fog
     and the echo).
5. **The Descent** (the owner: like the Bond film's chase down the mountain roads above the
   Riviera; 2026-10-05: several long, winding switchbacks, not a straight down the cliff): from
   the top, five rows down a steep mountainside over the sea, stacked down the slope with the
   town and the sea below. The ground falls steeply between the rows, so a car
   that runs wide at a hairpin flies off onto the row below: quicker if you land it, a wreck if you
   don't. Later, a low stone parapet on some of the outsides, and gaps in it.
6. **Lighthouse Point**: down the Corniche along the last of the cliffs, a bend each way, to a
   tight hairpin round the lighthouse at the cape's tip, the lap's landmark.
   - **The Rocks** (the cut): straight across the flat rocks below the lighthouse instead of round
     it. It's shorter, but the rock is rough and the sea is on both sides.
7. **The Beach**: down off the cape to a beach club, with umbrellas, a pool and a jetty. (2026-10-05,
   the owner: the waterfront is water against a sea wall, not a beach; see "Step 6b". The beach
   club and the Sand cut need a new home, maybe on the cape.)
   - **A chicane** by the pool, a nod to Monaco's.
   - **The Sand** (the cut): across the beach instead of the road's curve along it, on packed
     sand by the waterline (PARADISE's Sandbar idea, `beach` through the loose `sand`).
8. **The Promenade**: home along the seafront, palms and lamp posts, back onto the quay and the
   line.

## Routes by difficulty and danger

| Where | The road | The cut (rough, slower ground) | The risky line |
| --- | --- | --- | --- |
| The harbour mouth | The bridge, when it's down | The Basin Road, when it's up | Jumping the rising leaf |
| The Old Town | The switchbacks | Through the arcade | The Stairs |
| Lighthouse Point | The hairpin round it | The Rocks | (none) |
| The Beach | The road along it | The Sand | (none) |

As on Paradise Open, each risky line has to add up honestly:
- **Clean,** it saves real time (2–4 s).
- **Fluffed,** it costs more than the road would have (a wreck, about 4–6 s).
- **Taken slowly** to be safe, it saves nothing.

The lap report measures each one.

## The drawbridge

This is CALDERA's step 4, built here. CALDERA has the engine side: what a moving piece is, what it
touches, and the rules to keep. This section is what it should be like to drive.

**What it is** (as built, step 3): **two leaves** over the harbour's middle, 30 m each, each
hinged at its own end and meeting in the middle, like Tower Bridge. (The first sketch had one leaf
hinged at the far end: rising, it would have put its edge in your face, not a ramp under you. Two
leaves make the jump: off the near one's tip and down onto the far one.) Towers and a
counterweight stand at each hinge, and the fixed deck runs on either side.
Its angle is a pure function of the race clock and the seed: World authority, the same on every
screen, nothing sent online.

**Its cycle** (numbers to tune). It lifts **once or twice a race** (the owner), so a lift is an
event, not a nuisance:
- **Down** the rest of the time.
- **Warning** (about 4 s): bells, flashing red lights and barrier arms coming down at both ends.
  The arms are drawn only: a car goes through them.
- **Lifting** (about 6 s): the leaf rises from flat to about 70°.
- **Up** (about 8 s): a boat passes under it, a yacht or a tug. The boat is drawn only, and timed
  from the same clock.
- **Lowering** (about 6 s), then down again.

The lift times are drawn from the seed's stream at the start: the first one is never in lap 1's
opening seconds, and the two are at least a lap apart. So two races don't lift at the same moment,
and the leaf's angle at t is still a closed-form function of t and those times. A countdown is
possible later (a light on the tower that changes a lap ahead), so a sharp driver plans for it.

**What a car feels:**
- **On it while it lifts:** it rides the leaf up. A car that's quick enough off the lip flies the
  gap, and a slow one rolls back, or off the lip into the water (a respawn).
- **Arriving while it's up:** the leaf stands as a wall. Hitting it bounces you, the road walls'
  way.
- **The jump** (in from the start, the owner): in the first couple of seconds of a lift, the
  near leaf is a ramp of 5–20°. Off its tip you fly over the gap and land on the far leaf or the
  deck past it (about a second in the air, every class, measured). Past the wall angle (30°) the
  leaf is a wall: driven into fast, a wreck.
- **Lowering:** the leaf comes down toward the road. Until it's almost flat, the gap is still
  there.

**The detour:** the Basin Road is always open. It's slow enough that a clean bridge beats it by a
few seconds, and fast enough that a lift doesn't ruin a race.

**The AI:**
- It reads the schedule (it's a function of t, so it knows ahead).
- A hard AI that will arrive early in a lift jumps it.
- Otherwise it takes the Basin Road.
- Nobody plans to arrive while the leaf is high.

**Online:** nothing to send. The pose is a function of t, so a late joiner sees the same bridge.

**Tests:**
- the leaf's pose at a few t (fingerprinted);
- a car riding it up;
- a car jumping it early in a lift, and a car falling short late in one;
- a car hitting the raised leaf;
- the AI taking the detour;
- the probe and drive tools at a chosen `--t`.

**Starting simpler:** step 3's first PR is the leaves, their cycle, the physics, the AI waiting
or jumping, and a plain look (towers, arms, red lights). The detour, the bells and the boat came
next (step 3b, below).

## What else it uses from Caldera

The engine already has most of what the lap needs. Coastal mostly arranges it:

- **Open ground on a lap** and **the sea as the edge** (Paradise Open), with no walls round the
  lap.
- **Pieces:** the drawbridge's approach spans, and the Rock Tunnel.
- **Indoors** (3a): the Rock Tunnel, and the arcade.
- **Breakable walls** (3b): café glass, and maybe market stalls and a stack of crates on the quay.
- **Buildings** (3c): the arcade on the Old Town's switchback. Maybe a boathouse on the beach.
- **Features** (2a–2d): `coast`, `beach` and `uneven` (on the Stairs and the Rocks). A `cliffs`
  feature may be new: sheer drops on the Descent and down to the sea, rock faces drawn.
- **Surfaces:** tarmac; `beach` and `sand`; rock for the point. **Cobbles** may be new (grippy and
  rough, like `lava-rock` but drawn as setts).
- **Traffic** on the Quay and the Promenade (never through the fast bends: MAPS.md's rule),
  coming and going by side streets (below).

**New, beyond the drawbridge:**
- **A riviera palette:** blue skies, sharp sun, and a deep blue sea that's turquoise in the
  shallows. Its weather is clear, with a sunset, and a **rare shower** (the owner): the streets
  and the cobbles wet and shiny, then the sun back out.
- **Traffic from side streets** (the owner): today a traffic car fades in and out (dithered) over
  `FADE` metres at its lane's section ends, on the main road itself, so it seems to pop. On
  Coastal the town has short side streets off the Quay, the Promenade and the Old Town. A traffic
  car comes down one, turns onto the main road, drives its section and turns off up another.
  Its fade happens up the side street, out of sight behind the houses.
  - **Still closed-form:** a lane becomes a fixed route (in by one street, along part of the main
    road, out by another), and a car's place on it is a function of the seed and t, as now. It
    keeps its spacing, so nobody overtakes. Nothing is sent online.
  - **Turning across the other lane:** cars only turn in and out on their own side, so no turn
    crosses oncoming traffic.
  - **The side streets are roads** (short branches, not shortcuts): drawn, driveable a little way,
    blocked off by houses or bollards at the far end. Their walls are gapped, as for any branch on
    open ground.
  - **Engine work:** `core/world/traffic.ts` places cars on the main spline only. A lane needs a
    route over more than one spline. That's a step towards CALDERA's road graph, so it's worth
    doing there first.
- **The town on a hill:** houses stacked up a slope, terraced, with red tile roofs. The greybox
  skin's houses stand on flat ground today. Stepped plots or a retaining wall per house may be
  needed.
- **Boats:** moored yachts (props, solid on the jetties), and the boat that passes the bridge
  (drawn only).
- **The lighthouse:** a white tower with a lantern, and at sunset a beam that sweeps (light only,
  local).

## The look and the sound

- **Colours:**
  - stone, ochre, terracotta and white for the town;
  - white yachts with navy and teak;
  - dark green umbrella pines and cypresses;
  - a few palms on the promenade;
  - striped beach umbrellas.
- **Light:** high sun, crisp shadows, the sea glittering. The sunset turns the town gold.
- **Little touches to pick from:**
  - gulls lifting off the quay as you pass;
  - a fountain in the plaza;
  - bunting across the Old Town's lanes;
  - a café's chairs scattering (smashables);
  - a seaplane on the water;
  - a striped lighthouse keeper's hut.
- **Music:** `coastal` (the owner's track, already on the CDN), with `forward` as its second.

## How to work on it

- **The generator** is `tools/gen-coastal.ts`, writing `content/maps/coastal/`. Everything is
  placed in world space: nodes for the road's corners, with the headland, the harbour and the
  beach as shapes in x and z. Nothing is placed by distance along the main road.
- **It stays experimental** until the owner says otherwise. Open it with
  `?mode=free&map=coastal/riviera`.
- **Fingerprints:** Coastal's entry is re-recorded freely in a Coastal PR (say so in the PR). Every
  other map's must say identical, or the PR explains why.
- **No lap floor to hold yet.** The first PR records one with `lap-report`. After that it's tracked
  like the others, but it can move when the owner agrees.
- **The tools:** `drive --at x,z --heading deg` on the bridge, `probe` for what's under a point,
  `shot` for the look (the drawbridge at a few t once `--t` exists), and `bun run test`.
- **Watch for this:** a new branch on open ground keeps invisible road walls unless the generator
  gaps them (the market hall's street had them).

## Steps, one PR each

1. **The plan** (this doc).
2. **The greybox lap:** the headland, the harbour and the beach as ground; the road and its
   corners; the sea; start and checkpoints. The bridge is a fixed deck for now, and the tunnel
   is plain. Experimental, fingerprinted, with an AI lap and a first floor. The aim is to drive
   it and say whether the shape is right.
3. **The drawbridge** (CALDERA's step 4): the moving leaf, its cycle and the physics, then the
   detour, the AI, and the bells and the boat.
4. **Traffic from side streets:** the side streets as short roads, traffic lanes as routes over
   them and the main road, and the fade moved out of sight.
5. **The Rock Tunnel and the Descent:** the tunnel (the main road's ceilings, built with step 3's
   gaps), its indoor look, and the Descent's rock faces and parapets.
6. **The town:** the Old Town's houses on the hill, the plaza, the arcade, the café glass.
7. **The cuts:** the Stairs, the Rocks, the Sand, each measured.
8. **The look:** the riviera palette, yachts, the lighthouse, the beach club, the rare shower,
   music.
9. **Into the lobby** when the owner's happy: experimental off, a poster, a CHANGELOG line.

The drawbridge comes right after the greybox lap, because it's why the map exists now. The town
and the look can wait.

## Built so far

**Step 2, the greybox lap (2026-10-04):** `tools/gen-coastal.ts` writes `coastal/riviera`. It's
experimental, so open it with `?mode=free&map=coastal/riviera`.
- **The lap:** 3.96 km, laid out from corner nodes in world space: the Quay, the Harbour Bridge,
  the Old Town's four switchbacks up to 43 m, the Mountain Road's S-bends up to 95 m, the Descent,
  the cliffs down to the Lighthouse Point hairpin, the Beach and its chicane, and the Promenade.
- **The Descent** (`DESCENT` in the generator): three rows across the mountainside, 210 m long
  and 55 m apart, each 22 m lower than the last, joined by hairpins of two 24 m corners. Between
  rows the ground falls about 22 m over 30 m. Off the west end it's a cliff to the sea.
- **The first version** (2026-10-04, 3.49 km, 64.78 s) ran along the hillside at 46 m in one
  650 m near-straight, then a gentle corniche down the cliffs. The owner: too linear there; a
  Bond-style descent, and a rock tunnel.
- **The land:** the coast is one loop with a notch for the harbour, 170 m wide and 200 m deep
  inland, about 8 m of water in its middle. (A 70 m channel was a sandy creek: the coast is
  smoothed, and the sea only gets deep well out from it.) The
  town's hill, the mountain, the spur and the hills behind are **`GroundDef.hills`**, a new feature
  (`core/track/features/hills.ts`): round domes off the roads, cut back to the main road over
  40 m (as the volcano is), shaped before the coast so the land still falls into the sea.
- **The Harbour Bridge** is a deck on the main road (a piece with `under`: the ground falls to
  6 m under the sea beneath it), 7 m over the water, with rails. It's fixed for now.
- **The Rock Tunnel is a cutting** for now (`TUNNEL` in the generator, about 1930–2150 m, through
  the spur): the main road takes no ceiling yet (below).
- **Weather:** `rare` in `map.json`'s weather (new, `world/weather.ts`): a shower about one race
  in seven, where Paradise's list has one in more than two.
- **Music:** `coastal`, then the tracks for any map.
- **Numbers:** floor 76.33 s (the best AI lap, solo hard coupe), top speed 220 km/h. The field:
  no wrecks (there's no traffic and nothing to hit yet). Every other map's fingerprints are
  identical.
- **The look is borrowed:** Paradise's `tropic` palette and its palms and jungle trees. The
  riviera look is step 8.

**The lap reworked (2026-10-05):** the owner, after driving it: not a solid race track yet, parts too
linear; the cliff should be several long winding switchbacks, and the top should wind like an S and
climb more. Now 5.0 km (from 3.96), top 130 m (from 95):
- **The Mountain Road** is five S-bends, each about 110° the other way, climbing at about 8% from
  the Old Town (27 m) to the top of the mountain, through the spur (`TUNNEL`, about 1320–1570 m).
- **The Descent** is five rows across the mountainside (`DESCENT`), 255 m long and 100 m apart,
  each bowed 18 m along the contour so it's a bend each way, not a straight; 24 m lower a row,
  joined by hairpins of two 28 m corners. It replaces the old three short rows and the 500 m
  straight down the west cliffs.
- **The Corniche** is what's left of the cliffs: a bend each way down to Lighthouse Point, which
  moved 180 m north (the coast with it) to keep the lap shorter. The west coast is jagged now
  (headlands and coves), 70–150 m off the road.
- **The Old Town** is a bend each way (it was four switchbacks), since the S does the climbing.
- **`tools/plan.ts`** (new) draws a layout from above: the ground shaded by height, the sea, the
  roads coloured by height, the pieces, and a mark every 250 m. It's how the shape was laid out.
- **Numbers:** floor 98.70 s (from 76.33; a race of three laps is about five minutes). The field
  over four seeds: no wrecks. Every other map's fingerprints identical.

**What the engine can't do yet** (it shapes step 5): on the main road a piece is a deck only.
Ceilings are on branches only (PieceDef's doc), because there the ground is the road's own. The
Rock Tunnel wants one on the main road: under it, the ground stays the hill's over the road.
(The drawbridge didn't need a main-road gap after all: its leaves are part of the bridge's deck,
and past their tips the floor query has none, so the water under the deck, `under`, is what's
there.)

**Step 3, the drawbridge (2026-10-04):** `PieceDef.lift` (a `LiftDef`) on the Harbour Bridge's
deck, `core/world/lifts.ts`.
- **Its times:** from the seed's own stream (`lift:<piece>`): the first warning 45–110 s after
  the race's green (`RaceState.goTime`; the sim's own clock started 30 s before green online, 4 s
  offline), a second 80–130 s after it in half of races. Each cycle: a 4 s warning, rising to 1.2 rad (69°)
  over 6 s (smoothstep), up 8 s, down over 6 s. Its angle is a pure function of those and the
  race clock: nothing sent online, nothing in snapshots.
- **The floor:** each tick, before the cars step, the sim sets each leaf's angle on the ground
  (`Ground.setLift`), and the floor query tilts the deck's plane about each hinge: up to the wall
  angle (0.52 rad, 30°), a ramp; past each tip, nothing (the water). Steeper, no floor at all.
  The physics needed nothing new: a car follows a floor that rises less than a metre a tick.
- **The wall:** past 30°, `collide/lifts.ts` bounces a car off the leaf at its hinge, as a road's
  wall does (a wreck if fast).
- **The AI:** it knows the angle ahead. If the bridge will be down when it gets there and while it
  crosses, on; a hard driver also jumps it at 28 m/s or more if the leaf will be at 0.33 rad or
  less, unless a car is waiting ahead of it (hard drivers went for the leaf as it came down, into
  the cars still waiting); otherwise it brakes (8 m/s², gently, so the cars behind don't run into
  it) to stop 8 m short and waits there, as does a car slowed in the queue behind it. Too close to
  stop, with it still down when it gets there, it goes on across; on the span already, on.
  Waiting, it brakes only while it still rolls forward: held at a standstill, the brake is reverse,
  and cars backed out of the queue into the ones behind (most of the review's queue wrecks).
- **Respawns:** on it or within 40 m before it while it's lifting or up, a respawn is 60 m back
  on the approach (past a respawn's 1.5 s ghost run at 22 m/s; a ghost bounces off a raised leaf
  too, without a wreck).
- **The look:** the leaves (road lines, red and white bands at their tips), towers with a gantry
  and counterweights, barrier arms that drop, and red lights that flash from the warning until
  it's down. The deck's road stops at the hinges.
- **Tools:** `drive`'s `t` option and `shot --t` show the world at a race time. The fingerprint
  has a `lifts` part, only for a layout with one: times for three seeds, angles through a cycle,
  the leaves' floors at five angles, and the hard AI driven at it from 150 m as a lift starts and
  halfway up (a jump, a wait), every field every tick.
- **Numbers:** floor 76.33 s (the solo lap misses the lifts on its seed). The field over 16 seeds: one wreck at the bridge, a nudge (5 m/s) as a queue moved off.
  Every other map's fingerprints are identical.
- **Known rough edges:** a car crawling up a leaf as it passes 30° loses its floor and falls in
  (the AI never does; a respawn puts you back on the approach). The boat, the bells and the Basin
  Road detour came in step 3b.

**Step 3b, the drawbridge's rest (2026-10-05):**
- **The Basin Road** (`BASIN` in the generator; branch `basin-road`, `kind: 'alternate'`, the
  first): round the inner harbour, always open. It leaves the Quay to the left 220 m before the
  bridge, runs up the harbour's west side, round its head by the fish market in one long bend and
  down the east side onto the far quay: 636 m for the main road's 437, 11 m wide, rising 4 m round
  the head (the land behind is cut into a bank). Round it is about 5.5 s slower than a clear bridge.
  The validator's "longer than what it skips" warning is for shortcuts only now.
- **The AI goes round when the bridge would stop it**, and only then: at the turn it asks the same
  question as at the bridge (down when it gets there and while it crosses, or for a hard driver
  low enough to jump with nobody waiting), and again 2 s later: a bridge down by then is quicker
  to slow for (the review; swept over a lift's start times, it takes the quicker way at every
  one). On the Basin Road the bridge isn't its business; past the turn, it waits as before. The
  field over 16 seeds: no wrecks (one nudge before).
- **The validator:** a boat wants a mooring either side of the road, and a second lift no sooner
  than the boat's across.
- **Known rough edges:** at either end of the Basin Road, a car in the main road's left lane is
  read as on the branch for a few ticks (the branch overlaps that lane, and a car's road is the
  one it's more inside: `locate.ts`, every fork's way). It cost nothing in the sweeps. A car
  respawned just past the turn while the bridge is up picks the detour too late and waits.
- **The bells:** from the warning till it's down, a two-tone ring twice a second through the
  warning and once a second after, from the bridge's middle, heard within about 70 m at half
  volume (the audio; nothing in the sim).
- **The boat** (`LiftDef.boat`, drawn only): a motor yacht moored at the harbour's head
  (`boat[0]`, 125 m left of the road) that sails out under the leaves in the first lift, under the
  road halfway through their time up, to a mooring 120 m out at sea (`boat[1]`); a second lift
  brings it back in. Its place is a pure function of the lift times (`boatAt`, core/world/lifts.ts).
- **Fixed:** `shot --t` was refused as an unknown flag (read after the layout's name).
- **Numbers:** floor 98.70 s (the solo lap's seed doesn't lift). Every other map's fingerprints
  identical.

**Step 4, traffic from side streets (2026-10-05):** the owner's ask, so traffic doesn't pop in and
out on the main road.
- **The engine:** a traffic lane may give `streets` (TrafficLaneDef) instead of `sections`: side
  streets, branches of a new kind `street` (a loop off the main road and back; open to drive, the
  AI never takes one). Each pair of a lane's streets is a route (`trafficLanes`,
  core/world/traffic.ts): a car comes up the far half of the first, drives the main road between
  them, and turns off up the near half of the next. Round its route and a 60 m stretch out of
  sight, it fades in and out over 20 m at the streets' middles, and is blended from street to main
  road over 24 m (`JOIN`). Still a formula of the seed and the race time; still no overtaking.
  Main-road lanes run exactly the code they did (every other map's fingerprints identical).
- **No turn across the other lane:** a lane's streets are on its own side (the validator checks:
  streets, on the lane's side, long enough to fade before the join, passed in order).
- **What reads traffic:** the posed pool's `s` is a main distance on a street too (its
  `mainDistance`) and `lat` is across the main road, so collisions, near misses and the AI keep
  working; a new `along` is its speed along the main road. The AI reckons a car on its way in from a
  street already in its lane (`seenS`, `seenLat`): a driver sees a car about to pull out. Hazards and
  the wreck debris use the car's pose.
- **Coastal's streets:** round the line on the home straight, which runs from the end of the
  Promenade onto the Quay: the lido's car park (4775–4895 m) and the harbour's (`quai-sud`, 30–150 m)
  on the sea side for the lap's way, two town streets opposite for the other. 140 m of main road
  between them (two cars a route, four in all), across the line (the grid's clear zone keeps the start clear; with an oncoming lane
  at the line, the grid lines up in the race's half, as on Downtown).
- **What it took:** first on the Promenade's two straights, then across its 24° kink, the field had
  3–7 wrecks a race there: two-way traffic on a 16 m road, the AI's line cut into the oncoming lane
  and, boxed in, braked instead of moving over (lighter traffic or a gentler bend didn't help; it
  isn't the streets: plain sections did the same). MAPS.md's rule (no traffic through fast bends)
  and a wider home straight (20 m, the `H` node) did: the field over 16 seeds, 3 traffic wrecks and
  one between cars.
- **From the review:** a car's main distance is its pose's through the blend at a street's mouth
  (`sAt` and the pool disagreed by up to 1.7 m there, and a near miss flipped and paid out every
  tick, up to nine times a pass); a wrecked car by streets stays gone until it next comes up a
  street (back where it was hit was the pop this removes); a log truck by streets drops no logs;
  the editor draws a lane by streets' main stretch; the validator judges a street's side by its
  lane's (`pos`).
- **The Old Town's** streets come with its houses (step 6): its road bends too much between them for
  a loop beside it.
- **Tools:** `shot --traffic` shows it (the poster stage's sim had none). The fingerprint has a
  `streets` part, only for a layout with a lane by streets: every car's pose and visibility over
  two minutes for three seeds.
- **Numbers:** floor 98.60 s. Every other map's fingerprints identical.

**Step 5a, the Rock Tunnel (2026-10-05):** the main road takes a ceiling (CALDERA: an enclosed
piece on the main road, which was branches-only).
- **The engine:** over a main-road tunnel the land isn't brought down to the road: its rock is kept,
  at least `ceiling` + 4 m over the road across it and 3 m past its verge, falling away at 45°,
  under whatever's there (the hills aren't cut back over it: `ShapePoint.rock`). It starts 4 m in
  from each end, so its face stands inside the tunnel's outline where the drawing cuts the ground
  (at the very end, the face fell a grid cell short of the cut: a wall across the mouth). The cast
  needed nothing new: a floor under the ground by more than a hard landing was already a tunnel's.
  The ground over it is rock, not road (`groundKinds`), and its mouths are marked like a branch
  tunnel's (no trees). **Mind:** `top(x, z)` with no height is from the sky: over a main-road tunnel
  that's the rock's top, so anything placed by it (props, slalom gates, `drive`'s x/z spots) must
  pass the road's height (`top(x, z, roadY + 1)`). The validator wants a main tunnel 20 m or more,
  not across the lap's start. The validator allows a ceiling on the main road (gaps and buildings stay on
  branches).
- **The drawing:** the tube (walls, vault, arches, portals cut to its outline) for a main-road
  tunnel too, its road and verge in it (the island's road is draped over the ground, and there's
  none at its height in there); limestone and orange lamps high on its walls for `indoor: 'tunnel'`
  (the Lava Tube keeps its black rock and lava); no deck pillars under it; the road's lines on its
  own floor, not on the rock over it; its road isn't drawn as a deck too (the review: a concrete
  bridge's verge and barriers showed in the tube).
- **Coastal's:** through the spur on the Mountain Road, 1321–1521 m (200 m), 7.5 m high, wherever
  the spur's rock stands 18 m or more over the road (`TUNNEL` in the generator); the spur is three
  domes along the road now (one dome stood over only 80 m of it). Its walls are solid (the rest of
  the island's open).
- **Numbers:** floor 97.73 s. Field over 8 seeds: no wrecks in or near it. Every other map's
  fingerprints identical.

**Step 5b, rock rails (2026-10-05):** the owner, looking at the minimap's switchbacks: rails on the
tight corners up top, rock-themed.
- **Where:** a stone parapet on the outside of every corner tighter than 110 m from the middle of the
  Old Town to Lighthouse Point, 15 m on past each end (`RAILS` in the generator, found from the baked
  road's curvature): the S-bends, every hairpin of the Descent (alternate sides, row by row), the
  Corniche's bends, the lighthouse hairpin. The straights between stay open, so running wide off a
  row still drops you onto the one below (the owner's earlier "chances to fly off"); the inside of
  each corner is open too.
- **The engine:** they're the road's own walls, kept there (every other wall on the island is
  gapped); nothing new in the sim.
- **The drawing** (`render/skins/greybox/rails.ts`): a draped road's walls were never drawn (only a
  built road's chunks draw walls). Now, on a coast map, wherever the main road has a wall off a deck,
  limestone blocks along the wall's line, 2.1 m each with a joint, their tops following the road.
  Paradise Open has no such walls, so nothing changes there.
- **Numbers:** floor 97.73 s (the AI's line was inside them already). The field over 8 seeds: no
  more wrecks than before. Every other map's fingerprints identical.

**Step 6a, the Riviera waterfront (2026-10-05):** the owner, with a photo of Villefranche-sur-Mer:
the town more Riviera, Mediterranean; the downtown streets four lanes, the waterfront one side and
colourful buildings the other.
- **The boulevard:** the home straight (the end of the Promenade, along the Quay to the harbour) is
  four lanes on 20 m (`TrackPoint.lanes`; the lap's `Node.lanes`), a double yellow down the middle
  and white dashes between each way's two. Its traffic keeps to the outer lanes (`pos` ±0.7), the
  middle two for racing. (At 22 m the grid's outer column stood 7.9 m out and cut across the car
  behind at the green, every seed: 20 m doesn't.)
- **Houses** (`TrackLayout.houses`, new: world-space footprints with a height): solid blocks in
  the sim (baked as props met like a building's wall, on the lowest ground under their corners, so
  a slope leaves no gap under them), trees keep off them, and the validator keeps every road clear
  of them. Drawn (`render/skins/greybox/houses.ts`) in stucco ochre, salmon, rose, cream and
  yellow, tall green-shuttered windows, shopfronts on the ground floor, under low terracotta
  roofs.
- **Coastal's town** (`TOWN` in the generator): 295 houses, terraced five rows deep up the hill on
  the town side of the boulevard, and three deep both sides of the Old Town's climb, each facing
  the road, 5 m back (a pavement) and clear of every road (the side streets and the Basin Road
  too), the water and each other. The sea side is the sea's: the beach and its palms (since step
  6b, the sea wall).
- **From the review:** the chase camera pulls in from a house as from a building's wall (spun
  or reversed against one, it ended up inside); the validator checks the middles of a house's walls
  too. Its roof has no collider (only its walls, to the eaves): nothing near the town flies that high.
- **Numbers:** floor 97.83 s. The field over 8 seeds: 2 wrecks, between cars, away from the
  town. Every other map's fingerprints identical.

**Step 6b, the sea wall (2026-10-05):** the owner, with the photo of Villefranche again: along the
bottom of the map, the right side just water, not beach, with a retaining wall.
- **A `seawall` feature** (`GroundDef.features`, `core/track/features/seawall.ts`): off one side of
  the main road over a stretch, the ground keeps its height to a quay's edge `SEAWALL_LEDGE`
  (3.75 m) past the verge and drops past it to `floor` (here 10 m under the sea), easing back to
  the coast's sea bed 40 m out. The ledge is a grid cell's diagonal (cells of 2.5 m; the validator
  insists): dropping at the verge tilted the last cell, and the shoulder sagged up to 5 m.
- **Drawn** (`render/skins/greybox/rails.ts`): the parapet as on the rock rails, then a paved
  ledge to the sea face `SEAWALL_FACE` (a metre past the drop, so the slope across the drop's cell
  stays behind it: it showed as dark notches at the wall's foot) and the face down to the floor.
- **Coastal** (`SEAWALL` in the generator): from the lighthouse hairpin's way out, through the
  line, to the bridge's deck (4.5 km of the lap to 0.28), a wall on the right all along and the
  coast following the sea face. The lido's and the harbour's sea-side streets went with the beach,
  so the traffic is one lane, against the lap on the town side. With those streets gone the town
  has 467 houses (295): the houses' road check measured across a street from past its end, and
  the sea-side streets' ends kept about 170 spots across the boulevard empty.
- **Pavements:** the waterfront's verges are `sidewalk` (from the hairpin's corner round to the
  Quay, both sides), not grass: between the road and the wall, and in front of the houses.
- **Numbers:** floor 97.83 s (unchanged). The field over 8 seeds: no wrecks. Every other map's
  fingerprints identical. Tests: `test/seawall.test.ts` (the shoulder as it was without it, water
  past the ledge for 40 m, the town's land kept, the validator).

**Step 7a, the Old Town's switchbacks and the Stairs (2026-10-05):** the first of the cuts.
- **Why the Old Town changed:** it was a gentle zig-zag, taken at 150 to 270 km/h on the AI's line
  (380 m in 6.8 s), so no cut up it could be shorter than the road. The owner chose to tighten it
  into real switchbacks, as the sketch says ("narrow", between the houses).
- **The switchbacks** (`OLD_TOWN` in the generator): off the far quay's climb, three rows across
  the slope, 150 m long (x 345 to 495) and 66 m apart, each 7 m higher. They're joined by two
  hairpins of two 14 m corners each, the first at the west end and the second at the east. Then
  up to the foot of the S as before. The lap is 5.30 km (5.00).
- **The Stairs** (`STAIRS`): stone steps, 7 m wide, on `sidewalk` (it grips 0.9), their corners
  rounded. Their own heights (`heights: 'own'`) climb with a 0.25 m lip every 4 m, so the steps
  aren't smoothed away. Houses line them closely (`TOWN.stairs`, a metre off their verge, the
  validator's least), so running off them means hitting a wall. They're placed before the town's
  rows, packed in wherever they fit. At 6 m wide, the AI hit those walls at the corners.
  - **`stairs`:** off the climb from the quay, straight up to the second row, skipping the first
    hairpin.
  - **`stairs-top`:** from there across the second row and on up to the third, skipping the
    second hairpin. It leaves the second row half a metre from where `stairs` meets it, so the
    graph has one node there: the crossroads.
  - **`stairs-arm`:** forks off halfway up the first flight (where it's halfway between the rows,
    on the flight as baked) and goes across the slope onto the second row further along. It's a
    lane off a branch (CALDERA 6e), the gentler way out.
- **`BranchDef.limit`** (new, in the engine): the fastest the AI takes a road, a cap on its racing
  line, so `wayCosts` reckons it as driven. Without it the AI went up the Stairs at 100 to 130 km/h
  (its line saw only their curves) and wrecked at the crossroads every time. The Stairs' limit is
  24 m/s (86 km/h); at 26 m/s it clipped a wall on most runs.
- **The AI on a lane** (#126's review): choosing a street, the AI follows it from where it starts on
  its road (`st.s0`). A lane's stretch of a branch starts partway along, so following from 0 aimed
  it back down the flight whenever the fork's flicker read it as on the arm.
- **Numbers** (hard coupe, quay to the top of the town, 12.87 s by the road):

  | How the Stairs were taken | Time | Against the road |
  | --- | --- | --- |
  | Both flights, at the limit | 9.82 s | 3.05 s quicker |
  | The first flight, then the second row | 10.60 s | 2.27 s quicker |
  | Only the second flight, turning up off the row | 14.65 s | 1.8 s slower (it clips the walls) |
  | Flat out (no limit) | — | a wreck at the crossroads |
  | Slowly (14 m/s) | — | not worth taking: the AI keeps to the road |

  Across classes (coupe, muscle, van, bus) and difficulties, a clean run saves 2.2 to 3.9 s;
  some clip a wall and save less, or lose time. The floor is 103.63 s: 97.98 before, and 106.28
  with the switchbacks but no Stairs. Field races (seeds 7 to 9) have no more than one wreck
  each. Every other map's fingerprints are identical. Tests are in `test/coastal.test.ts`: the
  crossroads and the lane, the steps and the walls, the limit, the AI on the arm, and 2 to 4 s
  saved clean with no wreck.
- **Rough edges:**
  - The AI never takes the arm. At the fork it costs the rest of the flight as if the second
    flight follows, which is its own roll.
  - Turning up the second flight off the row, the AI comes in too fast for the crossroads: its
    costs see the flight's limit, not the turn into it.
  - The houses beside the Stairs move with any change to them (width, corners), and the times
    with the houses, so re-measure after one.
- **Next for the cuts:** the Rocks at Lighthouse Point (below), and the Sand (which needs a new home).

**Step 7b, Lighthouse Point and the Rocks (2026-10-05):** the second cut.
- **The loop round the cape** (`POINT` in the generator). Lighthouse Point was a single left-hander
  taken at about 135 km/h, so a cut had nothing to skip. Now the road runs out to the cape's west
  side, round its tip (two 16 m corners) and back east along the shore, as the sketch's "hairpin
  round the lighthouse". The cape's coast is pushed out round it, and the sea wall starts at the
  tip's exit (a hard bus ran wide there into the sea). The lighthouse's spot is inside the loop
  (`POINT.light`); it's drawn in the landmarks step. The lap is 5.51 km (5.30).
- **The Rocks** (`ROCKS`): straight across the loop's neck, 195 m against the loop's 379, 7 m wide,
  their corners rounded.
  - A new surface, `rock` (grip 0.74, drag 0.12, grey).
  - Their own heights: rough, up to 0.3 m, and three 1.2 m ridges across them.
  - Boulders (`rock` props, solid; drawn with limestone tops on a coast) line both sides close
    in, every 5 to 9 m. None stands within reach of another road: by their ends the Rocks run
    beside the main road, and boulders there wrecked the field.
  - `limit` 36 m/s (130 km/h) for the AI.
- **Why it took tuning:** cars corner hard here, so a tighter road costs little and a cut pays only
  by being much shorter. The loop had to grow, the Rocks' limit rise (at 24 m/s the AI never took
  them: its costs, the racing line without acceleration, make short straights look quicker than
  they are), and the risk is the boulders: ridges alone threw no one into anything.
- **Numbers** (from the Corniche to past the loop, 10.4 to 11.6 s by the road; hard AI, every
  class):
  - At the limit, the Rocks save 2.3 to 3.5 s, clean, for all eight classes. (A ridge on the
    bend onto the shore road threw the van wide into the boulders every time, #128's review: the
    last ridge is off the bend now.)
  - Flat out (no limit), five of the eight wreck in the boulders and gain little (0.1 to 1.1 s);
    the other three save about 3.5 s.
  - The floor is 105.58 s (103.63). Field races (seeds 4, 7, 8): no wrecks.
  - Every other map's fingerprints are identical. Tests are in `test/coastal.test.ts` (the cut,
    the surface, the boulders, 2 to 4 s at the limit for every class, and most wreck flat out).
  - The town's stretch along the waterfront starts on the shore road past the Rocks (`sAt`), not
    at a fixed distance before the line, so no houses stand by the Rocks.
- **Rough edges:** the risk depends on exactly where a car meets the ridges, so a change to the
  Rocks reshuffles who wrecks; re-measure after one. A wreck here respawns you quickly, so a
  fluffed run costs little more than the road.

**Step 8a, landmarks (2026-10-05):** the owner's asks, after the Rocks: the first gap in the
town a grand casino, the lighthouse seen coming down the switchbacks, and something on the
mountain's top ("a little empty up there").
- **The grand casino** (`CASINO`): Monte Carlo's, on the boulevard just past the line, in the
  square rue-du-port loops round. A street now takes its own depth and lead-in, and rue-du-port
  runs out 66 m and nearly straight, so the square is about 39 m across. The casino is a house
  with `look: 'casino'` (solid, placed before the town's rows), drawn by `houses.ts`: a cream hall
  with arched windows, a copper dome on a drum, a copper-spired tower at each front corner, and a
  six-column portico with a gilded clock. In front there's a garden with Downtown's fountain
  (small, radius 4), kept clear of houses.
- **The lighthouse** (landmark `lighthouse`): white and red bands on a limestone base, the
  lantern, a red cap and a slow sweeping beam. It's on a knoll (a small hill) inside Lighthouse
  Point's loop, scaled 1.5 (about 45 m to the lantern), so it shows from the Descent's west
  hairpins and stands tall coming down the Corniche.
- **The fort** (landmark `fort`; Villefranche's Fort du Mont Alban): limestone curtain walls round
  a 56 m square with crenellations, a diamond bastion at each corner, a keep and a red flag. It's
  on the highest ground near the mountain over the Descent (about 190 m), seen from the top of the
  Mountain Road.
- **Trees keep off a landmark's ground** (`pines.ts`: its `r`), so none grow through the fort or
  the lighthouse. Every other map's fingerprints are identical (their landmarks have no pines on
  open ground).
- **Numbers:** the floor is unchanged at 105.58 s; no wrecks in a field race. Tests are in
  `test/coastal.test.ts` (the casino's block, its facing and garden; the lighthouse and the fort on
  the summit, with no trees on either).

**Step 8b, a clean-up (2026-10-05):** the owner's notes from a drive, and #129's review.
- **The Rock Tunnel threw cars onto the hill over it.** Driving into a mouth at an angle, a car's
  front wheels read the rock over the mouth instead of the tunnel's road (`wheelGround`, off a
  piece, averaged the land under each wheel), so it was thrown 3–6 m up in a tick. In the air it
  then flew over the walls' 1.2 m rails, out into the rock, and landed on the hill 25–37 m up. Off
  the road just before a mouth, a car was also lifted straight up the cliff beside it. Three fixes:
  - A wheel whose land is more than a hard landing over the car reads what's under it at the car's
    height, the tunnel's road, when the car's within the tunnel's ceiling of it (`wheelOff` in
    `physics.ts`; from anywhere over it, cars on the hill sank through the rock into the tunnel).
  - Under a ceiling, a road's walls go all the way up to it (`walls.ts`).
  - Coastal's ground has a rock face at 45° (`face: 1`, as Paradise Open's): steeper ground is a
    wall, not a slope you're lifted up.
  - The ground meets a tunnel's floor at its mouths: the swell eases out over 30 m before them, as
    before a deck (`runIn`). It stood 0.3 m over the road at the exit: a hop, and with rock faces
    a wall across the road at 50–70 km/h.
  A sweep of 720 entries (both mouths, off line, at angles, at 60–180 km/h) used to throw 68 cars up off the road or onto the hill; now none.
- **The casino shimmered:** its towers' sides were in the hall's walls' planes, and the spires'
  bases sat exactly on the towers' tops. The hall is now set back and in, behind a portico
  between the towers, and each spire is sunk into a parapet. The portico is inside the solid
  block, so you can't drive through its columns any more.
- **The fountain** has no painted ring (`params.ring: 0`): it's in a garden, not on a roundabout.
- **The fort** reaches down to the lowest ground under each piece (on the summit's slope, its
  bastions' tips and some wall ends stood 2–4 m clear of it), and keeps trees off as far out as
  it's drawn (`r` 48).
- **rue-du-port** runs straight along the square's back, 72 m out with a 15 m lead-in (it bent with
  the boulevard, and its corners were 8 m or less, tight for traffic; now 10 m or more, tested).
- **Numbers:** the floor is 106.3 s (was 105.58): out of the tunnel at 199 km/h the AI's line is on the
  road's edge, and without the exit's hop it runs a metre wide onto the grass. No wrecks in field
  races at seeds 4, 7 and 8. Every other map's fingerprints are identical. (Paradise Open's Lava
  Tube still lets cars on the volcano sink into it, about one in nine of a sweep, as before: not
  this step's.)

**Step 8c, the hillside and the hills' look (2026-10-05):** the owner's notes: the hills of sand
and grass look odd at a distance, tufts of grass now and then, and rocks, bushes and other
obstacles on the switchbacks' hillside, where you can jump off and cut down.
- **The Descent's hillside** (`HILLSIDE`): between and round its rows, 190 solid limestone rocks
  (props by the main road; you wreck on one) and 352 bushes, a new smashable (`bush`: costs 18% of
  your speed, never wrecks). Bushes are the first smashables on open ground (`SmashDef.at`, world
  spots on the ground): they're met by where they are, not by a car's place along a road, since a
  car cutting down is placed on whichever pass of the road it's nearest. All of them are 4 m or more past
  every road's verge, off the steep banks and the trees, so the AI never meets them. Cutting straight
  down from a row, every car ploughs through bushes and some wreck on a rock; a clean line through is
  still there.
- **The banks between the rows** read as limestone, not sand: beds across the slope and patches,
  with a wandering but sharp edge to the grass (it was one smooth tan smear). The grass has broad
  patches of dry, olive scrub, so a far hillside isn't one green.
- **Grass tufts** (`tufts.ts`): about 21,000 clumps of blades on a coast's grass, off roads,
  pavements, sand and steep ground, drawn in chunks. Scenery only. They write no depth so the
  outline pass doesn't ink them (inked, they were black weeds), and are drawn after everything
  else opaque.
- **Numbers:** the floor is unchanged at 106.3 s (the solo drive's fingerprint too); no wrecks in
  field races at seeds 4, 7 and 8. Every other map's fingerprints are identical.

**Step 8e, the tufts and the tunnel's mouths (2026-10-05):** the owner's notes after a drive.
- **The tufts** looked odd (thin dark blades everywhere): now about 11,000 low clumps in the
  grass's own colour, inked like everything else, in patches here and there rather than all over.
- **A slab across the Rock Tunnel at its exit,** from #131's run-in: the ground in a tunnel's mouth,
  eased to the road's height, was kept by the drawing's cut (it keeps a cutting's floor at the
  road's height) and clipped into a slab rising to the rock over the mouth. In a main-road tunnel
  the ground over its road now stands 0.3 m over it (`MOUTH_CLEAR` in `land.ts`; a car in there is
  on the tunnel's floor), and out of its mouths it meets the road as before. A wheel over a
  main-road tunnel's floor reads that floor (`wheelOff`), so the ground's 0.3 m isn't felt driving
  in. Paradise Open's tubes are branches: unchanged.
- **The dark band across the road at the lower mouth:** the arch's apron of rock (out in front of a
  mouth, 6 cm under the road) showed through where the ground's grid sags between its points. On
  the main road there's no apron now: its ground runs up to the mouth. (A faint line where the
  tube's own road starts, 4 cm up, was there before.)
- **Numbers:** the floor is 106.2 s; field races at seeds 4, 7 and 8 had one wreck between them,
  car on car by the drawbridge. Every other map's fingerprints are identical.

## The owner's answers (2026-10-04)

- **The shape:** the sketch is right (quay, bridge, Old Town, tunnel, corniche, lighthouse, beach,
  promenade). After the first drive: the hillside was too linear; the way down the mountain should
  be Bond-style switchbacks over the sea with chances to fly off; and a rock tunnel somewhere.
- **Side streets for traffic,** so it doesn't pop in and out on the main road (above, "Traffic from
  side streets").
- **The bridge lifts once or twice a race.**
- **Jumping it is in from the start.**
- **The layout is `coastal/riviera`.**
- **Blue skies, and a rare shower.**

## Questions for the owner

None yet. New ones go here as building raises them.
