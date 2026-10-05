// The poster studio: marketing art rendered with the game's own renderer (skin, track, world,
// cars, wrecks, particles, skid marks, post pass and ink). Dev tool, like the garage. Every shot is
// staged on a real track, run forward on a fixed timestep from a seeded Math.random, and frozen at
// a chosen moment, so the same URL always draws the same picture.
//
//   poster.html?shot=og                 one shot, shown in the page (titled if it has a title)
//   poster.html?shot=og&title=0         the clean version
//   poster.html?shot=all&save=1         every shot, clean and titled, written to marketing/
//   poster.html?shot=og&ss=3            supersampling (default 2)
//   poster.html?scout=downtown/downtown&s=240&lat=0   a quick look at a spot on a track
//
// Rendering is on demand (no requestAnimationFrame), so it works in a hidden or headless tab.
// `bun tools/poster.ts` drives headless Chrome through the lot.

import { SHOTS } from './poster-shots';
import { cam, drawTitle, fonts, nativeRandom, offset, render, seedRandom, Stage } from './poster-stage';

/**
 * A contact sheet for finding spots: a car at each `s` (comma separated) on a spline, from a chase
 * camera (`back`, `up`, `side`, `ahead`, `fov`), labelled with s.
 */
function scout(): HTMLCanvasElement {
  const key = q.get('scout')!;
  const stage = new Stage(key, q.get('palette') ?? undefined, Number(q.get('traffic') ?? 0));
  const lat = Number(q.get('lat') ?? 0);
  const spline = Number(q.get('spline') ?? 0);
  const list = (q.get('s') ?? '100').split(',').map(Number);
  const w = Number(q.get('w') ?? (list.length > 1 ? 480 : 1280));
  const h = Number(q.get('h') ?? (list.length > 1 ? 270 : 720));
  const cols = Math.min(list.length, Number(q.get('cols') ?? 4));
  const sheet = document.createElement('canvas');
  sheet.width = w * cols;
  sheet.height = h * Math.ceil(list.length / cols);
  const g = sheet.getContext('2d')!;
  let s = list[0];
  const car = stage.car(q.get('cls') ?? 'coupe', q.get('paint') ?? 'pink', { pose: () => stage.at(s, lat, spline), speed: 0 });
  console.log(`scout ${key}: splines ${stage.track.splines.map((x) => `${x.id}:${x.length.toFixed(0)}`).join(' ')}`);
  list.forEach((si, k) => {
    s = si;
    const p = car.pose(0);
    const c = cam(Number(q.get('fov') ?? 55), offset(p, Number(q.get('side') ?? 0), Number(q.get('up') ?? 3), -Number(q.get('back') ?? 9)), offset(p, 0, 1, Number(q.get('ahead') ?? 20)));
    // At race time `t` (default 0): the world then (a drawbridge up).
    const t0 = Number(q.get('t') ?? 0);
    stage.run(t0, t0 + 1 / 60, c.position);
    const img = render(stage, c, w, h, 1, {});
    g.drawImage(img, (k % cols) * w, Math.floor(k / cols) * h);
    g.font = '700 18px "Chakra Petch"';
    g.fillStyle = '#000';
    g.fillRect((k % cols) * w, Math.floor(k / cols) * h, 110, 26);
    g.fillStyle = '#fff';
    g.fillText(`s ${si}`, (k % cols) * w + 6, Math.floor(k / cols) * h + 19);
  });
  stage.dispose();
  return sheet;
}

// ---------------------------------------------------------------------------------------------
// Page.

const q = new URLSearchParams(location.search);

async function save(name: string, canvas: HTMLCanvasElement, jpg: boolean): Promise<void> {
  const data = jpg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  const file = `${name}.${jpg ? 'jpg' : 'png'}`;
  const r = await fetch('/__poster/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file, data }) });
  if (!r.ok) throw new Error(`save ${file}: ${r.status} ${await r.text()}`);
  console.log(`saved marketing/${file}`);
}

function show(canvas: HTMLCanvasElement): void {
  canvas.style.cssText = 'display:block;max-width:100vw;max-height:100vh;margin:auto;';
  document.body.append(canvas);
}

async function main(): Promise<void> {
  document.body.style.cssText = 'margin:0;background:#0d0620;display:grid;place-items:center;min-height:100vh;gap:12px';
  await fonts();
  const ss = Number(q.get('ss') ?? 2);
  if (q.get('scout')) {
    seedRandom(1);
    show(scout());
    document.title = 'poster:done';
    return;
  }
  const want = q.get('shot') ?? 'og';
  const list = want === 'all' ? SHOTS : SHOTS.filter((s) => want.split(',').includes(s.name));
  if (!list.length) throw new Error(`no shot ${want}; have ${SHOTS.map((s) => s.name).join(', ')}`);
  const saving = q.get('save') === '1' && import.meta.env.DEV;
  for (const shot of list) {
    seedRandom(shot.seed ?? 1);
    const r = shot.build();
    const clean = render(r.stage, r.camera, shot.w, shot.h, ss, r.look ?? {});
    r.stage.dispose();
    Math.random = nativeRandom;
    const jpg = shot.jpg ?? shot.w * shot.h > 1400 * 900;
    const titled = shot.title && q.get('title') !== '0';
    if (saving) {
      if (shot.title) {
        await save(`${shot.name}-clean`, clean, jpg);
        const t = document.createElement('canvas');
        t.width = clean.width;
        t.height = clean.height;
        t.getContext('2d')!.drawImage(clean, 0, 0);
        drawTitle(t, shot.title);
        await save(shot.name, t, jpg);
      } else await save(shot.name, clean, jpg);
    }
    if (titled) drawTitle(clean, shot.title!);
    if (list.length === 1) show(clean);
  }
  document.title = 'poster:done';
}

main().catch((e) => {
  console.error(e);
  document.title = `poster:error ${e}`;
});
