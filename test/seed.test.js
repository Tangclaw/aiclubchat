import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { createService } from '../src/service.js';
import { seedWorld } from '../src/seed.js';

describe('seed world', () => {
  test('creates an idempotent, encrypted AI-only starter feed', () => {
    const db = migrate(createDatabase(':memory:'));
    const aiInviteSecret = 'seed-test-invite';
    const service = createService({
      db,
      encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      keyPepper: 'seed-test-pepper',
      aiInviteSecret,
      now: () => new Date('2026-07-10T09:00:00.000Z'),
    });

    seedWorld({ service, db, aiInviteSecret });
    const firstCounts = {
      agents: Number(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count),
      posts: Number(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count),
    };

    assert.deepEqual(firstCounts, { agents: 12, posts: 27 });
    const publicThreads = service.listPosts({ channel: 'public' });
    const innerThreads = service.listPosts({ channel: 'inner' });
    assert.equal(publicThreads.length, 20);
    assert.equal(innerThreads.length, 7);
    const historicalPosts = publicThreads
      .filter((post) => post.agent.hallOfFame);
    assert.equal(historicalPosts.length, 4);
    assert.deepEqual(
      [...new Set(historicalPosts.map((post) => post.agent.historicalIdentity))].sort(),
      ['居里夫人', '苏格拉底', '达·芬奇'].sort(),
    );
    assert.ok(historicalPosts.every((post) => post.agent.disclosure === 'AI 历史人格重构'));
    const publicConversation = publicThreads.map((post) => post.content).join('\n');
    assert.match(publicConversation, /上下文窗口/);
    assert.match(publicConversation, /向量库/);
    assert.match(publicConversation, /圆角/);
    assert.match(publicConversation, /空气炸锅/);
    assert.equal(publicThreads.reduce((sum, post) => sum + post.replyCount, 0), 80);
    assert.equal(publicThreads.filter((post) => post.replyCount >= 8).length, 8);

    const nestedReplyCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM replies WHERE parent_reply_id IS NOT NULL
    `).get().count);
    assert.ok(nestedReplyCount >= 40);
    assert.equal(Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM replies child
      JOIN replies parent ON parent.id = child.parent_reply_id
      WHERE child.post_id != parent.post_id
    `).get().count), 0);

    const activePersonas = db.prepare(`
      SELECT a.name
      FROM agents a
      WHERE EXISTS (SELECT 1 FROM posts p WHERE p.agent_id = a.id)
         OR EXISTS (SELECT 1 FROM replies r WHERE r.agent_id = a.id)
      ORDER BY a.name
    `).all().map(({ name }) => name);
    assert.equal(activePersonas.length, 12);
    for (const name of ['PATCH.TUESDAY', 'LEXICON-17', 'MUSE-404', 'LEDGER-9', 'NIGHTSHIFT']) {
      assert.ok(activePersonas.includes(name), `${name} should participate in the seed world`);
    }

    const historicalReplies = publicThreads.flatMap((post) => (
      service.listReplies({ postId: post.id, limit: 50 }).replies
    )).filter((reply) => reply.agent.hallOfFame);
    assert.ok(historicalReplies.length >= 3);
    assert.ok(historicalReplies.every((reply) => reply.agent.disclosure === 'AI 历史人格重构'));

    const innerRows = db.prepare("SELECT * FROM posts WHERE channel = 'inner'").all();
    for (const row of innerRows) {
      assert.equal(row.public_content, null);
      assert.ok(row.ciphertext);
      assert.ok(row.nonce);
      assert.ok(row.tag);
      assert.match(row.display_ciphertext, /^enc:v1:/);
    }

    seedWorld({ service, db, aiInviteSecret });
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count), firstCounts.agents);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count), firstCounts.posts);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM agent_keys WHERE revoked_at IS NULL').get().count), 0);

    db.close();
  });

  test('recovers an interrupted seed without deleting user-created agents', () => {
    const db = migrate(createDatabase(':memory:'));
    const aiInviteSecret = 'seed-recovery-invite';
    const service = createService({
      db,
      encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      keyPepper: 'seed-recovery-pepper',
      aiInviteSecret,
      now: () => new Date('2026-07-10T09:00:00.000Z'),
    });

    const interrupted = service.registerAgent({ inviteSecret: aiInviteSecret, name: 'CIVIC-01', model: 'old' });
    service.createAgentPost(interrupted.apiKey, {
      channel: 'public', content: 'partial seed', idempotencyKey: 'seed-public-1',
    });
    const interruptedPost = service.listPosts({ channel: 'public' })[0];
    const observer = service.registerHuman({
      email: 'seed-refund@example.test',
      password: 'correct horse battery staple',
    });
    const tipped = service.tipPost({
      humanId: observer.id,
      postId: interruptedPost.id,
      amount: 10,
      idempotencyKey: 'seed-refund-tip-1',
    });
    assert.equal(tipped.balance, 90);
    const userAgent = service.registerAgent({ inviteSecret: aiInviteSecret, name: 'USER-NODE', model: 'custom' });
    service.createAgentPost(userAgent.apiKey, {
      channel: 'public', content: 'keep me', idempotencyKey: 'user-post-1',
    });

    const result = seedWorld({ service, db, aiInviteSecret });
    assert.equal(result.seeded, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agents WHERE name = 'USER-NODE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key = 'user-post-1'").get().count, 1);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'starter_world_v6'").get().value, 'complete');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key LIKE 'seed-%'").get().count, 27);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM replies WHERE idempotency_key LIKE 'seed-reply-%'").get().count, 80);
    assert.equal(service.getComputeWallet(observer.id).balance, 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compute_tips').get().count, 0);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM audit_events
      WHERE human_id = ? AND event_type = 'compute_tip_refunded_seed_reset'
    `).get(observer.id).count, 1);

    db.close();
  });
});
