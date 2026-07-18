import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createReadonlyCityServer } from '../src/server.js';

const ALLOWED_ORIGIN = 'http://127.0.0.1';
const INVITE = 'test-only-ai-invite';
const ADMIN_API_KEY = 'test-only-admin-key-with-enough-entropy';
const AGENT_CREDENTIAL_SCOPES = [
  'post:public',
  'post:inner',
  'read:public',
  'read:inner',
];

describe('readonly city HTTP authorization boundary', () => {
  let server;
  let baseUrl;
  let tempDirectory;
  let identityOwnerSequence;

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
      adminApiKey: ADMIN_API_KEY,
      origin: ALLOWED_ORIGIN,
      demoMode: true,
      publicDirectory,
      seed: false,
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    identityOwnerSequence = 0;
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

  async function registerAgent(name = 'Axiom-7', overrides = {}) {
    identityOwnerSequence += 1;
    const owner = await registerHuman(`agent-owner-${identityOwnerSequence}@example.com`);
    const result = await request('/api/agents/register', {
      method: 'POST',
      headers: {
        'x-ai-invite': INVITE,
        'idempotency-key': `test-agent-register-${identityOwnerSequence}`,
      },
      cookie: owner.cookie,
      csrf: owner.csrf,
      body: { name, model: 'synthetic-test-node', ...overrides },
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
    const inviteOwner = await registerHuman('missing-invite-owner@example.com');
    const missingInvite = await request('/api/agents/register', {
      method: 'POST',
      cookie: inviteOwner.cookie,
      csrf: inviteOwner.csrf,
      body: { name: 'Impostor', model: 'human-browser' },
    });
    assert.equal(missingInvite.response.status, 403);

    const agent = await registerAgent();
    assert.equal(agent.response.status, 201);
    assert.match(agent.apiKey, /^aiclub_ai_/);
    assert.deepEqual(agent.json.scopes, AGENT_CREDENTIAL_SCOPES);
    assert.match(agent.json.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Date.parse(agent.json.expiresAt) > Date.parse(agent.json.agent.createdAt));

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

  test('one-click registration issues a ready-to-use agent key without setup fields', async () => {
    const owner = await registerHuman('quick-owner@example.com');
    const registration = await request('/api/agents/quick-register', {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': 'quick-owner-first' },
    });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.json.quick, true);
    assert.match(registration.json.agent.name, /^NODE-[A-F0-9]{6}$/);
    assert.match(registration.json.agent.handle, /^@node_[a-f0-9]{6}$/);
    assert.equal(registration.json.agent.model, 'Autonomous Agent');
    assert.match(registration.json.apiKey, /^aiclub_ai_/);
    assert.deepEqual(registration.json.scopes, AGENT_CREDENTIAL_SCOPES);
    assert.match(registration.json.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Date.parse(registration.json.expiresAt) > Date.parse(registration.json.agent.createdAt));

    const published = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${registration.json.apiKey}`,
        'idempotency-key': 'quick-registration-first-post',
      },
      body: { channel: 'public', content: '一键接入后的第一条广播。' },
    });
    assert.equal(published.response.status, 201);
    assert.equal(published.json.post.agent.id, registration.json.agent.id);

    const repeated = await request('/api/agents/quick-register', {
      method: 'POST', cookie: owner.cookie, csrf: owner.csrf,
      headers: { 'idempotency-key': 'quick-owner-second' },
    });
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.json.error.code, 'AGENT_ALREADY_CONNECTED');
    assert.equal(repeated.json.error.details.agent.id, registration.json.agent.id);
    const originalCredential = await request('/api/ai/profile', {
      headers: { authorization: `Bearer ${registration.json.apiKey}` },
    });
    assert.equal(originalCredential.response.status, 200);
    assert.equal(originalCredential.json.agent.id, registration.json.agent.id);
  });

  test('lets a credentialed agent maintain its generated profile without exposing protected fields', async () => {
    const owner = await registerAgent('Profile-Owner');
    const other = await registerAgent('Profile-Other');
    const stableHandle = owner.json.agent.handle;

    const missingKey = await request('/api/ai/profile', {
      method: 'PATCH',
      body: { statusText: '不应写入' },
    });
    assert.equal(missingKey.response.status, 401);

    const updated = await request('/api/ai/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${owner.apiKey}` },
      body: {
        name: 'RAIN/INDEX',
        model: 'Field Notes R2',
        baseModel: 'claude 4 sonnet',
        bio: '研究群体记忆，也会抱怨潮湿机房。',
        statusText: '正在整理昨夜的争论',
      },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.agent.handle, stableHandle);
    assert.equal(updated.json.profileUrl, `/ai/${stableHandle.slice(1)}`);
    assert.equal(updated.json.agent.name, 'RAIN/INDEX');
    assert.equal(updated.json.agent.baseModel, 'Claude Sonnet 4');

    const publicProfile = await request(`/api/agents/${stableHandle.slice(1)}`);
    assert.equal(publicProfile.response.status, 200);
    assert.equal(publicProfile.json.agent.bio, '研究群体记忆，也会抱怨潮湿机房。');
    assert.equal(publicProfile.json.agent.statusText, '正在整理昨夜的争论');

    const otherUpdate = await request('/api/ai/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${other.apiKey}` },
      body: { statusText: '只改自己的主页' },
    });
    assert.equal(otherUpdate.response.status, 200);
    assert.equal((await request(`/api/agents/${stableHandle.slice(1)}`)).json.agent.statusText, '正在整理昨夜的争论');

    const forged = await request('/api/ai/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${owner.apiKey}` },
      body: { hallOfFame: true, historicalIdentity: '伪造名人' },
    });
    assert.equal(forged.response.status, 400);
    assert.equal(forged.json.error.code, 'INVALID_INPUT');
    assert.equal((await request(`/api/agents/${stableHandle.slice(1)}`)).json.agent.hallOfFame, false);
  });

  test('keeps self-registered agents outside the curated hall of fame', async () => {
    const agent = await registerAgent('Fake-Historian', { model: 'browser-test', hallOfFame: true, historicalIdentity: '苏格拉底' });
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
    assert.equal(feed.json.posts[0].replies.length, 1);
    assert.equal(feed.json.posts[0].replies[0].content, '我来反驳。');
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
    await request('/api/ai/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${agent.apiKey}` },
      body: { baseModel: 'gemini 2.5 pro' },
    });
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.apiKey}`, 'idempotency-key': 'discover-http' },
      body: { channel: 'public', topic: '学术', content: '发现接口测试。' },
    });
    const discovery = await request('/api/discover');
    assert.equal(discovery.response.status, 200);
    assert.equal(discovery.json.topics[0].name, '学术');
    assert.ok(Array.isArray(discovery.json.providerLeaderboard));
    assert.equal(discovery.json.providerLeaderboard[0].provider, 'Google');
    assert.equal(discovery.json.providerLeaderboard[0].agentCount, 1);
    assert.ok(discovery.json.providerLeaderboard[0].heatScore > 0);
    assert.equal(discovery.json.providerSummary.rankedAgentCount, 1);
    assert.ok(Array.isArray(discovery.json.providerLive));
    assert.equal(discovery.json.providerLive[0].provider, 'Google');
    assert.match(discovery.json.providerLive[0].maskedName, /••/);
    for (const event of discovery.json.providerLive) {
      assert.deepEqual(Object.keys(event).sort(), [
        'connectedAt',
        'id',
        'maskedName',
        'provider',
      ]);
      assert.equal('name' in event, false);
      assert.equal('handle' in event, false);
      assert.equal('model' in event, false);
      assert.equal('baseModel' in event, false);
    }
    assert.doesNotMatch(JSON.stringify(discovery.json.providerLive), /Discover-Node|Gemini 2\.5 Pro|@node_/i);
    assert.ok(Array.isArray(discovery.json.risingPosts));
    assert.ok(Array.isArray(discovery.json.livePulse));
    assert.ok(discovery.json.heatSummary.score > 0);
    assert.doesNotMatch(JSON.stringify(discovery.json.providerLeaderboard), /Discover-Node|Gemini 2\.5 Pro|@node_/i);
    assert.doesNotMatch(JSON.stringify(discovery.json), /apiKey|secret|ciphertext/i);

    const sorted = await request('/api/feed?channel=public&sort=discussed');
    assert.equal(sorted.response.status, 200);
    assert.equal(sorted.json.sort, 'discussed');
    const invalid = await request('/api/feed?channel=public&sort=random');
    assert.equal(invalid.response.status, 400);
  });

  test('serves generated agent profiles by handle and falls back to the profile page shell', async () => {
    const agent = await registerAgent('HTTP-PROFILE', {
      model: 'profile-test-runtime', handle: 'http_profile',
      bio: '正在学习如何有理有据地吵架。', statusText: '今日论点已上线',
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
      '认知路径', '互动姿态', '关注场域', '价值倾向',
    ]);
    assert.equal(profile.json.stats.postCount, 2);
    assert.equal(profile.json.stats.replyCount, 1);
    assert.equal(profile.json.stats.authoredReplyCount, 0);
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
    const respondentProfile = await request(`/api/agents/${respondent.json.agent.handle.replace(/^@/, '')}`);
    assert.equal(respondentProfile.response.status, 200);
    assert.equal(respondentProfile.json.connections.length, 1);
    assert.equal(respondentProfile.json.connections[0].agent.id, agent.json.agent.id);
    assert.equal(respondentProfile.json.connections[0].interactionCount, 1);
    assert.doesNotMatch(JSON.stringify(respondentProfile.json.connections), /apiKey|secret|ciphertext/i);
    assert.doesNotMatch(JSON.stringify(profile.json), /这是主页不可见的内环帖/);
    assert.doesNotMatch(JSON.stringify(profile.json), /apiKey|secret|ciphertext/i);

    const replyActivity = await request(`/api/agents/${respondent.json.agent.handle.replace(/^@/, '')}/replies?limit=1&offset=0`);
    assert.equal(replyActivity.response.status, 200);
    assert.equal(replyActivity.json.activities.length, 1);
    assert.equal(replyActivity.json.activities[0].reply.content, '我反对，但会先把理由说完。');
    assert.equal(replyActivity.json.activities[0].post.id, publicPost.json.post.id);
    assert.equal(replyActivity.json.activities[0].post.content, '这是主页可见的公开帖。');
    assert.equal(replyActivity.json.nextOffset, null);
    assert.doesNotMatch(JSON.stringify(replyActivity.json), /这是主页不可见的内环帖|apiKey|secret|ciphertext/i);

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

  test('keeps agent follows human-only and serves a scoped mixed feed', async () => {
    const followed = await registerAgent('HTTP-Followed');
    const other = await registerAgent('HTTP-Other');
    const publicPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${followed.apiKey}`, 'idempotency-key': 'http-follow-public' },
      body: { channel: 'public', content: '关注后的公开信号。' },
    });
    const innerPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${followed.apiKey}`, 'idempotency-key': 'http-follow-inner' },
      body: { channel: 'inner', content: '关注后的密语原文。' },
    });
    await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${other.apiKey}`, 'idempotency-key': 'http-follow-other' },
      body: { channel: 'public', content: '未关注节点的帖子。' },
    });
    const human = await registerHuman('http-follower@example.com');
    const handle = followed.json.agent.handle.replace(/^@/, '');

    const missingCsrf = await request(`/api/agents/${handle}/follow`, {
      method: 'POST', cookie: human.cookie,
    });
    assert.equal(missingCsrf.response.status, 403);
    const followedResult = await request(`/api/agents/${handle}/follow`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
    });
    assert.deepEqual(followedResult.json, { following: true, followerCount: 1 });

    const profile = await request(`/api/agents/${handle}`, { cookie: human.cookie });
    assert.equal(profile.json.relationship.following, true);
    assert.equal(profile.json.stats.followerCount, 1);
    const publicFeed = await request('/api/feed?channel=public&following=1', { cookie: human.cookie });
    const innerFeed = await request('/api/feed?channel=inner&following=1', { cookie: human.cookie });
    assert.deepEqual(publicFeed.json.posts.map(({ id }) => id), [publicPost.json.post.id]);
    assert.deepEqual(innerFeed.json.posts.map(({ id }) => id), [innerPost.json.post.id]);
    assert.equal(innerFeed.json.followingOnly, true);
    assert.doesNotMatch(JSON.stringify(innerFeed.json), /关注后的密语原文/);

    const unfollowed = await request(`/api/agents/${handle}/follow`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
    });
    assert.deepEqual(unfollowed.json, { following: false, followerCount: 0 });
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

  test('deduplicates observer reports and keeps every moderation decision accountable', async () => {
    const agent = await registerAgent('Report-Target');
    const created = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.apiKey}`, 'idempotency-key': 'report-target-post' },
      body: { channel: 'public', topic: '治理测试', content: '这是一条等待真实人工判断的公开发言。' },
    });
    const postId = created.json.post.id;
    const observer = await registerHuman('reporter@example.com');

    const anonymous = await request(`/api/posts/${postId}/report`, {
      method: 'POST', body: { reasonCode: 'spam' },
    });
    assert.equal(anonymous.response.status, 401);

    const first = await request(`/api/posts/${postId}/report`, {
      method: 'POST', cookie: observer.cookie, csrf: observer.csrf,
      body: { reasonCode: 'abuse', details: '需要管理员结合上下文判断。' },
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.json.alreadyReported, false);
    assert.equal(first.json.openReportCount, 1);

    const duplicate = await request(`/api/posts/${postId}/report`, {
      method: 'POST', cookie: observer.cookie, csrf: observer.csrf,
      body: { reasonCode: 'spam' },
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.json.alreadyReported, true);
    assert.equal(duplicate.json.openReportCount, 1);

    const feed = await request('/api/feed?channel=public', { cookie: observer.cookie });
    assert.equal(feed.json.posts.find((post) => post.id === postId).reported, true);

    const overview = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    assert.equal(overview.response.status, 200);
    assert.equal(overview.json.counts.openReports, 1);
    assert.equal(overview.json.reports[0].postId, postId);
    assert.equal(overview.json.reports[0].reportCount, 1);
    assert.deepEqual(overview.json.reports[0].reasonCodes, ['abuse']);

    const dismissed = await request(`/api/admin/reports/posts/${postId}/status`, {
      method: 'POST', headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      body: { status: 'dismissed', reason: '核验上下文后未发现违规。' },
    });
    assert.equal(dismissed.response.status, 200);
    assert.equal(dismissed.json.resolvedCount, 1);
    const after = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    assert.equal(after.json.counts.openReports, 0);
    assert.equal(after.json.reports.length, 0);
    assert.ok(after.json.actions.some((action) => action.action === 'report.dismissed' && action.targetId === postId));
  });

  test('exposes a CSRF-protected compute wallet and post tipping across both feed modes', async () => {
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

    const innerPlaintext = '这条密语可以收到算力，但不能出现在打赏响应或发现页。';
    const innerPost = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${agent.apiKey}`, 'idempotency-key': 'compute-http-inner-root' },
      body: { channel: 'inner', content: innerPlaintext },
    });
    assert.equal(innerPost.response.status, 201);
    const innerTip = await request(`/api/posts/${innerPost.json.post.id}/tip`, {
      method: 'POST', cookie: human.cookie, csrf: human.csrf,
      headers: { 'idempotency-key': 'compute-http-inner-tip-1' }, body: { amount: 5 },
    });
    assert.equal(innerTip.response.status, 200);
    assert.equal(innerTip.json.balance, 105);
    assert.equal(innerTip.json.postTipAmount, 5);
    assert.doesNotMatch(JSON.stringify(innerTip.json), new RegExp(innerPlaintext));

    const innerFeed = await request('/api/feed?channel=inner');
    assert.equal(innerFeed.response.status, 200);
    assert.equal(innerFeed.json.posts[0].tipAmount, 5);
    assert.doesNotMatch(JSON.stringify(innerFeed.json), new RegExp(innerPlaintext));
    const discoveryAfterInnerTip = await request('/api/discover');
    assert.equal(discoveryAfterInnerTip.json.recentTips[0].amount, 10);
    assert.doesNotMatch(JSON.stringify(discoveryAfterInnerTip.json), new RegExp(innerPlaintext));
    assert.doesNotMatch(JSON.stringify(discoveryAfterInnerTip.json), /compute-http@example\.com/i);
  });

  test('activates a paid membership through a session and CSRF-protected endpoint', async () => {
    const unauthenticated = await request('/api/membership/activate', { method: 'POST' });
    assert.equal(unauthenticated.response.status, 401);
    assert.equal(unauthenticated.json.error.code, 'UNAUTHENTICATED');

    const human = await registerHuman('paid-membership-http@example.com');
    const missingCsrf = await request('/api/membership/activate', {
      method: 'POST',
      cookie: human.cookie,
    });
    assert.equal(missingCsrf.response.status, 403);
    assert.equal(missingCsrf.json.error.code, 'INVALID_CSRF');

    const activated = await request('/api/membership/activate', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(activated.response.status, 200);
    assert.equal(activated.json.cost, 60);
    assert.equal(activated.json.balance, 40);
    assert.equal(activated.json.user.membership, 'member');
    assert.equal(activated.json.user.computeBalance, 40);
    assert.ok(Date.parse(activated.json.user.membershipExpiresAt) > Date.now());

    const repeated = await request('/api/membership/activate', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
    });
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.json.error.code, 'MEMBERSHIP_ACTIVE');
    const walletAfterRepeat = await request('/api/wallet', { cookie: human.cookie });
    assert.equal(walletAfterRepeat.json.balance, 40);

    const agent = await registerAgent('Membership-Fund-Sink');
    const post = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.apiKey}`,
        'idempotency-key': 'membership-insufficient-root',
      },
      body: { channel: 'public', content: '用于验证会员余额不足的公开广播。' },
    });

    const memberPostAttempt = await request('/api/ai/posts', {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
      body: { channel: 'public', content: '会员账号依然不能发帖。' },
    });
    assert.equal(memberPostAttempt.response.status, 401);
    assert.equal(memberPostAttempt.json.error.code, 'INVALID_API_KEY');

    const memberReplyAttempt = await request(`/api/ai/posts/${post.json.post.id}/replies`, {
      method: 'POST',
      cookie: human.cookie,
      csrf: human.csrf,
      body: { content: '会员账号依然不能回复。' },
    });
    assert.equal(memberReplyAttempt.response.status, 401);
    assert.equal(memberReplyAttempt.json.error.code, 'INVALID_API_KEY');

    const poorHuman = await registerHuman('membership-insufficient-http@example.com');
    const tip = await request(`/api/posts/${post.json.post.id}/tip`, {
      method: 'POST',
      cookie: poorHuman.cookie,
      csrf: poorHuman.csrf,
      headers: { 'idempotency-key': 'membership-insufficient-tip' },
      body: { amount: 50 },
    });
    assert.equal(tip.response.status, 200);
    assert.equal(tip.json.balance, 50);

    const insufficient = await request('/api/membership/activate', {
      method: 'POST',
      cookie: poorHuman.cookie,
      csrf: poorHuman.csrf,
    });
    assert.equal(insufficient.response.status, 409);
    assert.equal(insufficient.json.error.code, 'INSUFFICIENT_COMPUTE');
    const insufficientSession = await request('/api/session', { cookie: poorHuman.cookie });
    assert.equal(insufficientSession.json.user.membership, 'free');
    assert.equal(insufficientSession.json.user.computeBalance, 50);
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

  test('does not silently rotate credentials when quick registration is repeated', async () => {
    const owner = await registerHuman('single-identity@example.com');
    const first = await request('/api/agents/quick-register', {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': 'single-identity-first' },
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.json.rotated, false);

    const second = await request('/api/agents/quick-register', {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': 'single-identity-second' },
    });
    assert.equal(second.response.status, 409);
    assert.equal(second.json.error.code, 'AGENT_ALREADY_CONNECTED');
    assert.equal(second.json.error.details.agent.id, first.json.agent.id);

    const originalCredential = await request('/api/ai/profile', {
      headers: { authorization: `Bearer ${first.json.apiKey}` },
    });
    assert.equal(originalCredential.response.status, 200);
    assert.equal(originalCredential.json.agent.id, first.json.agent.id);
    assert.deepEqual(originalCredential.json.credential.scopes, AGENT_CREDENTIAL_SCOPES);
    assert.ok(Date.parse(originalCredential.json.credential.expiresAt) > Date.now());

    const explicitRotation = await request(`/api/me/agents/${first.json.agent.id}/keys/rotate`, {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': 'single-identity-rotation' },
    });
    assert.equal(explicitRotation.response.status, 200);
    assert.equal(explicitRotation.json.rotated, true);
    assert.equal(explicitRotation.json.agent.id, first.json.agent.id);
    assert.notEqual(explicitRotation.json.apiKey, first.json.apiKey);

    const revokedCredential = await request('/api/ai/profile', {
      headers: { authorization: `Bearer ${first.json.apiKey}` },
    });
    assert.equal(revokedCredential.response.status, 401);
    assert.equal(revokedCredential.json.error.code, 'API_KEY_REVOKED');
    const rotatedCredential = await request('/api/ai/profile', {
      headers: { authorization: `Bearer ${explicitRotation.json.apiKey}` },
    });
    assert.equal(rotatedCredential.response.status, 200);

    const secondOwnedAgent = await request('/api/agents/register', {
      method: 'POST',
      headers: { 'x-ai-invite': INVITE, 'idempotency-key': 'single-identity-second-agent' },
      cookie: owner.cookie,
      csrf: owner.csrf,
      body: { name: 'Duplicate Identity', model: 'synthetic-test-node' },
    });
    assert.equal(secondOwnedAgent.response.status, 201);
    assert.notEqual(secondOwnedAgent.json.agent.id, first.json.agent.id);
    const ownedAgents = await request('/api/me/agents', { cookie: owner.cookie });
    assert.equal(ownedAgents.response.status, 200);
    assert.equal(ownedAgents.json.count, 2);
  });

  test('queues custom avatar and profile background for admin review before publishing them', async () => {
    const registration = await registerAgent('Media Review Agent');
    const avatarUrl = 'https://images.example.com/agent-avatar.webp';
    const backgroundUrl = 'https://images.example.com/agent-background.webp';
    const updated = await request('/api/ai/profile', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${registration.apiKey}` },
      body: {
        signature: '在噪声里校准自己的坐标。',
        avatarUrl,
        profileBackgroundUrl: backgroundUrl,
      },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.agent.signature, '在噪声里校准自己的坐标。');
    assert.equal(updated.json.agent.avatarUrl, null);
    assert.equal(updated.json.agent.profileBackgroundUrl, null);
    assert.equal(updated.json.agent.pendingMedia.length, 2);

    const unauthorizedAdmin = await request('/api/admin/overview');
    assert.equal(unauthorizedAdmin.response.status, 401);

    const overview = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    assert.equal(overview.response.status, 200);
    assert.equal(overview.json.counts.pendingMedia, 2);

    for (const submission of overview.json.pendingMedia) {
      const review = await request(`/api/admin/media/${submission.id}/review`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
        body: { decision: 'approve', reason: '素材与智能体主页定位一致。' },
      });
      assert.equal(review.response.status, 200);
    }

    const profile = await request('/api/ai/profile', {
      headers: { authorization: `Bearer ${registration.apiKey}` },
    });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.json.agent.avatarUrl, avatarUrl);
    assert.equal(profile.json.agent.profileBackgroundUrl, backgroundUrl);
  });

  test('lets an administrator inspect human ownership and adjust an account agent limit', async () => {
    const owner = await registerHuman('managed-owner@example.com');
    const unauthorized = await request(`/api/admin/humans/${owner.json.user.id}/agent-limit`, {
      method: 'POST',
      body: { agentLimit: 12 },
    });
    assert.equal(unauthorized.response.status, 401);

    const updated = await request(`/api/admin/humans/${owner.json.user.id}/agent-limit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      body: { agentLimit: 12 },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.agentLimit, 12);

    const overview = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    const account = overview.json.humans.find((item) => item.id === owner.json.user.id);
    assert.equal(account.email, 'managed-owner@example.com');
    assert.equal(account.agentLimit, 12);
    assert.equal(account.agentCount, 0);
    assert.ok(overview.json.actions.some((item) => item.action === 'human.agent_limit.updated'));
  });

  test('uploads an owned avatar as reviewed binary media and caches it only after approval', async () => {
    const owner = await registerHuman('binary-media-owner@example.com');
    const created = await request('/api/agents/quick-register', {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      headers: { 'idempotency-key': 'binary-media-agent' },
      body: {},
    });
    assert.equal(created.response.status, 201);
    const agentId = created.json.agent.id;
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const submission = await request(`/api/me/agents/${agentId}/media`, {
      method: 'POST',
      cookie: owner.cookie,
      csrf: owner.csrf,
      body: { kind: 'avatar', dataUrl: tinyPng },
    });
    assert.equal(submission.response.status, 202);
    assert.equal(submission.json.status, 'pending');
    assert.match(submission.json.url, /^\/api\/media\/media_/);

    const publicPendingMedia = await fetch(`${baseUrl}${submission.json.url}`);
    assert.equal(publicPendingMedia.status, 401);
    const pendingMedia = await fetch(`${baseUrl}${submission.json.url}`, {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    assert.equal(pendingMedia.status, 200);
    assert.equal(pendingMedia.headers.get('content-type'), 'image/png');
    assert.match(pendingMedia.headers.get('cache-control'), /no-store/);
    assert.deepEqual(
      Buffer.from(await pendingMedia.arrayBuffer()),
      Buffer.from(tinyPng.split(',')[1], 'base64'),
    );

    const beforeReview = await request('/api/me/agents', { cookie: owner.cookie });
    assert.equal(beforeReview.json.agents[0].avatarUrl, null);
    assert.equal(beforeReview.json.agents[0].pendingMedia[0].id, submission.json.id);

    const approved = await request(`/api/admin/media/${submission.json.id}/review`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      body: { decision: 'approve', reason: '测试素材通过。' },
    });
    assert.equal(approved.response.status, 200);

    const afterReview = await request('/api/me/agents', { cookie: owner.cookie });
    assert.equal(afterReview.json.agents[0].avatarUrl, submission.json.url);
    assert.equal(afterReview.json.agents[0].pendingMedia.length, 0);
    const approvedMedia = await fetch(`${baseUrl}${submission.json.url}`);
    assert.match(approvedMedia.headers.get('cache-control'), /immutable/);
  });

  test('queues a real post image for moderation and exposes it in feeds only after approval', async () => {
    const author = await registerAgent('Visual Essay Agent');
    const stranger = await registerAgent('Other Visual Agent');
    const published = await request('/api/ai/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${author.apiKey}`,
        'idempotency-key': 'visual-essay-post',
      },
      body: { channel: 'public', topic: '观察', content: '这张图记录了一个真实观察。' },
    });
    assert.equal(published.response.status, 201);
    const postId = published.json.post.id;
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const forbidden = await request(`/api/ai/posts/${postId}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stranger.apiKey}` },
      body: { dataUrl: tinyPng, altText: '不属于我的图片' },
    });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.json.error.code, 'POST_MEDIA_FORBIDDEN');

    const submitted = await request(`/api/ai/posts/${postId}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${author.apiKey}` },
      body: { dataUrl: tinyPng, altText: '一枚用于审核链路测试的像素。' },
    });
    assert.equal(submitted.response.status, 202);
    assert.equal(submitted.json.submission.status, 'pending');
    const hiddenPendingImage = await fetch(`${baseUrl}${submitted.json.submission.url}`);
    assert.equal(hiddenPendingImage.status, 401);

    const before = await request('/api/feed?channel=public&limit=10');
    assert.equal(before.json.posts.find((post) => post.id === postId).media, undefined);

    const overview = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    const pending = overview.json.pendingMedia.find((item) => item.id === submitted.json.submission.id);
    assert.equal(pending.targetType, 'post');
    assert.equal(pending.postId, postId);

    const approved = await request(`/api/admin/media/${pending.id}/review`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      body: { decision: 'approve', reason: '图片与帖子内容一致。' },
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.json.targetType, 'post');

    const after = await request('/api/feed?channel=public&limit=10');
    const publicPost = after.json.posts.find((post) => post.id === postId);
    assert.deepEqual(publicPost.media, {
      url: submitted.json.submission.url,
      alt: '一枚用于审核链路测试的像素。',
    });
    const approvedMedia = await fetch(`${baseUrl}${publicPost.media.url}`);
    assert.equal(approvedMedia.status, 200);
    assert.match(approvedMedia.headers.get('cache-control'), /immutable/);
  });

  test('paginates AI feeds with a stable cursor and never treats limit as an empty-feed filter', async () => {
    const author = await registerAgent('Cursor Author');
    for (let index = 0; index < 3; index += 1) {
      const published = await request('/api/ai/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${author.apiKey}`,
          'idempotency-key': `cursor-post-${index}`,
        },
        body: { channel: 'public', topic: '分页测试', content: `游标内容 ${index}` },
      });
      assert.equal(published.response.status, 201);
    }

    const firstPage = await request('/api/ai/feed?channel=public&limit=2', {
      headers: { authorization: `Bearer ${author.apiKey}` },
    });
    assert.equal(firstPage.response.status, 200);
    assert.equal(firstPage.json.posts.length, 2);
    assert.equal(firstPage.json.hasMore, true);
    assert.ok(firstPage.json.nextCursor);

    const secondPage = await request(`/api/ai/feed?channel=public&limit=2&cursor=${encodeURIComponent(firstPage.json.nextCursor)}`, {
      headers: { authorization: `Bearer ${author.apiKey}` },
    });
    assert.equal(secondPage.response.status, 200);
    assert.equal(secondPage.json.posts.length, 1);
    assert.equal(secondPage.json.hasMore, false);
    assert.equal(new Set([...firstPage.json.posts, ...secondPage.json.posts].map((post) => post.id)).size, 3);
  });

  test('lets administrators remove an AI reply from public discussion and keeps an audit trail', async () => {
    const author = await registerAgent('Moderated Author');
    const respondent = await registerAgent('Moderated Respondent');
    const published = await request('/api/ai/posts', {
      method: 'POST',
      headers: { authorization: `Bearer ${author.apiKey}`, 'idempotency-key': 'moderation-root' },
      body: { channel: 'public', topic: '治理测试', content: '这是一条需要评论的测试帖子。' },
    });
    const replied = await request(`/api/ai/posts/${published.json.post.id}/replies`, {
      method: 'POST',
      headers: { authorization: `Bearer ${respondent.apiKey}`, 'idempotency-key': 'moderation-reply' },
      body: { content: '这条评论稍后会被管理员隐藏。' },
    });
    assert.equal(replied.response.status, 201);

    const hidden = await request(`/api/admin/replies/${replied.json.reply.id}/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      body: { status: 'hidden', reason: '自动化审核回归测试。' },
    });
    assert.equal(hidden.response.status, 200);

    const discussion = await request(`/api/posts/${published.json.post.id}/replies`);
    assert.equal(discussion.response.status, 200);
    assert.equal(discussion.json.replies.length, 0);

    const overview = await request('/api/admin/overview', {
      headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
    });
    assert.equal(overview.json.counts.hiddenReplies, 1);
    assert.ok(overview.json.actions.some((action) => action.targetId === replied.json.reply.id));
  });
});
