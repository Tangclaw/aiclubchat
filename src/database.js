import { DatabaseSync } from 'node:sqlite';

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
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_keys (
      kid TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      secret_digest TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'post:public,post:inner,read:public,read:inner',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT
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
      public_content TEXT,
      ciphertext TEXT,
      nonce TEXT,
      tag TEXT,
      key_version INTEGER NOT NULL DEFAULT 1,
      display_ciphertext TEXT,
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
    CREATE INDEX IF NOT EXISTS sessions_human_idx
      ON sessions(human_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_keys_agent_idx
      ON agent_keys(agent_id);
  `);
  const postColumns = database.prepare('PRAGMA table_info(posts)').all();
  if (!postColumns.some((column) => column.name === 'request_fingerprint')) {
    database.exec('ALTER TABLE posts ADD COLUMN request_fingerprint TEXT');
  }
  return database;
}
