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
  /** When the tick's last step was due (ms, `now`'s clock), null before it has stepped. */
  private last: number | null = null;
  /** When the tick's step 0 was due: step k is due `k` steps after it (ms). */
  private t0 = 0;
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
    const h = 1000 / this.rate;
    this.t0 = this.now();
    this.stopTick = tick(this.rate, (_dt, k) => {
      // The step's due time, not when the timer woke (up to a wake later, or a few steps run in one
      // wake): drawing from the wake made cars stand still a frame every half second or so. The
      // timer never runs a step early, so a due time after now means step 0 was due earlier; one
      // far behind means the timer dropped time it couldn't catch up (as frames drop past MAX_STEPS).
      const now = this.now();
      let due = this.t0 + k * h;
      if (due > now) {
        this.t0 -= due - now;
        due = now;
      } else if (now - due > (MAX_STEPS + 1) * h) {
        this.t0 += now - due;
        due = now;
      }
      if (!canStep()) return;
      this.step();
      this.last = due;
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
    if (this.stopTick) return this.last === null ? 0 : Math.max(0, Math.min(1, ((this.now() - this.last) * this.rate) / 1000));
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
