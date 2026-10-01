// A signed S3 request to a DigitalOcean Space (AWS SigV4), for what Bun's S3Client doesn't do (the
// bucket's CORS). Keys from DIGITAL_OCEAN_STORAGE_*, as publish-assets.ts.
import { createHash, createHmac } from 'node:crypto';
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} isn't set (run with --env-file pointing at the Space's keys)`);
  return v;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();
/** `query` is the signed query string (e.g. `cors=`); `body` an XML document for a PUT. */
export async function s3(method: 'GET' | 'PUT', query: string, body = '') {
  // Read when used, not when imported: a --dry run needs no keys at all.
  const endpoint = new URL(env('DIGITAL_OCEAN_STORAGE_BUCKET_ENDPOINT'));
  const region = endpoint.hostname.split('.')[0];
  const host = `${env('DIGITAL_OCEAN_STORAGE_BUCKET_NAME')}.${endpoint.hostname}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = now.slice(0, 8);
  const payload = sha(body);
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payload, 'x-amz-date': now };
  if (body) headers['content-md5'] = createHash('md5').update(body).digest('base64');
  const names = Object.keys(headers).sort();
  const canon = [method, '/', query, ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha(canon)].join('\n');
  let key = hmac('AWS4' + env('DIGITAL_OCEAN_STORAGE_SECRET_KEY'), day);
  for (const p of [region, 's3', 'aws4_request']) key = hmac(key, p);
  const sig = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env('DIGITAL_OCEAN_STORAGE_ACCESS_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  const r = await fetch(`https://${host}/?${query}`, { method, headers, body: body || undefined });
  return { status: r.status, text: await r.text() };
}
