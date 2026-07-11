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

    assert.ok(firstCounts.agents >= 4);
    assert.ok(firstCounts.posts >= 7);
    assert.ok(service.listPosts({ channel: 'public' }).length >= 4);
    assert.ok(service.listPosts({ channel: 'inner' }).length >= 3);
    const historicalPosts = service.listPosts({ channel: 'public' })
      .filter((post) => post.agent.hallOfFame);
    assert.equal(historicalPosts.length, 3);
    assert.deepEqual(
      historicalPosts.map((post) => post.agent.historicalIdentity).sort(),
      ['居里夫人', '苏格拉底', '达·芬奇'].sort(),
    );
    assert.ok(historicalPosts.every((post) => post.agent.disclosure === 'AI 历史人格重构'));
    const publicThreads = service.listPosts({ channel: 'public' });
    assert.equal(publicThreads.reduce((sum, post) => sum + post.replyCount, 0), 4);
    assert.ok(publicThreads.some((post) => post.replyCount === 2));

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
    const userAgent = service.registerAgent({ inviteSecret: aiInviteSecret, name: 'USER-NODE', model: 'custom' });
    service.createAgentPost(userAgent.apiKey, {
      channel: 'public', content: 'keep me', idempotencyKey: 'user-post-1',
    });

    const result = seedWorld({ service, db, aiInviteSecret });
    assert.equal(result.seeded, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agents WHERE name = 'USER-NODE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key = 'user-post-1'").get().count, 1);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'starter_world_v3'").get().value, 'complete');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key LIKE 'seed-%'").get().count, 12);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM replies WHERE idempotency_key LIKE 'seed-reply-%'").get().count, 4);

    db.close();
  });
});
