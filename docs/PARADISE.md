# Paradise Open: a loose plan for an open island

Paradise again, rebuilt on what Avalanche taught: an island you can drive all of. It keeps the
theme and the places of today's Paradise: the harbour town, the beach, the bridge over the bay,
the jungle, the volcano and its lava. Between them, though, it's a web of routes. Some are fast,
some are slow, and some are risky enough that only the brave or the desperate take them. It should
feel more Hawaii, more open-ended and a little zany.

**It's an outline, not a spec.** The owner's sketch (2026-10-02) is the starting point. Details
will change while building; note them in [SPEC.md](./SPEC.md) under "Changed while building", as
usual. How Avalanche works, and why, is [AVALANCHE.md](./AVALANCHE.md); this plan leans on it
throughout.

## The idea in one paragraph

A lap of the island, clockwise as now: out of Harbor Town, up the coast, over the bay on a
half-moon bridge, down through the mud, past the volcano and home through the burnt lava fields.
Every stretch offers a choice:
- the road, which is fastest to drive;
- a shorter cut over rough ground, which saves distance but costs speed;
- now and then a risky line: a gap to jump, lava to clear, or water to skip across.

None of them is always best. The best line depends on your car, your nerve and what the lava is
doing this lap. The volcano is the centerpiece, and its signature move is a jump clean over the
crater's lava.

## What it keeps, and what goes

**It keeps:**
- **Harbor Town:** pastel houses, the tiki bar, the pier with the fishing boats, and two-way
  traffic.
- **The coast:** palms, the beach, the surf shack, coconuts dropping, and the shipwreck.
- **The bridge over the bay:** the owner likes it.
- **The jungle:** red earth, a rope bridge and a waterfall. Its switchbacks become mud.
- **The volcano:** lava rock, ash, lava running down its far flanks, volcano bombs and lava rain at
  chaos.
- **Passing showers, the sunset and the Hawaiian track.**

**It drops:**
- **The lighthouse,** which is saved for another map (the owner). Lighthouse Point's corners
  become part of the burnt fields' run home.
- **The Lava Tube tunnel:** the ground is one height per point, so a tunnel through it is hard.
  The volcano's routes replace it (see "Hard parts").
- **Walls round the lap.** As on Avalanche, if it's drawn you can drive it. The sea is the edge:
  drive into the shallows, and the deep water is a respawn.

## The sketch, read as a route map

How I read the owner's sketch. Owner, correct me where I've got it wrong. North is up. The lap runs
clockwise: up the west side, across the top, down the east, and back west along the south.

1. **The start and Harbor Town** (west side, low): the grid on the harbour front, then north
   through town on the main road.
2. **The junction north of town** (the blob on the sketch): two ways on to the bridge.
   - **The coast road:** the main road swings east into a deep S, a pocket inland and back, then
     climbs to the bridge's west end.
   - **The beach** (the long dashes up the far west): open sand along the shore, no road at all
     (the owner), shorter but loose, with the water's edge to skirt. It meets the coast road at
     the bridge's west end.
3. **The Elevated Bridge** (across the top): the big arc over the bay from the north-west round to
   the north-east. It's made more of a half moon (the owner): one long, even, banked curve you can
   drift end to end.
4. **The Reef Run** (the red dots inside the bridge's arc), a risky shortcut. From the bridge's
   west end straight across to the mud, on a mix of beach, rocks, grass, palm stands and patches
   of water to jump. In theory it's much shorter; in practice it takes so much skill that it's
   rarely worth it. That's the point.
5. **The Mud** (east side): the jungle switchbacks become a mud field. The road winds down through
   it, and a microcut (the black dots by "Mud") jumps across one of its bends.
6. **Down past the volcano** (the middle): from the mud the main road heads south-west towards the
   volcano. There it splits:
   - **The east way, round the Burnt/Lava fields:** a road that drops south-east into the burnt
     lava fields, a lobe out and back across black rock and cooling lava, then west to the south
     shore.
   - **The rim way:** onto a ring road round the volcano's flank, then off its west side and down
     to the south shore. The black dots inside the ring are ways up the cone, cuts across its
     shoulders.
   - **The crater jump** (the red X in the volcano), a risky shortcut. Up a ramp on the cone's
     flank, off the crater's lip and over the lava lake, landing on the far flank. Clear it and
     you've cut the corner; come up short and you're in the lava.
7. **Home along the south:** the routes meet again and run west. Here the main road swings south
   in a loop round a bay. The **Lava Channel** (the dots and red X near the start) is a risky cut
   straight across the loop's neck, over a lava channel you have to jump. Then the line.

## Routes by difficulty and danger

| Where | The road | The cut (rough, slower ground) | The risky line |
| --- | --- | --- | --- |
| Town to the bridge | The coast road's S | The beach (open sand, no road) | Off the dunes |
| Over the bay | The half-moon bridge | (none) | The Reef Run: rocks, water to jump |
| The mud | The road winding down | A microcut across a bend | Straight down the mud field |
| Past the volcano | The east way, the burnt fields | The rim way, over the shoulders | The crater jump over the lava |
| The south shore | The loop round the bay | (none) | The Lava Channel |

Each risky line needs an honest sum:
- **Clean**, it saves real time (2–5 s).
- **Fluffed**, it costs more than the road would have (a wreck, about 4–6 s).
- **Taken slowly** to be safe, it saves nothing.

The lap report measures each one, as Avalanche's ski jump and canyons were.

## Ground and feel

What worked on Avalanche, and the owner's asks for here:

- **Roads that aren't uniform:** widths that breathe, gradual rises and dips, crests, and tilts
  (banks that lean into the bends and sometimes the wrong way, gently). On Avalanche these made it
  immersive. The roads here should never be flat ribbons.
- **Off-road slows you,** so a cut isn't always better. Each kind of ground has its own cost:
  - **Sand:** loose.
  - **Mud:** heavy drag, sliding.
  - **Grass:** some drag.
  - **Jungle undergrowth:** drag.
  - **Ash:** loose.
  - **Lava rock:** grippy, but rough.

  There are surfaces for most of these already (`sand`, `beach`, `shore`, `grass`, `undergrowth`,
  `ash`, `lava-rock`, `red-earth`). The mud is new.
- **The mud is like the mogul field, but less orderly** (the owner). Bumps of mixed sizes, not on
  a grid, with ruts that pull your wheels and puddles that slide. Avalanche's moguls are a regular
  grid of bumps; mud is that grid jittered, plus noise, with puddles in its hollows.
- **The bridge is a half moon,** one long, even arc to drift end to end. It's banked, and wide
  enough to hold a slide with a car alongside.
- **Slope gravity on the volcano.** Avalanche's slide only works on snow. Here it would be a little
  on ash and loose rock, so the cone's flanks pull you down: a cut over the shoulder is a climb
  you pay for, and a gamble on the way down.
- **The sea is the edge:** wet sand, then shallows that slow you and throw spray, then deep water
  that's a respawn. No invisible walls.

## Dynamic areas, and random lava

The island should change from race to race, and within a race, without anything to sync. As with
the avalanche and the weather, it's all closed-form in time and seeded by the room.

- **Random lava:**
  - **Flows:** the lava channels down the volcano's far flanks flow or don't, by a seeded schedule.
    A flowing channel is a wreck to touch; a crusted one is drivable, slow and smoking. So the
    Lava Channel cut, or the burnt fields' shortest line, is open on some laps and shut on others.
  - **The lava lake's level:** it rises and falls, so the crater jump is longer on some laps.
  - **A warning first:** cracks glow, then it flows, so a sharp driver reads it a lap ahead.
- **Eruptions** (chaos, and maybe normal now and then): the bombs and lava rain already exist. An
  eruption could also send a flow across one road for a while, so the routes reshuffle mid-race.
- **The tide** (an idea): the Reef Run's water patches and the beach road's waterline go in and
  out over a race, so the Reef Run is less mad at low tide.
- **Showers:** they make the beach and the mud slicker, so the road wins more often in the wet.

## Hawaii, and a little zany

The look: green, black rock, turquoise sea and bright flowers, Hawaiian rather than generic
tropical. Some ideas to pick from:

- **Smashables:** tiki torches, surfboard racks, a shave-ice stand, pineapple crates, a pile of
  coconuts, and leis on a line between palms.
- **Things that move:**
  - Nene geese crossing the beach road, a dodge.
  - A sea turtle hauled out on the sand.
  - The whale off the north shore, still there.
  - Surfers on the waves under the bridge.
- **Lava with character:** a lava lake that burps, lava "surf" spray off the crater jump's
  landing, and steam where flows meet the sea.
- **A rainbow** after a shower passes.
- **Zany touches:**
  - The crater jump's ramp is a giant surfboard propped on the rim.
  - A hula-dancer tiki waves you in at the finish.
  - The Lava Channel's jump has a "NO" sign someone has painted over to read "GO".

## What the code has, and what's new

**From Avalanche, already on `main`:**
- `Ground`: the shared heightfield.
- Slope gravity (`SurfaceDef.slide`).
- Bounds only off the grid.
- Pines as solid, drawn colliders (for palms).
- Forward jumps that count checkpoints.
- The camera's slope view.
- Levels of detail on the ground.
- The AI's canyon lines, which work for any corridor off the road.

**New:**
- **Open ground on a lap.** Avalanche is one run; Paradise loops. The ground builder already
  handles a closed road (its `plane` wraps), but the bounds, progress and respawns were only
  tested on a run.
- **Routes the race understands.** The cuts are branches (splines with their own line, like
  today's shortcuts) between shared checkpoints, so every route has to pass the same gates, and
  the AI knows the routes. The open ground between them is still yours to drive.
- **The sea as an edge:** shallows with drag and spray, deep water as a respawn (a new kind of out
  of bounds, beside off the grid).
- **A road over the ground:** the half-moon bridge is a deck over the water. The ground is one
  height per point, so the car has to follow whichever is under it: the deck if it's on it, the
  sea floor if it isn't. That's the main engine work.
- **Mud:** a surface, and a jittered, noisy mogul field with puddles.
- **Lava as a hazard on the ground:** a flowing channel wrecks you, a crusted one is slow. Both are
  closed-form in time and seeded.
- **The crater jump:** a ramp, a lip and a landing tuned so every class can clear it flat out, and
  a lava lake under it that wrecks you.
- **Solid palms,** the pines' way: one list, drawn and hit, kept off the roads and the jump lines.

## Hard parts

- **The bridge:** a road above the ground (see above). The Freeway does it today on a lap with
  walls. Open, the deck needs edges you can drive off (into the bay, a respawn, or onto the beach
  near its ends).
- **Cutting across the island has to cost time.** On open ground the shortest way is straight
  across. The checkpoints keep you to the loop, but between them the volcano, the jungle and the
  water have to make the routes even. Measure every route.
- **Too many routes.** A race should still read clearly: signs, the minimap showing the routes,
  and the AI visibly taking them.
- **The tunnel's gone.** If the owner misses it, a short cave through a lava ridge is possible: a
  roof over a cut in the ground. The ground stays one height there.
- **Retuning:** today's floor is 71.52 s, with traffic on the straights and showers. The new lap
  needs its own target, and the field's wrecks have to stay where they are (1.5 a race).

## Built so far (2026-10-03, PRs #79–#81, not merged)

Three stacked PRs, each a draft or open until the owner says. Each branches off the one before:
`main` ← **#79** `paradise-open` ← **#80** `paradise-open-island` ← **#81** `paradise-open-tube`. The map
is experimental, `paradise-open/open` (its own map, `content/maps/paradise-open`, since
`experimental` is per map), out of the lobby: `?mode=free&map=paradise-open/open`. It's generated
by `bun tools/gen-paradise-open.ts` from today's island lap; edit the generator, not the JSON.

**#79, step 0, a road over the ground:**
- **Decks on open ground** (`GroundDef.decks`): the main road over the ground, the ground under it
  carved to a floor. On the deck you drive on it; once your middle is over its edge you fall.
- **The sea** (`GroundDef.sea`): drawn, and deep water is out of bounds (a respawn on the road).
- **The Freeway** is a deck over the bay, with its rails (the owner asked for them back). On open
  ground a rail is two-sided: outside one you stay outside, and under a bridge you never meet it.
- **The camera** follows the deck up a ramp and when you swerve near its edge (it dipped to the bay).
- **The two turns off the Freeway** are banked 14° into themselves, the second the other way, and
  on open ground a bank holds you in (`TUNING.bankHold`): it bends your path toward its low side,
  so a drift leans on it. The owner: "it feels a lot better", "plays nice".

**#80, steps 1 and part of 5 and 8, the island:**
- **Today's coastline** (`GroundDef.coast`): a beach, and the sea floor falling away past it. The
  Freeway now crosses a real bay.
- **The volcano** (`GroundDef.volcano`): today's 95 m cone, its crater, and a lava lake that wrecks
  you. The plume, and the crater's glow, shared with today's Paradise (`crater()` in island.ts).
- **About 2,400 solid trees** (the pines' list, `kind: 'tropic'`): palms within 70 m of the coast,
  jungle inland, thickest by the jungle road.
- **Island colours** on the ground: sand, grass darkening into forest, black lava rock up the cone.
- **Off the road, slopes pull you** (`TUNING.offroadSlope`, 0.8): the ash holds you back climbing.
- **Not yet:** Harbor Town's houses, the pier and boats, the umbrellas, the lava flows and the land
  landmarks. On open ground each needs a collider first (you'd drive through it). The landmarks at
  sea (shipwreck, whale, seaplanes) are back.

**#81, the Lava Tube** (the owner: climbing the mountain is slow; a tube down into the volcano,
over the lava on a jagged rock bridge, out the other side):
- **Branches on open ground:** a shortcut shapes the ground (its own height, a cutting into a
  slope). Its decks (`GroundDef.branchDecks`) leave the ground as it is: a tunnel where the ground
  is over the road, a bridge where it's under.
- **The surface rule:** a car is on the highest surface at or below it. At a tunnel's mouth, where
  the slope rises off the road, a car within a hard landing (1 m) of the road stays on it.
- **The route:** off the rim road where it turns round the cone, a tunnel in, out into the crater
  (now a shaft, `volcano.pit`: floor 12 m, lava 14 m), over a jagged rock bridge 4 m above the
  lava with no rails (off it is a lava wreck), and a tunnel out to the top of the rim.
- **The AI takes it** (hard rivals most laps). Its line rejoins the main road at the main road's
  speed, so it brakes for what's past the end.

**#81, after the owner drove it (2026-10-03):**
- **The jump over the lava** (the owner's fix for "too overpowered"): the crossing is straight now
  (in, straight over the shaft, out; its two bends are at the shaft's edge), and the bridge is
  broken by a 40 m gap in its middle, a 12 m kicker rising 2.5 m up to it. Every car needs about
  150 km/h off the lip (the bus 160); flat out from the tunnel the slowest is at 175. Lift, or
  scrape a wall on the way, and it's the lava.
  - **Gaps** (`GroundDef.branchGaps`): a stretch of a branch with no road: no deck, and nothing
    shaped under it (the shaft and its lava stay).
  - **Down in the lava, you're back past the gap**, 10 m onto the far side (`pastGap` in
    physics.ts: a respawn within 80 m before a gap goes past it). At its edge you'd have no
    run-up and fall in again. Back to the rim road instead would be the harsher choice.
  - **A catch isn't a launch:** falling under a deck's edge and caught by the hard-landing rule,
    a car lands; it used to be thrown up (at the far side, 4 m up into the rock).
- **The tube's ends:** its heights are authored so that, after the bake pulls it onto the rim road
  where they meet, it climbs one smooth curve onto it at the rim road's own grade (it had a 45%
  hump that threw cars 4 m into the air out of the exit). A small hop, about 1.2 m at full speed, is
  left where it crosses the banked rim road.
- **The camera through it:** it reads the tunnel's road ahead, not the rock over a mouth or over the
  climb out; across the gap it holds the bridge's level; and it never sits in the rock (it stops
  short of it, `clearView` in camera.ts: behind a car turned in the tunnel, it went into the rock
  and the screen went black).
- **Rock faces** (`GroundDef.face`, 1 here: rise over run): ground steeper than that is a wall, so
  a car off line at a mouth bounces off the volcano's face (or wrecks, hard enough) instead of being
  carried up it and thrown over the mountain. Unset on Avalanche, whose snow walls you drive up.
- **Dev:** `?spawn=<m>` starts your car that far along the main road (2600: just before the tube).

**The island, a detail pass (2026-10-03, on #81's branch):**
- **A beach** (`GroundDef.beaches`): from Harbor Town's west end to the Freeway, the sea side of
  the road is sand down to the water, drawn and driven (`sand`), with palms on it.
- **The roads are laid over the ground,** main and branches, in their own colours, and with no
  markings (the checkered line stays). The ground's colour is per grid point, so the grass used to
  blend in over the road's edges.
- **A stretch's verge colour (the ash, the undergrowth) fades off its road** over a wandering edge,
  instead of filling the ground to where the next stretch's begins (straight-edged blocks of ash).
- **The volcano's ground in mixed tones:** dark rock, lighter ashy patches and warm earth, at two
  sizes.

## What we learned (2026-10-02)

**The Lava Tube was too strong (the owner: "a bit too overpowered", "cuts thru so much time").**
The owner's answer was "riskier": the jump (built, above). Its numbers now: a hard rival makes it
every lap, so the floor is 68.05 s (67.68 s before it, 70.03 s without the tube), and a field of
eight had no wrecks. It's a gamble for a player, not for the AI. Before that:
- 480 m against 570 m round the rim, and level where the road climbs: the lap floor went from
  70.03 s to 67.68 s, about 2.4 s, and a hard rival takes it most laps.
- The aim, as for every cut: about even with the road for a hard rival, a gamble not a skip.
- Ways to even it out (not tried yet; one or two together):
  - **Slower inside:** the tunnel winds (a bend or two in the rock), narrower, rougher floor
    (`ash` or a grippier but draggy rock), a hairpin down into the shaft.
  - **Longer:** in earlier and out later, or out lower on the rim (then the climb's yours).
  - **Riskier:** a narrower bridge, a kink in it, or the race's one lava spurt sometimes across it.
  - **Rarer:** the AI's take rate for it (`skill.shortcut`) down, like secrets.
- Measure with `bun tools/lap-report.ts paradise-open/open` (and `--field`, `--chaos`): the floor
  should come back to about 70 s with the tube taken.

**Climbing the volcano off-road is slow** (the owner). That's `TUNING.offroadSlope` working. If
the crater jump (step 5) needs a run-up from the flank, it may want a road or a ramp up, or the pull
lighter on the cone.

**Building lessons:**
- **A shortcut has to part from the main road quickly.** The tube's start overlapped the rim road
  for 60 m: the AI chose it, then its 60 m window ran out before it was on it, and it swerved back.
- **Its end, too.** Where a branch runs along the main road before rejoining, its heights are
  pulled to the main road's: a 15 m hump at the tube's exit. Rejoin at an angle.
- **A new, faster route finds the crests downstream.** Out of the tube flat out, cars flew off a
  crest on the rim road's descent into the trees. It's smoothed now (3,250–3,420 m).
- **The heightfield and tunnels:** the ground stays one height, the tunnel's road is a deck under
  it, and its mouths are opened in the slope (`Ground.hole`). Steep ground round a mouth leaves
  gaps where its triangles are skipped: the shaft's walls fall over 18 m, not 9, and the mouths
  into the shaft have a tall rock collar.
- **Every look change was checked in the browser** with the dev hook `window.__rc` (`placeCar`,
  `advance`, `renderer.freeCamera`).

**Building lessons from the jump (2026-10-03):**
- **This game's gravity is 24 m/s², and the road lifts a car at most 8 m/s.** A kicker gives at
  most that, so a jump's reach grows only with speed; tune a gap in the sim (every class, a sweep
  of speeds), not on paper.
- **A jump wants a straight road under it.** The tube's bend in the crater's middle (27° over 20 m)
  would have flown you off the side.
- **A respawn before a jump needs a run-up,** or it's a loop of wrecks.

**Review and details pass (2026-10-03, on #81's branch):**
- **Fixed from the review:** a car flat out up the slope over a mouth could sink through 30 m of
  rock onto the tunnel's road (now it meets the rock); the bank's hold pushed a reversing car up
  the bank (no hold in reverse); a wreck anywhere in the 80 m before the gap respawned you past the
  jump, a wall in the tunnel too (now only on the kicker or within 20 m of the gap); `?spawn=` is
  checked and off in online races; the generator's wall gap used a stale lap length.
- **Fixed from the owner's notes:** the camera's hiccup at the tube's start (at the mouth it kept
  clear of the slope rising off the road, and rode it up 7 m: `cameraFloor`), and the big rock box
  over the way in (a cutting's floor a little under the road read as the shaft, and got the
  shaft's 22 m collar).
- **The jump shows:** red and white chevrons up the kicker, and lava light along both edges of the
  gap.
- **The entry is one smooth climb** (it crested where the tunnel's deck starts and floated cars).
- **The catch rule is decks only:** on the ground a landing keeps its bounce (Avalanche's floor
  moved 0.3 s without it).
- The organisation notes went to TECH_DEBT.md, "Open ground and Paradise Open".

**Known rough edges** (on #81 unless noted):
- **The climb out of the tube** peaks at 33% (the same height in the same road, since the entry's
  fix); rejoining further down the rim road would ease it.
- **A small chink of sky** over the exit mouth's arch, where the slope's opening shows.
- **The arches' pillars and the shaft's collar aren't solid.**
- **The look (#80, the owner's call):** a lot of black lava rock on the cone (grey ash streaks, or
  less of it?), and the grass still a bit bright.

**Numbers** (best AI lap, solo hard coupe): Paradise Open 68.07 s with the jump (67.68 s with the
tube before it, 70.03 s without the tube, 71.52 s for today's Paradise); the field's wrecks at 0 a
race (2026-10-03). Every other map's floor is unchanged: Downtown 57.9, Backroads 62.82, Avalanche
93.07. `bun test`: 493 pass.

## Next (2026-10-03)

In about this order:
1. **The mouths solid,** and the climb out of the tube eased (rejoin further down the rim road).
2. **The eruption** (the race's one lava event, "Lava" in the owner's answers): seeded,
   closed-form in time, with a warning first (a rumble, the glow brighter), then lava up over the
   bridge for a few seconds: in the tube then, a wreck. It's the sim's (every client agrees), not
   the plume's.
3. **The jump's look, more:** a "surfboard" kicker, lava spray off the landing (PARADISE's zany
   ideas).
4. **Balance:** whether the AI should miss the jump sometimes (it never does), and the floor.
5. **The rest of the steps below:** the routes from the sketch, the half-moon bridge, real mud,
   Harbor Town with colliders.
6. **Merge:** #79, #80, #81 in order (the 2026-10-03 work has had its review).

## Steps

Each one is a PR on its own experimental layout, `paradise/open`, beside today's `paradise/island`
and out of the lobby (`experimental`, like Avalanche) until the owner picks.

Done so far: step 0 (#79), step 1 (#80), and of the rest the volcano's cone, crater and lava lake,
the trees, the Lava Tube and its jump over the lava (in place of step 5's crater jump), and the
beach from town to the Freeway (#80, #81). See "Built so far" above.

0. **A road over the ground** (maybe first: it unblocks every map's move to open, the owner):
   a deck the car follows when it's on it, with the ground under it otherwise. Try it on the
   half-moon bridge, and it's the Valley's Trestle's answer too.
1. **The island as ground.** Today's island (its coastline and volcano, `layout.terrain`) becomes
   drivable ground under today's lap, with the sea as the edge. Drive it.
2. **The routes from the sketch:** a generator (`tools/gen-paradise-open.ts`) with the main road
   and its branches. Non-uniform widths, rises and tilts. The beach road, and the microcut in the
   mud.
3. **The half-moon bridge:** the road over the ground, its arc, its banking, its ends.
4. **The surfaces:** mud as a field, the beach and the sea's edge, and off-road costs tuned so the
   cuts are a choice.
5. **The volcano:** the rim way, the slope gravity on its flanks, the crater jump and the lava
   lake.
6. **The lava spurt:** one dynamic event a race (seeded, with a warning), the Lava Channel, the
   burnt fields.
7. **The risky lines:** the Reef Run's rocks and water patches, and the dunes.
8. **Hawaii and zany:** solid palms, the dressing, the smashables, things that move, and no
   lighthouse.
9. **The AI on the routes,** then measure everything and tune. Then the owner drives it.
10. **Release:** the owner's call, whether it replaces `paradise/island` or sits beside it.

## The owner's answers (2026-10-02)

- **The sketch:** my reading is right ("very nice!").
- **The lap:** about today's length (3.8 km, about 72 s). It loops, unlike Avalanche's one run.
- **Replace, eventually.** The goal is for Paradise Open to replace today's Paradise. For now it's
  built as an experimental layout on its own branch, out of the lobby.
- **Traffic:** some is good: in town, and on the bridge.
- **Shortcuts: start fresh** from the sketch. The old ones (the Sandbar, Smugglers' Trail, the
  Beach Cut) are inspiration where they fit.
- **Driving on the beach** has to be part of it, as a shortcut, and it needn't be a road at all:
  open sand along the water, as the beach road's alternative or in place of it. The long dashes on
  the sketch can be a line across the sand rather than a built track.
- **The Lava Tube:** "I'm going to miss the lava tube tunnel", but the volcano jump replaces it.
  Later the same day: climbing the mountain is slow, so bring it back, down into the volcano and
  over the lava on a jagged rock bridge (built, #81). Then: "a bit too overpowered" (above). Then
  (2026-10-03): jump the lava in the middle, and the eruption wrecks you (the jump's built).
- **Lava:** about one dynamic lava spurt a race, not a schedule shutting routes every lap.
  "Random lava" above becomes one event per race: seeded, closed-form in time, with a warning
  first, and somewhere that changes the best line for a while.
- **Wider:** most maps will move to this form, relying on clever level design rather than walls
  to keep races fair (see HANDOFF). The road over the ground (the bridge here, the Valley's
  Trestle on Backroads) is the piece to solve first; once that works, the rest follows.

## Questions for the owner

Answered above. Still open:
- **The Lava Tube's balance:** riskier, the jump (built). Should the AI miss it sometimes?
- **A miss:** back past the gap (today), or back to the rim road (harsher)?
- **The look:** the black rock on the cone, and the grass.
- **Merging:** #79 (the bridge) could go to `main` on its own; #80 and #81 build on it.

As asked:


- **The sketch:** is my reading in "The sketch, read as a route map" right? Especially:
  - the beach road as the long dashes;
  - the dots as cuts;
  - the routes round the volcano (east by the burnt fields, or the rim way west);
  - the Lava Channel as the red X near the start.
- **The lap's length:** about today's (3.8 km, about 72 s), or longer, as Avalanche's run is?
- **Replace or add:** should Paradise Open replace today's Paradise when it's ready, or sit beside
  it as a second layout?
- **Traffic:** keep the cars in town and on the bridge, or let the open island be empty roads?
- **The old shortcuts** (the Sandbar, Smugglers' Trail, the Beach Cut): fold them into the new
  routes, or start fresh from the sketch?
- **The tunnel:** fine to drop it, or do you want a cave somewhere?
- **Lava:** how often should a route be shut? Every few laps, or about once a race?
