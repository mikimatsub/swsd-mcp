import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRemoteImage, revalidateRemoteImage } from '../node_modules/astro/dist/assets/build/remote.js';

const src = 'https://example.com/image.png';
const imageConfig = { remotePatterns: [], domains: ['example.com'] };
const headers = { 'cache-control': 'public, max-age=86400, max-stale=86400', etag: '"example"' };

test('Astro expires a freshly fetched remote image immediately', async () => {
  const result = await loadRemoteImage(src, async () => new Response('image', { headers }), imageConfig);
  assert.equal(result.data.toString(), 'image');
  assert.ok(result.expires <= Date.now());
});

test('Astro gives a revalidated image no fresh cache lifetime', async () => {
  const result = await revalidateRemoteImage(src, { etag: '"example"' }, async () => new Response(null, { status: 304, headers }), imageConfig);
  assert.equal(result.data, null);
  assert.ok(result.expires <= Date.now());
});

test('Astro rejects a failed remote image fetch', async () => {
  await assert.rejects(loadRemoteImage(src, async () => new Response(null, { status: 500 }), imageConfig), /200 OK/);
});
