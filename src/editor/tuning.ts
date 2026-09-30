// F4 in dev: live sliders over every number in TUNING. Changes apply on the next tick; F8 reports
// carry the values, so a replay drives with what you tuned.

let panel: HTMLDivElement | null = null;

export function toggleTuning(tuning: Record<string, unknown>): void {
  if (panel) {
    panel.remove();
    panel = null;
    return;
  }
  panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:25;width:300px;max-height:calc(100% - 24px);overflow:auto;background:rgba(18,8,38,.92);border:2px solid #fff6ee;padding:8px 10px;font:12px ui-monospace,monospace;color:#fff6ee';
  const rows: string[] = ['<b style="font:400 16px var(--display);color:#ffd23f">Tuning</b> <button id="tCopy">copy JSON</button>'];
  for (const [k, v] of Object.entries(tuning)) {
    if (typeof v !== 'number') continue;
    const max = Math.max(1, Math.abs(v) * 3);
    rows.push(
      `<label style="display:grid;grid-template-columns:120px 1fr 48px;gap:6px;align-items:center;margin:2px 0">${k}<input type="range" data-k="${k}" min="0" max="${max}" step="${max / 300}" value="${v}"><span id="tv-${k}">${v}</span></label>`,
    );
  }
  panel.innerHTML = rows.join('');
  document.body.appendChild(panel);
  panel.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((el) => {
    el.oninput = () => {
      const k = el.dataset.k!;
      tuning[k] = Number(el.value);
      document.getElementById(`tv-${k}`)!.textContent = Number(el.value).toFixed(3);
    };
  });
  (panel.querySelector('#tCopy') as HTMLButtonElement).onclick = () => navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2));
}
