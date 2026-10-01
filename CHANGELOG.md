# Changelog

What changed in each release of racecar, newest first. Releases are git tags on `main`; the
reasons behind each change are in [docs/SPEC.md](./docs/SPEC.md) under "Changed while building",
and where things stand is [docs/HANDOFF.md](./docs/HANDOFF.md).

## Unreleased

- **Fixed:** a player's name with markup in it ran on everyone's results screen. Names are plates
  now, wherever they come from, and the results escape them.
- **Fixed:** a lobby listing or a host's lobby with a bad map or seat could break the lobby list
  or screen for everyone. Everything other players send is checked all through.
- **Fixed:** anyone could drive an AI on everyone's screen by sending one of their own, and other
  players' cars can't be flung at you at any speed.
- The docs are up to date with milestone 3 (README, HANDOFF, SPEC, PLAN, MAPS, CARS).

## alpha-1.19: the AIs online

PR #42.

- **Online, every screen races the same bots.** The room's host drives the AIs and sends them to
  everyone, like a player's car (`rival` entities). When the host leaves, the next one drives them
  on from where they are. Their paint is the same on every screen, and other players now count
  for their catch-up.

## alpha-1.18: P2P and a sturdier online

PRs #37–#40.

- **The title has the crossed chequered flags** (the favicon's) after RACECAR.
- **Away:** a player whose connection drops shows Away in the lobby until they're back.
- **Fixed:** when the room's host role moved (a page load), seats of players who had left weren't
  opened and the listing went stale. A lobby you gave up joining no longer keeps you in its room.
- **docs/ONLINE.md:** how lobbies, hosts, parties and players work, next to Xbox Live's.
- **P2P:** everyone in an online lobby connects straight to each other where they can (each lobby
  is a GameRelay party, with direct connections on). The lobby header says P2P when every pair
  is direct.

## alpha-1.17: The lobby, cleaned up

PR #36.

- **Who can join a lobby: Public, Invite only or Private.** The host clicks the lobby header's
  button to cycle them. Private lets nobody new in; Invite only is the old "private" (by link,
  not listed). Create lobby offers the same three, where Private is you and bots in this browser.
- **A tidier lobby header:** who can join and the invite link. The car count and room code are
  gone.
- **The turntable and your car's panel are centered** on the preview side, and the car sits
  lower and bigger.
- **The lobby says how you're connected** to the others: LAN, Relay or Server.
- **Everyone's ping, in the seats' new Ping column** (yellow from 50 ms, orange from 75, red from
  100), and the ready column is headed Status.
- **Edit your plate from the lobby:** click it in your seat.
- **The seats panel:** open seats say "Random bot", and Start (or Ready) sits over Leave, both
  full width.
- **You start each lobby in a random car and paint.**
- **Only Public lobbies are in the list.** Your own Private lobby isn't either, and it closes
  when you leave it.
- **Quick race starts a race straight away:** you and seven bots on a random map, no lobby.
- **Lobbies everyone left are gone from the list** at once, instead of showing "1/8" until the
  server closes them.

## alpha-1.16: Online fixes and a hosted test build

PRs #34 and #35.

- A single-file build (`bun run build:single`), for hosts that take a game as one HTML file. The
  test build is on asleepace.com's games library: https://asleepace.com/games/Z442EE.
- Online races don't pause when you switch away, and their menu and results have no Restart or
  Race again (only Back to lobby). The lobby shows who's still racing.

## alpha-1.15: Remote cars

PR #33: milestone 3, part 2.

- **Remote cars** (milestone 3, part 2). In an online race you see the other players' cars,
  driven by them, predicted to now so they're where they are. You can bump into them, and only
  their own screen can wreck them. Everyone's lights go green at the same moment, on the server's
  clock, and an online race doesn't pause. The AIs, traffic and results are still each screen's
  own.

## alpha-1.14: Online lobbies

PR #32: milestone 3, part 1.

- **Online lobbies** (milestone 3, part 1). A lobby can be a GameRelay room: listed for anyone,
  or private by its invite link. Others join from the title, and seats, cars, ready and options
  sync. The host's Start takes everyone seated into the same race (same seed), and the room keeps
  each seat through it. Other players' cars don't show in the race yet. Your own lobby, quick
  race and free drive stay in this browser.

## alpha-1.13: Downtown's field wrecks

PR #31.

- Downtown's field wrecks, measured over 16 seeds: 1.0 a race, under MAPS.md's 1.5 (it had been
  quoted as ~1.6). No change to the map; a test holds it.

## alpha-1.12: Landmarks and smashables

PLAN phase 6: landmarks on every map (PRs #26, #28, #29), smashables (#30), and the Valley's
field wrecks (#27). Also the lobby layout and 2 laps by default (#25).

### Fixed
- **Fewer pile-ups on the Valley's home stretch:** traffic no longer appears among the Trestle's
  legs, and the falling sign is gone from the Valley. The AI field wrecks about half as often.

### Added
- **Smashables:** cones and newspaper boxes Downtown, hay bales and mailboxes on Backroads,
  beach umbrellas and fruit stands on Paradise. Drive through them for a burst, a pinch of boost
  and some points. They're back 30 s later.
- **Paradise's landmarks:** a shipwreck in the shallows and a whale breaching beyond it, a surf
  shack, a tiki head at the Lava Tube's mouth, and seaplanes on the lagoon. The lighthouse's beam
  now cuts through a shower's gloom.
- **Backroads' landmarks:** a giant fibreglass cow and a water tower in the village, a
  scarecrow in the corn, a windpump that spins faster in the rain, a drive-in on the flats, and a
  hot-air balloon over the Ridge.
- **Downtown's landmarks:** a clock tower that tells the race time, a billboard showing the
  leader's plate, a fountain plaza and a donut shop in the Market, and a canal under the Skyway
  whose drawbridge lifts for a passing tug.

### Changed
- **The lobby fits the window:** the seats dock left with nothing to scroll, your car turns in
  the middle, and the race's options float top right. Guests see the options as a summary.
- **Cycle your car:** arrows either side of the car (or A and D) cycle it, and W and S (or the
  swatches under it) cycle its paint.
- **Races default to 2 laps.**

## alpha-1.11: Paradise's weather and hazards

PLAN phase 5, part 3: showers, sunset and the sky in the rain (PR #23), and volcano bombs,
coconuts, the re-laid Sandbar, and the Powerglide and Superman HUD tweaks (PR #24).

### Added
- **Tropical showers on Paradise:** with random weather, a shower can roll in partway through a
  race and pass again, with the sun still out and puddles while it lasts.
- **Sunset on Paradise:** a low sun over the sea and a pink-and-orange sky. The lobby has a new
  Time option (Random, Day, Sunset) for maps that have one.
- **Volcano bombs on the Volcano Rim:** glowing rocks arc in from the crater. Rings show where
  they'll land, and then they lie on the road for a while. The Lava Tube skips them.
- **Superman:** boost through the air and the landing pays half as much boost again, with a
  "Superman!" pop.
- **Falling coconuts on Coconut Coast:** the first car past shakes them loose onto the road
  behind it. Run one over and you hop.

### Changed
- **"Drift boost" is now "Powerglide".**
- **The countdown's numbers have a bold outline** (it was barely visible on the night sky).
- **The Sandbar is re-laid:** it now runs straight along the waterline instead of zigzagging, so
  it's quicker and the AI pack no longer piles up at its mouth.
- **The sky clouds over in the rain** on every map: the sun fades behind cloud and the sky goes
  grey (only a little on Paradise).

### Fixed
- Rain no longer falls inside the Lava Tube.

## alpha-1.10: Paradise

PLAN phase 5, parts 1 and 2: the Island's lap, land, sea and freeway (PR #21), and its scenery,
waves and look (PR #22).

### Added
- **Paradise, the third map** (PLAN phase 5, part 1): a tropical island lap, clockwise, 3.44 km.
  Start on the harbour front, then run up Coconut Coast (take the Sandbar along the waterline),
  over the bay on the Freeway, down the Jungle Switchbacks, round the Volcano Rim (or through
  the Lava Tube), and past Lighthouse Point home. It's in the lobby's map picker and swaps in
  behind the car select.
- New surfaces: sand, red earth, lava rock, and wet shoreline.
- The island's land: a sea out to the horizon with surf on the beaches, a volcano with a crater,
  a concrete freeway on pillars over the bay, and a daytime sky.
- Paradise plates: white and teal with a coral PARADISE tag.
- **Paradise's scenery** (part 2):
  - swaying palms along the beaches and over the coast road, and jungle inland;
  - Harbor Town's pastel houses, the tiki bar with torches, and a pier with fishing boats;
  - umbrellas, beach huts and gulls;
  - the volcano's lava pool, glow and smoke plume;
  - the Lava Tube roofed over and lit by lava;
  - a rope bridge and a waterfall in the jungle;
  - the lighthouse with a sweeping beam;
  - signs at the shortcuts, and waves rolling over the shallows.
- **Paradise's look:** a deep blue sky, white sand and a turquoise sea, graded vivid with blue-green
  shadows (a color grade maps can set; Downtown and Backroads are unchanged).

### Changed
- The shortcut signs on Backroads stand on the side the shortcut leaves on (they were on the
  other side).
- The bus accelerates a little harder (13 → 14), so it keeps up on Paradise's fast lap.
- The lap generators share `tools/lib/lap.ts` (the Valley is unchanged).

## alpha-1.9: license plates and the car select

PLAN phase 3: license plates (PR #18), the lobby polish (PR #19), the cars doc (PR #15), the
marketing art (PR #17), and PLAN phase 4: the car select (PR #20).

### Added
- **The lobby is the car select:** the lobby docks left, and your car turns on a table beside
  it with your paint and plate, over the lobby's map. A new car drives up onto the table; a new
  paint swaps in place. Under the car are its name and job, the car and paint pickers, and
  five stat bars (speed, accel, handling, weight, boost). On a phone the car sits above the
  lobby.
- **Your name is a license plate:** up to seven letters, numbers and spaces, set from the plate
  button on the title screen. A new player gets one like `RC 4821`. It's on your car's front
  and rear plates, on your lobby seat and in the results.
- **Every car has plates,** in its map's style: white and navy with a pink DOWNTOWN tag, or
  cream and green with a rust BACKROADS tag, beveled with a border and bolts. They add no draw
  calls.
- **AI rivals go by their plates,** one per class (VANTA 1, BRUTE, ZIPZAP, HAULR 2, CRUZN,
  MUD LRK, RT 88, PD 911), so a seat keeps its rival's plate from race to race.
- The rear plate can come off in a wreck and land on the road, lettering and all.
- **Marketing art and link previews** (PR #17): `poster.html` (dev) stages shots on the real
  tracks with the game's cars, wrecks, particles, skid marks, post pass and ink, frozen at a
  seeded moment; `bun tools/poster.ts` renders them all into `marketing/` through headless
  Chrome. The og:image (`public/og.png`) and Open Graph and Twitter tags are on `index.html`.
- **Favicon and meta** (PR #17): crossed chequered flags (16, 32, 192, 512 and an Apple touch
  icon), a web manifest, canonical URL, theme colour, app titles and JSON-LD; the dev pages are
  `noindex`.
- **docs/CARS.md** (PR #15): how the cars are designed and built, the process, lessons, and adding
  a car.

### Changed
- **Changing the lobby's map changes the race behind it straight away,** without a reload, and
  the lobby's weather shows there too. Behind the lobby the camera is a slow crane down the
  lap rather than a chase camera.
- The AI names (Nova, Rook…) are gone; drivers are their plates.
- **The lobby screen is tidier** (PR #19): capitalised labels, a spaced-out subheader, more room
  under the title, seat rows all the same height, and a roomier map card.

## alpha-1.8: title screen, lobbies, Downtown and Backroads

PRs #14 and #16: phases 1 (the quick wins) and 2 (the title screen and lobbies) of
[docs/PLAN.md](./docs/PLAN.md).

### Added
- **Title screen:** a big RACECAR wordmark over the attract race, the lobby list (each row has a
  map thumbnail, laps, phase, seat pips and cars out of 8), a big **Create lobby** button, and
  Quick race and Free drive.
- **Lobbies:** every race is one now, and bots fill the open seats, so playing alone is your
  lobby with seven of them. Create one with a name, map, laps, weather, mayhem, traffic and
  public or private. The lobby screen is Civilization-style: eight seats, each Player, Open, AI
  (easy, normal or hard) or Closed, set by the host from its row. It has your car and paint with
  their stats, and a map card with the settings. The host has Start, and the others have Ready.
  Lobbies live in this browser for now (online ones come with milestone 3), and after a race you
  land back in yours.
- **Race links carry seats** (`seats=pnnhoxxx`), so a link is still the whole race.
- Esc goes back a screen in the menus.

### Changed
- **Map names:** City is now **Downtown** and Countryside is **Backroads**, in the menu and in
  links (`?map=downtown`, `?map=backroads`, or a full `map/layout` key). Old links, saved choices
  and F8 reports still load.
- **Paint names are one word:** Pink, Cyan, Sunburst, Lime, Violet, Ember, Chrome, Midnight and
  Snow (`hot-pink` is `pink`).
- **HUD:** the race position is now the big badge bottom left, and the lap sits top left (gold
  on the final lap).
- **One style for every control:** buttons, selects and text fields in the menu, the pause
  menu, the results, the F8 form and the in-race menu button share the menu's look. Selects
  draw their own arrow, fields light up cyan when focused, and buttons press in.
- The game is called **Racecar** on the title and the tab.
- The race setup card is gone; its choices are split between Create lobby and the lobby. Old
  links (`opponents`, `difficulty`) still start the race they meant.

### Docs
- **docs/MAPS.md:** how maps are made and what makes a good lap (rhythm, drift corners, width,
  banking, height, shortcuts, traffic, hazards, scenery, measuring, and a new-map checklist).
- **docs/PLAN.md:** the plan for lobbies, plates, the car select screen, Paradise and landmarks.

## alpha-1.7: police car, Trestle legs, air and position boost

PR #13.

### Added
- **The police car is playable:** the Interceptor, the eighth car class. It's fast and heavy
  (66 m/s, 1750 kg with the push bar), for chases and takedowns, and has its own engine sound.
  AI fields now have one of each car.
- **Air-time boost you can see:** a clean landing after at least 0.45 s in the air pays boost
  (0.15 of a bar per second of air) and points, with an "Air 0.8s +12%" pop and a chime. Wreck on
  the way down and it's lost.
- **Boost by position:** boost from drifts and chains, air, near misses, oncoming and traffic
  checks is scaled from ×0.9 for the leader to ×1.35 for last place, so whoever is behind can catch
  up. The start boost, takedowns and the respawn boost aren't scaled.
- **Solid Trestle legs:** the Valley's timber Trestle crosses the home stretch, and its legs on
  the road are now solid. Clip one and you crash. Three rows split the road into two lanes.
  Layouts opt in with `trestles: true`.

### Changed
- The AI's racing line threads the gaps between solid props, easing in over 40 m.
- AI avoidance checks where the car will be when it reaches a threat, not only its target line:
  it used to cut across a slower car's lane into its tail.
- A pinned AI tries the other side of the road after backing out, and can back out again sooner.
- Air boost used to trickle in while airborne with no feedback; it pays on landing now.

### Fixed
- The contact shadow fades out when a car flips, rolls onto its side or leaves the ground. It
  hung off a flipped car like a black box in the air.

## alpha-1.6: drift chains, skid marks, new cars

PR #12.

- **Drift chains:** drifts that start within 1.6 s of the last one link up, bank more boost each
  (up to ×2), and pay a pop when the chain runs out. A spin-out or a wall knock loses the chain.
  A chain bar sits in the HUD.
- **Skid marks:** rubber on the road under sliding, drifting and braking wheels, dark on asphalt
  and churned on dirt and grass, fading out with age and into the fog.
- **New car designs:** the compact, truck and police car, plus the car polish pass (clean ink,
  one detail language, reflective glass). Traffic uses the compact and truck designs.
- **Second review pass:** walls open on the right side at a shortcut's mouth on a curve, replays
  match the live run, audio suspends in a hidden tab, one content loader for tools and tests, and
  more.

## alpha-1.5: Valley v3

PR #10.

- **Valley v3:** re-laid for drifting, with more sweepers, a wider road, corners banked into the
  turn, and grass banks at the edges instead of drops.
- **Smooth shortcut joins:** shortcuts meet the main road flush on every map, with no kerb or
  step across the mouth.
- **HUD:** the key hints moved to the pause menu, and the lap badge is bigger, bottom left.

## alpha-1.4: audio and a review pass

PR #9.

- **Audio:** synthesized engines with gears, tyres, wind, impacts, cues and a music loop.
  M mutes, N toggles music.
- **Review pass:** lap times in world time, photo finishes, AI that gets unstuck, render and UI
  fixes, menus by controller and keyboard. 88 tests.

## alpha-1.3: traffic fades

PR #7.

- Traffic fades in and out at lane sections and after a wreck instead of popping, with
  regression tests.

## alpha-1.2: seven cars

PR #6.

- The sedan, rally car and bus join as racers, all balanced by the lap report.
- Traffic is drawn from the racer designs.
- Also: an mph dial, a menu button, a dry tunnel, more drift boost, and catch-up boost on respawn.

## alpha-1.1: Countryside v2

PR #4.

- The Valley on real terrain: a tighter, higher, mostly-dirt lap with forest, a village, a covered
  bridge and the Trestle, jumps and three shortcuts.

## alpha-1.0: milestone 2, the world

PR #2.

- **World systems:** traffic, weather, hazards (the log truck and the falling sign), a racing AI,
  race phases, and the AI lap report.
- **Races:** single-player races with a setup menu, countdown and results, and a minimap.
- **City v2:** a 3.3 km lap with the Skyway, the Market, the Alley and the Underpass.
- **Visuals:** a cel look with ink outlines, wet reflections, detailed cars with visible wrecks,
  and the garage viewer.
- **Driving:** a drift that banks boost and pays it out on a clean release.

## Milestone 1: greybox sandbox

PR #1.

- A deterministic 60 Hz core sim with track baking, an arcade car with drift and boost, air and
  wrecks, collisions and laps.
- The greybox renderer, HUD, input, editor, tuning panel, telemetry and F8 reports, and CI.
