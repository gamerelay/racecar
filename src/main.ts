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
import { Getaway } from './core/rules/getaway';
import { bakeTrack } from './core/track/bake';
import { Input, routedKey } from './input/input';
import { GameRenderer } from './render/renderer';
import { GreyboxSkin } from './render/skins/greybox';
import { posthogBuilt, posthogEnabled, posthogSink, setTelemetryOptOut, telemetryOptedOut } from './telemetry/posthog';
import { Telemetry } from './telemetry/telemetry';
import { GameAudio } from './audio/audio';
import { playlistFor, Soundtrack } from './audio/soundtrack';
import { Hud } from './ui/hud';
import { RaceUi } from './ui/race';
import { accept, navigate } from './ui/nav';
import { installChoosers } from './ui/chooser';
import { installClicks } from './ui/click';
import { fadeIn, ready, veiled } from './ui/fade';
import { KeysCard } from './ui/keys';
import { GETAWAY_MAP, installEmbed, keepEmbed, startsGetaway } from './ui/embed';
import { cycle, leader } from './ui/watch';
import { SettingsPanel } from './ui/settings';
import { ControlsPanel } from './ui/controls';
import { SettingsStore } from './settings';
import { backToSetup, quickRaceSetup, raceAgain, randomCar, readChoices, readSetup, restart, toQuery, type RaceSetup } from './ui/setup';
import { Menu, type Preview } from './ui/menu';
import { GameRelay } from '@gamerelay/sdk';
import { Lobbies, LocalBackend, LOCAL_ID } from './lobby/backend';
import { RelayBackend, type RelayLike } from './lobby/relay';
import { Stepper } from './net/stepper';
import { OnlineRace } from './net/online';
import { roster } from './lobby/lobby';
import { loadPlate } from './lobby/plate';
import { ALL_MAPS, CLASSES, LAYOUTS, MAPS, PAINTS, SURFACES } from './content';
import { paletteFor, resolveLayout } from './core/content';
import { carRow, place, type Spot } from './dev/drive';
import { describeProbe, probe } from './dev/probe';

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
// The page comes up out of the loading screen once it has drawn (every race and menu is a page load: ui/fade.ts).
fadeIn();
installEmbed();
/** Frames drawn: the loading screen lifts after the second (the first compiles the shaders). */
let drawn = 0;
installChoosers();
/** The player's settings (sound, graphics, privacy), on this device. */
const settings = new SettingsStore(storage());
// Analytics turned off before there were settings (racecar.telemetry): still off.
if (telemetryOptedOut() && settings.get().analytics) settings.set({ analytics: false });
const BUILD = `${import.meta.env.MODE}-${__BUILD_TIME__}`;
// Only cars and paints that exist: a stale or hand-edited link falls back instead of crashing.
const LAYOUT_KEYS = Object.keys(LAYOUTS);
const DEFAULT_LAYOUT = 'downtown/downtown';
const known = { cars: CLASSES.map((c) => c.id), paints: PAINTS.length, layouts: LAYOUT_KEYS };
// The X card's first page, and the game's link (`?start=getaway`), are a getaway in a random car and
// paint (ui/embed.ts). This page is that race, and the address becomes its link, so Restart and the
// menu after it work as for any race.
const straightIn = startsGetaway(params) && LAYOUT_KEYS.includes(GETAWAY_MAP) ? quickRaceSetup([GETAWAY_MAP], randomCar(known.cars, PAINTS.length)) : null;
if (straightIn) history.replaceState(null, '', keepEmbed(`?${toQuery(straightIn)}`));
const setup: RaceSetup | null = straightIn ?? readSetup(params, DEFAULT_LAYOUT, known);
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
const mapOf = (key: string) => ALL_MAPS.find((m) => key.startsWith(m.id + '/')) ?? MAPS[0];
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
/**
 * A getaway (docs/CHASE_MODE.md): a race on its map is you and the cops; online (the owner,
 * 2026-10-09), every player's a runner, each with their own cops. The AIs sit it out, and so do
 * other players when it isn't online (a race of your own from an online lobby).
 */
const chaseMap = !!layout.getaway && run.mode === 'race' && !attract && run.seats.includes('p');
const castSeats = chaseMap ? run.seats.replace(onlineRace ? /[^pr]/g : /[^p]/g, 'x') : run.seats;
// The seats become the cars, in grid order; behind the menu, eight AIs of every skill.
const cast = roster(castSeats, CLASSES.map((c) => c.id), PAINTS.length, { ...run, plate }, run.others);
const getaway = chaseMap && cast.me >= 0;
const { specs, names, me: you, remote, rivals: aiSeats } = cast;
for (const s of specs) sim.addCar(s);
/** Its rules, and its cops: added after the runners, their plates the police's. */
const chase = getaway ? new Getaway(sim, specs.map((_, i) => i)) : null;
const colors = specs.map((x) => PAINTS[(x.paint ?? 0) % PAINTS.length].color);
chase?.cops.forEach(() => {
  names.push('PD 911');
  colors.push('#3b6cff');
});
/** The car the HUD, telemetry and the debug readout follow: yours, or the attract race's first. */
const me = Math.max(0, you);
// Online, the countdown holds until the connection says when green is (`run.at`, the server's clock).
if (run.mode === 'race') sim.startRace(run.laps, attract ? 1 : onlineRace ? 30 : 4);
// Dev: ?spawn=<m> starts your car that far along the main road (to test one spot, e.g. the Lava Tube).
const spawn = Number(params.get('spawn') ?? NaN);
if (import.meta.env.DEV && Number.isFinite(spawn) && you >= 0 && !onlineRace) sim.placeCar(me, 0, spawn, 0, 0);
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
  // The settings' graphics, unless the URL turns one off (&post=0, &ink=0).
  post: params.get('post') !== '0' && settings.get().graphics.post,
  outline: params.get('ink') !== '0' && settings.get().graphics.outline,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2) * settings.get().graphics.resolution,
  // Every car's plate says its driver's name, over the map's region.
  plates: names.map((text) => ({ text, region: map.name, map: map.id })),
});
const hud = new Hud(sim);
// The page's soundtrack: the title's behind the menus; in a race, the map's own tracks and the four
// for any map. Never first the one the last page of the same kind played (the menus and the races
// remember theirs apart; `?music=0`: the synth's).
const playlist = params.get('music') === '0' ? null : playlistFor(map.id, attract);
const LAST_TRACK = attract ? 'racecar.lastTitleTrack' : 'racecar.lastTrack';
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
        try {
          localStorage.setItem(LAST_TRACK, t);
        } catch {
          // Blocked storage: the next race may start on this one.
        }
      },
    })
  : null;
const audio = new GameAudio(sim, track, attract);
// The menus' buttons, choosers and sliders click (ui/click.ts).
installClicks((kind) => audio.uiSound(kind));
// The title's music waits for a first key or click where the browser won't start it by itself:
// a hint says so, if it hasn't started a moment in (where it's allowed, it never shows).
if (attract && track) {
  setTimeout(() => {
    if (audio.audible || !audio.settings.music || audio.settings.muted) return;
    const hint = document.createElement('div');
    hint.id = 'soundHint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = matchMedia('(pointer: coarse)').matches ? '♪ Tap for music' : '♪ Press any key for music';
    document.body.appendChild(hint);
    const gone = () => {
      hint.classList.add('out');
      setTimeout(() => hint.remove(), 400);
      window.removeEventListener('keydown', gone);
      window.removeEventListener('pointerup', gone);
    };
    window.addEventListener('keydown', gone);
    window.addEventListener('pointerup', gone);
  }, 1500);
}
// The frame rate, top left, when Settings → Show FPS is on.
document.body.insertAdjacentHTML('beforeend', '<div id="fps" aria-hidden="true"></div>');
const fpsEl = document.getElementById('fps')!;
// Settings apply as they change: the volumes, the graphics, analytics.
settings.onChange((s) => {
  audio.setVolumes(s.volume);
  renderer.setQuality({ resolution: s.graphics.resolution, post: params.get('post') !== '0' && s.graphics.post, outline: params.get('ink') !== '0' && s.graphics.outline });
  fpsEl.classList.toggle('on', s.graphics.fps);
  setTelemetryOptOut(!s.analytics);
});
const settingsPanel = new SettingsPanel(settings, posthogBuilt);
const controlsPanel = new ControlsPanel();
const raceUi = new RaceUi(sim, CLASSES, names, colors);
raceUi.onAgain = () => raceAgain(run);
// A getaway's best, on this device: the HUD and the results show it; a longer run keeps its time.
const BEST_KEY = `racecar.getaway.${layoutKey}`;
if (chase && !onlineRace) {
  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    // Blocked storage: no best to beat.
  }
  hud.getawayBest = raceUi.getawayBest = best;
}
/** Whether the run's over and its time's been kept (as it ends: not when its results show, which leaving first skips). */
let getawayKept = false;
function keepGetaway(): void {
  if (!chase?.end || onlineRace || getawayKept) return;
  getawayKept = true;
  try {
    if (chase.time > (Number(localStorage.getItem(BEST_KEY)) || 0)) localStorage.setItem(BEST_KEY, String(chase.time));
  } catch {
    // Blocked storage: the record's for this page only.
  }
}
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
raceUi.you = you;
raceUi.keepsBest = !onlineRace;
/** An online getaway, you out: the camera on another runner, ← / → (or the strip's buttons) to the next. */
function watch(car: number): void {
  if (car < 0 || car === renderer.focus) return;
  renderer.focus = hud.focus = raceUi.focus = car;
  renderer.snapCamera();
}
raceUi.onWatch = (dir) => chase && watch(cycle(chase, renderer.focus, dir));
if (chase && chase.runs.length > 1)
  window.addEventListener('keydown', (e) => {
    if (!raceUi.watching || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    raceUi.onWatch(e.key === 'ArrowRight' ? 1 : -1);
  });
// Behind the menu there are no results; with the pause menu up they wait.
raceUi.resultsOn = !attract;
raceUi.canShow = () => !paused;
// The in-race menu (Resume, Restart, Settings, Quit), from anywhere in a race, as Esc opens it. Not
// focusable, so Space (boost) can't press it.
document.body.insertAdjacentHTML('beforeend', '<button id="quit" tabindex="-1" title="Menu (Esc)">☰ Menu</button>');
document.getElementById('quit')!.onclick = () => setPaused(!paused);
/** The weather the race behind the menu was last given (a lobby's own, once one is up). */
let weatherShown = run.weather;
/** And its time of day. */
let timeShown = run.time;
if (attract) {
  document.body.classList.add('attract');
  // Back from a race (Main menu, Change setup): its choices are the defaults.
  screens = new Menu(lobbies, { maps: MAPS, layouts: LAYOUTS, classes: CLASSES, paints: PAINTS }, readChoices(params, layoutKey, known), plate, storage());
  screens.onPreview = preview;
  screens.onSettings = () => settingsPanel.open(document.getElementById('mSettings'));
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

// ---- the keys card: your first race here shows the keys (ui/keys.ts) ----
// Up once the loading screen has lifted. Offline the race waits for it (the countdown from the
// start, as behind the loading screen); online it doesn't, the others are on the same clock. It's a
// menu while it's up (openMenu): the menu's keys and the pad's buttons put it away through
// input.on, on the press, and go no further. The game's own keys (M, N, F8…) still do their thing.
const keysCard = human >= 0 && KeysCard.due(storage()) ? new KeysCard(storage()) : null;
/** It's been shown (and may still be up). */
let keysShown = false;
if (keysCard) {
  // Any other key puts it away too (Space, Enter, Q…), but not a browser's or the OS's shortcuts.
  const anyKey = (e: KeyboardEvent) => {
    if (!keysCard.isOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.code === 'Tab' || /^F\d+$/.test(e.code) || routedKey(e.code)) return;
    // Not stopped: the game's handler ignores it behind a menu, and the audio's first gesture is in it.
    e.preventDefault();
    keysCard.close();
  };
  window.addEventListener('keydown', anyKey, true);
  keysCard.onClose = () => window.removeEventListener('keydown', anyKey, true);
}
/** Up as the loading screen lifts, a pad's buttons already down then not counting as presses. */
function keysFrame(): void {
  if (!keysCard || keysShown || veiled()) return;
  keysShown = true;
  input.settleButtons();
  keysCard.open();
}

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
  if (paused || keysCard?.isOpen) input.pollMenu();
  // An online race doesn't stop for your pause menu: the others are still driving (yours coasts).
  // Offline, the race waits behind the loading screen, so you see its countdown from the start.
  keysFrame();
  const stepping = (!paused || onlineRace) && !editorOpen && (onlineRace || (!veiled() && !keysCard?.isOpen));
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
  audio.update(dt, { focus: renderer.focus, camera: renderer.camera, paused: paused || editorOpen, menu: attract, indoor: renderer.indoor.amount });
  if (!editorOpen) {
    renderer.paused = paused;
    // The turntable goes where the lobby leaves room for it.
    const stage = renderer.showroom.visible ? document.querySelector<HTMLElement>('#menu .stage') : null;
    if (stage) renderer.showroom.frame(stage.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    renderer.frame(alpha, dt, steer, braking);
    if (++drawn === 2) ready();
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
    // Watching an online getaway: off a runner who's out, on to one still going.
    if (chase && raceUi.watching && chase.runOf(renderer.focus)?.end) watch(leader(chase));
    hud.update();
    raceUi.update();
    keepGetaway();
    rumble();
    if (fpsEl.classList.contains('on') && sim.tick % 15 === 0) fpsEl.textContent = `${renderer.fps.toFixed(0)} fps`;
    if (hud.debugOn) hud.debugText = `fps ${renderer.fps.toFixed(0)}  draws ${renderer.drawCalls}\ntick ${sim.tick}  scale ${sim.timeScale.toFixed(2)}\ns ${sim.cars.s[me].toFixed(1)} lat ${sim.cars.lateral[me].toFixed(2)} spline ${sim.cars.spline[me]}\nslip ${sim.cars.slip[me].toFixed(2)} charge ${sim.cars.driftCharge[me].toFixed(2)}\nsurface ${SURFACES[sim.cars.surface[me]]?.id}  input ${input.lastDevice}\nlayout ${sim.track.layout.id} ${sim.track.version}  ${(sim.track.main.length / 1000).toFixed(2)} km`;
    telemetry.frame(dt * 1000, renderer.fps, renderer.drawCalls);
  }
}
requestAnimationFrame(frame);

/** The menu on screen, if any, topmost first: the F8 form, Settings or Controls, the pause menu, results, or the title and lobbies. */
function openMenu(): HTMLElement | null {
  for (const sel of ['#reportForm', '#settings.on', '#controls.on', '#keys.on', '#pause.on', '#results.on', '#menu']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

// Switching away mid-race pauses it (not behind the menu, not once you're in the results). Not
// online: the race goes on without you, and the menu would only be in the way when you're back.
const awayPause = () => {
  // Online the race steps on in a hidden tab (net/stepper.ts): no frames poll your keys there, so
  // your car coasts, as behind the menu.
  if (onlineRace) Object.assign(controls, neutralControls());
  // Not behind the keys card: the race is held there already, and it'd be a menu under a menu.
  if (!attract && !onlineRace && !editorOpen && !paused && !raceUi.shown && !keysCard?.isOpen) setPaused(true);
};
window.addEventListener('blur', awayPause);
document.addEventListener('visibilitychange', () => document.hidden && awayPause());

// ---- system keys ----
input.on((a) => {
  // The keys card: the menu's keys, A, B and Start put it away (and do nothing else).
  if (keysCard?.isOpen && !closeReport && (a.startsWith('nav-') || a.startsWith('pick-') || a === 'accept' || a === 'back' || a === 'pause')) return keysCard.close();
  const menu = openMenu();
  if (a.startsWith('nav-') || a.startsWith('pick-')) {
    const dir = a.slice(a.indexOf('-') + 1) as 'up' | 'down' | 'left' | 'right';
    // A pick is the lobby's car and paint when you have a seat there; otherwise it moves focus.
    if (menu && !(a.startsWith('pick-') && menu.id === 'menu' && screens?.pick(dir))) navigate(menu, dir);
    return;
  }
  if (a === 'accept') return void (menu && accept(menu));
  // The F8 form owns the controls while it's up (it's over everything): back closes it, nothing else gets through.
  if (closeReport) return void (a === 'back' && closeReport());
  // Settings and Controls are over the menus: back (Esc, B) closes them, to the menu they were opened from.
  if ((a === 'back' || a === 'pause') && settingsPanel.isOpen) return settingsPanel.close();
  if ((a === 'back' || a === 'pause') && controlsPanel.isOpen) return controlsPanel.close();
  if (a === 'back') return void (paused ? setPaused(false) : screens?.back());
  // Behind the menu there's nothing to pause: Esc and Start go back a screen.
  if (a === 'pause' && attract) screens?.back();
  else if (a === 'pause' && !editorOpen) setPaused(!paused);
  else if (a === 'report') openReport();
  else if (a === 'debug') {
    renderer.debug = hud.toggleDebug();
  } else if (a === 'editor' && import.meta.env.DEV) toggleEditor();
  else if (a === 'tuning' && import.meta.env.DEV) import('./editor/tuning').then((m) => m.toggleTuning(TUNING));
  // Through the settings, so the panel agrees and the next change doesn't undo it.
  else if (a === 'ink') settings.set({ graphics: { outline: !settings.get().graphics.outline } });
  else if (a === 'mute') toast(audio.toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
  else if (a === 'music') toast(audio.toggleMusic() ? 'Music on (N)' : 'Music off (N)');
  else if (a === 'track-prev' || a === 'track-next') {
    const name = audio.stepTrack(a === 'track-next' ? 1 : -1);
    if (name) toast(`♪ ${name} (− +)`);
  }
});

function setPaused(on: boolean): void {
  // Nothing to pause behind the menu, and the results screen has its own buttons.
  if (attract || (on && raceUi.shown)) return;
  paused = on;
  if (!on && settingsPanel.isOpen) settingsPanel.close();
  if (!on && controlsPanel.isOpen) controlsPanel.close();
  let el = document.getElementById('pause');
  if (!el) {
    document.body.insertAdjacentHTML(
      'beforeend',
      // The title, what's going on, how to play, then the buttons stacked at the bottom (as the
      // lobby's are). Which key does what is on the Controls screen.
      `<div id="pause"><div class="card pauseCard"><h1>${onlineRace ? 'Menu' : 'Paused'}</h1>${onlineRace ? '<p class="muted">The race goes on without you: your car coasts until you resume.</p>' : ''}
        <h2>How to play</h2>
        <dl><dt>Drift</dt><dd>steer in to tighten, out to widen: a quicker way round a corner</dd><dt>Boost</dt><dd>fills from air, near misses, the oncoming lane in traffic, checking traffic and takedowns</dd><dt>Takedowns</dt><dd>ram a rival hard, boost into them, or shove them into a wall, a pillar or traffic</dd><dt>Traffic</dt><dd>boost into the back of a small car to check it out of the way; don't hit anything head on</dd><dt>Top speed</dt><dd>hold it flat out and clean on a straight and it keeps climbing (Overdrive); tuck in behind a rival for their slipstream, then pull out to pass for a slingshot</dd><dt>Start</dt><dd>hit the throttle just before GO for a perfect start; too early and you stall</dd></dl>
        <div class="row stack"><button id="pResume">Resume</button>${onlineRace ? '' : '<button id="pRestart" class="ghost">Restart</button>'}<button id="pSettings" class="ghost">Settings</button><button id="pControls" class="ghost">Controls</button><button id="pSetup" class="ghost danger">${run.lobby ? 'Back to lobby' : 'Quit'}</button></div></div></div>`,
    );
    el = document.getElementById('pause')!;
    document.getElementById('pResume')!.onclick = () => setPaused(false);
    document.getElementById('pSettings')!.onclick = () => settingsPanel.open(document.getElementById('pSettings'));
    document.getElementById('pControls')!.onclick = () => controlsPanel.open(document.getElementById('pControls'));
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
    // A released build has no dev server to save it: it's a download, to attach to a bug report
    // (`bun tools/replay.ts <file>` plays it back).
    if (!import.meta.env.DEV) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }));
      a.download = `racecar-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Saved ${a.download}`);
      return;
    }
    try {
      const res = await fetch('/__report', { method: 'POST', body: JSON.stringify(report) });
      const { file } = await res.json();
      toast(`Saved ${file}`);
    } catch {
      toast('Could not save the report');
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
    /**
     * Caldera's dev helpers (docs/CALDERA.md, src/dev/), the same ones the tools use. `step` moves
     * one tick at a time and renders each, so the camera's smoothing sees what a player's would
     * (`advance` renders 30 frames per call). Everything works in a background tab.
     *   __rc.dev.place({ road: 'lava-tube', s: 200 }, 170); __rc.dev.step(60, { throttle: 1 }); __rc.dev.shot()
     */
    dev: {
      place: (spot: Spot, kmh = 0) => (place(sim, me, spot, kmh), renderer.snapCamera(), carRow(sim, me)),
      probe: (x: number, z: number, y?: number) => describeProbe(probe(sim.track, x, z, y)),
      state: () => carRow(sim, me),
      step(ticks = 1, c: Partial<Controls> = {}) {
        Object.assign(controls, neutralControls(), c);
        for (let k = 0; k < ticks; k++) {
          stepOnce();
          for (let i = 0; i < sim.cars.count; i++) {
            steer[i] = i === human ? controls.steer : sim.controls[i].steer;
            braking[i] = i === human ? controls.brake > 0 : sim.controls[i].brake > 0;
          }
          renderer.frame(1, 1 / TICK_RATE, steer, braking);
        }
        hud.update();
        return carRow(sim, me);
      },
      /** The picture as it is now, as a PNG data URL. */
      shot: () => (renderer.frame(1, 0, steer, braking), renderer.renderer.domElement.toDataURL('image/png')),
    },
    /** The online race's net layer, once connected. */
    get net() {
      return live?.layers?.cars ?? null;
    },
  };
}
