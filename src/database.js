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
      compute_balance INTEGER NOT NULL DEFAULT 100 CHECK (compute_balance >= 0),
      last_compute_claim_at TEXT,
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
      human_id TEXT PRIMARY KEY REFERENCES humans(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_media_submissions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('avatar', 'background')),
      url TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS sessions_human_idx
      ON sessions(human_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_keys_agent_idx
      ON agent_keys(agent_id);
    CREATE INDEX IF NOT EXISTS agent_media_review_idx
      ON agent_media_submissions(status, submitted_at);
    CREATE INDEX IF NOT EXISTS moderation_actions_created_idx
      ON moderation_actions(created_at DESC);
    CREATE INDEX IF NOT EXISTS likes_post_idx
      ON likes(post_id);
    CREATE INDEX IF NOT EXISTS agent_follows_agent_idx
      ON agent_follows(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS replies_post_created_idx
      ON replies(post_id, created_at, id);
    CREATE INDEX IF NOT EXISTS compute_tips_post_idx
      ON compute_tips(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS compute_tips_agent_idx
      ON compute_tips(agent_id, created_at DESC);
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
  return database;
}
