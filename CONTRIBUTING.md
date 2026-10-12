# Contributing

Thanks for looking. racecar is a small game with a lot of moving parts, so here's how it's put
together and how a change gets in.

## Setup

You need [Bun](https://bun.sh) (CI uses 1.3.13) and a browser with WebGL 2.

```sh
bun install
bun run dev        # http://localhost:5178
```

For online lobbies you need a GameRelay server: the dev build looks for one at
`http://localhost:8787` (`.env.development`). Without one, single player and your own lobby work
as usual. Two tabs are two players.

## Before a pull request

CI runs these four; run them first:

```sh
bun run test                    # use this, not plain `bun test` (it sets a 30 s timeout per test)
bun run typecheck
bun tools/validate.ts --ai      # every layout checked, and an AI must finish it
bun run build
```

- **The simulation is deterministic.** `src/core` is plain TypeScript with its own math, no
  Three.js, DOM or network (a test checks), stepped at a fixed 60 Hz from a seed. Keep it that
  way: no `Math.random`, `Date.now` or allocation per tick in there.
- **The golden fingerprints** (`test/golden.test.ts`) hash every layout's ground and some fixed
  drives. A clean-up shouldn't move them. If your change means to move a map, re-record them with
  `bun tools/fingerprint.ts --update` and say so in the PR.
- **Write the test first** when you can: a bug fix comes with the test that failed without it.
- **A change you can see** (a map, a car, the HUD): put a screenshot in the PR.
  `bun tools/shot.ts` renders any spot on any layout headless, with the dev server running.
- **Match the code around you**: its comments say why, in plain words, and its names are short.

## A map

Read [docs/MAPS.md](./docs/MAPS.md) first: what makes a lap fun, how a lap is laid out, and "A new
map, step by step" at the end. In short: a map is `content/maps/<map>/map.json` plus layouts, and
a layout comes from a generator (`tools/gen-<map>.ts`) rather than hand-placed points, so a
change to the lap is a change to the generator, rerun. The editor (\` in the dev build) is for
looking, measuring and small fixes. `bun tools/lap-report.ts --field` races 8 AIs round each
layout and says where they wreck.

## A car

[docs/CARS.md](./docs/CARS.md), "Adding a car": a design record, its class in `content/cars/`,
and a look in the garage (`/cars.html`) from every side before it goes in a race.

## Bugs

Open an issue with the bug form. The best thing you can attach is an **F8 report**: press F8 (or
Select + Start) just after something feels wrong, and the game saves the last 30 seconds as a
file. `bun tools/replay.ts` replays it headless, so we can see exactly what you saw.

## Online and security

Online play is party-grade: the room's host is trusted, and a modified client can cheat. That's
known ([docs/ONLINE.md](./docs/ONLINE.md)). If you find something that hurts players beyond a
race (their data, their machine, someone else's lobby), please don't open a public issue: use
GitHub's private vulnerability reporting on this repository.

## The music

The code is MIT; the music in `public/music/` is not ([its license](./public/music/LICENSE)). Don't
reuse it outside racecar, and don't send music in a PR unless you made it and want it in under
the same terms.
