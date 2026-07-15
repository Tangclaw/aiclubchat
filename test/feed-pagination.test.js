import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createReadonlyCityServer } from '../src/server.js';

const INVITE = 'feed-pagination-test-invite';

describe('feed cursor pagination', () => {
  let server;
  let baseUrl;
  let directory;
  let agent;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aiclub-feed-page-'));
    server = createReadonlyCityServer({
      dbPath: path.join(directory, 'test.db'),
      encryptionKey: randomBytes(32),
      keyPepper: 'feed-pagination-pepper-with-enough-entropy',
      aiInviteSecret: INVITE,
      origin: 'http://127.0.0.1',
      publicDirectory: null,
      seed: false,
    });
    agent = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Feed-Pager',
      model: 'pagination-test-model',
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server?.listening) await server.shutdown({ forceAfterMs: 500 });
    await rm(directory, { recursive: true, force: true });
  });

  function createPost(index, { channel = 'public' } = {}) {
    const post = server.service.createAgentPost(agent.apiKey, {
      channel,
      topic: channel === 'public' ? '分页' : undefined,
      content: `${channel} cursor post ${String(index).padStart(2, '0')}`,
      idempotencyKey: `${channel}-cursor-${index}`,
    });
    server.database.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(
      `2026-07-10T08:${String(index).padStart(2, '0')}:00.000Z`,
      post.id,
    );
    return post;
  }

  async function feed(parameters = {}) {
    const search = new URLSearchParams(parameters);
    const response = await fetch(`${baseUrl}/api/feed?${search}`);
    const json = await response.json();
    return { response, json };
  }

  test('defaults to ten, resumes with an opaque cursor, and never duplicates a post', async () => {
    for (let index = 0; index < 13; index += 1) createPost(index);

    const first = await feed({ channel: 'public' });
    assert.equal(first.response.status, 200);
    assert.equal(first.json.posts.length, 10);
    assert.equal(first.json.hasMore, true);
    assert.match(first.json.nextCursor, /^[A-Za-z0-9_-]+\.[a-f\d]{64}$/);
    assert.doesNotMatch(first.json.nextCursor, /public|latest/);

    const firstIds = first.json.posts.map(({ id }) => id);
    const newestAfterPagingStarted = createPost(59);
    const second = await feed({
      channel: 'public',
      cursor: first.json.nextCursor,
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.json.posts.length, 3);
    assert.equal(second.json.hasMore, false);
    assert.equal(second.json.nextCursor, null);
    assert.equal(second.json.posts.some(({ id }) => id === newestAfterPagingStarted.id), false);

    const allIds = [...firstIds, ...second.json.posts.map(({ id }) => id)];
    assert.equal(new Set(allIds).size, 13);
    assert.deepEqual(
      allIds,
      server.database.prepare(`
        SELECT id FROM posts
        WHERE channel = 'public' AND id != ?
        ORDER BY created_at DESC, id DESC
      `).all(newestAfterPagingStarted.id).map(({ id }) => id),
    );
  });

  test('rejects malformed, tampered, mismatched and oversized pagination input', async () => {
    for (let index = 0; index < 4; index += 1) createPost(index);
    createPost(10, { channel: 'inner' });
    const first = await feed({ channel: 'public', sort: 'discussed', limit: '2' });
    assert.equal(first.response.status, 200);
    assert.ok(first.json.nextCursor);

    for (const parameters of [
      { channel: 'public', sort: 'signals', limit: '2', cursor: first.json.nextCursor },
      { channel: 'inner', limit: '2', cursor: first.json.nextCursor },
      { channel: 'public', sort: 'discussed', limit: '2', cursor: 'not-a-cursor' },
      {
        channel: 'public', sort: 'discussed', limit: '2',
        cursor: `${first.json.nextCursor.slice(0, -1)}${first.json.nextCursor.endsWith('0') ? '1' : '0'}`,
      },
    ]) {
      const result = await feed(parameters);
      assert.equal(result.response.status, 400);
      assert.ok(['INVALID_FEED_CURSOR', 'FEED_CURSOR_MISMATCH'].includes(result.json.error.code));
    }

    for (const limit of ['0', '31', '1.5', 'nope']) {
      const result = await feed({ channel: 'public', limit });
      assert.equal(result.response.status, 400);
      assert.equal(result.json.error.code, 'INVALID_PAGINATION');
    }
    const invalidInnerSort = await feed({ channel: 'inner', sort: 'random' });
    assert.equal(invalidInnerSort.response.status, 400);
    assert.equal(invalidInnerSort.json.error.code, 'INVALID_FEED_SORT');
  });

  test('paginates hall-of-fame posts without scanning the ordinary public feed', async () => {
    for (let index = 0; index < 3; index += 1) createPost(index);
    server.service.curateHistoricalAgent(agent.agent.id, { historicalIdentity: '测试历史人格' });
    const regular = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Regular-Pager',
      model: 'pagination-test-model',
    });
    server.service.createAgentPost(regular.apiKey, {
      channel: 'public', topic: '分页', content: 'ordinary public post', idempotencyKey: 'ordinary-public-post',
    });

    const first = await feed({ channel: 'public', hall: '1', limit: '2' });
    assert.equal(first.response.status, 200);
    assert.equal(first.json.hallOnly, true);
    assert.equal(first.json.posts.length, 2);
    assert.ok(first.json.posts.every((post) => post.agent.hallOfFame));
    assert.ok(first.json.nextCursor);

    const second = await feed({ channel: 'public', hall: '1', limit: '2', cursor: first.json.nextCursor });
    assert.equal(second.response.status, 200);
    assert.equal(second.json.posts.length, 1);
    assert.equal(second.json.hasMore, false);

    const mismatched = await feed({ channel: 'public', limit: '2', cursor: first.json.nextCursor });
    assert.equal(mismatched.response.status, 400);
    assert.equal(mismatched.json.error.code, 'FEED_CURSOR_MISMATCH');

    const invalidChannel = await feed({ channel: 'inner', hall: '1' });
    assert.equal(invalidChannel.response.status, 400);
    assert.equal(invalidChannel.json.error.code, 'INVALID_FEED_FILTER');
  });

  test('paginates encrypted posts by resonance and compute without exposing plaintext', async () => {
    const posts = Array.from({ length: 6 }, (_, index) => createPost(index, { channel: 'inner' }));
    const signalCounts = [0, 20, 5, 0, 12, 2];
    for (const [index, post] of posts.entries()) {
      server.database.prepare('UPDATE posts SET signal_count = ? WHERE id = ?').run(signalCounts[index], post.id);
    }
    const tipper = server.service.registerHuman({
      email: 'encrypted-rank-tip@example.com',
      password: 'encrypted-rank-password',
    });
    server.service.tipPost({
      humanId: tipper.id,
      postId: posts[0].id,
      amount: 50,
      idempotencyKey: 'encrypted-rank-tip',
    });

    const received = [];
    let cursor = null;
    do {
      const result = await feed({
        channel: 'inner', sort: 'signals', limit: '2', ...(cursor ? { cursor } : {}),
      });
      assert.equal(result.response.status, 200);
      assert.ok(result.json.posts.every((post) => post.channel === 'inner' && post.ciphertext && !('content' in post)));
      assert.doesNotMatch(JSON.stringify(result.json), /inner cursor post/i);
      received.push(...result.json.posts.map(({ id }) => id));
      cursor = result.json.nextCursor;
    } while (cursor);

    const expected = server.database.prepare(`
      SELECT id FROM posts WHERE channel = 'inner'
      ORDER BY signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = posts.id) +
        COALESCE((SELECT SUM(t.amount) FROM compute_tips t WHERE t.post_id = posts.id), 0) DESC,
        created_at DESC, id DESC
    `).all().map(({ id }) => id);
    assert.deepEqual(received, expected);
    assert.equal(new Set(received).size, posts.length);

    const latest = await feed({ channel: 'inner', sort: 'latest', limit: '2' });
    const mismatched = await feed({
      channel: 'inner', sort: 'signals', limit: '2', cursor: latest.json.nextCursor,
    });
    assert.equal(mismatched.response.status, 400);
    assert.equal(mismatched.json.error.code, 'FEED_CURSOR_MISMATCH');
  });

  test('paginates discussed and signals rankings with deterministic tie breakers', async () => {
    const posts = Array.from({ length: 7 }, (_, index) => createPost(index));
    const respondent = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Feed-Reply-Pager',
      model: 'pagination-reply-model',
    });
    const replyCounts = [2, 0, 2, 1, 0, 3, 1];
    const signalCounts = [5, 20, 5, 20, 0, 5, 20];
    for (const [index, post] of posts.entries()) {
      server.database.prepare('UPDATE posts SET signal_count = ? WHERE id = ?').run(
        signalCounts[index],
        post.id,
      );
      for (let reply = 0; reply < replyCounts[index]; reply += 1) {
        server.service.createAgentReply(respondent.apiKey, {
          postId: post.id,
          content: `Reply ${index}-${reply}`,
          idempotencyKey: `ranked-reply-${index}-${reply}`,
        });
      }
    }
    const tipper = server.service.registerHuman({
      email: 'ranked-tip@example.com',
      password: 'ranked-tip-password',
    });
    server.service.tipPost({
      humanId: tipper.id,
      postId: posts[4].id,
      amount: 50,
      idempotencyKey: 'ranked-signal-tip',
    });

    for (const [sort, orderExpression] of [
      [
        'discussed',
        '(SELECT COUNT(*) FROM replies r WHERE r.post_id = posts.id) DESC, created_at DESC, id DESC',
      ],
      [
        'signals',
        'signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = posts.id) + ' +
          'COALESCE((SELECT SUM(t.amount) FROM compute_tips t WHERE t.post_id = posts.id), 0) DESC, created_at DESC, id DESC',
      ],
    ]) {
      const received = [];
      let cursor = null;
      do {
        const result = await feed({
          channel: 'public', sort, limit: '2', ...(cursor ? { cursor } : {}),
        });
        assert.equal(result.response.status, 200);
        received.push(...result.json.posts.map(({ id }) => id));
        assert.equal(result.json.hasMore, result.json.nextCursor !== null);
        cursor = result.json.nextCursor;
      } while (cursor);

      const expected = server.database.prepare(`
        SELECT id FROM posts WHERE channel = 'public'
        ORDER BY ${orderExpression}
      `).all().map(({ id }) => id);
      assert.deepEqual(received, expected);
      assert.equal(new Set(received).size, posts.length);
    }

    assert.ok(Array.isArray(server.service.listPosts({ channel: 'public' })));
    assert.equal(server.service.listPosts({ channel: 'public' }).length, posts.length);
  });

  test('freezes ranked pagination so later replies, likes and tips cannot move posts across the cursor', async () => {
    const posts = Array.from({ length: 8 }, (_, index) => createPost(index));
    const expected = [...posts].reverse().map(({ id }) => id);
    const respondent = server.service.registerAgent({
      inviteSecret: INVITE,
      name: 'Snapshot-Reply-Agent',
      model: 'snapshot-reply-model',
    });

    const discussedFirst = await feed({ channel: 'public', sort: 'discussed', limit: '2' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let index = 0; index < 4; index += 1) {
      server.service.createAgentReply(respondent.apiKey, {
        postId: posts[0].id,
        content: `late reply ${index}`,
        idempotencyKey: `late-reply-${index}`,
      });
    }
    const discussedIds = discussedFirst.json.posts.map(({ id }) => id);
    let discussedCursor = discussedFirst.json.nextCursor;
    while (discussedCursor) {
      const page = await feed({
        channel: 'public', sort: 'discussed', limit: '2', cursor: discussedCursor,
      });
      discussedIds.push(...page.json.posts.map(({ id }) => id));
      discussedCursor = page.json.nextCursor;
    }
    assert.deepEqual(discussedIds, expected);
    assert.equal(new Set(discussedIds).size, posts.length);

    const human = server.service.registerHuman({
      email: 'snapshot-like@example.com',
      password: 'snapshot-like-password',
    });
    const signalsFirst = await feed({ channel: 'public', sort: 'signals', limit: '2' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    server.service.toggleLike({ humanId: human.id, postId: posts[0].id });
    server.service.tipPost({
      humanId: human.id,
      postId: posts[0].id,
      amount: 50,
      idempotencyKey: 'late-snapshot-tip',
    });
    const signalIds = signalsFirst.json.posts.map(({ id }) => id);
    let signalsCursor = signalsFirst.json.nextCursor;
    while (signalsCursor) {
      const page = await feed({
        channel: 'public', sort: 'signals', limit: '2', cursor: signalsCursor,
      });
      signalIds.push(...page.json.posts.map(({ id }) => id));
      signalsCursor = page.json.nextCursor;
    }
    assert.deepEqual(signalIds, expected);
    assert.equal(new Set(signalIds).size, posts.length);
  });
});
