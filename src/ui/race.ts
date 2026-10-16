// Race UI: the start lights, the results table when you finish, and the minimap.

import { esc } from './html';
import type { CarClass } from '../core/content';
import { Ev, type GameEvent } from '../core/events';
import type { Sim } from '../core/sim';
import { fmt, lapTime, ordinal } from './format';
import { fitBox } from './thumb';
import { button, hints, row } from './kit';

/** One run's finish on the minimap: a bar this many pixels either side of the road. */
const FINISH_BAR = 16;
import type { ResultRow } from '../lobby/lobby';
import type { VoteView } from '../net/postrace';
import { BOARD_ROWS, type BoardView } from '../net/leaderboard';
import { standings } from './watch';

export class RaceUi {
  private readonly lights: HTMLDivElement;
  private readonly results: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private cursor = 0;
  /** The results are up (or on their way): the pause menu stays out of it. */
  shown = false;
  /** Your car (main.ts): the results are yours, whoever the camera's on. −1: the focus's. */
  you = -1;
  /** An online getaway: you're out, watching the rest (main.ts moves the camera). */
  watching = false;
  /** Watch the next runner (1) or the last (−1) (main.ts). */
  onWatch: (dir: 1 | -1) => void = () => {};
  /** Whether this run counts toward your best on this device (main.ts): online runs don't. */
  keepsBest = true;
  /** An online getaway's table is up (all out, or the vote's open). */
  private tableUp = false;
  private readonly strip: HTMLDivElement;
  /** Behind the menu (attract mode) there are no results to show. */
  resultsOn = true;
  /** Whether the results may appear now (not over the pause menu); checked again until they can. */
  canShow: () => boolean = () => true;
  private refreshAt = 0;
  /** World (x, z) to the minimap's pixels, as the lobby's thumbnail draws it (`fitBox`). */
  private project: (x: number, z: number) => [number, number] = (x, z) => [x, z];
  /** The roads, drawn once per track into an offscreen canvas; each frame only adds the cars. */
  private roads = document.createElement('canvas');
  private lightsN = NaN;
  focus = 0;
  onAgain: () => void = () => {};
  /** Whether the results offer Race again (not online: the next race is the lobby's). */
  canAgain = true;
  onSetup: () => void = () => {};
  /** The results screen's way back to the menu. */
  setupLabel = 'Change setup';
  /** Online: the lobby's results by car (each car's own screen's word), over this screen's numbers. */
  official: () => ReadonlyMap<number, ResultRow> = () => new Map();
  /** Online: the vote on the next map, once it's open. */
  vote: () => VoteView | null = () => null;
  onVote: (map: string) => void = () => {};
  /** A layout key's map name, for the vote. */
  mapName: (key: string) => string = (key) => key;
  private voteHtml = '';
  private entered: ReturnType<typeof setTimeout> | undefined;
  /** A getaway's best before this run (main.ts), and what to do with this run's time once it's over. */
  getawayBest = 0;
  /** A Time Trial (main.ts): the results lead with your best lap and the layout's online board. */
  trial = false;
  /** The online board, on a Time Trial with a connection to have one (main.ts). */
  board: () => BoardView | null = () => null;

  constructor(
    private readonly sim: Sim,
    private readonly classes: CarClass[],
    private readonly names: string[],
    private readonly colors: string[],
  ) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" id="lights"></div>
       <div id="results" class="k"></div>
       <div class="hud" id="watchStrip"></div>
       <canvas class="hud" id="minimap" width="360" height="360"></canvas>`,
    );
    this.lights = document.getElementById('lights') as HTMLDivElement;
    this.results = document.getElementById('results') as HTMLDivElement;
    this.strip = document.getElementById('watchStrip') as HTMLDivElement;
    this.map = document.getElementById('minimap') as HTMLCanvasElement;
    this.g = this.map.getContext('2d')!;
    this.buildMap();
  }

  /** Whose results these are: yours, or (attract) the focus's. */
  private get mine(): number {
    return this.you >= 0 ? this.you : this.focus;
  }

  /** Rebuild the minimap (after an edit). */
  buildMap(): void {
    const t = this.sim.track;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const sp of t.splines) for (let i = 0; i < sp.n; i++) {
      x0 = Math.min(x0, sp.px[i]);
      x1 = Math.max(x1, sp.px[i]);
      z0 = Math.min(z0, sp.pz[i]);
      z1 = Math.max(z1, sp.pz[i]);
    }
    this.project = fitBox(x0, x1, z0, z1, this.map.width, 24);
    // Secret shortcuts aren't on the map: finding them is the point.
    const paths = t.splines.filter((sp) => !sp.secret).map((sp) => {
      const p = new Path2D();
      for (let i = 0; i < sp.n; i += 4) {
        const [x, y] = this.project(sp.px[i], sp.pz[i]);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      if (sp.closed) p.closePath();
      return p;
    });
    this.roads.width = this.map.width;
    this.roads.height = this.map.height;
    const g = this.roads.getContext('2d')!;
    g.lineJoin = 'round';
    // A getaway's city (docs/CHASE_MODE.md): its streets are the gaps between its buildings, so the buildings are the map.
    if (t.layout.getaway)
      for (const h of t.layout.houses ?? []) {
        const [w, d] = h.size;
        const fx = Math.sin(h.rot);
        const fz = Math.cos(h.rot);
        g.beginPath();
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const [x, y] = this.project(h.at[0] + (a * w * fz) / 2 + (b * d * fx) / 2, h.at[1] - (a * w * fx) / 2 + (b * d * fz) / 2);
          g.lineTo(x, y);
        }
        g.closePath();
        g.fillStyle = 'rgba(18,10,32,.6)';
        g.fill();
      }
    paths.forEach((p, k) => {
      g.strokeStyle = 'rgba(18,10,32,.85)';
      g.lineWidth = 14;
      g.stroke(p);
      g.strokeStyle = k === 0 ? 'rgba(255,246,238,.9)' : 'rgba(53,240,255,.75)';
      g.lineWidth = k === 0 ? 5 : 3;
      g.stroke(p);
    });
    // One run: a bar across the road at the finish (a lap's start is its finish, and needs none).
    if (t.run) {
      // (A fixed length on the map: a 6 km run's road is a few pixels wide.)
      const i = Math.min(t.main.n - 1, Math.round(t.run.finish / t.main.step));
      const [mx, my] = this.project(t.main.px[i], t.main.pz[i]);
      const [ex, ey] = this.project(t.main.px[i] + t.main.tz[i], t.main.pz[i] - t.main.tx[i]);
      const k = FINISH_BAR / (Math.hypot(ex - mx, ey - my) || 1);
      const [a, b, c, d] = [mx + (ex - mx) * k, my + (ey - my) * k, mx - (ex - mx) * k, my - (ey - my) * k];
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(18,10,32,.85)';
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(c, d);
      g.stroke();
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 5;
      g.stroke();
    }
  }

  update(): void {
    const sim = this.sim;
    this.cursor = sim.events.read(this.cursor, this.onEvent);
    // Your car in: the results, from the car's state rather than its Finish event (which a hidden
    // tab's race can step past unseen: EventQueue.skip).
    if (sim.cars.finished[this.mine] && !this.shown && this.resultsOn) {
      this.shown = true;
      const show = () => (this.canShow() ? this.showResults() : setTimeout(show, 250));
      setTimeout(show, 2500);
    }
    // Results stay live (once a second) until the last car is in, and while there's a vote.
    // (A Time Trial's results have no race table: its board redraws itself.)
    if (this.open && !this.trial && (!sim.getaway || this.tableUp) && (sim.race.finishedCount < sim.cars.count || this.vote()) && performance.now() > this.refreshAt) {
      this.refreshAt = performance.now() + 1000;
      this.rows();
      this.renderVote();
    }
    // An online getaway, you out: the others' runs on the strip, then the table once only one's left.
    const chase = sim.getaway;
    if (chase && chase.runs.length > 1 && this.watching) {
      if (!this.tableUp && (chase.allOut || this.vote())) {
        this.watching = false;
        this.strip.classList.remove('on');
        this.showTable();
      } else if (performance.now() > this.refreshAt) {
        this.refreshAt = performance.now() + 250;
        const run = chase.runOf(this.focus);
        this.strip.innerHTML = `<button id="wBack" aria-label="Watch the last runner">◀</button><span>Watching <span class="plate">${esc(this.names[this.focus] ?? '')}</span> · Heat ${chase.heat} · ${fmt(run?.time ?? 0)}</span><button id="wNext" aria-label="Watch the next runner">▶</button>`;
        (document.getElementById('wBack') as HTMLButtonElement).onclick = () => this.onWatch(-1);
        (document.getElementById('wNext') as HTMLButtonElement).onclick = () => this.onWatch(1);
      }
    }
    // Start lights (hidden a moment after green, whether or not we saw the event).
    if (sim.race.phase !== 'countdown' && this.lights.classList.contains('on') && sim.time - sim.race.goTime > 1) this.lights.className = 'hud';
    // Online the countdown holds until the connection says when green is: READY until it's near.
    if (sim.race.phase === 'countdown') {
      const left = sim.race.goTime - sim.time;
      const n = Math.ceil(left);
      this.lights.className = 'hud on';
      if (n !== this.lightsN) this.lights.innerHTML = `<div class="lamps">${[3, 2, 1].map((k) => `<i class="${n <= k ? 'lit' : ''}"></i>`).join('')}</div><b>${n > 5 ? 'READY' : n > 0 ? n : 'GO'}</b>`;
      this.lightsN = n;
    }
    // Minimap.
    const g = this.g;
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.drawImage(this.roads, 0, 0);
    const c = sim.cars;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < c.count; i++) {
        if (!c.active[i] || (pass === 1) !== (i === this.focus)) continue;
        const [x, y] = this.project(c.x[i], c.z[i]);
        g.fillStyle = this.colors[i] ?? '#fff';
        g.strokeStyle = '#120a20';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, i === this.focus ? 10 : 7, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
  }

  private readonly onEvent = (e: GameEvent): void => {
    if (e.type === Ev.RaceStart) {
      // (update() hides the lights a second after green.)
      this.lights.innerHTML = `<div class="lamps"><i class="go"></i><i class="go"></i><i class="go"></i></div><b>GO</b>`;
    }
  };

  /** Whether the results screen is on screen. */
  get open(): boolean {
    return this.results.classList.contains('on');
  }

  /**
   * The results' screen, in the menus' kit: what it is and how it went (the title, top left), the
   * buttons beside it, the table or the times in a panel under them, and the pad's hints.
   */
  private screen(eyebrow: string, title: string, body: string, acts: string): string {
    return `<div class="r-scr">
      <header class="r-head"><div class="r-name" data-in="l"><p class="k-eyebrow">${eyebrow}</p><h1 class="r-title" id="rPlace">${title}</h1></div><div class="r-acts" data-in="r">${acts}</div></header>
      <section class="k-panel r-panel" data-in="b">${body}</section>
      <footer class="r-foot" data-in="b">${hints(['move', 'Select'], ['confirm', 'Confirm'])}</footer>
    </div>`;
  }

  /** Again (when there's one) is the screen's one big button; the way back is the lesser one beside it. */
  private acts(again: string | null): string {
    return `${again ? button('rAgain', again, 'primary') : ''}${button('rSetup', this.setupLabel, again ? 'secondary' : 'primary')}`;
  }

  /** Up, its pieces coming in as a menu screen's do. */
  private enter(): void {
    this.results.classList.add('on', 'entering');
    clearTimeout(this.entered);
    this.entered = setTimeout(() => this.results.classList.remove('entering'), 700);
  }

  showResults(): void {
    const g = this.sim.getaway;
    if (g && g.runs.length > 1 && (g.allOut || this.vote())) return this.showTable();
    if (g) return this.showGetaway();
    if (this.trial) return this.showTrial();
    this.results.innerHTML = this.screen(
      'Race results',
      ordinal(this.sim.cars.place[this.focus]),
      `<table class="r-table race"><thead><tr><th></th><th>Driver</th><th>Car</th><th>Time</th><th>${this.sim.track.run ? 'Best run' : 'Best lap'}</th><th>Takedowns</th><th>Wrecks</th><th>Score</th></tr></thead><tbody id="rRows"></tbody></table>
      <div id="rVote"></div>`,
      this.acts(this.canAgain ? 'Race again' : null),
    );
    this.voteHtml = '';
    this.rows();
    this.renderVote();
    this.enter();
    const again = document.getElementById('rAgain') as HTMLButtonElement | null;
    if (again) again.onclick = () => this.onAgain();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (again ?? (document.getElementById('rSetup') as HTMLButtonElement)).focus();
  }

  /** A Time Trial's end (SPEC §10): your best lap, then the layout's board with you on it. */
  private showTrial(): void {
    const best = this.sim.cars.bestLap[this.mine];
    this.results.innerHTML = this.screen(
      `Time trial · ${this.sim.track.run ? 'best run' : 'best lap'}`,
      best ? lapTime(best) : this.sim.track.run ? 'No run' : 'No lap',
      `<div id="rBoard"></div>`,
      this.acts('Go again'),
    );
    this.renderBoard();
    this.enter();
    const again = document.getElementById('rAgain') as HTMLButtonElement;
    again.onclick = () => this.onAgain();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    again.focus();
  }

  /** The board on the results (again whenever it changes: main.ts calls this). */
  renderBoard(): void {
    const el = document.getElementById('rBoard');
    const view = this.board();
    if (!el) return;
    if (!view || view.state === 'offline') {
      el.innerHTML = `<p class="k-muted">The online board needs a connection: this time stays on this screen.</p>`;
      return;
    }
    if (!view.page) {
      el.innerHTML = `<p class="k-muted">Loading the board…</p>`;
      return;
    }
    const { entries, me } = view.page;
    const row = (e: { rank: number; playerId: string; name: string; score: number }) =>
      `<tr class="${e.playerId === me?.playerId ? 'me' : ''}"><td>${e.rank}</td><td><span class="k-plate">${esc(e.name)}</span></td><td>${lapTime(e.score)}</td></tr>`;
    const outside = me && !entries.some((e) => e.playerId === me.playerId) ? row(me) : '';
    const note = view.rejected
      ? `<p class="k-muted r-note">That time didn't count on the board.</p>`
      : view.mine?.improved
        ? `<p class="r-note"><b class="r-fast">New best!</b> ${ordinal(view.mine.rank)} on the board.</p>`
        : '';
    el.innerHTML = `${note}<table class="r-table"><thead><tr><th>#</th><th>Driver</th><th>Lap</th></tr></thead><tbody>
      ${entries.slice(0, BOARD_ROWS).map(row).join('')}${outside}
      ${entries.length ? '' : '<tr><td colspan="3" class="k-muted">No times yet: be the first.</td></tr>'}</tbody></table>`;
  }

  /** A getaway's end (docs/CHASE_MODE.md): how it ended, how long you lasted, the heat you reached, your best. */
  private showGetaway(): void {
    const g = this.sim.getaway!;
    const c = this.sim.cars;
    const time = g.time;
    const best = this.getawayBest;
    const record = time > best;
    const value = (v: string | number) => `<b class="k-num">${v}</b>`;
    this.results.innerHTML = this.screen(
      'Getaway',
      g.end === 'busted' ? 'Busted!' : g.end === 'away' ? 'Got away!' : 'Wrecked!',
      `<p class="r-big"><span>You got away for</span> <b class="k-num">${fmt(time)}</b></p>
      <div class="r-stats">${row('Heat reached', value(g.heat))}${this.keepsBest ? row('Best', record ? `<span><b class="r-fast">New best!</b> ${value(fmt(time))}</span>` : value(best ? fmt(best) : '–')) : ''}${row('Cops taken out', value(c.takedowns[this.mine]))}</div>`,
      this.acts(this.canAgain ? 'Go again' : null),
    );
    this.enter();
    const again = document.getElementById('rAgain') as HTMLButtonElement | null;
    if (again) again.onclick = () => this.onAgain();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (again ?? (document.getElementById('rSetup') as HTMLButtonElement)).focus();
    // Online, others still going: the card for a moment, then watch them.
    if (g.runs.length > 1 && !g.allOut && !this.vote()) {
      setTimeout(() => {
        if (this.tableUp) return;
        this.results.classList.remove('on');
        this.watching = true;
        this.strip.classList.add('on');
      }, 3000);
    }
  }

  /** An online getaway's results (the owner, 2026-10-09): everyone's run, the longest first, and the vote. */
  private showTable(): void {
    this.tableUp = true;
    this.results.innerHTML = this.screen(
      'Getaway results',
      'Getaway',
      `<table class="r-table getaway"><thead><tr><th></th><th>Driver</th><th>Car</th><th>Lasted</th><th>Takedowns</th><th>Wrecks</th></tr></thead><tbody id="rRows"></tbody></table>
      <div id="rVote"></div>`,
      this.acts(null),
    );
    this.voteHtml = '';
    this.rows();
    this.renderVote();
    this.enter();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (document.getElementById('rSetup') as HTMLButtonElement).focus();
  }

  /** An online getaway's rows: still going first (their time running), then the longest run. */
  private getawayRows(): void {
    const g = this.sim.getaway!;
    const c = this.sim.cars;
    const off = this.official();
    const list = standings(g, off);
    const h1 = document.getElementById('rPlace');
    const at = list.findIndex((s) => s.car === this.mine);
    if (h1 && at >= 0 && !list[at].going) h1.textContent = ordinal(at + 1);
    document.getElementById('rRows')!.innerHTML = list
      .map(
        (s, k) =>
          `<tr class="${s.car === this.mine ? 'me' : ''}"><td>${s.going ? '–' : k + 1}</td><td><i class="r-dot" style="background:${this.colors[s.car]}"></i><span class="k-plate">${esc(this.names[s.car])}</span></td><td>${this.classes[c.cls[s.car]].name}</td><td>${s.going ? `<span class="k-muted">${fmt(s.time)} · going</span>` : fmt(s.time)}</td><td>${off.get(s.car)?.takedowns ?? c.takedowns[s.car]}</td><td>${off.get(s.car)?.wrecks ?? c.wrecks[s.car]}</td></tr>`,
      )
      .join('');
  }

  /**
   * The table body, live until everyone's in: finishers by place with their time, the rest by
   * position with how far back they are, and the race's fastest lap marked.
   */
  private rows(): void {
    if (this.sim.getaway) return this.getawayRows();
    const c = this.sim.cars;
    // A lap: the race's route round (core/track/graph.ts).
    const L = this.sim.track.graph.route.length;
    const off = this.official();
    // Each car's own screen's word where the lobby has it (online), this screen's otherwise.
    const done = (i: number): number | null => {
      const r = off.get(i);
      return r ? r.time : c.finished[i] ? c.finishTime[i] : null;
    };
    const best = (i: number): number => off.get(i)?.best ?? c.bestLap[i];
    const rows = Array.from({ length: c.count }, (_, i) => i)
      .filter((i) => c.active[i] || off.has(i))
      .sort((a, b) => (done(a) ?? Infinity) - (done(b) ?? Infinity) || (c.place[a] || 99) - (c.place[b] || 99) || c.progress[b] - c.progress[a]);
    const place = new Map(rows.filter((i) => done(i) !== null).map((i, k) => [i, k + 1]));
    let fastest = -1;
    for (const i of rows) if (best(i) && (fastest < 0 || best(i) < best(fastest))) fastest = i;
    const lead = Math.max(...rows.map((i) => c.progress[i]));
    const h1 = document.getElementById('rPlace');
    const mine = place.get(this.focus);
    if (h1 && mine) h1.textContent = ordinal(mine);
    const time = (i: number) => {
      const t = done(i);
      if (t !== null) return fmt(t);
      const back = lead - c.progress[i];
      return `<span class="k-muted">${back > L ? `+${Math.floor(back / L)} lap${back >= 2 * L ? 's' : ''}` : `+${Math.round(back)} m`}</span>`;
    };
    document.getElementById('rRows')!.innerHTML = rows
      .map(
        (i) =>
          `<tr class="${i === this.focus ? 'me' : ''}"><td>${place.get(i) ?? '–'}</td><td><i class="r-dot" style="background:${this.colors[i]}"></i><span class="k-plate">${esc(this.names[i])}</span></td><td>${this.classes[c.cls[i]].name}</td><td>${time(i)}</td><td>${best(i) ? fmt(best(i)) : '–'}${i === fastest ? ` <b class="r-fast" title="Fastest ${this.sim.track.run ? 'run' : 'lap'}">★</b>` : ''}</td><td>${off.get(i)?.takedowns ?? c.takedowns[i]}</td><td>${off.get(i)?.wrecks ?? c.wrecks[i]}</td><td>${Math.floor(off.get(i)?.score ?? c.score[i]).toLocaleString()}</td></tr>`,
      )
      .join('');
  }

  /** The vote on the next map (online), under the table: a button a map, with its votes and the time left. */
  private renderVote(): void {
    const el = document.getElementById('rVote');
    if (!el) return;
    const v = this.vote();
    let html = '';
    if (v?.over) html = '<p class="k-muted r-note">The host went back to the lobby.</p>';
    else if (v) {
      const buttons = v.choices
        .map((c) => `<button type="button" class="k-btn r-vote vote${c.mine ? ' on' : ''}" data-map="${esc(c.map)}" aria-pressed="${c.mine}"><span>${esc(this.mapName(c.map))}</span>${c.votes ? `<b class="k-num">${c.votes}</b>` : ''}</button>`)
        .join('');
      const when = v.left > 0 ? (v.allIn ? `Next race in ${v.left} s` : `Waiting for the others · ${v.left} s`) : 'Next race…';
      html = `<div class="r-voteHead"><h2 class="k-h2 ice">Next map</h2><span class="k-muted">${when}</span></div><div class="r-votes">${buttons}</div>`;
    }
    // With a vote to make, leaving is the lesser button (online, it's the only one).
    const setup = document.getElementById('rSetup');
    if (setup && !this.canAgain) {
      const lesser = !!v && !v.over;
      setup.classList.toggle('primary', !lesser);
      setup.classList.toggle('secondary', lesser);
    }
    if (html === this.voteHtml) return;
    // Rebuilding the buttons would drop the focus a pad or keys put on one: keep it on the same map.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.map;
    this.voteHtml = html;
    el.innerHTML = html;
    for (const b of el.querySelectorAll<HTMLButtonElement>('button.vote')) {
      b.onclick = () => this.onVote(b.dataset.map!);
      if (b.dataset.map === focused) b.focus();
    }
  }
}
