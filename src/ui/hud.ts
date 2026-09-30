// The race HUD (DOM, SPEC §1): position, lap and times, boost meter, speed, the drift readout
// (points, chain, mini-turbo stage), pops for moments, and a debug panel (F2).

import { Ev, type GameEvent } from '../core/events';
import { KMH } from '../core/math';
import { positions } from '../core/rules/progress';
import type { Sim } from '../core/sim';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private cursor = 0;
  private readonly order: number[] = [];
  private driftStart = 0;
  focus = 0;
  laps = 3;
  debugText = '';

  constructor(private readonly sim: Sim) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" id="race">
        <div class="stat"><small>Pos</small><b id="pos">1/1</b></div>
        <div class="stat"><small>Lap</small><b id="lap">1/3</b></div>
        <div class="stat"><small>Time</small><b id="time">0:00.0</b></div>
        <div class="stat"><small>Best</small><b id="best">–</b></div>
        <div class="stat"><small>Score</small><b id="score">0</b></div>
      </div>
      <div class="hud" id="pops" aria-live="polite"></div>
      <div class="hud" id="drift"><div id="driftPts">0</div><div id="driftStage"><i></i><i></i><i></i></div><div id="driftChain"></div></div>
      <div class="hud" id="meterWrap"><label>Boost</label><div id="meter"><div id="meterFill"></div></div></div>
      <div class="hud" id="speedo"><span id="spd">0</span><small>km/h</small></div>
      <div class="hud" id="hint"><kbd>WASD</kbd>/<kbd>←↑→↓</kbd> drive · <kbd>Shift</kbd> drift · <kbd>Space</kbd> boost · <kbd>R</kbd> reset · <kbd>C</kbd> look back · <kbd>\`</kbd> editor · <kbd>F2</kbd> debug · <kbd>F8</kbd> felt wrong?</div>
      <div class="hud" id="debug"></div>`,
    );
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

  update(): void {
    this.cursor = this.sim.events.read(this.cursor, this.onEvent);
    const c = this.sim.cars;
    const i = this.focus;
    positions(this.sim, this.order);
    $('pos').textContent = `${this.order.indexOf(i) + 1}/${this.order.length}`;
    const laps = this.sim.race.laps;
    $('lap').textContent = `${Math.min(laps, c.lap[i] + 1)}/${laps}`;
    const racing = this.sim.race.phase !== 'free';
    $('time').textContent = c.finished[i] ? fmt(c.finishTime[i]) : racing ? fmt(Math.max(0, this.sim.time - this.sim.race.goTime)) : fmt((this.sim.tick - c.lapStartTick[i]) * this.sim.dt);
    $('best').textContent = c.bestLap[i] ? fmt(c.bestLap[i]) : '–';
    $('score').textContent = Math.floor(c.score[i]).toLocaleString();
    $('spd').textContent = String(Math.round(Math.hypot(c.vx[i], c.vz[i]) * KMH));
    ($('meterFill') as HTMLElement).style.transform = `scaleX(${c.boost[i].toFixed(3)})`;
    document.body.classList.toggle('boosting', c.boosting[i] === 1 || c.miniT[i] > 0);
    document.body.classList.toggle('full', c.boost[i] > 0.98);
    const drifting = c.drift[i] === 1;
    $('drift').classList.toggle('on', drifting || c.driftChain[i] > 0);
    if (drifting) {
      $('driftPts').textContent = Math.floor(c.score[i] - this.driftStart).toLocaleString();
      const stage = c.driftStage[i];
      const bars = $('driftStage').children;
      for (let k = 0; k < 3; k++) bars[k].className = stage > k ? `s${stage}` : '';
    }
    $('driftChain').textContent = c.driftChain[i] > 0 ? `chain ×${c.driftChain[i] + 1}` : '';
    if ($('debug').classList.contains('on')) $('debug').textContent = this.debugText;
  }

  private readonly onEvent = (e: GameEvent): void => {
    const i = this.focus;
    if (e.type === Ev.DriftStart && e.car === i) this.driftStart = this.sim.cars.score[i];
    if (e.type === Ev.MiniTurbo && e.car === i) this.pop(['', 'Mini-turbo', 'Super turbo', 'Ultra turbo'][e.b] + '!', `s${e.b}`);
    if (e.type === Ev.Wreck && e.car === i && e.other < 0) this.pop(e.b === 4 ? 'Reset' : 'Wrecked', 'bad');
    if (e.type === Ev.Takedown && e.car === i) this.pop(e.b ? 'Revenge!' : 'Takedown!', 'big');
    if (e.type === Ev.NearMiss && e.car === i) this.pop(e.b ? 'Oncoming near miss' : 'Near miss', e.b ? 'hot' : '');
    if (e.type === Ev.Oncoming && e.car === i) this.pop('Oncoming', 'hot');
    if (e.type === Ev.TrafficCheck && e.car === i) this.pop('Traffic check', 'hot');
    if (e.type === Ev.StartBoost && e.car === i) this.pop(e.b ? 'Perfect start!' : 'Stalled', e.b ? 's2' : 'bad');
    if (e.type === Ev.Finish && e.car === i) this.pop(`Finished ${e.b}${['th', 'st', 'nd', 'rd'][e.b] ?? 'th'}`, 'big');
    if (e.type === Ev.Wreck && e.car === i && e.other >= 0 && e.other !== i) this.pop('Taken down', 'bad');
    if (e.type === Ev.SpinOut && e.car === i) this.pop('Spin out', 'bad');
    if (e.type === Ev.Land && e.car === i && e.a > 0.9) this.pop(`Big air ${e.a.toFixed(1)}s`, 'hot');
    if (e.type === Ev.Lap && e.car === i) this.pop(`Lap ${fmt(e.a)}`, e.a === this.sim.cars.bestLap[i] ? 'hot' : '');
  };
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
