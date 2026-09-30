// Game audio (SPEC §13): the focus car's engine, tyres, gravel, wind and boost as continuous voices;
// the three nearest rivals' engines, panned and Doppler-shifted; one-shots from sim events (hits,
// wrecks, landings, boost, chimes, near-miss horns, hazard alerts, the countdown); and the music.
// All synthesized (synth.ts), all presentation: it reads the sim and never writes to it.
//
// Browsers only start audio after a gesture, so the context is made on the first key or click.
// Paused or hidden, it suspends. M mutes, N toggles music; both are remembered on this device.

import { Vector3, type PerspectiveCamera } from 'three';
import { clamp, damp } from '../core/math';
import { Cause, Ev, type GameEvent } from '../core/events';
import type { Sim } from '../core/sim';
import { doppler, engineHz, engineSound, gearbox, spatial, type Gear, type Spatial } from './model';
import { Music, type Intensity } from './music';
import { EngineVoice, glide, NoiseVoice, noiseShot, note, Out, toneShot, type Shot } from './synth';

const RIVALS = 3;
/** Rivals are heard within this of the camera. */
const HEAR = 90;
const SETTINGS_KEY = 'racecar.audio';

export interface AudioSettings {
  muted: boolean;
  music: boolean;
}

function loadSettings(): AudioSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AudioSettings>;
    return { muted: s.muted === true, music: s.music !== false };
  } catch {
    return { muted: false, music: true };
  }
}

export interface AudioFrame {
  /** The car the camera follows (its engine is up close). */
  focus: number;
  camera: PerspectiveCamera;
  paused: boolean;
  /** Behind a menu (attract mode): music only. */
  menu: boolean;
}

/** Everything made once the context exists. */
interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  engines: GainNode;
  musicLevel: GainNode;
  musicTone: BiquadFilterNode;
  engine: EngineVoice;
  tyres: NoiseVoice;
  gravel: NoiseVoice;
  wind: NoiseVoice;
  roar: NoiseVoice;
  horn: Out;
  rivals: EngineVoice[];
  music: Music;
}

export class GameAudio {
  readonly settings = loadSettings();
  private g?: Graph;
  private cursor: number;
  private readonly gear: Gear = { gear: 0, rpm: 0 };
  private readonly where: Spatial = { pan: 0, gain: 1 };
  private readonly fwd = new Vector3();
  private rpm = 0;
  private beeped = 0;
  private hidden = false;
  private readonly near: number[] = [];
  private readonly shot: Shot = { ctx: undefined as unknown as AudioContext, bus: undefined as unknown as AudioNode, gain: 0, pan: 0 };

  constructor(private readonly sim: Sim) {
    this.cursor = sim.events.head;
    const unlock = () => {
      this.start();
      if (this.g) {
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('pointerdown', unlock);
      }
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      // A hidden tab runs no frames, so update() can't do this: suspend here, and update()
      // resumes when frames come back.
      if (this.hidden) void this.g?.ctx.suspend();
    });
  }

  /** Makes the graph (first gesture) and resumes the context. */
  private start(): void {
    if (this.g) {
      void this.g.ctx.resume();
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const master = ctx.createGain();
    master.gain.value = this.settings.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const bus = (level: number) => {
      const b = ctx.createGain();
      b.gain.value = level;
      b.connect(master);
      return b;
    };
    const sfx = bus(0.9);
    const engines = bus(0.55);
    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 12000;
    const musicLevel = ctx.createGain();
    musicLevel.gain.value = 0;
    musicLevel.connect(musicTone).connect(master);
    const horn = new Out(ctx, sfx);
    for (const hz of [370, 466]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      o.connect(f).connect(horn.gain);
      o.start();
    }
    this.g = {
      ctx,
      master,
      sfx,
      engines,
      musicLevel,
      musicTone,
      engine: new EngineVoice(ctx, engines),
      tyres: new NoiseVoice(ctx, sfx, 'bandpass', 1500, 5),
      gravel: new NoiseVoice(ctx, sfx, 'lowpass', 650, 0.7),
      wind: new NoiseVoice(ctx, sfx, 'lowpass', 500, 0.5),
      roar: new NoiseVoice(ctx, sfx, 'bandpass', 220, 1.2),
      horn,
      rivals: Array.from({ length: RIVALS }, () => new EngineVoice(ctx, engines)),
      music: new Music(ctx, musicLevel),
    };
    this.shot.ctx = ctx;
    this.shot.bus = sfx;
  }

  /** M: everything on or off. Returns whether it's now muted. */
  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.save();
    if (this.g) glide(this.g.master.gain, this.settings.muted ? 0 : 0.8, this.g.ctx.currentTime, 0.05);
    return this.settings.muted;
  }

  /** N: music on or off. Returns whether it's now on. */
  toggleMusic(): boolean {
    this.settings.music = !this.settings.music;
    this.save();
    return this.settings.music;
  }

  private save(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Private mode or blocked storage: the setting lasts this session.
    }
  }

  update(dt: number, f: AudioFrame): void {
    const g = this.g;
    if (!g) {
      this.cursor = this.sim.events.head;
      return;
    }
    // Muted, or paused, or away: nothing to hear, so nothing runs.
    const quiet = f.paused || this.hidden || this.settings.muted;
    if (quiet !== (g.ctx.state === 'suspended')) void (quiet ? g.ctx.suspend() : g.ctx.resume());
    if (quiet) return;
    const now = g.ctx.currentTime;
    const sim = this.sim;
    const c = sim.cars;
    const i = f.focus;
    const cam = f.camera.position;
    f.camera.getWorldDirection(this.fwd);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const fx = this.fwd.x / fl;
    const fz = this.fwd.z / fl;
    const slow = Math.sqrt(sim.timeScale);

    // Engines and the world only behind a menu when there's no menu.
    glide(g.engines.gain, f.menu ? 0 : 0.55, now, 0.2);
    glide(g.sfx.gain, f.menu ? 0 : 0.9, now, 0.2);

    // ---- the focus car ----
    const cls = sim.classes[c.cls[i]];
    const es = engineSound(cls.id);
    const speed = Math.hypot(c.vx[i], c.vz[i]);
    const ctl = sim.controls[i];
    const grounded = c.grounded[i] === 1;
    const wrecked = c.wreck[i] === 1;
    gearbox(speed, cls.topSpeed, es.gears, this.gear);
    // In the air the wheels spin free: the revs climb with the throttle.
    const target = grounded ? this.gear.rpm : Math.min(1.1, this.gear.rpm + ctl.throttle * 0.35);
    this.rpm += (target - this.rpm) * damp(grounded ? 18 : 4, dt);
    const boosting = c.boosting[i] === 1 || c.miniT[i] > 0;
    const throttle = wrecked ? 0 : ctl.throttle;
    g.engine.set(engineHz(this.rpm, es) * slow, es.growl, 280 + 2800 * (0.3 + 0.7 * throttle) * (0.4 + 0.6 * this.rpm) + (boosting ? 1800 : 0), now);
    g.engine.out.set(wrecked ? 0 : 0.28 + 0.3 * throttle, 0, now);

    const surf = sim.surfaces[c.surface[i]];
    const slip = Math.abs(c.slip[i]);
    const moving = clamp(speed / 15, 0, 1);
    const onRoad = grounded && !wrecked;
    const squeal = onRoad && !surf.offroad ? clamp((slip - 0.08) * 2.8, 0, 1) * moving * (c.drift[i] ? 1 : 0.7) : 0;
    glide(g.tyres.filter.frequency, (1250 + slip * 900) * slow, now);
    g.tyres.out.set(squeal * 0.3, 0, now, 0.06);
    const gravel = onRoad && surf.offroad ? clamp(speed / 30, 0, 1) * 0.45 + slip * 0.3 : 0;
    g.gravel.out.set(gravel * 0.5, 0, now, 0.08);
    glide(g.wind.filter.frequency, 350 + speed * 22, now);
    g.wind.out.set(clamp((speed - 8) / 60, 0, 1) ** 2 * 0.3, 0, now, 0.2);
    g.roar.out.set(boosting && !wrecked ? 0.32 : 0, 0, now, 0.08);
    g.horn.set(ctl.horn && !f.menu ? 0.12 : 0, 0, now, 0.02);

    // ---- rivals: the nearest few engines ----
    const near = this.near;
    near.length = 0;
    for (let k = 0; k < c.count; k++) {
      if (k === i || !c.active[k] || c.wreck[k]) continue;
      const d = Math.hypot(c.x[k] - cam.x, c.z[k] - cam.z);
      if (d < HEAR) near.push(k);
    }
    near.sort((a, b) => Math.hypot(c.x[a] - cam.x, c.z[a] - cam.z) - Math.hypot(c.x[b] - cam.x, c.z[b] - cam.z));
    for (let v = 0; v < RIVALS; v++) {
      const voice = g.rivals[v];
      const k = near[v];
      if (k === undefined) {
        voice.out.set(0, 0, now, 0.15);
        continue;
      }
      const rc = sim.classes[c.cls[k]];
      const rs = engineSound(rc.id);
      const dx = c.x[k] - cam.x;
      const dz = c.z[k] - cam.z;
      spatial(dx, dz, fx, fz, 10, this.where);
      const shift = doppler(dx, dz, c.vx[k], c.vz[k], c.vx[i], c.vz[i]);
      gearbox(Math.hypot(c.vx[k], c.vz[k]), rc.topSpeed, rs.gears, this.gear);
      voice.set(engineHz(this.gear.rpm, rs) * shift * slow, rs.growl, 600 + 2200 * this.gear.rpm, now);
      voice.out.set(this.where.gain * 0.35, this.where.pan, now, 0.08);
    }

    // ---- moments ----
    this.cursor = sim.events.read(this.cursor, (e) => this.onEvent(e, i, cam.x, cam.z, fx, fz, f.menu));
    if (!f.menu && sim.race.phase === 'countdown') {
      // Beeps at 3, 2, 1; GO comes from the RaceStart event.
      const left = Math.ceil(sim.race.goTime - sim.time);
      if (left >= 1 && left <= 3 && left !== this.beeped) {
        this.beeped = left;
        this.play(0.25, 0, (s) => toneShot(s, 'square', note(0), note(0), 0.005, 0.18));
      }
    }

    // ---- music ----
    const racing = sim.race.phase === 'racing' && !c.finished[i];
    const finalLap = racing && sim.race.laps > 1 && c.lap[i] === sim.race.laps - 1;
    g.music.intensity = (f.menu || !racing ? 0 : finalLap ? 2 : 1) as Intensity;
    if (this.settings.music) g.music.update();
    glide(g.musicLevel.gain, this.settings.music ? 0.5 : 0, now, 0.3);
    // Muffled behind the menu and in slow-mo.
    glide(g.musicTone.frequency, f.menu ? 1400 : sim.timeScale < 0.9 ? 550 : 12000, now, 0.15);
  }

  /** Plays a one-shot at level `gain`, panned `pan`, through `fn`. */
  private play(gain: number, pan: number, fn: (s: Shot) => void): void {
    if (gain < 0.01) return;
    this.shot.gain = gain;
    this.shot.pan = pan;
    fn(this.shot);
  }

  private onEvent(e: GameEvent, focus: number, lx: number, lz: number, fx: number, fz: number, menu: boolean): void {
    if (menu) return;
    const mine = e.car === focus || e.other === focus;
    // Where it happened (the event's position; zero means "no position": play it centered).
    const w = this.where;
    if (e.x === 0 && e.z === 0) {
      w.pan = 0;
      w.gain = 1;
    } else spatial(e.x - lx, e.z - lz, fx, fz, 14, w);
    const at = (level: number) => (mine ? level : level * w.gain);
    const pan = mine ? w.pan * 0.3 : w.pan;
    switch (e.type) {
      case Ev.WallHit:
      case Ev.CarContact: {
        const k = clamp(e.a / (e.type === Ev.WallHit ? 25 : 18), 0.1, 1);
        this.play(at(0.5 * k), pan, (s) => {
          noiseShot(s, 'lowpass', 1400, 300, 0.002, 0.12 + 0.2 * k, 0.8);
          toneShot(s, 'sine', 110, 45, 0.002, 0.15 + 0.1 * k);
        });
        break;
      }
      case Ev.Wreck:
        if (e.b === Cause.Reset) break;
        this.play(at(0.8), pan, (s) => {
          noiseShot(s, 'lowpass', 2000, 180, 0.002, 0.55, 0.7);
          toneShot(s, 'sine', 90, 30, 0.002, 0.4);
          noiseShot(s, 'bandpass', 700, 350, 0.02, 0.35, 3);
          // Glass: a spray of short bright ticks.
          const t = s.ctx.currentTime;
          for (let n = 0; n < 6; n++) noiseShot(s, 'highpass', 5000 + n * 700, 6000, 0.001, 0.05 + Math.random() * 0.06, 2, t + 0.04 + n * 0.035 + Math.random() * 0.03);
        });
        break;
      case Ev.TrafficWreck:
        this.play(at(0.55), pan, (s) => {
          noiseShot(s, 'lowpass', 1600, 200, 0.002, 0.4, 0.7);
          toneShot(s, 'sine', 80, 35, 0.002, 0.3);
        });
        break;
      case Ev.Land:
        if (e.a > 0.15) this.play(at(0.4 * clamp(e.a, 0, 1)), pan, (s) => toneShot(s, 'sine', 95, 40, 0.002, 0.2));
        break;
      case Ev.BoostStart:
        if (mine) this.play(0.35, 0, (s) => noiseShot(s, 'bandpass', 300, 1800, 0.08, 0.4, 1.5));
        break;
      case Ev.AirBoost:
        if (e.car === focus) this.chime(e.other === 1 ? [5, 12, 17, 24] : e.b > 0.9 ? [5, 12, 17] : [5, 12], 0.16);
        break;
      case Ev.MiniTurbo:
      case Ev.DriftBoost:
        if (e.car === focus) this.chime([7, 12, 19].slice(0, e.type === Ev.MiniTurbo ? 1 + e.b : e.a > 0.25 ? 3 : 2), 0.18);
        break;
      case Ev.DriftChain:
        // A rising run, a note per drift in the chain (up to five).
        if (e.car === focus) this.chime([0, 4, 7, 12, 16, 19].slice(0, Math.min(6, e.b + 1)), 0.2);
        break;
      case Ev.ChainLost:
        if (e.car === focus) this.play(0.25, 0, (s) => toneShot(s, 'triangle', 330, 150, 0.005, 0.35));
        break;
      case Ev.NearMiss:
        if (e.car === focus) {
          this.play(0.3, 0, (s) => noiseShot(s, 'bandpass', 2400, 500, 0.02, 0.3, 2));
          this.horn(0.14, pan);
        }
        break;
      case Ev.Smash:
        this.play(at(0.3), pan, (s) => noiseShot(s, 'bandpass', 1500, 500, 0.002, 0.16, 1.2));
        break;
      case Ev.TrafficCheck:
        this.play(at(0.45), pan, (s) => noiseShot(s, 'lowpass', 1200, 250, 0.002, 0.25, 0.8));
        this.horn(at(0.12), pan);
        break;
      case Ev.Takedown:
        if (e.car === focus) {
          // A stinger: a bright minor chord that falls away.
          this.play(0.22, 0, (s) => {
            for (const n of [0, 3, 7, 12]) toneShot(s, 'sawtooth', note(n), note(n - 0.3), 0.01, 0.7);
          });
        }
        break;
      case Ev.SpinOut:
        this.play(at(0.3), pan, (s) => noiseShot(s, 'bandpass', 1700, 900, 0.02, 0.6, 5));
        break;
      case Ev.Hazard:
        // Every telegraph has a sound (SPEC §7): a two-tone alert.
        this.play(0.12, 0, (s) => {
          const t = s.ctx.currentTime;
          for (let n = 0; n < 3; n++) toneShot(s, 'sine', note(n % 2 ? 7 : 12), note(n % 2 ? 7 : 12), 0.01, 0.16, t + n * 0.2);
        });
        break;
      case Ev.RaceStart:
        this.beeped = 0;
        this.play(0.3, 0, (s) => toneShot(s, 'square', note(12), note(12), 0.005, 0.5));
        break;
      case Ev.StartBoost:
        if (e.car === focus) {
          if (e.b) this.play(0.35, 0, (s) => noiseShot(s, 'bandpass', 400, 2200, 0.05, 0.5, 1.5));
          else this.play(0.25, 0, (s) => toneShot(s, 'square', 70, 40, 0.01, 0.35));
        }
        break;
      case Ev.Lap:
        if (e.car === focus && !this.sim.cars.finished[focus]) this.chime(this.sim.cars.lap[focus] === this.sim.race.laps - 1 ? [0, 7, 12, 19] : [7, 12], 0.16);
        break;
      case Ev.Finish:
        if (e.car === focus) this.chime(e.b === 1 ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12], 0.18, 0.09);
        break;
      case Ev.Respawn:
        if (e.car === focus && e.a >= 0.01) this.chime([12, 19], 0.1);
        break;
    }
  }

  /** Rising notes (semitones over A4). */
  private chime(notes: number[], gain: number, gap = 0.07): void {
    this.play(gain, 0, (s) => {
      const t = s.ctx.currentTime;
      notes.forEach((n, k) => toneShot(s, 'triangle', note(n), note(n), 0.004, 0.35, t + k * gap));
    });
  }

  /** A traffic horn blip: two detuned squares. */
  private horn(gain: number, pan: number): void {
    this.play(gain, pan, (s) => {
      toneShot(s, 'square', 330, 325, 0.01, 0.28);
      toneShot(s, 'square', 415, 410, 0.01, 0.28);
    });
  }
}
