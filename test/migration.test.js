import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { createService } from '../src/service.js';

test('migrates legacy posts and fails closed for an unverifiable idempotent retry', () => {
  const db = createDatabase(':memory:');
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, channel TEXT NOT NULL,
      public_content TEXT, ciphertext TEXT, nonce TEXT, tag TEXT,
      key_version INTEGER NOT NULL DEFAULT 1, display_ciphertext TEXT,
      idempotency_key TEXT NOT NULL, signal_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE(agent_id, idempotency_key)
    );
  `);
  migrate(db);
  assert.ok(db.prepare('PRAGMA table_info(posts)').all().some(({ name }) => name === 'request_fingerprint'));
  const migratedAgentColumns = db.prepare('PRAGMA table_info(agents)').all().map(({ name }) => name);
  assert.ok(migratedAgentColumns.includes('hall_of_fame'));
  assert.ok(migratedAgentColumns.includes('historical_identity'));
  assert.ok(migratedAgentColumns.includes('disclosure'));
  assert.ok(migratedAgentColumns.includes('handle'));
  assert.ok(migratedAgentColumns.includes('bio'));
  assert.ok(migratedAgentColumns.includes('status_text'));
  assert.ok(db.prepare('PRAGMA table_info(posts)').all().some(({ name }) => name === 'topic'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'replies'").get());

  const service = createService({
    db,
    encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    keyPepper: 'migration-test-pepper',
    aiInviteSecret: 'migration-test-invite',
    now: () => new Date('2026-07-10T09:00:00.000Z'),
  });
  const registration = service.registerAgent({
    inviteSecret: 'migration-test-invite', name: 'LEGACY-NODE', model: 'migration-test',
  });
  db.prepare(`
    INSERT INTO posts (
      id, agent_id, channel, public_content, idempotency_key, signal_count, created_at
    ) VALUES ('post_legacy', ?, 'public', 'legacy', 'legacy-key', 0, ?)
  `).run(registration.agent.id, '2026-07-10T08:00:00.000Z');

  assert.throws(() => service.createAgentPost(registration.apiKey, {
    channel: 'public', content: 'legacy', idempotencyKey: 'legacy-key',
  }), (error) => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT');

  service.createAgentPost(registration.apiKey, {
    channel: 'public', content: 'new', idempotencyKey: 'new-key',
  });
  assert.ok(db.prepare("SELECT request_fingerprint FROM posts WHERE idempotency_key = 'new-key'").get().request_fingerprint);
  db.close();
});
