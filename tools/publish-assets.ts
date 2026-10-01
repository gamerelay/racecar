// Uploads racecar's hosted assets (the soundtrack) to the games' asset store: a DigitalOcean Space,
// under `assets/racecar/` (other sites keep their own `assets/<name>/`). The game reads them from
// the Space's origin (VITE_MUSIC_URL in .env.production), not its CDN: see docs/HANDOFF.md.
//
//   bun --env-file=../asleepace.com/.env tools/publish-assets.ts [--dry] [--cors]
//
// --cors also sets the Space's CORS rule (GET and HEAD from any origin), which Web Audio needs to
// play a track from another site. It replaces the Space's whole CORS config: check what's there
// first if other sites add rules.
//
// Needs DIGITAL_OCEAN_STORAGE_{ACCESS_ID,SECRET_KEY,BUCKET_NAME,BUCKET_ENDPOINT} in the environment
// (never in the repo). Each file is public-read.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client } from 'bun';
import { s3 as signed } from './lib/s3';

/** The folder in the Space, and what goes in it (local folder → path under it). */
export const PREFIX = 'assets/racecar';
const SETS: { dir: string; to: string; type: string; ext: string }[] = [{ dir: 'public/music', to: 'music', type: 'audio/mp4', ext: '.m4a' }];

const root = join(import.meta.dir, '..');
const dry = process.argv.includes('--dry');
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} isn't set (run with --env-file pointing at the Space's keys)`);
  return v;
};
// Made when uploading: a --dry run needs no keys.
const client = () =>
  new S3Client({
    accessKeyId: env('DIGITAL_OCEAN_STORAGE_ACCESS_ID'),
    secretAccessKey: env('DIGITAL_OCEAN_STORAGE_SECRET_KEY'),
    bucket: env('DIGITAL_OCEAN_STORAGE_BUCKET_NAME'),
    endpoint: env('DIGITAL_OCEAN_STORAGE_BUCKET_ENDPOINT'),
  });
let s3: S3Client | null = null;

/** Anyone may read (public-read objects only: CORS lends no access to private ones). */
const CORS = '<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>Accept-Ranges</ExposeHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>';
if (process.argv.includes('--cors') && !dry) {
  const r = await signed('PUT', 'cors=', CORS);
  if (r.status !== 200) throw new Error(`setting CORS: ${r.status} ${r.text}`);
  console.log('CORS: GET and HEAD from any origin');
}

for (const set of SETS) {
  // Its own kind of file only: not a .DS_Store, a folder, or anything else that's there.
  const names = readdirSync(join(root, set.dir)).filter((name) => name.endsWith(set.ext) && statSync(join(root, set.dir, name)).isFile());
  for (const name of names.sort()) {
    const local = join(root, set.dir, name);
    const key = `${PREFIX}/${set.to}/${name}`;
    const bytes = statSync(local).size;
    if (dry) {
      console.log(`would upload ${key} (${(bytes / 1e6).toFixed(1)} MB)`);
      continue;
    }
    s3 ??= client();
    await s3.write(key, Bun.file(local), { type: set.type, acl: 'public-read' });
    const stat = await s3.stat(key);
    if (stat.size !== bytes) throw new Error(`${key}: uploaded ${stat.size} bytes, expected ${bytes}`);
    console.log(`${key} (${(bytes / 1e6).toFixed(1)} MB)`);
  }
}
