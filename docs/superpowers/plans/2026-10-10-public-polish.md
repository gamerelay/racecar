# Public Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** racecar ready for the public: no analytics, the GameRelay SDK's host controls in the lobby (kick, banning on the second, make host, Private as a server lock, told why you're out), and a Credits page plus Privacy and Terms from the title.

**Architecture:** The lobby rules (`lobby/lobby.ts`, pure) decide what's allowed and keep who's been kicked in the lobby itself; `lobby/relay.ts` (on the SDK's host) turns that into SDK calls (`kick`, `transferHost`, `setAccess`), and records why a join or a room ended for the menu. The new screens are one `Overlay` (`ui/pages.ts`) with pure HTML builders; the privacy and terms text is `docs/PRIVACY.md` and `docs/TERMS.md`, imported with `?raw` and drawn by a small escaped renderer (`ui/legal.ts`).

**Tech Stack:** TypeScript, Bun tests (`bun run test`), Vite, `@gamerelay/sdk` 0.1.0-alpha.7.

**Spec:** `docs/superpowers/specs/2026-10-10-public-polish-design.md`

## Global Constraints

- Run tests with `bun run test` (30 s timeout per test), never plain `bun test` for the suite.
- No analytics in any build; dev builds keep writing local telemetry files, and F8 reports stay.
- Messages, verbatim: `Removed by the host` (first kick), `Removed by the host, and can't rejoin this lobby` (second), `You can't rejoin this lobby` (`banned`), `This lobby is private` (`locked`), `This lobby is full` (`room_full`).
- Names: **Colin Teahan**, **Claude** (Anthropic). Contact: **support@gamerelay.io**; bugs: GitHub issues (github.com/gamerelay/racecar).
- Pages open from the query: `?page=credits`, `?page=privacy`, `?page=terms`. No `#hash` routes.
- Everything another player wrote, and every docs file, reaches the page as text (`esc`), never as raw HTML.
- Comments in the code's own voice: plain words, say why. No `Math.random`/`Date.now` in `src/core` (untouched here).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A player kicked twice across a host change** must still be banned on the second: `kicked` lives in the lobby (room state), not in the old host's memory. (Task 3 test.)
2. **The race page coming back into a Private (locked) room** must get in: a locked room still lets its own players reconnect. (Task 2 test.)
3. **A lobby state from an older build** (no `kicked`, or a junk `kicked`) must still read, with junk dropped. (Task 3 test.)
4. **A docs file with markup or a `javascript:` link** must render as text, links only `https:` or `mailto:`. (Task 7 test.)
5. **Make host to a player whose connection is down** must still hand over the lobby, and not call `transferHost` (it needs a connected player). (Task 4 test.)

---

### Task 1: No analytics

**Files:**
- Delete: `src/telemetry/posthog.ts`, `test/posthog.test.ts`
- Modify: `src/settings.ts` (drop `analytics`), `src/ui/settings.ts` (drop Privacy and `analyticsBuilt`), `src/main.ts` (imports, lines ~70, ~224–226, ~344–350), `src/env.d.ts` (drop `VITE_POSTHOG_*`), `src/telemetry/telemetry.ts` (drop `sink`), `test/settings.test.ts`

**Interfaces:**
- Produces: `Settings` without `analytics`; `new SettingsPanel(store)` (one argument).

- [ ] **Step 1: Change the settings test first**

In `test/settings.test.ts`, the "what's wrong in what's stored" test: keep the stored `analytics: 'no'` in the JSON (an old setting) and replace `expect(s.analytics).toBe(true);` with:

```ts
    // An old build's analytics setting is ignored (there are no analytics).
    expect('analytics' in s).toBe(false);
```

In the "a change is saved" test, replace the blocked-storage lines with:

```ts
    // Blocked storage: the change still lasts the page.
    const b = new SettingsStore(blocked);
    b.set({ graphics: { fps: true } });
    expect(b.get().graphics.fps).toBe(true);
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test test/settings.test.ts`
Expected: FAIL (`'analytics' in s` is true).

- [ ] **Step 3: Take analytics out**

`src/settings.ts`: delete the `analytics` field and its doc comment from `Settings`, `analytics: true` from `DEFAULT_SETTINGS`, `& { analytics?: unknown }` from `parseSettings`'s `s` type, and the `analytics: bool(s.analytics, d.analytics),` line. Change the header's "privacy" mentions if any to match.

`src/ui/settings.ts`: the constructor takes only `store`; delete the `analytics` const, the `<h2>Privacy</h2>${analytics}` lines and the `on('sAnalytics', …)` line. The file's first comment line becomes `// The Settings panel (docs/MENU.md): sound and graphics, over whatever's on screen: the`.

`src/main.ts`:
- delete the `posthog` import line;
- delete `// Analytics turned off before there were settings …` and the line after it;
- in `settings.onChange`, delete `setTelemetryOptOut(!s.analytics);` and change its comment to `// Settings apply as they change: the volumes and the graphics.`;
- `const settingsPanel = new SettingsPanel(settings);`
- delete the `// Dev builds write local files; playtest builds…` block (the `if (!import.meta.env.DEV || params.get('posthog') === '1') { … }`);
- the comment above `const settings` becomes `/** The player's settings (sound, graphics), on this device. */`.

`src/telemetry/telemetry.ts`: in `flush`, delete the `if (this.sink) { … }` block; delete the `sink` field and its comment; the header's "PostHog in playtest builds" clause goes (it writes to the dev server only).

`src/env.d.ts`: delete the two `VITE_POSTHOG_*` lines.

Delete `src/telemetry/posthog.ts` and `test/posthog.test.ts` (`git rm`).

- [ ] **Step 4: Check nothing's left**

Run: `grep -rni "posthog\|analytics" src test tools; bun run typecheck && bun run test test/settings.test.ts`
Expected: no grep hits in code (docs may still mention it; Task 9), typecheck clean, settings tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "No analytics: PostHog, its setting and the Privacy section go (dev builds still write local telemetry; F8 stays)"
```

---

### Task 2: The SDK, and Private as a server lock

**Files:**
- Modify: `package.json`, `bun.lock` (SDK `0.1.0-alpha.7`), `src/lobby/relay.ts` (`RoomLike`, `relist`), `test/relay.test.ts` (the fake room)

**Interfaces:**
- Produces: `RoomLike.locked?: boolean`; `RoomLike.setAccess(access: { public?: boolean; linkOnly?: boolean; locked?: boolean })`; `RoomLike.kick(playerId, options?: { ban?: boolean; message?: string })`; `RoomLike.transferHost?(playerId: string): Promise<void>`. In the test file: `FakeRoom.locked`, `FakeRoom.banned: Set<string>`, `FakeRoom.kicks: { id: string; ban: boolean; message?: string }[]`, and `joinRoom` rejecting with an error whose `code` is `'banned'` or `'locked'`.

- [ ] **Step 1: Bump the SDK**

Run: `bun add @gamerelay/sdk@0.1.0-alpha.7 --exact`
Expected: `package.json` has `"@gamerelay/sdk": "0.1.0-alpha.7"`, and `bun.lock` too.

- [ ] **Step 2: Teach the fake room locks, bans and handing over**

In `test/relay.test.ts`, `FakeRoom` gains:

```ts
  /** Nobody new may join (`setAccess({ locked })`); its own players can come back. */
  locked = false;
  /** Who's banned from it (a kick with `ban`), until it closes. */
  banned = new Set<string>();
  /** Every kick, as the host sent it. */
  kicks: { id: string; ban: boolean; message?: string }[] = [];
```

`FakeClient` gains a `locked` getter and `setAccess` honours it, `kick` records and bans, and `transferHost` moves the role (the hub's host is the first connected member):

```ts
  get locked() {
    return this.room.locked;
  }
```

In `setAccess`, after the `linkOnly` line: `if (access.locked !== undefined) this.room.locked = access.locked;` and widen its parameter type to `{ public?: boolean; linkOnly?: boolean; locked?: boolean }`.

Replace `kick` with:

```ts
  async kick(playerId: string, options: { ban?: boolean; message?: string } = {}): Promise<void> {
    if (playerId === this.me) throw new Error("the host can't kick itself");
    const c = this.room.members.find((m) => m.id === playerId);
    if (!c) return;
    // The SDK bans by default.
    const ban = options.ban ?? true;
    this.room.kicks.push({ id: playerId, ban, message: options.message });
    if (ban) this.room.banned.add(playerId);
    c.fire('closed', 'kicked', options.message);
    this.room.remove(c);
  }
  async transferHost(playerId: string): Promise<void> {
    if (!this.isHost) throw new Error('not_host');
    const c = this.room.members.find((m) => m.id === playerId && m.connected);
    if (!c) throw new Error('player_not_found');
    const was = this.room.host!;
    this.room.members = [c, ...this.room.members.filter((m) => m !== c)];
    this.room.emit('host_changed', c.id, was.id);
  }
```

In `FakeRelay.joinRoom` and `joinLink`, before entering as a newcomer (after the `back` reconnect check in `joinRoom`; in `joinLink` replace the one-liner with the same order):

```ts
    if (room.banned.has(this.playerId)) throw Object.assign(new Error('banned'), { code: 'banned' });
    if (room.locked) throw Object.assign(new Error('locked'), { code: 'locked' });
```

`joinLink` becomes:

```ts
  async joinLink(link: string): Promise<RoomLike> {
    const room = [...this.hub.rooms.values()].find((r) => linkOf(r.code) === link);
    if (!room) throw new Error('not_found');
    const back = room.members.find((m) => m.id === this.playerId);
    if (back) return back;
    if (room.banned.has(this.playerId)) throw Object.assign(new Error('banned'), { code: 'banned' });
    if (room.locked) throw Object.assign(new Error('locked'), { code: 'locked' });
    return this.enter(room);
  }
```

- [ ] **Step 3: Write the lock test**

In `describe('online lobbies', …)`, after the kick test:

```ts
  test('Private locks the room at the server: nobody new gets in, its own players come back, and Public opens it', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'locked' });
    await new Promise((r) => setTimeout(r, 1100));
    const room = hub.rooms.get(lobby.id)!;
    expect(room.locked).toBe(true);
    // A stranger is refused by the server, not only by the lobby's rules.
    expect(await cy.backend.get(lobby.id)).toBeNull();
    // Bo's race page coming back (a reload) still gets in.
    room.members.find((m) => m.id === 'bo')!.connected = false;
    expect(await bo.relay.joinRoom(lobby.id)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'public' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(room.locked).toBe(false);
  });
```

- [ ] **Step 4: Run it to see it fail**

Run: `bun run test test/relay.test.ts -t "Private locks"`
Expected: FAIL (`room.locked` is false: nothing sets it).

- [ ] **Step 5: Lock it in `relist`**

`src/lobby/relay.ts`, `RoomLike`: add

```ts
  /** Nobody new may join (`setAccess({ locked })`); its players can still come back. On an SDK that has it. */
  readonly locked?: boolean;
```

change `setAccess` to `setAccess(access: { public?: boolean; linkOnly?: boolean; locked?: boolean }): Promise<void>;`, `kick` to `kick(playerId: string, options?: { ban?: boolean; message?: string }): Promise<void>;`, and add

```ts
  /** Hand the SDK's host role to a connected player (everyone hears `host_changed`). */
  transferHost?(playerId: string): Promise<void>;
```

In `relist`'s `send`, replace the two lines from `const listed = visibility === 'public';` through the `setAccess` call with:

```ts
      const listed = visibility === 'public';
      // Private is the server's lock too, so a modified page can't walk in (players in it can still come back).
      const locked = visibility === 'locked';
      // Unlisted is link-only too (on an SDK that has it: `linkOnly` is undefined on older ones).
      const linkWrong = room.linkOnly !== undefined && room.linkOnly !== !listed;
      const lockWrong = room.locked !== undefined && room.locked !== locked;
      if (room.isPublic !== listed || linkWrong || lockWrong) void room.setAccess({ public: listed, linkOnly: !listed, locked }).catch(() => (this.listed = ''));
```

- [ ] **Step 6: Run the relay tests**

Run: `bun run test test/relay.test.ts`
Expected: PASS, the new test included.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/lobby/relay.ts test/relay.test.ts
git commit -m "Private locks the room at the server (setAccess locked); the SDK at alpha.7"
```

---

### Task 3: Kick, banned on the second

**Files:**
- Modify: `src/lobby/lobby.ts` (`Lobby.kicked`, `apply` kick), `src/lobby/wire.ts` (`readLobby`), `src/lobby/relay.ts` (`applyHere`), `test/lobby.test.ts`, `test/lobby-wire.test.ts`, `test/relay.test.ts`

**Interfaces:**
- Consumes: Task 2's fake `kicks`, `banned`, and `RoomLike.kick(id, { ban, message })`.
- Produces: `Lobby.kicked?: string[]`; exported from `relay.ts`: `KICK_MESSAGE = 'Removed by the host'`, `BAN_MESSAGE = "Removed by the host, and can't rejoin this lobby"`.

- [ ] **Step 1: Write the rules test**

In `test/lobby.test.ts` (it already builds lobbies with `createLobby` and `apply`; follow its helpers), add:

```ts
test('a kick remembers who: the lobby keeps their id (once), for the ban on a second', () => {
  let l = createLobby('L1', { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 });
  l = apply(l, 'bo', { type: 'join', player: { id: 'bo', name: 'BO', car: 'coupe', paint: 0 } })!;
  l = apply(l, 'ada', { type: 'kick', index: 1 })!;
  expect(l.kicked).toEqual(['bo']);
  l = apply(l, 'bo', { type: 'join', player: { id: 'bo', name: 'BO', car: 'coupe', paint: 0 } })!;
  l = apply(l, 'ada', { type: 'kick', index: 1 })!;
  expect(l.kicked).toEqual(['bo']);
  // Only the host kicks, never themselves.
  expect(apply(l, 'bo', { type: 'kick', index: 0 })).toBeNull();
});
```

In `test/lobby-wire.test.ts`:

```ts
test("a lobby's kicked list is read when it's ids, dropped when it's junk, and absent in an older lobby", () => {
  const base = { lobby: createLobby('L1', { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 }) };
  expect(readLobby(base)?.kicked).toBeUndefined();
  expect(readLobby({ lobby: { ...base.lobby, kicked: ['bo', 'cy'] } })?.kicked).toEqual(['bo', 'cy']);
  expect(readLobby({ lobby: { ...base.lobby, kicked: ['bo', 7, '<b>'.repeat(40)] } })?.kicked).toEqual(['bo']);
  expect(readLobby({ lobby: { ...base.lobby, kicked: 'bo' } })).not.toBeNull();
});
```

(Import `createLobby` and `readLobby` if the file doesn't already.)

In `test/relay.test.ts`, after the kick test:

```ts
  test('the first kick lets them back; the second bans them from the room, even after the SDK host changed', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await cy.backend.get(lobby.id);
    await cy.backend.send(lobby.id, { type: 'join', player: player('CY') });
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'kick', index: 2 });
    const room = hub.rooms.get(lobby.id)!;
    expect(room.kicks.at(-1)).toEqual({ id: 'bo', ban: false, message: 'Removed by the host' });
    // Back in, and kicked again, with Cy holding the SDK's role now (Ada reloaded).
    expect(await bo.backend.get(lobby.id)).not.toBeNull();
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    room.members = [room.members.find((m) => m.id === 'cy')!, ...room.members.filter((m) => m.id !== 'cy')];
    await ada.backend.send(lobby.id, { type: 'kick', index: 2 });
    expect(room.kicks.at(-1)).toEqual({ id: 'bo', ban: true, message: "Removed by the host, and can't rejoin this lobby" });
    expect(await bo.backend.get(lobby.id)).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts -t "kick"`
Expected: FAIL (`kicked` undefined; kicks recorded with `ban: false` and no message).

- [ ] **Step 3: Keep who was kicked**

`src/lobby/lobby.ts`, in `Lobby` after `vote?`:

```ts
  /**
   * Who the host has kicked from this lobby (player ids), for as long as the lobby lives: the
   * first kick lets them back (friends kick each other for fun), a second bans them from its room
   * (the owner, 2026-10-10). In the lobby, not on a page, so it outlives a change of host.
   */
  kicked?: string[];
```

In `apply`'s `case 'kick'`, before `return next;`:

```ts
      if (!lobby.kicked?.includes(s.id)) next.kicked = [...(lobby.kicked ?? []), s.id];
```

`src/lobby/wire.ts`, in `readLobby` before `return {`:

```ts
  // Who's been kicked: ids only (a bad entry is dropped, not the lobby).
  const kicked = Array.isArray(l.kicked) ? l.kicked.filter((k): k is string => str(k, 64)).slice(0, 64) : undefined;
```

and in the returned object, after the `vote` line: `...(kicked?.length ? { kicked } : {}),`

`src/lobby/relay.ts`, below `TAG`:

```ts
/** What a kicked player is told: the first time, and the second (banned from the room). */
export const KICK_MESSAGE = 'Removed by the host';
export const BAN_MESSAGE = "Removed by the host, and can't rejoin this lobby";
```

In `applyHere`'s kick branch, replace the `room.kick(s.id, { ban: false })` line with:

```ts
      // Kicked before (the lobby remembers): this time they're banned from the room.
      const again = lobby.kicked?.includes(s.id) ?? false;
      if (s.kind === 'player') void room.kick(s.id, { ban: again, message: again ? BAN_MESSAGE : KICK_MESSAGE }).catch(warned('a kick failed', undefined));
```

and its comment `// Out of the room too (not banned: a kick is for this lobby, and they may come back).` becomes `// Out of the room too: banned from it on a second kick.`

- [ ] **Step 4: Run them**

Run: `bun run test test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lobby test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts
git commit -m "Kick: the lobby remembers who, and a second kick bans them from the room"
```

---

### Task 4: Make host

**Files:**
- Modify: `src/lobby/lobby.ts` (`LobbyAction`, `apply`), `src/lobby/wire.ts` (`readAction`), `src/lobby/relay.ts` (`applyHere`), `test/lobby.test.ts`, `test/lobby-wire.test.ts`, `test/relay.test.ts`

**Interfaces:**
- Consumes: `RoomLike.transferHost?` and the fake's `transferHost` (Task 2).
- Produces: `LobbyAction` `{ type: 'host'; index: number }`.

- [ ] **Step 1: Write the tests**

`test/lobby.test.ts`:

```ts
test('the host hands the lobby to a seated player: not to themselves, a bot or an open seat, and nobody else can', () => {
  let l = createLobby('L1', { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 });
  l = apply(l, 'bo', { type: 'join', player: { id: 'bo', name: 'BO', car: 'coupe', paint: 0 } })!;
  l = apply(l, 'ada', { type: 'seat', index: 2, to: 'ai-hard' })!;
  expect(apply(l, 'bo', { type: 'host', index: 1 })).toBeNull();
  expect(apply(l, 'ada', { type: 'host', index: 0 })).toBeNull();
  expect(apply(l, 'ada', { type: 'host', index: 2 })).toBeNull();
  expect(apply(l, 'ada', { type: 'host', index: 3 })).toBeNull();
  const next = apply(l, 'ada', { type: 'host', index: 1 })!;
  expect(next.host).toBe('bo');
  // The new host is ready (a host always is), and the old one isn't held to it.
  expect(next.seats[1]).toMatchObject({ ready: true });
});
```

`test/lobby-wire.test.ts`:

```ts
test('Make host is read with a seat index in range, and refused without one', () => {
  expect(readAction({ type: 'host', index: 3 }, 'ada')).toEqual({ type: 'host', index: 3 });
  expect(readAction({ type: 'host', index: 8 }, 'ada')).toBeNull();
  expect(readAction({ type: 'host' }, 'ada')).toBeNull();
});
```

`test/relay.test.ts`:

```ts
  test("Make host hands over the lobby and the SDK's role with it; to a player whose connection is down, just the lobby", async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    for (const p of [bo, cy]) {
      await p.backend.get(lobby.id);
      await p.backend.send(lobby.id, { type: 'join', player: player(p.relay.playerId.toUpperCase()) });
    }
    const after = await ada.backend.send(lobby.id, { type: 'host', index: 1 });
    expect(after?.host).toBe('bo');
    expect(bo.relay.room!.isHost).toBe(true);
    // Bo's turn: Cy's connection is down, so the SDK's role stays with Bo.
    const room = hub.rooms.get(lobby.id)!;
    room.members.find((m) => m.id === 'cy')!.connected = false;
    const later = await bo.backend.send(lobby.id, { type: 'host', index: 2 });
    expect(later?.host).toBe('cy');
    expect(bo.relay.room!.isHost).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts -t "host"`
Expected: FAIL (no `host` action: TypeScript error or null).

- [ ] **Step 3: The action**

`src/lobby/lobby.ts`, in `LobbyAction` after the kick line: `  | { type: 'host'; index: number }`

In `apply`, after `case 'kick'`:

```ts
    case 'host': {
      // The host hands the lobby to another seated player (the SDK's role goes too: relay.ts).
      const s = lobby.seats[action.index];
      if (!isHost || !s || s.kind !== 'player' || s.id === actor) return null;
      next.host = s.id;
      // A host is always ready.
      next.seats[action.index] = { ...s, ready: true };
      return next;
    }
```

`src/lobby/wire.ts`, `readAction`, after `case 'kick'`:

```ts
    case 'host':
      return int(data.index, 0, SEATS - 1) ? { type: 'host', index: data.index } : null;
```

`src/lobby/relay.ts`, in `applyHere`, after `this.commit(room, next);` and before `return next;` (the lobby is written first, then the role moves on):

```ts
    // Make host: the SDK's role goes with the lobby, so one player holds both (if they're connected;
    // if not, or it fails, the lobby's host is still theirs: `apply` checks the lobby's host).
    if (action.type === 'host') {
      const to = next.host;
      if (to !== room.me && room.players.some((p) => p.id === to && p.connected !== false)) void room.transferHost?.(to).catch(warned('handing over the host role failed', undefined));
    }
```

- [ ] **Step 4: Run them**

Run: `bun run test test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lobby test/lobby.test.ts test/lobby-wire.test.ts test/relay.test.ts
git commit -m "Make host: the lobby's host hands it on, and the SDK's role with it (transferHost)"
```

---

### Task 5: Told why you're out

**Files:**
- Modify: `src/lobby/relay.ts` (refusals), `src/lobby/backend.ts` (`LobbyBackend.why?`, `Lobbies.why`), `src/ui/menu.ts` (`onNotice`, `refusalText`, the subscription and `open`), `src/main.ts` (`screens.onNotice = toast`), `test/relay.test.ts`, `test/ui.test.ts`

**Interfaces:**
- Consumes: `KICK_MESSAGE`, `BAN_MESSAGE` (Task 3); fake `joinRoom` errors with `code` (Task 2).
- Produces: `export type Refusal = { kind: 'kicked'; message: string } | { kind: 'banned' | 'locked' | 'full' }` (relay.ts); `LobbyBackend.why?(id: string): Refusal | null` (taken once: reading it clears it); `export function refusalText(r: Refusal): string` (menu.ts); `Menu.onNotice?: (text: string) => void`.

- [ ] **Step 1: Write the tests**

`test/relay.test.ts`, after the ban test:

```ts
  test('why you are out: kicked (with the host\'s words), banned, or a private room, said once', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
    await settle();
    expect(bo.backend.why(lobby.id)).toEqual({ kind: 'kicked', message: 'Removed by the host' });
    expect(bo.backend.why(lobby.id)).toBeNull();
    hub.rooms.get(lobby.id)!.banned.add('bo');
    expect(await bo.backend.get(lobby.id)).toBeNull();
    expect(bo.backend.why(lobby.id)).toEqual({ kind: 'banned' });
    hub.rooms.get(lobby.id)!.locked = true;
    expect(await cy.backend.get(lobby.id)).toBeNull();
    expect(cy.backend.why(lobby.id)).toEqual({ kind: 'locked' });
  });
```

`test/ui.test.ts` (import `refusalText` from `../src/ui/menu`):

```ts
describe('told why you are out', () => {
  test('each refusal has its words; a kick says what the host sent', () => {
    expect(refusalText({ kind: 'kicked', message: 'Removed by the host' })).toBe('Removed by the host');
    expect(refusalText({ kind: 'banned' })).toBe("You can't rejoin this lobby");
    expect(refusalText({ kind: 'locked' })).toBe('This lobby is private');
    expect(refusalText({ kind: 'full' })).toBe('This lobby is full');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun run test test/relay.test.ts test/ui.test.ts -t "why you are out|refusal"`
Expected: FAIL (`why` is not a function; `refusalText` not exported).

- [ ] **Step 3: Record why, in relay.ts**

Below `BAN_MESSAGE`:

```ts
/** Why you're out of a lobby, or couldn't get in: for the menu to say. */
export type Refusal = { kind: 'kicked'; message: string } | { kind: 'banned' | 'locked' | 'full' };

/** A failed join's reason, from the SDK's error code (others say nothing new: the title as before). */
function refusalOf(err: unknown): Refusal | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'banned' || code === 'locked') return { kind: code };
  if (code === 'room_full') return { kind: 'full' };
  return null;
}
```

In `RelayBackend`, a field and a method:

```ts
  /** Why each lobby last refused you or put you out, until the menu asks (`why`). */
  private refusals = new Map<string, Refusal>();

  why(id: string): Refusal | null {
    const r = this.refusals.get(id) ?? null;
    this.refusals.delete(id);
    return r;
  }

  /** A join's failure: warned as before, and why kept for the menu. */
  private refused(id: string, what: string) {
    return (err: unknown): null => {
      const r = refusalOf(err);
      if (r) this.refusals.set(id, r);
      return warned(what, null)(err);
    };
  }
```

In `enter`, `relay.joinRoom(id).catch(warned('joining a lobby failed', null))` becomes `relay.joinRoom(id).catch(this.refused(id, 'joining a lobby failed'))`.

In `attach`'s `room.on('closed', …)`, widen the handler to `(reason?: string, message?: string)` and, before `this.detach();`:

```ts
        if (reason === 'kicked') this.refusals.set(room.code, { kind: 'kicked', message: message || KICK_MESSAGE });
```

- [ ] **Step 4: Through `Lobbies`, and the menu says it**

`src/lobby/backend.ts`: import `type Refusal` from `./relay`; add to `LobbyBackend`:

```ts
  /** Online: why lobby `id` last refused you or put you out (kicked, banned, private, full), once. */
  why?(id: string): Refusal | null;
```

and to `Lobbies`, beside `route`:

```ts
  why(id: string): Refusal | null {
    return this.of(id)?.why?.(id) ?? null;
  }
```

`src/ui/menu.ts`: import `type Refusal` from `../lobby/relay`; export

```ts
/** What the menu says when a lobby refuses you or puts you out. */
export function refusalText(r: Refusal): string {
  if (r.kind === 'kicked') return r.message;
  return r.kind === 'banned' ? "You can't rejoin this lobby" : r.kind === 'locked' ? 'This lobby is private' : 'This lobby is full';
}
```

Beside `onSettings?`:

```ts
  /** A short note for the player (main.ts toasts it): why a lobby put you out, or let you in. */
  onNotice?: (text: string) => void;
```

A private helper:

```ts
  /** Says why lobby `id` refused you or put you out, if it said. */
  private tellWhy(id: string): void {
    const r = this.backend.why?.(id);
    if (r) this.onNotice?.(refusalText(r));
  }
```

In `open`, after `if (lobbyId && !lobby) void this.backend.abandon?.(lobbyId);` add `if (lobbyId && !lobby) this.tellWhy(lobbyId);`. In the lobby subscription, `if (!l) return void this.show({ kind: 'title' });` becomes:

```ts
        if (!l) {
          this.tellWhy(screen.id);
          return void this.show({ kind: 'title' });
        }
```

Wherever else the menu shows a lobby picked from the title list and gets `null` (search `this.backend.get(` in menu.ts: the title row's click goes through `show({ kind: 'lobby' })`; if `show` loads the lobby with `get` and falls back to the title, call `this.tellWhy(id)` there too).

`src/main.ts`, after `screens.onSettings = …`: `screens.onNotice = toast;`

- [ ] **Step 5: Run them**

Run: `bun run test test/relay.test.ts test/ui.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lobby src/ui/menu.ts src/main.ts test/relay.test.ts test/ui.test.ts
git commit -m "Told why: kicked (the host's words), banned, private or full, as a toast on the title"
```

---

### Task 6: Kick and Make host on the lobby screen

**Files:**
- Modify: `src/ui/menu.ts` (player rows, change handlers), `test/ui.test.ts`

**Interfaces:**
- Consumes: the `kick` and `host` actions (Tasks 3–4).
- Produces: `export function playerSeatChoices(lobby: Lobby, you: string, index: number): [string, string][] | null`.

- [ ] **Step 1: Write the test**

`test/ui.test.ts` (import `playerSeatChoices` from `../src/ui/menu`, `createLobby`, `apply` from `../src/lobby/lobby`):

```ts
describe("the host's tools on a player's seat", () => {
  const base = createLobby('L1', { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 });
  const l = apply(base, 'bo', { type: 'join', player: { id: 'bo', name: 'BO', car: 'coupe', paint: 0 } })!;
  test("the host sees Kick and Make host on another player's seat, and nothing on their own or a bot's", () => {
    expect(playerSeatChoices(l, 'ada', 1)).toEqual([['seat', 'Seated'], ['kick', 'Kick'], ['host', 'Make host']]);
    expect(playerSeatChoices(l, 'ada', 0)).toBeNull();
    expect(playerSeatChoices(l, 'ada', 2)).toBeNull();
  });
  test('nobody else does', () => {
    expect(playerSeatChoices(l, 'bo', 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test test/ui.test.ts -t "host's tools"`
Expected: FAIL (`playerSeatChoices` not exported).

- [ ] **Step 3: The chooser on a player's row**

`src/ui/menu.ts`, exported near `refusalText`:

```ts
/**
 * The host's choices on another player's seat (the seat chooser the other seats have): Kick or
 * Make host, two steps so neither is a stray click. Null where there are none.
 */
export function playerSeatChoices(lobby: Lobby, you: string, index: number): [string, string][] | null {
  const s = lobby.seats[index];
  if (you !== lobby.host || !s || s.kind !== 'player' || s.id === you) return null;
  return [['seat', 'Seated'], ['kick', 'Kick'], ['host', 'Make host']];
}
```

In the player branch of the seat rows (where `who` is built for `s.kind === 'player'`), after `who = …;`:

```ts
          const tools = online ? playerSeatChoices(lobby, you, k) : null;
          if (tools) who += ` ${this.sel(`pseat-${k}`, tools, 'seat')}`;
```

(Use the same `online` the screen already has; the local lobby has nobody to kick.) In the handlers, after the `seat-${k}` loop:

```ts
    for (let k = 0; k < SEATS; k++)
      change(`pseat-${k}`, (v) => {
        if (v === 'kick') this.send(lobby, { type: 'kick', index: k });
        else if (v === 'host') this.send(lobby, { type: 'host', index: k });
      });
```

- [ ] **Step 4: Run it**

Run: `bun run test test/ui.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/menu.ts test/ui.test.ts
git commit -m "The lobby screen: Kick and Make host on another player's seat, in the seat chooser"
```

---

### Task 7: The privacy and terms text, and its renderer

**Files:**
- Create: `docs/PRIVACY.md`, `docs/TERMS.md`, `src/ui/legal.ts`
- Test: `test/ui.test.ts`

**Interfaces:**
- Produces: `export function renderDoc(md: string): string` (HTML, every piece escaped; links only `https:` and `mailto:`).

- [ ] **Step 1: Write the test**

`test/ui.test.ts` (import `renderDoc` from `../src/ui/legal`):

```ts
describe('the privacy and terms pages (ui/legal.ts)', () => {
  test('headings, paragraphs, bullets, bold and links, and nothing else as markup', () => {
    const html = renderDoc('# Title\n\nSome **bold** words.\n\n- one\n- two [site](https://gamerelay.io)\n\nMail [us](mailto:support@gamerelay.io).');
    expect(html).toBe(
      '<h1>Title</h1><p>Some <b>bold</b> words.</p><ul><li>one</li><li>two <a href="https://gamerelay.io" target="_blank" rel="noopener">site</a></li></ul><p>Mail <a href="mailto:support@gamerelay.io" target="_blank" rel="noopener">us</a>.</p>',
    );
  });
  test("markup in the text is text, and a link that isn't https or mailto is just its words", () => {
    expect(renderDoc('<img src=x onerror=alert(1)> [x](javascript:void)')).toBe('<p>&#60;img src=x onerror=alert(1)&#62; x</p>');
  });
  test('the real pages render, dated and with the contact', async () => {
    const { default: privacy } = await import('../docs/PRIVACY.md?raw');
    const { default: terms } = await import('../docs/TERMS.md?raw');
    for (const md of [privacy, terms]) {
      const html = renderDoc(md);
      expect(html).toContain('support@gamerelay.io');
      expect(html).toMatch(/2026-10-10/);
      expect(html).not.toContain('<script');
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test test/ui.test.ts -t "privacy and terms"`
Expected: FAIL (no `src/ui/legal.ts`).

- [ ] **Step 3: The text**

`docs/PRIVACY.md`:

```md
# Privacy

Last updated 2026-10-10.

racecar is a free browser game by Colin Teahan. This is what it does with your information, in plain words.

## What racecar keeps

- **No analytics, no ads, no accounts.** racecar doesn't track you.
- **Your settings, your plate and your best times** stay in your browser (its local storage). Clearing your browser's site data removes them.

## Playing online

- Online lobbies and races run on [GameRelay](https://gamerelay.io), a service for multiplayer browser games. To connect you, GameRelay handles your connection, and so sees your IP address. It passes your plate, your car and your race to the other players in your lobby.
- Players in a lobby may connect to each other **directly** (peer to peer) for a smoother race. When they do, they can see each other's IP address.
- **Lobby names and plates are shown to other players.** Don't put anything personal in them.

## Questions

Email **support@gamerelay.io** for any question or request about your information.
```

`docs/TERMS.md`:

```md
# Terms

Last updated 2026-10-10.

racecar is a free browser game by Colin Teahan. By playing it you agree to these terms.

## Playing

- racecar is free, and provided **as is**, with no warranty of any kind. It may change or stop at any time.
- **Be decent.** Lobby names and plates are seen by other players. A lobby's host can remove players, and we can close lobbies.
- **Photosensitivity:** racecar has flashing lights (police lights, boost, crashes). If you're sensitive to flashing lights, take care, or don't play.

## The code and the music

- The source code is on [GitHub](https://github.com/gamerelay/racecar) under the MIT license.
- The music is © Colin Teahan, all rights reserved. It plays as part of racecar, but isn't free to reuse on its own.

## Contact

Bugs and ideas: [GitHub issues](https://github.com/gamerelay/racecar/issues). Anything else: **support@gamerelay.io**.
```

- [ ] **Step 4: The renderer**

`src/ui/legal.ts`:

```ts
// The privacy and terms pages' text (docs/PRIVACY.md, docs/TERMS.md: one copy, readable on GitHub
// too) as HTML for the game's pages. Only what those files use: `#` and `##` headings, paragraphs,
// `- ` bullets, **bold** and [links](…). Every piece goes through `esc`, so the files can't put
// markup on the page, and a link that isn't https or mailto is just its words.

import { esc } from './html';

/** One line's text: escaped, then its bold and links. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, words: string, url: string) =>
      /^(https:|mailto:)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${words}</a>` : words,
    );
}

/** A doc as HTML: blocks split on blank lines; a block of `- ` lines is a list. */
export function renderDoc(md: string): string {
  return md
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      if (lines[0].startsWith('## ')) return `<h2>${inline(lines[0].slice(3))}</h2>`;
      if (lines[0].startsWith('# ')) return `<h1>${inline(lines[0].slice(2))}</h1>`;
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('');
}
```

(`esc` turns `&` into `&#38;`: a URL with `&` would read `&#38;` in the href, which browsers decode back. `esc` leaves `(`, `)`, `[`, `]`, `*`, `:` and `/` alone, so the patterns still match after escaping.)

- [ ] **Step 5: Run it**

Run: `bun run test test/ui.test.ts -t "privacy and terms"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/PRIVACY.md docs/TERMS.md src/ui/legal.ts test/ui.test.ts
git commit -m "Privacy and Terms: the text in docs/, and the game's escaped renderer for it"
```

---

### Task 8: Credits, Privacy and Terms pages from the title

**Files:**
- Create: `src/ui/pages.ts`
- Modify: `src/ui/menu.ts` (title: Credits box, Privacy · Terms links, `onPage`), `src/main.ts` (the panel, `?page=`, Esc), `src/ui/hud.css` (the pages and their background), `test/ui.test.ts`

**Interfaces:**
- Consumes: `renderDoc` (Task 7), `Overlay` (`ui/overlay.ts`).
- Produces: `export type Page = 'credits' | 'privacy' | 'terms'`; `export function readPage(v: string | null): Page | null`; `export function pageHtml(page: Page): string`; `export class PagesPanel extends Overlay { open(page: Page, from?: HTMLElement | null): void }`; `Menu.onPage?: (page: Page, from: HTMLElement | null) => void`.

- [ ] **Step 1: Write the test**

`test/ui.test.ts` (import `pageHtml`, `readPage` from `../src/ui/pages`):

```ts
describe('the Credits, Privacy and Terms pages', () => {
  test('?page= opens one of the three, and nothing else', () => {
    expect(['credits', 'privacy', 'terms', 'CREDITS', '', null, 'constructor'].map(readPage)).toEqual(['credits', 'privacy', 'terms', null, null, null, null]);
  });
  test('the credits name who made it and what it runs on, with the source', () => {
    const html = pageHtml('credits');
    for (const s of ['Colin Teahan', 'Claude', 'GameRelay', 'Resonance', 'https://github.com/gamerelay/racecar', 'https://gamerelay.io', 'Three.js']) expect(html).toContain(s);
  });
  test('privacy and terms are the docs, with a way back', () => {
    expect(pageHtml('privacy')).toContain('<h1>Privacy</h1>');
    expect(pageHtml('terms')).toContain('Photosensitivity');
    for (const p of ['credits', 'privacy', 'terms'] as const) expect(pageHtml(p)).toContain('id="pgBack"');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun run test test/ui.test.ts -t "Credits, Privacy and Terms"`
Expected: FAIL (no `src/ui/pages.ts`).

- [ ] **Step 3: The pages**

`src/ui/pages.ts`:

```ts
// Credits, Privacy and Terms (docs/superpowers/specs/2026-10-10-public-polish-design.md): pages in
// the game, not files, since the hosted build is one HTML file. One layer over the title (an
// Overlay, like Settings) with an animated background in the soundtrack art's look; Back, Esc or
// the pad's B return. `?page=credits` (or privacy, terms) opens the title with one up.

import PRIVACY from '../../docs/PRIVACY.md?raw';
import TERMS from '../../docs/TERMS.md?raw';
import { renderDoc } from './legal';
import { Overlay } from './overlay';

export type Page = 'credits' | 'privacy' | 'terms';
const PAGES: readonly Page[] = ['credits', 'privacy', 'terms'];

/** The page a link asks for (`?page=`), or null. */
export function readPage(v: string | null): Page | null {
  return PAGES.find((p) => p === v) ?? null;
}

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

const CREDITS = `
  <div class="wordmark small" aria-label="Racecar">RACECAR</div>
  <p class="lede">An arcade street racer for the browser.</p>
  <dl>
    <dt>Made by</dt><dd><b>Colin Teahan</b> and <b>Claude</b> (Anthropic): Colin directing, Claude writing most of the code.</dd>
    <dt>Music</dt><dd>The original soundtrack, by Colin Teahan.</dd>
    <dt>Online</dt><dd>${link('https://gamerelay.io', 'GameRelay')}, multiplayer for browser games. Races travel over Resonance, its relay network.</dd>
    <dt>Source</dt><dd>${link('https://github.com/gamerelay/racecar', 'github.com/gamerelay/racecar')} (MIT). racecar is GameRelay's open-source example game: read how it's built.</dd>
    <dt>Built with</dt><dd>Three.js, TypeScript, Bun and Vite.</dd>
  </dl>`;

/** A page's card. */
export function pageHtml(page: Page): string {
  const body = page === 'credits' ? CREDITS : renderDoc(page === 'privacy' ? PRIVACY : TERMS);
  return `<div class="card page ${page}">${body}<div class="row"><button id="pgBack">Back</button></div></div>`;
}

/** The background: a sun, a grid running at you, palms, and now and then a car's tail-lights. */
const SCENE = `<div class="pgScene" aria-hidden="true"><div class="pgSun"></div><div class="pgGrid"></div><div class="pgPalms"></div><div class="pgCar"></div></div>`;

export class PagesPanel extends Overlay {
  constructor() {
    super('pages');
  }

  open(page: Page, from?: HTMLElement | null): void {
    this.el.innerHTML = `${SCENE}${pageHtml(page)}`;
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.onclick = () => this.close();
    this.show(from);
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.focus({ preventScroll: true });
  }
}
```

Add `src/ui/raw.d.ts` only if TypeScript doesn't already know `?raw` (it does if `vite/client` types are in `tsconfig.json`: menu.ts imports `flags.svg?raw`; check with `bun run typecheck`).

- [ ] **Step 4: The title's Credits box and links**

`src/ui/menu.ts`: import `type Page` from `./pages`. Beside `onSettings?`:

```ts
  /** The title's Credits, Privacy and Terms (main.ts opens the page). */
  onPage?: (page: Page, from: HTMLElement | null) => void;
```

In `renderTitle`, after the `<p class="muted">Every race is a lobby…</p>` line (inside the card):

```html
        <div class="titleFoot"><a href="?page=privacy" id="mPrivacy">Privacy</a> · <a href="?page=terms" id="mTerms">Terms</a><button id="mCredits" class="creditsBox">Credits</button></div>
```

After `this.on('mSettings', …)`:

```ts
    for (const [id, page] of [['mCredits', 'credits'], ['mPrivacy', 'privacy'], ['mTerms', 'terms']] as const)
      this.on(id, (e?: Event) => {
        e?.preventDefault();
        this.onPage?.(page, document.getElementById(id));
      });
```

(Check `this.on`'s signature: if its handler gets no event, set `onclick` on the two links directly with `preventDefault`, so a click opens the page in place; the `href` is for opening in a new tab.)

- [ ] **Step 5: Wire it in main.ts**

Import `PagesPanel`, `readPage` from `./ui/pages`. After `const controlsPanel = new ControlsPanel();`: `const pagesPanel = new PagesPanel();`. After `screens.onNotice = toast;`:

```ts
  screens.onPage = (page, from) => pagesPanel.open(page, from);
  // A link to a page (`?page=credits`): the title, with it up.
  const page = readPage(params.get('page'));
  if (page) pagesPanel.open(page);
```

In the back/pause handler beside `settingsPanel.isOpen`: `if ((a === 'back' || a === 'pause') && pagesPanel.isOpen) return pagesPanel.close();`, and beside the other `!on` closes: `if (!on && pagesPanel.isOpen) pagesPanel.close();`.

- [ ] **Step 6: The look**

`src/ui/hud.css`, after the `#settings, #controls, #keys` rules:

```css
/* Credits, Privacy and Terms (ui/pages.ts): the soundtrack art's sunset behind a card. */
#pages { position: fixed; inset: 0; z-index: 14; display: none; place-items: center; overflow: auto; padding: 16px; background: linear-gradient(#1a0838, #3b0f5c 45%, #ff2e88 62%, #0d0620 62.2%); }
#pages.on { display: grid; }
#pages > .card { position: relative; max-width: 620px; animation: popIn 0.16s ease-out both; }
.pgScene { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.pgSun { position: absolute; left: 50%; top: 22%; width: 38vmin; height: 38vmin; margin-left: -19vmin; border-radius: 50%; background: linear-gradient(#ffd23f, #ff7a3d 60%, #ff2e88);
  /* The bands across its lower half. */
  -webkit-mask-image: linear-gradient(#000 55%, transparent 55% 59%, #000 59% 68%, transparent 68% 72%, #000 72% 81%, transparent 81% 86%, #000 86%); mask-image: linear-gradient(#000 55%, transparent 55% 59%, #000 59% 68%, transparent 68% 72%, #000 72% 81%, transparent 81% 86%, #000 86%); }
.pgGrid { position: absolute; left: -50%; right: -50%; top: 62%; bottom: -10%; transform: perspective(40vh) rotateX(62deg); transform-origin: top;
  background: repeating-linear-gradient(90deg, rgba(53, 240, 255, 0.55) 0 2px, transparent 2px 7vw), repeating-linear-gradient(rgba(53, 240, 255, 0.55) 0 2px, transparent 2px 7vh); animation: pgRun 1.2s linear infinite; }
@keyframes pgRun { to { background-position: 0 0, 0 7vh; } }
.pgPalms { position: absolute; inset: auto 0 38% 0; height: 30vh;
  background: radial-gradient(ellipse 9vh 2.5vh at 8% 6vh, #0d0620 98%, transparent), linear-gradient(#0d0620, #0d0620) 8.6% 6vh / 0.8vh 24vh no-repeat,
    radial-gradient(ellipse 9vh 2.5vh at 91% 3vh, #0d0620 98%, transparent), linear-gradient(#0d0620, #0d0620) 90.6% 3vh / 0.8vh 27vh no-repeat; }
.pgCar { position: absolute; top: 66%; left: -10%; width: 7vh; height: 1.2vh; border-radius: 0.6vh; background: linear-gradient(90deg, #ff2e88 0 22%, transparent 22% 78%, #ff2e88 78%); box-shadow: 0 0 2vh #ff2e88; animation: pgCar 9s linear infinite 2s; }
@keyframes pgCar { 0% { transform: translateX(0); } 40%, 100% { transform: translateX(130vw); } }
.card.page dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 12px 0; }
.card.page dt { color: var(--muted); }
.card.page dd { margin: 0; }
.card.page a { color: #35f0ff; }
.wordmark.small { font-size: 56px; }
.titleFoot { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; color: var(--muted); }
.titleFoot a { color: inherit; }
.titleFoot .creditsBox { margin-left: auto; background: #fff6ee; color: #120a20; border: 0; padding: 4px 10px; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .pgGrid, .pgCar { animation: none; } .pgCar { display: none; } }
```

(Match `var(--muted)`, `popIn` and the button styles to what hud.css already defines; read the `.card` and `button` rules first and reuse their tokens rather than these literals where one exists.)

- [ ] **Step 7: Run it, and look**

Run: `bun run test test/ui.test.ts && bun run typecheck`
Expected: PASS, clean.

Then start `bun run dev` and render `http://localhost:5178/?page=credits`, `?page=privacy`, `?page=terms` and the plain title in headless Chrome (the CDP pattern in `tools/poster.ts`: navigate, wait for `#pages.on`, `Page.captureScreenshot`), at 1440×900 and at 390×844. Expected: the card readable over the scene at both sizes, no page scroll sideways, the title's footer showing Privacy · Terms and the white Credits box. Fix what doesn't look right.

- [ ] **Step 8: Commit**

```bash
git add src/ui/pages.ts src/ui/menu.ts src/main.ts src/ui/hud.css test/ui.test.ts
git commit -m "Credits, Privacy and Terms: a white Credits box and two links on the title, pages over a sunset (?page= opens one)"
```

---

### Task 9: The docs say the same

**Files:**
- Modify: `README.md` (the analytics paragraph), `CONTRIBUTING.md` (if it mentions analytics), `docs/ONLINE.md` (host controls), `docs/README.md` (PRIVACY, TERMS), `CHANGELOG.md` (Unreleased), `docs/HANDOFF.md` (status line)

- [ ] **Step 1: Edit**

- `README.md`: replace the paragraph starting "Released builds can send anonymous gameplay events" with: `racecar has no analytics. Online play goes through GameRelay, which sees what it needs to connect players ([privacy](./docs/PRIVACY.md), [terms](./docs/TERMS.md)).`
- `docs/ONLINE.md`, "Who can join": Private's row says the room is locked at the server too (`setAccess({ locked })`). Add a section **Host controls** after "Two hosts": Kick (the lobby keeps who; a second kick bans from the room: `room.kick(id, { ban })`), Make host (`apply`'s `host`, and `transferHost` so one player holds both, if they're connected), and that a kicked or refused player is told why (`why`, `refusalText`).
- `docs/README.md`, Guides table: add `[PRIVACY.md](./PRIVACY.md), [TERMS.md](./TERMS.md) | What the game does with your information, and the terms. The game shows these same files.`
- `CHANGELOG.md`, under Unreleased:
  - `**Host tools:** the lobby's host can kick a player (a second kick keeps them out of that lobby) or make someone else host, from the player's seat. Private lobbies are locked at the server. Kicked, or can't get in? The game says why.`
  - `**Credits, Privacy and Terms:** a Credits page (who made racecar, and what it runs on) and the privacy policy and terms, from the title.`
  - `**No analytics:** the game sends nothing about how you play.`
- `docs/HANDOFF.md`: a line under its latest status for this branch (public polish: what's in it, and what's not checked by hand).

- [ ] **Step 2: The whole suite, and the build**

Run: `bun run typecheck && bun run test && bun tools/validate.ts --ai && bun run build && bun run build:single`
Expected: all clean; `dist-single/racecar.html` contains `support@gamerelay.io` (`grep -c support@gamerelay.io dist-single/racecar.html` ≥ 1).

- [ ] **Step 3: Commit**

```bash
git add README.md CONTRIBUTING.md docs CHANGELOG.md
git commit -m "Docs: no analytics, host controls in ONLINE.md, privacy and terms linked, CHANGELOG"
```
