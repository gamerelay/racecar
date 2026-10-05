// Weather (SPEC §7, category D): a timeline chosen from the seed at the start of the race, then a
// pure function of race time. Wetness lowers grip, turns on `when: "wet"` zones (puddles) and
// thickens the fog; the skin draws the rain. A map whose weather lists `shower` (Paradise) gets
// tropical showers for random weather: rain that rolls in partway through and passes again. A map
// whose weather lists `snow` (Avalanche) gets snowfall wherever another map gets rain: a little less
// grip, no puddles, the fog closing in, and the skin draws flakes.

import { Rng } from '../rng';

export type WeatherOption = 'clear' | 'rain' | 'random';

export interface WeatherPlan {
  /** Wetness 0 (dry) … 1 (pouring), ramping from `from` to `to` over [t0, t1]. */
  from: number;
  to: number;
  t0: number;
  t1: number;
  /** A shower: it clears again, back to `from` over [t2, t3]. */
  t2?: number;
  t3?: number;
  /** It snows rather than rains (the map lists `snow`). */
  snow?: boolean;
}

export interface WeatherState {
  wetness: number;
  /** Multiplies every surface's grip. */
  grip: number;
  wet: boolean;
  /** Multiplies fog distance (1 clear, lower in rain). */
  visibility: number;
}

/** Picks the race's weather. `allowed` is the map's list (a desert never rains). */
export function planWeather(option: WeatherOption, seed: number, allowed: string[] = ['clear', 'rain']): WeatherPlan {
  const plan = planFall(option, seed, allowed);
  return allowed.includes('snow') ? { ...plan, snow: true } : plan;
}

/** Rain's timeline, or snow's (the same, under another sky). */
function planFall(option: WeatherOption, seed: number, allowed: string[]): WeatherPlan {
  const canRain = allowed.includes('rain') || allowed.includes('snow');
  if (option === 'clear' || !canRain) return { from: 0, to: 0, t0: 0, t1: 0 };
  if (option === 'rain') return { from: 1, to: 1, t0: 0, t1: 0 };
  const r = Rng.stream(seed, 'weather');
  const roll = r.next();
  // (`rare`: mostly blue skies, Coastal's, a shower one race in about seven.)
  if (roll < (allowed.includes('rare') ? 0.85 : 0.4)) return { from: 0, to: 0, t0: 0, t1: 0 };
  if (allowed.includes('shower')) {
    // A shower: in over 15 s somewhere in the first two laps, 35–60 s of it, out over 20 s.
    const t0 = r.range(40, 120);
    const t2 = t0 + 15 + r.range(35, 60);
    return { from: 0, to: 1, t0, t1: t0 + 15, t2, t3: t2 + 20 };
  }
  if (roll < 0.7) return { from: 1, to: 1, t0: 0, t1: 0 };
  // Rain rolls in partway through (around the second lap).
  const t0 = r.range(60, 130);
  return { from: 0, to: 1, t0, t1: t0 + 20 };
}

export function weatherAt(plan: WeatherPlan, t: number, out: WeatherState): WeatherState {
  const ramp = (a: number, b: number) => (b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : t >= a ? 1 : 0);
  let u = ramp(plan.t0, plan.t1);
  if (plan.t2 !== undefined && plan.t3 !== undefined) u -= ramp(plan.t2, plan.t3);
  const w = plan.from + (plan.to - plan.from) * u;
  out.wetness = w;
  out.grip = 1 - (plan.snow ? 0.1 : 0.2) * w;
  out.wet = !plan.snow && w > 0.5;
  out.visibility = 1 - (plan.snow ? 0.55 : 0.4) * w;
  return out;
}
