// Renders the marketing art (poster.html) in headless Chrome and writes it to marketing/. Needs the
// dev server running (it owns the save endpoint): `bun run dev --port 5184`, then
//
//   bun tools/poster.ts                  every shot, clean and titled
//   bun tools/poster.ts og,cover         some shots
//   bun tools/poster.ts --url 'poster.html?scout=downtown/downtown&s=240'   any poster URL (screenshot to marketing/scout.png)
//   --out /some/file.png (with --url)  --port 5184  --ss 2  --headed
//
// Talks to Chrome over the DevTools protocol with Bun's own WebSocket: no extra dependencies.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const port = flag('port') ?? '5184';
const ss = flag('ss');
const url = flag('url');
const outName = flag('out') ?? join('marketing', 'scout.png');
const headed = args.includes('--headed');
if (headed) args.splice(args.indexOf('--headed'), 1);
const shots = args[0] ?? 'all';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'poster-chrome-'));
const chrome = spawn(
  CHROME,
  [
    ...(headed ? [] : ['--headless=new']),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=metal',
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function endpoint(): Promise<string> {
  for (let k = 0; k < 100; k++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await endpoint());
await new Promise((ok) => (ws.onopen = ok));
let id = 0;
const pending = new Map<number, (r: { result?: Record<string, unknown>; error?: unknown }) => void>();
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    console.log(`[page ${msg.params.type}]`, msg.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[page exception]', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: Record<string, unknown>; error?: unknown }>((ok) => {
    pending.set(++id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
const page = url ? `http://localhost:${port}/${url}` : `http://localhost:${port}/poster.html?shot=${shots}&save=1${ss ? `&ss=${ss}` : ''}`;
console.log(page);
await send('Page.navigate', { url: page });
const started = Date.now();
let title = '';
while (Date.now() - started < 600_000) {
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = String((r.result?.result as { value?: string })?.value ?? '');
  if (title.startsWith('poster:')) break;
  await Bun.sleep(250);
}
console.log(title || 'timed out', `${((Date.now() - started) / 1000).toFixed(1)} s`);
if (url && title === 'poster:done') {
  // A scout or one-off: grab the canvas the page shows.
  const r = await send('Runtime.evaluate', { expression: "document.querySelector('canvas').toDataURL('image/png')", returnByValue: true });
  const data = String((r.result?.result as { value?: string })?.value ?? '');
  mkdirSync(dirname(outName), { recursive: true });
  const out = outName;
  writeFileSync(out, Buffer.from(data.split(',')[1] ?? '', 'base64'));
  console.log(`wrote ${out}`);
}
ws.close();
chrome.kill();
process.exit(title === 'poster:done' ? 0 : 1);
