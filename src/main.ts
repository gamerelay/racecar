// The single-player game (milestone 2): a setup menu over a live AI race (attract mode), then a
// race against AI with traffic, hazards and weather, or free drive. The editor (` key, dev
// builds), local telemetry and the F8 report as in milestone 1.
//
// URL: the setup (see ui/setup.ts: mode, map, car, paint, opponents, difficulty, laps, weather,
// mayhem, traffic, seed) plus &post=0 &ink=0 &trace=1.

import './ui/hud.css';
import { TUNING } from './core/car/tuning';
import type { TrackLayout } from './core/content';
import { neutralControls, type Controls } from './core/controls';
import { Ev } from './core/events';
import { Sim, TICK_RATE, type CarSpec } from './core/sim';
import { bakeTrack } from './core/track/bake';
import { Input } from './input/input';
import { GameRenderer } from './render/renderer';
import { GreyboxSkin } from './render/skins/greybox';
import { posthogEnabled, posthogSink } from './telemetry/posthog';
import { Telemetry } from './telemetry/telemetry';
import { Hud } from './ui/hud';
import { RaceUi } from './ui/race';
import { backToSetup, raceAgain, readSetup, showSetup, type RaceSetup } from './ui/setup';
import { CLASSES, LAYOUTS, MAPS, PAINTS, SURFACES } from './content';

const params = new URLSearchParams(location.search);
const BUILD = `${import.meta.env.MODE}-${__BUILD_TIME__}`;
const setup: RaceSetup | null = readSetup(params, 'city/downtown');
// No setup yet: attract mode, a hard AI race on City behind the menu.
const attract = !setup;
const run: RaceSetup = setup ?? { mode: 'race', map: params.get('map') ?? 'city/downtown', car: 'coupe', paint: 0, opponents: 7, difficulty: 2, laps: 3, weather: 'random', mayhem: 'normal', traffic: true, seed: Math.floor(Math.random() * 1e9) };
const layoutKey = LAYOUTS[run.map] ? run.map : 'city/downtown';

let layout: TrackLayout = structuredClone(LAYOUTS[layoutKey] ?? Object.values(LAYOUTS)[0]);
const map = MAPS.find((m) => layoutKey.startsWith(m.id + '/')) ?? MAPS[0];

const sim = new Sim(bakeTrack(layout, SURFACES), CLASSES, SURFACES, {
  seed: run.seed,
  slowmo: 'world',
  weather: run.weather,
  weatherAllowed: map.weather,
  mayhem: run.mayhem,
  traffic: run.traffic ? 1 : 0,
});
const AI_NAMES = ['Nova', 'Rook', 'Vex', 'Juno', 'Blitz', 'Kai', 'Mako', 'Ziggy'];
const specs: CarSpec[] = [];
const names: string[] = [];
if (!attract) {
  specs.push({ cls: run.car, paint: run.paint, human: true });
  names.push('You');
}
const rivals = attract ? 8 : run.mode === 'free' ? 3 : run.opponents;
for (let k = 0; k < rivals; k++) {
  specs.push({ cls: CLASSES[(k + 1) % CLASSES.length].id, paint: (run.paint + k + 1) % PAINTS.length, racer: { difficulty: attract ? ((k % 3) as 0 | 1 | 2) : run.difficulty } });
  names.push(AI_NAMES[k]);
}
for (const s of specs) sim.addCar(s);
const me = 0;
if (run.mode === 'race') sim.startRace(run.laps, attract ? 1 : 4);

const input = new Input();
const renderer = new GameRenderer(document.getElementById('stage')!, new GreyboxSkin(), sim, PAINTS, map.palette, { post: params.get('post') !== '0', outline: params.get('ink') !== '0' });
const hud = new Hud(sim);
const raceUi = new RaceUi(sim, CLASSES, names, specs.map((x) => PAINTS[(x.paint ?? 0) % PAINTS.length].color));
raceUi.onAgain = () => raceAgain(run);
raceUi.onSetup = () => backToSetup(run);
if (attract) {
  document.body.classList.add('attract');
  showSetup(MAPS, Object.keys(LAYOUTS), CLASSES, PAINTS, { map: layoutKey });
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
const inputs: (Controls | undefined)[] = attract ? [] : [controls];
const steer: number[] = [];
const braking: boolean[] = [];
let paused = false;
let lastSwitch = 0;
let editorOpen = false;
let acc = 0;
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
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!paused && !editorOpen) {
    input.poll(controls, dt);
    renderer.lookBack = human >= 0 && controls.lookBack;
    acc += dt;
    let steps = 0;
    while (acc >= 1 / TICK_RATE && steps < 5) {
      telemetry.beforeStep(inputs);
      const t0 = performance.now();
      sim.step(inputs);
      telemetry.afterStep(me, performance.now() - t0);
      acc -= 1 / TICK_RATE;
      steps++;
    }
    if (steps === 5) acc = 0;
  }
  for (let i = 0; i < sim.cars.count; i++) {
    steer[i] = i === human ? controls.steer : sim.controls[i].steer;
    braking[i] = i === human ? controls.brake > 0 : sim.controls[i].brake > 0;
  }
  if (!editorOpen) {
    renderer.frame(acc * TICK_RATE, dt, steer, braking);
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
    hud.debugText = `fps ${renderer.fps.toFixed(0)}  draws ${renderer.drawCalls}\ntick ${sim.tick}  scale ${sim.timeScale.toFixed(2)}\ns ${sim.cars.s[me].toFixed(1)} lat ${sim.cars.lateral[me].toFixed(2)} spline ${sim.cars.spline[me]}\nslip ${sim.cars.slip[me].toFixed(2)} charge ${sim.cars.driftCharge[me].toFixed(2)}\nsurface ${SURFACES[sim.cars.surface[me]]?.id}  input ${input.lastDevice}\nlayout ${sim.track.layout.id} ${sim.track.version}  ${(sim.track.main.length / 1000).toFixed(2)} km`;
    telemetry.frame(dt * 1000, renderer.fps, renderer.drawCalls, me);
  }
}
requestAnimationFrame(frame);

// ---- system keys ----
input.on((a) => {
  if (a === 'pause' && !editorOpen) setPaused(!paused);
  else if (a === 'report') openReport();
  else if (a === 'debug') {
    renderer.debug = hud.toggleDebug();
  } else if (a === 'editor' && import.meta.env.DEV) toggleEditor();
  else if (a === 'tuning' && import.meta.env.DEV) import('./editor/tuning').then((m) => m.toggleTuning(TUNING));
  else if (a === 'ink') renderer.opts.outline = !renderer.opts.outline;
});

function setPaused(on: boolean): void {
  if (attract) return;
  paused = on;
  let el = document.getElementById('pause');
  if (!el) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="pause"><div class="card"><h1>Paused</h1>
        <dl><dt>Drive</dt><dd>WASD / arrows, or a gamepad (RT, LT, stick)</dd><dt>Drift</dt><dd>hold Shift (RB) while steering: steer in to tighten, out to widen: a quicker way round a corner</dd><dt>Boost</dt><dd>Space (A): fills from air, near misses, the oncoming lane in traffic, checking traffic and takedowns</dd><dt>Takedowns</dt><dd>ram a rival hard, boost into them, or shove them into a wall, a pillar or traffic</dd><dt>Traffic</dt><dd>boost into the back of a small car to check it out of the way; don't hit anything head on</dd><dt>Start</dt><dd>hit the throttle just before GO for a perfect start; too early and you stall</dd><dt>Felt wrong?</dt><dd>F8 (Select+Start) saves the last 30 s with a note</dd></dl>
        <button id="pResume">Resume</button><button id="pRestart">Restart</button><button id="pSetup" class="ghost">Setup</button></div></div>`,
    );
    el = document.getElementById('pause')!;
    document.getElementById('pResume')!.onclick = () => setPaused(false);
    document.getElementById('pRestart')!.onclick = () => raceAgain(run);
    document.getElementById('pSetup')!.onclick = () => backToSetup(run);
  }
  el.classList.toggle('on', on);
  if (on) (document.getElementById('pResume') as HTMLButtonElement).focus();
}

// ---- F8: something felt wrong ----
function openReport(): void {
  const wasPaused = paused;
  paused = true;
  input.suspended = true;
  const wrap = document.createElement('div');
  wrap.id = 'reportForm';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:rgba(13,6,32,.6)';
  wrap.innerHTML = `<form class="card"><h1 style="font-size:32px">Felt wrong?</h1><p style="color:var(--muted);margin:0 0 10px">Saves the last 30 seconds (your inputs, the state, events) so it can be replayed exactly.</p>
    <input name="note" autocomplete="off" placeholder="what happened? e.g. drift snapped out on the hairpin" style="width:100%;font:16px var(--ui);padding:8px;margin:0 0 12px">
    <button type="submit">Save</button><button type="button" id="rCancel">Cancel</button></form>`;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form')!;
  const field = form.querySelector('input')!;
  field.focus();
  const close = () => {
    wrap.remove();
    input.suspended = false;
    paused = wasPaused;
    last = performance.now();
  };
  (wrap.querySelector('#rCancel') as HTMLButtonElement).onclick = close;
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

export function toast(text: string): void {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
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
    advance(seconds: number, c: Partial<Controls> = {}) {
      Object.assign(controls, c);
      for (let k = 0; k < Math.round(seconds * TICK_RATE); k++) {
        telemetry.beforeStep(inputs);
        sim.step(inputs);
      }
      renderer.snapCamera();
      for (let k = 0; k < 30; k++) renderer.frame(1, 1 / 60, steer, braking);
      hud.update();
      raceUi.update();
      telemetry.frame(16, renderer.fps, renderer.drawCalls, me);
      telemetry.flush();
      const i = me;
      return { tick: sim.tick, speedKmh: Math.round(Math.hypot(sim.cars.vx[i], sim.cars.vz[i]) * 3.6), s: Math.round(sim.cars.s[i]), lateral: +sim.cars.lateral[i].toFixed(2), wreck: sim.cars.wreck[i], drift: sim.cars.drift[i], stage: sim.cars.driftStage[i], draws: renderer.drawCalls };
    },
    toggleEditor,
  };
}
