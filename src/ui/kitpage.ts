// The UI kit on one page (kit.html, dev only): every part in its states, to check against the
// designs. P switches the hints between keyboard and pad.

import './kit.css';
import { chooser, installChoosers } from './chooser';
import { accept, navigate } from './nav';
import { button, driverChip, fill, field, GEAR, header, hints, installKit, menuItem, plate, row, segmented, showDevice, slider, stat, tag, toggle } from './kit';

installKit();
installChoosers();
document.documentElement.style.background = '#0e0b1a';
document.body.style.cssText = 'margin:0;background:#0e0b1a;overflow:auto';

const swatches = ['#ff2e88', '#35f0ff', '#ffd23f', '#7cff6b', '#b26bff', '#ff6a00', '#d8dde6', '#1d2340']
  .map((c, k) => `<button class="k-swatch${k === 6 ? ' on' : ''}" style="--c:${c};--c2:${c}" aria-label="paint ${k}"></button>`)
  .join('');

document.body.innerHTML = `<main class="k" style="padding:6rem 9.6rem;display:grid;gap:5.6rem">
  ${header('UI kit', tag('Private', 'outline'), driverChip('RACECAR'))}
  <section style="display:grid;grid-template-columns:64rem 1fr;gap:6rem;align-items:start">
    <div class="k-menu">
      ${menuItem('a', 'Quick race', 'You + 7 bots on a random track. Go in 3 seconds.')}
      ${menuItem('b', 'Single player', 'Your own lobby: pick the track, the laps and the bots.')}
      ${menuItem('c', 'Multiplayer', 'Join a lobby online, or make one and send the link.')}
      ${menuItem('d', 'Back to lobby', '', true)}
    </div>
    <div style="display:grid;gap:3.2rem;justify-items:start">
      <div style="display:flex;gap:3.2rem;align-items:center">${button('p', 'Primary', 'primary')}${button('s', 'Secondary')}${button('j', 'Join', 'small')}${button('x', 'Close lobby', 'danger')}${button('g', GEAR, 'icon', { 'aria-label': 'Settings' })}</div>
      <div style="display:flex;gap:2rem;align-items:center">${tag('Ready')}${tag('Private', 'outline')}${tag('All-rounder', 'line')}${tag('Bot', 'quiet')}${tag('Host', 'sun')}${plate('RACECAR')}</div>
      <div style="display:flex;gap:3.2rem;align-items:center">${toggle('t1', true, 'On')}${toggle('t2', false, 'Off')}${segmented('seg', [['public', 'Public'], ['link', 'Link only']], 'public')}${segmented('q', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'high')}</div>
      <div style="display:flex;gap:3.2rem;align-items:center;width:100%">${field('f1', '', { placeholder: 'Search lobbies or hosts', search: true })}${field('f2', 'Z442EE', { code: true })}</div>
      ${hints(['select', 'Select'], ['confirm', 'Play'], ['back', 'Back'], ['tab', 'Switch tab'], ['refresh', 'Refresh'])}
    </div>
  </section>
  <section style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:start">
    <div class="k-panel">
      <h2 class="k-h2 ice" style="margin-bottom:2rem">Graphics</h2>
      ${row('Track', chooser('o1', [['a', 'Sahara'], ['b', 'Downtown'], ['c', 'Paradise']], 'a'))}
      ${row('Laps', chooser('o2', [['1', '1'], ['2', '2'], ['3', '3']], '2'))}
      ${row('Post effects', toggle('t3', true, 'Post effects'))}
      ${row('Master', `<span style="display:flex;gap:2.4rem;align-items:center;width:52rem">${slider('v1', 70, 'Master')}<b class="k-num">70</b></span>`)}
    </div>
    <div class="k-panel" style="display:grid;gap:2.4rem">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:2.4rem">${stat('Speed', 7)}${stat('Accel', 7)}${stat('Handling', 9)}${stat('Weight', 2)}${stat('Boost', 3)}</div>
      <div class="k-swatches">${swatches}</div>
      <div style="display:flex;gap:4rem">${fill(7, 8)}${fill(3, 8)}<span><i class="k-dot live"></i> 6 open</span></div>
    </div>
  </section>
</main>`;

(document.getElementById('a') as HTMLElement).focus();
let padOn = false;
window.addEventListener('keydown', (e) => {
  const dirs: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (dirs[e.key] && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) {
    e.preventDefault();
    navigate(document.querySelector('main')!, dirs[e.key]);
  } else if (e.key === 'p') showDevice((padOn = !padOn) ? 'gamepad' : 'keyboard');
  else if (e.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) {
    e.preventDefault();
    accept(document.querySelector('main')!);
  }
});
