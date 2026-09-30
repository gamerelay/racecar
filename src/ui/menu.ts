// The front door (PLAN phases 2 to 4): the title screen with the lobby list, Create lobby, your
// plate, and the lobby itself, Civilization-style, with eight seats the host sets to a player,
// open, an AI or closed. Every race starts from a lobby; playing alone is your lobby with bots in
// the open seats. The lobby is also the car select: it docks left, and your car turns on a table
// beside it (render/showroom.ts) over its map, with the car and paint pickers and stat bars next
// to the car. The screens only see a LobbyBackend, so online lobbies plug in behind them in
// milestone 3.

import type { CarClass, MapDef, PaintDef, TrackLayout } from '../core/content';
import type { KeyValue, LobbyBackend } from '../lobby/backend';
import { LOCAL_ID } from '../lobby/backend';
import { aiPlate, cleanPlate, plateProblem, PLATE_MAX, savePlate, typedPlate } from '../lobby/plate';
import { DIFFICULTY_NAMES, FILL_DIFFICULTY, SEATS, legacySeats, seatIndex, summarize, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type SeatChoice } from '../lobby/lobby';
import { MAX_LAPS, raceFromLobby, toQuery, type RaceSetup } from './setup';
import { carStats } from './stats';
import { thumb, thumbSvg } from './thumb';

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
  /** Your car, paint and plate; none when you have no seat. */
  car?: { car: string; paint: number; plate: string };
}

type Screen = { kind: 'title' } | { kind: 'create' } | { kind: 'plate' } | { kind: 'lobby'; id: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A name as a little license plate (the results use the same chip). */
export const plateChip = (name: string) => `<span class="plate">${esc(name)}</span>`;

export class Menu {
  private root: HTMLElement;
  private screen: Screen = { kind: 'title' };
  private unsubscribe: (() => void) | null = null;
  /** Your car and paint for a new lobby (the last race's, when you come back from one). */
  private yours: { car: string; paint: number };
  private defaults: Partial<LobbyOptions>;
  /** The lobby's map and your car, for the scene behind the menu (main.ts); null off the lobby. */
  onPreview?: (p: Preview | null) => void;

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
      ...(choices.mayhem ? { mayhem: choices.mayhem } : {}),
      ...(choices.traffic !== undefined ? { traffic: choices.traffic } : {}),
    };
    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.appendChild(this.root);
  }

  /** Opens on the title, or straight into a lobby (back from its race, or a reload in it). */
  async open(lobbyId?: string | null): Promise<void> {
    // The menu is up, so your lobby's race is over, however you left it (Back to lobby, a closed
    // tab, the title's URL): it's waiting again, or Start and the seats would refuse.
    const own = await this.backend.get(LOCAL_ID);
    if (own?.phase === 'racing') await this.backend.send(own.id, { type: 'end' });
    await this.syncName();
    const lobby = lobbyId ? await this.backend.get(lobbyId) : null;
    return this.show(lobby ? { kind: 'lobby', id: lobby.id } : { kind: 'title' });
  }

  /** Back (Esc, the pad's B): lobby, create and the plate go to the title. */
  back(): void {
    if (this.screen.kind !== 'title') void this.show({ kind: 'title' });
  }

  private async show(screen: Screen): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.screen = screen;
    history.replaceState(null, '', screen.kind === 'lobby' ? `?lobby=${encodeURIComponent(screen.id)}` : location.pathname);
    // The lobby docks left for the car beside it; the other screens are cards in the middle.
    this.root.classList.toggle('dock', screen.kind === 'lobby');
    if (screen.kind !== 'lobby') this.onPreview?.(null);
    if (screen.kind === 'title') this.renderTitle(await this.backend.list());
    else if (screen.kind === 'create') this.renderCreate();
    else if (screen.kind === 'plate') this.renderPlate();
    else {
      const lobby = await this.backend.get(screen.id);
      if (!lobby) return this.show({ kind: 'title' });
      this.unsubscribe = this.backend.subscribe(screen.id, (l) => (l ? this.renderLobby(l) : void this.show({ kind: 'title' })));
      this.renderLobby(lobby);
    }
  }

  /** Swaps the card, keeping focus on the same control when it's still there (for the pad). */
  private paint(html: string, focus?: string): void {
    const was = document.activeElement?.id;
    this.root.innerHTML = html;
    const el = (was && document.getElementById(was)) || (focus && document.getElementById(focus));
    // Without scrolling to it: on a phone the lobby opens at the top, with your car.
    (el as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private on(id: string, fn: () => void): void {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  }

  private mapName(key: string): string {
    const map = this.content.maps.find((m) => key.startsWith(m.id + '/'));
    return map ? (map.layouts.length > 1 ? `${map.name} · ${key.split('/')[1]}` : map.name) : key;
  }

  // ---- the title ----

  private renderTitle(lobbies: LobbySummary[]): void {
    const rows = lobbies.map((l) => this.lobbyRow(l)).join('');
    this.paint(
      `<div class="card title">
        <div class="wordmark" aria-label="Racecar">RACECAR</div>
        <div class="titleTop"><h2>Lobbies</h2>
          <button id="mPlate" class="ghost plateBtn" title="Your plate: your name in races">${plateChip(this.plate)}<small>edit plate</small></button></div>
        <div class="lobbies">${rows}
          <div class="lrow soon"><span class="thumb"></span><span class="lname">Online lobbies arrive soon</span><span class="lmeta">Race friends and strangers here, with bots in the empty seats.</span></div>
        </div>
        <button id="mCreate" class="big">Create lobby</button>
        <div class="row"><button id="mQuick" class="ghost">Quick race</button><button id="mFree" class="ghost">Free drive</button></div>
        <p class="muted">Every race is a lobby, and bots fill the open seats. Quick race starts yours as it's set (you and seven bots, to begin with). Drift (Shift / RB) to take corners tighter; air, near misses and the oncoming lane fill boost.</p>
      </div>`,
      lobbies.length ? `lobby-${lobbies[0].id}` : 'mCreate',
    );
    for (const l of lobbies) this.on(`lobby-${l.id}`, () => void this.show({ kind: 'lobby', id: l.id }));
    this.on('mCreate', () => void this.show({ kind: 'create' }));
    this.on('mPlate', () => void this.show({ kind: 'plate' }));
    this.on('mQuick', () => void this.quickRace());
    this.on('mFree', () => void this.freeDrive());
  }

  private lobbyRow(l: LobbySummary): string {
    const pips = [...l.pips].map((c) => `<i class="pip ${c === 'p' ? 'player' : c === 'o' ? 'open' : c === 'x' ? 'closed' : 'ai'}"></i>`).join('');
    const phase = l.phase === 'racing' ? 'racing' : 'in lobby';
    return `<button class="lrow" id="lobby-${esc(l.id)}">${thumbSvg(this.content.layouts[l.map], 44)}
      <span class="lname">${esc(l.name)}${l.visibility === 'private' ? ' <small>private</small>' : ''}</span>
      <span class="lmeta">${esc(this.mapName(l.map))} · ${l.laps} lap${l.laps === 1 ? '' : 's'} · ${phase}</span>
      <span class="pips">${pips}</span><span class="lcount">${l.filled}/${SEATS}</span></button>`;
  }

  /** Your lobby, made with the defaults if there isn't one. */
  private async ownLobby(): Promise<Lobby> {
    return (await this.backend.get(LOCAL_ID)) ?? this.backend.create(this.me(), { options: this.defaults });
  }

  /** Straight into a race from your lobby, as it's set up. */
  private async quickRace(): Promise<void> {
    const lobby = await this.ownLobby();
    await this.start(lobby);
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
      mayhem: o.mayhem ?? 'normal',
      traffic: o.traffic ?? true,
      seed: Math.floor(Math.random() * 1e9),
    };
    location.search = toQuery(setup);
  }

  /** You, as a lobby player: your plate is your name. */
  private me(): { id: string; name: string; car: string; paint: number } {
    return { id: this.backend.you, name: this.plate, ...this.yours };
  }

  // ---- your plate ----

  private renderPlate(): void {
    this.paint(
      `<div class="card plateEdit">
        <h1>Your plate</h1>
        <p class="muted">Your name on your car, in lobbies and in the results: up to ${PLATE_MAX} letters, numbers and spaces.</p>
        <div class="platePreview" id="pPreview">${plateChip(this.plate)}</div>
        <input id="pText" maxlength="${PLATE_MAX + 4}" autocomplete="off" autocapitalize="characters" spellcheck="false" data-1p-ignore data-lpignore="true" value="${esc(this.plate)}">
        <p class="err" id="pErr"></p>
        <div class="row"><button id="pSave">Save</button><button id="pBack" class="ghost">Back</button></div>
      </div>`,
      'pText',
    );
    const field = document.getElementById('pText') as HTMLInputElement;
    const err = document.getElementById('pErr')!;
    const preview = document.getElementById('pPreview')!;
    // Typed straight into plate form: uppercase, only what a plate can show.
    field.oninput = () => {
      const t = typedPlate(field.value, field.selectionStart ?? field.value.length);
      field.value = t.value;
      field.setSelectionRange(t.cursor, t.cursor);
      const clean = cleanPlate(field.value);
      preview.innerHTML = plateChip(clean || ' ');
      err.textContent = clean ? (plateProblem(clean) ?? '') : '';
    };
    const save = async () => {
      const plate = cleanPlate(field.value);
      const problem = savePlate(this.store, plate);
      if (problem) return void (err.textContent = problem);
      const old = this.plate;
      this.plate = plate;
      await this.syncName(old);
      void this.show({ kind: 'title' });
    };
    field.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void save();
      }
    };
    this.on('pSave', () => void save());
    this.on('pBack', () => this.back());
    field.select();
  }

  /**
   * Your lobby goes by your plate: your seat's name, and the lobby's own name while it's still
   * the one it was given (`‹old›'s lobby`). Also mends lobbies saved before plates (a seat named
   * "You"), when the menu opens.
   */
  private async syncName(old?: string): Promise<void> {
    const own = await this.backend.get(LOCAL_ID);
    const seat = own?.seats[seatIndex(own, this.backend.you)];
    if (!own || seat?.kind !== 'player') return;
    if (seat.name !== this.plate) await this.backend.send(own.id, { type: 'name', name: this.plate });
    const was = old ?? seat.name;
    if (own.host === this.backend.you && own.name === `${was}'s lobby` && was !== this.plate) await this.backend.send(own.id, { type: 'options', name: `${this.plate}'s lobby` });
  }

  private yourCar(lobby: Lobby | null): { car: string; paint: number } {
    const s = lobby?.seats[seatIndex(lobby, this.backend.you)];
    return s && s.kind === 'player' ? { car: s.car, paint: s.paint } : this.yours;
  }

  // ---- create lobby ----

  private sel(id: string, opts: [string, string][], value: string, disabled = false): string {
    return `<select id="${id}"${disabled ? ' disabled' : ''}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }

  private optionFields(o: LobbyOptions, disabled: boolean): string {
    const maps: [string, string][] = Object.keys(this.content.layouts).map((k) => [k, this.mapName(k)]);
    return `<label>Map ${this.sel('oMap', maps, o.map, disabled)}</label>
      <label>Laps ${this.sel('oLaps', Array.from({ length: MAX_LAPS }, (_, k) => [String(k + 1), String(k + 1)] as [string, string]), String(o.laps), disabled)}</label>
      <label>Weather ${this.sel('oWeather', [['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain']], o.weather, disabled)}</label>
      <label>Mayhem ${this.sel('oMayhem', [['normal', 'Normal'], ['chaos', 'Chaos'], ['off', 'Off']], o.mayhem, disabled)}</label>
      <label>Traffic ${this.sel('oTraffic', [['1', 'On'], ['0', 'Off']], o.traffic ? '1' : '0', disabled)}</label>`;
  }

  private readOptions(): LobbyOptions {
    const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
    return {
      map: v('oMap'),
      laps: Number(v('oLaps')),
      weather: v('oWeather') as LobbyOptions['weather'],
      mayhem: v('oMayhem') as LobbyOptions['mayhem'],
      traffic: v('oTraffic') === '1',
    };
  }

  private renderCreate(): void {
    const o: LobbyOptions = { map: Object.keys(this.content.layouts)[0], laps: 3, weather: 'random', mayhem: 'normal', traffic: true, ...this.defaults };
    this.paint(
      `<div class="card setup create">
        <h1>Create lobby</h1>
        <div class="grid">
          <label class="wide">Name <input id="cName" maxlength="32" autocomplete="off" data-1p-ignore data-lpignore="true" value="${esc(this.plate)}'s lobby"></label>
          ${this.optionFields(o, false)}
          <label>Who can join ${this.sel('cVis', [['public', 'Public: listed'], ['private', 'Private: by link']], 'public')}</label>
        </div>
        <div class="row"><button id="cGo">Create</button><button id="cBack" class="ghost">Back</button></div>
        <p class="muted">You'll host it: set each seat to an AI, open or closed. Open seats get a bot when the race starts.</p>
      </div>`,
      'cGo',
    );
    this.on('cBack', () => this.back());
    this.on('cGo', async () => {
      const name = (document.getElementById('cName') as HTMLInputElement).value;
      const visibility = (document.getElementById('cVis') as HTMLSelectElement).value as Lobby['visibility'];
      const lobby = await this.backend.create(this.me(), { name, visibility, options: this.readOptions() });
      void this.show({ kind: 'lobby', id: lobby.id });
    });
  }

  // ---- the lobby ----

  private send(lobby: Lobby, action: LobbyAction): void {
    void this.backend.send(lobby.id, action);
  }

  private renderLobby(lobby: Lobby): void {
    const { classes, paints } = this.content;
    const you = this.backend.you;
    const host = lobby.host === you;
    const mine = seatIndex(lobby, you);
    const yours = this.yourCar(lobby);
    const className = (id: string) => classes.find((c) => c.id === id)?.name ?? id;
    const dot = (paint: number) => `<i class="dot" style="background:${paints[paint % paints.length].color}"></i>`;
    const seatOpts: [SeatChoice, string][] = [['open', 'Open'], ['ai-easy', 'AI · easy'], ['ai-normal', 'AI · normal'], ['ai-hard', 'AI · hard'], ['closed', 'Closed']];
    const rows = lobby.seats
      .map((s, k) => {
        let who: string, car: string, status: string;
        if (s.kind === 'player') {
          const me = s.id === you;
          who = `${plateChip(s.name)}${s.id === lobby.host ? ' <small class="tag">host</small>' : ''}`;
          // Your own car is picked beside the turntable.
          car = `${dot(s.paint)}${esc(className(s.car))}`;
          status = s.id === lobby.host ? '' : s.ready ? '<span class="ready">Ready</span>' : 'Not ready';
          return `<tr class="${me ? 'me' : ''}"><td>${k + 1}</td><td>${who}</td><td><div class="car">${car}</div></td><td>${status}</td><td class="ping">—</td></tr>`;
        }
        const choice: SeatChoice = s.kind === 'ai' ? (['ai-easy', 'ai-normal', 'ai-hard'] as const)[s.difficulty] : s.kind;
        who = host ? this.sel(`seat-${k}`, seatOpts, choice) : `<span>${seatOpts.find(([v]) => v === choice)![1]}</span>`;
        // The rival a seat brings (the same one every race: see roster in lobby.ts).
        const cls = classes[k % classes.length];
        const paint = (yours.paint + k) % paints.length;
        if (s.kind === 'ai') car = `${dot(paint)}${plateChip(aiPlate(cls.id))} ${esc(cls.name)}`;
        else if (s.kind === 'open') car = `<span class="muted">A ${DIFFICULTY_NAMES[FILL_DIFFICULTY]} bot joins at the start</span>`;
        else car = '';
        status = s.kind === 'ai' ? 'Bot' : '';
        return `<tr class="${s.kind}"><td>${k + 1}</td><td>${who}</td><td><div class="car">${car}</div></td><td>${status}</td><td class="ping"></td></tr>`;
      })
      .join('');
    const o = lobby.options;
    const layout = this.content.layouts[o.map];
    const km = layout ? `${thumb(layout).km.toFixed(1)} km` : '';
    const s = summarize(lobby);
    this.paint(
      `<div class="card lobby">
        <h1>${esc(lobby.name)}</h1>
        <p class="sub"><span>${lobby.visibility === 'public' ? 'Public' : 'Private'}</span><span>${SEATS - lobby.seats.filter((x) => x.kind === 'closed').length} cars on the grid</span><span>This browser</span></p>
        <div class="lobbyGrid">
          <table class="seats"><thead><tr><th>#</th><th>Seat</th><th>Car</th><th></th><th>Ping</th></tr></thead><tbody>${rows}</tbody></table>
          <aside class="mapCard">
            ${thumbSvg(layout, 150)}
            <b>${esc(this.mapName(o.map))}</b><small>${km}</small>
            <div class="opts">${this.optionFields(o, !host)}</div>
          </aside>
        </div>
        <div class="row">${host ? '<button id="lStart">Start race</button>' : `<button id="lReady">${mine >= 0 && lobby.seats[mine].kind === 'player' && lobby.seats[mine].ready ? 'Not ready' : 'Ready'}</button>`}
          <button id="lBack" class="ghost">Title</button><button id="lLeave" class="ghost danger">${host && s.players === 1 ? 'Close lobby' : 'Leave'}</button></div>
        <p class="muted">${host ? 'You host: set each seat from its row. ' : ''}Online lobbies arrive with milestone 3; for now it's you and the bots.</p>
      </div>
      <div class="stage" aria-hidden="true"></div>
      ${mine >= 0 ? this.carPanel(yours) : ''}`,
      host ? 'lStart' : 'lReady',
    );
    this.onPreview?.({ map: o.map, weather: o.weather, car: mine >= 0 ? { ...yours, plate: this.plate } : undefined });
    this.on('lStart', () => void this.start(lobby));
    this.on('lReady', () => {
      const me = lobby.seats[mine];
      this.send(lobby, { type: 'ready', ready: !(me?.kind === 'player' && me.ready) });
    });
    this.on('lBack', () => this.back());
    this.on('lLeave', () => this.send(lobby, { type: 'leave' }));
    const change = (id: string, fn: (v: string) => void) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (el) el.onchange = () => fn(el.value);
    };
    for (let k = 0; k < SEATS; k++) change(`seat-${k}`, (v) => this.send(lobby, { type: 'seat', index: k, to: v as SeatChoice }));
    const car = () => this.send(lobby, { type: 'car', car: (document.getElementById('lCar') as HTMLSelectElement).value, paint: Number((document.getElementById('lPaint') as HTMLSelectElement).value) });
    change('lCar', car);
    change('lPaint', car);
    if (host) for (const id of ['oMap', 'oLaps', 'oWeather', 'oMayhem', 'oTraffic']) change(id, () => this.send(lobby, { type: 'options', options: this.readOptions() }));
  }

  /** Beside the turntable: your car's name and job, the car and paint pickers, and its stat bars. */
  private carPanel(yours: { car: string; paint: number }): string {
    const { classes, paints } = this.content;
    const c = classes.find((k) => k.id === yours.car);
    const bars = carStats(classes, yours.car)
      .map((b) => `<span class="bar"><small>${b.name}</small><i style="--t:${b.t.toFixed(2)}"></i></span>`)
      .join('');
    return `<div class="card carPanel">
        <div class="carHead"><b class="carName">${esc(c?.name ?? yours.car)}</b><span class="dot" style="background:${paints[yours.paint % paints.length].color}"></span></div>
        <div class="carPick"><label>Car ${this.sel('lCar', classes.map((k) => [k.id, k.name]), yours.car)}</label>
          <label>Paint ${this.sel('lPaint', paints.map((p, i) => [String(i), p.name]), String(yours.paint))}</label></div>
        <p class="blurb" id="sBlurb">${esc(c?.blurb ?? '')}</p>
        <div class="bars">${bars}</div>
      </div>`;
  }

  /** The host starts: the lobby's seats become the race's cars, and the page loads into it. */
  private async start(lobby: Lobby): Promise<void> {
    const started = await this.backend.send(lobby.id, { type: 'start' });
    if (!started) return;
    location.search = toQuery(raceFromLobby(started, this.backend.you, Math.floor(Math.random() * 1e9)));
  }
}
