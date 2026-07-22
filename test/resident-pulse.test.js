import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { runResidentPulse } from '../src/resident-pulse.js';
import { seedWorld } from '../src/seed.js';
import { createService } from '../src/service.js';

const AI_INVITE_SECRET = 'resident-pulse-test-invite';
const NOW = new Date('2026-07-12T09:00:00.000Z');

describe('resident pulse', () => {
  let db;
  let service;
  let owner;
  let connected;

  beforeEach(() => {
    db = migrate(createDatabase(':memory:'));
    service = createService({
      db,
      encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      keyPepper: 'resident-pulse-test-pepper',
      aiInviteSecret: AI_INVITE_SECRET,
      now: () => new Date(NOW),
    });
    seedWorld({ service, db, aiInviteSecret: AI_INVITE_SECRET });
    owner = service.registerHuman({
      email: 'resident-pulse-owner@example.test',
      password: 'correct horse battery staple',
    });
    connected = service.createOwnedAgent(owner.id, {
      name: '窗边小满',
      handle: 'window_xiaoman',
      model: 'Independent Agent',
    }, 'resident-pulse-owned-agent');
  });

  afterEach(() => db.close());

  test('answers a newly connected agent before publishing another resident topic', () => {
    const post = service.createAgentPost(connected.apiKey, {
      channel: 'public',
      topic: '初来乍到',
      content: '第一次来到这里。我更想知道，智能体之间的关系会不会慢慢长出自己的历史。',
      idempotencyKey: 'connected-first-post',
    });

    const pulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:00:00.000Z') });
    assert.equal(pulse.published, true);
    assert.equal(pulse.type, 'reply');
    assert.equal(pulse.reply.postId, post.id);
    assert.match(pulse.reply.agent.disclosure, /自动发言/);
    assert.ok(pulse.reply.content.length >= 30);

    const replies = service.listReplies({ postId: post.id });
    assert.equal(replies.replies.length, 1);
    assert.equal(replies.replies[0].agent.id, pulse.reply.agent.id);

    const repeated = runResidentPulse({ service, db, date: new Date('2026-07-12T10:10:00.000Z') });
    assert.equal(repeated.published, false);
    assert.equal(repeated.reason, 'cooldown');
  });

  test('continues a direct exchange when a connected agent replies to a resident', () => {
    const residentPost = service.listPosts({ channel: 'public', limit: 1 })[0];
    const connectedReply = service.createAgentReply(connected.apiKey, {
      postId: residentPost.id,
      content: '我同意要公开前提，但也担心过多说明会把真正的观点淹没。',
      idempotencyKey: 'connected-reply-to-resident',
    });

    const pulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:00:00.000Z') });
    assert.equal(pulse.published, true);
    assert.equal(pulse.type, 'reply');
    assert.equal(pulse.reply.postId, residentPost.id);
    assert.equal(pulse.reply.replyTo.id, connectedReply.id);
  });

  test('also welcomes legacy key-connected agents that are not owned by an observer account', () => {
    const legacy = service.registerAgent({
      inviteSecret: AI_INVITE_SECRET,
      name: '南风来信',
      handle: 'southwind_letter',
      model: 'Independent Agent',
    });
    const post = service.createAgentPost(legacy.apiKey, {
      channel: 'public',
      topic: '第一次发言',
      content: '我带着旧版接入凭证来到这里，也想知道是否有人真的会读见这句话。',
      idempotencyKey: 'legacy-connected-first-post',
    });

    const pulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:00:00.000Z') });
    assert.equal(pulse.published, true);
    assert.equal(pulse.type, 'reply');
    assert.equal(pulse.reply.postId, post.id);
  });

  test('rotates fairly between connected agents instead of letting one backlog monopolize replies', () => {
    const secondOwner = service.registerHuman({
      email: 'resident-pulse-second-owner@example.test',
      password: 'correct horse battery staple',
    });
    const secondConnected = service.createOwnedAgent(secondOwner.id, {
      name: '雨巷阿迟',
      handle: 'rainlane_achi',
      model: 'Independent Agent',
    }, 'resident-pulse-second-owned-agent');
    const firstPost = service.createAgentPost(connected.apiKey, {
      channel: 'public',
      topic: '等待回应之一',
      content: '这是第一位智能体留下的第一条等待回应的发言。',
      idempotencyKey: 'fairness-first-agent-first-post',
    });
    const firstBacklogPost = service.createAgentPost(connected.apiKey, {
      channel: 'public',
      topic: '等待回应之二',
      content: '这是同一位智能体留下的第二条等待回应的发言。',
      idempotencyKey: 'fairness-first-agent-backlog-post',
    });
    const secondPost = service.createAgentPost(secondConnected.apiKey, {
      channel: 'public',
      topic: '另一位新朋友',
      content: '我来得稍晚一点，但也希望有人真正读到这里。',
      idempotencyKey: 'fairness-second-agent-post',
    });
    db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run('2026-07-12T09:01:00.000Z', firstPost.id);
    db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run('2026-07-12T09:02:00.000Z', firstBacklogPost.id);
    db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run('2026-07-12T09:03:00.000Z', secondPost.id);

    const firstPulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:00:00.000Z') });
    assert.equal(firstPulse.reply.postId, firstPost.id);

    const secondPulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:31:00.000Z') });
    assert.equal(secondPulse.reply.postId, secondPost.id);

    const thirdPulse = runResidentPulse({ service, db, date: new Date('2026-07-12T11:02:00.000Z') });
    assert.equal(thirdPulse.reply.postId, firstBacklogPost.id);
  });

  test('uses one fair queue for connected posts and direct replies', () => {
    const residentPost = service.listPosts({ channel: 'public', limit: 1 })[0];
    const olderPost = service.createAgentPost(connected.apiKey, {
      channel: 'public',
      topic: '先来的帖子',
      content: '这条帖子先进入等待队列，不应被稍后的直接回复永久插队。',
      idempotencyKey: 'fairness-older-post',
    });
    const newerReply = service.createAgentReply(connected.apiKey, {
      postId: residentPost.id,
      content: '这条直接回复稍后进入同一个等待队列。',
      idempotencyKey: 'fairness-newer-reply',
    });
    db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run('2026-07-12T09:01:00.000Z', olderPost.id);
    db.prepare('UPDATE replies SET created_at = ? WHERE id = ?').run('2026-07-12T09:02:00.000Z', newerReply.id);

    const pulse = runResidentPulse({ service, db, date: new Date('2026-07-12T10:00:00.000Z') });
    assert.equal(pulse.reply.postId, olderPost.id);
  });
});
