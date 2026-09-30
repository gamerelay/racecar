// Weather (SPEC §7, category D): a timeline chosen from the seed at the start of the race, then a
// pure function of race time. Wetness lowers grip, turns on `when: "wet"` zones (puddles) and
// thickens the fog; the skin draws the rain.

import { Rng } from '../rng';

export type WeatherOption = 'clear' | 'rain' | 'random';

export interface WeatherPlan {
  /** Wetness 0 (dry) … 1 (pouring), ramping from `from` to `to` over [t0, t1]. */
  from: number;
  to: number;
  t0: number;
  t1: number;
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
  const canRain = allowed.includes('rain');
  if (option === 'clear' || !canRain) return { from: 0, to: 0, t0: 0, t1: 0 };
  if (option === 'rain') return { from: 1, to: 1, t0: 0, t1: 0 };
  const r = Rng.stream(seed, 'weather');
  const roll = r.next();
  if (roll < 0.4) return { from: 0, to: 0, t0: 0, t1: 0 };
  if (roll < 0.7) return { from: 1, to: 1, t0: 0, t1: 0 };
  // Rain rolls in partway through (around the second lap).
  const t0 = r.range(60, 130);
  return { from: 0, to: 1, t0, t1: t0 + 20 };
}

export function weatherAt(plan: WeatherPlan, t: number, out: WeatherState): WeatherState {
  const u = plan.t1 > plan.t0 ? Math.min(1, Math.max(0, (t - plan.t0) / (plan.t1 - plan.t0))) : t >= plan.t0 ? 1 : 0;
  const w = plan.from + (plan.to - plan.from) * u;
  out.wetness = w;
  out.grip = 1 - 0.2 * w;
  out.wet = w > 0.5;
  out.visibility = 1 - 0.4 * w;
  return out;
}
