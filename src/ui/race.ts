// Race UI: the start lights, the results table when you finish, and the minimap.

import type { CarClass } from '../core/content';
import { Ev, type GameEvent } from '../core/events';
import type { Sim } from '../core/sim';
import { fmt, ordinal } from './format';

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
  onSetup: () => void = () => {};
  /** The results screen's way back to the menu. */
  setupLabel = 'Change setup';

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
    const paths = t.splines.map((sp) => {
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
    // Results stay live (once a second) until the last car is in.
    if (this.open && sim.race.finishedCount < sim.cars.count && performance.now() > this.refreshAt) {
      this.refreshAt = performance.now() + 1000;
      this.rows();
    }
    // Start lights (hidden a moment after green, whether or not we saw the event).
    if (sim.race.phase !== 'countdown' && this.lights.classList.contains('on') && sim.time - sim.race.goTime > 1) this.lights.className = 'hud';
    if (sim.race.phase === 'countdown') {
      const left = sim.race.goTime - sim.time;
      const n = Math.ceil(left);
      this.lights.className = 'hud on';
      if (n !== this.lightsN) this.lights.innerHTML = `<div class="lamps">${[3, 2, 1].map((k) => `<i class="${n <= k ? 'lit' : ''}"></i>`).join('')}</div><b>${n > 0 ? n : 'GO'}</b>`;
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
    if (e.type === Ev.Finish && e.car === this.focus && !this.shown && this.resultsOn) {
      this.shown = true;
      const show = () => (this.canShow() ? this.showResults() : setTimeout(show, 250));
      setTimeout(show, 2500);
    }
  };

  /** Whether the results screen is on screen. */
  get open(): boolean {
    return this.results.classList.contains('on');
  }

  showResults(): void {
    this.results.innerHTML = `<div class="card results"><h1>${ordinal(this.sim.cars.place[this.focus])}</h1>
      <table><thead><tr><th></th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th><th>Takedowns</th><th>Wrecks</th><th>Score</th></tr></thead><tbody id="rRows"></tbody></table>
      <div class="row"><button id="rAgain">Race again</button><button id="rSetup" class="ghost">${this.setupLabel}</button></div></div>`;
    this.rows();
    this.results.classList.add('on');
    (document.getElementById('rAgain') as HTMLButtonElement).onclick = () => this.onAgain();
    (document.getElementById('rSetup') as HTMLButtonElement).onclick = () => this.onSetup();
    (document.getElementById('rAgain') as HTMLButtonElement).focus();
  }

  /**
   * The table body, live until everyone's in: finishers by place with their time, the rest by
   * position with how far back they are, and the race's fastest lap marked.
   */
  private rows(): void {
    const c = this.sim.cars;
    const L = this.sim.track.main.length;
    const rows = Array.from({ length: c.count }, (_, i) => i)
      .filter((i) => c.active[i])
      .sort((a, b) => (c.place[a] || 99) - (c.place[b] || 99) || c.progress[b] - c.progress[a]);
    let fastest = -1;
    for (const i of rows) if (c.bestLap[i] && (fastest < 0 || c.bestLap[i] < c.bestLap[fastest])) fastest = i;
    const lead = Math.max(...rows.map((i) => c.progress[i]));
    const time = (i: number) => {
      if (c.finished[i]) return fmt(c.finishTime[i]);
      const back = lead - c.progress[i];
      return `<span class="muted">${back > L ? `+${Math.floor(back / L)} lap${back >= 2 * L ? 's' : ''}` : `+${Math.round(back)} m`}</span>`;
    };
    document.getElementById('rRows')!.innerHTML = rows
      .map(
        (i) =>
          `<tr class="${i === this.focus ? 'me' : ''}"><td>${c.place[i] || '–'}</td><td><i class="dot" style="background:${this.colors[i]}"></i>${this.names[i]}</td><td>${this.classes[c.cls[i]].name}</td><td>${time(i)}</td><td>${c.bestLap[i] ? fmt(c.bestLap[i]) : '–'}${i === fastest ? ' <b class="fast" title="Fastest lap">★</b>' : ''}</td><td>${c.takedowns[i]}</td><td>${c.wrecks[i]}</td><td>${Math.floor(c.score[i]).toLocaleString()}</td></tr>`,
      )
      .join('');
  }
}

