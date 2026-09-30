// Dev server endpoints (dev only, never in a build):
//   POST /__telemetry    {session, lines}  → appends to telemetry/<date>/<session>.jsonl
//   POST /__report       Report            → telemetry/reports/<time>.json (the F8 key)
//   POST /__editor/save  {path, layout}    → writes a layout under content/maps (the editor)

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

const root = import.meta.dirname;

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => ok(s));
    req.on('error', fail);
  });
}

function devEndpoints(): Plugin {
  return {
    name: 'racecar-dev-endpoints',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/__')) return next();
        try {
          const json = JSON.parse(await body(req));
          if (req.url === '/__telemetry') {
            const day = new Date().toISOString().slice(0, 10);
            const dir = join(root, 'telemetry', day);
            mkdirSync(dir, { recursive: true });
            const session = String(json.session).replace(/[^\w-]/g, '');
            appendFileSync(join(dir, `${session}.jsonl`), (json.lines as unknown[]).map((l) => JSON.stringify(l)).join('\n') + '\n');
          } else if (req.url === '/__report') {
            const dir = join(root, 'telemetry', 'reports');
            mkdirSync(dir, { recursive: true });
            const name = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
            writeFileSync(join(dir, name), JSON.stringify(json));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ file: `telemetry/reports/${name}` }));
            return;
          } else if (req.url === '/__editor/save') {
            const target = resolve(root, 'content', String(json.path));
            if (!target.startsWith(join(root, 'content', 'maps')) || !target.endsWith('.track.json')) throw new Error('layouts only');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify(json.layout, null, 1) + '\n');
          } else return next();
          res.statusCode = 204;
          res.end();
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devEndpoints()],
  define: { __BUILD_TIME__: JSON.stringify(Date.now().toString(36)) },
  server: { port: 5178, watch: { ignored: ['**/telemetry/**'] } },
  build: { target: 'es2022', sourcemap: true },
});
