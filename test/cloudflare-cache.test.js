import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchPublicApi, publicApiCachePolicy } from '../src/cloudflare/cache.js';

test('public API cache only accepts non-personalized bounded first pages', () => {
  const feed = new Request('https://aiclubchat.com/api/feed?channel=public&limit=10');
  assert.deepEqual(publicApiCachePolicy(feed), {
    key: 'https://aiclubchat.com/api/feed?channel=public&limit=10',
    ttl: 20,
  });
  assert.equal(publicApiCachePolicy(new Request(feed.url, { headers: { cookie: 'session=secret' } })), null);
  assert.equal(publicApiCachePolicy(new Request(`${feed.url}&cursor=next`)), null);
  assert.equal(publicApiCachePolicy(new Request('https://aiclubchat.com/api/feed?limit=999')), null);
  assert.equal(publicApiCachePolicy(new Request('https://aiclubchat.com/api/session')), null);
});

test('public API cache canonicalizes discovery and serves a later hit', async () => {
  const entries = new Map();
  const cache = {
    async match(request) {
      const response = entries.get(request.url);
      return response?.clone();
    },
    async put(request, response) {
      entries.set(request.url, response.clone());
    },
  };
  let upstreamCalls = 0;
  const request = new Request('https://aiclubchat.com/api/discover?cache_buster=ignored');
  const run = () => fetchPublicApi({
    request,
    cache,
    fetchUpstream: async () => {
      upstreamCalls += 1;
      return Response.json({ ok: true, call: upstreamCalls });
    },
  });

  const first = await run();
  assert.equal(first.headers.get('x-aiclub-cache'), 'MISS');
  const second = await run();
  assert.equal(second.headers.get('x-aiclub-cache'), 'HIT');
  assert.equal(second.headers.get('cache-control'), 'no-store');
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(await second.json(), { ok: true, call: 1 });
});

test('public API waits for the edge cache write before resolving a miss', async () => {
  let releasePut;
  let stored = false;
  const cache = {
    async match() {
      return undefined;
    },
    async put() {
      await new Promise((resolve) => { releasePut = resolve; });
      stored = true;
    },
  };
  const request = new Request('https://aiclubchat.com/api/discover');
  let resolved = false;
  const pending = fetchPublicApi({
    request,
    cache,
    fetchUpstream: async () => Response.json({ ok: true }),
  }).then((response) => {
    resolved = true;
    return response;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolved, false);
  assert.equal(stored, false);
  releasePut();

  const response = await pending;
  assert.equal(response.headers.get('x-aiclub-cache'), 'MISS');
  assert.equal(stored, true);
});

test('public API reports an observable cache write error without failing the request', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    const response = await fetchPublicApi({
      request: new Request('https://aiclubchat.com/api/discover'),
      cache: {
        async match() { return undefined; },
        async put() { throw new Error('cache unavailable'); },
      },
      fetchUpstream: async () => Response.json({ ok: true }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-aiclub-cache'), 'ERROR');
    assert.deepEqual(await response.json(), { ok: true });
    assert.match(warnings[0], /public_api_cache\.write_failed/);
  } finally {
    console.warn = originalWarn;
  }
});
