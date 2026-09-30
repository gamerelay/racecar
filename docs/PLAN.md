# Plan: lobbies, names, polish, and Paradise

The next batch of work, from the playtest notes of 2026-09-30. Each phase is one PR with CI, and
builds on what's there: the lobby design in SPEC §11, the Valley's generator for the new map,
the Trestle and the City's decks for Paradise's freeway. Decisions made while building go in
SPEC "Changed while building", and each merged phase goes in CHANGELOG "Unreleased".

The idea behind all of it: the game works because many small systems add up (drifts that chain,
air that pays, traffic to thread, legs to dodge, rivals to wreck), so every phase should also
leave a few small details behind.

## Decisions (answered 2026-09-30)

1. **The title is Racecar**: a RACECAR wordmark on the title screen.
2. **Lobbies ship locally first** (your lobby with bots, fully playable); online lobbies plug in
   once GameRelay PR #30 is deployed, when the owner approves it.
3. **The car select screen** puts everything on one screen, like other racing games: the menu
   docks left, your car sits centre-right, and the selected map runs behind as the preview, so
   picking a map, a car or a paint shows it at once.
4. **One style for every control:** buttons, selects, inputs and text fields share the menu's
   style, including the in-race menu button, the pause menu and the results screen.
5. **Renames change the ids too** (`city/downtown` → `downtown`, `hot-pink` → `pink`), and old
   links, saved choices and F8 reports keep working through aliases.
6. **Plates:** on the car, in lobbies and results; names over cars only online, only up close.
7. **Paradise is dynamic:** sunny day, a tropical shower that can roll in and out, and a sunset
   variant.

## Phase 1: quick polish (one small PR) — done, PR #14

- **Map names:** "City" becomes **Downtown**, "Countryside" becomes **Backroads**. One name per
  map; the layout name moves into its blurb. Ids change too, with aliases for old ones.
- **Paint names:** one word, no hyphens, in both `name` and `id` (`hot-pink` becomes `pink`);
  old URL and saved values map across.
- **HUD:** swap the lap badge (bottom left) with the position card (top left). The position
  card gets the big type, since it changes more.
- **Controls:** one style (primary, ghost and danger buttons; selects, inputs and text fields)
  used by the title, lobby, pause, results and the in-race menu button.
- **MAPS.md:** map design and techniques, written from what building Downtown and the Valley
  taught us (outline below). It comes before Paradise so Paradise follows it.
- **Tests:** old ids still resolve, and every paint and map name is a single word.

## Phase 2: title screen and lobbies (local first) — done, PR #16

One flow for everyone: **every race is a lobby**, and bots fill the open seats. Playing alone
is a lobby with seven bots.

```
┌ RACECAR ─────────────────────────────────────────── [Garage] [Settings] [PLATE ✎] ┐
│                                                                                   │
│   LOBBIES                                              filter: [all maps ▾] [open] │
│   ───────────────────────────────────────────────────────────────────────────────  │
│   ▣ Friday wrecks        Downtown   · 3 laps   in lobby    ●●●●○○○○  4/8   [Join]  │
│   ▣ asleepace's lobby    Paradise   · 5 laps   racing L2   ●●●●●●●○  7/8   [Watch] │
│   ▣ kev + friends 🔒     Backroads  · 3 laps   in lobby    ●●●●●●○○  6/8   locked  │
│                                                                                   │
│   ┌─────────────────────────── CREATE LOBBY ───────────────────────────┐          │
└───┴────────────────────────────────────────────────────────────────────┴──────────┘
```

- **Title screen:** the wordmark over the attract race, then the lobby list. Each row shows
  the name, the map (with a small minimap thumbnail), laps, phase, filled seats as pips, and
  players out of 8. A big **Create lobby** button sits at the bottom.
- **Create lobby:** name (prefilled "‹plate›'s lobby"), map, laps, weather, mayhem, traffic, and
  public or private.
- **Lobby screen, Civilization-style:** 8 seats, each **Player**, **Open**, **AI** (easy / normal /
  hard) or **Closed**. The host sets each seat from its row. Each row shows the car, paint,
  plate, ready and ping. The map card sits on the right with its settings. The host has Start,
  the others Ready; everyone can change car.
- **Model:** a `Lobby` in `src/lobby/` (name, host, map, options, seats) with two backends:
  - `local`: in memory; the only one until milestone 3.
  - `relay`: GameRelay rooms with `setListing` and `listRooms` (PR #30), in milestone 3.

  The screens only see the model. Starting a race turns the seats into `specs`, as
  `main.ts` does today.
- **Until online lands:** the list shows your local lobby and a "Online lobbies arrive soon"
  row, not fake rooms.
- **Tests:**
  - seats become the race's cars (AI seats get their difficulty, closed seats get nothing);
  - the host rules (only the host changes seats);
  - old `?mode=race` links still start a race.

## Phase 3: names and license plates — done, PR #18

- **A plate name:** up to 7 characters, A–Z, 0–9 and a space, uppercase, with a small
  blocklist. It's set on the title screen (the plate button) and kept in localStorage. It's also
  your display name in lobbies and results.
- **On the car:** the rear plate (the one the chase camera sees) and the front one are drawn
  from one small canvas atlas for all eight cars. Each plate has a bevel, a border, and a region
  tag per map ("DOWNTOWN", "BACKROADS", "PARADISE").
- **AI plates:** picked from a list with character ("BRUTE 1", "ZIPZAP", "MUD LRK", "RT 88"), one
  per class and seeded, so a rival keeps their plate across races.
- **Wrecks:** the plate flies off as one of the detachable parts sometimes, and lands on the road.
- **Online (milestone 3):** the plate is in your player data. A name floats over a car only
  within ~60 m, and fades with distance.
- **Tests:** plate text rules (length, charset, blocklist, uppercase); the atlas gives each car a
  cell.

## Phase 4: car select on one screen

- The menu docks to the left third. Your car sits centre-right on a slow turntable, with your
  paint and plate. It swaps live as you change car or paint, and a short drive-up plays when
  you pick a new car. The selected map runs behind it as the preview, and changes when you pick
  another map.
- It reuses the garage's car build and the game's post pass, so the preview matches the game.
- Stat bars next to the car (speed, accel, handling, weight, boost), from the class numbers.
- On a phone the preview stacks above the menu.

## Phase 5: Paradise

A tropical island in daytime. Sunny, with palm trees, beaches and sand, a volcano in the
middle, and an elevated freeway along part of the coast. Curvy all the way round, with wide
roads and elevation changes.

**The lap** (target 3.3–3.8 km, hard-AI floor around 70 s; clockwise):

1. **Harbor Town:** the start, a pastel harbour town with a tiki bar, fishing boats and a pier.
   Two-way traffic.
2. **Coconut Coast:** a wide beach road, 18–20 m wide. Long banked sweepers along the sand,
   with palms leaning over the road and surf breaking beside it. The **Sandbar** shortcut cuts
   across the beach on loose sand.
3. **The Freeway:** a ramp up to an elevated deck on pillars, 10–14 m up, sweeping round the
   bay. It's banked, has traffic, and gives a view of the whole island. It reuses the City's
   deck-on-pillars, made general.
4. **Jungle Switchbacks:** down into dense jungle. Tight but wide hairpins on dirt and
   red-earth, past a waterfall and a rope bridge overhead.
5. **Volcano Rim:** the climb, on black lava rock, round the cone with smoke from the crater
   and a lava glow at the rim. **The Lava Tube** shortcut runs through a glowing tunnel.
   Crests and a jump off the rim.
6. **Lighthouse Point:** the descent past the lighthouse to a cliff road, with a flowing
   S back into town.

**Map details:**
- **Surfaces:** asphalt, sand (loose, low grip, like dirt), red earth, lava rock (grippy),
  and a wet shoreline zone.
- **Hazards:**
  - **volcano bombs:** a new scheduled moment, where glowing rocks land on the rim road; shared
    online like the falling sign;
  - **falling coconuts** on the coast, a small trigger.
- **Weather and time:** sunny day, a tropical shower that can roll in and pass mid-race (sun
  still out, puddles while it lasts), and a sunset variant of the palette.
- **Traffic:** town and freeway only, with sections on straights as MAPS.md says.

**How to build it:**
- **Generator:** `tools/gen-paradise.ts`, the Valley's generator made general: filleted arcs,
  corners banked into the turn, widths growing through corners, smoothing by distance, crests
  anchored to samples. A shared `tools/lib/lap.ts` comes out of `gen-countryside.ts` first.
- **Terrain:** an island heightfield that follows the banked road, like the Valley's. A sea
  level, a beach band, a volcano cone with a crater, and lagoon cut-outs. The layout's
  `terrain` gains `sea`, `island` and `volcano` fields.
- **Water:** a sea plane to the horizon, with shore foam where the land meets it, a lagoon
  tint, and waves on the beach (vertex shader). It reuses the river's mirror.
- **Palette:** `tropic`. High sun, a hard-edged toon ramp, turquoise sea, white sand, deep
  greens. The ink pass is kept.
- **Scenery:** `island.ts`, with instanced palms (swaying in the vertex shader), beach
  umbrellas, huts, jungle clumps, lava rocks, and the smoke plume and glow.
- **The Freeway:** `deckMask` and the pillars come out of `cityscape.ts` into `track.ts`, for
  any map; the deck gets a concrete railing in Paradise.
- **Tuning:** the lap report sets the lap floor and AI wrecks per race (target ≤ 1.5); class
  balance holds within ±5%; sweeps place the hazards, as was done for the falling sign.
- **Tests:** land below every road, the freeway is a deck, shortcuts join flush, the hard lap
  flies the jumps and takes the shortcuts clean, corners bank into the turn, the road is wide
  enough, the lap floor and wrecks are in range, and the sea is below the road everywhere.

## Phase 6: landmarks (every map)

Small, distinct things you remember a lap by. They're built from the track and the same every
race; some move, and a few you can hit.

- **Downtown:**
  - a clock tower whose clock shows the race time;
  - a giant donut on a donut shop roof;
  - a fountain roundabout in the Market;
  - a billboard showing the current leader's plate;
  - a drawbridge over the Underpass river channel (decor).
- **Backroads:**
  - a windmill turning with the wind;
  - a giant fibreglass cow at the village;
  - a water tower with the town name;
  - a drive-in screen on the flats;
  - a scarecrow;
  - a hot-air balloon drifting over the Ridge.
- **Paradise:**
  - the lighthouse, whose beam sweeps through a shower's gloom;
  - a shipwreck on the beach;
  - a tiki head at the Lava Tube mouth;
  - a surf shack with boards;
  - a whale breaching offshore every few minutes;
  - seaplanes on the lagoon.
- **Smashables** (small props on the verge that burst when hit and pay a pinch of boost):
  - Downtown: cones, newspaper boxes;
  - Backroads: hay bales, mailboxes;
  - Paradise: beach umbrellas, fruit stands.

  These live in the sim as cheap pieces, like hazard pieces, so they're the same online.

## MAPS.md (outline, written in phase 1)

1. **What makes a lap fun:**
   - rhythm (sweepers to drift, a breather straight, a jump, a shortcut, a fight spot);
   - straights under ~350 m;
   - a corner every 100–150 m;
   - wide roads where you want fights, narrow ones where you want commitment;
   - traffic on straights, never in corners;
   - one signature moment per section.
2. **Laying out a lap:**
   - generators, not hand points;
   - nodes filleted into arcs;
   - widths that grow through corners;
   - corners banked into the turn, rolling over at under 0.5° per metre;
   - smoothing by distance, not by sample;
   - crests anchored to samples.
3. **Height and land:**
   - terrain that follows the banked road;
   - grass banks at 1:2.5 instead of drops;
   - bridges and decks by height and run length;
   - trestles and pillars that stand where they're drawn (`supports`);
   - laps that cross themselves.
4. **Shortcuts:**
   - slip points and `joinBranch`, so they meet the road flush;
   - forks under 35°;
   - walls open on the right side;
   - the AI's choice to take them;
   - checkpoints outside every shortcut's span.
5. **Traffic, hazards and props:**
   - lane sections that start and end on straights;
   - hazards at readable spots, placed by lap-report sweeps (the falling-sign study);
   - solid props and how the AI threads them.
6. **Scenery and landmarks:**
   - built from the track;
   - deterministic;
   - draw-call budgets and instancing;
   - one landmark per section.
7. **Measuring:**
   - `validate --ai`, the lap report (floors, sections, AI wrecks per race, seeds);
   - class balance;
   - what "good" numbers look like.
8. **A checklist for a new map.**

## Other ideas worth considering

- **Stunt air:** a barrel roll or flat spin in the air pays extra on a clean landing, with a
  "Barrel roll!" pop. It builds on the air boost; the aftertouch already lets you tilt.
- **Signature hazards per map** as shared moments: volcano bombs on Paradise, a cattle crossing
  on Backroads, the drawbridge rising on Downtown (a jump when it's half up).
- **Rivals:** whoever took you down last gets a red marker over their car and on the minimap
  until you get revenge (the revenge takedown already exists).
- **Race-time flavour:**
  - Downtown at dusk or night;
  - Paradise at noon or sunset;
  - weather that can arrive mid-race (a shower rolling in).
- **Map vote cards** with a thumbnail rendered from each layout, for the between-race vote in
  SPEC §11.
- **Ghost of your best lap** in free drive, and a daily seed with a leaderboard (GameRelay
  already has leaderboards).
- **Crowd and ambience that react:**
  - seagulls scatter as you pass;
  - villagers wave;
  - traffic honks after a near miss;
  - the tiki bar cheers when you fly past.

## Order and size

| Phase | Size | Depends on |
|---|---|---|
| 1. Quick polish, MAPS.md | small | — |
| 2. Title screen and lobbies (local) | medium-large | 1 (button style) |
| 3. Names and plates | medium | 2 (the plate button, names in lobbies) |
| 4. Menu with car preview | medium | 2, 3 |
| 5. Paradise | large (3–4 PRs: generator and land, water and palette, scenery and freeway, hazards and tuning) | 1 (MAPS.md) |
| 6. Landmarks and smashables | medium, per map | 5 for Paradise's |

Phases 2–4 (the front door) and 5 (Paradise) don't touch each other, so they can run side by
side.
