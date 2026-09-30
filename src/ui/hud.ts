// The race HUD (DOM, SPEC §1): position, lap and times, boost meter, speed, the drift readout
// (points, chain, and the mini-turbo stage when that's on), pops for moments, and a debug panel (F2).

import { TUNING } from '../core/car/tuning';
import { Ev, type GameEvent } from '../core/events';
import { MPH } from '../core/math';
import { positions } from '../core/rules/progress';
import type { Sim } from '../core/sim';
import { delta, fmt, ordinal } from './format';

// Elements are looked up once, and text and transforms are written only when they change: the HUD
// updates every frame, and most of it is the same as last frame.
const els = new Map<string, HTMLElement | SVGElement>();
const $ = (id: string): HTMLElement | SVGElement => {
  let e = els.get(id);
  if (!e || !e.isConnected) els.set(id, (e = document.getElementById(id)!));
  return e;
};
const last = new Map<string, string>();
function text(id: string, v: string): void {
  if (last.get(id) === v) return;
  last.set(id, v);
  $(id).textContent = v;
}
function style(id: string, prop: 'transform' | 'strokeDasharray', v: string): void {
  const key = `${id}.${prop}`;
  if (last.get(key) === v) return;
  last.set(key, v);
  $(id).style[prop] = v;
}
const transform = (id: string, v: string) => style(id, 'transform', v);

// The speedometer: a 270° arc from bottom left, clockwise, round to bottom right.
const R = 64;
const SWEEP = 270;
const ARC = (SWEEP / 360) * 100;

export class Hud {
  private cursor = 0;
  /** The gauge's full scale in mph, and the class it was drawn for. */
  private gaugeMax = 300;
  private gaugeCls = -1;
  private readonly order: number[] = [];
  focus = 0;
  laps = 3;
  debugText = '';
  /** The focus car's best lap before the one just finished (for the lap pop's delta). */
  private bestBefore = 0;
  private device: 'keyboard' | 'gamepad' | 'touch' | '' = '';

  constructor(private readonly sim: Sim) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" id="race">
        <div class="stat" id="statPos"><small>Pos</small><b id="pos">1/1</b></div>
        <div class="stat"><small>Time</small><b id="time">0:00.0</b></div>
        <div class="stat"><small>Best</small><b id="best">–</b></div>
        <div class="stat"><small>Score</small><b id="score">0</b></div>
      </div>
      <div class="hud" id="pops" aria-live="polite"></div>
      <div class="hud" id="drift"><div id="driftPts">0</div><div id="driftStage"><i></i><i></i><i></i></div><div id="driftChain"></div><div id="chainBar"><i id="chainFill"></i></div></div>
      <div class="hud" id="meterWrap"><label>Boost</label><div id="meter"><div id="meterBank"></div><div id="meterFill"></div></div></div>
      <div class="hud" id="speedo"><svg viewBox="0 0 160 160" aria-hidden="true"><g id="gTicks"></g><circle class="track" cx="80" cy="80" r="${R}" pathLength="100"/><circle id="gBoost" cx="80" cy="80" r="${R}" pathLength="100"/><circle id="gFill" cx="80" cy="80" r="${R}" pathLength="100"/></svg><span id="spd">0</span><small>mph</small></div>
      <div class="hud stat" id="lapBadge"><small>Lap</small><b id="lap">1/3</b></div>
      <div class="hud" id="debug"></div>`,
    );
  }

  /** Ticks every 10 mph (longer every 50) up to the class's boosted top speed; past its top speed is the boost zone. */
  private drawGauge(cls: number): void {
    this.gaugeCls = cls;
    const top = this.sim.classes[cls].topSpeed * MPH;
    this.gaugeMax = Math.ceil((top * TUNING.boostTop) / 10) * 10;
    let ticks = '';
    for (let v = 0; v <= this.gaugeMax; v += 10) {
      const a = ((135 + (v / this.gaugeMax) * SWEEP) * Math.PI) / 180;
      const major = v % 50 === 0;
      const r0 = R + 6;
      const r1 = R + (major ? 14 : 10);
      const f = (r: number) => `${(80 + Math.cos(a) * r).toFixed(1)} ${(80 + Math.sin(a) * r).toFixed(1)}`;
      ticks += `<path d="M${f(r0)}L${f(r1)}" class="${major ? 'major' : ''} ${v > top ? 'hot' : ''}"/>`;
    }
    $('gTicks').innerHTML = ticks;
    const from = ARC * (top / this.gaugeMax);
    style('gBoost', 'strokeDasharray', `0 ${from.toFixed(2)} ${(ARC - from).toFixed(2)} 100`);
  }

  /** A lap done: its time against the best before it, and the final lap called out. */
  private lap(time: number, lapsDone: number): void {
    const best = this.bestBefore;
    if (!best) this.pop(`Lap ${fmt(time)}`);
    else if (time < best) this.pop(`Best lap! ${fmt(time)} ${delta(time, best)}`, 'hot');
    else this.pop(`Lap ${fmt(time)} ${delta(time, best)}`, 'slow');
    this.bestBefore = best ? Math.min(best, time) : time;
    const laps = this.sim.race.laps;
    if (this.sim.race.phase === 'racing' && laps > 1 && lapsDone === laps - 1) this.pop('Final lap!', 'big');
  }

  pop(text: string, cls = ''): void {
    const d = document.createElement('div');
    d.className = `pop ${cls}`;
    d.textContent = text;
    $('pops').appendChild(d);
    setTimeout(() => d.remove(), 1350);
  }

  toggleDebug(): boolean {
    return $('debug').classList.toggle('on');
  }

  /** The controls for the device in use (pad glyphs once a pad is used), for the pause menu; dev keys in dev builds. */
  keys = '';

  setDevice(device: 'keyboard' | 'gamepad' | 'touch'): void {
    if (device === this.device) return;
    this.device = device;
    const k = (s: string) => `<kbd>${s}</kbd>`;
    const dev = import.meta.env.DEV ? ` · ${k('`')} editor · ${k('F2')} debug · ${k('F6')} ink` : '';
    this.keys =
      device === 'gamepad'
        ? `${k('RT')}/${k('LT')} drive · ${k('RB')} drift · ${k('A')} boost · ${k('Y')} reset · ${k('B')} look back · ${k('Start')} pause`
        : `${k('WASD')}/${k('←↑→↓')} drive · ${k('Shift')} drift · ${k('Space')} boost · ${k('R')} reset · ${k('C')} look back · ${k('Esc')} pause · ${k('M')} sound · ${k('N')} music${dev} · ${k('F8')} felt wrong?`;
    const el = document.getElementById('keys');
    if (el) el.innerHTML = this.keys;
  }

  update(): void {
    this.cursor = this.sim.events.read(this.cursor, this.onEvent);
    const c = this.sim.cars;
    const i = this.focus;
    const racing = this.sim.race.phase !== 'free';
    document.body.classList.toggle('free', !racing);
    document.body.classList.toggle('countdown', this.sim.race.phase === 'countdown');
    positions(this.sim, this.order);
    text('pos', `${this.order.indexOf(i) + 1}/${this.order.length}`);
    const laps = this.sim.race.laps;
    // Free drive has no race length: just the lap you're on.
    text('lap', racing ? `${Math.min(laps, c.lap[i] + 1)}/${laps}` : String(c.lap[i] + 1));
    $('lapBadge').classList.toggle('final', racing && laps > 1 && c.lap[i] + 1 >= laps && !c.finished[i]);
    text('time', c.finished[i] ? fmt(c.finishTime[i]) : racing ? fmt(Math.max(0, this.sim.time - this.sim.race.goTime)) : fmt(this.sim.time - c.lapStartTime[i]));
    text('best', c.bestLap[i] ? fmt(c.bestLap[i]) : '–');
    text('score', Math.floor(c.score[i]).toLocaleString());
    const mph = Math.hypot(c.vx[i], c.vz[i]) * MPH;
    text('spd', String(Math.round(mph)));
    if (c.cls[i] !== this.gaugeCls) this.drawGauge(c.cls[i]);
    style('gFill', 'strokeDasharray', `${(ARC * Math.min(1, mph / this.gaugeMax)).toFixed(1)} 100`);
    transform('meterFill', `scaleX(${c.boost[i].toFixed(3)})`);
    // What the current drift will pay in, as a pale segment past the fill.
    const bank = c.drift[i] === 1 && c.driftBank[i] >= TUNING.driftBankMin ? c.driftBank[i] : 0;
    transform('meterBank', `scaleX(${Math.min(1, c.boost[i] + bank).toFixed(3)})`);
    document.body.classList.toggle('boosting', c.boosting[i] === 1 || c.miniT[i] > 0);
    document.body.classList.toggle('full', c.boost[i] > 0.98);
    const drifting = c.drift[i] === 1;
    // The chain's points so far (a lone drift's own), the drifts in it, and the time left to link the next.
    const drifts = c.driftChain[i] + (drifting ? 1 : 0);
    $('drift').classList.toggle('on', drifting || c.chainT[i] > 0);
    if (drifting || c.chainT[i] > 0) text('driftPts', Math.floor(c.chainPts[i]).toLocaleString());
    if (drifting) {
      const stage = c.driftStage[i];
      ($('driftStage') as HTMLElement).style.display = TUNING.miniTurbo ? '' : 'none';
      const bars = $('driftStage').children;
      for (let k = 0; k < 3; k++) bars[k].className = stage > k ? `s${stage}` : '';
    }
    text('driftChain', drifts >= 2 ? `chain ×${drifts}` : '');
    transform('chainFill', `scaleX(${drifting ? 1 : Math.max(0, c.chainT[i] / TUNING.chainWindow).toFixed(3)})`);
    if ($('debug').classList.contains('on')) text('debug', this.debugText);
  }

  private lastOncoming = -Infinity;

  private readonly onEvent = (e: GameEvent): void => {
    const i = this.focus;
    if (e.type === Ev.Respawn && e.car === i && e.a >= 0.01) this.pop(`Catch-up boost +${Math.round(e.a * 100)}%`, 'hot');
    if (e.type === Ev.DriftChain && e.car === i) this.pop(`Drift chain ×${e.b} · ${Math.floor(e.a).toLocaleString()}`, e.b >= 4 ? 's3' : 's2');
    if (e.type === Ev.ChainLost && e.car === i) this.pop(`Chain lost ×${e.b}`, 'bad');
    if (e.type === Ev.DriftBoost && e.car === i) this.pop(`Drift boost +${Math.round(e.a * 100)}%`, e.a > 0.25 ? 's2' : 's1');
    if (e.type === Ev.MiniTurbo && e.car === i) this.pop(['', 'Mini-turbo', 'Super turbo', 'Ultra turbo'][e.b] + '!', `s${e.b}`);
    if (e.type === Ev.Wreck && e.car === i && e.other < 0) this.pop(e.b === 4 ? 'Reset' : 'Wrecked', 'bad');
    if (e.type === Ev.Takedown && e.car === i) this.pop(e.b ? 'Revenge!' : 'Takedown!', 'big');
    if (e.type === Ev.NearMiss && e.car === i) this.pop(e.b ? 'Oncoming near miss' : 'Near miss', e.b ? 'hot' : '');
    // Weaving in and out of the oncoming lane restarts the streak; one pop per few seconds is enough.
    if (e.type === Ev.Oncoming && e.car === i && this.sim.time - this.lastOncoming > 3) {
      this.lastOncoming = this.sim.time;
      this.pop('Oncoming', 'hot');
    }
    if (e.type === Ev.TrafficCheck && e.car === i) this.pop('Traffic check', 'hot');
    if (e.type === Ev.StartBoost && e.car === i) this.pop(e.b ? 'Perfect start!' : 'Stalled', e.b ? 's2' : 'bad');
    if (e.type === Ev.Finish && e.car === i) this.pop(`Finished ${ordinal(e.b)}`, 'big');
    if (e.type === Ev.Wreck && e.car === i && e.other >= 0 && e.other !== i) this.pop('Taken down', 'bad');
    if (e.type === Ev.SpinOut && e.car === i) this.pop('Spin out', 'bad');
    if (e.type === Ev.Land && e.car === i && e.a > 0.9) this.pop(`Big air ${e.a.toFixed(1)}s`, 'hot');
    if (e.type === Ev.Lap && e.car === i) this.lap(e.a, e.b);
  };
}

