# Getaway: a loose plan for a city map you escape from

The owner's brief (2026-10-08): "a new game mode and map for Arcade, it would basically be where
you start at a bank in a semi large city. This wouldn't be a racetrack, it would be you escaping
a bunch of cop cars chasing you ... flee through the streets, side alleys, busy intersections,
possible freeway portion, and stay alive as long as possible. As time goes on the cop cars become
more aggressive, faster, and possibly set spike traps, etc. If the cops manage to wreck you then
it's game over and the score is calculated based on how long you stayed alive."

And the owner's answers (2026-10-08): "a map specific game mode kinda like Avalanche at first,
any crash ends the run, I think we should build a new city map using Caldera with more street
grids, allyways, routes to take, I don't think you should lose heat, this would be something that
gets harder overtime and each minute it would get more difficult, by the end you would have to be
really technical, fast and perfect to continue getting away."

It's a **direction, not a spec**: what building changes goes in "Built so far", as on the other
maps. Read [CALDERA.md](./CALDERA.md) first ("Routes that aren't one loop", and the pursuit notes
under "AI and modes"), and [AVALANCHE.md](./AVALANCHE.md) for the map-with-its-own-rules
precedent.

## The idea in one paragraph

You come out of the bank's car park with the alarm going and two cruisers already round the
corner. There's no lap and no finish line: the map is a new Caldera city, San Francisco-ish: hills to
fly off, odd-shaped streets, five-way junctions, alleys and an elevated freeway, and the only goal is to keep moving.
**Every minute the heat goes up a level and never comes down**: more cops, faster cops, cops that
ram and box you in, then roadblocks, spike strips and a helicopter. **Any crash ends the run**: a
cop's takedown, a wall, a bus, a spin. The first minute is learnable by anyone; by minute five you
need the city memorised and a perfect line through it. The score is how long you lasted.

## Decisions (the owner, 2026-10-08)

| Question | Decision |
|---|---|
| A mode, or a map? | **A map with its own rules, as Avalanche is.** Pick the map, you get the chase. A general `Mode` system can come later if other maps want it. |
| What ends the run? | **Any crash.** Every wreck `Cause` (a cop, a wall, traffic, a spin-out, out of bounds) is game over. |
| The map | **A new city, built with Caldera**, not Downtown, and **not a plain grid**: SF-style, with hills, odd-shaped roads, partial grids, five-way junctions and a freeway. |
| Losing the cops | **No.** Heat never drops; there's no hiding, no cooling off. |
| Difficulty | **Up every minute**, until only technical, fast, perfect driving survives. |
| Score | **Time survived.** (Bonuses: see questions.) |

What "any crash ends it" means for the rest of the plan: the cops' job isn't just to hit you, it's
to **force a mistake**. A wreck is binary today (`wreckCar()` in `src/core/car/physics.ts`), which
fits: no health bar, one mistake and it's over. The difficulty has to come from the city and the
cops making mistakes more likely, not from cheap unavoidable hits.

## Where things stand (what it builds on)

- **Map-specific rules already exist:** Avalanche's slalom is a field on the layout
  (`slalom?: SlalomGate[]` in `src/core/content.ts`) scored by `src/core/rules/slalom.ts` inside
  `Sim.step`. The getaway follows that shape: a `getaway?: GetawayDef` on the layout, and
  `src/core/rules/getaway.ts`.
- **No city yet.** Downtown (`tools/gen-city.ts`) is a closed lap. CALDERA's road graph
  (`src/core/track/graph.ts`, `RoadGraph`) has junctions, streets and links, but **no path
  search**, and progress still leans on a main road. CALDERA's "Routes that aren't one loop" is
  the engine work this map needs.
- **AI follows a racing line.** `driveRacer` (`src/core/ai/racer.ts`) pursues a precomputed line
  with a sideways offset; it can't aim at a car. `driveFollow` (`src/core/ai/follow.ts`) is plain
  pure pursuit to a point, the easiest start for a cop.
- **Wrecks:** `wreckCar()` / `respawn()` in `physics.ts`, `Cause` in `src/core/events.ts`,
  takedowns in `src/core/collide/cars.ts` (`takedownCheck`, thresholds in `tuning.ts`). The run
  ends on the first `Ev.Wreck` for the player instead of a respawn.
- **Traffic** (`src/core/world/traffic.ts`) is closed-form in (seed, time) and doesn't react.
  Fine for busy intersections from day one, and deterministic, so a run is replayable.
- **Hazards** (`src/core/world/hazards.ts`) are scheduled ahead with telegraphs. Spike strips and
  roadblocks are hazards placed at run time.
- **The cop car:** `content/cars/police.json`, the Interceptor with a light bar.
- **Music:** `pursuit-orchestra`, `relentless-pursuit`, `escape` in `src/audio/soundtrack.ts`;
  `music.ts` has intensity layers to tie to heat. **No siren** yet.
- **Single player first.** `Sim` steps everything locally. Online, the cops are host-run
  entities like rivals: see "Online getaways" under "Built so far" (2026-10-09).

## How a run plays

**Start.** The car parked nose-out at the bank, the alarm, a 3-2-1, and the first two cruisers
150 m back. The clock starts on GO.

**Heat goes up every minute and never drops.** Each level adds one thing to think about, so
every minute feels different, not just faster:

| Heat | From | Cops | What's new |
|---|---|---|---|
| 1 | 0:00 | 2 cruisers | they follow and nudge; learn the streets |
| 2 | 1:00 | 3 | they ram from behind; one takes the parallel street |
| 3 | 2:00 | 4, faster than you on a straight | PIT from the rear quarter; box-ins at junctions |
| 4 | 3:00 | 5 | roadblocks at junctions ahead on your likely route |
| 5 | 4:00 | 6 | spike strips ahead; SUVs that ram head-on down one-way streets |
| 6 | 5:00 | 7 | the helicopter calls your route; roadblocks on the freeway ramps |
| 7+ | 6:00 → | +1 a minute | everything at once, cops a little faster each minute, no ceiling |

The numbers are a first guess to tune with telemetry. The shape that matters:

- **Minute one is fair to anyone.** Cops behind you, nothing ahead.
- **From minute three the cops are faster than you on a straight.** Straights stop being safe;
  corners, alleys and cut-throughs are where you gain. That's what makes it "technical": the
  player who knows where the tight lines are survives.
- **From minute four, the threat is ahead of you too** (roadblocks, spikes), so you have to read
  the street and change route, not just drive away.
- **There's no ceiling.** Past heat 7 it keeps climbing, so every run ends; the question is when.

**Every crash ends it.** The cops' attacks are built to force one:

- **Ram / PIT:** a hit hard enough is a takedown (`takedownCheck`); a glancing one shoves you
  toward a wall or traffic. Both are your problem.
- **Box-in:** a cop ahead brakes while two close from the sides. Getting stopped among them is a
  takedown waiting to happen, so it ends the run as "busted" after 2 s under ~10 km/h with a cop
  touching you, rather than waiting for one.
- **Spike strips** blow your tyres: grip down and the car loose for ~6 s. Not a wreck on their
  own; it's the next corner that gets you.
- **Roadblocks** are cars and barriers across a street with a gap at one end (narrower each heat).
  Through the gap, round the block, or a wreck.

**Fair, not cheap.** "Any crash ends it" only feels good if every death was the player's to
avoid:

- Cops never spawn in view, never spawn ahead of you within ~200 m, and never ram you on the
  first second of a corner exit.
- Every spike strip and roadblock is telegraphed (the hazard markers; a "SPIKES AHEAD" call, a
  light-bar glow down the street) with at least ~1.5 s to react at your speed.
- Traffic is the same every run on the same seed: a run is learnable.
- After the wreck, a 3-second replay of the moment (slow-mo, the cop or wall in frame) before
  the score, so you see what got you.

**Score.** Time survived, to the tenth, is the score. The end screen shows the heat reached,
distance, and the personal best for the map (saved locally in `src/settings.ts`'s storage, later
a GameRelay leaderboard, which SPEC §12 already plans).

## The map: a new Caldera city, San Francisco-ish (working name "Heist")

The owner (2026-10-08): "let's not make the city too gridlike tho, I want it to be less
repetitive, have a unique layout, maybe something like SF where you have hills, odd shaped roads,
partial grids, 5 corner intersections, but maybe also a freeway portion as well."

A city made to be run through, not lapped, about 1.5 × 1.5 km, and **no two parts alike**: you
should always know where you are from what's around you, the way you know a real city. That's
what lets the late game be technical: a player who knows that the third left off the hill is the
alley that lines up with the freeway ramp survives, and a grid would make every corner the same.
What it needs is **routes**: from any junction, two or three ways to go, each with its own risk.

**How the city is laid out.** Like San Francisco, a few **patches of grid, each at its own
angle**, stitched together along the seams by long diagonal streets. Where a diagonal crosses a
grid you get the odd shapes: **five- and six-way intersections**, triangle blocks, wedge-shaped
plazas, streets that dogleg to meet the next patch. Over all of it, **the hills**.

**The districts** (each its own look, street shape and danger):

| District | Where | Streets | What it's for |
|---|---|---|---|
| **The Financial District** | the middle, by the bay | a tight grid of short blocks, tall towers, the **Bank** | the start; narrow canyons between towers, alleys behind them |
| **Market Street** | a long diagonal across the city | a wide boulevard, every cross street a five-way junction | the spine: fast, but every junction is a crossroads of traffic |
| **The Hills** | north and west | a grid laid straight over steep hills (SF's way), blocks climbing 15–20 m | **the hill jumps**: crests at every cross street to fly off, landing on the next block; brutal braking downhill |
| **The Crooked Street** | down one hill's face | a switchback of hairpins, brick, flower beds as walls | the most technical 200 m in the game: a shortcut down the hill if your line is perfect |
| **Chinatown** | between the hills and downtown | narrow one-ways, alleys, market stalls (smashable), lanterns | close and twisty; cops can't pass each other here |
| **The Mission** | south | a looser grid at another angle, wider streets, a park in the middle | room to breathe; a park to cut across on the grass |
| **The Embarcadero** | along the bay | a curving waterfront boulevard with piers off it | a long fast sweep; piers are dead ends (or jumps to the next pier) |
| **SoMa and the rail yard** | south-east | warehouses, the rail yard, loading docks | open ground, containers to weave, dock ramps |
| **The Freeway** | elevated, along the south and up the east side | a raised freeway with long sweepers, three on- and off-ramps | the place to gain distance early; roadblocks close its ramps at heat 6 |
| **The bridge approach** | the far east end of the freeway | the freeway rising onto the start of a big bridge | a dead end at heat 7 (the bridge is closed): you have to come back |

**Signature spots** (each a landmark you navigate by):

- **The Bank's plaza:** a five-way junction in front of it; the start, and every run's first
  choice of three streets.
- **Hill jumps:** three or four blocks in a row of crests to fly, the classic chase-movie run
  (Bullitt's). Get the landing wrong and the next crest throws you into a parked car.
- **The Crooked Street.**
- **A cable-car line** up one hill: the tracks in the street (a surface: slick when wet), and the
  cable car itself as moving traffic in the middle of the road.
- **A tunnel** under one hill (Broadway's): the only way through that hill without climbing it.
- **The market hall** (as Paradise Open's) on the Financial District's edge, glass at both ends,
  and a **parking garage** in SoMa with ramps up and down to the roof, and a jump off it onto the
  freeway's on-ramp for the brave.
- **A drawbridge** over the channel between SoMa and the Mission (CALDERA's), rising on a schedule.

**What makes it dangerous:** lamp posts, bollards, kerbs, parked cars and the steep hills
themselves, so a sloppy line wrecks you. (Smashables in `smash.ts` never wreck; these must.)

**What it asks of the engine,** beyond a plain grid:

- **Streets that meet at any angle, many at a point.** Today a junction is a branch leaving or
  rejoining the main road (`src/core/track/graph.ts`); a five-way intersection is several streets
  ending at one node, with the paving filled between them. A new junction piece.
- **Streets that follow the ground** with crests sharp enough to fly off, and junctions that sit
  level on a slope (SF's flat intersections on steep streets: the reason the hill jumps happen).
- **Districts in the generator:** each patch of grid made from its angle, block size and extent,
  then the diagonals laid across and cut into junctions where they cross.

## What's new to build

- **Caldera city support** (CALDERA "Routes that aren't one loop"): a map that's a street network
  with no main road; locate, respawn-free start, traffic and ground built per street.
- **A generator** (`tools/gen-heist.ts`): the districts, diagonals, junctions, hills, alleys,
  freeway and buildings; validated by
  `tools/validate.ts` as the other maps are.
- **Path search on the road graph (new):** A* over `RoadGraph`'s junctions and streets. Used by
  the cops to reach you, and to predict your likely route for roadblocks and spikes.
- **Getaway rules (new, `src/core/rules/getaway.ts`):** heat by minute, the cop spawner, busted,
  the first wreck ends the run, the score. Wired from `Sim.step`'s rules system as slalom is.
- **Cop AI (new, `src/core/ai/cop.ts`):** steering from `driveFollow`, behaviours by heat and
  distance:
  - *Chase*: path to you while far, pure pursuit at you within ~60 m.
  - *Ram / PIT*: aim at your rear quarter, a burst of boost.
  - *Flank / cut off*: path to a junction ahead of you on your predicted route.
  - *Box in*: take a slot ahead or beside, then brake.
  - Faster when far behind (CALDERA's "catch-up, honestly"), so you can't just build a lead.
  - Cops wreck too (into walls, traffic, each other) and come back off-screen.
- **Run-time hazards (new):** roadblocks and spike strips placed by the rules with telegraphs;
  a blown-tyre state on the car (grip and looseness multipliers).
- **Siren and lights:** a siren per cop (a doppler-shifted loop, louder as they close), the light
  bar flashing red and blue. Music intensity layers driven by heat.
- **HUD:** the time (big), heat, a "HEAT 4" call each minute with what's new ("ROADBLOCKS"),
  minimap blips for cops, the busted meter, the end screen with the replay and personal best.

## Steps (one PR each)

1. **Getaway rules and cops, on a greybox test city.** A small one from a generator (one patch
   of grid, a diagonal across it, one hill, one alley); the getaway rules; cops as `driveFollow`
   aimed at the player; heat by minute; first wreck ends the run; time on a results screen.
   Answers "is it fun?" before the big build. (The five-way junction waits for step 5.)
2. **Caldera city support:** a map with no main road (locate, traffic per street, the validator).
3. **Path search on the road graph**, and cops that use it.
4. **Cop AI proper:** ram, PIT, box-in, busted; catch-up; siren and lights.
5. **Junctions at any angle and hilly streets:** many streets at one node, level junctions on a
   slope, crests to jump.
6. **The Heist city, greybox:** the districts, Market Street, the hills, alleys, one-ways, the
   freeway, the Bank's start, traffic.
7. **Roadblocks and spike strips**, blown tyres.
8. **Through buildings, the rail yard, the river and drawbridge.**
9. **Polish:** the death replay, heat calls, music by heat, personal best, the skin.
10. **The helicopter** and whichever ideas below the owner picks.
11. **Later:** online (friends getaway together, cops host-run), leaderboards, a general `Mode`
    system if another map wants the rules.

## More ideas (pick what's fun)

- **Daily heist:** one seed per day, everyone gets the same city, traffic and cop spawns; a daily
  leaderboard. The seeded sim makes it fair; it's cheap once leaderboards exist.
- **Ghost of your best run:** a replay of your personal best driving alongside, so you can see
  where you went the other way.
- **Heat-minute milestones:** a sting and a flash at each minute ("3:00, HEAT 4"), the
  personal-best minute called out ("NEW BEST: past 4:12").
- **Cop variety by heat:** cruisers, the Interceptor, SUVs that ram, an armoured van for
  roadblocks, unmarked cars that look like traffic until the lights come on.
- **The helicopter's spotlight:** a circle on the ground that follows you; the cops ahead always
  know your route while you're in it. Tunnels and the garage break it for a moment (it doesn't
  lower heat, it just buys a few seconds of cops guessing).
- **Scripted moments:** the drawbridge rising at a set time, a train crossing the rail yard,
  a freeway ramp closing, the bridge shut, so long runs change shape.
- **Takedowns on cops:** wrecking a cop into a wall, traffic or another cop; a flash and a count
  on the end screen (no effect on heat).
- **Getaway car choice:** a heavy car shrugs off nudges, a light one slips through alleys. Or one
  fixed getaway car so every run is comparable (see questions).
- **Night and rain** as the look: headlights, wet streets, light bars on wet asphalt (the lobby's
  weather and time already exist).
- **Dispatcher lines** when heat rises ("all units, suspect heading north on Fifth"), as text
  toasts first.
- **Traffic that reacts** (pulling over for sirens, pile-ups cops get caught in): a big change to
  closed-form traffic, so much later.

## Questions for the owner

1. **Score:** time only, or time with a few bonuses beside it (near misses, cops wrecked, air)?
   The plan says time only, with the rest shown but not scored.
2. **Busted:** should being boxed in and stopped end the run (as above), or only an actual wreck?
3. **The car:** your pick from car select, or one getaway car for everyone so scores compare?
4. **Traffic:** always on, or does the lobby's traffic setting still apply?
5. **In the lobby:** one player only, or can friends start a getaway together (each their own run,
   the longest wins) before real online cops?

## Built so far

### Online getaways, and Splash City (2026-10-09)

The owner: "can we change the name of Heist to Splash City and Make the default mode chase when you
select from the normal menu", then, for online lobbies, "competitive survival and we add more
cops", "each player gets their own cops, but cops will also attack you when nearby", "watch the
rest then shared results", runners can take each other out ("3"), and the host drives the cops.
The design and plan: `docs/superpowers/specs/2026-10-09-online-getaway-design.md`,
`docs/superpowers/plans/2026-10-09-online-getaway.md`.

- **Splash City:** the map's name (`content/maps/heist/map.json`, `tools/gen-heist.ts`); its id is
  still `heist`, so bests, links and the fingerprint stay. The only map name of two words.
- **A run for each runner** (`rules/getaway.ts`): `Getaway(sim, runners)`, a `Run` each (its cops,
  time, busted, end). Each runner's pool is `poolFor(n)`: `min(10, floor((MAX_CARS − n) / n))`, so
  10 for one or two, 7 for four, 3 for eight; `MAX_CARS` went from 16 to 32. Out per heat is
  `heat + 1` per runner, as alone. One runner is single player, unchanged.
- **Cops go for the near one:** a cop goes for another runner within `NEAR_TARGET` (40 m) it can
  see, and back to its own past 60 m or out of sight. Busting counts any cop near you. A runner out
  (online) takes their cops out of the city; alone, they pull up as before.
- **Online:** the room's host drives every cop (`net/cops.ts`, `cop` host entities shaped like
  `net/rivals.ts`'s, with who each is after). Each runner's own screen decides their end and sends
  it on their car (`out`, `runT`: `net/cars.ts`); a runner whose page goes is out at their last
  time. Cops are `c:<k>` to `net/contact.ts`. Runners start in pairs outside the Bank.
- **After:** your card for 3 s, then you watch the runners still going (← / →, or the strip's
  buttons: `ui/watch.ts`), then everyone's runs, the longest first (`race.ts`'s `showTable`). The
  vote opens once one runner's left (`voteStep(…, chase)`), so the last has up to 60 s more. Online
  runs don't write your best on the device.
- **Not checked yet:** two or more players online in the browser, eight at the Bank, and the
  32-car draw calls (the plan's Task 7). Single player's `?start=getaway` loads as before.

### The draw call pass (2026-10-09)

The owner, after a check of the budgets: "yes do the draw call pass on heist please". Heist drew
650–950 calls a frame in the main pass (SPEC §15's budget: 250); other maps 120–250 (Riviera up
to 530 at one spot). Measured in headless Chrome by logging `renderBufferDirect` per object, at a
dozen spots. What it was, and what it is now:

- **The landmarks** (~1,000 meshes; the Golden Gate 407, the Bay Bridge 588: a box or cylinder
  per suspender and cable segment): a landmark nothing moves afterwards is flattened as it's built
  (`flatten.ts`): its plain toon parts (no map, opaque, not emissive, no shader hook of their own)
  merged into one mesh per side/fog, each part's colour in its vertices. Every map's landmarks get
  this; what a landmark's update moves, turns, shows or hides is marked (`moves`) and left as it
  was, as is any part with render state of its own (a decal's polygon offset, say).
- **The neon words and street names** (a mesh per word, ~60): one canvas atlas each (`atlas` in
  scenery.ts: pages up to 4096 px, each picture's edge drawn out 8 px round it so a far, mipmapped
  sign doesn't pick up its neighbour), merged: two draws.
- **The piers** (16, five draws each): built together (`piers`): one instanced mesh of piles, one
  merge of sheds, their plain parts flattened, their numbers on an atlas.
- **The warehouses' water tanks** (74 meshes): instanced.
- **The roadblocks' police cars** (six whole cars, ~18 draws each): one car built per roadblock,
  each of its parts instanced three times (`parked`), its lamps' glows as glow points. They leave
  the ink pass (seen over a wall).
- **Traffic** (an instanced mesh per design per (material, ink id): ~100): one per material for
  the main pass, and the ink ids as ink-only meshes (drawn only near, in the ink pass). Every map's
  traffic gets this.

Now 140–270 at the same spots (more with several cops on screen: a racer's car is ~30 draws and
isn't merged). Downtown, Paradise Open and Backroads are a little lower too. Not done: the racers'
own cars (their paint shader is per object; their wheels turn), the building chunks (LOD, 30–50).

### The Presidio: hills, bumps, grass and the woods (2026-10-09)

The owner: "here I think the ground should have some soft hills and mogul like bumps, we can add
some of the grass effects, also maybe make it go deeper with a real wooded area with crashable
trees".

- **Rolling ground** (new feature kind `rolling`, features/rolling.ts): over the park's lawn loop,
  soft hills up to 9 m (two sizes of smooth noise, 110 m and 44 m across) and, in patches, bumps 1.4 m high every 13 m, every other row offset like skied moguls. Both ease in
  over 60 m from the park's edge, so Van Ness, the hedges and the beach stay level.
- **The drive rides the hills:** its points take the hills' height (`rollingSwell`, not the
  bumps'), and the ground eases to it over its verge, so the bumps stop short of the asphalt. Its
  steepest grade is about 17%, at the mouth by Van Ness.
- **The woods:** south of a new hedge at z -150 the park runs on west from x -800 to x -1040 (the
  ground's grid reaches over it: `GroundDef.reach`). A tree about every 8 m, jittered, thinning
  over the lawn's first 40 m: some 900 cypresses (`grove-tree`) and 800 eucalyptus (new kind
  `gum-tree`: tall, pale-trunked, `slow` 0.8 against the cypress's 0.88), and brush. Crashed
  through, not wrecked on: a tree's smash throws leaves and shakes the camera harder than a cone.
  The drawn woods outside keep off the park (its lawn kind) and clear of its hedges.
- **The drive through them:** off Van Ness at the south, west along the south hedge into the
  woods, a slalom of S-bends down their west side, and back east onto the lawns, then on north as
  before. About 1.58 km (was 1.28), no bend tighter than 35 m.
- **Grass tufts** on a city's park lawns (Dolores Park and Pioneer Park too): the lawn's greens,
  thicker and in bigger patches than on a coast's grass.
- Heist's fingerprint is re-recorded; every other map's is identical.

### Broadway, Chinatown and the Presidio's drive (2026-10-08)

The owner: "I think we should add a detailed broadway street and china town, also maybe some more
open areas like the presidio that have more curvy roads to drift".

- **Broadway:** North of Market's line at z -230, 22 m wide (the grid's other streets are 14), so
  a double yellow down it. From Chinatown's west edge on past Columbus into the Financial District
  its blocks are turned to front it, and every building fronting it is a club (look `broadway`):
  dark fronts, lit windows, a lit doorway, a marquee out over the pavement lined with bulbs, and a
  neon sign each. About 33 of them. The owner, after: "for broadway can we add some light XXX
  themes": North Beach's strip joints, by their signs only (XXX, GIRLS, LIVE GIRLS, PEEP SHOW,
  ADULT, BURLESQUE, GO GO), among the CABARET, JAZZ, COMEDY, BOOKS and BAR. Then: "add the neon
  dancer silhouette like the Condor": the club nearest Columbus & Broadway (the real one's corner)
  is the only CONDOR, and its sign is a tall blade from over its marquee to past its roof: CONDOR
  across the top and under it a showgirl in pink neon, one arm up, a hand on her hip, in heels
  (an outline, no more), with stars round her and CLUB at the foot (`heist.ts` `condor`). And
  then it runs: the bulbs round its edge chase (four steps a second) and the dancer blinks out
  twice every 3.2 s. It's four textures swapped as it's drawn, on the wall clock (render only).
- **Street signs** (the owner: "should we add some street signs?"): the grids' streets have San
  Francisco's names (`District.names`), in order where the city's grid allows. North of Market:
  Polk to Steuart west to east, with Grant Av at the Dragon Gate; Chestnut, Lombard (the crooked
  block's street), Broadway, Jackson, Clay, California, Bush (the gate's crossing), Sutter, Post,
  Geary and O'Farrell north to south. SoMa: Mission to Townsend, and 1st to 9th back from the
  Ferry Building. The Mission: Church to Folsom and 14th to 21st. On a corner of every crossing of
  two named streets is a dark green post with a green blade along each street, its name in white
  on both faces (`GetawayScenery.signs`; 154 of them, 45 names). The corner is picked by the
  crossing, and moved round where Market, Columbus or Division cut over it. They're drawn only,
  not met.
- **Coit Tower, seated on its hill** (the owner, with a screenshot: "make coit tower blend into the
  landscape a little better"). Its square plinth stood at the ground's height under its middle, so
  where Telegraph Hill falls away it hung out over the lawn. Now:
  - the hilltop is levelled round it, as a crossing is but wider (r 16, in `CityDef.level`);
  - the plinth stands on a round stone terrace whose retaining wall runs down to the lowest ground
    round it, with a parapet;
  - a ring of cypresses stands on the slope at the terrace's foot (drawn);
  - its solid base is the plinth's 20 m, not the column's 12.
  The lanterns stop at Broadway: north of it is North Beach and Telegraph Hill, and they had been
  strung across the streets round the park.
- **A polish pass** (the owner: "go around and cleanup the map a little bit, make sure things look
  good"). A tour of the city found:
  - **Bare asphalt in the leftover lots.** Where Market, Columbus and Division cut across the
    grids, the triangles too odd to build on were bare asphalt with no kerb or pavement. So were
    block corners left empty, and the ground between Bay Street and Columbus's end. Now every
    leftover lot is a plaza (`GetawayScenery.plazas`, 4 m cells, about 76,000 m²), paved in the
    pavements' stone. The cells reach up to the kerbs, so the corners where a street meets another
    askew (its pavement cut off square) are paved too. The bigger plazas have street trees and
    the odd shrub (smashables).
  - **Lombard's crooked block had no pavement**: it isn't one of the cops' streets (its planters
    block their line of sight), so it wasn't painted. It's painted now as one of theirs
    (`GetawayScenery.painted`), with crosswalks and kerbs.
  - **Lanterns over Columbus's crossings.** These are wide and askew, so strings across a street
    piece ending on Columbus hung over open asphalt. Those pieces have none now.
  - **The generator's "near a building" test** (lamps, trees, plazas) missed the corners of a
    turned building (its quick reject was the square of its longer side, not its diagonal).
  A test keeps every plaza off the streets' carriageways and out of every building.

### In the lobby, and the review's fixes (2026-10-08, alpha-1.44)

The owner: "ok can we include this in the online version, and deploy a new version please", and
picked "in every lobby". Heist is out of experimental: in the lobby's map list and quick race. A
race of your own on it (Single player, a lobby to yourself) is the getaway; an online race with
others was a race round the city's outer loop (the AI laps it in 63 s), until online getaways
(2026-10-09, below). Its fingerprint is recorded.

`/code-review` on #160 found, and these were fixed:
- **Respawn:** a car's wreck after the finish didn't respawn on Heist even in a race that isn't a
  getaway (online, the attract race): the check was the map's (`layout.getaway`), now the race's
  (`sim.getaway`). A test.
- **Call-outs:** a cop could be called out 320–340 m off, past FAR (320): far again at once, so
  called out again every tick, never driving. Now never past FAR − 10, and with nowhere in the ring
  the nearest crossing past CALL_NEAR (so a far cop always comes back). Bringing a cop back no
  longer resets the wait for the next new one, which had held the heat's cop count back.
- **Parked:** a cop pulled up 12 m from you stopped, and at heat 1 stopped 9–14 m off, outside
  busting's 7.5 m. Now it creeps up to 5.5 m at any heat. (The new test passes on the old code
  too: in these runs a cop still came close enough. The fix closes the gap the review found.)
- **A cop placed in the city** keeps its place on the main road (it had kept s 0: a respawn would
  have put it across the map); a cop with its way used up heads at you till its next plan instead
  of planning every tick; a car cruising the city's streets is met by where it is, never a near
  miss on the main road; a run's best is kept as it ends, not when its results show (leaving
  first lost it).
- **The validator's** house-on-a-road test (this round's) keeps offRoad's own reading past an
  open road's end; it ignores only a projection that stopped short beside the road.
- **Chinatown:**
  - **The Dragon Gate** (landmark `chinatown-gate`) across Grant Avenue's south end (the grid's
    line at x 62). Its two stone posts stand on the pavements (solid houses), with a red beam and
    a green-tiled roof over the street, turned-up gold horns at the eaves, a lower roof over each
    pavement, its sign (天下為公) both ways, and red lanterns under the beam.
  - **Lanterns** strung zigzag across every Chinatown street from wall to wall, 6.5 m up, every
    4.5 m, sagging (`GetawayScenery.lanterns`: each street's line and width; the skin strings
    them). Every other one glows at dusk; about one in eight is gold.
  - **Pagoda roofs:** about one low Chinatown building in five has two tiers of green (or gold)
    tile with a red drum between.
  - **Wider pavements:** a district's setback from its streets is now its grid's street width (the
    width the streets are drawn and painted), not its own. Chinatown's 10 m had left its pavements
    1 m wide under the painted 3 m.
- **The Presidio, drivable:** Van Ness's west side is open (no wall) from near its foot to near its
  top, onto lawn (a city park out past the outline: `CityDef.parks` now works outside it, driven as
  undergrowth). Presidio Drive (branch `presidio-drive`, kind `street`, 12 m, about 1.3 km) leaves
  Van Ness near the Freeway and swings back and forth across the park in sweepers (45–90 m radius;
  tightest 40 m) and rejoins near the top. It's in the cops' streets. A hedge (solid) runs down
  the west side from the water and along the south; past it, the drawn woods, and the Golden Gate's
  approach now comes down beyond the hedge to its roadblock. To the north, the beach and the bay.
  About 30 groves (some 230 cypresses) and brush stand about the lawns: smashables (new kind
  `grove-tree`), so drifting through them costs speed but never a wreck.
- **Engine:** the validator's "house on a road" test also wants the house near where it projected.
  A winding branch, projected onto from far away, could stop on a sample whose tangent pointed at
  the house, so it reported city blocks 200 m off as standing on the Presidio's drive. Other maps
  validate as before, and their fingerprints are identical.
- **Known:** a car that crosses the drive from the lawn (not along it from a mouth) reads the
  drive's asphalt as the main road's verge (sidewalk, grip 0.9). Other maps' branches behave the
  same way.

### Stops at crossings, and smoother hills (2026-10-08)

The owner: "make the traffic stop at intersections, also some of the geometry for the hills and
intersections looks a little jagged, especially by coit tower, but really for most of the hills and
intersections".

- **Traffic stops** (`TrafficLaneDef.stops`): a path lane's cars stop at the line 13 m before each of
  its stop corners (the crosswalk's near side), slowing at 3.5 m/s², standing 2 s and pulling away.
  Still closed form: a car's distance round its loop is a piecewise function of the time round it
  (cruise, slow, stand, pull away), the loop starting in its longest run between stops so none
  straddles its end. Stops too close for a car to slow and pull away between are dropped. Every turn
  is a stop, and three crossings in four it goes straight over (the same ones whichever loop comes
  by): 9 loops, about 120 stops, cars stood a sixth of the time. Cars of one loop are tens of
  seconds apart, so one never runs into another waiting.
- **Their lane, evened out:** each loop's corners are moved over to the right of the street before
  it's rounded and spaced, not after (moving it after stretched the outside of a left turn: 60%
  over speed through it).
- **The hills, smooth** (features/city.ts): a crossing was a flat disc 9 m round, its edge easing
  into the street over 2.5 m: on a 30% hill a lip 3–4 m high at 55°, and where two crossings' reach
  met, a seam where the nearer one changed. Now: only crossings of two streets or more (an alley's
  mouth isn't one; levelling those too terraced the hills, their discs 30 m apart), 6 m round, 70%
  of the way to level, easing into the street over 16 m, and every crossing near enough blended (no
  seam). The steepest street grade went from 1.16 to 0.52 (the hills alone: 0.31). The crest at each
  crossing is still there, rounded: still a lift at speed, not a ledge.

### Cars cruising the streets (2026-10-08)

The owner: "could we have a little bit of traffic on the inner city roads, not a lot, but just some
cars cruising around please".

- **Path lanes** (`TrafficLaneDef.path`, `count`; world/traffic.ts): a lane can loop a path through
  open ground's streets instead of a road: [x, z] corners, driven in order, corners rounded (7 m),
  resampled every 2 m, `pos` m right of the line (the right of the street), on the ground. Still a
  formula of the seed and the race time, like all traffic, so nothing new goes over the network and
  no two cars of a loop ever meet. Met where they are, as a back street's are (not by main
  distance). Kept away from the Bank while the start grid's clear (a car rolling into you parked).
  The skin tips them to the hill. Other maps' traffic is unchanged (fingerprints identical).
- **The loops** (`tools/gen-heist.ts`, CRUISE): 9, each out from a crossing to one 300–650 m off
  the shortest way (its streets' lengths jittered per loop, so they differ) and back by other
  streets: proper streets only (no alleys, no main road), 2–4 cars each at 8.5–12 m/s (31–43 km/h):
  30 cars, sedans, compacts and vans. At those speeds one can't wreck a stopped car (traffic
  wrecks you over 21 m/s closing), but you hit one at speed, you're done.
- **Not yet:** they don't stop at crossings or for each other (two loops' cars pass through each
  other where they cross), and they don't react to you. That's the road graph's traffic, step 3.

### Open water, and Alcatraz (2026-10-08)

The owner: "could we make the set beyond the piers water please, maybe we can add an alcatraz set
piece in the background".

- **The bay to the horizon:** the sea wall now runs from the top of Van Ness, round its corner,
  along Bay Street, down the Embarcadero and round its corner to the Freeway's foot. Past it, open
  water all the way out (the land that was left beyond China Basin and north of Van Ness is gone).
  The land is west of Van Ness and south of the Freeway only. The piers stand where they did.
- **Alcatraz** (a landmark, `alcatraz`; scenery only), about 500 m off Bay Street: a craggy rock in
  tiers with scrub on its ledges, the long cellhouse with its barred windows along the top, the
  lighthouse at its west end, its beam turning after dark, the water tower on its legs, the dock
  and its buildings on the city's side. Seen down the piers from the Embarcadero and along Bay Street.
- **The Golden Gate Bridge** (the owner: "add the Golden Gate Bridge in the background too"; a
  landmark, `golden-gate`, scenery only), west of Alcatraz, across the strait from the land past Van
  Ness north to the Marin headlands (green domes): two orange towers 105 m over the sea and 580 m
  apart, stepped, portal struts across them; the deck 44 m up on its truss; the main cables hanging
  from the tops to the anchorages, a suspender every 10 m; red lights on the towers at night. The
  dusk haze takes the far tower, as the fog would. Best seen from Bay Street and the piers.
- **The Bay Bridge** (the owner: "can we add the bay bridge too please"; a landmark, `bay-bridge`,
  scenery only): its west span, out east from just past the south piers toward Yerba Buena Island
  (a wooded hill). Two grey suspension bridges end to end, 98 m towers with bracing, the great
  concrete anchorage in the middle of the bay between them, a double deck on its truss, and after dark
  the Bay Lights strung along the cables. Seen down the Embarcadero and from the south piers.

### Landmarks, the Presidio and the closed approaches (2026-10-08)

The owner: "add the Transamerica Pyramid and Coit Tower too, also I think we need to add the
presidio and the connecting ends for the bridges, but the ramps can be blocked off by parked
polic[e]" (cut off there: read as parked police cars).

- **The Transamerica Pyramid** (landmark `transamerica`): across the street from the Bank, on the
  block where Columbus Avenue comes into the Financial District, a white four-sided spire 175 m
  high (twice the towers round it) with its wings and lit tip; the block is its plaza, its foot a
  solid base (a house, look `landmark`). You start looking at it.
- **Coit Tower** (landmark `coit-tower`): on Telegraph Hill, the fluted white column (64 m, solid)
  in the middle of **Pioneer Park**, its block lawn (a third park).
- **The Presidio:** the land past Van Ness now runs north to where the Golden Gate comes ashore
  (the coast moved out), wooded: cypress and eucalyptus, drawn (`GetawayScenery.presidio`), past
  the walls.
- **The bridges' approaches, closed** (`GetawayScenery.approaches`; drawn, not driven): the Golden
  Gate's comes off its south end, curves down through the Presidio and runs along the ground to Van
  Ness's wall; the Bay Bridge's comes off its west anchorage over the Embarcadero's corner and runs
  in alongside the Freeway's deck at its height. Each is closed where it meets the city: three police
  cars parked across it (the cops' own model) with their light bars lit, a striped barrier in front.
  Both are behind the main road's wall, so nothing about driving changed: you see the roadblock, you
  can't reach it. (A ramp you could drive up would be a road: the road graph, steps 2–3.)


### Street life (2026-10-08)

The owner: "let's add some more details too like some street lamps, maybe some sidewalks, some
shrubs, trees, some neon signs".

- **Pavements:** concrete from the kerb to the buildings along every painted street, a pale kerb
  at its edge (drawn on the ground, as the paint is; none on the main road). They start at the
  widest street at each crossing, so the corners meet.
- **Street lamps, street trees, shrubs:** smashables on open ground (`SmashDef.at`; new kinds
  `street-lamp`, `street-tree`, `shrub`): knocked flat, a little speed lost, a few points, never a
  wreck (a crash ends the run, and a lamp you clip shouldn't). Lamps at the kerb every 34 m, staggered
  side to side, on every street; trees in the Mission (every 16 m), SoMa (22) and the Hills (26);
  shrubs by the doors in the Hills, the Mission and the Financial District. None within 14 m of a
  crossing. 998 lamps, 897 trees, 773 shrubs (the sim's smashable checks: +0.01 ms a step).
- **Neon:** 205 buildings with a sign (`HouseDef.label`): a blade out over the pavement, its
  letters stacked, or across the shopfront on a building too low for one. Chinatown nearly every
  other building (NOODLES, DIM SUM, JADE, LUCKY...), the Mission's TAQUERIA and BAKERY, SoMa's
  CLUB, JAZZ and PAWN, a few HOTELs downtown. Unlit, so they glow at dusk. Each building is turned to
  face its street now (the same box), so its shops and sign are on the street's side.

### The city, detailed (2026-10-08)

The owner: "could we continue detailing the city", with the first cut's list left to do (the
crooked street, cable car, hill tunnel, Dolores park, piers and bay, Ferry Building, mid-Freeway
ramps, the Bank's look, road markings, street traffic).

- **A look per district** (`HouseDef.look`; the skin's `render/skins/greybox/heist.ts`): each
  facade a window a bay across and a storey high, tiled up the building over a ground floor of
  shops, every building of a look one merged mesh (two draws a look):

  | Look | Where | |
  |---|---|---|
  | `tower` | the Financial District | glass between mullions, stone or tinted, a plant room on the tall ones |
  | `chinatown` | Chinatown | painted walls, balconies, red signs over the shops |
  | `victorian` | the Hills, the Mission | painted ladies: pastels, white-framed bay windows, garage doors |
  | `warehouse` | SoMa | brick, steel-framed windows, roll-up doors, water tanks on some roofs |

- **The Bank:** a granite temple at the foot of its tower: steps, six columns, **BANK OF THE BAY**
  over them, a pediment, a flag on the roof. All of it inside the building's solid box: a portico
  out over the pavement would be one you drive through.
- **The bay:** north of Bay Street and east of the Embarcadero, the sea 3 m under the city
  (`GroundDef.sea`, `coast`), behind a sea wall (two `seawall` features, either side of the Ferry
  Building's land). 16 **piers** out into it off the wall, on piles, a shed on each with its number
  over its doors (odd up to **Pier 39** at the wharf, even south; `HouseDef.label`).
- **The Ferry Building:** where Market meets the Embarcadero, out on its own paved quay (a `pad`):
  long, cream, arched windows, its clock tower in the middle with four faces and a copper cupola.
- **Lombard Street:** the Hills' steepest east-west block (25%, on Russian Hill), six planters
  across it from alternate sides: a slalom down (or up) it, 7.5 m between them. Solid, so a wreck.
  The cops know it's blocked (its street is dropped from theirs).
- **Dolores Park:** the Mission's two blocks nearest the top of its hill, lawn instead of paving
  (`CityDef.parks`, driven as `undergrowth`: a short cut that costs a little), palms round its edge
  and across it. Solid: a trunk is a crash.
- **Painted streets** (`GetawayDef.paint`, each street's width per link): crosswalks across each
  end where three or more streets meet, a double yellow down the wide streets (16 m and up: Market,
  Columbus, SoMa), a dashed white line down the rest. Laid on the ground, over each crest.
- **The ground** at 2.5 m cells now (the sea wall's ledge needs them; the crossings' crests are
  sharper too), the grid 245 m past the main road (`wallFrom` 200: no walls, flat out to the
  edge). The bake is 0.9 s, about Paradise Open's. The coast's distance (`island.ts`'s
  `loopDistance`, shared with Coastal and Paradise) now asks only the few segments that can be
  nearest a point's cell: deep in the city, 600 m from the shore, it searched dozens of empty rings
  for every point (the bake was 3 s). Exactly the same distances (a test checks it against the plain
  scan); every other map's fingerprint is unchanged.
- **Still not built, and why:**
  - **The cable car** has to move along a street and be hit: a moving solid the sim knows about,
    as the traffic is. The traffic runs on the main road only, so this is steps 2–3 (streets as
    roads, traffic on them).
  - **A tunnel under a hill:** the ground is a heightfield, so it can't have a hole under it; only
    the main road has tunnels (pieces). Steps 2–3 again (a street as a road, then a tunnel piece).
  - **Ramps partway along the Freeway:** a ramp is a road from a street up to the deck, joining it.
    Branches can do that, but not yet from the open ground of a city street. With steps 2–3.
  - **Traffic on the streets:** steps 2–3.
  - **Street names on signs**; the start line's flags still stand on the main road's grid.

### The city, first cut (2026-10-08)

The owner, after step 1: "this is pretty fun! I think we need to have a quick look back button
like 'q' ... let's continue detailing out the city and building the map." Built on the engine as
it is (the city's streets are still the gaps between its buildings, step 1's way), ahead of steps
2–5: the layout first, to drive and shape, the road graph after. `heist/city` is this city now
(the test grid is gone).

- **Look back on Q** as well as C (B on a pad), held: the camera turns round, the car drives on.
- **The plan** (`tools/gen-heist.ts`; north is -z):

  | Where | What | Streets | Built up with |
  |---|---|---|---|
  | **The main road** | a 3.9 km loop round the city, traffic both ways: **Bay Street** (north), **the Embarcadero** (east, curving down the waterfront past the Ferry Building), **the Freeway** (south), **Van Ness** (west) | 16–20 m, four lanes | walled on its outer side |
  | **The Freeway** | up on a deck 11 m over the city for 660 m, ramps at either end, walled both sides; **under it**, a street along its foot, a wall on its outer side | 18 m | |
  | **Market Street** | corner to corner, Van Ness to the Ferry Building: every grid's streets end on it | 22 m | |
  | **The Financial District** | North of Market, east | the north grid, 14 m | towers, 9–23 storeys; **the Bank** (16) |
  | **Chinatown** | North of Market, middle | the north grid, at 10 m; alleys through nine blocks in ten | narrow lots, 3–6 storeys |
  | **The Hills** | North of Market, west and north: **Nob Hill** (30 m), **Russian Hill** (34 m), **Telegraph Hill** (22 m) | the north grid laid straight over them | 3–5 storeys |
  | **Columbus Avenue** | across North of Market, from near Market up to Bay Street | 16 m | |
  | **SoMa** | south of Market, east | its own grid, turned to Market's line: big blocks | warehouses, 2–4 storeys |
  | **The Mission** | south-west, past **Division Street** | its own grid, turned 7°; **Dolores** (a 16 m hill) | narrow lots, 2–4 storeys |

  1,082 buildings, 59 alleys; the cops' streets 449 crossings, 725 streets.
- **The city's ground** (`features/city.ts`, `CityDef`): paved inside the main road's outer edge,
  the hills under it, and **every crossing level** at the hill's height at its middle, the street
  climbing or falling away from its edge: the crest at each crossing is a jump. Over Nob Hill at
  about 175 km/h a car is in the air off most crossings, up and down. Cut back to the main road over
  50 m. (Its outline test is banded by z: the bake is 0.45 s, 3.7 s with a plain point-in-polygon.)
- **The start:** outside **the Bank** in the Financial District, 35 m from its crossing, facing it
  (`GetawayDef.start`; the rules put you there after the grid). The first two cops come out at the
  crossings behind you, about 100 m back.
- **The cops' streets:** every street, alley, Market, Columbus, the Division, the street under
  the Freeway and the main road on the ground as lines, a node wherever two cross; the Freeway's
  deck a street from foot to foot that crosses nothing. Only the biggest connected part is kept.
  `Streets` finds the houses near a line of sight by a 40 m grid, and A* scans only its open set.
- **Cops, tuned in the city:** coming up on you without seeing you (round a corner), or at heat 1
  at all, a cop is never faster than it could still pull up behind you from: one came round a corner
  at 40 m/s and took the parked getaway car out 4 s in. At heat 1, on your bumper, it holds just
  under your speed (it held you +1 m/s, and shoved a parked car into the Embarcadero's wall). Stopped,
  any cop close by pulls up: being stopped is busted, not a shove.
- **Not yet:** the crooked street, the cable car, the tunnel under a hill, the park at Dolores, piers
  and the bay past the Embarcadero, the Ferry Building, mid-Freeway ramps, the Bank's own look, and
  the street names on signs. The streets still aren't roads (no markings); traffic only on the main
  road.

### Step 1: getaway rules and cops on a test city (2026-10-08)

Experimental: `?mode=race&map=heist/city&seats=p` (any car: `&car=`). Not in the lobby yet.

- **The test city** (`tools/gen-heist.ts`, `content/maps/heist/`):
  - **The Avenue:** the main road, a 2.4 km loop round the city. It has four lanes of two-way
    traffic, is walled on its outer side and open on the city's.
  - **Inside the Avenue:** one patch of unevenly spaced grid, with 271 buildings (solid houses) up
    to the pavement, taller toward the middle. About half the blocks have an alley through them.
  - **A diagonal boulevard** runs corner to corner. Where it cuts the blocks it leaves wedges of
    open paving.
  - **The Bank** stands on the Avenue at the start.
  - **The floor:** the whole city is one level paved pad (`PadDef`), so the streets are the gaps
    between the buildings and you can drive anywhere they leave room.
  - **Not yet:** streets aren't roads yet (no markings; the minimap draws the buildings instead),
    and there's no hill (it waits for step 5's hilly streets).
- **Its streets for the cops** (`TrackLayout.getaway`, `world/streets.ts`): every crossing as a
  node and every street, alley and the Avenue as links (102 nodes and 172 links). The generator
  throws if a building stands across one. `Streets` searches them with A* and checks a line of
  sight against the buildings' boxes, with a car's width to spare.
- **The rules** (`rules/getaway.ts`, wired from `Sim.step`'s rules system as slalom is):
  - **Map-specific:** a race on a map with `getaway`, offline, is you and the cops. The lobby's
    other seats are dropped.
  - **Heat** goes up every 60 s and never comes down. Each level calls out one more cop, from a
    pool of 10 police cars added at the start and kept out of the race (`active` 0) until called.
  - **Calling cops out:** the first two start behind you on green. Later ones come out at a
    crossing out of your sight, 150–340 m off. At heat 1 that's behind you; from heat 2 ahead of
    you too, but never nearer than 220 m.
  - **Cops coming back:** a wrecked or stuck cop comes back out of sight, and so does one more
    than 320 m off.
  - **The end:** any wreck of yours (a reset too) ends the run, and so does being **busted**:
    under 2.5 m/s with a cop within 7.5 m for 2 s. Your wreck stays where it lies (physics.ts holds
    its respawn), your car pulls up, the cops pull up, and laps of the Avenue never finish it.
- **The cops** (`ai/cop.ts`):
  - **Steering:** the pace car's pure pursuit. In sight (160 m, nothing in the way) they aim at
    you, and from heat 2 a little ahead of you (up to 1.2 s). Out of sight they follow the streets
    to where you'll be, cutting corners they can see across.
  - **Speed:** whatever they can still brake from for the next corner, up to a share of your car's
    top speed: 74% at heat 1, past yours at heat 4, and on up from there. They're 12% quicker out
    of sight and over 120 m away, and from heat 3 they boost in on a straight.
  - **At heat 1** a cop on your bumper matches your speed rather than ramming you.
- **The HUD:**
  - **The stats:** Heat where Lap was, then the run's time and your best (on this device:
    `racecar.getaway.<map>`). No position badge.
  - **Calls:** "Heat N!" each minute, and a "Busted ▮▮▯▯▯" warning filling while you're boxed in.
  - **The end screen:** Busted! or Wrecked!, the time you got away for, the heat reached, your
    best ("new best!"), and the cops you took out. Go again is a fresh seed.
- **Music:** the orchestral chase from the title, beside the eight for any map.
- **Numbers:** the race AI driving the getaway car (laps of the Avenue, no traffic, 4 seeds) lasts
  1:22–4:05, heat 2–5, every run ended by a cop takedown. Before cops were called out ahead and
  given their catch-up, it lapped the Avenue for good: lapping it was the way to win. With traffic
  on, the race AI crashes into it inside 20 s, so it's no stand-in for a player there.
- **Tests:** `test/getaway.test.ts`. Every other map's fingerprint is identical. The city's isn't
  recorded while it's experimental.
- **Not yet:**
  - **The start:** the start line and its flags still stand on the Avenue.
  - **Replays:** the F8 snapshot doesn't save the getaway's state, so a getaway's report won't
    replay exactly.
  - **Sirens and lights:** none yet (step 4).
  - **Online:** a getaway from an online lobby was an ordinary race (online getaways: 2026-10-09).
