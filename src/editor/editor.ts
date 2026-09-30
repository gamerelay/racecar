// Editor v0 (SPEC §6): a top-down view of the layout over the paused game. Drag control points,
// set width / lanes / height / bank / shoulder / surface per point, insert and delete points, see
// walls, gaps, checkpoints and ramps, get validation problems live, undo, save to the layout's
// JSON file, and press P to drive from the cursor.
//
// Mouse: left-drag a point to move it, left-drag empty space to pan, wheel to zoom, double-click
// the road to insert a point. Keys: P drive from cursor, Delete remove point, Ctrl/Cmd+Z undo,
// Ctrl/Cmd+S save, ` or Esc back to the game.

import type { CarClass, SurfaceDef, TrackLayout, TrackPoint } from '../core/content';
import { reanchor } from '../core/track/anchor';
import { bakeTrack, type BakedSpline, type Track } from '../core/track/bake';
import { newHit, projectGlobal } from '../core/track/query';
import { validateLayout, type Problem } from '../core/track/validate';
import type { Input } from '../input/input';

export interface EditorHost {
  layout(): TrackLayout;
  layoutPath(): string;
  apply(layout: TrackLayout): void;
  drive(spline: number, s: number, lateral: number): void;
  car(): { x: number; z: number; h: number };
  close(): void;
  surfaces: SurfaceDef[];
  classes: CarClass[];
  input: Input;
}

interface Sel {
  spline: number; // 0 = main, k = branches[k - 1]
  point: number;
}

const css = `
#editor{position:fixed;inset:0;z-index:15;display:none;background:#0d0620}
#editor.on{display:block}
#editor canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
#edPanel{position:absolute;top:12px;right:12px;width:280px;max-height:calc(100% - 24px);overflow:auto;background:rgba(18,8,38,.92);border:2px solid #fff6ee;box-shadow:4px 4px 0 #120a20;padding:10px 12px;font:13px var(--ui);color:#fff6ee}
#edPanel h2{font:400 18px var(--display);margin:0 0 6px;color:#ffd23f}
#edPanel label{display:grid;grid-template-columns:80px 1fr;gap:6px;align-items:center;margin:3px 0}
#edPanel input,#edPanel select{font:13px ui-monospace,monospace;width:100%;background:#1c1432;color:#fff6ee;border:1px solid #6d5f86;padding:2px 4px}
#edPanel button{font:700 12px var(--ui);background:#ffd23f;color:#120a20;border:2px solid #120a20;padding:4px 8px;margin:6px 6px 0 0;cursor:pointer}
#edPanel .muted{color:#d8c6f2}
#edPanel .prob{cursor:pointer;margin:3px 0;padding:3px 5px;border-left:3px solid #ff2e88;background:rgba(255,46,136,.08)}
#edPanel .prob.warning{border-color:#ffd23f;background:rgba(255,210,63,.08)}
#edHelp{position:absolute;left:12px;bottom:12px;font:12px var(--ui);color:#d8c6f2;background:rgba(18,8,38,.8);padding:6px 10px;border:1px solid #6d5f86;line-height:1.5}
`;

export class Editor {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private layout: TrackLayout;
  private track: Track;
  private problems: Problem[] = [];
  private undo: string[] = [];
  private sel: Sel | null = null;
  private camX = 0;
  private camZ = 0;
  private zoom = 0.6;
  private mouseX = 0;
  private mouseY = 0;
  private drag: { kind: 'pan' | 'point'; x: number; y: number; moved: boolean } | null = null;
  private dirty = false;
  private saved = true;
  private applyTimer = 0;
  private readonly hit = newHit();

  constructor(private readonly host: EditorHost) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'editor';
    this.canvas = document.createElement('canvas');
    this.panel = document.createElement('div');
    this.panel.id = 'edPanel';
    const help = document.createElement('div');
    help.id = 'edHelp';
    help.innerHTML = '<b>F</b> fit · drag point: move · drag empty: pan · wheel: zoom · double-click road: add point · <b>P</b> drive from cursor · <b>Del</b> remove · <b>⌘Z</b> undo · <b>⌘S</b> save · <b>`</b> back';
    this.root.append(this.canvas, this.panel, help);
    document.body.appendChild(this.root);
    this.g = this.canvas.getContext('2d')!;
    this.layout = structuredClone(host.layout());
    this.track = bakeTrack(this.layout, host.surfaces);
    this.revalidate();
    const car = host.car();
    this.camX = car.x;
    this.camZ = car.z;
    this.bind();
  }

  setOpen(on: boolean): void {
    this.root.classList.toggle('on', on);
    this.host.input.suspended = on;
    if (on) {
      // Pick up changes made outside (a hot reload).
      const current = this.host.layout();
      if (JSON.stringify(current) !== JSON.stringify(this.layout)) {
        this.layout = structuredClone(current);
        this.rebake(false);
      }
      this.resize();
      if (!this.fitted) this.fit();
      this.renderPanel();
      this.draw();
    } else if (this.dirty) {
      this.flushApply();
    }
  }

  private fitted = false;

  /** Zooms to show the whole track. */
  private fit(): void {
    const m = this.track.main;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < m.n; i++) {
      x0 = Math.min(x0, m.px[i]);
      x1 = Math.max(x1, m.px[i]);
      z0 = Math.min(z0, m.pz[i]);
      z1 = Math.max(z1, m.pz[i]);
    }
    this.camX = (x0 + x1) / 2;
    this.camZ = (z0 + z1) / 2;
    // Leave room for the panel on the right.
    this.zoom = Math.min((this.canvas.width - 340 * devicePixelRatio) / (x1 - x0 + 80), this.canvas.height / (z1 - z0 + 80));
    this.fitted = true;
  }

  private get open(): boolean {
    return this.root.classList.contains('on');
  }

  // ---- coordinates ----
  private sx(x: number): number {
    return (x - this.camX) * this.zoom + this.canvas.width / 2;
  }
  private sy(z: number): number {
    return (this.camZ - z) * this.zoom + this.canvas.height / 2;
  }
  private wx(px: number): number {
    return (px - this.canvas.width / 2) / this.zoom + this.camX;
  }
  private wz(py: number): number {
    return this.camZ - (py - this.canvas.height / 2) / this.zoom;
  }

  private points(spline: number): TrackPoint[] {
    return spline === 0 ? this.layout.main.points : this.layout.branches![spline - 1].points;
  }

  // ---- edits ----
  private change(mutate: () => void, live = true): void {
    this.undo.push(JSON.stringify(this.layout));
    if (this.undo.length > 200) this.undo.shift();
    mutate();
    this.rebake();
    this.saved = false;
    if (live) this.scheduleApply();
    this.renderPanel();
    this.draw();
  }

  /** Rebakes after an edit. `follow`: move distance-anchored things (branch ends, ramps…) with the geometry. */
  private rebake(follow = true): void {
    try {
      if (follow) this.layout = reanchor(this.track, this.layout, this.host.surfaces);
      this.track = bakeTrack(this.layout, this.host.surfaces);
    } catch (err) {
      this.problems = [{ level: 'error', message: `bake failed: ${(err as Error).message}` }];
      return;
    }
    this.revalidate();
  }

  private revalidate(): void {
    this.problems = validateLayout(this.layout, this.host.surfaces, this.host.classes);
  }

  private scheduleApply(): void {
    this.dirty = true;
    clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.flushApply(), 400);
  }

  private flushApply(): void {
    clearTimeout(this.applyTimer);
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.problems.some((p) => p.message.startsWith('bake failed'))) this.host.apply(structuredClone(this.layout));
  }

  private async save(): Promise<void> {
    this.flushApply();
    const res = await fetch('/__editor/save', { method: 'POST', body: JSON.stringify({ path: this.host.layoutPath(), layout: this.layout }) }).catch(() => null);
    this.saved = !!res && res.ok;
    this.renderPanel();
  }

  // ---- input ----
  private bind(): void {
    const c = this.canvas;
    window.addEventListener('resize', () => this.open && (this.resize(), this.draw()));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const px = e.offsetX * devicePixelRatio;
      const py = e.offsetY * devicePixelRatio;
      const found = e.button === 0 ? this.pick(px, py) : null;
      if (found) {
        this.sel = found;
        this.undo.push(JSON.stringify(this.layout));
        this.drag = { kind: 'point', x: px, y: py, moved: false };
        this.renderPanel();
      } else {
        this.drag = { kind: 'pan', x: px, y: py, moved: false };
      }
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const px = e.offsetX * devicePixelRatio;
      const py = e.offsetY * devicePixelRatio;
      this.mouseX = px;
      this.mouseY = py;
      if (this.drag?.kind === 'pan') {
        this.camX -= (px - this.drag.x) / this.zoom;
        this.camZ += (py - this.drag.y) / this.zoom;
        this.drag.x = px;
        this.drag.y = py;
      } else if (this.drag?.kind === 'point' && this.sel) {
        const p = this.points(this.sel.spline)[this.sel.point];
        p.p[0] = round(this.wx(px));
        p.p[2] = round(this.wz(py));
        this.drag.moved = true;
        this.rebake();
        this.renderPanel();
      }
      this.draw();
    });
    c.addEventListener('pointerup', () => {
      if (this.drag?.kind === 'point') {
        if (this.drag.moved) {
          this.saved = false;
          this.scheduleApply();
        } else this.undo.pop();
      }
      this.drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const px = e.offsetX * devicePixelRatio;
      const py = e.offsetY * devicePixelRatio;
      const wx = this.wx(px);
      const wz = this.wz(py);
      this.zoom = Math.min(8, Math.max(0.05, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.camX = wx - (px - c.width / 2) / this.zoom;
      this.camZ = wz + (py - c.height / 2) / this.zoom;
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', (e) => this.insertAt(e.offsetX * devicePixelRatio, e.offsetY * devicePixelRatio));
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault();
        void this.save();
      } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !typing) {
        e.preventDefault();
        const prev = this.undo.pop();
        if (prev) {
          this.layout = JSON.parse(prev);
          this.rebake(false);
          this.saved = false;
          this.scheduleApply();
          this.renderPanel();
          this.draw();
        }
      } else if (typing) {
        return;
      } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel) {
        const pts = this.points(this.sel.spline);
        if (pts.length > (this.sel.spline === 0 ? 4 : 1)) {
          const k = this.sel.point;
          this.change(() => pts.splice(k, 1));
          this.sel = null;
        }
      } else if (e.code === 'KeyF') {
        this.fit();
        this.draw();
      } else if (e.code === 'KeyP') {
        this.driveFromCursor();
      } else if (e.code === 'Escape' || e.code === 'Backquote') {
        e.preventDefault();
        this.host.close();
      }
    });
  }

  /** Nearest control point within 12 px. */
  private pick(px: number, py: number): Sel | null {
    let best: Sel | null = null;
    let bestD = 12 * devicePixelRatio;
    const all = [this.layout.main.points, ...(this.layout.branches ?? []).map((b) => b.points)];
    all.forEach((pts, spline) => {
      pts.forEach((p, point) => {
        const d = Math.hypot(this.sx(p.p[0]) - px, this.sy(p.p[2]) - py);
        if (d < bestD) {
          bestD = d;
          best = { spline, point };
        }
      });
    });
    return best;
  }

  /** Double-click on a road: insert a control point there, between its neighbours. */
  private insertAt(px: number, py: number): void {
    const x = this.wx(px);
    const z = this.wz(py);
    let bestSpline = -1;
    let bestD = Infinity;
    for (const sp of this.track.splines) {
      projectGlobal(sp, x, z, this.hit);
      const d = Math.abs(this.hit.lateral);
      if (d < bestD && d < this.hit.width / 2 + this.hit.shoulder) {
        bestD = d;
        bestSpline = sp.index;
      }
    }
    if (bestSpline < 0) return;
    projectGlobal(this.track.splines[bestSpline], x, z, this.hit);
    const pts = this.points(bestSpline);
    // Insert after the control point nearest behind this spot along the curve.
    const sOf = (p: TrackPoint) => {
      const h = newHit();
      projectGlobal(this.track.splines[bestSpline], p.p[0], p.p[2], h);
      return h.s;
    };
    const ss = pts.map(sOf);
    let after = 0;
    for (let k = 0; k < ss.length; k++) if (ss[k] <= this.hit.s) after = k;
    const at = this.hit;
    const prev = pts[after];
    this.change(() => {
      pts.splice(after + 1, 0, { ...structuredClone(prev), p: [round(at.cx), round(at.cy), round(at.cz)] });
    });
    this.sel = { spline: bestSpline, point: after + 1 };
    this.renderPanel();
  }

  private driveFromCursor(): void {
    const x = this.wx(this.mouseX);
    const z = this.wz(this.mouseY);
    let best = 0;
    let bestD = Infinity;
    for (const sp of this.track.splines) {
      projectGlobal(sp, x, z, this.hit);
      if (Math.abs(this.hit.lateral) < bestD) {
        bestD = Math.abs(this.hit.lateral);
        best = sp.index;
      }
    }
    projectGlobal(this.track.splines[best], x, z, this.hit);
    const lat = Math.max(-this.hit.width / 2 + 1.5, Math.min(this.hit.width / 2 - 1.5, this.hit.lateral));
    this.flushApply();
    this.host.drive(best, this.hit.s, lat);
  }

  // ---- panel ----
  private renderPanel(): void {
    const L = this.track.main.length;
    const errors = this.problems.filter((p) => p.level === 'error').length;
    let html = `<h2>${this.layout.name}</h2>
      <div class="muted">${(L / 1000).toFixed(2)} km · ${this.layout.main.points.length} points · ${(this.layout.branches ?? []).length} branches<br>
      ${this.saved ? 'saved' : '<b style="color:#ffd23f">unsaved</b>'} · ${this.host.layoutPath()}</div>
      <button id="edSave">Save (⌘S)</button><button id="edDrive">Drive from car</button>`;
    if (this.sel) {
      const p = this.points(this.sel.spline)[this.sel.point];
      const name = this.sel.spline === 0 ? 'main' : this.layout.branches![this.sel.spline - 1].id;
      const surf = this.host.surfaces.map((s) => `<option${(p.surface ?? 'asphalt') === s.id ? ' selected' : ''}>${s.id}</option>`).join('');
      html += `<h2 style="margin-top:12px">Point ${name} #${this.sel.point}</h2>
        <label>x<input data-f="x" type="number" step="1" value="${p.p[0]}"></label>
        <label>height (y)<input data-f="y" type="number" step="0.5" value="${p.p[1]}"></label>
        <label>z<input data-f="z" type="number" step="1" value="${p.p[2]}"></label>
        <label>width<input data-f="width" type="number" step="0.5" min="4" value="${p.width}"></label>
        <label>lanes<input data-f="lanes" type="number" step="1" min="1" max="6" value="${p.lanes ?? 2}"></label>
        <label>bank °<input data-f="bank" type="number" step="1" value="${round(((p.bank ?? 0) * 180) / Math.PI)}"></label>
        <label>shoulder<input data-f="shoulder" type="number" step="0.5" min="0" value="${p.shoulder ?? 4}"></label>
        <label>surface<select data-f="surface">${surf}</select></label>`;
    } else {
      html += `<p class="muted">Click a point to edit it. Double-click the road to add one.</p>`;
    }
    html += `<h2 style="margin-top:12px">Problems (${errors} errors)</h2>`;
    html += this.problems.length ? this.problems.map((p, k) => `<div class="prob ${p.level}" data-k="${k}">${p.message}</div>`).join('') : '<p class="muted">None.</p>';
    this.panel.innerHTML = html;
    (this.panel.querySelector('#edSave') as HTMLButtonElement).onclick = () => void this.save();
    (this.panel.querySelector('#edDrive') as HTMLButtonElement).onclick = () => {
      const car = this.host.car();
      projectGlobal(this.track.main, car.x, car.z, this.hit);
      this.flushApply();
      this.host.drive(0, this.hit.s, 0);
    };
    this.panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((el) => {
      el.onchange = () => this.setField(el.dataset.f!, el.value);
    });
    this.panel.querySelectorAll<HTMLDivElement>('.prob').forEach((el) => {
      el.onclick = () => {
        const p = this.problems[Number(el.dataset.k)];
        const sp = this.track.splines.find((x) => x.id === p.spline) ?? (p.spline === 'main' ? this.track.main : undefined);
        if (sp && p.s !== undefined) {
          const i = Math.max(0, Math.min(sp.n - 1, Math.round(p.s / sp.step)));
          this.camX = sp.px[i];
          this.camZ = sp.pz[i];
          this.zoom = Math.max(this.zoom, 2);
          this.draw();
        }
      };
    });
  }

  private setField(f: string, v: string): void {
    if (!this.sel) return;
    const p = this.points(this.sel.spline)[this.sel.point];
    this.change(() => {
      const n = Number(v);
      if (f === 'x') p.p[0] = n;
      else if (f === 'y') p.p[1] = n;
      else if (f === 'z') p.p[2] = n;
      else if (f === 'width') p.width = Math.max(4, n);
      else if (f === 'lanes') p.lanes = Math.round(n);
      else if (f === 'bank') p.bank = (n * Math.PI) / 180;
      else if (f === 'shoulder') p.shoulder = Math.max(0, n);
      else if (f === 'surface') p.surface = v === 'asphalt' ? undefined : v;
    });
  }

  // ---- drawing ----
  private resize(): void {
    this.canvas.width = Math.floor(innerWidth * devicePixelRatio);
    this.canvas.height = Math.floor(innerHeight * devicePixelRatio);
  }

  private draw(): void {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#0d0620';
    g.fillRect(0, 0, W, H);
    // A 50 m grid.
    g.strokeStyle = 'rgba(216,198,242,.06)';
    g.lineWidth = 1;
    const step = 50;
    const x0 = Math.floor(this.wx(0) / step) * step;
    const z0 = Math.floor(this.wz(H) / step) * step;
    for (let x = x0; x < this.wx(W); x += step) {
      g.beginPath();
      g.moveTo(this.sx(x), 0);
      g.lineTo(this.sx(x), H);
      g.stroke();
    }
    for (let z = z0; z < this.wz(0); z += step) {
      g.beginPath();
      g.moveTo(0, this.sy(z));
      g.lineTo(W, this.sy(z));
      g.stroke();
    }
    for (const sp of this.track.splines) this.drawSpline(sp);
    this.drawMarkers();
    // Control points.
    const all = [this.layout.main.points, ...(this.layout.branches ?? []).map((b) => b.points)];
    all.forEach((pts, spline) => {
      pts.forEach((p, k) => {
        const selected = this.sel?.spline === spline && this.sel.point === k;
        g.fillStyle = selected ? '#ffd23f' : spline === 0 ? '#fff6ee' : '#35f0ff';
        g.beginPath();
        g.arc(this.sx(p.p[0]), this.sy(p.p[2]), (selected ? 7 : 4.5) * devicePixelRatio, 0, Math.PI * 2);
        g.fill();
      });
    });
    // The car.
    const car = this.host.car();
    const cx = this.sx(car.x);
    const cy = this.sy(car.z);
    g.save();
    g.translate(cx, cy);
    g.rotate(car.h);
    g.fillStyle = '#ff2e88';
    const s = Math.max(4, 2.2 * this.zoom);
    g.fillRect(-s / 2, -s, s, s * 2);
    g.restore();
    // Problems.
    for (const p of this.problems) {
      const sp = this.track.splines.find((x) => x.id === p.spline);
      if (!sp || p.s === undefined) continue;
      const i = Math.max(0, Math.min(sp.n - 1, Math.round(p.s / sp.step)));
      g.strokeStyle = p.level === 'error' ? '#ff2e88' : '#ffd23f';
      g.lineWidth = 3 * devicePixelRatio;
      g.beginPath();
      g.arc(this.sx(sp.px[i]), this.sy(sp.pz[i]), 16 * devicePixelRatio, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawSpline(sp: BakedSpline): void {
    const g = this.g;
    const edge = (side: number, extra: (i: number) => number) => {
      g.beginPath();
      for (let i = 0; i <= sp.n; i++) {
        const k = sp.closed ? i % sp.n : Math.min(i, sp.n - 1);
        const l = side * extra(k);
        const x = sp.px[k] - sp.tz[k] * l;
        const z = sp.pz[k] + sp.tx[k] * l;
        if (i === 0) g.moveTo(this.sx(x), this.sy(z));
        else g.lineTo(this.sx(x), this.sy(z));
      }
    };
    // Road fill: a thick stroke along the center is cheap and good enough at editor scale.
    g.lineJoin = 'round';
    g.lineCap = 'butt';
    g.strokeStyle = '#4a4458';
    const avgW = sp.width.reduce((a, b) => a + b, 0) / sp.n;
    g.lineWidth = Math.max(1, avgW * this.zoom);
    edge(1, () => 0);
    g.stroke();
    // Edges: walls white, gaps yellow.
    for (const side of [-1, 1]) {
      g.lineWidth = Math.max(1, 1.5 * devicePixelRatio);
      let run = -1;
      let wall = -1;
      const flush = (to: number) => {
        if (run < 0) return;
        g.strokeStyle = wall ? 'rgba(255,246,238,.8)' : '#ffd23f';
        g.beginPath();
        for (let i = run; i <= to; i++) {
          const k = sp.closed ? i % sp.n : Math.min(i, sp.n - 1);
          const l = side * (sp.width[k] / 2 + sp.shoulder[k]);
          const x = sp.px[k] - sp.tz[k] * l;
          const z = sp.pz[k] + sp.tx[k] * l;
          if (i === run) g.moveTo(this.sx(x), this.sy(z));
          else g.lineTo(this.sx(x), this.sy(z));
        }
        g.stroke();
      };
      for (let i = 0; i < sp.n; i++) {
        const w = side < 0 ? sp.wallL[i] : sp.wallR[i];
        if (w !== wall) {
          flush(i);
          run = i;
          wall = w;
        }
      }
      flush(sp.closed ? sp.n : sp.n - 1);
    }
    // Road edges.
    g.strokeStyle = 'rgba(244,239,230,.35)';
    g.lineWidth = 1;
    edge(-1, (k) => sp.width[k] / 2);
    g.stroke();
    edge(1, (k) => sp.width[k] / 2);
    g.stroke();
    // Ramps (orange) along the spline.
    g.strokeStyle = '#ff6a00';
    g.lineWidth = Math.max(2, 4 * devicePixelRatio);
    for (let i = 0; i < sp.n; i++) {
      if (sp.ramp[i] > 0.05) {
        g.beginPath();
        g.arc(this.sx(sp.px[i]), this.sy(sp.pz[i]), 2 * devicePixelRatio, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private drawMarkers(): void {
    const g = this.g;
    const main = this.track.main;
    const tick = (s: number, color: string, label?: string) => {
      const i = Math.round(s / main.step) % main.n;
      const w = main.width[i] / 2 + main.shoulder[i];
      g.strokeStyle = color;
      g.lineWidth = 2 * devicePixelRatio;
      g.beginPath();
      g.moveTo(this.sx(main.px[i] + main.tz[i] * w), this.sy(main.pz[i] - main.tx[i] * w));
      g.lineTo(this.sx(main.px[i] - main.tz[i] * w), this.sy(main.pz[i] + main.tx[i] * w));
      g.stroke();
      if (label) {
        g.fillStyle = color;
        g.font = `${11 * devicePixelRatio}px ui-monospace, monospace`;
        g.fillText(label, this.sx(main.px[i]) + 8, this.sy(main.pz[i]) - 8);
      }
    };
    tick(0, '#fff6ee', 'start');
    this.track.checkpoints.forEach((cp, k) => tick(cp, '#35f0ff', `cp${k + 1}`));
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
