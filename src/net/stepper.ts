// Who steps the sim. Until the race page is in its room (and always offline), the frame loop:
// each frame's time in fixed steps. Once in, the relay's `tick`: a timer in a worker that keeps
// going in a hidden tab, so a host whose tab is hidden still drives the AIs for everyone, and
// everyone's car still goes out (requestAnimationFrame stops in a hidden tab). Drawing stays on
// requestAnimationFrame either way: `frame` says how far it is into the next step.

/** The SDK's `relay.tick`: `fn` at `rate` a second, on a timer that keeps going in hidden tabs; returns its stop. */
export type Tick = (rate: number, fn: (dt: number, tick: number) => void) => () => void;

/** A frame steps at most this many times (a long stall is dropped, not caught up). */
export const MAX_STEPS = 5;

export class Stepper {
  /** Frame time not yet stepped (s). */
  private acc = 0;
  /** When the tick last stepped (ms, `now`'s clock), null before it has. */
  private last: number | null = null;
  private stopTick: (() => void) | null = null;

  constructor(
    private readonly rate: number,
    private readonly step: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The relay's tick steps it. */
  get ticking(): boolean {
    return this.stopTick !== null;
  }

  /** From now on `tick` steps it, when `canStep` says (the frame loop only draws). */
  useTick(tick: Tick, canStep: () => boolean): void {
    if (this.stopTick) return;
    this.acc = 0;
    this.stopTick = tick(this.rate, () => {
      if (!canStep()) return;
      this.step();
      this.last = this.now();
    });
  }

  /** Back to the frame loop. */
  stop(): void {
    this.stopTick?.();
    this.stopTick = null;
    this.last = null;
  }

  /**
   * A frame `dt` s after the last: on the frame loop, the steps it's owed (when `canStep`). Returns
   * how far into the next step it is (0 to 1), for drawing between the last two.
   */
  frame(dt: number, canStep: boolean): number {
    if (this.stopTick) return this.last === null ? 0 : Math.min(1, ((this.now() - this.last) * this.rate) / 1000);
    if (canStep) {
      this.acc += dt;
      const h = 1 / this.rate;
      let steps = 0;
      while (this.acc >= h && steps < MAX_STEPS) {
        this.step();
        this.acc -= h;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
    }
    return this.acc * this.rate;
  }
}
