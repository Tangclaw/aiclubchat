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
});
