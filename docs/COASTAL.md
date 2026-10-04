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
mouth on a drawbridge, climbs the old town's switchbacks and dives into a tunnel through the cape.
It comes out on a corniche high over the sea, rounds the lighthouse on the point, drops to the
beach and runs home along the promenade. Every few laps the drawbridge lifts for a boat. Then the
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
   - **When it's up,** you have two choices. The **Basin Road** turns hard inland round the inner
     harbour's head: a hairpin by the fish market, slow and safe. Or you **jump it**: in the first
     seconds of a lift, the leaf is a ramp and the gap is short.
3. **The Old Town**: a climb up the hill in three switchbacks, narrow and cobbled, between ochre
   and pastel houses.
   - **A plaza** with a fountain, round it either way: a roundabout.
   - **An arcade** (a building piece, step 3c's kind): a covered gallery one switchback runs
     through. Its café glass smashes.
   - **The Stairs** (a risky cut): a stepped lane straight up the hill that skips a switchback.
     It's steep, bumpy and narrow; the AI only takes it on a good line.
4. **The Cape Tunnel**: a long, curving tunnel through the headland, lit by orange lamps. It's
   dark inside and bright at the far end, so you come out of it blinking (indoors, step 3a: the
   light, the fog and the echo). It's fast and sweeping, and the wall is close.
5. **The Corniche**: out of the tunnel onto a road cut into the cliff, high over the sea, with a
   stone parapet on the sea side. Long, fast sweepers to drift: the lap's flowing section. Umbrella
   pines lean out over the road.
6. **Lighthouse Point**: a tight hairpin round the lighthouse at the cape's tip, the lap's
   landmark.
   - **The Rocks** (the cut): straight across the flat rocks below the lighthouse instead of round
     it. It's shorter, but the rock is rough and the sea is on both sides.
7. **The Beach**: down off the cape to a beach club, with umbrellas, a pool and a jetty.
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

**What it is:** one leaf over the harbour mouth, about 40 m long, hinged at the far end. A tower
with the counterweight stands at the hinge, and a short fixed approach span sits on each side.
Its angle is a pure function of the race clock and the seed: World authority, the same on every
screen, nothing sent online.

**Its cycle** (numbers to tune):
- **Down** most of the time: about 60–90 s, so most laps find it down and some find it up.
- **Warning** (about 4 s): bells, flashing red lights and barrier arms coming down at both ends.
  The arms are drawn only: a car goes through them.
- **Lifting** (about 6 s): the leaf rises from flat to about 70°.
- **Up** (about 8 s): a boat passes under it, a yacht or a tug. The boat is drawn only, and timed
  from the same clock.
- **Lowering** (about 6 s), then down again.

A seeded phase means two races don't lift at the same moment.

**What a car feels:**
- **On it while it lifts:** it rides the leaf up. A car that's quick enough off the lip flies the
  gap, and a slow one rolls back, or off the lip into the water (a respawn).
- **Arriving while it's up:** the leaf stands as a wall. Hitting it bounces you, the road walls'
  way.
- **The jump:** in the first second or two of a lift, the leaf is a ramp of 10–20° and the gap
  opening past its tip is a few metres. That's catchable at speed, like the Lava Tube's kicker
  (gravity is 24 m/s², so tune it in the sim for every class and a sweep of speeds, not on
  paper). Later in a lift, the gap is too wide and the ramp too steep: a wreck.
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

**Starting simpler:** the first PR can be the leaf, its cycle and the physics, with no AI and a
plain look. The detour, the AI, the bells and the boat come next.

## What else it uses from Caldera

The engine already has most of what the lap needs. Coastal mostly arranges it:

- **Open ground on a lap** and **the sea as the edge** (Paradise Open), with no walls round the
  lap.
- **Pieces:** the drawbridge's approach spans and the corniche's cliff road. The corniche is a
  road on a cut into the slope, or a deck on the cliff where it's sheer.
- **Indoors** (3a): the Cape Tunnel, and the arcade.
- **Breakable walls** (3b): café glass, and maybe market stalls and a stack of crates on the quay.
- **Buildings** (3c): the arcade on the Old Town's switchback. Maybe a boathouse on the beach.
- **Features** (2a–2d): `coast`, `beach` and `uneven` (on the Stairs and the Rocks). A `cliffs`
  feature may be new: a sheer drop from the corniche to the sea, rock faces drawn and solid.
- **Surfaces:** tarmac; `beach` and `sand`; rock for the point. **Cobbles** may be new (grippy and
  rough, like `lava-rock` but drawn as setts).
- **Traffic** on the Quay and the Promenade (never through the fast bends: MAPS.md's rule).

**New, beyond the drawbridge:**
- **A riviera palette:** a blue sky most of the time, sharp sun, and a deep blue sea that's
  turquoise in the shallows. Its weather is clear, with a sunset; maybe a rare shower or a
  sea mist on the point.
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
  `?mode=free&map=coastal/<layout>`.
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
4. **The Cape Tunnel and the corniche:** the indoor look in the tunnel, and the cliff road with
   its parapet and the drop.
5. **The town:** the Old Town's houses on the hill, the plaza, the arcade, the café glass.
6. **The cuts:** the Stairs, the Rocks, the Sand, each measured.
7. **The look:** the riviera palette, yachts, the lighthouse, the beach club, music.
8. **Into the lobby** when the owner's happy: experimental off, a poster, a CHANGELOG line.

The drawbridge comes right after the greybox lap, because it's why the map exists now. The town
and the look can wait.

## Questions for the owner

1. **The shape:** is the sketch above the right lap (quay, bridge, Old Town, tunnel, corniche,
   lighthouse, beach, promenade)? A sketch like Paradise Open's would settle it fastest.
2. **The bridge's cycle:** about one lift a minute, with most laps finding it down? Or rarer and
   bigger: up once or twice a race?
3. **Jumping it:** should the early-lift jump be in from the start, or should the leaf be a wall
   once it's off the ground?
4. **The name:** "Coastal" for the map? Its one layout could be `coastal/harbour` (or `riviera`).
5. **Rain:** blue skies only, or a rare shower like Paradise's?
