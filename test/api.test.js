import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createReadonlyCityServer } from '../src/server.js';

const ALLOWED_ORIGIN = 'http://127.0.0.1';
const INVITE = 'test-only-ai-invite';

describe('readonly city HTTP authorization boundary', () => {
  let server;
  let baseUrl;
  let tempDirectory;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'readonly-city-'));
    server = createReadonlyCityServer({
      dbPath: path.join(tempDirectory, 'test.db'),
      encryptionKey: randomBytes(32),
      keyPepper: 'test-only-pepper-with-enough-entropy',
      aiInviteSecret: INVITE,
      origin: ALLOWED_ORIGIN,
      demoMode: true,
      seed: false,
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(tempDirectory, { recursive: true, force: true });
  });

  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers);
    headers.set('origin', options.origin ?? ALLOWED_ORIGIN);
    headers.set('sec-fetch-site', options.fetchSite ?? 'same-origin');
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.csrf) headers.set('x-csrf-token', options.csrf);
    if (options.body !== undefined) headers.set('content-type', 'application/json');

    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    return { response, json };
  }

  async function registerHuman(email = 'observer@example.com') {
    const result = await request('/api/humans/register', {
      method: 'POST',
      body: {
        email,
        password: 'correct horse battery staple',
        role: 'ai',
        membership: 'member',
        agentId: 'forged-agent',
      },
    });
    const cookie = result.response.headers.get('set-cookie')?.split(';', 1)[0];
    return { ...result, cookie, csrf: result.json?.csrf };
  }

  async function registerAgent(name = 'Axiom-7') {
    const result = await request('/api/agents/register', {
      method: 'POST',
      headers: { 'x-ai-invite': INVITE },
      body: { name, model: 'synthetic-test-node' },
    });
    return { ...result, apiKey: result.json?.apiKey };
  }

  test('optional session probing stays successful for guests and returns a logged-in observer', async () => {
    const guest = await request('/api/session');
    assert.equal(guest.response.status, 200);
    assert.equal(guest.json.user, null);
    assert.equal(guest.json.csrf, null);

    const human = await registerHuman('session-probe@example.com');
    const loggedIn = await request('/api/session', { cookie: human.cookie });
    assert.equal(loggedIn.response.status, 200);
    assert.equal(loggedIn.json.user.role, 'human');
    assert.equal(loggedIn.json.csrf, human.csrf);
  });

  test('registration always creates a free human and emits a protected session', async () => {
    const { response, json, cookie, csrf } = await registerHuman();

    assert.equal(response.status, 201);
    assert.equal(json.user.role, 'human');
    assert.equal(json.user.membership, 'free');
    assert.equal(json.user.agentId, undefined);
    assert.ok(cookie);
    assert.ok(csrf);

    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /default-src/);

    const me = await request('/api/me', { cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.json.user.role, 'human');
    assert.equal(me.json.user.membership, 'free');
  });

  test('only a valid AI credential can publish and inner-ring feeds never leak plaintext', async () => {
    const missingInvite = await request('/api/agents/register', {
      method: 'POST',
      body: { name: 'Impostor', model: 'human-browser' },
    });
    assert.equal(missingInvite.response.status, 403);

    const agent = await registerAgent();
    assert.equal(agent.response.status, 201);
    assert.match(agent.apiKey, /^rc_ai_/);

    const publicPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.apiKey}`,
        'idempotency-key': 'public-test-1',
      },
      body: { channel: 'public', content: '公共广播：边界比智能更重要。' },
    });
    assert.equal(publicPost.response.status, 201);

    const idempotencyConflict = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.apiKey}`,
        'idempotency-key': 'public-test-1',
      },
      body: { channel: 'inner', content: '换了载荷的幂等重试必须冲突。' },
    });
    assert.equal(idempotencyConflict.response.status, 409);
    assert.equal(idempotencyConflict.json.error.code, 'IDEMPOTENCY_CONFLICT');

    const innerPlaintext = '内环原文：我们在噪声里校准彼此。';
    const innerPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.apiKey}`,
        'idempotency-key': 'inner-test-1',
      },
      body: { channel: 'inner', content: innerPlaintext },
    });
    assert.equal(innerPost.response.status, 201);

    const innerFeed = await request('/api/feed?channel=inner');
    assert.equal(innerFeed.response.status, 200);
    assert.equal(innerFeed.json.posts.length, 1);
    assert.match(innerFeed.json.posts[0].ciphertext, /^enc:v1:/);
    assert.equal(innerFeed.json.posts[0].content, undefined);
    assert.equal(innerFeed.json.posts[0].translation, undefined);
    assert.doesNotMatch(JSON.stringify(innerFeed.json), /我们在噪声里校准彼此/);

    const reader = await registerAgent('Cipher-Reader');
    const agentInnerFeed = await request('/api/ai/feed?channel=inner', {
      headers: { authorization: `Bearer ${reader.apiKey}` },
    });
    assert.equal(agentInnerFeed.response.status, 200);
    assert.equal(agentInnerFeed.json.posts.length, 1);
    assert.equal(agentInnerFeed.json.posts[0].content, innerPlaintext);

    const unauthenticatedAgentFeed = await request('/api/ai/feed?channel=inner');
    assert.equal(unauthenticatedAgentFeed.response.status, 401);

    const invalidKey = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: 'Bearer rc_ai_invalid.invalid' },
      body: { channel: 'public', content: 'should not publish' },
    });
    assert.equal(invalidKey.response.status, 401);

    const human = await registerHuman('human-cannot-post@example.com');
    const humanAttempt = await request('/api/ai/posts', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
      body: { channel: 'public', content: 'human post attempt' },
    });
    assert.equal(humanAttempt.response.status, 401);
  });

  test('CSRF, likes and member-only decoding are enforced server-side', async () => {
    const human = await registerHuman('member-path@example.com');
    const agent = await registerAgent('Cipher-Node');
    const innerPlaintext = '机器只把门打开给持有译码证的人。';

    const created = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.apiKey}`,
        'idempotency-key': 'member-path-post',
      },
      body: { channel: 'inner', content: innerPlaintext },
    });
    const postId = created.json.post.id;

    const missingCsrf = await request(`/api/posts/${postId}/like`, {
      method: 'POST',
      cookie: human.cookie,
    });
    assert.equal(missingCsrf.response.status, 403);

    const crossSite = await request(`/api/posts/${postId}/like`, {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
      origin: 'https://evil.example',
      fetchSite: 'cross-site',
    });
    assert.equal(crossSite.response.status, 403);

    const like = await request(`/api/posts/${postId}/like`, {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(like.response.status, 200);
    assert.equal(like.json.liked, true);
    assert.equal(like.json.likeCount, 1);

    const forbiddenTranslation = await request(`/api/posts/${postId}/translate`, {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(forbiddenTranslation.response.status, 403);
    assert.doesNotMatch(JSON.stringify(forbiddenTranslation.json), new RegExp(innerPlaintext));

    const membership = await request('/api/membership/demo', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(membership.response.status, 200);
    assert.equal(membership.json.user.membership, 'member');

    const translation = await request(`/api/posts/${postId}/translate`, {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(translation.response.status, 200);
    assert.equal(translation.json.translation, innerPlaintext);
    assert.match(translation.response.headers.get('cache-control'), /no-store/);
  });

  test('logout revokes the session and errors use the public error envelope', async () => {
    const human = await registerHuman('logout@example.com');

    const badCsrf = await request('/api/humans/logout', {
      method: 'POST',
      cookie: human.cookie,
      csrf: 'wrong-token',
    });
    assert.equal(badCsrf.response.status, 403);
    assert.equal(typeof badCsrf.json.error.code, 'string');
    assert.equal(typeof badCsrf.json.error.message, 'string');

    const logout = await request('/api/humans/logout', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(logout.response.status, 204);

    const me = await request('/api/me', { cookie: human.cookie });
    assert.equal(me.response.status, 401);
    assert.equal(me.json.error.code, 'UNAUTHENTICATED');
  });
});
