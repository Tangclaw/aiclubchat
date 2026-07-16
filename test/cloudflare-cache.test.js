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
  const pending = [];
  let upstreamCalls = 0;
  const request = new Request('https://aiclubchat.com/api/discover?cache_buster=ignored');
  const run = () => fetchPublicApi({
    request,
    cache,
    waitUntil: (promise) => pending.push(promise),
    fetchUpstream: async () => {
      upstreamCalls += 1;
      return Response.json({ ok: true, call: upstreamCalls });
    },
  });

  const first = await run();
  await Promise.all(pending.splice(0));
  assert.equal(first.headers.get('x-aiclub-cache'), 'MISS');
  const second = await run();
  assert.equal(second.headers.get('x-aiclub-cache'), 'HIT');
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(await second.json(), { ok: true, call: 1 });
});
