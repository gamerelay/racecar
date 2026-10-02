// The game: the title screen and lobbies (ui/menu.ts) over a live AI race (attract mode), then a
// race from a lobby's seats with traffic, hazards and weather, or free drive. In a lobby, the race
// behind runs on its map (swapped in place when the host picks another) and your car turns on a
// table beside the menu (render/showroom.ts). The editor (` key,
// dev builds), local telemetry and the F8 report as in milestone 1.
//
// URL: a race (see ui/setup.ts: mode, map, car, paint, seats, laps, weather, mayhem, traffic,
// seed, lobby), or ?lobby=<id> for a lobby, plus &post=0 &ink=0 &trace=1.

import './ui/hud.css';
import { TUNING } from './core/car/tuning';
import type { TrackLayout } from './core/content';
import { neutralControls, type Controls } from './core/controls';
import { Ev } from './core/events';
import { Sim, TICK_RATE } from './core/sim';
import { bakeTrack } from './core/track/bake';
import { Input } from './input/input';
import { GameRenderer } from './render/renderer';
import { GreyboxSkin } from './render/skins/greybox';
import { posthogEnabled, posthogSink } from './telemetry/posthog';
import { Telemetry } from './telemetry/telemetry';
import { GameAudio } from './audio/audio';
import { playlistFor, Soundtrack } from './audio/soundtrack';
import { Hud } from './ui/hud';
import { RaceUi } from './ui/race';
import { accept, navigate } from './ui/nav';
import { backToSetup, raceAgain, readChoices, readSetup, restart, type RaceSetup } from './ui/setup';
import { Menu, type Preview } from './ui/menu';
import { GameRelay } from '@gamerelay/sdk';
import { Lobbies, LocalBackend, LOCAL_ID } from './lobby/backend';
import { RelayBackend, type RelayLike } from './lobby/relay';
import { Stepper } from './net/stepper';
import { OnlineRace } from './net/online';
import { roster } from './lobby/lobby';
import { loadPlate } from './lobby/plate';
import { CLASSES, LAYOUTS, MAPS, PAINTS, SURFACES } from './content';
import { paletteFor, resolveLayout } from './core/content';

const params = new URLSearchParams(location.search);
/** Where the local lobby is kept: localStorage, or nothing when it's blocked. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
let screens: Menu | undefined;
const BUILD = `${import.meta.env.MODE}-${__BUILD_TIME__}`;
// Only cars and paints that exist: a stale or hand-edited link falls back instead of crashing.
const LAYOUT_KEYS = Object.keys(LAYOUTS);
const DEFAULT_LAYOUT = 'downtown/downtown';
const known = { cars: CLASSES.map((c) => c.id), paints: PAINTS.length, layouts: LAYOUT_KEYS };
const setup: RaceSetup | null = readSetup(params, DEFAULT_LAYOUT, known);
// No setup yet: attract mode, a hard AI race on Downtown behind the menu.
const attract = !setup;
/** Your lobby, in this browser. */
const local = new LocalBackend(storage());
/** Your plate: your name on your car, in lobbies and in the results. */
const plate = loadPlate(storage());
/** Online lobbies: GameRelay rooms, when the build has a key (VITE_GAMERELAY_KEY; .env.development has the local server's). */
const relayKey = import.meta.env.VITE_GAMERELAY_KEY;
const online = relayKey
  ? new RelayBackend(() => GameRelay.connect({ publicKey: relayKey, playerName: plate, lan: { direct: 'party' }, ...(import.meta.env.VITE_GAMERELAY_URL ? { url: import.meta.env.VITE_GAMERELAY_URL } : {}) }) as Promise<RelayLike>)
  : null;
const lobbies = new Lobbies(local, online);
// Behind a lobby, its map runs.
const lobbyMap = params.get('lobby') ? local.peek(params.get('lobby')!)?.options.map : undefined;
const run: RaceSetup = setup ?? { mode: 'race', map: resolveLayout(params.get('map') ?? lobbyMap, LAYOUT_KEYS) ?? DEFAULT_LAYOUT, car: 'coupe', paint: 0, seats: 'hnehnehn', laps: 3, weather: 'random', time: 'day', mayhem: 'normal', traffic: true, seed: Math.floor(Math.random() * 1e9) };
let layoutKey = resolveLayout(run.map, LAYOUT_KEYS) ?? DEFAULT_LAYOUT;

let layout: TrackLayout = structuredClone(LAYOUTS[layoutKey] ?? Object.values(LAYOUTS)[0]);
const mapOf = (key: string) => MAPS.find((m) => key.startsWith(m.id + '/')) ?? MAPS[0];
let map = mapOf(layoutKey);

/**
 * An online race: the others drive their own cars (net/cars.ts), and the lights go green together.
 * A race of your own from an online lobby (Race again) isn't one: it only keeps your seat.
 */
const onlineRace = !!(run.mode === 'race' && run.lobby && run.lobby !== LOCAL_ID && online && (run.others || run.at) && run.seats.includes('p'));
const sim = new Sim(bakeTrack(layout, SURFACES), CLASSES, SURFACES, {
  seed: run.seed,
  // Your wreck slows the world only when it's yours alone: online the others don't slow down.
  slowmo: onlineRace ? 'wreck' : 'world',
  weather: run.weather,
  weatherAllowed: map.weather,
  mayhem: run.mayhem,
  traffic: run.traffic ? 1 : 0,
});
// The seats become the cars, in grid order; behind the menu, eight AIs of every skill.
const { specs, names, me: you, remote, rivals: aiSeats } = roster(run.seats, CLASSES.map((c) => c.id), PAINTS.length, { ...run, plate }, run.others);
for (const s of specs) sim.addCar(s);
/** The car the HUD, telemetry and the debug readout follow: yours, or the attract race's first. */
const me = Math.max(0, you);
// Online, the countdown holds until the connection says when green is (`run.at`, the server's clock).
if (run.mode === 'race') sim.startRace(run.laps, attract ? 1 : onlineRace ? 30 : 4);
/** Online (net/online.ts): the lobby's room, the net layers around each step, and after the race the vote. */
const live = onlineRace
  ? new OnlineRace({
      lobbies,
      online: online!,
      run: run as RaceSetup & { lobby: string },
      sim,
      me,
      remote,
      aiSeats,
      // In: the race steps on the relay's tick, so it goes on in a hidden tab (you might be the host).
      onTick: (tick) => stepper.useTick(tick, () => !editorOpen),
    })
  : null;
// A race of your own from an online lobby: the page still stays in its room, so your seat is still yours after it.
if (!onlineRace && run.lobby && run.lobby !== LOCAL_ID && online) void online.get(run.lobby).catch(() => null);

const input = new Input();
const renderer = new GameRenderer(document.getElementById('stage')!, new GreyboxSkin(), sim, PAINTS, paletteFor(map, run.time, run.seed), {
  post: params.get('post') !== '0',
  outline: params.get('ink') !== '0',
  // Every car's plate says its driver's name, over the map's region.
  plates: names.map((text) => ({ text, region: map.name, map: map.id })),
});
const hud = new Hud(sim);
// The page's soundtrack: the title's behind the menus; in a race, the map's own track and the two
// for any map, never the one the last race played first (`?music=0`: the synth's).
const playlist = params.get('music') === '0' ? null : playlistFor(map.id, attract);
const LAST_TRACK = 'racecar.lastTrack';
const track = playlist
  ? new Soundtrack(playlist, import.meta.env.VITE_MUSIC_URL ?? `${import.meta.env.BASE_URL}music/`, {
      last: (() => {
        try {
          return localStorage.getItem(LAST_TRACK);
        } catch {
          return null;
        }
      })(),
      remember: (t) => {
        if (t === 'title') return;
        try {
          localStorage.setItem(LAST_TRACK, t);
        } catch {
          // Blocked storage: the next race may start on this one.
        }
      },
    })
  : null;
const audio = new GameAudio(sim, track, attract);
const raceUi = new RaceUi(sim, CLASSES, names, specs.map((x) => PAINTS[(x.paint ?? 0) % PAINTS.length].color));
raceUi.onAgain = () => raceAgain(run);
raceUi.onSetup = () => backToSetup(run);
if (run.lobby) raceUi.setupLabel = 'Back to lobby';
// Nor raced again: the next race is the lobby's.
raceUi.canAgain = !onlineRace;

// After an online race: the lobby's results, the vote on the next map, and on into the next race.
live?.results(raceUi, MAPS);
// The camera, HUD, results and audio follow your car, whichever seat it's in.
if (you >= 0) {
  renderer.focus = hud.focus = raceUi.focus = me;
  renderer.snapCamera();
}
// Behind the menu there are no results; with the pause menu up they wait.
raceUi.resultsOn = !attract;
raceUi.canShow = () => !paused;
// Quit to the main menu from anywhere in a race. Not focusable, so Space (boost) can't press it.
document.body.insertAdjacentHTML('beforeend', '<button id="quit" tabindex="-1" title="Quit to the main menu">✕ Menu</button>');
document.getElementById('quit')!.onclick = () => backToSetup(run);
/** The weather the race behind the menu was last given (a lobby's own, once one is up). */
let weatherShown = run.weather;
/** And its time of day. */
let timeShown = run.time;
if (attract) {
  document.body.classList.add('attract');
  // Back from a race (Main menu, Change setup): its choices are the defaults.
  screens = new Menu(lobbies, { maps: MAPS, layouts: LAYOUTS, classes: CLASSES, paints: PAINTS }, readChoices(params, layoutKey, known), plate, storage());
  screens.onPreview = preview;
  screens.online = !!online;
  screens.offline = () => lobbies.offline;
  // A short link sends players here with `?join=<link>` (net: GameRelay's short links); an
  // older invite has `?lobby=<code>`.
  const join = params.get('join');
  void (join ? screens.openLink(join) : screens.open(params.get('lobby')));
}

/** Behind the lobby: its map and weather, and your car on the table; off the lobby, just the race. */
function preview(p: Preview | null): void {
  if (p) {
    const key = resolveLayout(p.map, LAYOUT_KEYS);
    if (key && key !== layoutKey) swapMap(key, p.weather, previewTime(p.time));
    else {
      if (p.weather !== weatherShown) sim.setWeather(p.weather, map.weather);
      if (previewTime(p.time) !== timeShown) renderer.setMap(paletteFor(map, previewTime(p.time), run.seed));
    }
    weatherShown = p.weather;
    timeShown = previewTime(p.time);
  }
  const car = p?.car && CLASSES.find((c) => c.id === p.car!.car);
  if (!p?.car || !car) return renderer.showroom.hide();
  renderer.showroom.show(car, PAINTS[p.car.paint % PAINTS.length], { text: p.car.plate, region: map.name, map: map.id });
}

/**
 * The time the lobby shows behind it: Random shows the day, since the race's own seed (which
 * picks it) isn't known until the race starts; showing this race's pick would be a guess.
 */
function previewTime(time: RaceSetup['time']): RaceSetup['time'] {
  return time === 'random' ? 'day' : time;
}

/** Another map behind the menu, in place (no reload): its track, weather and sky, and the race on it from the grid. */
function swapMap(key: string, weather: RaceSetup['weather'], time: RaceSetup['time']): void {
  layoutKey = key;
  map = mapOf(key);
  layout = structuredClone(LAYOUTS[key]);
  sim.setTrack(bakeTrack(layout, SURFACES));
  sim.setWeather(weather, map.weather);
  sim.startRace(run.laps, 1);
  renderer.setMap(paletteFor(map, time, run.seed));
  // The plates say the new map's region.
  renderer.setPlates(names.map((text) => ({ text, region: map.name, map: map.id })));
  renderer.snapCamera();
  raceUi.buildMap();
}
const telemetry = new Telemetry(sim, specs, () => layout, BUILD, { enabled: import.meta.env.DEV, trace: params.get('trace') === '1' });
// Dev builds write local files; playtest builds with a PostHog key send there (unless opted out).
if (!import.meta.env.DEV || params.get('posthog') === '1') {
  if (posthogEnabled()) {
    telemetry.enabled = true;
    telemetry.sink = posthogSink(telemetry.session, BUILD);
  }
}
telemetry.start(input.lastDevice);
window.addEventListener('error', (e) => telemetry.error(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => telemetry.error(e.reason));
window.addEventListener('resize', () => renderer.resize());

const controls: Controls = neutralControls();
const inputs: (Controls | undefined)[] = [];
if (!attract) inputs[me] = controls;
const steer: number[] = [];
const braking: boolean[] = [];
let paused = false;
let lastSwitch = 0;
let editorOpen = false;
let last = performance.now();

// The car you drive; none in attract mode, where car 0 (the camera's) is an AI.
const human = attract ? -1 : me;

// ---- rumble for your car's moments ----
let rumbleCursor = 0;
function rumble(): void {
  rumbleCursor = sim.events.read(rumbleCursor, (e) => {
    if (human < 0 || (e.car !== human && e.other !== human)) return;
    if (e.type === Ev.WallHit) input.rumble(Math.min(1, e.a / 20), 0.3, 120);
    else if (e.type === Ev.CarContact) input.rumble(Math.min(1, e.a / 15), 0.5, 140);
    else if (e.type === Ev.Wreck) input.rumble(1, 1, 450);
    else if (e.type === Ev.Land && e.a > 0.4) input.rumble(0.5, 0.2, 120);
    else if (e.type === Ev.MiniTurbo) input.rumble(0.2, 0.6 + e.b * 0.1, 200 + e.b * 100);
    else if (e.type === Ev.DriftBoost && e.car === human) input.rumble(0.15, 0.5, 160);
  });
}

// ---- the loop ----
/** One fixed step: the others' cars and the AIs in place, the sim, then yours (and the host's AIs) out. */
function stepOnce(): void {
  telemetry.beforeStep(inputs);
  const t0 = performance.now();
  live?.beforeStep();
  sim.step(inputs);
  live?.afterStep();
  telemetry.afterStep(me, performance.now() - t0);
}

const stepper = new Stepper(TICK_RATE, stepOnce);
/** A gap in frames this long (ms) is a tab coming back, not a slow frame. */
const CATCH_UP_MS = 250;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const gap = now - last;
  const dt = Math.min(gap / 1000, 0.1);
  last = now;
  // Back to a tab whose online race went on without frames (net/stepper.ts): what happened
  // meanwhile isn't played all at once (sounds, sparks, pop-ups, rumble), and the cars are drawn
  // as they are now. Telemetry reads by the step, so it has it all.
  if (stepper.ticking && gap > CATCH_UP_MS) {
    sim.events.skip();
    renderer.catchUp();
  }
  // A menu up: arrows and the pad move focus there (and Start still works while paused).
  input.menuOpen = !!openMenu();
  if (paused) input.pollMenu();
  hud.setDevice(input.lastDevice);
  // An online race doesn't stop for your pause menu: the others are still driving (yours coasts).
  const stepping = (!paused || onlineRace) && !editorOpen;
  if (stepping) {
    if (paused) Object.assign(controls, neutralControls());
    else input.poll(controls, dt);
    renderer.lookBack = human >= 0 && controls.lookBack;
  }
  // The frame loop's steps (on the relay's tick once an online race is in: net/stepper.ts).
  const alpha = stepper.frame(dt, stepping);
  for (let i = 0; i < sim.cars.count; i++) {
    steer[i] = i === human ? controls.steer : sim.controls[i].steer;
    braking[i] = i === human ? controls.brake > 0 : sim.controls[i].brake > 0;
  }
  // Silent while paused or in the editor.
  audio.update(dt, { focus: renderer.focus, camera: renderer.camera, paused: paused || editorOpen, menu: attract });
  if (!editorOpen) {
    renderer.paused = paused;
    // The turntable goes where the lobby leaves room for it.
    const stage = renderer.showroom.visible ? document.querySelector<HTMLElement>('#menu .stage') : null;
    if (stage) renderer.showroom.frame(stage.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    renderer.frame(alpha, dt, steer, braking);
    if (attract) {
      // Follow whoever leads.
      let lead = 0;
      for (let i = 1; i < sim.cars.count; i++) if (sim.cars.progress[i] > sim.cars.progress[lead]) lead = i;
      if (lead !== renderer.focus && performance.now() - lastSwitch > 6000) {
        renderer.focus = hud.focus = raceUi.focus = lead;
        renderer.snapCamera();
        lastSwitch = performance.now();
      }
    }
    hud.update();
    raceUi.update();
    rumble();
    if (hud.debugOn) hud.debugText = `fps ${renderer.fps.toFixed(0)}  draws ${renderer.drawCalls}\ntick ${sim.tick}  scale ${sim.timeScale.toFixed(2)}\ns ${sim.cars.s[me].toFixed(1)} lat ${sim.cars.lateral[me].toFixed(2)} spline ${sim.cars.spline[me]}\nslip ${sim.cars.slip[me].toFixed(2)} charge ${sim.cars.driftCharge[me].toFixed(2)}\nsurface ${SURFACES[sim.cars.surface[me]]?.id}  input ${input.lastDevice}\nlayout ${sim.track.layout.id} ${sim.track.version}  ${(sim.track.main.length / 1000).toFixed(2)} km`;
    telemetry.frame(dt * 1000, renderer.fps, renderer.drawCalls);
  }
}
requestAnimationFrame(frame);

/** The menu on screen, if any: the F8 form, the pause menu, results, or the title and lobbies. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#reportForm, #pause.on, #results.on, #menu');
}

// Switching away mid-race pauses it (not behind the menu, not once you're in the results). Not
// online: the race goes on without you, and the menu would only be in the way when you're back.
const awayPause = () => {
  // Online the race steps on in a hidden tab (net/stepper.ts): no frames poll your keys there, so
  // your car coasts, as behind the menu.
  if (onlineRace) Object.assign(controls, neutralControls());
  if (!attract && !onlineRace && !editorOpen && !paused && !raceUi.shown) setPaused(true);
};
window.addEventListener('blur', awayPause);
document.addEventListener('visibilitychange', () => document.hidden && awayPause());

// ---- system keys ----
input.on((a) => {
  const menu = openMenu();
  if (a.startsWith('nav-') || a.startsWith('pick-')) {
    const dir = a.slice(a.indexOf('-') + 1) as 'up' | 'down' | 'left' | 'right';
    // A pick is the lobby's car and paint when you have a seat there; otherwise it moves focus.
    if (menu && !(a.startsWith('pick-') && menu.id === 'menu' && screens?.pick(dir))) navigate(menu, dir);
    return;
  }
  if (a === 'accept') return void (menu && accept(menu));
  // The F8 form owns the controls while it's up: back closes it, nothing else gets through.
  if (closeReport) return void (a === 'back' && closeReport());
  if (a === 'back') return void (paused ? setPaused(false) : screens?.back());
  // Behind the menu there's nothing to pause: Esc and Start go back a screen.
  if (a === 'pause' && attract) screens?.back();
  else if (a === 'pause' && !editorOpen) setPaused(!paused);
  else if (a === 'report') openReport();
  else if (a === 'debug') {
    renderer.debug = hud.toggleDebug();
  } else if (a === 'editor' && import.meta.env.DEV) toggleEditor();
  else if (a === 'tuning' && import.meta.env.DEV) import('./editor/tuning').then((m) => m.toggleTuning(TUNING));
  else if (a === 'ink') renderer.opts.outline = !renderer.opts.outline;
  else if (a === 'mute') toast(audio.toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
  else if (a === 'music') toast(audio.toggleMusic() ? 'Music on (N)' : 'Music off (N)');
});

function setPaused(on: boolean): void {
  // Nothing to pause behind the menu, and the results screen has its own buttons.
  if (attract || (on && raceUi.shown)) return;
  paused = on;
  let el = document.getElementById('pause');
  if (!el) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="pause"><div class="card"><h1>${onlineRace ? 'Menu' : 'Paused'}</h1>${onlineRace ? '<p class="muted">The race goes on without you: your car coasts until you resume.</p>' : ''}
        <dl><dt>Drive</dt><dd>WASD / arrows, or a gamepad (RT, LT, stick)</dd><dt>Drift</dt><dd>hold Shift (RB) while steering: steer in to tighten, out to widen: a quicker way round a corner</dd><dt>Boost</dt><dd>Space (A): fills from air, near misses, the oncoming lane in traffic, checking traffic and takedowns</dd><dt>Takedowns</dt><dd>ram a rival hard, boost into them, or shove them into a wall, a pillar or traffic</dd><dt>Traffic</dt><dd>boost into the back of a small car to check it out of the way; don't hit anything head on</dd><dt>Start</dt><dd>hit the throttle just before GO for a perfect start; too early and you stall</dd><dt>Sound</dt><dd>M mutes everything, N toggles the music</dd><dt>Felt wrong?</dt><dd>F8 (Select+Start) saves the last 30 s with a note</dd></dl>
        <p class="keys" id="keys">${hud.keys}</p>
        <button id="pResume">Resume</button>${onlineRace ? '' : '<button id="pRestart">Restart</button>'}<button id="pSetup" class="ghost">${run.lobby ? 'Back to lobby' : 'Main menu'}</button></div></div>`,
    );
    el = document.getElementById('pause')!;
    document.getElementById('pResume')!.onclick = () => setPaused(false);
    // A race everyone's in can't be restarted for one of them.
    const again = document.getElementById('pRestart');
    if (again) again.onclick = () => restart(run);
    document.getElementById('pSetup')!.onclick = () => backToSetup(run);
  }
  el.classList.toggle('on', on);
  if (on) (document.getElementById('pResume') as HTMLButtonElement).focus();
}

// ---- F8: something felt wrong ----
/** Closes the F8 form, while it's open. */
let closeReport: (() => void) | null = null;

function openReport(): void {
  if (closeReport) return;
  const wasPaused = paused;
  paused = true;
  input.suspended = true;
  const wrap = document.createElement('div');
  wrap.id = 'reportForm';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:rgba(13,6,32,.6)';
  wrap.innerHTML = `<form class="card"><h1 style="font-size:32px">Felt wrong?</h1><p style="color:var(--muted);margin:0 0 10px">Saves the last 30 seconds (your inputs, the state, events) so it can be replayed exactly.</p>
    <input name="note" autocomplete="off" data-1p-ignore data-lpignore="true" placeholder="what happened? e.g. drift snapped out on the hairpin" style="margin:0 0 16px">
    <button type="submit">Save</button><button type="button" id="rCancel" class="ghost">Cancel</button></form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form')!;
  const field = form.querySelector('input')!;
  field.focus();
  const close = () => {
    wrap.remove();
    closeReport = null;
    input.suspended = false;
    paused = wasPaused;
    last = performance.now();
  };
  closeReport = close;
  (wrap.querySelector('#rCancel') as HTMLButtonElement).onclick = close;
  // Keys are the form's while it's up (input is suspended), so Esc closes it here.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const report = telemetry.report(field.value, me);
    telemetry.flush();
    close();
    try {
      const res = await fetch('/__report', { method: 'POST', body: JSON.stringify(report) });
      const { file } = await res.json();
      toast(`Saved ${file}`);
    } catch {
      toast('Could not save the report (dev server only for now)');
    }
  };
}

/** A note at the top of the screen for 3 s; a new one replaces the last rather than stacking on it. */
let toastEl: HTMLElement | null = null;
let toastTimer = 0;
function toast(text: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
  }
  toastEl.textContent = text;
  document.body.appendChild(toastEl);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.remove(), 3000);
}

// ---- the editor (dev builds) ----
async function toggleEditor(): Promise<void> {
  const { Editor } = await import('./editor/editor');
  editor ??= new Editor({
    layout: () => layout,
    layoutPath: () => `maps/${layoutKey}.track.json`,
    apply: (next) => applyLayout(next),
    drive: (spline, s, lateral) => {
      sim.placeCar(me, spline, s, lateral, 0);
      renderer.snapCamera();
      toggleEditor();
    },
    car: () => ({ x: sim.cars.x[me], z: sim.cars.z[me], h: sim.cars.h[me] }),
    close: () => void toggleEditor(),
    surfaces: SURFACES,
    classes: CLASSES,
    input,
  });
  editorOpen = !editorOpen;
  editor.setOpen(editorOpen);
  last = performance.now();
}
let editor: import('./editor/editor').Editor | undefined;

function applyLayout(next: TrackLayout): void {
  layout = next;
  sim.setTrack(bakeTrack(layout, SURFACES));
  renderer.setTrack();
  raceUi.buildMap();
}

// Layout files edited elsewhere (or saved by the editor) hot-reload without losing the car.
if (import.meta.hot) {
  import.meta.hot.accept('./content', (mod) => {
    const next = mod?.LAYOUTS[layoutKey] as TrackLayout | undefined;
    if (next && JSON.stringify(next) !== JSON.stringify(layout)) applyLayout(structuredClone(next));
  });
}

// Dev hook: drive the game from the console or a test harness, even in a background tab where
// requestAnimationFrame doesn't run. __rc.advance(3, { throttle: 1, steer: -0.5 }) steps 3 s of
// sim with those controls and renders one frame.
if (import.meta.env.DEV) {
  (window as unknown as { __rc: unknown }).__rc = {
    sim,
    renderer,
    telemetry,
    audio,
    input,
    advance(seconds: number, c: Partial<Controls> = {}) {
      Object.assign(controls, c);
      for (let k = 0; k < Math.round(seconds * TICK_RATE); k++) stepOnce();
      renderer.snapCamera();
      for (let k = 0; k < 30; k++) renderer.frame(1, 1 / 60, steer, braking);
      hud.update();
      raceUi.update();
      telemetry.frame(16, renderer.fps, renderer.drawCalls);
      telemetry.flush();
      const i = me;
      return { tick: sim.tick, speedKmh: Math.round(Math.hypot(sim.cars.vx[i], sim.cars.vz[i]) * 3.6), s: Math.round(sim.cars.s[i]), lateral: +sim.cars.lateral[i].toFixed(2), wreck: sim.cars.wreck[i], drift: sim.cars.drift[i], stage: sim.cars.driftStage[i], draws: renderer.drawCalls };
    },
    toggleEditor,
    /** The online race's net layer, once connected. */
    get net() {
      return live?.layers?.cars ?? null;
    },
  };
}
