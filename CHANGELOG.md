# Changelog

What changed in each release of racecar, newest first. Releases are git tags on `main`; the
reasons behind each change are in [docs/SPEC.md](./docs/SPEC.md) under "Changed while building",
and where things stand is [docs/HANDOFF.md](./docs/HANDOFF.md).

## Unreleased

- **A road over the ground** (docs/PARADISE.md, step 0): a deck on open ground, the main road over
  the ground beneath it. On the deck you drive on it; over its edge you fall to whatever is below.
  The sea (`ground.sea`) is drawn, and deep water is out of bounds: you respawn on the road.
- **Paradise Open, experimental** (`?mode=free&map=paradise-open/open`, out of the lobby): today's
  island lap as open ground, the Freeway a deck over the bay with its rails. Off the Freeway,
  the right-hander into the jungle and the left-hander after it are banked steeply (14°) into
  themselves, to drift into. The coast, the routes and the volcano come next.
- **Paradise Open is an island:** today's coastline round it (a beach, and deep water past it,
  a respawn), the Freeway over a real bay, and the volcano in the middle: a 95 m cone with its
  crater, the lava lake in it (down in it is a wreck) and the plume. About 2,400 trees, palms along
  the coast and jungle inland, every one solid (what you see is what you hit).
- **Off the road on open ground, slopes pull you** (`TUNING.offroadSlope`): the volcano's ash holds
  you back climbing and runs you down it. Roads keep the arcade's free climbs, snow is unchanged.
- **Rails on open ground are two-sided:** a car outside one (on the sand by a bridge's ramp) is
  kept outside, not snapped onto the road, and a car down under a bridge never meets its rails.
- **Banked turns hold you in, on open ground** (`TUNING.bankHold`): off snow, a banked road bends
  your path toward its low side, so a drift through a banked turn leans on the bank instead of
  running wide. Lapped maps are unchanged.

## alpha-1.30: quieter snow

PR #77.

- **Avalanche: the snow and the avalanche's rumble a little quieter** (about 4.5 dB each).

## alpha-1.29: Avalanche, the first open map

PRs #71–#74.

- **A new map: Avalanche.** The first open map: one 6.1 km run from a summit to a valley, no laps.
  - All the mountainside you can see is yours to drive. Snow pulls you down the slopes, and
    there are no invisible walls: ridges are yours to jump.
  - On the way down:
    - Steep pitches, bunny slopes and short climbs.
    - Moguls and two canyons.
    - Kickers and nine snow-capped rocks.
    - 18 slalom gates that pay boost and points.
    - About 650 solid pines.
    - A ski jump with distance lines.
  - It snows, and your tracks stay in the snow. At chaos, an avalanche comes down behind the
    field and buries whoever it catches, unless they're down in a canyon.
  - The AI rides the canyons too.
  - It races to the four tracks for any map.
- **Backroads: Logger's Leap's kicker is rounded.** It curves up from flat to the same lip and
  height, and rolls back down behind it instead of a sheer drop (it looked like a triangle). Flat
  out you fly about as far; slow, you roll over it rather than off its back.
- **Backroads: Logger's Leap's kicker has sides.** Its rails are gone round it, and its sides are
  grass banks: drive up one from the side and it throws you across the Leap.

## alpha-1.28: the press feel, the title's music and Logger's Leap

PRs #67–#70.

- **Menus:** buttons flash and dip when pressed, by mouse, touch, key or gamepad, with a click
  (a softer one for Back and Cancel); choosers and sliders tick as they move. The clicks follow the
  effects volume, are heard over the title and in the pause menu, and stay silent when muted.
- **Title music from the start** where the browser allows it (a site you've played on a lot, or
  one you've allowed sound on). Where it doesn't, a "Press any key for music" hint (or "Tap for
  music") shows on the title until the first key or click.
- **Backroads: Logger's Leap smoothed and bermed.** Its dirt no longer comes up through the
  Descent's asphalt in a sawtooth where it rejoins. It now rejoins further on, where the Descent
  heads its way, instead of kinking through a tight off-camber left. Its run down to the Descent
  is banked into the turn. On every map, the main road's verge no longer shows through a
  shortcut's mouth in a stripe.

## alpha-1.27: the minimap the right way round

PRs #63–#65.

- **Fix:** the minimap was the track's mirror image (a lap you drive clockwise went round it
  anticlockwise); it's now the same way up as the world, and as the lobby's map thumbnail.
- **Fix:** "Overdrive" pops once per build, not again each time you ease off for a moment.
- **Fix:** a slingshot (or Overdrive) no longer carries through a wreck.
- Docs: what's next from the playtest, a pickup truck and Avalanche (a planned map in the Swiss
  Alps) in PLAN.md, and a pass over the whole codebase for TECH_DEBT.md.

## alpha-1.26: an orchestra for the menus, an acoustic Backroads

PR #62.

- **Two new tracks:** an orchestral one behind the title and the menus, taking turns with the
  title's own, and an acoustic one for Backroads.

## alpha-1.25: Overdrive and the slipstream

PR #61.

- **Boost, a little better all round:** moves pay 20% more of it, a full meter lasts a quarter
  longer, and it pushes a little harder and a little faster (a top speed 35% over the car's,
  from 30%).
- **Past top speed:** hold it flat out and clean on a straight and your top speed keeps climbing,
  up to 6% more over five seconds ("Overdrive"); braking, drifting, leaving the road or a hit ends
  it.
- **Slipstream:** tuck in behind a rival and you're a little faster; stay there a moment, then
  pull out to pass for a slingshot (a burst of speed past them). The AI uses it too.
- The AI no longer boosts into a car or traffic it's getting round.

## alpha-1.24: Paradise reworked, Settings and a real menu

PRs #49–#60.

- **Two new tracks for every map:** Relentless Pursuit and Half Time Surge, in every race's
  playlist beside the map's own tracks and the other two for any map.
- **Paradise, reworked:** deeper S-bends and wider sweepers to drift through, the jungle's
  hairpins opened up, and off the road is the beach, undergrowth or ash, which slows you rather
  than spinning you, with dust, sand or leaves thrown up as you run onto it. Two secret
  shortcuts, not on the map (look for the gap in the jungle where the road bulges up the slope,
  and the sand where the road swings inland out of town). Lava runs down the volcano, and at chaos it
  rains small rocks on the jungle's straight and the run down off the rim. The jungle's road
  looks like earth now, and the trees stand back from the road.
- **No walls jutting into the road at shortcuts:** Paradise's Sandbar, Beach Cut and Smugglers'
  Trail are open to the sand and the undergrowth (the Lava Tube keeps its walls inside the rock),
  Downtown's Alley comes back onto the Boulevard without its wall sticking out, and Backroads'
  Barn track leaves and rejoins the village S without its fence sticking out.
- **The grid starts in your own lane:** where the start has two-way traffic (every map, today),
  the whole grid lines up in the race's half of the road, staggered, so nobody starts facing
  oncoming cars.
- **A loading screen between pages:** going into a race or back to the lobby, the crossed flags
  pulse in the middle of the dark screen until the next page has drawn (at least 0.7 s), and an
  offline race waits behind it, so its countdown starts when you can see it.
- **Fix:** clicking in the lobby (a seat, Ready, a car or paint) no longer plays the whole screen's
  fade-in again; only a change of screen does.
- **Settings** (title → Settings, or the in-race menu): volume sliders (master, music, engines,
  effects), graphics (a Low / Medium / High preset, resolution, post effects, outlines, an FPS
  counter) and an analytics opt-out, kept on this device and applied as they change.
- **A real in-race menu:** the Menu button (and Esc) opens it, instead of quitting straight out:
  How to play, then Resume, Restart, Settings, Controls and Quit stacked at the bottom. The keys
  moved to their own Controls screen.
- **Choosers instead of dropdowns:** the lobby's options and seats cycle (`‹ Downtown ›`) with a
  click, a tap, the arrows or the d-pad.
- **Transitions:** menu screens fade and slide, overlays pop in, and races fade in and out
  through the dark (shorter with reduced motion).
- Two new tracks: a Tokyo dubstep one for Downtown, and a Hawaiian one for Paradise, in those
  maps' playlists beside their own track and the two for any map.
- The mix: engines quieter and the music louder (about 8 dB between them), from playtests.
- docs/MENU.md: the plan for a real in-game menu and settings (sound, graphics, controls with
  remapping, comfort, HUD, privacy), choosers instead of dropdowns, and transitions between screens.
- Short invite links: Copy invite link copies `https://play.gamerelay.io/racecar/<link>`, which
  previews in chat apps with the lobby's name and the cover art and opens the game straight into
  the lobby (`?join=<link>`). An Invite only lobby is now link-only: its code doesn't get anyone
  in, so nobody joins by guessing one (a player who had a seat still comes back). SDK 0.1.0-alpha.5.
- **Fixes from a code review:**
  - **Flicker:** the clock tower's dials no longer flicker through the stone from a distance. The
    same fix (more room between the surfaces, and lit signs drawn forward in the depth test) went
    to the start line's checkers, the road markings, the trench and tunnel edges, the fountain's
    water, the donut shop's windows, the cow's sign and the drawbridge stripe.
  - **Sound:** muting (M), or the in-race menu online, no longer plays everything that happened
    meanwhile in one burst when the sound comes back. Unmuting starts the music again on iOS
    without a second tap.
  - **Menus:** Esc during an online join or create no longer leaves you on a dead lobby screen.
    Settings and Controls hold the keyboard while they're up (Tab can't reach the buttons behind
    them), and closing them puts focus back where it was, even after the title's list refreshes.
  - **Gamepad:** with the F8 form up, the pad works the form rather than the menu under it.
  - **F6 (outlines)** goes through Settings, so the panel agrees and a slider doesn't undo it.
  - **Analytics:** Off holds for the page even where the browser blocks storage.
  - **Online:**
    - A short link that's slow to join no longer leaves you in the room unseen.
    - Copy invite link on an Invite only lobby says when it couldn't get the link, instead of
      copying a code link that can't get anyone in.
    - The race page stops pinging the room every 3 s.
    - A plate the menu would refuse, sent by a modified page, shows as a stock plate.
  - **Tests:** 61 more, for the fixes above and code that had none (the audio's events, the
    music, the lobby's messages, the input, the spline, the settings). 391 in all.
- Internal: the race's online code tidied (one place for its message checks and its clock, and
  the race page's online part out of main.ts: `src/net/online.ts`). No change in play.

## alpha-1.23: a vote on the next race

PR #48.

- **Online, a vote on the next map** after each race, on the results screen: 15 s once everyone's
  in, the host breaks a tie, then straight into the next race together. "Back to lobby" sits you
  out of it.
- **Online, one results table** for everyone: each car's result comes from the screen that drives
  it.

## alpha-1.22: online races that agree

PRs #46 and #47.

- **Online, a host in a background tab no longer freezes the AIs** for everyone: an online race
  steps on GameRelay's tick (a timer that keeps going in hidden tabs) instead of on animation
  frames. Your own car coasts while your tab is hidden.
- Coming back to the tab doesn't play what happened meanwhile all at once, and if you finished
  while away, the results are there.
- **Online, everyone sees the same traffic** (it was up to 20 m apart between screens), and a
  traffic car you wreck is wrecked for everyone.
- **Online, takedowns count for the attacker** (boost, points, "Takedown!"), not only on the
  victim's screen, and a bump only one screen saw still pushes both cars.

## alpha-1.21: the music from the games CDN

PR #45.

- **The music plays on the hosted build too**, from the games CDN (https://cdn.gamerelay.io, in
  front of a DigitalOcean Space's `assets/`). `tools/publish-assets.ts` uploads the tracks.

## alpha-1.20: the soundtrack, and a cleanup pass

PRs #43 and #44.

- **Music:** the game has its own soundtrack, in place of the synth loop: a track for the title
  and menus, and in a race the map's own (Downtown, Backroads, Paradise) or one of two that go on
  any map (Finish Line, Final Sprint), never the same song twice in a row. N still toggles it.
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
