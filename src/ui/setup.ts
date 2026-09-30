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

/** What a setup may name: car ids, and how many paints there are. */
export interface Known {
  cars: string[];
  paints: number;
}

/**
 * The race the URL asks for, or null for the menu (no mode). Anything missing or out of range
 * falls back to a default, so a hand-edited or stale link still starts a race.
 */
export function readSetup(q: URLSearchParams, defaultMap: string, known?: Known): RaceSetup | null {
  const mode = q.get('mode');
  if (mode !== 'race' && mode !== 'free') return null;
  /** A whole number in [lo, hi], or `d` if it's missing or not a number. */
  const int = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && q.get(k) !== '' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  };
  const oneOf = <T extends string>(k: string, options: readonly T[], d: T): T => (options.includes(q.get(k) as T) ? (q.get(k) as T) : d);
  const car = q.get('car') ?? 'coupe';
  return {
    mode,
    map: q.get('map') ?? defaultMap,
    car: known && !known.cars.includes(car) ? 'coupe' : car,
    paint: int('paint', 0, 0, Math.max(0, (known?.paints ?? 1e9) - 1)),
    opponents: int('opponents', 7, 0, 7),
    difficulty: int('difficulty', 1, 0, 2) as 0 | 1 | 2,
    laps: int('laps', 3, 1, 9),
    weather: oneOf('weather', ['clear', 'rain', 'random'] as const, 'random'),
    mayhem: oneOf('mayhem', ['off', 'normal', 'chaos'] as const, 'normal'),
    traffic: q.get('traffic') !== '0',
    seed: int('seed', Math.floor(Math.random() * 1e9), 0, 2 ** 31 - 1),
  };
}

/** The setup screen's choices from the URL (the last race's, after "Main menu"), for defaults. */
export function readChoices(q: URLSearchParams, defaultMap: string, known?: Known): Partial<RaceSetup> {
  if (!q.has('car') && !q.has('map')) return { map: defaultMap };
  const withMode = new URLSearchParams(q);
  withMode.set('mode', 'race');
  return readSetup(withMode, defaultMap, known) ?? {};
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
    <p class="muted" id="sBlurb"></p>
    <div class="row"><button id="sRace">Race</button><button id="sFree" class="ghost">Free drive</button></div>
    <p class="muted">Drift (Shift / RB) to take corners tighter. Near misses, the oncoming lane and big air fill boost; boost into rivals for takedowns. Rain makes puddles: shiny means slippery. Online parties come next.</p>
  </div>`;
  document.body.appendChild(el);
  const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
  // The picked car's job and how it compares: bars against the best in each.
  const stats: [string, (c: CarClass) => number][] = [
    ['Top speed', (c) => c.topSpeed],
    ['Accel', (c) => c.accel],
    ['Handling', (c) => c.turn * c.grip],
    ['Weight', (c) => c.mass],
  ];
  const blurb = () => {
    const c = classes.find((k) => k.id === v('sCar'));
    const el = document.getElementById('sBlurb')!;
    if (!c) return void (el.textContent = '');
    const bars = stats
      .map(([name, f]) => {
        const vals = classes.map(f);
        const lo = Math.min(...vals) * 0.8;
        const t = (f(c) - lo) / (Math.max(...vals) - lo);
        return `<span class="bar"><small>${name}</small><i style="--t:${t.toFixed(2)}"></i></span>`;
      })
      .join('');
    el.innerHTML = `${c.blurb ?? ''}<span class="bars">${bars}</span>`;
  };
  (document.getElementById('sCar') as HTMLSelectElement).onchange = blurb;
  blurb();
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

/** The same race again: same seed, so the same weather and traffic (the pause menu's Restart). */
export function restart(s: RaceSetup): void {
  location.search = toQuery(s);
}

/** Another race with the same setup and a fresh seed (the results screen's Race again). */
export function raceAgain(s: RaceSetup): void {
  location.search = toQuery({ ...s, seed: Math.floor(Math.random() * 1e9) });
}

export function backToSetup(s: RaceSetup): void {
  const q = new URLSearchParams(toQuery(s));
  q.delete('mode');
  location.search = q.toString();
}
