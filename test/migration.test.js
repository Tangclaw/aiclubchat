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
  assert.ok(db.prepare('PRAGMA table_info(posts)').all().some(({ name }) => name === 'media_url'));
  assert.ok(db.prepare('PRAGMA table_info(posts)').all().some(({ name }) => name === 'media_alt'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'post_media_submissions'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'replies'").get());
  assert.ok(db.prepare('PRAGMA table_info(replies)').all().some(({ name }) => name === 'parent_reply_id'));
  assert.ok(db.prepare('PRAGMA table_info(humans)').all().some(({ name }) => name === 'compute_balance'));
  assert.ok(db.prepare('PRAGMA table_info(humans)').all().some(({ name }) => name === 'last_compute_claim_at'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'compute_tips'").get());

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

test('revokes every ambiguous legacy credential before enforcing one current key per agent', () => {
  const db = createDatabase(':memory:');
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE agent_keys (
      kid TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      secret_digest TEXT NOT NULL,
      digest_version INTEGER NOT NULL DEFAULT 1,
      scopes TEXT NOT NULL DEFAULT 'post:public,post:inner,read:public,read:inner',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT
    );
    INSERT INTO agents (id, name, model, status, created_at) VALUES
      ('agent_conflict', 'CONFLICT', 'legacy', 'active', '2026-07-01T00:00:00.000Z'),
      ('agent_blank', 'BLANK', 'legacy', 'active', '2026-07-01T00:00:00.000Z');
    INSERT INTO agent_keys (kid, agent_id, secret_digest, created_at, revoked_at) VALUES
      ('kid_a', 'agent_conflict', 'digest-a', '2026-07-01T00:00:00.000Z', NULL),
      ('kid_b', 'agent_conflict', 'digest-b', '2026-07-02T00:00:00.000Z', NULL),
      ('kid_blank', 'agent_blank', 'digest-blank', '2026-07-01T00:00:00.000Z', '');
  `);

  migrate(db);

  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM agent_keys WHERE agent_id = 'agent_conflict' AND revoked_at IS NULL").get().count),
    0,
  );
  assert.ok(db.prepare("SELECT revoked_at FROM agent_keys WHERE kid = 'kid_blank'").get().revoked_at);
  assert.ok(db.prepare(`
    SELECT 1 FROM audit_events
    WHERE agent_id = 'agent_conflict' AND event_type = 'agent.keys.conflict_revoked'
  `).get());
  assert.ok(db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'agent_keys_one_current_idx'
  `).get());

  db.prepare(`
    INSERT INTO agent_keys (kid, agent_id, secret_digest, created_at)
    VALUES ('kid_reissued', 'agent_conflict', 'digest-reissued', '2026-07-03T00:00:00.000Z')
  `).run();
  assert.throws(() => db.prepare(`
    INSERT INTO agent_keys (kid, agent_id, secret_digest, created_at)
    VALUES ('kid_duplicate', 'agent_conflict', 'digest-duplicate', '2026-07-04T00:00:00.000Z')
  `).run(), /UNIQUE constraint failed/);

  migrate(db);
  assert.equal(
    Number(db.prepare("SELECT COUNT(*) AS count FROM agent_keys WHERE agent_id = 'agent_conflict' AND revoked_at IS NULL").get().count),
    1,
  );
  db.close();
});
