// Game audio (SPEC §13): the focus car's engine, tyres, gravel, snow, wind, boost and an avalanche's
// rumble as continuous voices; the three nearest rivals' engines, panned and Doppler-shifted;
// one-shots from sim events (hits, wrecks, landings, boost, chimes, near-miss horns, hazard alerts,
// the countdown); a drawbridge's bells; and the music:
// the recorded soundtrack (soundtrack.ts), or the synth (music.ts) where there's no track. The rest
// is synthesized (synth.ts). All presentation: it reads the sim and never writes to it.
//
// Browsers mostly start audio only after a gesture: the context is made at once in case this one
// allows it (a site the player's been on a lot, or one allowed sound), and resumed on the first key
// or click (a tap's release) if not.
// Paused or hidden, it suspends. M mutes, N toggles music; both are remembered on this device.

import { Vector3, type PerspectiveCamera } from 'three';
import { clamp, damp } from '../core/math';
import { Cause, Ev, type GameEvent } from '../core/events';
import type { Sim } from '../core/sim';
import { newHit, sampleAt } from '../core/track/query';
import { panelLook } from '../core/world/breakables';
import { TRAFFIC_KINDS } from '../core/world/traffic';
import { Piece } from '../core/world/hazards';
import { doppler, engineHz, engineSound, gearbox, musicMix, spatial, type Gear, type Spatial } from './model';
import { Music, type Intensity } from './music';
import { type Soundtrack, trackTitle } from './soundtrack';
import { EngineVoice, glide, NoiseVoice, noiseShot, note, Out, roomImpulse, toneShot, type Shot } from './synth';

const RIVALS = 3;
/** A drawbridge's bells ring this often (s) through its warning, and half as often until it's down. */
const BELL = 0.5;
/** They're heard this far (m: half as loud at this distance). */
const BELL_HEAR = 70;
/** Rivals are heard within this of the camera. */
const HEAR = 90;
const SETTINGS_KEY = 'racecar.audio';
/** The recorded tracks' level into the music bus. */
const TRACK_LEVEL = 0.8;
/**
 * The buses' levels. Engines were too loud for the music in playtests (2026-10-01): down from
 * 0.55, with the music up (`musicMix`'s level), about 8 dB between them.
 */
const SFX_LEVEL = 0.9;
const ENGINES_LEVEL = 0.35;
/** The menus' clicks (ui/click.ts), scaled by the effects volume. */
const UI_LEVEL = 0.5;
/** A paused race's context runs this long for a menu click (ms), then stops again. */
const UI_RING_MS = 250;

/** The master's level, before the player's own volume. */
const MASTER_LEVEL = 0.8;
/** Snow under the wheels and the avalanche's rumble: the owner heard them first in a race (2026-10-02) and asked for both a little down (from 1, about 4.5 dB). */
const SNOW_LEVEL = 0.6;
const RUMBLE_LEVEL = 0.6;
/** What splashes as the focus car drives into it. */
const WATER = new Set(['river', 'ford', 'puddle']);
/** The room's echo lasts this long (s). */
const ROOM_S = 1.6;
/** Indoors (an enclosed piece: docs/CALDERA.md step 3), the engines and effects ring this much in the room's echo. */
const REVERB_LEVEL = 0.55;

/** The player's volumes (settings.ts), 0 to 1 each: they scale the levels above. */
export interface Volumes {
  master: number;
  music: number;
  engines: number;
  effects: number;
}

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
  /** How indoors the camera is, 0 to 1 (the renderer's `indoor`): the room's echo. */
  indoor?: number;
}

/** Everything made once the context exists. */
interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  /** The menus' clicks: heard behind a menu and through a pause, unlike `sfx`. */
  ui: GainNode;
  engines: GainNode;
  musicLevel: GainNode;
  musicTone: BiquadFilterNode;
  /** The music's own master (it skips the compressor): muted with `master`. */
  musicOut: GainNode;
  engine: EngineVoice;
  tyres: NoiseVoice;
  gravel: NoiseVoice;
  /** Snow under the wheels: a crunch on the groomed piste, a hiss in powder. */
  crunch: NoiseVoice;
  hiss: NoiseVoice;
  wind: NoiseVoice;
  /** A gale: a sandstorm's, and a dust devil's roar as it closes on you (louder, higher, inside it). */
  gale: NoiseVoice;
  roar: NoiseVoice;
  /** The avalanche, a low rumble that grows as it closes on you. */
  rumble: NoiseVoice;
  horn: Out;
  rivals: EngineVoice[];
  music: Music;
  /** The recorded track's level (`TRACK_LEVEL`), into the music bus. */
  trackLevel: GainNode;
  /** The echo's level: the engines and effects, through a room's echo, into the master. */
  reverb: GainNode;
  /** The room's echo itself, fed the engines and effects only while it's heard (`roomFed`). */
  room: ConvolverNode;
}

export class GameAudio {
  readonly settings = loadSettings();
  /** The player's volumes (the Settings panel); `setVolumes` changes them. */
  private vol: Volumes = { master: 1, music: 1, engines: 1, effects: 1 };
  private g?: Graph;
  private cursor: number;
  private readonly gear: Gear = { gear: 0, rpm: 0 };
  private readonly where: Spatial = { pan: 0, gain: 1 };
  private readonly fwd = new Vector3();
  private rpm = 0;
  /** The focus car was in water last frame (the splash is going in). */
  private wading = false;
  private beeped = 0;
  /** Each drawbridge's middle (x, z) on `bellsOf`'s track, for its bells; and the last ring heard, per bridge. */
  private bells: { x: number; z: number }[] = [];
  private bellsOf?: object;
  private rung: number[] = [];
  private hidden = false;
  /** The track should be playing (as of the last frame). */
  private wantTrack = false;
  /** A menu click rings until then (performance.now()): a paused context runs for it. */
  private uiUntil = 0;
  private readonly uiShot: Shot = { ctx: undefined as unknown as AudioContext, bus: undefined as unknown as AudioNode, gain: 0, pan: 0 };
  /** The context has run: resuming it from a frame can work (after a pause, a hidden tab). */
  private ran = false;
  private readonly near: number[] = [];
  private readonly shot: Shot = { ctx: undefined as unknown as AudioContext, bus: undefined as unknown as AudioNode, gain: 0, pan: 0 };

  constructor(
    private readonly sim: Sim,
    /** The page's recorded track, if it has one (soundtrack.ts); the synth plays without one. */
    private readonly track: Soundtrack | null = null,
    /** It's the title's: heard clearly behind the menus (the synth is muffled there). */
    private readonly titleTrack = false,
  ) {
    this.cursor = sim.events.head;
    const unlock = () => {
      this.start();
      if (this.g) {
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('pointerup', unlock);
      }
    };
    // A tap's activation is on its release (`pointerup`), not its press: iOS starts nothing on a
    // touch's `pointerdown`.
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerup', unlock);
    // Without a gesture too, unless the browser says it won't (Firefox can tell): the title's music
    // from the start where it's allowed. Where it isn't, the context waits suspended for the first.
    const policy = (globalThis.navigator as { getAutoplayPolicy?: (t: string) => string } | undefined)?.getAutoplayPolicy?.('audiocontext');
    if (policy !== 'disallowed') this.start(false);
    // Every key or click after, too: a track paused (the pause menu, a hidden tab) may only start
    // again from one.
    const again = () => this.g && this.wantTrack && this.track?.play(true);
    window.addEventListener('keydown', again);
    window.addEventListener('pointerup', again);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      // A hidden tab runs no frames, so update() can't do this: suspend here, and update()
      // resumes when frames come back.
      if (this.hidden) {
        void this.g?.ctx.suspend();
        this.track?.pause();
      }
    });
  }

  /**
   * Makes the graph and resumes the context. `gesture`: from a key or click (the page's load
   * otherwise, where a refused play is just "not yet", not one of the refusals that give up on it).
   */
  private start(gesture = true): void {
    if (this.g) {
      void this.g.ctx.resume();
      // Made at load and held back till now: the track starts in the gesture, as it would have.
      if (gesture && this.settings.music && !this.settings.muted) this.track?.play(true);
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const master = ctx.createGain();
    master.gain.value = this.masterLevel();
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
    const sfx = bus(SFX_LEVEL);
    const engines = bus(ENGINES_LEVEL);
    // Indoors, they ring: sent through a room's echo too (not the menus' clicks, nor the music).
    const reverb = ctx.createGain();
    reverb.gain.value = 0;
    // (Fed only while there's an echo to hear: a convolver works as hard at a gain of 0. See `roomFed`.)
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx, ROOM_S, 3);
    room.connect(reverb).connect(master);
    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 12000;
    const musicLevel = ctx.createGain();
    musicLevel.gain.value = 0;
    // Its own way out, not through the compressor: loud engines and crashes pumped it down there.
    // Muted with everything else (`musicOut` follows the master's level).
    const musicOut = ctx.createGain();
    musicOut.gain.value = master.gain.value;
    musicLevel.connect(musicTone).connect(musicOut).connect(ctx.destination);
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
      ui: bus(UI_LEVEL * this.vol.effects),
      engines,
      musicLevel,
      musicTone,
      musicOut,
      engine: new EngineVoice(ctx, engines),
      tyres: new NoiseVoice(ctx, sfx, 'bandpass', 1500, 5),
      gravel: new NoiseVoice(ctx, sfx, 'lowpass', 650, 0.7),
      crunch: new NoiseVoice(ctx, sfx, 'bandpass', 2100, 1.4),
      hiss: new NoiseVoice(ctx, sfx, 'bandpass', 5200, 0.6),
      wind: new NoiseVoice(ctx, sfx, 'lowpass', 500, 0.5),
      gale: new NoiseVoice(ctx, sfx, 'bandpass', 700, 0.7),
      roar: new NoiseVoice(ctx, sfx, 'bandpass', 220, 1.2),
      rumble: new NoiseVoice(ctx, sfx, 'lowpass', 110, 0.8),
      horn,
      rivals: Array.from({ length: RIVALS }, () => new EngineVoice(ctx, engines)),
      music: new Music(ctx, musicLevel),
      trackLevel: ctx.createGain(),
      reverb,
      room,
    };
    this.g.trackLevel.gain.value = TRACK_LEVEL;
    this.g.trackLevel.connect(musicLevel);
    this.track?.connect(ctx, this.g.trackLevel);
    // In the gesture itself: the only time some browsers start media.
    if (this.settings.music && !this.settings.muted) this.track?.play(gesture);
    this.shot.ctx = ctx;
    this.shot.bus = sfx;
    this.uiShot.ctx = ctx;
    this.uiShot.bus = this.g.ui;
  }

  /** Whether anything can be heard yet: the context is running (the browser allowed it, or a gesture did). */
  get audible(): boolean {
    return this.g?.ctx.state === 'running';
  }

  /** The master's level now: M's mute, then the player's master volume. */
  /** Whether the engines and effects feed the room's echo, and since when it's been silent (ctx s; NaN: heard). */
  private fed = false;
  private quietFrom = NaN;

  /**
   * Feeds the room's echo while it's heard (`on`), and stops once it's been silent longer than the
   * echo rings: outdoors, and on maps with no tunnel, the convolver then does no work.
   */
  private roomFed(on: boolean, now: number): void {
    const g = this.g!;
    if (on) {
      this.quietFrom = NaN;
      if (this.fed) return;
      g.sfx.connect(g.room);
      g.engines.connect(g.room);
      this.fed = true;
      return;
    }
    if (!this.fed) return;
    if (this.quietFrom !== this.quietFrom) this.quietFrom = now;
    // (The level glides to 0 over about 0.1 s; then the tail rings out.)
    if (now - this.quietFrom < ROOM_S + 0.5) return;
    g.sfx.disconnect(g.room);
    g.engines.disconnect(g.room);
    this.fed = false;
  }

  private masterLevel(): number {
    return this.settings.muted ? 0 : MASTER_LEVEL * this.vol.master;
  }

  /** The master and the music's own way out (which skips the compressor) follow M and the master volume. */
  private applyMaster(): void {
    if (!this.g) return;
    glide(this.g.master.gain, this.masterLevel(), this.g.ctx.currentTime, 0.05);
    glide(this.g.musicOut.gain, this.masterLevel(), this.g.ctx.currentTime, 0.05);
  }

  /** The player's volumes (the Settings panel): the master at once, the buses from the next frame. */
  setVolumes(v: Volumes): void {
    this.vol = { ...v };
    this.applyMaster();
  }

  /** M: everything on or off. Returns whether it's now muted. */
  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.save();
    this.applyMaster();
    // Unmuting is a key press: start the context and the track in it, as some browsers (iOS) only
    // allow then. A pause or a menu still stops them on the next frame.
    if (!this.settings.muted && this.g) {
      void this.g.ctx.resume();
      if (this.settings.music) this.track?.play(true);
    }
    return this.settings.muted;
  }

  /** N: music on or off. Returns whether it's now on. */
  toggleMusic(): boolean {
    this.settings.music = !this.settings.music;
    this.save();
    return this.settings.music;
  }

  /** - and +: the previous or next track, played at once if the music's on. Null with no track (the synth's). */
  stepTrack(dir: 1 | -1): string | null {
    if (!this.track || this.track.failed) return null;
    return trackTitle(this.track.step(dir, !!this.g && this.settings.music && !this.settings.muted));
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
    // Paused, a menu click keeps the context running till it's rung out, with only the click heard.
    const stop = quiet && !(f.paused && !this.hidden && !this.settings.muted && performance.now() < this.uiUntil);
    if (g.ctx.state === 'running') this.ran = true;
    // Resumed only once it can start: it has run before (a pause, a hidden tab), or there's been a
    // gesture. Held back by the browser, a resume a frame would just pile up, never settling.
    const canResume = this.ran || (globalThis.navigator as { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation?.hasBeenActive !== false;
    if (stop && g.ctx.state === 'running') void g.ctx.suspend();
    else if (!stop && g.ctx.state === 'suspended' && canResume) void g.ctx.resume();
    if (quiet) {
      // A track would play on through a suspended context, unheard: it waits instead.
      this.wantTrack = false;
      this.track?.pause();
      // Running for a click: the race is silent behind it (it may have been paused by that click,
      // the ☰ Menu button, with everything still up). Unpaused, they glide back.
      if (!stop) this.silenceRace();
      // What happened meanwhile isn't heard later (online, the race goes on while muted or paused).
      this.cursor = this.sim.events.head;
      return;
    }
    // Held back by the browser (no gesture yet), or resuming and not running yet: nothing is heard,
    // and sounds made now would all play at once when it starts (its clock stands still). The track
    // is left alone: a gesture may just have started it, in the resume's wait.
    if (g.ctx.state !== 'running') {
      this.cursor = this.sim.events.head;
      return;
    }
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
    glide(g.engines.gain, f.menu ? 0 : ENGINES_LEVEL * this.vol.engines, now, 0.2);
    const echo = f.menu ? 0 : REVERB_LEVEL * (f.indoor ?? 0);
    glide(g.reverb.gain, echo, now, 0.1);
    this.roomFed(echo > 0, now);
    glide(g.sfx.gain, f.menu ? 0 : SFX_LEVEL * this.vol.effects, now, 0.2);

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
    const snow = !!surf.slide;
    // (Snow doesn't squeal: it crunches, below.)
    const squeal = onRoad && !surf.offroad && !snow ? clamp((slip - 0.08) * 2.8, 0, 1) * moving * (c.drift[i] ? 1 : 0.7) : 0;
    glide(g.tyres.filter.frequency, (1250 + slip * 900) * slow, now);
    g.tyres.out.set(squeal * 0.3, 0, now, 0.06);
    const gravel = onRoad && surf.offroad && !snow ? clamp(speed / 30, 0, 1) * 0.45 + slip * 0.3 : 0;
    g.gravel.out.set(gravel * 0.5, 0, now, 0.08);
    // Snow: groomed crunches (a flutter, frame to frame, like packed snow giving), powder hisses.
    const inSnow = onRoad && snow ? clamp(speed / 25, 0, 1) * 0.4 + slip * 0.35 : 0;
    g.crunch.out.set(surf.offroad ? 0 : inSnow * (0.35 + 0.5 * Math.random()) * SNOW_LEVEL, 0, now, 0.03);
    glide(g.hiss.filter.frequency, (4200 + speed * 25) * slow, now);
    g.hiss.out.set((surf.offroad ? inSnow * 0.55 : inSnow * 0.12) * SNOW_LEVEL, 0, now, 0.1);
    glide(g.wind.filter.frequency, 350 + speed * 22, now);
    g.wind.out.set(clamp((speed - 8) / 60, 0, 1) ** 2 * 0.3, 0, now, 0.2);
    // The gale: a sandstorm's steady howl, gusting; the nearest dust devil's whirl over it, rising
    // as it closes in (from 40 m) and loudest with you inside it.
    const storm = sim.fall === 'sand' ? sim.wetness * (0.75 + 0.25 * Math.sin(now * 0.9)) : 0;
    let devil = 0;
    const hz = sim.world?.hazards;
    for (let p = 0; hz && p < hz.pieces; p++) {
      if (hz.pType[p] !== Piece.Devil) continue;
      devil = Math.max(devil, clamp(1 - (Math.hypot(c.x[i] - hz.px[p], c.z[i] - hz.pz[p]) - hz.phw[p]) / 40, 0, 1) ** 2 * hz.pTilt[p]);
    }
    glide(g.gale.filter.frequency, (520 + 380 * storm + 900 * devil) * slow, now);
    g.gale.out.set(f.menu ? 0 : Math.max(storm * 0.22, devil * 0.4), 0, now, 0.15);
    // Into water: a splash, the bigger the faster.
    const inWater = WATER.has(surf.id) && onRoad;
    if (inWater && !this.wading && speed > 4 && !f.menu) {
      const big = clamp(speed / 30, 0.3, 1) * (surf.id === 'puddle' ? 0.4 : 1);
      this.play(0.5 * big, 0, (s) => {
        noiseShot(s, 'bandpass', 2600, 500, 0.004, 0.45, 0.8);
        noiseShot(s, 'lowpass', 900, 200, 0.002, 0.25, 0.7);
      });
    }
    this.wading = inWater;
    g.roar.out.set(boosting && !wrecked ? 0.32 : 0, 0, now, 0.08);
    // The avalanche: from 500 m behind you, louder as it closes (and on top of you, loudest).
    const run = sim.track.run;
    const gap = run && sim.avalancheFront > -Infinity && !c.finished[i] ? c.progress[i] + run.start - sim.avalancheFront : Infinity;
    g.rumble.out.set(f.menu ? 0 : clamp(1 - gap / 500, 0, 1) ** 1.5 * 0.7 * RUMBLE_LEVEL, 0, now, 0.25);
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

    // ---- drawbridges: their bells, from the warning till they're down ----
    const lifts = sim.world?.lifts;
    if (lifts?.pieces.length && !f.menu) {
      if (this.bellsOf !== sim.track) {
        const hit = newHit();
        this.bellsOf = sim.track;
        this.bells = lifts.defs.map((d) => (sampleAt(sim.track.main, (d.s[0] + d.s[1]) / 2, hit), { x: hit.cx, z: hit.cz }));
      }
      for (let k = 0; k < lifts.pieces.length; k++) {
        // From its warning till it's down: a ring at once, then every BELL s, every 2 BELL once it's lifting.
        const u = lifts.since(k, sim.time);
        if (!(u >= 0)) continue;
        const warn = lifts.defs[k].warn;
        const ring = u < warn ? Math.floor(u / BELL) : 1000 + Math.floor((u - warn) / (BELL * 2));
        if (ring === this.rung[k]) continue;
        this.rung[k] = ring;
        const b = this.bells[k];
        spatial(b.x - cam.x, b.z - cam.z, fx, fz, BELL_HEAR, this.where);
        this.play(0.3 * this.where.gain, this.where.pan, (s) => {
          toneShot(s, 'triangle', 1320, 1320, 0.002, 0.55);
          toneShot(s, 'sine', 2650, 2650, 0.002, 0.25);
        });
      }
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
    const mix = musicMix({ recorded: !!this.track && !this.track.failed, on: this.settings.music, menu: f.menu, titleTrack: this.titleTrack, racing, finalLap, timeScale: sim.timeScale });
    this.wantTrack = mix.track;
    if (mix.track) this.track!.play();
    else this.track?.pause();
    g.music.intensity = mix.intensity as Intensity;
    if (mix.synth) g.music.update();
    glide(g.musicLevel.gain, mix.level * this.vol.music, now, 0.3);
    glide(g.musicTone.frequency, mix.tone, now, 0.15);
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
        // A camel scattering: a soft thump in the sand, no crunch.
        if (TRAFFIC_KINDS[this.sim.world?.traffic.kind[e.other] ?? -1]?.animal) {
          this.play(at(0.35), pan, (s) => {
            noiseShot(s, 'lowpass', 500, 120, 0.004, 0.3, 0.8);
            toneShot(s, 'sine', 70, 40, 0.003, 0.2);
          });
          break;
        }
        this.play(at(0.55), pan, (s) => {
          noiseShot(s, 'lowpass', 1600, 200, 0.002, 0.4, 0.7);
          toneShot(s, 'sine', 80, 35, 0.002, 0.3);
        });
        break;
      case Ev.Land:
        // In snow a mogul's hop lands too: a soft whump of snow, under the thud.
        if (this.sim.surfaces[this.sim.cars.surface[e.car]]?.slide && e.a > 0.08)
          this.play(at(0.45 * clamp(e.a * 1.5, 0.3, 1)), pan, (s) => {
            noiseShot(s, 'lowpass', 600, 120, 0.004, 0.28, 0.8);
            toneShot(s, 'sine', 70, 35, 0.003, 0.18);
          });
        else if (e.a > 0.15) this.play(at(0.4 * clamp(e.a, 0, 1)), pan, (s) => toneShot(s, 'sine', 95, 40, 0.002, 0.2));
        break;
      case Ev.BoostStart:
        if (mine) this.play(0.35, 0, (s) => noiseShot(s, 'bandpass', 300, 1800, 0.08, 0.4, 1.5));
        break;
      case Ev.AirBoost:
        if (e.car === focus) this.chime(e.other === 1 ? [5, 12, 17, 24] : e.b > 0.9 ? [5, 12, 17] : [5, 12], 0.16);
        break;
      case Ev.Gate:
        // Up a step a gate in a row.
        if (e.car === focus) this.chime([7 + Math.min(e.b, 5) * 2], 0.14);
        break;
      case Ev.MiniTurbo:
      case Ev.DriftBoost:
        if (e.car === focus) this.chime([7, 12, 19].slice(0, e.type === Ev.MiniTurbo ? 1 + e.b : e.a > 0.25 ? 3 : 2), 0.18);
        break;
      case Ev.DriftChain:
        // A rising run, a note per drift in the chain (up to five).
        if (e.car === focus) this.chime([0, 4, 7, 12, 16, 19].slice(0, Math.min(6, e.b + 1)), 0.2);
        break;
      case Ev.Slingshot:
        if (e.car === focus) this.play(0.3, 0, (s) => noiseShot(s, 'bandpass', 500, 2600, 0.04, 0.45, 1.4));
        break;
      case Ev.Overdrive:
        if (e.car === focus) this.chime([0, 7], 0.12);
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
      case Ev.WallBreak:
        if (this.sim.world && panelLook(this.sim.track.layout.breakables, this.sim.world.breakables, e.b) === 'glass') {
          // A pane going: a bright smash, and the tinkle of it falling.
          this.play(at(0.5), pan, (s) => noiseShot(s, 'highpass', 3200, 1800, 0.001, 0.22, 0.8));
          this.play(at(0.25), pan, (s) => noiseShot(s, 'bandpass', 6000, 4200, 0.03, 0.5, 6));
          break;
        }
        // Planks going: a crack and a woody thud.
        this.play(at(0.5), pan, (s) => noiseShot(s, 'bandpass', 900, 300, 0.002, 0.3, 1.1));
        this.play(at(0.4), pan, (s) => toneShot(s, 'triangle', 140, 55, 0.004, 0.25));
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

  /**
   * A menu sound (ui/click.ts): a press, a softer one for Back and the like (ghost buttons), or a
   * chooser's or slider's tick. Heard over the title and through a pause (the context runs again
   * for it, with the race's sounds silenced till it's unpaused), never while muted.
   */
  uiSound(kind: 'press' | 'back' | 'tick'): void {
    const g = this.g;
    if (!g || this.settings.muted || this.hidden) return;
    if (g.ctx.state === 'suspended') {
      // Paused: the engines, effects and music go silent before it runs, and glide back on unpausing.
      this.silenceRace();
      void g.ctx.resume();
    }
    this.uiUntil = performance.now() + UI_RING_MS;
    g.ui.gain.value = UI_LEVEL * this.vol.effects;
    const s = this.uiShot;
    s.gain = 1;
    s.pan = 0;
    const t = g.ctx.currentTime;
    if (kind === 'tick') {
      toneShot(s, 'triangle', 2400, 2100, 0.001, 0.035, t);
    } else if (kind === 'back') {
      toneShot(s, 'triangle', 660, 520, 0.002, 0.07, t);
      noiseShot(s, 'bandpass', 1800, 900, 0.001, 0.03, 2, t);
    } else {
      toneShot(s, 'square', 1250, 900, 0.001, 0.045, t);
      toneShot(s, 'triangle', 1870, 1870, 0.002, 0.08, t + 0.012);
      noiseShot(s, 'highpass', 4000, 3000, 0.001, 0.02, 1, t);
    }
  }

  /** The engines, effects and music at 0 at once (a paused race behind a menu click). */
  private silenceRace(): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    for (const p of [g.engines.gain, g.sfx.gain, g.musicLevel.gain, g.reverb.gain]) {
      p.cancelScheduledValues(now);
      p.value = 0;
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
