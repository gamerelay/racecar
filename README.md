# racecar

A cel-shaded arcade street racer for the browser: Burnout 3's crashes, Mario Kart's party, up to
8 players online through [GameRelay](https://gamerelay.io), with long circuits, shortcuts, traffic,
hazards and weather.

**Status: milestone 3 (online) in progress; `main` is tagged `alpha-1.19`.** Three maps
(Downtown, Backroads, Paradise) and 8 cars, against up to 7 AI drivers, with traffic, hazards
(log trucks, a falling sign, volcano bombs, coconuts), rain and passing showers, shortcuts,
takedowns, near misses and drifting. Online, lobbies are GameRelay rooms: other players' cars
show in your race, players connect P2P where they can, and the room's host drives the AIs for
everyone. There's also the level editor, local telemetry and replayable reports. Online play is
party-grade: the room's host is trusted, and a modified client could cheat (SPEC §10, "Trust").
The design is in
[docs/SPEC.md](./docs/SPEC.md); what changed in each release is in [CHANGELOG.md](./CHANGELOG.md),
where things stand and what's next is [docs/HANDOFF.md](./docs/HANDOFF.md), how online works is
[docs/ONLINE.md](./docs/ONLINE.md), how maps are made is [docs/MAPS.md](./docs/MAPS.md), and how
cars are made is [docs/CARS.md](./docs/CARS.md).

## Run it

```sh
bun install
bun run dev        # http://localhost:5178
```

Online lobbies need a GameRelay server. In dev, `.env.development` points at a local one: run
`bun run dev` in the gamerelay.io repo (it serves :8787 with the dev key `gr_pub_dev`), and open
two tabs (each tab is its own player). Without it, the title says it can't reach the lobby
server, and your own lobby still works.

| | Keyboard | Gamepad |
|---|---|---|
| Drive | WASD / arrows | left stick, RT, LT |
| Drift | hold Shift while steering | RB (or X) |
| Boost | Space | A |
| Look back / reset | C / R | B / Y |
| Horn | H | left stick (press) |
| Pause (the controls are listed there) | Esc | Start |
| Sound · music | M · N | |
| Felt wrong? (saves the last 30 s) | F8 | Select + Start |
| Ink outlines on / off | F6 | |
| Editor (dev) · debug · tuning | \` · F2 · F4 | |

Starting a race writes it into the URL
(`?mode=race&map=downtown/downtown&car=hatch&paint=0&seats=pnnnnnnn&laps=2&weather=random&time=random&mayhem=normal&traffic=1&seed=…`):
`seats` is one letter a seat (`p` you, `e`/`n`/`h` an easy, normal or hard AI, `o` open, `x`
closed), `time` is `day`, `sunset` or `random`, and laps default to 2. Old links with
`opponents` and `difficulty` still work. Add `&post=0` (no post pass), `&ink=0` (no outlines) or
`&trace=1` (per-tick trace of your car into telemetry).

## Editing tracks

Press \` in the dev build. Drag control points, set width / lanes / height / bank / shoulder /
surface per point, double-click the road to add a point, Delete to remove, ⌘Z to undo, F to fit,
**P** to drive from the cursor, ⌘S to save into `content/maps/<map>/<layout>.track.json`. Problems
(narrow road, a folded corner, a branch skipping a checkpoint…) show on the map as you edit.
Shortcuts, ramps and zones follow the road when you move points before them.

## Telemetry and reports

Dev builds write events to `telemetry/<day>/<session>.jsonl` (gitignored): laps, wrecks with cause
and place, drifts, air, wall hits, contacts, frame times, errors.

```sh
bun tools/telemetry.ts          # summary of the latest session (--all, --json)
bun tools/replay.ts             # re-run the latest F8 report headless (--trace)
bun tools/validate.ts --ai      # check every layout; the AI must finish it
bun tools/lap-report.ts --field # an 8-AI race per layout: times, wrecks and where
bun test                        # core tests: physics, tracks, determinism, no allocation per tick
```

## Layout

- `src/core`: the simulation. Plain TypeScript, no Three.js, no DOM, no network (a test enforces
  it), so it runs in the browser, tests, tools and, later, bots.
- `src/render`: draws it through a `Skin` (greybox now); `src/audio` synthesizes the sound;
  `src/ui` is the HUD and menus; `src/input` the keyboard and pads; `src/editor` edits layouts
  (dev builds, the backtick key); `src/telemetry` records sessions and F8 reports;
  `src/viewer` is the garage (`/cars.html`).
- `src/lobby`: the lobby model (`lobby.ts`, the host rules as one `apply`), your own lobby or a
  GameRelay room behind one interface (`backend.ts`, `relay.ts`), the P2P party (`party.ts`),
  pings and who's away (`presence.ts`), checking what other players send (`wire.ts`), and plates.
- `src/net`: the online race: players' cars (`cars.ts`) and the host's AIs (`rivals.ts`) as
  GameRelay entities. How it all fits is [docs/ONLINE.md](./docs/ONLINE.md).
- `content/`: cars, paints, surfaces and maps, as JSON.
- `tools/`: validate, the AI lap report, replaying F8 reports, and the map generators
  (`tools/content.ts` loads content for tools and tests).
- `test/`: `bun test`.

Checks: `bun test`, `bun run typecheck`, `bun tools/validate.ts --ai`, `bun run build` (CI runs
all four).

## License

MIT
