// Race setup (single player, SPEC §12): pick the map, car, paint, field, laps, weather, mayhem and
// traffic, then go. The choice is written into the URL and the page reloads into the race, which
// keeps each race a clean start (and a shareable link). The lobby replaces this in milestone 3.

import type { CarClass, MapDef, PaintDef } from '../core/content';

export interface RaceSetup {
  mode: 'race' | 'free';
  map: string;
  car: string;
  paint: number;
  opponents: number;
  difficulty: 0 | 1 | 2;
  laps: number;
  weather: 'clear' | 'rain' | 'random';
  mayhem: 'off' | 'normal' | 'chaos';
  traffic: boolean;
  seed: number;
}

export function readSetup(q: URLSearchParams, defaultMap: string): RaceSetup | null {
  const mode = q.get('mode');
  if (mode !== 'race' && mode !== 'free') return null;
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  return {
    mode,
    map: q.get('map') ?? defaultMap,
    car: q.get('car') ?? 'coupe',
    paint: num('paint', 0),
    opponents: Math.max(0, Math.min(7, num('opponents', 7))),
    difficulty: Math.max(0, Math.min(2, num('difficulty', 1))) as 0 | 1 | 2,
    laps: Math.max(1, Math.min(9, num('laps', 3))),
    weather: (q.get('weather') as RaceSetup['weather']) ?? 'random',
    mayhem: (q.get('mayhem') as RaceSetup['mayhem']) ?? 'normal',
    traffic: q.get('traffic') !== '0',
    seed: num('seed', Math.floor(Math.random() * 1e9)),
  };
}

function toQuery(s: RaceSetup): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  return q.toString();
}

export function showSetup(maps: MapDef[], layouts: string[], classes: CarClass[], paints: PaintDef[], current: Partial<RaceSetup> = {}): void {
  const sel = (id: string, opts: [string, string][], value: string) =>
    `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const layoutOpts: [string, string][] = layouts.map((key) => {
    const map = maps.find((m) => key.startsWith(m.id + '/'));
    return [key, `${map?.name ?? key} · ${key.split('/')[1]}`];
  });
  const el = document.createElement('div');
  el.id = 'setup';
  el.innerHTML = `<div class="card setup">
    <h1>racecar</h1>
    <div class="grid">
      <label>Track ${sel('sMap', layoutOpts, current.map ?? layouts[0])}</label>
      <label>Car ${sel('sCar', classes.map((c) => [c.id, `${c.name} (${c.id})`]), current.car ?? 'coupe')}</label>
      <label>Paint ${sel('sPaint', paints.map((p, k) => [String(k), `${p.name} · ${p.finish}`]), String(current.paint ?? 0))}</label>
      <label>Rivals ${sel('sOpp', Array.from({ length: 8 }, (_, k) => [String(k), k === 0 ? 'none (time trial)' : String(k)]), String(current.opponents ?? 7))}</label>
      <label>AI ${sel('sDiff', [['0', 'easy'], ['1', 'normal'], ['2', 'hard']], String(current.difficulty ?? 1))}</label>
      <label>Laps ${sel('sLaps', ['1', '2', '3', '4', '5'].map((v) => [v, v]), String(current.laps ?? 3))}</label>
      <label>Weather ${sel('sWeather', [['random', 'random'], ['clear', 'clear'], ['rain', 'rain']], current.weather ?? 'random')}</label>
      <label>Mayhem ${sel('sMayhem', [['normal', 'normal'], ['chaos', 'chaos'], ['off', 'off']], current.mayhem ?? 'normal')}</label>
      <label>Traffic ${sel('sTraffic', [['1', 'on'], ['0', 'off']], current.traffic === false ? '0' : '1')}</label>
    </div>
    <div class="row"><button id="sRace">Race</button><button id="sFree" class="ghost">Free drive</button></div>
    <p class="muted">Drift (Shift / RB) to take corners tighter. Near misses, the oncoming lane and big air fill boost; boost into rivals for takedowns. Rain makes puddles: shiny means slippery. Online parties come next.</p>
  </div>`;
  document.body.appendChild(el);
  const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
  const go = (mode: 'race' | 'free') => {
    const s: RaceSetup = {
      mode,
      map: v('sMap'),
      car: v('sCar'),
      paint: Number(v('sPaint')),
      opponents: Number(v('sOpp')),
      difficulty: Number(v('sDiff')) as 0 | 1 | 2,
      laps: Number(v('sLaps')),
      weather: v('sWeather') as RaceSetup['weather'],
      mayhem: v('sMayhem') as RaceSetup['mayhem'],
      traffic: v('sTraffic') === '1',
      seed: Math.floor(Math.random() * 1e9),
    };
    location.search = toQuery(s);
  };
  (document.getElementById('sRace') as HTMLButtonElement).onclick = () => go('race');
  (document.getElementById('sFree') as HTMLButtonElement).onclick = () => go('free');
  (document.getElementById('sRace') as HTMLButtonElement).focus();
}

export function raceAgain(s: RaceSetup): void {
  location.search = toQuery({ ...s, seed: Math.floor(Math.random() * 1e9) });
}

export function backToSetup(s: RaceSetup): void {
  const q = new URLSearchParams(toQuery(s));
  q.delete('mode');
  location.search = q.toString();
}
