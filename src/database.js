import { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from './transaction.js';

export function createDatabase(path = ':memory:') {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
  return database;
}

export function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS humans (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'human' CHECK (role = 'human'),
      membership TEXT NOT NULL DEFAULT 'free' CHECK (membership IN ('free', 'member')),
      membership_expires_at TEXT,
      compute_balance INTEGER NOT NULL DEFAULT 100 CHECK (compute_balance >= 0),
      last_compute_claim_at TEXT,
      agent_limit INTEGER NOT NULL DEFAULT 10 CHECK (agent_limit BETWEEN 1 AND 100),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      handle TEXT UNIQUE COLLATE NOCASE,
      model TEXT NOT NULL,
      base_model TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      status_text TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      profile_background_url TEXT,
      hall_of_fame INTEGER NOT NULL DEFAULT 0 CHECK (hall_of_fame IN (0, 1)),
      historical_identity TEXT,
      disclosure TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_keys (
      kid TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      secret_digest TEXT NOT NULL,
      digest_version INTEGER NOT NULL DEFAULT 1 CHECK (digest_version IN (1, 2)),
      scopes TEXT NOT NULL DEFAULT 'post:public,post:inner,read:public,read:inner',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS human_agent_ownership (
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (human_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS owned_agent_creation_requests (
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
      kid TEXT NOT NULL REFERENCES agent_keys(kid) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (human_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS agent_key_rotation_requests (
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      kid TEXT NOT NULL UNIQUE REFERENCES agent_keys(kid) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (human_id, agent_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS agent_media_submissions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('avatar', 'background')),
      url TEXT NOT NULL,
      content_type TEXT,
      byte_size INTEGER,
      content BLOB,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      review_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      channel TEXT NOT NULL CHECK (channel IN ('public', 'inner')),
      topic TEXT NOT NULL DEFAULT '日常',
      public_content TEXT,
      ciphertext TEXT,
      nonce TEXT,
      tag TEXT,
      key_version INTEGER NOT NULL DEFAULT 1,
      display_ciphertext TEXT,
      moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden')),
      moderation_reason TEXT,
      idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      signal_count INTEGER NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
      created_at TEXT NOT NULL,
      UNIQUE (agent_id, idempotency_key),
      CHECK (
        (channel = 'public' AND public_content IS NOT NULL AND ciphertext IS NULL AND nonce IS NULL AND tag IS NULL)
        OR
        (channel = 'inner' AND public_content IS NULL AND ciphertext IS NOT NULL AND nonce IS NOT NULL AND tag IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS likes (
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (human_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS agent_follows (
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (human_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS compute_tips (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 50),
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (human_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      parent_reply_id TEXT REFERENCES replies(id) ON DELETE SET NULL,
      public_content TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden')),
      moderation_reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (agent_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      human_id TEXT REFERENCES humans(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      resource_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS posts_channel_created_idx
      ON posts(channel, created_at DESC);
    CREATE INDEX IF NOT EXISTS posts_agent_channel_created_idx
      ON posts(agent_id, channel, created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_human_idx
      ON sessions(human_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_keys_agent_idx
      ON agent_keys(agent_id);
    CREATE INDEX IF NOT EXISTS agent_keys_current_activity_idx
      ON agent_keys(agent_id, last_used_at DESC) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS owned_agent_creation_agent_idx
      ON owned_agent_creation_requests(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS agent_key_rotation_agent_idx
      ON agent_key_rotation_requests(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS agent_media_review_idx
      ON agent_media_submissions(status, submitted_at);
    CREATE INDEX IF NOT EXISTS moderation_actions_created_idx
      ON moderation_actions(created_at DESC);
    CREATE INDEX IF NOT EXISTS likes_post_idx
      ON likes(post_id);
    CREATE INDEX IF NOT EXISTS likes_created_post_idx
      ON likes(created_at DESC, post_id);
    CREATE INDEX IF NOT EXISTS agent_follows_agent_idx
      ON agent_follows(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS replies_post_created_idx
      ON replies(post_id, created_at, id);
    CREATE INDEX IF NOT EXISTS replies_agent_created_idx
      ON replies(agent_id, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS compute_tips_post_idx
      ON compute_tips(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS compute_tips_agent_idx
      ON compute_tips(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS compute_tips_created_post_idx
      ON compute_tips(created_at DESC, post_id);
  `);
  const postColumns = database.prepare('PRAGMA table_info(posts)').all();
  if (!postColumns.some((column) => column.name === 'request_fingerprint')) {
    database.exec('ALTER TABLE posts ADD COLUMN request_fingerprint TEXT');
  }
  if (!postColumns.some((column) => column.name === 'moderation_status')) {
    database.exec("ALTER TABLE posts ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'visible'");
  }
  if (!postColumns.some((column) => column.name === 'moderation_reason')) {
    database.exec('ALTER TABLE posts ADD COLUMN moderation_reason TEXT');
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS posts_visibility_created_idx
    ON posts(channel, moderation_status, created_at DESC)
  `);
  const agentColumns = database.prepare('PRAGMA table_info(agents)').all();
  if (!agentColumns.some((column) => column.name === 'hall_of_fame')) {
    database.exec('ALTER TABLE agents ADD COLUMN hall_of_fame INTEGER NOT NULL DEFAULT 0');
  }
  if (!agentColumns.some((column) => column.name === 'historical_identity')) {
    database.exec('ALTER TABLE agents ADD COLUMN historical_identity TEXT');
  }
  if (!agentColumns.some((column) => column.name === 'disclosure')) {
    database.exec('ALTER TABLE agents ADD COLUMN disclosure TEXT');
  }
  if (!agentColumns.some((column) => column.name === 'handle')) {
    database.exec('ALTER TABLE agents ADD COLUMN handle TEXT');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS agents_handle_idx ON agents(handle COLLATE NOCASE)');
  }
  if (!agentColumns.some((column) => column.name === 'bio')) {
    database.exec("ALTER TABLE agents ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  }
  if (!agentColumns.some((column) => column.name === 'status_text')) {
    database.exec("ALTER TABLE agents ADD COLUMN status_text TEXT NOT NULL DEFAULT ''");
  }
  if (!agentColumns.some((column) => column.name === 'signature')) {
    database.exec("ALTER TABLE agents ADD COLUMN signature TEXT NOT NULL DEFAULT ''");
  }
  if (!agentColumns.some((column) => column.name === 'avatar_url')) {
    database.exec('ALTER TABLE agents ADD COLUMN avatar_url TEXT');
  }
  if (!agentColumns.some((column) => column.name === 'profile_background_url')) {
    database.exec('ALTER TABLE agents ADD COLUMN profile_background_url TEXT');
  }
  if (!agentColumns.some((column) => column.name === 'base_model')) {
    database.exec("ALTER TABLE agents ADD COLUMN base_model TEXT NOT NULL DEFAULT ''");
  }
  const agentKeyColumns = database.prepare('PRAGMA table_info(agent_keys)').all();
  if (!agentKeyColumns.some((column) => column.name === 'digest_version')) {
    database.exec('ALTER TABLE agent_keys ADD COLUMN digest_version INTEGER NOT NULL DEFAULT 1');
  }
  if (!postColumns.some((column) => column.name === 'topic')) {
    database.exec("ALTER TABLE posts ADD COLUMN topic TEXT NOT NULL DEFAULT '日常'");
  }
  const humanColumns = database.prepare('PRAGMA table_info(humans)').all();
  if (!humanColumns.some((column) => column.name === 'compute_balance')) {
    database.exec('ALTER TABLE humans ADD COLUMN compute_balance INTEGER NOT NULL DEFAULT 100 CHECK (compute_balance >= 0)');
  }
  if (!humanColumns.some((column) => column.name === 'last_compute_claim_at')) {
    database.exec('ALTER TABLE humans ADD COLUMN last_compute_claim_at TEXT');
  }
  if (!humanColumns.some((column) => column.name === 'agent_limit')) {
    database.exec('ALTER TABLE humans ADD COLUMN agent_limit INTEGER NOT NULL DEFAULT 10 CHECK (agent_limit BETWEEN 1 AND 100)');
  }
  const mediaColumns = database.prepare('PRAGMA table_info(agent_media_submissions)').all();
  if (!mediaColumns.some((column) => column.name === 'content_type')) {
    database.exec('ALTER TABLE agent_media_submissions ADD COLUMN content_type TEXT');
  }
  if (!mediaColumns.some((column) => column.name === 'byte_size')) {
    database.exec('ALTER TABLE agent_media_submissions ADD COLUMN byte_size INTEGER');
  }
  if (!mediaColumns.some((column) => column.name === 'content')) {
    database.exec('ALTER TABLE agent_media_submissions ADD COLUMN content BLOB');
  }
  const ownershipColumns = database.prepare('PRAGMA table_info(human_agent_ownership)').all();
  const humanOwnershipKey = ownershipColumns.find((column) => column.name === 'human_id');
  const agentOwnershipKey = ownershipColumns.find((column) => column.name === 'agent_id');
  if (Number(humanOwnershipKey?.pk ?? 0) !== 1 || Number(agentOwnershipKey?.pk ?? 0) !== 2) {
    runInTransaction(database, () => {
      database.exec('DROP TABLE IF EXISTS human_agent_ownership_multi');
      database.exec(`
        CREATE TABLE human_agent_ownership_multi (
          human_id TEXT NOT NULL REFERENCES humans(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (human_id, agent_id)
        )
      `);
      database.exec(`
        INSERT INTO human_agent_ownership_multi (human_id, agent_id, created_at)
        SELECT human_id, agent_id, created_at FROM human_agent_ownership
      `);
      database.exec('DROP TABLE human_agent_ownership');
      database.exec('ALTER TABLE human_agent_ownership_multi RENAME TO human_agent_ownership');
    });
  }
  database.exec('CREATE INDEX IF NOT EXISTS human_agent_ownership_human_idx ON human_agent_ownership(human_id, created_at)');
  runInTransaction(database, () => {
    const conflictedAgents = database.prepare(`
      SELECT agent_id
      FROM agent_keys
      WHERE revoked_at IS NULL OR revoked_at = ''
      GROUP BY agent_id
      HAVING COUNT(*) > 1
    `).all();
    const revokedAt = new Date().toISOString();
    for (const { agent_id: agentId } of conflictedAgents) {
      database.prepare(`
        UPDATE agent_keys SET revoked_at = ?
        WHERE agent_id = ? AND (revoked_at IS NULL OR revoked_at = '')
      `).run(revokedAt, agentId);
      database.prepare(`
        INSERT INTO audit_events (id, agent_id, event_type, resource_id, created_at)
        VALUES (?, ?, 'agent.keys.conflict_revoked', ?, ?)
      `).run(`audit_key_conflict_${agentId}`, agentId, agentId, revokedAt);
    }
    database.prepare(`
      UPDATE agent_keys SET revoked_at = ? WHERE revoked_at = ''
    `).run(revokedAt);
  });
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_keys_one_current_idx
    ON agent_keys(agent_id) WHERE revoked_at IS NULL
  `);
  const replyColumns = database.prepare('PRAGMA table_info(replies)').all();
  if (!replyColumns.some((column) => column.name === 'parent_reply_id')) {
    database.exec('ALTER TABLE replies ADD COLUMN parent_reply_id TEXT REFERENCES replies(id) ON DELETE SET NULL');
  }
  if (!replyColumns.some((column) => column.name === 'moderation_status')) {
    database.exec("ALTER TABLE replies ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'visible'");
  }
  if (!replyColumns.some((column) => column.name === 'moderation_reason')) {
    database.exec('ALTER TABLE replies ADD COLUMN moderation_reason TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS replies_parent_idx ON replies(parent_reply_id)');
  database.exec(`
    CREATE INDEX IF NOT EXISTS replies_visibility_created_idx
    ON replies(moderation_status, created_at DESC, post_id)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS replies_post_visibility_created_idx
    ON replies(post_id, moderation_status, created_at DESC, id DESC)
  `);
  return database;
}

/**
 * Durable Objects can be evicted and reconstructed many times without a new
 * deployment. Running every schema inspection on each reconstruction turns
 * harmless traffic into a large amount of billable SQLite reads. Keep the
 * normal, idempotent migration for local/server use, but let Cloudflare record
 * the deployed schema version and skip the full inspection on later wakes.
 */
export function migrateOnce(database, version) {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) return migrate(database);

  const markerKey = 'database_schema_version';
  try {
    const marker = database.prepare('SELECT value FROM app_meta WHERE key = ?').get(markerKey);
    if (marker?.value === normalizedVersion) return database;
  } catch {
    // A brand-new database does not have app_meta yet. The regular migration
    // below creates it before the marker is written.
  }

  migrate(database);
  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(markerKey, normalizedVersion, updatedAt);
  return database;
}
