// Race UI: the start lights, the results table when you finish, and the minimap.

import { esc } from './html';
import type { CarClass } from '../core/content';
import { Ev, type GameEvent } from '../core/events';
import type { Sim } from '../core/sim';
import { fmt, ordinal } from './format';
import type { ResultRow } from '../lobby/lobby';
import type { VoteView } from '../net/postrace';

export class RaceUi {
  private readonly lights: HTMLDivElement;
  private readonly results: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private cursor = 0;
  /** The results are up (or on their way): the pause menu stays out of it. */
  shown = false;
  /** Behind the menu (attract mode) there are no results to show. */
  resultsOn = true;
  /** Whether the results may appear now (not over the pause menu); checked again until they can. */
  canShow: () => boolean = () => true;
  private refreshAt = 0;
  private bounds = { x0: 0, x1: 1, z0: 0, z1: 1 };
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

  constructor(
    private readonly sim: Sim,
    private readonly classes: CarClass[],
    private readonly names: string[],
    private readonly colors: string[],
  ) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" id="lights"></div>
       <div id="results"></div>
       <canvas class="hud" id="minimap" width="360" height="360"></canvas>`,
    );
    this.lights = document.getElementById('lights') as HTMLDivElement;
    this.results = document.getElementById('results') as HTMLDivElement;
    this.map = document.getElementById('minimap') as HTMLCanvasElement;
    this.g = this.map.getContext('2d')!;
    this.buildMap();
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
    this.bounds = { x0, x1, z0, z1 };
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
    paths.forEach((p, k) => {
      g.strokeStyle = 'rgba(18,10,32,.85)';
      g.lineWidth = 14;
      g.stroke(p);
      g.strokeStyle = k === 0 ? 'rgba(255,246,238,.9)' : 'rgba(53,240,255,.75)';
      g.lineWidth = k === 0 ? 5 : 3;
      g.stroke(p);
    });
  }

  private project(x: number, z: number): [number, number] {
    const { x0, x1, z0, z1 } = this.bounds;
    const size = Math.max(x1 - x0, z1 - z0) || 1;
    const pad = 24;
    const k = (this.map.width - pad * 2) / size;
    return [pad + (x - x0) * k + ((size - (x1 - x0)) * k) / 2, this.map.height - pad - (z - z0) * k - ((size - (z1 - z0)) * k) / 2];
  }

  update(): void {
    const sim = this.sim;
    this.cursor = sim.events.read(this.cursor, this.onEvent);
    // Your car in: the results, from the car's state rather than its Finish event (which a hidden
    // tab's race can step past unseen: EventQueue.skip).
    if (sim.cars.finished[this.focus] && !this.shown && this.resultsOn) {
      this.shown = true;
      const show = () => (this.canShow() ? this.showResults() : setTimeout(show, 250));
      setTimeout(show, 2500);
    }
    // Results stay live (once a second) until the last car is in, and while there's a vote.
    if (this.open && (sim.race.finishedCount < sim.cars.count || this.vote()) && performance.now() > this.refreshAt) {
      this.refreshAt = performance.now() + 1000;
      this.rows();
      this.renderVote();
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

  showResults(): void {
    this.results.innerHTML = `<div class="card results"><h1 id="rPlace">${ordinal(this.sim.cars.place[this.focus])}</h1>
      <table><thead><tr><th></th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th><th>Takedowns</th><th>Wrecks</th><th>Score</th></tr></thead><tbody id="rRows"></tbody></table>
      <div id="rVote"></div>
      <div class="row">${this.canAgain ? '<button id="rAgain">Race again</button>' : ''}<button id="rSetup" class="${this.canAgain ? 'ghost' : ''}">${this.setupLabel}</button></div></div>`;
    this.voteHtml = '';
    this.rows();
    this.renderVote();
    this.results.classList.add('on');
    const again = document.getElementById('rAgain') as HTMLButtonElement | null;
    if (again) again.onclick = () => this.onAgain();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (again ?? (document.getElementById('rSetup') as HTMLButtonElement)).focus();
  }

  /**
   * The table body, live until everyone's in: finishers by place with their time, the rest by
   * position with how far back they are, and the race's fastest lap marked.
   */
  private rows(): void {
    const c = this.sim.cars;
    const L = this.sim.track.main.length;
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
      return `<span class="muted">${back > L ? `+${Math.floor(back / L)} lap${back >= 2 * L ? 's' : ''}` : `+${Math.round(back)} m`}</span>`;
    };
    document.getElementById('rRows')!.innerHTML = rows
      .map(
        (i) =>
          `<tr class="${i === this.focus ? 'me' : ''}"><td>${place.get(i) ?? '–'}</td><td><i class="dot" style="background:${this.colors[i]}"></i><span class="plate">${esc(this.names[i])}</span></td><td>${this.classes[c.cls[i]].name}</td><td>${time(i)}</td><td>${best(i) ? fmt(best(i)) : '–'}${i === fastest ? ' <b class="fast" title="Fastest lap">★</b>' : ''}</td><td>${off.get(i)?.takedowns ?? c.takedowns[i]}</td><td>${off.get(i)?.wrecks ?? c.wrecks[i]}</td><td>${Math.floor(off.get(i)?.score ?? c.score[i]).toLocaleString()}</td></tr>`,
      )
      .join('');
  }

  /** The vote on the next map (online), under the table: a button a map, with its votes and the time left. */
  private renderVote(): void {
    const el = document.getElementById('rVote');
    if (!el) return;
    const v = this.vote();
    let html = '';
    if (v?.over) html = '<p class="muted">The host went back to the lobby.</p>';
    else if (v) {
      const buttons = v.choices
        .map((c) => `<button class="vote${c.mine ? ' on' : ''}" data-map="${esc(c.map)}" aria-pressed="${c.mine}">${esc(this.mapName(c.map))}${c.votes ? ` <b>${c.votes}</b>` : ''}</button>`)
        .join('');
      const when = v.left > 0 ? (v.allIn ? `Next race in ${v.left} s` : `Waiting for the others · ${v.left} s`) : 'Next race…';
      html = `<p class="voteHead"><b>Next map</b> <span class="muted">${when}</span></p><div class="row voteRow">${buttons}</div>`;
    }
    // With a vote to make, leaving is the lesser button.
    document.getElementById('rSetup')?.classList.toggle('ghost', !!v && !v.over);
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
