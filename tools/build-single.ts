// The game as one HTML file (for hosts that take a game as a single document, like asleepace.com's
// games library): the production build as one classic script (no modules, no chunks) with the CSS,
// both inline in index.html. The page's own link-preview tags, icons and manifest are left out:
// the host adds its own from the game's entry.
//
//   bun tools/build-single.ts [out.html]     default: dist-single/racecar.html

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Bun loads .env files into process.env itself (.env.development, without NODE_ENV), and Vite lets
// a VITE_ variable already there win over its own: the build would get the local server's key. So
// without NODE_ENV=production the script runs itself again with it, and without what Bun loaded.
if (process.env.NODE_ENV !== 'production') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
  const r = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], { env: { ...env, NODE_ENV: 'production' }, stdout: 'inherit', stderr: 'inherit' });
  process.exit(r.exitCode ?? 1);
}
const { build } = await import('vite');

const root = join(import.meta.dir, '..');
const outDir = join(root, 'dist-single', 'build');
const out = process.argv[2] ?? join(root, 'dist-single', 'racecar.html');

await build({
  root,
  mode: 'production',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    // One script: everything, the editor's lazy imports included, in one IIFE.
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { input: join(root, 'index.html'), output: { format: 'iife', inlineDynamicImports: true } },
  },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.join(', ')}`);
// Inline, a `</script>` in the code would end the tag early.
const script = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

let html = readFileSync(join(outDir, 'index.html'), 'utf8');
html = html
  // The built script and stylesheet tags (inlined below).
  .replace(/<script[^>]*src="[^"]*assets\/[^"]*"[^>]*><\/script>\s*/g, '')
  .replace(/<link[^>]*href="[^"]*assets\/[^"]*"[^>]*>\s*/g, '')
  // The host's link previews and icon stand in for these.
  .replace(/<meta (property|name)="(og|twitter):[^>]*>\s*/g, '')
  .replace(/<link rel="(icon|apple-touch-icon|manifest|canonical)"[^>]*>\s*/g, '')
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '');
// Functions, not strings: in a replacement string, the code's own `$'` and `$\`` would insert parts of the page.
html = html.replace('</head>', () => `<style>\n${style}\n</style>\n</head>`);
// At the end of the body, as a module would run: after the document is parsed.
html = html.replace('</body>', () => `<script>\n${script}\n</script>\n</body>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
