# Public polish: no analytics, host controls, credits, privacy and terms

The owner's ask (2026-10-10), getting racecar ready for the public as a way into GameRelay: "I
don't really wanna add analytics anyways, just what we have through gamerelay (I want to dogfood
it)", "a credits page with some details about this project, the source code, game relay, my name
and your name, can just be a fun little screen", "integrate the gamerelay sdk features for host
controls", and "a small privacy policy and terms link at the bottom of the title screen".

## Decisions (the owner, 2026-10-10)

| Question | Decision |
|---|---|
| Analytics | **None.** PostHog goes. Online play sends only what GameRelay needs to run it. |
| Host controls | **Kick, Make host, and Private as a server lock** (the SDK's `kick`, `transferHost`, `setAccess({ locked })`). |
| Banning | **On the second kick:** the first kick lets a player back (friends kick each other for fun); kicking the same player again in that lobby bans them from its room. |
| The name | **Colin Teahan**, in the credits and as who runs the game in the policy and terms. |
| Contact | **GitHub issues** for bugs, **support@gamerelay.io** for private or legal requests. |
| Credits | **A small white box on the title** that opens a page: an animated background and a card with the details. |

## Done when

- No build sends analytics anywhere, and Settings has no Privacy section.
- The lobby's host can kick a player (banned from the room on the second kick) and make another
  player host. A Private lobby's room refuses new joiners at the server.
- A player who's kicked, or can't get in, is told why.
- The title has a Credits box and Privacy and Terms links. Each opens its page in the game, and
  Esc or Back returns to the title. They work in the single-file build too.
- The README, CONTRIBUTING and ONLINE.md say the same as the game.

## 1. No analytics

- Delete `src/telemetry/posthog.ts`, its wiring in `main.ts` (the sink, the opt-out sync),
  `analytics` in `settings.ts`, the Privacy section of `ui/settings.ts` (and the `posthogBuilt`
  argument), and `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` in `env.d.ts`.
- `telemetry.ts` keeps everything else: dev builds' local files, the per-tick trace, and F8
  reports. Its `sink` hook stays if a test or tool uses it; otherwise it goes too.
- A stored `racecar.telemetry` or `racecar.id` in a player's browser is left alone (harmless).
- The README's analytics paragraph becomes: no analytics; dev builds write local files only.

## 2. Host controls

The lobby model (`lobby/lobby.ts`, pure) and the relay layer (`lobby/relay.ts`, on the SDK's host)
split the work as they do now: `apply` decides what's allowed, and relay.ts makes the SDK calls.

### Kick, and the ban on the second

- `Lobby` gets `kicked?: string[]`, the player ids kicked from this lobby. It lives as long as the
  lobby (the room), like an SDK ban.
- `apply(lobby, actor, { type: 'kick', index })` (it exists) also adds the player's id to `kicked`.
  Only the lobby's host may kick, never themselves (as now).
- relay.ts, on the SDK's host: `room.kick(id, { ban, message })` with `ban` true when the id was
  already in `kicked` before this kick. Messages: `"Removed by the host"` and, banned,
  `"Removed by the host, and can't rejoin this lobby"`.
- The lobby screen: on each other player's row, the host sees **Kick** (and **Make host**) in a
  small menu on the row, so neither is a stray click. Not on their own row, not on bots or open seats.

### Make host

- A new action `{ type: 'host'; index }`: only the lobby's host, only to a seated player who
  isn't them. `lobby.host` becomes that player.
- relay.ts: after applying it, if this page holds the SDK's role and the new lobby host is
  connected, `room.transferHost(id)`, so one player holds both. A failure is warned and ignored:
  `apply` checks the lobby's host, so it never matters who holds the SDK's role (ONLINE.md).
- `lobby/wire.ts` checks the new action like the others (an index in range).

### Private is a server lock

- In `relist` (relay.ts), next to the `public` / `linkOnly` sync: `locked` is
  `visibility === 'locked'`, against `room.locked`, through the same `setAccess` call and its rate
  budget. Public and Invite only unlock it.
- Players already in the room stay and can reconnect; `canJoin` keeps its own check.

### Being told why

- Kicked (`closed` with reason `kicked`): back to the title with a toast, the host's message
  ("Removed by the host", or "… and can't rejoin this lobby").
- A join that fails: relay.ts passes the SDK's error code back (now it's warned and dropped), and
  the menu says `banned`: "You can't rejoin this lobby", `locked`: "This lobby is private",
  `room_full`: "This lobby is full", and anything else what it says now.

### The SDK

- `package.json` and `bun.lock` move from `0.1.0-alpha.5` to `0.1.0-alpha.7` (what's installed
  locally; its notes list no break for racecar's calls). `RoomLike` in relay.ts gains `kick`'s
  `ban` and `message`, `transferHost`, `locked` and `setAccess({ locked })`.

## 3. Credits

- The title gets a small white box, bottom right: **Credits**. It opens the credits page.
- **A page in the game, not a file:** the hosted build is one HTML file (`bun run build:single`),
  so a second `.html` wouldn't be there. It's a full-screen layer over the title (like Settings,
  `ui/overlay.ts`), with its own address in the URL hash (`#credits`) so it can be linked, and
  Esc, Back or the pad's B returns.
- **The background:** CSS only, in the soundtrack art's look: a setting sun with bands, a neon
  grid scrolling toward you, palm silhouettes, and now and then a car's tail-lights crossing.
  `prefers-reduced-motion` stills it.
- **The card** (the game's card style, the title font for the heading):
  - **RACECAR**, "an arcade street racer for the browser".
  - Made by **Colin Teahan** and **Claude** (Anthropic): the game was built together, Colin
    directing, Claude writing most of the code.
  - Music: the original soundtrack, by Colin Teahan.
  - Online: **GameRelay** (gamerelay.io), multiplayer for browser games; races travel over
    **Resonance**, its relay network. "racecar is GameRelay's open-source example game."
  - Source: github.com/gamerelay/racecar (MIT).
  - Built with Three.js, TypeScript, Bun and Vite.
  - Links open in a new tab.

## 4. Privacy and Terms

- Two small links under the title's buttons: **Privacy · Terms**. Each opens a page like the
  credits (the same layer and background, `#privacy`, `#terms`), with the text on a card.
- The text lives in one module (`ui/legal.ts`), dated, and also as `docs/PRIVACY.md` and
  `docs/TERMS.md`, the same words, so it can be read and reviewed on GitHub.

**Privacy**, in plain words:
- racecar has no analytics, ads or accounts.
- Settings, your plate and your best times stay in your browser.
- Online, GameRelay runs the lobbies and races: it handles your connection (and so your IP
  address), and passes your plate, car and race to the others in your lobby. Its own policy is at
  gamerelay.io.
- Players in a lobby may connect to each other directly, and can then see each other's IP address.
- Lobby names and plates are shown to other players.
- Questions or requests: support@gamerelay.io.

**Terms**, in plain words:
- racecar is free and provided as is, with no warranty.
- Be decent: names and plates are seen by others. A lobby's host can remove players, and we can
  close lobbies.
- The code is MIT; the music is © Colin Teahan, all rights reserved.
- **Photosensitivity:** the game has flashing lights (sirens, boost, crashes). If you're sensitive
  to them, take care.
- Bugs: GitHub issues. Anything else: support@gamerelay.io.

## Tests

- `test/lobby.test.ts`: a kick adds the id to `kicked`; `host` hands over (not to yourself, not to a
  bot or empty seat, not by a non-host); `wire.ts` reads `host` and refuses a bad index (`test/lobby-wire.test.ts`).
- `test/relay.test.ts` (stand-in rooms, as now): first kick `ban: false`, second `ban: true`;
  `host` calls `transferHost`; Private sets `locked: true` and Public clears it; a join's error code
  reaches the caller.
- `test/ui.test.ts`: the title has Credits, Privacy and Terms; each opens its
  page and Back returns; the kick and make-host menu shows only for the host, on other players.
- `test/settings.test.ts` without analytics; `test/posthog.test.ts` goes with the module, and nothing imports `telemetry/posthog`.

## Not in this

- Name filtering (the owner: no moderation).
- A "relay only" setting to hide your IP from peers.
- Reporting a player, chat, and the owner's dashboard moderation (it already works without the game).
