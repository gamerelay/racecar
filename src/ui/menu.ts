// The front door (PLAN phases 2 to 4, docs/MENU.md "The UI polish"): the title screen, the lobby
// list (Multiplayer), your plate, and the lobby itself, Civilization-style, with eight seats the
// host sets to a player, open, an AI or closed. Every race but Quick race, Time trial and Free drive
// starts from a lobby; Single player is your own lobby with bots in the open seats. The lobby is
// also the car select: the seats on the left, your car turning on a table in the frame in the
// middle (render/showroom.ts) with arrows either side to cycle it (A and D; W and S cycle the
// paint) and its card under it, and the race's options on the right (the host's to set; everyone
// else reads them). The screens only see a LobbyBackend: your own lobby is in this browser, and
// online ones are GameRelay rooms (lobby/relay.ts).
//
// Every screen is built from the UI kit (kit.ts, kit.css); its pieces come in one after another
// (`data-in`, menu.css) as it opens, and go together as it leaves.

import { EMBED, keepEmbed } from './embed';
import { esc } from './html';
import { chooser } from './chooser';
import { goTo } from './fade';
import type { CarClass, MapDef, PaintDef, TrackLayout } from '../core/content';
import type { KeyValue, LobbyBackend, NetRoute } from '../lobby/backend';
import { LOCAL_ID } from '../lobby/backend';
import type { NameCheck, NameRules, Refusal } from '../lobby/relay';
import type { Page } from './pages';
import { aiPlate, cleanPlate, plateProblem, PLATE_MAX, randomPlate, savePlate, typedPlate } from '../lobby/plate';
import { DEFAULT_OPTIONS, FILL_DIFFICULTY, SEATS, canJoin, nextVisibility, legacySeats, seatIndex, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type SeatChoice } from '../lobby/lobby';
import { pingClass } from './format';
import { MAX_LAPS, quickRaceSetup, raceFromLobby, randomCar, toQuery, trialSetup, type RaceSetup } from './setup';
import { onOverlay, overlayUp } from './overlay';
import { carStats } from './stats';
import { thumb, thumbSvg } from './thumb';
import { button, carRole, driverChip, fill, field, GEAR, header, hint, hints, menuItem, plate, rating, row, segmented, stat, tag, toggle, toggled } from './kit';

/** What GameRelay checks a plate against: tighter than a name's rules, as plates are (lobby/plate.ts). */
const PLATE_RULES: NameRules = { maxLength: PLATE_MAX, charset: 'alnum' };

export interface MenuContent {
  maps: MapDef[];
  layouts: Record<string, TrackLayout>;
  classes: CarClass[];
  paints: PaintDef[];
}

/** What runs behind the lobby: its map and weather, and your car on the table (null: the title's race, no table). */
export interface Preview {
  map: string;
  weather: LobbyOptions['weather'];
  time: LobbyOptions['time'];
  /** Your car, paint and plate; none when you have no seat. */
  car?: { car: string; paint: number; plate: string };
}

/** `from`: the lobby the plate editor was opened from (it goes back there, still seated), or the screen. */
type Screen = { kind: 'title' } | { kind: 'online' } | { kind: 'plate'; from?: string } | { kind: 'lobby'; id: string };
type Kind = Screen['kind'];

/** The race options' choices, as [value, label]. */
const WEATHERS: [string, string][] = [['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain']];
const TIMES: [string, string][] = [['random', 'Random'], ['day', 'Day'], ['sunset', 'Sunset']];
const MAYHEMS: [string, string][] = [['normal', 'Normal'], ['chaos', 'Chaos'], ['off', 'Off']];
/** Who can join a lobby, in the order the host's tag cycles them. */
const ACCESS: [Lobby['visibility'], string, string][] = [
  ['public', 'Public', 'Anyone: listed online'],
  ['invite', 'Link only', 'Anyone with the link: not listed'],
  ['locked', 'Private', 'Nobody new can join'],
];
/** What the lobby's header says about its connection. */
const NET_ROUTES: Record<NetRoute, [string, string]> = {
  p2p: ['P2P', 'Straight to each other: across your network, or over the internet'],
  relay: ['Relay', 'Through a GameRelay relay near you'],
  server: ['Server', 'Through the game server (a direct way is still being found, or there isn\'t one)'],
};
const SEAT_OPTS: [SeatChoice, string][] = [['open', 'Open seat'], ['ai-easy', 'Bot · easy'], ['ai-normal', 'Bot · normal'], ['ai-hard', 'Bot · hard'], ['closed', 'Closed']];
const label = (opts: [string, string][], v: string) => opts.find(([k]) => k === v)?.[1] ?? v;

/** How long a screen takes to go before the next comes in (ms); the next comes in in CSS (menu.css). */
const LEAVE_MS = 150;
const sameScreen = (a: Screen, b: Screen) => a.kind === b.kind && (a.kind !== 'lobby' || (b.kind === 'lobby' && a.id === b.id)) && (a.kind !== 'plate' || (b.kind === 'plate' && a.from === b.from));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** How deep a screen is: going to a deeper one is forward (it comes in from the right), to a shallower one back. */
const DEPTH: Record<Kind, number> = { title: 0, online: 1, plate: 2, lobby: 2 };

/** The car arrows' chevron (pointing right; the previous one is flipped in CSS). */
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3l10 9-10 9"/></svg>';

/** The build's version (vite.config.ts), on the title's foot; `dev` where Vite didn't build it (the tests). */
const BUILD_VERSION = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';
/** A name as a little license plate (the results use the same chip). */
export const plateChip = (name: string) => `<span class="plate">${esc(name)}</span>`;

/**
 * The layouts the lobby and quick race offer, of `keys` ("map/layout"): the game's maps' (`maps`:
 * not the experimental ones, which open from a link), by map name, as the vote lists them.
 * (Paradise Open was in the lobby's list as its raw key, and quick race landed on it one race in six.)
 */
export function lobbyKeys(maps: readonly MapDef[], keys: readonly string[]): string[] {
  const name = (k: string) => maps.find((m) => k.startsWith(m.id + '/'))?.name ?? '';
  return keys.filter((k) => name(k) !== '').sort((a, b) => name(a).localeCompare(name(b)) || a.localeCompare(b));
}

/** What the menu says when a lobby refuses you or puts you out. */
export function refusalText(r: Refusal): string {
  if (r.kind === 'kicked') return r.message;
  if (r.kind === 'missing') return "Can't find that lobby: it's private, or it closed";
  if (r.kind === 'closed') return 'That lobby has closed';
  if (r.kind === 'slow') return "The lobby didn't answer in time: try again";
  return r.kind === 'banned' ? "You can't rejoin this lobby" : r.kind === 'locked' ? 'This lobby is private' : 'This lobby is full';
}

/** What the second step's button says once Kick or Make host is picked (null: nothing picked). */
export function seatToolConfirm(choice: string, name: string): string | null {
  return choice === 'kick' ? `Kick ${name}` : choice === 'host' ? `Make ${name} host` : null;
}

/** A Kick or Make host picked and not yet sent: which lobby, seat and player. */
export type Armed = { lobby: string; k: number; choice: string; id: string };

/** Seat `k`'s chooser after a redraw: still armed if it's the same lobby, seat and player. */
export function armedChoice(armed: Armed | null, lobby: string, k: number, id: string): string {
  return armed && armed.lobby === lobby && armed.k === k && armed.id === id ? armed.choice : 'seat';
}

/**
 * The host's choices on another player's seat (the seat chooser the other seats have): Kick or
 * Make host, two steps so neither is a stray click (`seatToolConfirm`). Null where there are none.
 */
export function playerSeatChoices(lobby: Lobby, you: string, index: number): [string, string][] | null {
  const s = lobby.seats[index];
  if (you !== lobby.host || !s || s.kind !== 'player' || s.id === you) return null;
  return [['seat', 'Seated'], ['kick', 'Kick'], ['host', 'Make host']];
}

/** A listed lobby's seats: the ones not closed (the host can close some at Create, or later). */
export const seatsIn = (l: Pick<LobbySummary, 'pips'>): number => [...l.pips].filter((c) => c !== 'x').length || SEATS;

/** How the lobby list can be put in order (a column header's press). */
export type LobbySort = 'drivers' | 'name' | 'track' | 'laps';

/**
 * The lobby list as the Multiplayer screen shows it: online ones only, matching the search (a
 * lobby's name or host) and the track, without full ones if asked, in `sort` order (the fullest
 * first; ties by name). Pure, so it's tested without a DOM.
 */
export function filterLobbies(rows: readonly LobbySummary[], f: { query: string; track: string; hideFull: boolean; sort: LobbySort }, mapName: (key: string) => string): LobbySummary[] {
  const q = f.query.trim().toLowerCase();
  const out = rows.filter(
    (l) =>
      l.id !== LOCAL_ID &&
      (!q || l.name.toLowerCase().includes(q) || (l.host ?? '').toLowerCase().includes(q)) &&
      (!f.track || l.map.split('/')[0] === f.track) &&
      !(f.hideFull && l.filled >= seatsIn(l)),
  );
  const byName = (a: LobbySummary, b: LobbySummary) => a.name.localeCompare(b.name);
  const cmp: Record<LobbySort, (a: LobbySummary, b: LobbySummary) => number> = {
    drivers: (a, b) => b.filled - a.filled || b.players - a.players || byName(a, b),
    name: byName,
    track: (a, b) => mapName(a.map).localeCompare(mapName(b.map)) || byName(a, b),
    laps: (a, b) => a.laps - b.laps || byName(a, b),
  };
  return out.sort(cmp[f.sort]);
}

/** The lobby Quick join takes you to: open between races, with the most players in it (null: none). */
export function quickJoinPick(rows: readonly LobbySummary[]): LobbySummary | null {
  const open = rows.filter((l) => l.id !== LOCAL_ID && l.phase === 'lobby' && l.filled < seatsIn(l) && l.players > 0);
  return open.sort((a, b) => b.players - a.players || b.filled - a.filled)[0] ?? null;
}

/** A pasted invite (a link, a short link or a code) as what it opens: a short link's id, or a lobby code. */
export function readInvite(text: string): { link: string } | { code: string } | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : `https://x/${t.includes('/') ? t : ''}`);
    const lobby = u.searchParams.get('lobby');
    const join = u.searchParams.get('join');
    if (lobby) return { code: lobby };
    if (join) return { link: join };
    if (t.includes('/')) {
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (last) return { link: last };
    }
  } catch {
    // Not a link: a code.
  }
  return /^[A-Za-z0-9-]{3,16}$/.test(t) ? { code: t.toUpperCase() } : null;
}

export class Menu {
  private root: HTMLElement;
  private screen: Screen = { kind: 'title' };
  /** The lobby on screen, as last drawn. */
  private lobby: Lobby | null = null;
  /** Your last pick, until the lobby comes back with it: quick presses each build on the one before. */
  private picked: { car: string; paint: number } | null = null;
  /** A Kick or Make host picked, kept through the lobby redrawing until it's sent or put back. */
  private armed: Armed | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Your car and paint for a new lobby (the last race's, when you come back from one). */
  private yours: { car: string; paint: number };
  private defaults: Partial<LobbyOptions>;
  /** The lobby's map and your car, for the scene behind the menu (main.ts); null off the lobby. */
  onPreview?: (p: Preview | null) => void;
  /** Why online lobbies aren't listed, if they aren't (shown on the title). */
  offline?: () => string;
  /** Whether lobbies can be online (there's a relay). */
  online = false;
  /** The lists refreshing (online lobbies come and go), or an online lobby's connection label. */
  private refresh: ReturnType<typeof setInterval> | null = null;
  /** Off to a race: the page is about to load, so later lobby updates don't start another. */
  private going = false;
  /** A join on its way (lobby updates arrive while it is). */
  private sitting = false;
  /** A "back from the race" on its way. */
  private backing = false;
  /** A new screen is on its way in: the next paint brings its pieces in. */
  private entering = false;
  /** A screen is going: nothing in it can be pressed. */
  private leaving = false;
  /** What had focus on each screen when you left it: back there, it has it again. */
  private focusOn: Partial<Record<Kind, string>> = {};
  /** The lobby list's search, track, Hide full and order; and its rows, when they came. */
  private find = { query: '', track: '', hideFull: true, sort: 'drivers' as LobbySort };
  private rows: LobbySummary[] = [];
  private rowsAt = 0;
  /** An online lobby's invite link, once it's known. */
  private invite: { id: string; link: string | null } | null = null;
  /** The title's Settings button (main.ts opens the panel). */
  onSettings?: () => void;
  /** A short note for the player (main.ts toasts it): why a lobby put you out, or let you in. */
  onNotice?: (text: string) => void;
  /** The title's Credits, Privacy and Terms (main.ts opens the page). */
  onPage?: (page: Page, from: HTMLElement | null) => void;
  /** GameRelay's name check (lobby/relay.ts `nameCheck`) for a plate or an online lobby's name: null when it's fine. */
  checkName?: NameCheck;

  constructor(
    private backend: LobbyBackend,
    private content: MenuContent,
    choices: Partial<RaceSetup>,
    /** Your plate, and where it's kept. */
    private plate: string,
    private store: KeyValue | null,
  ) {
    this.yours = { car: choices.car ?? 'coupe', paint: choices.paint ?? 0 };
    this.defaults = {
      ...(choices.map ? { map: choices.map } : {}),
      ...(choices.laps ? { laps: choices.laps } : {}),
      ...(choices.weather ? { weather: choices.weather } : {}),
      ...(choices.time ? { time: choices.time } : {}),
      ...(choices.mayhem ? { mayhem: choices.mayhem } : {}),
      ...(choices.traffic !== undefined ? { traffic: choices.traffic } : {}),
    };
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.className = 'k';
    document.body.appendChild(this.root);
    onOverlay(() => this.syncInert());
  }

  /** Opened from a short link (`?join=<link>`): into its lobby, or the title if it's gone. */
  async openLink(link: string): Promise<void> {
    const id = await this.backend.joinLink?.(link);
    if (!id) this.tellWhy(link);
    return this.open(id ?? null);
  }

  /** Opens on the title, or straight into a lobby (back from its race, or a reload in it). */
  async open(lobbyId?: string | null): Promise<void> {
    // The menu is up, so your lobby's race is over, however you left it (Back to lobby, a closed
    // tab, the title's URL): it's waiting again, or Start and the seats would refuse.
    const own = await this.backend.get(LOCAL_ID);
    if (own?.phase === 'racing') await this.backend.send(own.id, { type: 'end' });
    await this.syncName();
    let lobby = lobbyId ? await this.backend.get(lobbyId) : null;
    // Gone, or too slow to wait for: the title, and out of it if the join lands later.
    if (lobbyId && !lobby) void this.backend.abandon?.(lobbyId);
    if (lobbyId && !lobby) this.tellWhy(lobbyId);
    // Back from an online lobby's race: its host reopens it (the others come back when they finish).
    if (lobby && lobby.phase === 'racing' && lobby.host === this.backend.youIn(lobby.id)) lobby = (await this.backend.send(lobby.id, { type: 'end' })) ?? lobby;
    return this.show(lobby ? { kind: 'lobby', id: lobby.id } : { kind: 'title' });
  }

  /**
   * Back (Esc, the pad's B): an online lobby goes to the lobby list, the list and your own lobby
   * to the title, the plate to where it was opened from. Out of a lobby, that's leaving it (yours
   * closes: only bots are left).
   */
  back(): void {
    const screen = this.screen;
    if (screen.kind === 'plate' && screen.from && screen.from !== 'online') return void this.show({ kind: 'lobby', id: screen.from });
    if (screen.kind === 'plate' && screen.from === 'online') return void this.show({ kind: 'online' });
    if (screen.kind === 'lobby') {
      void this.backend.send(screen.id, { type: 'leave' });
      return void this.show(screen.id !== LOCAL_ID && this.online ? { kind: 'online' } : { kind: 'title' });
    }
    if (screen.kind !== 'title') void this.show({ kind: 'title' });
  }

  /** A screen's own extra (R, the pad's Y): the lobby list refreshes. */
  alt(): void {
    if (this.screen.kind === 'online') void this.refreshRows(true);
  }

  /**
   * A pick in the lobby (A and D, the pad's bumpers: the car; W and S: the paint). False when
   * there's nothing to pick (not in a lobby, or no seat in it), so the key moves focus instead.
   */
  pick(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    if (this.screen.kind !== 'lobby' || !this.lobby || seatIndex(this.lobby, this.backend.youIn(this.lobby.id)) < 0) return false;
    // Typing in a field, the keys are the field's.
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'range') return false;
    const { classes, paints } = this.content;
    const yours = this.picked ?? this.yourCar(this.lobby);
    const step = dir === 'right' || dir === 'down' ? 1 : -1;
    if (dir === 'left' || dir === 'right') {
      const at = classes.findIndex((c) => c.id === yours.car);
      this.picked = { car: classes[(at + step + classes.length) % classes.length].id, paint: yours.paint };
      this.nudge(dir === 'left' ? 'lPrev' : 'lNext');
    } else this.picked = { car: yours.car, paint: (yours.paint + step + paints.length) % paints.length };
    this.send(this.lobby, { type: 'car', ...this.picked });
    return true;
  }

  /** The car arrow a key stood for flashes, as if it was pressed. */
  private nudge(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('pressed');
    void el.offsetWidth;
    el.classList.add('pressed');
  }

  private async show(screen: Screen): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refresh) clearInterval(this.refresh);
    this.refresh = null;
    const was = this.screen;
    this.screen = screen;
    this.lobby = this.picked = null;
    history.replaceState(null, '', screen.kind === 'lobby' ? keepEmbed(`?lobby=${encodeURIComponent(screen.id)}`) : EMBED ? keepEmbed('') : location.pathname);
    // Another screen: the one up goes first (nothing in it can be pressed meanwhile), and the new
    // one comes in, the backdrop changing under both.
    if (this.root.childElementCount && !sameScreen(was, screen)) {
      const id = document.activeElement?.id;
      if (id && this.root.contains(document.activeElement)) this.focusOn[was.kind] = id;
      this.root.dataset.dir = DEPTH[screen.kind] < DEPTH[was.kind] ? 'back' : 'fwd';
      this.root.dataset.screen = screen.kind;
      this.root.classList.remove('entering');
      this.root.classList.add('leaving');
      this.leaving = true;
      this.syncInert();
      await wait(reducedMotion() ? 0 : LEAVE_MS);
      // Another screen was asked for meanwhile: that one's on its way instead.
      if (this.screen !== screen) return;
      this.entering = true;
    } else this.root.dataset.screen = screen.kind;
    if (screen.kind !== 'lobby') this.onPreview?.(null);
    if (screen.kind === 'title' || screen.kind === 'online') {
      const rows = await this.backend.list().catch(() => [] as LobbySummary[]);
      // Another screen was asked for while the list loaded (each await below checks the same).
      if (this.screen !== screen) return;
      this.rows = rows;
      this.rowsAt = Date.now();
      if (screen.kind === 'title') this.renderTitle();
      else this.renderOnline();
      // Online lobbies come and go: the lists follow every few seconds while they're up.
      if (this.online) this.refresh = setInterval(() => void this.refreshRows(false), screen.kind === 'online' ? 1000 : 4000);
    } else if (screen.kind === 'plate') this.renderPlate(screen.from);
    else {
      let lobby = await this.backend.get(screen.id);
      // Gone elsewhere while it loaded (Esc while joining): that screen has the menu now, and you
      // leave the room you got into (Esc's leave went out before you were in it).
      if (this.screen !== screen) {
        const now = this.screen;
        if (!(now.kind === 'lobby' && now.id === screen.id)) void this.backend.abandon?.(screen.id);
        return;
      }
      // Gone, or too slow to wait for: back out, and out of it if the join lands later.
      if (!lobby) {
        void this.backend.abandon?.(screen.id);
        this.tellWhy(screen.id);
        return this.show(this.online && screen.id !== LOCAL_ID ? { kind: 'online' } : { kind: 'title' });
      }
      let phase = lobby.phase;
      this.unsubscribe = this.backend.subscribe(screen.id, (l) => {
        if (!l) {
          this.tellWhy(screen.id);
          return void this.show(this.online && screen.id !== LOCAL_ID ? { kind: 'online' } : { kind: 'title' });
        }
        const seated = seatIndex(l, this.backend.youIn(l.id)) >= 0;
        // The host started: everyone seated goes to the race (the same one: its seed is the lobby's).
        if (phase === 'lobby' && l.phase === 'racing' && seated) this.go(l);
        phase = l.phase;
        if (this.going) return;
        // Its host left mid-race and it passed to you while you wait here: reopen it.
        if (l.phase === 'racing' && l.host === this.backend.youIn(l.id)) void this.backend.send(l.id, { type: 'end' });
        // Watching (it was racing, full or private) and a seat's free now: take it.
        if (!seated) void this.sit(l);
        // Here, but still down as racing (the first "back" didn't land: the host role moves while
        // everyone reloads at the end of a race): say it again.
        else void this.back_(l);
        this.renderLobby(l);
      });
      // The connection label follows the SDK as it finds (or loses) a direct way to each player,
      // and the pings come in every few seconds.
      if (screen.id !== LOCAL_ID)
        this.refresh = setInterval(() => {
          const el = document.getElementById('lNet');
          const html = this.netLabel(screen.id);
          if (el && el.innerHTML !== html) el.innerHTML = html;
          for (const td of this.root.querySelectorAll<HTMLElement>('.l-ping[data-player]')) {
            const html = this.pingText(screen.id, td.dataset.player!);
            if (td.innerHTML !== html) td.innerHTML = html;
          }
        }, 1000);
      lobby = (await this.sit(lobby)) ?? lobby;
      if (this.screen !== screen) return;
      // Back from its race: the others see you're here again.
      lobby = (await this.back_(lobby)) ?? lobby;
      if (this.screen !== screen) return;
      this.renderLobby(lobby);
      if (screen.id !== LOCAL_ID && (!this.invite || this.invite.id !== screen.id)) void this.fetchInvite(lobby);
    }
  }

  /** The lists again: the title's live lobbies, or the lobby list's rows and the time since (every second there). */
  private async refreshRows(now: boolean): Promise<void> {
    const screen = this.screen;
    if (now || this.screen.kind === 'title' || Date.now() - this.rowsAt > 4000) {
      const rows = await this.backend.list().catch(() => null);
      if (this.screen !== screen || !rows) return;
      this.rows = rows;
      this.rowsAt = Date.now();
    }
    // Not while the pointer's over the list: a row moving under it would be a miss.
    if (screen.kind === 'title' && !this.root.querySelector('#tLive:hover')) this.fillLive();
    if (screen.kind === 'online') {
      if (!this.root.querySelector('.o-rows:hover')) this.fillRows();
      this.fillStatus();
    }
  }

  /** Back from the lobby's race, on its screen: your seat stops saying "Racing" (one try at a time). */
  private async back_(lobby: Lobby): Promise<Lobby | null> {
    const s = lobby.seats[seatIndex(lobby, this.backend.youIn(lobby.id))];
    if (this.backing || s?.kind !== 'player' || !s.racing) return null;
    this.backing = true;
    try {
      return await this.backend.send(lobby.id, { type: 'racing', racing: false });
    } finally {
      this.backing = false;
    }
  }

  /** In someone else's lobby without a seat: take the first open one, if it's between races (and not private, unless nobody's left to keep it so). */
  private async sit(lobby: Lobby): Promise<Lobby | null> {
    // The same rule the host's `apply` holds a join to.
    if (this.sitting || !canJoin(lobby, this.backend.youIn(lobby.id))) return null;
    this.sitting = true;
    try {
      return await this.backend.send(lobby.id, { type: 'join', player: this.newcomer(lobby.id) });
    } finally {
      this.sitting = false;
    }
  }

  /** The menu can't be pressed while a screen goes, nor under Settings (overlay.ts): a redraw keeps it so. */
  private syncInert(): void {
    this.root.inert = this.leaving || overlayUp();
  }

  /** Swaps the screen, keeping focus on the same control when it's still there (for the pad). */
  private paint(html: string, focus?: string): void {
    const was = document.activeElement?.id;
    const entering = this.entering || !this.root.childElementCount;
    this.root.innerHTML = html;
    this.root.classList.remove('leaving');
    this.leaving = false;
    this.syncInert();
    // A new screen's pieces come in; a screen redrawn in place (a lobby update) doesn't. The class
    // only for a new screen: left on, everything a redraw put in would come in again.
    this.root.classList.remove('entering');
    if (entering) {
      this.entering = false;
      void this.root.offsetWidth;
      this.root.classList.add('entering');
      clearTimeout(this.enterDone);
      this.enterDone = setTimeout(() => this.root.classList.remove('entering'), reducedMotion() ? 150 : 900);
    }
    const back = entering ? this.focusOn[this.screen.kind] : undefined;
    const el = (!entering && was && document.getElementById(was)) || (back && document.getElementById(back)) || (focus && document.getElementById(focus));
    // Without scrolling to it: on a small window the screen opens at the top.
    (el as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private enterDone: ReturnType<typeof setTimeout> | undefined;

  private on(id: string, fn: () => void): void {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  }

  /** Whether the layout's map has a sunset palette (the Time option). */
  private hasSunset(key: string): boolean {
    return !!this.content.maps.find((m) => key.startsWith(m.id + '/'))?.sunset;
  }

  /** The layouts the lobby and quick race offer (lobbyKeys). */
  private lobbyKeys(): string[] {
    return lobbyKeys(this.content.maps, Object.keys(this.content.layouts));
  }

  private mapName(key: string): string {
    const map = this.content.maps.find((m) => key.startsWith(m.id + '/'));
    return map ? (map.layouts.length > 1 ? `${map.name} · ${key.split('/')[1]}` : map.name) : key;
  }

  /** The race's rules in a word: Chaos, No traffic, or Normal. */
  private rulesText(mayhem?: LobbyOptions['mayhem'], traffic?: boolean): { text: string; hot: boolean } {
    if (mayhem === 'chaos') return { text: 'Mayhem', hot: true };
    if (traffic === false) return { text: 'No traffic', hot: false };
    if (mayhem === 'off') return { text: 'No mayhem', hot: false };
    return { text: 'Normal', hot: false };
  }

  // ---- the title ----

  private renderTitle(): void {
    const items: [string, string, string][] = [
      ['mQuick', 'Quick race', 'A random car, a random track, seven bots. Go.'],
      ['mSolo', 'Single player', 'Your lobby: pick the track, the rules and your car.'],
      ['mOnline', 'Multiplayer', this.online ? 'Join a lobby, or start one and send the link.' : this.offline?.() || 'Online play is off in this build.'],
      ['mTrial', 'Time trial', 'Three laps alone. Your best goes on the board.'],
      ['mFree', 'Free drive', 'No race, no clock: you, the map, the traffic.'],
    ];
    this.paint(
      `<div class="scr title">
        <div class="t-brand" data-in="l"><div class="t-word" aria-label="Racecar">RACECAR</div><p class="k-eyebrow">Arcade racing · up to ${SEATS} drivers</p></div>
        <nav class="k-menu t-menu" aria-label="Play">${items.map(([id, l, d]) => menuItem(id, l, d)).join('')}</nav>
        <div class="t-top" data-in="t">${driverChip(this.plate)}${button('mSettings', GEAR, 'icon', { 'aria-label': 'Settings', title: 'Settings' })}</div>
        <section class="k-panel t-live" id="tLive" data-in="r"></section>
        <footer class="t-foot" data-in="b">${hints(['select', 'Select'], ['confirm', 'Play'])}</footer>
        <div class="t-legal" data-in="b"><a href="?page=privacy" id="mPrivacy">Privacy</a> · <a href="?page=terms" id="mTerms">Terms</a> · <button type="button" id="mCredits">Credits</button> · <span title="This build's version">${esc(BUILD_VERSION)}</span></div>
      </div>`,
      'mQuick',
    );
    this.fillLive();
    this.on('mQuick', () => this.quickRace());
    this.on('mSolo', () => void this.singlePlayer());
    this.on('mOnline', () => void (this.online ? this.show({ kind: 'online' }) : this.onNotice?.(this.offline?.() || 'Online play is off in this build')));
    this.on('mTrial', () => void this.timeTrial());
    this.on('mFree', () => void this.freeDrive());
    this.on('mPlate', () => void this.show({ kind: 'plate' }));
    this.on('mSettings', () => this.onSettings?.());
    // The links open in place; their hrefs are for a new tab.
    for (const [id, page] of [['mCredits', 'credits'], ['mPrivacy', 'privacy'], ['mTerms', 'terms']] as const) {
      const el = document.getElementById(id);
      if (el)
        el.onclick = (e) => {
          e.preventDefault();
          this.onPage?.(page, el);
        };
    }
  }

  /** The title's live lobbies: the two fullest online, and the way to the rest. */
  private fillLive(): void {
    const el = document.getElementById('tLive');
    if (!el) return;
    const list = filterLobbies(this.rows, { query: '', track: '', hideFull: false, sort: 'drivers' }, (k) => this.mapName(k));
    const was = document.activeElement?.id;
    const offline = this.offline?.() ?? '';
    const all = this.online && !offline ? `<button type="button" class="t-all" id="tAll"><i class="k-dot live"></i>${list.length} open · See all ›</button>` : '';
    const rows = list.slice(0, 2).map((l) => this.liveRow(l)).join('');
    const empty = offline || !this.online ? `<p class="t-none">${esc(offline || 'Online play is off in this build.')} Quick race still works: race the bots.</p>` : `<p class="t-none">No lobbies online right now. Start one in Multiplayer and send your friends the link.</p>`;
    el.innerHTML = `<div class="t-liveHead"><h2 class="k-h2">Live lobbies</h2>${all}</div>${rows || empty}`;
    for (const l of list.slice(0, 2)) this.on(`lobby-${l.id}`, () => void this.show({ kind: 'lobby', id: l.id }));
    this.on('tAll', () => void this.show({ kind: 'online' }));
    if (was && !document.activeElement?.id) document.getElementById(was)?.focus({ preventScroll: true });
  }

  private liveRow(l: LobbySummary): string {
    const rules = this.rulesText(l.mayhem, l.traffic);
    const meta = [this.mapName(l.map), this.lapsText(l.map, l.laps), ...(rules.text === 'Normal' ? [] : [rules.text]), ...(l.phase === 'racing' ? ['racing'] : [])].join(' · ');
    return `<button type="button" class="k-lrow t-lrow" id="lobby-${esc(l.id)}"><span class="t-lname"><b>${esc(l.name)}</b><small>${esc(meta)}</small></span><b class="t-count k-num">${l.filled}/${seatsIn(l)}</b><span class="k-btn small">Join</span></button>`;
  }

  /** Single player: straight into your own lobby (you and bots, in this browser). */
  private async singlePlayer(): Promise<void> {
    const here = this.screen;
    const options: LobbyOptions = { ...DEFAULT_OPTIONS, map: Object.keys(this.content.layouts)[0], ...this.defaults };
    const lobby = await this.backend.create(this.newcomer(LOCAL_ID), { name: `${this.plate}'s lobby`, visibility: 'public', online: false, options }).catch(() => null);
    if (this.screen !== here) return void (lobby && this.backend.abandon?.(lobby.id));
    if (lobby) void this.show({ kind: 'lobby', id: lobby.id });
  }

  /** Quick race: no lobby, a car picked at random on a map picked at random, you and seven bots. */
  private quickRace(): void {
    const { classes, paints } = this.content;
    goTo(toQuery(quickRaceSetup(this.lobbyKeys(), randomCar(classes.map((c) => c.id), paints.length))));
  }

  /** Time Trial (SPEC §10) on your lobby's map (or the last race's): you alone, laps for the online board. */
  private async timeTrial(): Promise<void> {
    const lobby = await this.backend.get(LOCAL_ID);
    const o = { ...this.defaults, ...(lobby?.options ?? {}) };
    // A getaway's streets have no laps: its board would be empty, so the first lap map instead.
    const laps = (key: string | undefined) => !!key && !!this.content.layouts[key] && !this.content.layouts[key].getaway;
    const map = laps(o.map) ? o.map! : (Object.keys(this.content.layouts).find(laps) ?? Object.keys(this.content.layouts)[0]);
    goTo(toQuery(trialSetup(map, this.yourCar(lobby), o.time ?? 'day')));
  }

  private async freeDrive(): Promise<void> {
    const lobby = await this.backend.get(LOCAL_ID);
    // Your lobby's settings, or the last race's when there's no lobby.
    const o = { ...this.defaults, ...(lobby?.options ?? {}) };
    const setup: RaceSetup = {
      mode: 'free',
      map: o.map ?? Object.keys(this.content.layouts)[0],
      ...this.yourCar(lobby),
      seats: legacySeats(3, FILL_DIFFICULTY),
      laps: 3,
      weather: o.weather ?? 'random',
      time: o.time ?? 'random',
      mayhem: o.mayhem ?? 'normal',
      traffic: o.traffic ?? true,
      seed: Math.floor(Math.random() * 1e9),
    };
    goTo(toQuery(setup));
  }

  /** You, new to lobby `id`: a car and paint picked at random (yours to change at the turntable). */
  private newcomer(id: string): ReturnType<Menu['me']> {
    const { classes, paints } = this.content;
    return { ...this.me(id), ...randomCar(classes.map((c) => c.id), paints.length) };
  }

  /** You, as a player in lobby `id`: your plate is your name. */
  private me(id: string): { id: string; name: string; car: string; paint: number } {
    return { id: this.backend.youIn(id), name: this.plate, ...this.yours };
  }

  // ---- Multiplayer: the lobby list, Create lobby, Join with code ----

  private renderOnline(): void {
    const tracks: [string, string][] = [['', 'Any'], ...this.content.maps.filter((m) => this.lobbyKeys().some((k) => k.startsWith(m.id + '/'))).map((m): [string, string] => [m.id, m.name])];
    const col = (sort: LobbySort, name: string) => `<button type="button" class="o-col${this.find.sort === sort ? ' on' : ''}" data-sort="${sort}">${name}${this.find.sort === sort ? ' ▾' : ''}</button>`;
    this.paint(
      `<div class="scr online">
        ${header('Multiplayer', '<span class="o-status" id="oStatus"></span>', driverChip(this.plate, false))}
        <section class="k-panel o-list" data-in="l">
          <div class="o-tools">
            ${field('oFind', this.find.query, { placeholder: 'Search lobbies or hosts', search: true })}
            <span class="o-track"><span class="k-muted">Track</span>${chooser('oTrack', tracks, this.find.track)}</span>
            <button type="button" class="o-full${this.find.hideFull ? ' on' : ''}" id="oFull" aria-pressed="${this.find.hideFull}"><i>✓</i>Hide full</button>
            ${button('oQuick', 'Quick join', 'secondary')}
          </div>
          <div class="o-cols">${col('name', 'Lobby')}${col('track', 'Track')}${col('laps', 'Laps')}<span class="o-col">Rules</span>${col('drivers', 'Drivers')}<span></span></div>
          <div class="o-rows" id="oRows"></div>
          <footer class="o-foot"><span id="oNote" class="k-muted"></span>${hints(['refresh', 'Refresh'], ['confirm', 'Join'])}</footer>
        </section>
        <div class="o-side">
        <section class="k-panel o-create" data-in="r">
          <h2 class="k-h2">Create lobby</h2>
          <label class="o-lab">Name</label>${field('cName', `${this.plate}'s lobby`, { max: 24 })}
          <label class="o-lab">Who can join</label>${segmented('cVis', [['public', 'Public'], ['invite', 'Link only']], 'public')}
          ${row('Seats', chooser('cSeats', Array.from({ length: SEATS - 1 }, (_, k): [string, string] => [String(k + 2), String(k + 2)]), String(SEATS)))}
          ${row('Bots fill empty seats', toggle('cFill', true, 'Bots fill empty seats'))}
          ${button('cGo', 'Create lobby', 'primary')}
          <p class="o-createNote k-muted" id="cNote">Track, laps and rules are set inside the lobby.</p>
        </section>
        <section class="k-panel o-code" data-in="r">
          <h2 class="k-h2">Join with code</h2>
          <div class="o-codeRow">${field('jCode', '', { placeholder: 'Code or link', code: true, max: 200 })}${button('jGo', 'Join', 'small', { class: 'solid' })}</div>
        </section>
        </div>
      </div>`,
      'oFind',
    );
    this.fillRows();
    this.fillStatus();
    const find = document.getElementById('oFind') as HTMLInputElement;
    find.oninput = () => {
      this.find.query = find.value;
      this.fillRows();
    };
    // Down out of the search goes to the list (the arrows are the field's otherwise).
    find.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        (this.root.querySelector('.o-rows .k-lrow') as HTMLElement | null)?.focus();
      }
    };
    const track = document.getElementById('oTrack') as HTMLButtonElement;
    track.onchange = () => {
      this.find.track = track.value;
      this.fillRows();
    };
    this.on('oFull', () => {
      this.find.hideFull = !this.find.hideFull;
      const b = document.getElementById('oFull')!;
      b.classList.toggle('on', this.find.hideFull);
      b.setAttribute('aria-pressed', String(this.find.hideFull));
      this.fillRows();
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.o-col[data-sort]'))
      b.onclick = () => {
        this.find.sort = b.dataset.sort as LobbySort;
        for (const c of this.root.querySelectorAll<HTMLElement>('.o-col[data-sort]')) {
          const on = c.dataset.sort === this.find.sort;
          c.classList.toggle('on', on);
          c.textContent = c.textContent!.replace(' ▾', '') + (on ? ' ▾' : '');
        }
        this.fillRows();
      };
    this.on('oQuick', () => {
      const l = quickJoinPick(this.rows);
      if (l) void this.show({ kind: 'lobby', id: l.id });
      else this.onNotice?.('No open lobbies right now: create one, and bots fill the seats');
    });
    this.on('kBack', () => this.back());
    this.on('cGo', () => void this.createOnline());
    const code = document.getElementById('jCode') as HTMLInputElement;
    const join = () => {
      const invite = readInvite(code.value);
      if (!invite) return void (code.parentElement!.classList.add('bad'), code.focus());
      if ('code' in invite) void this.show({ kind: 'lobby', id: invite.code });
      else void this.openLink(invite.link);
    };
    code.oninput = () => code.parentElement!.classList.remove('bad');
    code.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        join();
      }
    };
    this.on('jGo', join);
    const name = document.getElementById('cName') as HTMLInputElement;
    name.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.createOnline();
      }
    };
  }

  /** The lobby list's rows, as the search, track and order have them. */
  private fillRows(): void {
    const el = document.getElementById('oRows');
    if (!el) return;
    const list = filterLobbies(this.rows, this.find, (k) => this.mapName(k));
    const was = document.activeElement?.id;
    const offline = this.offline?.() ?? '';
    el.innerHTML = list.length
      ? list
          .map((l) => {
            const rules = this.rulesText(l.mayhem, l.traffic);
            const laps = this.layout(l.map)?.run ? 'Run' : String(l.laps);
            return `<button type="button" class="k-lrow o-row" id="lobby-${esc(l.id)}">
              <span class="o-name"><b>${esc(l.name)}</b><small>${l.host ? `Host ${esc(l.host)}` : ''}${l.phase === 'racing' ? `${l.host ? ' · ' : ''}racing now` : ''}</small></span>
              <span>${esc(this.mapName(l.map))}</span><span class="k-num">${laps}</span><span class="${rules.hot ? 'o-hot' : ''}">${esc(rules.text)}</span>
              ${fill(l.filled, seatsIn(l))}<span class="k-btn small">Join</span></button>`;
          })
          .join('')
      : `<p class="o-none">${esc(offline || (this.rows.some((l) => l.id !== LOCAL_ID) ? 'No lobbies match that.' : 'No lobbies online right now: create one, and send your friends the link.'))}</p>`;
    for (const l of list) this.on(`lobby-${l.id}`, () => void this.show({ kind: 'lobby', id: l.id }));
    if (was && !document.activeElement?.id) document.getElementById(was)?.focus({ preventScroll: true });
    const note = document.getElementById('oNote');
    if (note) note.textContent = `${list.length} open lobb${list.length === 1 ? 'y' : 'ies'} · updated ${Math.round((Date.now() - this.rowsAt) / 1000)} s ago · bots fill empty seats at start`;
  }

  /** How many are racing online, by the lists: the drivers in the lobbies listed. */
  private fillStatus(): void {
    const el = document.getElementById('oStatus');
    const online = this.rows.filter((l) => l.id !== LOCAL_ID);
    const drivers = online.reduce((n, l) => n + l.players, 0);
    if (el && this.offline?.()) el.innerHTML = '';
    else if (el) el.innerHTML = `<i class="k-dot live"></i>${drivers} driver${drivers === 1 ? '' : 's'} in ${online.length} lobb${online.length === 1 ? 'y' : 'ies'}`;
    const note = document.getElementById('oNote');
    if (note) note.textContent = note.textContent!.replace(/updated \d+ s ago/, `updated ${Math.round((Date.now() - this.rowsAt) / 1000)} s ago`);
  }

  /** Create lobby: an online lobby, its seats past the number asked for closed. */
  private async createOnline(): Promise<void> {
    const name = (document.getElementById('cName') as HTMLInputElement).value;
    const visibility = (document.getElementById('cVis') as HTMLButtonElement).value as Lobby['visibility'];
    const seats = Number((document.getElementById('cSeats') as HTMLButtonElement).value) || SEATS;
    const fillOn = toggled(document.getElementById('cFill'));
    const go = document.getElementById('cGo') as HTMLButtonElement;
    const note = () => document.getElementById('cNote');
    const here = this.screen;
    if (go.disabled) return;
    go.disabled = true;
    // Strangers see an online lobby's name in their list: GameRelay checks it first.
    const problem = name.trim() ? await this.checkName?.(name.trim()) : null;
    if (problem) {
      go.disabled = false;
      const n = note();
      if (n) n.textContent = `${problem}: pick another name.`;
      return;
    }
    const options: LobbyOptions = { ...DEFAULT_OPTIONS, map: Object.keys(this.content.layouts)[0], ...this.defaults, fill: fillOn };
    const lobby = await this.backend.create(this.newcomer(''), { name, visibility, online: true, options }).catch(() => null);
    if (go.isConnected) go.disabled = false;
    // Back (or Esc) while it was being made: you've left, and so does the lobby.
    if (this.screen !== here) return void (lobby && this.backend.abandon?.(lobby.id));
    if (!lobby) {
      const n = note();
      if (n) n.textContent = "Couldn't reach the lobby server. Try again, or play Single player.";
      return;
    }
    for (let k = SEATS - 1; k >= seats; k--) await this.backend.send(lobby.id, { type: 'seat', index: k, to: 'closed' });
    if (this.screen === here) void this.show({ kind: 'lobby', id: lobby.id });
  }

  // ---- your plate ----

  private renderPlate(from?: string): void {
    this.paint(
      `<div class="scr plate">
        ${header('Your plate')}
        <section class="k-panel p-card" data-in="pop">
          <p class="k-muted">Your name on your car, in lobbies and in the results: up to ${PLATE_MAX} letters, numbers and spaces.</p>
          <div class="p-preview" id="pPreview">${plate(this.plate)}</div>
          ${field('pText', this.plate, { max: PLATE_MAX + 4, code: true })}
          <p class="p-err" id="pErr"></p>
          <div class="p-acts">${button('pBack', 'Back', 'link')}${button('pSave', 'Save', 'primary')}</div>
        </section>
        <footer class="t-foot" data-in="b">${hints(['confirm', 'Save'], ['back', 'Back'])}</footer>
      </div>`,
      'pText',
    );
    const input = document.getElementById('pText') as HTMLInputElement;
    input.setAttribute('autocapitalize', 'characters');
    const err = document.getElementById('pErr')!;
    const preview = document.getElementById('pPreview')!;
    // Typed straight into plate form: uppercase, only what a plate can show.
    input.oninput = () => {
      const t = typedPlate(input.value, input.selectionStart ?? input.value.length);
      input.value = t.value;
      input.setSelectionRange(t.cursor, t.cursor);
      const clean = cleanPlate(input.value);
      preview.innerHTML = plate(clean || ' ');
      err.textContent = clean ? (plateProblem(clean) ?? '') : '';
    };
    const save = async () => {
      const p = cleanPlate(input.value);
      // The plate's own rules first (offline too), then GameRelay's, when it's a new plate.
      const problem = plateProblem(p) ?? (p !== this.plate ? await this.checkName?.(p, PLATE_RULES) : null) ?? savePlate(this.store, p);
      if (problem) return void (err.textContent = problem);
      const old = this.plate;
      this.plate = p;
      await this.syncName(old);
      if (from && from !== LOCAL_ID && from !== 'online') await this.syncName(old, from);
      void this.show(from === 'online' ? { kind: 'online' } : from ? { kind: 'lobby', id: from } : { kind: 'title' });
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void save();
      }
    };
    this.on('pSave', () => void save());
    this.on('pBack', () => this.back());
    this.on('kBack', () => this.back());
    input.select();
  }

  /** Says why lobby `id` refused you or put you out, if it said. */
  private tellWhy(id: string): void {
    const r = this.backend.why?.(id);
    if (r) this.onNotice?.(refusalText(r));
  }

  /**
   * A plate saved before GameRelay checked names (or before the game blocked a term) gets the same
   * check once the menu's up; one it refuses is swapped for a fresh RC plate, and you're told.
   */
  async checkStoredPlate(): Promise<void> {
    const old = this.plate;
    const problem = await this.checkName?.(old, PLATE_RULES);
    if (!problem || this.plate !== old) return;
    this.plate = randomPlate();
    savePlate(this.store, this.plate);
    await this.syncName(old);
    this.onNotice?.(`Plate ${old} isn't allowed online: you're ${this.plate} for now (Edit, top right of the title).`);
    if (this.screen.kind === 'title') this.renderTitle();
  }

  /**
   * Your lobby goes by your plate: your seat's name, and the lobby's own name while it's still
   * the one it was given (`‹old›'s lobby`). Also mends lobbies saved before plates (a seat named
   * "You"), when the menu opens.
   */
  private async syncName(old?: string, id = LOCAL_ID): Promise<void> {
    const own = await this.backend.get(id);
    const seat = own?.seats[seatIndex(own, this.backend.youIn(id))];
    if (!own || seat?.kind !== 'player') return;
    if (seat.name !== this.plate) await this.backend.send(own.id, { type: 'name', name: this.plate });
    const was = old ?? seat.name;
    if (own.host === this.backend.youIn(id) && own.name === `${was}'s lobby` && was !== this.plate) await this.backend.send(own.id, { type: 'options', name: `${this.plate}'s lobby` });
  }

  private yourCar(lobby: Lobby | null): { car: string; paint: number } {
    const s = lobby?.seats[seatIndex(lobby, this.backend.youIn(lobby.id))];
    return s && s.kind === 'player' ? { car: s.car, paint: s.paint } : this.yours;
  }

  // ---- the race's options ----

  /** The weather choices: on a map where it snows (map.json lists `snow`), rain's is snow's; where sandstorms blow (`sand`), a sandstorm's. */
  private weathers(key: string): [string, string][] {
    const weather = this.content.maps.find((m) => key.startsWith(m.id + '/'))?.weather;
    const fall = weather?.includes('snow') ? 'Snow' : weather?.includes('sand') ? 'Sandstorm' : null;
    return fall ? WEATHERS.map(([v, l]) => [v, v === 'rain' ? fall : l]) : WEATHERS;
  }

  /** A race's length in words: "3 laps", or "one run" on a map that's one run down (layout.run). */
  private lapsText(map: string, laps: number): string {
    return this.layout(map)?.run ? 'one run' : `${laps} lap${laps === 1 ? '' : 's'}`;
  }

  /**
   * The race's options as rows, label left and its chooser right. The host's to cycle; everyone
   * else reads them. On a map that's one run there are no laps to pick (the laps picked are kept
   * for the next map), and Time only on a map with a sunset.
   */
  private optionRows(o: LobbyOptions, host: boolean): string {
    // (A lobby opened on an experimental map from a link keeps it in the list.)
    const keys = this.lobbyKeys();
    const maps: [string, string][] = (keys.includes(o.map) ? keys : [...keys, o.map]).map((k) => [k, this.mapName(k)]);
    const read = (v: string) => `<span class="l-val">${esc(v)}</span>`;
    const opt = (name: string, id: string, opts: [string, string][], value: string, off = false) => row(name, host && !off ? chooser(id, opts, value) : read(label(opts, value)), off ? 'off' : '');
    const run = !!this.layout(o.map)?.run;
    return [
      opt('Track', 'oMap', maps, o.map),
      run ? row('Length', read('One run')) : opt('Laps', 'oLaps', Array.from({ length: MAX_LAPS }, (_, k): [string, string] => [String(k + 1), String(k + 1)]), String(o.laps)),
      opt('Weather', 'oWeather', this.weathers(o.map), o.weather),
      ...(this.hasSunset(o.map) ? [opt('Time of day', 'oTime', TIMES, o.time)] : []),
      opt('Mayhem', 'oMayhem', MAYHEMS, o.mayhem),
      opt('Traffic', 'oTraffic', [['1', 'On'], ['0', 'Off']], o.traffic ? '1' : '0'),
    ].join('');
  }

  /** The options as the choosers have them, the rest as they were (laps on a run, time without a sunset, fill). */
  private readOptions(o: LobbyOptions): LobbyOptions {
    const v = (id: string) => (document.getElementById(id) as HTMLButtonElement | null)?.value;
    return {
      map: v('oMap') ?? o.map,
      laps: Number(v('oLaps') ?? o.laps),
      weather: (v('oWeather') ?? o.weather) as LobbyOptions['weather'],
      time: (v('oTime') ?? o.time) as LobbyOptions['time'],
      mayhem: (v('oMayhem') ?? o.mayhem) as LobbyOptions['mayhem'],
      traffic: (v('oTraffic') ?? (o.traffic ? '1' : '0')) === '1',
      fill: o.fill !== false,
    };
  }

  // ---- the lobby ----

  private send(lobby: Lobby, action: LobbyAction): void {
    void this.backend.send(lobby.id, action);
  }

  private renderLobby(lobby: Lobby): void {
    const { classes, paints } = this.content;
    const you = this.backend.youIn(lobby.id);
    const host = lobby.host === you;
    const online = lobby.id !== LOCAL_ID;
    const mine = seatIndex(lobby, you);
    const yours = this.yourCar(lobby);
    if (this.picked && this.picked.car === yours.car && this.picked.paint === yours.paint) this.picked = null;
    const className = (id: string) => classes.find((c) => c.id === id)?.name ?? id;
    const fillOn = lobby.options.fill !== false;
    const players = lobby.seats.filter((s) => s.kind === 'player');
    const open = lobby.seats.filter((s) => s.kind === 'open').length;
    // The host is ready by starting; everyone else says so.
    const ready = players.filter((s) => s.kind === 'player' && (s.id === lobby.host || s.ready)).length;
    const seats = lobby.seats
      .map((s, k) => {
        const n = `<span class="l-n k-num">${k + 1}</span>`;
        if (s.kind === 'player') {
          const me = s.id === you;
          const tools = online ? playerSeatChoices(lobby, you, k) : null;
          const status = s.racing && !me ? tag('Racing', 'line') : s.id === lobby.host ? tag(online ? 'Host' : 'Ready', online ? 'sun' : 'ice') : s.ready ? tag('Ready') : `<span class="l-wait">Not ready</span>`;
          const ping = online && !me ? `<span class="l-ping" data-player="${esc(s.id)}">${this.pingText(lobby.id, s.id)}</span>` : '';
          const name = me ? `<button type="button" class="l-name" id="lPlate" title="Edit your plate">${esc(s.name)}</button>` : `<span class="l-name">${esc(s.name)}</span>`;
          const tool = tools ? `${chooser(`pseat-${k}`, tools, armedChoice(this.armed, lobby.id, k, s.id))}<button type="button" id="pgo-${k}" class="k-btn danger l-go" hidden></button>` : '';
          // The car and ping under the name: the host's seat tools need the row's width.
          return `<div class="l-seat player${me ? ' me' : ''}">${n}<span class="l-who">${name}<small class="l-seatCar">${esc(className(s.car))}${ping}</small></span>${tool}${status}</div>`;
        }
        const choice: SeatChoice = s.kind === 'ai' ? (['ai-easy', 'ai-normal', 'ai-hard'] as const)[s.difficulty] : s.kind;
        // The rival a seat brings (the same one every race: see roster in lobby.ts).
        const cls = classes[k % classes.length];
        const what = host ? chooser(`seat-${k}`, SEAT_OPTS, choice) : `<span class="l-name">${esc(label(SEAT_OPTS, choice))}</span>`;
        const right = s.kind === 'ai' ? `<span class="l-seatCar">${esc(aiPlate(cls.id))}</span>${tag('Bot', 'quiet')}` : s.kind === 'open' && fillOn ? tag('Bot', 'quiet') : '';
        return `<div class="l-seat ${s.kind}">${n}${what}${right}</div>`;
      })
      .join('');
    const o = lobby.options;
    this.lobby = lobby;
    const [, vis, visHint] = ACCESS.find(([v]) => v === lobby.visibility) ?? ACCESS[0];
    const visTag = !online ? tag('Private', 'outline', 'Just you, with bots, in this browser') : host ? `<button type="button" class="k-tag outline l-vis" id="lVis" title="${esc(visHint)}. Press to change">${esc(vis)}</button>` : tag(vis, 'outline', visHint);
    const right = online && lobby.visibility !== 'locked' ? this.inviteBox(lobby) : '';
    const action = host
      ? button('lStart', 'Start race', 'primary', { disabled: mine < 0 })
      : button('lReady', mine >= 0 && lobby.seats[mine].kind === 'player' && lobby.seats[mine].ready ? 'Not ready' : 'Ready', 'primary', { disabled: mine < 0 });
    this.paint(
      `<div class="scr lobby">
        ${header(lobby.name, `${visTag}<span id="lNet">${this.netLabel(lobby.id)}</span>`, right)}
        <section class="k-panel l-seats" data-in="l">
          <div class="l-head"><h2 class="k-h2">Drivers</h2><span class="k-muted">${players.length} joined · ${open} open</span></div>
          <div class="l-list">${seats}</div>
          <div class="l-fill">${row('Fill open seats with bots', host ? toggle('lFill', fillOn, 'Fill open seats with bots') : `<span class="l-val">${fillOn ? 'On' : 'Off'}</span>`)}</div>
        </section>
        ${mine >= 0 ? this.carPanel(yours) : `<div class="stage l-frame watching" data-in="fade"></div><section class="k-panel l-car" data-in="b"><p class="k-muted">Watching: you'll get a seat when one opens between races.</p></section>`}
        <section class="k-panel l-opts" data-in="r">
          ${this.trackHead(o.map)}
          <div class="l-optList">${this.optionRows(o, host)}</div>
          <div class="l-go">
            <p class="l-ready k-muted"><b>${ready}</b> of ${players.length} driver${players.length === 1 ? '' : 's'} ready</p>
            ${action}
            ${button('lLeave', host && players.length === 1 ? 'Close lobby' : 'Leave lobby', 'danger')}
          </div>
        </section>
      </div>`,
      host ? 'lStart' : 'lReady',
    );
    this.onPreview?.({ map: o.map, weather: o.weather, time: o.time, car: mine >= 0 ? { ...yours, plate: this.plate } : undefined });
    this.on('kBack', () => this.back());
    this.on('lStart', () => void this.start(lobby));
    this.on('lReady', () => {
      const me = lobby.seats[mine];
      this.send(lobby, { type: 'ready', ready: !(me?.kind === 'player' && me.ready) });
    });
    this.on('lInvite', () => void this.copyInvite(lobby));
    this.on('lVis', () => this.send(lobby, { type: 'options', visibility: nextVisibility(lobby.visibility) }));
    this.on('lLeave', () => this.back());
    this.on('lPlate', () => void this.show({ kind: 'plate', from: lobby.id }));
    const change = (id: string, fn: (v: string) => void) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.onchange = () => fn(el.value);
    };
    for (let k = 0; k < SEATS; k++) change(`seat-${k}`, (v) => this.send(lobby, { type: 'seat', index: k, to: v as SeatChoice }));
    // Picking Kick or Make host only arms it: the button beside it, named for the player, sends it.
    // Armed, it stays so through redraws (a guest readying up redraws the lobby) until sent or put back.
    const arm = (k: number, v: string) => {
      const go = document.getElementById(`pgo-${k}`) as HTMLButtonElement | null;
      const s = lobby.seats[k];
      if (!go || s?.kind !== 'player') return;
      const text = seatToolConfirm(v, s.name);
      go.hidden = !text;
      go.textContent = text ?? '';
      // Armed, the confirm takes the status tag's place.
      go.closest('.l-seat')?.classList.toggle('armed', !!text);
      if (text) this.armed = { lobby: lobby.id, k, choice: v, id: s.id };
      else if (this.armed?.k === k) this.armed = null;
      go.onclick = () => {
        this.armed = null;
        // With who it's for, so it's refused if the seat changed hands meanwhile.
        if (v === 'kick') this.send(lobby, { type: 'kick', index: k, id: s.id });
        else if (v === 'host') this.send(lobby, { type: 'host', index: k, id: s.id });
      };
    };
    for (let k = 0; k < SEATS; k++) change(`pseat-${k}`, (v) => arm(k, v));
    if (this.armed?.lobby === lobby.id) {
      const el = document.getElementById(`pseat-${this.armed.k}`) as HTMLButtonElement | null;
      if (el && el.value !== 'seat') arm(this.armed.k, el.value);
      else this.armed = null;
    }
    this.on('lPrev', () => this.pick('left'));
    this.on('lNext', () => this.pick('right'));
    for (let k = 0; k < paints.length; k++) this.on(`lPaint-${k}`, () => this.send(lobby, { type: 'car', car: yours.car, paint: k }));
    const fillEl = document.getElementById('lFill');
    if (fillEl) fillEl.onchange = () => this.send(lobby, { type: 'options', options: { fill: toggled(fillEl) } });
    if (host) for (const id of ['oMap', 'oLaps', 'oWeather', 'oTime', 'oMayhem', 'oTraffic']) change(id, () => this.send(lobby, { type: 'options', options: this.readOptions(o) }));
  }

  /** The track, over the options: its outline, name, length and where it is in the list. */
  private trackHead(map: string): string {
    const layout = this.layout(map);
    const keys = this.lobbyKeys();
    const at = keys.indexOf(map);
    const km = layout ? `${thumb(layout).km.toFixed(1)} km` : '';
    const where = at >= 0 ? `Track ${at + 1} of ${keys.length}` : '';
    return `<div class="l-track"><span class="l-thumb">${thumbSvg(layout, 72)}</span><div><b>${esc(this.mapName(map))}</b><small>${[km, where].filter(Boolean).join(' · ')}</small></div></div>`;
  }

  /** The invite, top right: the link once it's known, and Copy invite. */
  private inviteBox(lobby: Lobby): string {
    const link = this.invite?.id === lobby.id ? this.invite.link : null;
    const text = link ? link.replace(/^https?:\/\//, '') : lobby.visibility === 'invite' ? 'Link only: copy the link to invite' : `Code ${lobby.id}`;
    return `<div class="l-invite"><span class="l-link" id="lLink">${esc(text)}</span>${button('lInvite', 'Copy invite', 'small', { class: 'solid' })}</div>`;
  }

  /** The lobby's short link (play.gamerelay.io/<game>/<link>, which previews in chat apps), for the invite box. */
  private async fetchInvite(lobby: Lobby): Promise<void> {
    const link = (await this.backend.shareLink?.(lobby.id).catch(() => null)) ?? null;
    this.invite = { id: lobby.id, link };
    const el = document.getElementById('lLink');
    if (el && link) el.textContent = link.replace(/^https?:\/\//, '');
  }

  /**
   * Copies the invite: the short link, or this page's link with its code where there isn't one.
   * Not for Link only: its code doesn't get anyone in, so a failed link says so instead.
   */
  private async copyInvite(lobby: Lobby): Promise<void> {
    const short = this.invite?.id === lobby.id && this.invite.link ? this.invite.link : ((await this.backend.shareLink?.(lobby.id).catch(() => null)) ?? null);
    const b = document.getElementById('lInvite');
    if (!short && lobby.visibility === 'invite') {
      if (b) b.querySelector('span')!.textContent = 'Try again';
      return;
    }
    const link = short ?? `${location.origin}${location.pathname}?lobby=${encodeURIComponent(lobby.id)}`;
    void navigator.clipboard?.writeText(link).then(() => {
      const el = document.getElementById('lInvite');
      if (!el) return;
      el.querySelector('span')!.textContent = 'Copied';
      el.classList.add('lit');
    });
  }

  /** How you reach the lobby's other players: the SDK finds the best way to each, so it can change. */
  private netLabel(id: string): string {
    const route = this.backend.route?.(id) ?? null;
    return route ? tag(NET_ROUTES[route][0], 'line', NET_ROUTES[route][1]) : '';
  }

  /** A player's ping to the server: or Away, while their connection's gone. */
  private pingText(id: string, player: string): string {
    if (this.backend.away?.(id, player)) return '<span class="l-away" title="Their connection dropped: the seat is held for them a little while">Away</span>';
    const ms = this.backend.ping?.(id, player) ?? null;
    return ms === null ? '' : `<i class="k-dot ${pingClass(ms)}"></i>${ms}`;
  }

  /** A layout by its key, if it's one of ours (a key comes from other players: never `constructor`). */
  private layout(key: string) {
    return Object.hasOwn(this.content.layouts, key) ? this.content.layouts[key] : undefined;
  }

  /**
   * Your car in the frame: arrows either side of it cycle the car (A, D), and under it its card:
   * name, job, rated stats and the paints (W, S).
   */
  private carPanel(yours: { car: string; paint: number }): string {
    const { classes, paints } = this.content;
    const at = classes.findIndex((k) => k.id === yours.car);
    const c = classes[at];
    const paint = paints[yours.paint % paints.length];
    const stats = carStats(classes, yours.car)
      .map((b) => stat(b.name, rating(b.t)))
      .join('');
    const swatches = paints
      .map((p, k) => `<button type="button" id="lPaint-${k}" class="k-swatch${k === yours.paint % paints.length ? ' on' : ''}" title="${esc(p.name)}" aria-label="${esc(p.name)}" style="--c:${p.color};--c2:${p.secondary ?? p.color}"></button>`)
      .join('');
    const role = carRole(c?.blurb);
    return `<div class="stage l-frame" data-in="fade"><button type="button" id="lPrev" class="l-arrow" title="Previous car (A)" aria-label="Previous car">${CHEVRON}</button><button type="button" id="lNext" class="l-arrow" title="Next car (D)" aria-label="Next car">${CHEVRON}</button><span class="l-carKeys">${hint('car', 'Car')}</span></div>
      <section class="k-panel l-car" data-in="b">
        <div class="l-carHead"><b class="l-carName">${esc(c?.name ?? yours.car)}</b><span class="k-muted k-num">${at + 1} / ${classes.length}</span>${role ? tag(role, 'line', c?.blurb ?? '') : ''}</div>
        <div class="l-stats">${stats}</div>
        <div class="l-paints"><span class="k-muted">Paint</span><span class="k-swatches">${swatches}</span><b class="l-paintName">${esc(paint.name)}</b></div>
      </section>`;
  }

  /** The host starts: the lobby's seats become the race's cars, and the page loads into it. */
  private async start(lobby: Lobby): Promise<void> {
    const started = await this.backend.send(lobby.id, { type: 'start', seed: Math.floor(Math.random() * 2 ** 31) });
    if (started) this.go(started);
  }

  /** Into the lobby's race, as you drive it (once: the start and its update both lead here). */
  private go(lobby: Lobby): void {
    if (this.going) return;
    this.going = true;
    goTo(toQuery(raceFromLobby(lobby, this.backend.youIn(lobby.id), lobby.seed ?? Math.floor(Math.random() * 1e9), lobby.id !== LOCAL_ID)));
  }
}
