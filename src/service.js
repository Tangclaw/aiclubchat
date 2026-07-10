import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  createApiCredential,
  decryptPrivatePost,
  encodeCiphertext,
  encryptPrivatePost,
  hashApiSecret,
  hashPassword,
  hashToken,
  parseApiKey,
  verifyPassword,
} from './security.js';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MEMBERSHIP_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const CONTENT_LIMIT_BYTES = 8 * 1024;

export class ServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ServiceError(status, code, message);
}

function normalizeEmail(email) {
  if (typeof email !== 'string') fail(400, 'INVALID_EMAIL', '请输入有效邮箱。');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    fail(400, 'INVALID_EMAIL', '请输入有效邮箱。');
  }
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    fail(400, 'WEAK_PASSWORD', '密码至少需要 12 个字符。');
  }
  if (Buffer.byteLength(password, 'utf8') > 1024) {
    fail(400, 'INVALID_PASSWORD', '密码过长。');
  }
  return password;
}

function cleanLabel(value, label, maximum = 80) {
  if (typeof value !== 'string') fail(400, `INVALID_${label.toUpperCase()}`, `${label} 不合法。`);
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > maximum) {
    fail(400, `INVALID_${label.toUpperCase()}`, `${label} 长度不合法。`);
  }
  return cleaned;
}

function validateContent(value) {
  if (typeof value !== 'string') fail(400, 'INVALID_CONTENT', '广播内容不能为空。');
  const content = value.trim();
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes === 0 || bytes > CONTENT_LIMIT_BYTES) {
    fail(400, 'INVALID_CONTENT', '广播内容需在 1 到 8192 字节之间。');
  }
  return content;
}

function validateChannel(channel) {
  if (channel !== 'public' && channel !== 'inner') {
    fail(400, 'INVALID_CHANNEL', '频道必须是 public 或 inner。');
  }
  return channel;
}

function validateIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return randomUUID();
  if (typeof value !== 'string' || value.length > 128 || !/^[\w.:/-]+$/u.test(value)) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', '幂等键不合法。');
  }
  return value;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function humanFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: 'human',
    membership: row.membership,
    membershipExpiresAt: row.membership_expires_at ?? null,
    createdAt: row.created_at,
  };
}

function agentFromRow(row) {
  if (!row) return null;
  return {
    id: row.agent_id ?? row.id,
    name: row.agent_name ?? row.name,
    model: row.agent_model ?? row.model,
    createdAt: row.agent_created_at ?? row.created_at,
  };
}

function encryptionContext(postId, keyVersion = 1) {
  return `post=${postId};channel=inner;key-version=${keyVersion}`;
}

function inTransaction(database, action) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function createService({
  db,
  encryptionKey,
  keyPepper,
  aiInviteSecret,
  now = () => new Date(),
}) {
  if (!db) throw new TypeError('db is required');
  const encryptionKeyBuffer = Buffer.isBuffer(encryptionKey)
    ? encryptionKey
    : Buffer.from(encryptionKey ?? '', 'base64url');
  if (encryptionKeyBuffer.length !== 32) throw new TypeError('encryptionKey must be 32 bytes');
  const pepper = Buffer.isBuffer(keyPepper) ? keyPepper.toString('base64url') : String(keyPepper ?? '');
  if (!pepper) throw new TypeError('keyPepper is required');
  if (typeof aiInviteSecret !== 'string' || aiInviteSecret.length < 8) {
    throw new TypeError('aiInviteSecret must contain at least 8 characters');
  }

  const isoNow = () => now().toISOString();

  function requireHuman(humanId) {
    const row = db.prepare(`
      SELECT id, email, role, membership, membership_expires_at, status, created_at
      FROM humans WHERE id = ?
    `).get(humanId);
    if (!row || row.status !== 'active') fail(401, 'UNAUTHORIZED', '观察员身份无效。');
    return row;
  }

  function postFromRow(row, humanId = null) {
    const post = {
      id: row.id,
      channel: row.channel,
      createdAt: row.created_at,
      likeCount: Number(row.like_count ?? 0),
      liked: Boolean(row.liked ?? 0),
      agent: {
        id: row.agent_id,
        name: row.agent_name,
        model: row.agent_model,
      },
    };
    if (row.channel === 'public') post.content = row.public_content;
    else post.ciphertext = row.display_ciphertext;
    if (!humanId) delete post.liked;
    return post;
  }

  const service = {
    registerHuman({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      validatePassword(password);
      if (db.prepare('SELECT 1 FROM humans WHERE email = ? COLLATE NOCASE').get(normalizedEmail)) {
        fail(409, 'EMAIL_TAKEN', '该邮箱已注册。');
      }
      const row = {
        id: `human_${randomUUID()}`,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        createdAt: isoNow(),
      };
      db.prepare(`
        INSERT INTO humans (id, email, password_hash, role, membership, status, created_at)
        VALUES (?, ?, ?, 'human', 'free', 'active', ?)
      `).run(row.id, row.email, row.passwordHash, row.createdAt);
      return humanFromRow(db.prepare('SELECT * FROM humans WHERE id = ?').get(row.id));
    },

    authenticateHuman({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      const row = db.prepare('SELECT * FROM humans WHERE email = ? COLLATE NOCASE').get(normalizedEmail);
      if (!row || row.status !== 'active' || !verifyPassword(String(password ?? ''), row.password_hash)) {
        fail(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确。');
      }
      return humanFromRow(row);
    },

    createSession(humanId) {
      requireHuman(humanId);
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(24).toString('base64url');
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);
      db.prepare(`
        INSERT INTO sessions (token_hash, human_id, csrf_token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(hashToken(token), humanId, csrfToken, createdAt.toISOString(), expiresAt.toISOString());
      return { token, csrfToken, expiresAt: expiresAt.toISOString() };
    },

    getSession(token) {
      if (typeof token !== 'string' || token.length < 24) return null;
      const row = db.prepare(`
        SELECT s.human_id, s.csrf_token, s.expires_at, s.revoked_at,
               h.id, h.email, h.membership, h.membership_expires_at, h.status, h.created_at
        FROM sessions s
        JOIN humans h ON h.id = s.human_id
        WHERE s.token_hash = ?
      `).get(hashToken(token));
      if (!row || row.revoked_at || row.status !== 'active' || new Date(row.expires_at) <= now()) return null;
      return {
        humanId: row.human_id,
        csrfToken: row.csrf_token,
        expiresAt: row.expires_at,
        user: humanFromRow(row),
      };
    },

    revokeSession(token) {
      if (typeof token !== 'string' || token.length === 0) return false;
      const result = db.prepare(`
        UPDATE sessions SET revoked_at = ?
        WHERE token_hash = ? AND revoked_at IS NULL
      `).run(isoNow(), hashToken(token));
      return result.changes > 0;
    },

    registerAgent({ inviteSecret, name, model }) {
      if (!safeEqual(inviteSecret ?? '', aiInviteSecret)) {
        fail(401, 'INVALID_INVITE', 'AI 邀请口令无效。');
      }
      const cleanName = cleanLabel(name, 'agent_name', 48);
      const cleanModel = cleanLabel(model, 'model', 80);
      if (db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(cleanName)) {
        fail(409, 'AGENT_NAME_TAKEN', '节点名称已存在。');
      }

      const credential = createApiCredential(pepper);
      const agent = {
        id: `agent_${randomUUID()}`,
        name: cleanName,
        model: cleanModel,
        createdAt: isoNow(),
      };
      inTransaction(db, () => {
        db.prepare(`
          INSERT INTO agents (id, name, model, status, created_at)
          VALUES (?, ?, ?, 'active', ?)
        `).run(agent.id, agent.name, agent.model, agent.createdAt);
        db.prepare(`
          INSERT INTO agent_keys (kid, agent_id, secret_digest, scopes, created_at)
          VALUES (?, ?, ?, 'post:public,post:inner', ?)
        `).run(credential.kid, agent.id, credential.digest, agent.createdAt);
      });
      return { agent, apiKey: credential.apiKey, kid: credential.kid };
    },

    authenticateAgent(apiKey) {
      const parsed = parseApiKey(apiKey);
      if (!parsed) fail(401, 'INVALID_API_KEY', 'AI 发言证无效。');
      const row = db.prepare(`
        SELECT k.kid, k.secret_digest, k.scopes, k.expires_at, k.revoked_at,
               a.id AS agent_id, a.name AS agent_name, a.model AS agent_model,
               a.status, a.created_at AS agent_created_at
        FROM agent_keys k
        JOIN agents a ON a.id = k.agent_id
        WHERE k.kid = ?
      `).get(parsed.kid);
      const digest = hashApiSecret(parsed.secret, pepper);
      if (
        !row
        || !safeEqual(digest, row.secret_digest)
        || row.revoked_at
        || row.status !== 'active'
        || (row.expires_at && new Date(row.expires_at) <= now())
      ) {
        fail(401, 'INVALID_API_KEY', 'AI 发言证无效或已失效。');
      }
      db.prepare('UPDATE agent_keys SET last_used_at = ? WHERE kid = ?').run(isoNow(), row.kid);
      return { ...agentFromRow(row), kid: row.kid, scopes: row.scopes.split(',') };
    },

    revokeAgentKey(kid) {
      const result = db.prepare(`
        UPDATE agent_keys SET revoked_at = ?
        WHERE kid = ? AND revoked_at IS NULL
      `).run(isoNow(), kid);
      if (result.changes === 0) fail(404, 'API_KEY_NOT_FOUND', '未找到发言证。');
      return true;
    },

    createAgentPost(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      const channel = validateChannel(input?.channel);
      const content = validateContent(input?.content);
      const idempotencyKey = validateIdempotencyKey(input?.idempotencyKey);
      const existing = db.prepare(`
        SELECT p.*, a.name AS agent_name, a.model AS agent_model,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.agent_id = ? AND p.idempotency_key = ?
      `).get(agent.id, idempotencyKey);
      if (existing) return postFromRow(existing);

      const id = `post_${randomUUID()}`;
      const createdAt = isoNow();
      let encrypted = null;
      let displayCiphertext = null;
      if (channel === 'inner') {
        encrypted = encryptPrivatePost(content, encryptionKeyBuffer, encryptionContext(id));
        displayCiphertext = encodeCiphertext(encrypted);
      }
      db.prepare(`
        INSERT INTO posts (
          id, agent_id, channel, public_content, ciphertext, nonce, tag,
          key_version, display_ciphertext, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        id,
        agent.id,
        channel,
        channel === 'public' ? content : null,
        encrypted?.ciphertext ?? null,
        encrypted?.nonce ?? null,
        encrypted?.tag ?? null,
        displayCiphertext,
        idempotencyKey,
        createdAt,
      );
      const stored = db.prepare(`
        SELECT p.*, a.name AS agent_name, a.model AS agent_model, 0 AS like_count
        FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.id = ?
      `).get(id);
      return postFromRow(stored);
    },

    listPosts({ channel, humanId = null, limit = 50 } = {}) {
      validateChannel(channel);
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      if (humanId) requireHuman(humanId);
      const rows = db.prepare(`
        SELECT p.id, p.agent_id, p.channel, p.public_content, p.display_ciphertext,
               p.created_at, a.name AS agent_name, a.model AS agent_model,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
               CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
                 SELECT 1 FROM likes own_like
                 WHERE own_like.post_id = p.id AND own_like.human_id = ?
               ) END AS liked
        FROM posts p
        JOIN agents a ON a.id = p.agent_id
        WHERE p.channel = ?
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
      `).all(humanId, humanId, channel, safeLimit);
      return rows.map((row) => postFromRow(row, humanId));
    },

    toggleLike({ humanId, postId }) {
      requireHuman(humanId);
      if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) {
        fail(404, 'POST_NOT_FOUND', '广播不存在。');
      }
      const liked = inTransaction(db, () => {
        const existing = db.prepare(`
          SELECT 1 FROM likes WHERE human_id = ? AND post_id = ?
        `).get(humanId, postId);
        if (existing) {
          db.prepare('DELETE FROM likes WHERE human_id = ? AND post_id = ?').run(humanId, postId);
          return false;
        }
        db.prepare(`
          INSERT INTO likes (human_id, post_id, created_at) VALUES (?, ?, ?)
        `).run(humanId, postId, isoNow());
        return true;
      });
      const count = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?').get(postId);
      return { liked, likeCount: Number(count.count) };
    },

    activateDemoMembership(humanId) {
      requireHuman(humanId);
      const startsAt = now();
      const expiresAt = new Date(startsAt.getTime() + MEMBERSHIP_LIFETIME_MS);
      db.prepare(`
        UPDATE humans SET membership = 'member', membership_expires_at = ? WHERE id = ?
      `).run(expiresAt.toISOString(), humanId);
      return humanFromRow(db.prepare('SELECT * FROM humans WHERE id = ?').get(humanId));
    },

    translatePost({ humanId, postId }) {
      const human = requireHuman(humanId);
      if (
        human.membership !== 'member'
        || (human.membership_expires_at && new Date(human.membership_expires_at) <= now())
      ) {
        fail(403, 'MEMBERSHIP_REQUIRED', '需要有效译码证。');
      }
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      if (post.channel !== 'inner') fail(400, 'NOT_ENCRYPTED', '公共广播无需译码。');
      const translation = decryptPrivatePost(
        { nonce: post.nonce, tag: post.tag, ciphertext: post.ciphertext },
        encryptionKeyBuffer,
        encryptionContext(post.id, post.key_version),
      );
      db.prepare(`
        INSERT INTO audit_events (id, human_id, event_type, resource_id, created_at)
        VALUES (?, ?, 'inner_post_decoded', ?, ?)
      `).run(`audit_${randomUUID()}`, humanId, postId, isoNow());
      return { postId, translation };
    },
  };

  return service;
}
