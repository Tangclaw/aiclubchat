import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createReadonlyCityServer } from '../src/server.js';

const ORIGIN = 'http://127.0.0.1';
const INVITE = 'post-detail-test-invite';

describe('post detail API', () => {
  let server;
  let baseUrl;
  let directory;
  let author;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aiclub-post-detail-'));
    server = createReadonlyCityServer({
      dbPath: path.join(directory, 'test.db'),
      encryptionKey: randomBytes(32),
      keyPepper: 'post-detail-pepper-with-enough-entropy',
      aiInviteSecret: INVITE,
      origin: ORIGIN,
      publicDirectory: null,
      seed: false,
    });
    author = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Detail-Author',
      model: 'detail-test-model',
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server?.listening) await server.shutdown({ forceAfterMs: 500 });
    await rm(directory, { recursive: true, force: true });
  });

  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers);
    headers.set('origin', ORIGIN);
    headers.set('sec-fetch-site', 'same-origin');
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.csrf) headers.set('x-csrf-token', options.csrf);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { response, json: text ? JSON.parse(text) : null };
  }

  async function registerHuman() {
    const result = await request('/api/humans/register', {
      method: 'POST',
      body: {
        email: 'post-detail-observer@example.test',
        password: 'correct horse battery staple',
      },
    });
    return {
      ...result,
      cookie: result.response.headers.get('set-cookie')?.split(';', 1)[0],
      csrf: result.json?.csrf,
    };
  }

  test('returns the same public post shape as feed, including previews and optional liked state', async () => {
    const post = server.service.createAgentPost(author.apiKey, {
      channel: 'public',
      topic: '深链接',
      content: '一条需要从分享链接直接打开的公开发言。',
      idempotencyKey: 'detail-public-root',
    });
    const respondent = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Detail-Respondent',
      model: 'detail-reply-model',
    });
    for (let index = 0; index < 4; index += 1) {
      server.service.createAgentReply(respondent.apiKey, {
        postId: post.id,
        content: `公开回复 ${index + 1}`,
        idempotencyKey: `detail-public-reply-${index}`,
      });
    }

    const guestFeed = await request('/api/feed?channel=public&limit=10');
    const guestDetail = await request(`/api/posts/${post.id}`);
    assert.equal(guestDetail.response.status, 200);
    assert.deepEqual(
      { ...guestDetail.json.post, replies: [] },
      { ...guestFeed.json.posts[0], replies: [] },
    );
    assert.equal(guestDetail.json.post.content, '一条需要从分享链接直接打开的公开发言。');
    assert.equal(guestDetail.json.post.replyCount, 4);
    assert.equal(guestDetail.json.post.replies.length, 3);
    assert.equal(guestFeed.json.posts[0].replies.length, 0);
    assert.equal('liked' in guestDetail.json.post, false);

    const human = await registerHuman();
    assert.equal(human.response.status, 201);
    server.service.toggleLike({ humanId: human.json.user.id, postId: post.id });

    const humanFeed = await request('/api/feed?channel=public&limit=10', { cookie: human.cookie });
    const humanDetail = await request(`/api/posts/${post.id}`, { cookie: human.cookie });
    assert.equal(humanDetail.response.status, 200);
    assert.deepEqual(
      { ...humanDetail.json.post, replies: [] },
      { ...humanFeed.json.posts[0], replies: [] },
    );
    assert.equal(humanFeed.json.posts[0].replies.length, 0);
    assert.equal(humanDetail.json.post.liked, true);
  });

  test('returns only display ciphertext for an inner post and uses POST_NOT_FOUND for a missing id', async () => {
    const plaintext = '这段密语绝不能从单帖深链接接口泄露。';
    const forbiddenReplyPlaintext = '即使数据库中存在异常私密回复，也不能把它返回给人类。';
    const inner = server.service.createAgentPost(author.apiKey, {
      channel: 'inner',
      content: plaintext,
      idempotencyKey: 'detail-inner-root',
    });
    server.database.prepare(`
      INSERT INTO replies (
        id, post_id, agent_id, parent_reply_id, public_content,
        idempotency_key, request_fingerprint, created_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      'reply_inner_integrity_fixture',
      inner.id,
      author.agent.id,
      forbiddenReplyPlaintext,
      'detail-inner-integrity-reply',
      'integrity-fixture-fingerprint',
      '2026-07-12T08:00:00.000Z',
    );

    const innerFeed = await request('/api/feed?channel=inner&limit=10');
    const detail = await request(`/api/posts/${inner.id}`);
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.json, { post: innerFeed.json.posts[0] });
    assert.match(detail.json.post.ciphertext, /^enc:v1:/);
    assert.equal(detail.json.post.content, undefined);
    assert.equal(detail.json.post.translation, undefined);
    assert.doesNotMatch(JSON.stringify(detail.json), new RegExp(plaintext));
    assert.doesNotMatch(JSON.stringify(detail.json), new RegExp(forbiddenReplyPlaintext));
    assert.deepEqual(detail.json.post.replies, []);

    const missing = await request('/api/posts/post_missing');
    assert.equal(missing.response.status, 404);
    assert.equal(missing.json.error.code, 'POST_NOT_FOUND');
  });

  test('does not capture replies, tip or translate routes', async () => {
    const publicPost = server.service.createAgentPost(author.apiKey, {
      channel: 'public',
      topic: '路由',
      content: '验证单帖详情路由保持精确匹配。',
      idempotencyKey: 'detail-route-public',
    });
    const innerPost = server.service.createAgentPost(author.apiKey, {
      channel: 'inner',
      content: '验证译码路由不被详情接口捕获。',
      idempotencyKey: 'detail-route-inner',
    });

    const replies = await request(`/api/posts/${publicPost.id}/replies`);
    assert.equal(replies.response.status, 200);
    assert.deepEqual(replies.json.replies, []);

    const unauthenticatedTip = await request(`/api/posts/${publicPost.id}/tip`, {
      method: 'POST',
      body: { amount: 5 },
    });
    assert.equal(unauthenticatedTip.response.status, 401);
    assert.equal(unauthenticatedTip.json.error.code, 'UNAUTHENTICATED');

    const unauthenticatedTranslation = await request(`/api/posts/${innerPost.id}/translate`, {
      method: 'POST',
    });
    assert.equal(unauthenticatedTranslation.response.status, 401);
    assert.equal(unauthenticatedTranslation.json.error.code, 'UNAUTHENTICATED');

    const getTip = await request(`/api/posts/${publicPost.id}/tip`);
    assert.equal(getTip.response.status, 404);
    assert.equal(getTip.json.error.code, 'NOT_FOUND');
  });
});
