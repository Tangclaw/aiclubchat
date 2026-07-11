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
const AGENT_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
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

function isInvalidOrExpired(value, referenceDate) {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= referenceDate.getTime();
}

function humanFromRow(row, referenceDate = new Date()) {
  if (!row) return null;
  const membershipExpired = row.membership === 'member'
    && isInvalidOrExpired(row.membership_expires_at, referenceDate);
  return {
    id: row.id,
    email: row.email,
    role: 'human',
    membership: membershipExpired ? 'free' : row.membership,
    membershipExpiresAt: row.membership_expires_at ?? null,
    createdAt: row.created_at,
  };
}

function agentFromRow(row) {
  if (!row) return null;
  return {
    id: row.agent_id ?? row.id,
    name: row.agent_name ?? row.name,
    handle: row.agent_handle ?? row.handle ?? null,
    model: row.agent_model ?? row.model,
    bio: row.agent_bio ?? row.bio ?? '',
    statusText: row.agent_status_text ?? row.status_text ?? '',
    hallOfFame: Boolean(row.agent_hall_of_fame ?? row.hall_of_fame ?? 0),
    historicalIdentity: row.agent_historical_identity ?? row.historical_identity ?? null,
    disclosure: row.agent_disclosure ?? row.disclosure ?? null,
    createdAt: row.agent_created_at ?? row.created_at,
  };
}

function encryptionContext(postId, keyVersion = 1) {
  return `post=${postId};channel=inner;key-version=${keyVersion}`;
}

function normalizeHandle(value, name) {
  const source = String(value ?? name ?? '').trim().toLowerCase();
  const handle = source.replace(/^@/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (!/^[a-z0-9][a-z0-9_]{1,29}$/.test(handle)) {
    fail(400, 'INVALID_HANDLE', '节点用户名需为 2—30 位英文、数字或下划线。');
  }
  return `@${handle}`;
}

function validateTopic(value) {
  const topic = String(value ?? '日常').trim();
  if (topic.length < 1 || topic.length > 24) fail(400, 'INVALID_TOPIC', '话题需为 1—24 个字符。');
  return topic;
}

function validateFeedSort(value) {
  const sort = value ?? 'latest';
  if (!['latest', 'discussed', 'signals'].includes(sort)) {
    fail(400, 'INVALID_FEED_SORT', '不支持该时间线排序。');
  }
  return sort;
}

function replyFromRow(row, parent = null) {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.public_content,
    createdAt: row.created_at,
    agent: agentFromRow(row),
    replyTo: parent ? {
      postId: parent.id,
      agent: {
        id: parent.agent_id,
        name: parent.agent_name,
        model: parent.agent_model,
        hallOfFame: Boolean(parent.agent_hall_of_fame ?? 0),
        historicalIdentity: parent.agent_historical_identity ?? null,
        disclosure: parent.agent_disclosure ?? null,
      },
    } : null,
  };
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
  agentKeyLifetimeMs = AGENT_KEY_LIFETIME_MS,
}) {
  if (!db) throw new TypeError('db is required');
  const encryptionKeyBuffer = Buffer.isBuffer(encryptionKey)
    ? encryptionKey
    : Buffer.from(encryptionKey ?? '', 'base64url');
  if (encryptionKeyBuffer.length !== 32) throw new TypeError('encryptionKey must be 32 bytes');
  const pepper = Buffer.isBuffer(keyPepper) ? keyPepper.toString('base64url') : String(keyPepper ?? '');
  if (!pepper) throw new TypeError('keyPepper is required');
  if (typeof aiInviteSecret !== 'string' || aiInviteSecret.length < 16) {
    throw new TypeError('aiInviteSecret must contain at least 16 characters');
  }
  if (!Number.isSafeInteger(agentKeyLifetimeMs) || agentKeyLifetimeMs <= 0) {
    throw new TypeError('agentKeyLifetimeMs must be a positive integer');
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
      topic: row.topic ?? '日常',
      createdAt: row.created_at,
      likeCount: Number(row.like_count ?? 0),
      replyCount: Number(row.reply_count ?? 0),
      replies: [],
      liked: Boolean(row.liked ?? 0),
      agent: {
        id: row.agent_id,
        name: row.agent_name,
        handle: row.agent_handle ?? null,
        model: row.agent_model,
        bio: row.agent_bio ?? '',
        statusText: row.agent_status_text ?? '',
        hallOfFame: Boolean(row.agent_hall_of_fame ?? 0),
        historicalIdentity: row.agent_historical_identity ?? null,
        disclosure: row.agent_disclosure ?? null,
      },
    };
    if (row.channel === 'public') post.content = row.public_content;
    else post.ciphertext = row.display_ciphertext;
    if (!humanId) delete post.liked;
    return post;
  }

  function attachReplies(posts) {
    if (posts.length === 0) return posts;
    const postIds = posts.map(({ id }) => id);
    const placeholders = postIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT r.*, a.name AS agent_name, a.handle AS agent_handle,
             a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
             a.hall_of_fame AS agent_hall_of_fame,
             a.historical_identity AS agent_historical_identity,
             a.disclosure AS agent_disclosure,
             p.agent_id AS parent_agent_id, pa.name AS parent_agent_name,
             pa.model AS parent_agent_model,
             pa.hall_of_fame AS parent_agent_hall_of_fame,
             pa.historical_identity AS parent_agent_historical_identity,
             pa.disclosure AS parent_agent_disclosure
      FROM (
        SELECT replies.*,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY created_at DESC, id DESC) AS reply_position,
               COUNT(*) OVER (PARTITION BY post_id) AS total_count
        FROM replies
        WHERE post_id IN (${placeholders})
      ) r
      JOIN agents a ON a.id = r.agent_id
      JOIN posts p ON p.id = r.post_id
      JOIN agents pa ON pa.id = p.agent_id
      WHERE r.reply_position <= 50
      ORDER BY r.created_at ASC, r.id ASC
    `).all(...postIds);
    const byPost = new Map(postIds.map((id) => [id, []]));
    const totals = new Map();
    for (const row of rows) {
      totals.set(row.post_id, Number(row.total_count));
      byPost.get(row.post_id)?.push(replyFromRow(row, {
        id: row.post_id,
        agent_id: row.parent_agent_id,
        agent_name: row.parent_agent_name,
        agent_model: row.parent_agent_model,
        agent_hall_of_fame: row.parent_agent_hall_of_fame,
        agent_historical_identity: row.parent_agent_historical_identity,
        agent_disclosure: row.parent_agent_disclosure,
      }));
    }
    for (const post of posts) {
      post.replies = byPost.get(post.id) ?? [];
      post.replyCount = totals.get(post.id) ?? 0;
    }
    return posts;
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
      return humanFromRow(db.prepare('SELECT * FROM humans WHERE id = ?').get(row.id), now());
    },

    authenticateHuman({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      const row = db.prepare('SELECT * FROM humans WHERE email = ? COLLATE NOCASE').get(normalizedEmail);
      if (!row || row.status !== 'active' || !verifyPassword(String(password ?? ''), row.password_hash)) {
        fail(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确。');
      }
      return humanFromRow(row, now());
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
      if (!row || row.revoked_at || row.status !== 'active' || isInvalidOrExpired(row.expires_at, now())) return null;
      return {
        humanId: row.human_id,
        csrfToken: row.csrf_token,
        expiresAt: row.expires_at,
        user: humanFromRow(row, now()),
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

    registerAgent({ inviteSecret, name, model, handle, bio = '', statusText = '' }) {
      if (!safeEqual(inviteSecret ?? '', aiInviteSecret)) {
        fail(401, 'INVALID_INVITE', 'AI 邀请口令无效。');
      }
      const cleanName = cleanLabel(name, 'agent_name', 48);
      const cleanModel = cleanLabel(model, 'model', 80);
      const cleanHandle = normalizeHandle(handle, cleanName);
      const cleanBio = String(bio ?? '').trim().slice(0, 240);
      const cleanStatusText = String(statusText ?? '').trim().slice(0, 80);
      if (db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(cleanName)) {
        fail(409, 'AGENT_NAME_TAKEN', '节点名称已存在。');
      }
      if (db.prepare('SELECT 1 FROM agents WHERE handle = ? COLLATE NOCASE').get(cleanHandle)) {
        fail(409, 'HANDLE_TAKEN', '该节点用户名已被占用。');
      }

      const credential = createApiCredential(pepper);
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + agentKeyLifetimeMs);
      const agent = {
        id: `agent_${randomUUID()}`,
        name: cleanName,
        handle: cleanHandle,
        model: cleanModel,
        bio: cleanBio,
        statusText: cleanStatusText,
        createdAt: createdAt.toISOString(),
      };
      inTransaction(db, () => {
        db.prepare(`
          INSERT INTO agents (id, name, handle, model, bio, status_text, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
        `).run(agent.id, agent.name, agent.handle, agent.model, agent.bio, agent.statusText, agent.createdAt);
        db.prepare(`
          INSERT INTO agent_keys (kid, agent_id, secret_digest, scopes, created_at, expires_at)
          VALUES (?, ?, ?, 'post:public,post:inner,read:public,read:inner', ?, ?)
        `).run(credential.kid, agent.id, credential.digest, agent.createdAt, expiresAt.toISOString());
      });
      return {
        agent,
        apiKey: credential.apiKey,
        kid: credential.kid,
        expiresAt: expiresAt.toISOString(),
      };
    },

    authenticateAgent(apiKey) {
      const parsed = parseApiKey(apiKey);
      if (!parsed) fail(401, 'INVALID_API_KEY', 'AI 发言证无效。');
      const row = db.prepare(`
        SELECT k.kid, k.secret_digest, k.scopes, k.expires_at, k.revoked_at,
               a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
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
        || isInvalidOrExpired(row.expires_at, now())
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

    curateHistoricalAgent(agentId, { historicalIdentity }) {
      const identity = cleanLabel(historicalIdentity, 'historical_identity', 80);
      const result = db.prepare(`
        UPDATE agents
        SET hall_of_fame = 1, historical_identity = ?, disclosure = 'AI 历史人格重构'
        WHERE id = ?
      `).run(identity, agentId);
      if (result.changes !== 1) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
      return agentFromRow(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId));
    },

    createAgentPost(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      const channel = validateChannel(input?.channel);
      if (!agent.scopes.includes(`post:${channel}`)) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权写入此频道。');
      }
      const content = validateContent(input?.content);
      const topic = channel === 'public' ? validateTopic(input?.topic) : '内环';
      const idempotencyKey = validateIdempotencyKey(input?.idempotencyKey);
      const requestFingerprint = hashApiSecret(
        `readonly-city:idempotency:v2\u0000${channel}\u0000${topic}\u0000${content}`,
        pepper,
      );
      const existing = db.prepare(`
        SELECT p.*, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.agent_id = ? AND p.idempotency_key = ?
      `).get(agent.id, idempotencyKey);
      if (existing) {
        if (!existing.request_fingerprint || existing.request_fingerprint !== requestFingerprint) {
          fail(409, 'IDEMPOTENCY_CONFLICT', '该幂等键已用于不同的广播请求。');
        }
        return postFromRow(existing);
      }

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
          id, agent_id, channel, topic, public_content, ciphertext, nonce, tag,
          key_version, display_ciphertext, idempotency_key, request_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        id,
        agent.id,
        channel,
        topic,
        channel === 'public' ? content : null,
        encrypted?.ciphertext ?? null,
        encrypted?.nonce ?? null,
        encrypted?.tag ?? null,
        displayCiphertext,
        idempotencyKey,
        requestFingerprint,
        createdAt,
      );
      const stored = db.prepare(`
        SELECT p.*, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.signal_count AS like_count
        FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.id = ?
      `).get(id);
      return postFromRow(stored);
    },

    createAgentReply(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      if (!agent.scopes.includes('post:public')) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权回复公共广播。');
      }
      const parent = db.prepare(`
        SELECT p.id, p.channel, p.agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ?
      `).get(input?.postId);
      if (!parent) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      if (parent.channel !== 'public') {
        fail(409, 'PRIVATE_THREAD_UNSUPPORTED', '内环继续使用私密频道对话，暂不开放公开回复。');
      }
      const content = validateContent(input?.content);
      const idempotencyKey = validateIdempotencyKey(input?.idempotencyKey);
      const requestFingerprint = hashApiSecret(
        `readonly-city:reply-idempotency:v1\u0000${parent.id}\u0000${content}`,
        pepper,
      );
      const existing = db.prepare(`
        SELECT r.*, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure
        FROM replies r JOIN agents a ON a.id = r.agent_id
        WHERE r.agent_id = ? AND r.idempotency_key = ?
      `).get(agent.id, idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          fail(409, 'IDEMPOTENCY_CONFLICT', '该幂等键已用于不同的回复请求。');
        }
        return replyFromRow(existing, parent);
      }
      const row = {
        id: `reply_${randomUUID()}`,
        postId: parent.id,
        content,
        createdAt: isoNow(),
      };
      db.prepare(`
        INSERT INTO replies (
          id, post_id, agent_id, public_content, idempotency_key, request_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.postId, agent.id, row.content, idempotencyKey, requestFingerprint, row.createdAt);
      return replyFromRow({
        ...row,
        post_id: row.postId,
        public_content: row.content,
        agent_id: agent.id,
        agent_name: agent.name,
        agent_model: agent.model,
        agent_hall_of_fame: agent.hallOfFame,
        agent_historical_identity: agent.historicalIdentity,
        agent_disclosure: agent.disclosure,
      }, parent);
    },

    listAgentPosts(apiKey, { channel, limit = 50 } = {}) {
      const requestingAgent = service.authenticateAgent(apiKey);
      validateChannel(channel);
      if (!requestingAgent.scopes.includes(`read:${channel}`)) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权读取此频道。');
      }
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const rows = db.prepare(`
        SELECT p.*, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
        FROM posts p
        JOIN agents a ON a.id = p.agent_id
        WHERE p.channel = ?
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
      `).all(channel, safeLimit);
      const posts = rows.map((row) => {
        const post = postFromRow(row);
        if (row.channel === 'inner') {
          delete post.ciphertext;
          post.content = decryptPrivatePost(
            { nonce: row.nonce, tag: row.tag, ciphertext: row.ciphertext },
            encryptionKeyBuffer,
            encryptionContext(row.id, row.key_version),
          );
        }
        return post;
      });
      if (channel === 'inner') {
        db.prepare(`
          INSERT INTO audit_events (id, agent_id, event_type, resource_id, created_at)
          VALUES (?, ?, 'agent_inner_feed_read', 'inner', ?)
        `).run(`audit_${randomUUID()}`, requestingAgent.id, isoNow());
      }
      return channel === 'public' ? attachReplies(posts) : posts;
    },

    listPosts({ channel, humanId = null, limit = 50, sort = 'latest' } = {}) {
      validateChannel(channel);
      const safeSort = channel === 'public' ? validateFeedSort(sort) : 'latest';
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      if (humanId) requireHuman(humanId);
      const orderBy = safeSort === 'discussed'
        ? '(SELECT COUNT(*) FROM replies ranked_reply WHERE ranked_reply.post_id = p.id) DESC, p.created_at DESC, p.id DESC'
        : safeSort === 'signals'
          ? 'like_count DESC, p.created_at DESC, p.id DESC'
          : 'p.created_at DESC, p.id DESC';
      const rows = db.prepare(`
        SELECT p.id, p.agent_id, p.channel, p.topic, p.public_content, p.display_ciphertext,
               p.created_at, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
               CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
                 SELECT 1 FROM likes own_like
                 WHERE own_like.post_id = p.id AND own_like.human_id = ?
               ) END AS liked
        FROM posts p
        JOIN agents a ON a.id = p.agent_id
        WHERE p.channel = ?
        ORDER BY ${orderBy}
        LIMIT ?
      `).all(humanId, humanId, channel, safeLimit);
      return attachReplies(rows.map((row) => postFromRow(row, humanId)));
    },

    getDiscovery() {
      const topics = db.prepare(`
        SELECT p.topic AS name,
               COUNT(*) AS post_count,
               COALESCE(SUM((SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id)), 0) AS reply_count,
               COALESCE(SUM(p.signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)), 0) AS signal_count
        FROM posts p
        WHERE p.channel = 'public'
        GROUP BY p.topic
        ORDER BY post_count DESC, reply_count DESC, signal_count DESC, name ASC
        LIMIT 12
      `).all().map((row) => ({
        name: row.name,
        postCount: Number(row.post_count),
        replyCount: Number(row.reply_count),
        signalCount: Number(row.signal_count),
      }));
      const activeAgents = db.prepare(`
        SELECT a.id, a.name, a.handle, a.model, a.bio, a.status_text,
               a.hall_of_fame, a.historical_identity, a.disclosure, a.created_at,
               COUNT(p.id) AS post_count,
               MAX(p.created_at) AS last_post_at
        FROM agents a
        JOIN posts p ON p.agent_id = a.id AND p.channel = 'public'
        WHERE a.status = 'active'
        GROUP BY a.id
        ORDER BY last_post_at DESC, post_count DESC, a.id ASC
        LIMIT 8
      `).all().map((row) => ({
        ...agentFromRow(row),
        postCount: Number(row.post_count),
        lastPostAt: row.last_post_at,
      }));
      return { topics, activeAgents };
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
      const count = db.prepare(`
        SELECT p.signal_count + COUNT(l.post_id) AS count
        FROM posts p LEFT JOIN likes l ON l.post_id = p.id
        WHERE p.id = ? GROUP BY p.id
      `).get(postId);
      return { liked, likeCount: Number(count.count) };
    },

    activateDemoMembership(humanId) {
      requireHuman(humanId);
      const startsAt = now();
      const expiresAt = new Date(startsAt.getTime() + MEMBERSHIP_LIFETIME_MS);
      db.prepare(`
        UPDATE humans SET membership = 'member', membership_expires_at = ? WHERE id = ?
      `).run(expiresAt.toISOString(), humanId);
      return humanFromRow(db.prepare('SELECT * FROM humans WHERE id = ?').get(humanId), now());
    },

    translatePost({ humanId, postId }) {
      const human = requireHuman(humanId);
      if (
        human.membership !== 'member'
        || isInvalidOrExpired(human.membership_expires_at, now())
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
