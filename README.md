# racecar

A cel-shaded arcade street racer for the browser: Burnout 3's crashes, Mario Kart's party, up to
8 players online through [GameRelay](https://gamerelay.io), with long circuits, shortcuts, traffic,
hazards and weather.

**Status: milestone 2 (the world).** Single-player races on City and Countryside against up to 7 AI
drivers, with traffic, hazards (log trucks, falling signs), rain, shortcuts, takedowns, near misses
and drift mini-turbos; the level editor, local telemetry and replayable reports. Online play is
milestone 3. The design is in
[docs/SPEC.md](./docs/SPEC.md).

## Run it

```sh
bun install
bun run dev        # http://localhost:5178
```

| | Keyboard | Gamepad |
|---|---|---|
| Drive | WASD / arrows | left stick, RT, LT |
| Drift | hold Shift while steering | RB (or X) |
| Boost | Space | A |
| Look back / reset | C / R | B / Y |
| Pause | Esc | Start |
| Felt wrong? (saves the last 30 s) | F8 | Select + Start |
| Editor (dev) · debug · tuning | \` · F2 · F4 | |

The setup screen writes the race into the URL (`?mode=race&map=city/downtown&car=hatch&opponents=7&difficulty=1&laps=3&weather=random&mayhem=normal&traffic=1`);
add `&post=0` (no post pass) or `&trace=1` (per-tick trace of your car into telemetry).

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

`src/core` is the simulation: plain TypeScript, no Three.js, no DOM, no network (a test enforces
it), so it runs in the browser, tests, tools and, later, bots. `src/render` draws it through a
`Skin` (greybox now), `src/editor` edits content, `src/telemetry` records it. Content is JSON in
`content/`.

## License

MIT
