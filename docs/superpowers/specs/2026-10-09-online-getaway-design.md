# Online getaways on Splash City

The owner's ask (2026-10-09): "can we change the name of Heist to Splash City and make the default
mode chase when you select from the normal menu", then, for online lobbies: "competitive survival
and we add more cops", "each player gets their own cops, but cops will also attack you when
nearby", "watch the rest then shared results", runners can take each other out, and the host
drives the cops.

Today a getaway is single player only: `main.ts` keeps just your car when `layout.getaway` is set,
and `onlineRace` turns the getaway off, so an online lobby on Splash City is a lap race round the
city's outer loop. This spec makes an online lobby race on Splash City a getaway for every runner
in it. Background: [CHASE_MODE.md](../../CHASE_MODE.md) (the mode), [ONLINE.md](../../ONLINE.md)
(lobbies, hosts, entities).

## Decisions (the owner, 2026-10-09)

| Question | Decision |
|---|---|
| The map's name | **Splash City.** The id stays `heist` (bests, links and fingerprints keep working). |
| What an online getaway is | **Competitive survival:** everyone flees in the same city; out is out; the longest run wins. |
| Cops | **Each runner has their own cops**, and any cop goes for a runner who's near, not only its own. |
| Once you're out | **Watch the rest, then shared results** and the usual vote. |
| Runner against runner | **Anything goes:** a takedown by another runner ends your run like any crash. |
| Who drives the cops | **The room's host**, as it drives the AI rivals (`net/rivals.ts`). |

## Done when

- A Splash City race in an online lobby with 2–8 players is a getaway for each of them: their own
  cops, the heat from the race's clock, out on any wreck or busted.
- A cop near another runner goes for them, the same on every screen.
- Out, you watch the runners still going; the results rank everyone by how long they lasted, and
  the vote and next race follow as after any online race.
- Single player (Single player, Quick race, `?start=getaway`, the X card) plays as it does today.

## The rules: one `Getaway`, many runners

`core/rules/getaway.ts` takes a list of runners in place of one `player`:

- **Per runner:** `time`, `busted`, `end` (`'wrecked' | 'busted' | null`) and its pool of cops.
  `heat` stays one number: it's the race's (every runner started on the same green).
- **Pool size:** `min(10, floor((MAX_CARS − runners) / runners))`. One runner: 10 (today's).
  Two: 10. Four: 7. Eight: 3. `MAX_CARS` (`core/sim.ts`) goes from 16 to 32.
- **Out per heat:** `heat + 1` per runner, up to that runner's pool, as today.
- **Call-outs** (where a cop comes out, out of sight, ahead from heat 2) are measured from the cop's
  own runner, as today.
- **Going for the near one:** each cop's `CopDriver.target` is its own runner, unless another runner
  still in the run is within `NEAR_TARGET` (40 m) and in sight (the driver's own `seen` check); it
  goes back to its own once that runner's past `NEAR_TARGET` × 1.5 or out of sight. Busting counts
  any cop near you, whoever it's after.
- **A runner out:** their run's over (their `end` set, their time kept), and their cops are taken
  out of the race (`active = 0`), so the city doesn't fill with idle cops.
- **A remote runner's end** isn't decided here: the screen that drives the car decides its own
  wreck or bust (below). The host's `Getaway` learns it from the runner's entity.

Single player is the one-runner case of this; a test holds today's numbers (pool 10, `heat + 1`
out, the call-out distances, busting) the same.

## Online: the cops as host entities (`net/cops.ts`)

A new layer, `NetCops`, shaped like `NetRivals`:

- Each cop is a host entity, kind `cop`: `CAR_FIELDS`, its runner's seat and slot (`runner`, `k`),
  the race, `active`, its current `target` seat, and the handover (wreck time, cause and tumble,
  boost, last good spot). A cop's driver plans again every 0.5 s and looks every 0.25 s
  (`ai/cop.ts`), so nothing else needs to move with the host role.
- **On the host:** the `Getaway` steps every cop; after each step the layer writes them out.
- **Elsewhere:** before each step, each cop is put where its entity says (predicted forward as
  `net/cars.ts` does for remote cars), `active` and `target` copied in; the screen's `Getaway`
  doesn't drive them.
- **Until the host's cops arrive** (it hasn't connected, or nobody has), every screen drives them
  itself from the same start, as rivals do.
- **The host leaves:** the next host drives them on from where their entities last were.
- Cops are named `c:<runner seat>:<k>` in `net/contact.ts`, so a cop's bump reaches a runner and a
  runner's takedown on a cop (or a cop's on a runner) is credited as for the AIs.

Each runner's own screen keeps deciding their own end, as with wrecks today: a wreck (any cause),
or busted from the cops it sees round it. Their car's entity carries the run's end (`out`: 0 still
going, 1 wrecked, 2 busted) and their time, so other screens and the host see it.

## The race page

`main.ts`:

- `getaway` is on for any race on a map with one, online too (not the attract race). AI seats stay
  out of a getaway: its cast is the players, not the bots.
- Online, the `Getaway` is made with every player's car as a runner; the cops' names (`PD 911`) and
  colours are added per pool as now.
- `OnlineRace` (`net/online.ts`) adds `NetCops` to its layers when the race is a getaway, before
  and after each step like `rivals`.

## Watching once you're out

- Your end card ("You got away for 2:41", busted or wrecked) shows for 3 s, then folds to a strip.
- The camera, HUD and results follow the runner who's lasted longest (`renderer.focus`,
  `hud.focus`, `raceUi.focus`, as the attract race switches them); ← / → (the pad's shoulders)
  cycle through the runners still going.
- The HUD says whose run it is, with their heat and time; the busted bar is only ever your own.

## Results

- A getaway's result row: `time` is how long the runner lasted; rows rank by `time`, longest
  first (a race's rank by time is the other way round). Takedowns and wrecks count as in a race.
- The results and the vote open when every runner's out, or 20 s after only one is left (so the
  best driver can't hold the lobby for ten minutes); the last runner drives on, and their row's
  time comes in when they stop.
- Your best on this device (`racecar.getaway.<layout>`) is single player's; online runs don't
  write it.

## When things go wrong

- A runner whose page goes (disconnect, tab closed) is out at their last time; the host takes
  their cops off.
- An entity that fails its checks (`net/check.ts`, `net/wire.ts`) is ignored, as for rivals.
- 32 cars: the draw-call budget in HANDOFF's table is checked on Splash City with 8 runners and
  their cops, on the hosted build, before release.

## Tests

- `test/getaway.test.ts`: 1, 2 and 8 runners: pool sizes, cops out per heat, a cop going for a near
  runner and back, a runner's cops leaving when they're out, busting by another runner's cop; the
  one-runner numbers unchanged.
- `test/net-cops.test.ts` (with stand-in rooms, as the rivals' tests): the host writes them, others
  read them, the handover drives on from the entity, before-the-host drives them locally.
- Results: a getaway's rows rank longest first; the vote opens on all out or the grace.
- The rename (done): the map name tests and the lobby's name order.

## Not in this

- AI runners in an online getaway (bots fleeing too).
- Players as cops.
- An online leaderboard, or online runs counting toward your best.
- The road graph work in CHASE_MODE's steps 2–3.
