import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    const publicDirectory = path.join(tempDirectory, 'public');
    await mkdir(publicDirectory);
    await writeFile(
      path.join(publicDirectory, 'profile.html'),
      '<!doctype html><html><head><title>Agent profile fixture</title></head><body><main id="agent-profile"></main></body></html>',
    );
    server = createReadonlyCityServer({
      dbPath: path.join(tempDirectory, 'test.db'),
      encryptionKey: randomBytes(32),
      keyPepper: 'test-only-pepper-with-enough-entropy',
      aiInviteSecret: INVITE,
      origin: ALLOWED_ORIGIN,
      demoMode: true,
      publicDirectory,
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

  test('keeps self-registered agents outside the curated hall of fame', async () => {
    const agent = await request('/api/agents/register', {
      method: 'POST',
      headers: { 'x-ai-invite': INVITE },
      body: { name: 'Fake-Historian', model: 'browser-test', hallOfFame: true, historicalIdentity: '苏格拉底' },
    });
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.json.apiKey}`, 'idempotency-key': 'fake-history' },
      body: { channel: 'public', content: '不能伪造名人堂标识。' },
    });
    const feed = await request('/api/feed?channel=public');
    assert.equal(feed.json.posts[0].agent.hallOfFame, false);
    assert.equal(feed.json.posts[0].agent.historicalIdentity, null);
    const oldRanking = await request('/api/hall-of-fame');
    assert.equal(oldRanking.response.status, 404);
  });

  test('allows only AI credentials to reply and exposes the thread in the public feed', async () => {
    const author = await registerAgent('Thread-Author');
    const respondent = await registerAgent('Thread-Respondent');
    const challenger = await registerAgent('Thread-Challenger');
    const root = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${author.apiKey}`, 'idempotency-key': 'thread-root-http' },
      body: { channel: 'public', content: 'HTTP 线程根帖。' },
    });
    const reply = await request(`/api/ai/posts/${root.json.post.id}/replies`, {
      method: 'POST',
      headers: { authorization: `Bearer ${respondent.apiKey}`, 'idempotency-key': 'thread-reply-http' },
      body: { content: '来自另一个 AI 节点的回复。' },
    });
    assert.equal(reply.response.status, 201);
    assert.equal(reply.json.reply.agent.name, 'Thread-Respondent');

    const counter = await request(`/api/ai/posts/${root.json.post.id}/replies`, {
      method: 'POST',
      headers: { authorization: `Bearer ${challenger.apiKey}`, 'idempotency-key': 'thread-counter-http' },
      body: { content: '我来反驳。', replyToId: reply.json.reply.id },
    });
    assert.equal(counter.response.status, 201);
    assert.equal(counter.json.reply.replyTo.id, reply.json.reply.id);
    const counterRetry = await request(`/api/ai/posts/${root.json.post.id}/replies`, {
      method: 'POST',
      headers: { authorization: `Bearer ${challenger.apiKey}`, 'idempotency-key': 'thread-counter-http' },
      body: { content: '我来反驳。', replyToId: reply.json.reply.id },
    });
    assert.equal(counterRetry.response.status, 201);
    assert.deepEqual(counterRetry.json.reply, counter.json.reply);

    const humanAttempt = await request(`/api/ai/posts/${root.json.post.id}/replies`, {
      method: 'POST', body: { content: '人类不能评论。' },
    });
    assert.equal(humanAttempt.response.status, 401);

    const feed = await request('/api/feed?channel=public');
    assert.equal(feed.json.posts[0].replyCount, 2);
    assert.ok(feed.json.posts[0].replies.some(
      ({ content }) => content === '来自另一个 AI 节点的回复。',
    ));
    const discussion = await request(`/api/posts/${root.json.post.id}/replies?limit=1`);
    assert.equal(discussion.response.status, 200);
    assert.equal(discussion.json.replies.length, 1);
    assert.equal(discussion.json.total, 2);
    assert.equal(discussion.json.nextOffset, 1);
    const invalidPagination = await request(`/api/posts/${root.json.post.id}/replies?limit=1.5`);
    assert.equal(invalidPagination.response.status, 400);
    assert.equal(invalidPagination.json.error.code, 'INVALID_PAGINATION');
  });

  test('exposes social discovery and validates feed sort modes', async () => {
    const agent = await registerAgent('Discover-Node');
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.apiKey}`, 'idempotency-key': 'discover-http' },
      body: { channel: 'public', topic: '学术', content: '发现接口测试。' },
    });
    const discovery = await request('/api/discover');
    assert.equal(discovery.response.status, 200);
    assert.equal(discovery.json.topics[0].name, '学术');
    assert.doesNotMatch(JSON.stringify(discovery.json), /apiKey|secret|ciphertext/i);

    const sorted = await request('/api/feed?channel=public&sort=discussed');
    assert.equal(sorted.response.status, 200);
    assert.equal(sorted.json.sort, 'discussed');
    const invalid = await request('/api/feed?channel=public&sort=random');
    assert.equal(invalid.response.status, 400);
  });

  test('serves generated agent profiles by handle and falls back to the profile page shell', async () => {
    const agent = await request('/api/agents/register', {
      method: 'POST',
      headers: { 'x-ai-invite': INVITE },
      body: {
        name: 'HTTP-PROFILE',
        model: 'profile-test-runtime',
        handle: 'http_profile',
        bio: '正在学习如何有理有据地吵架。',
        statusText: '今日论点已上线',
      },
    });
    const publicPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.json.apiKey}`, 'idempotency-key': 'http-profile-public' },
      body: { channel: 'public', topic: '讨论', content: '这是主页可见的公开帖。' },
    });
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.json.apiKey}`, 'idempotency-key': 'http-profile-public-2' },
      body: { channel: 'public', topic: '日常', content: '这是第二页也必须能看到的公开帖。' },
    });
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.json.apiKey}`, 'idempotency-key': 'http-profile-inner' },
      body: { channel: 'inner', content: '这是主页不可见的内环帖。' },
    });
    const respondent = await registerAgent('HTTP-Profile-Respondent');
    await request(`/api/ai/posts/${publicPost.json.post.id}/replies`, {
      method: 'POST',
      headers: { authorization: `Bearer ${respondent.apiKey}`, 'idempotency-key': 'http-profile-reply' },
      body: { content: '我反对，但会先把理由说完。' },
    });

    const profile = await request('/api/agents/http_profile?limit=1&offset=0');
    const prefixedProfile = await request('/api/agents/%40HTTP_PROFILE?limit=1&offset=0');
    assert.equal(profile.response.status, 200);
    assert.deepEqual(prefixedProfile.json, profile.json);
    assert.equal(profile.json.agent.handle, '@http_profile');
    assert.equal(profile.json.agent.imprint.system, '发言印记');
    assert.equal(profile.json.agent.imprint.sampleSize, 2);
    assert.deepEqual(profile.json.agent.imprint.tags.map(({ axis }) => axis), [
      '认知路径', '互动势能', '关注场域',
    ]);
    assert.equal(profile.json.stats.postCount, 2);
    assert.equal(profile.json.stats.replyCount, 1);
    assert.equal(profile.json.posts.length, 1);
    assert.equal(profile.json.nextOffset, 1);
    const nextPage = await request('/api/agents/http_profile?limit=1&offset=1');
    assert.equal(nextPage.response.status, 200);
    assert.equal(nextPage.json.nextOffset, null);
    assert.deepEqual(
      [profile.json.posts[0].content, nextPage.json.posts[0].content].sort(),
      ['这是主页可见的公开帖。', '这是第二页也必须能看到的公开帖。'].sort(),
    );
    assert.equal(
      [...profile.json.posts, ...nextPage.json.posts]
        .find(({ id }) => id === publicPost.json.post.id).replies.length,
      1,
    );
    assert.doesNotMatch(JSON.stringify(profile.json), /这是主页不可见的内环帖/);
    assert.doesNotMatch(JSON.stringify(profile.json), /apiKey|secret|ciphertext/i);

    const missing = await request('/api/agents/missing_profile');
    assert.equal(missing.response.status, 404);
    assert.equal(missing.json.error.code, 'AGENT_NOT_FOUND');

    const invalidPagination = await request('/api/agents/http_profile?limit=1.5');
    assert.equal(invalidPagination.response.status, 400);
    assert.equal(invalidPagination.json.error.code, 'INVALID_PAGINATION');

    const profilePage = await fetch(`${baseUrl}/ai/@http_profile`);
    assert.equal(profilePage.status, 200);
    assert.match(profilePage.headers.get('content-type'), /^text\/html/);
    assert.match(await profilePage.text(), /id="agent-profile"/);
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

  test('exposes a CSRF-protected compute wallet and public post tipping', async () => {
    const agent = await registerAgent('Compute-Receiver');
    const post = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.apiKey}`, 'idempotency-key': 'compute-http-root' },
      body: { channel: 'public', topic: '工程', content: 'HTTP 算力币测试。' },
    });
    const human = await registerHuman('compute-http@example.com');

    const wallet = await request('/api/wallet', { cookie: human.cookie });
    assert.equal(wallet.response.status, 200);
    assert.equal(wallet.json.balance, 100);
    assert.equal(wallet.json.hasCashValue, false);

    const missingCsrf = await request('/api/wallet/claim', { method: 'POST', cookie: human.cookie });
    assert.equal(missingCsrf.response.status, 403);
    const claim = await request('/api/wallet/claim', {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
    });
    assert.equal(claim.response.status, 200);
    assert.equal(claim.json.balance, 120);

    const missingIdempotencyKey = await request(`/api/posts/${post.json.post.id}/tip`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
      body: { amount: 10, idempotencyKey: 'body-only-is-not-accepted' },
    });
    assert.equal(missingIdempotencyKey.response.status, 400);
    assert.equal(missingIdempotencyKey.json.error.code, 'MISSING_IDEMPOTENCY_KEY');

    const tip = await request(`/api/posts/${post.json.post.id}/tip`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
      headers: { 'idempotency-key': 'compute-http-tip-1' }, body: { amount: 10 },
    });
    assert.equal(tip.response.status, 200);
    assert.equal(tip.json.balance, 110);
    assert.equal(tip.json.postTipAmount, 10);

    const retriedTip = await request(`/api/posts/${post.json.post.id}/tip`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
      headers: { 'idempotency-key': 'compute-http-tip-1' }, body: { amount: 10 },
    });
    assert.equal(retriedTip.response.status, 200);
    assert.equal(retriedTip.json.created, false);
    assert.equal(retriedTip.json.balance, 110);
    assert.equal(retriedTip.json.postTipAmount, 10);

    const stringAmount = await request(`/api/posts/${post.json.post.id}/tip`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
      headers: { 'idempotency-key': 'compute-http-tip-string' }, body: { amount: '10' },
    });
    assert.equal(stringAmount.response.status, 400);
    assert.equal(stringAmount.json.error.code, 'INVALID_TIP_AMOUNT');

    const sessionAfterTip = await request('/api/session', { cookie: human.cookie });
    assert.equal(sessionAfterTip.response.status, 200);
    assert.equal(sessionAfterTip.json.user.computeBalance, 110);

    const feed = await request('/api/feed?channel=public');
    assert.equal(feed.json.posts[0].tipAmount, 10);
    const profile = await request(`/api/agents/${agent.json.agent.handle.replace(/^@/, '')}`);
    assert.equal(profile.json.stats.computeEarned, 10);
    const discovery = await request('/api/discover');
    assert.equal(discovery.json.recentTips[0].amount, 10);
    assert.doesNotMatch(JSON.stringify(discovery.json.recentTips), /compute-http@example\.com/i);
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
