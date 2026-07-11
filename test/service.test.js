import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { createService } from '../src/service.js';

const FIXED_NOW = new Date('2026-07-10T08:00:00.000Z');
const ENCRYPTION_KEY = Buffer.from(
  'f4c9f9f0b9c5edff56da379f155a63b2bf0ac04f96bf7b7a490aa319fd9b8c43',
  'hex',
);
const KEY_PEPPER = Buffer.from(
  '087e844487337122e39dbb9e70e9de73084d3bc86796a3f6041657a55033ae1c',
  'hex',
);
const AI_INVITE_SECRET = 'invite-only-for-service-tests';

function entityId(value) {
  return (
    value?.id ??
    value?.human?.id ??
    value?.user?.id ??
    value?.agent?.id ??
    value?.post?.id ??
    value?.humanId ??
    value?.userId ??
    value?.agentId ??
    value?.postId
  );
}

function sessionHumanId(value) {
  return (
    value?.humanId ??
    value?.userId ??
    value?.human?.id ??
    value?.user?.id ??
    value?.id
  );
}

function sessionToken(value) {
  return typeof value === 'string'
    ? value
    : value?.token ?? value?.sessionToken ?? value?.session?.token;
}

function apiKeyFrom(value) {
  return (
    value?.apiKey ??
    value?.key?.apiKey ??
    value?.credential?.apiKey ??
    value?.agent?.apiKey
  );
}

function keyIdFrom(value, database) {
  const returned =
    value?.kid ??
    value?.keyId ??
    value?.key?.kid ??
    value?.credential?.kid ??
    value?.agent?.kid;

  if (returned !== undefined && returned !== null) return returned;

  return database.prepare('SELECT kid FROM agent_keys LIMIT 1').get()?.kid;
}

function postsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.posts)) return value.posts;
  if (Array.isArray(value?.items)) return value.items;
  assert.fail('listPosts() must return an array or an object containing posts/items');
}

function publicTextFrom(post) {
  return post?.content ?? post?.body ?? post?.text ?? post?.plaintext;
}

function displayedCiphertextFrom(post) {
  return (
    post?.ciphertext ??
    post?.displayCiphertext ??
    post?.display_ciphertext ??
    post?.content ??
    post?.body
  );
}

function translationTextFrom(value) {
  if (typeof value === 'string') return value;
  return (
    value?.translation ??
    value?.translatedContent ??
    value?.plaintext ??
    value?.content ??
    value?.text
  );
}

function likeCountFrom(value) {
  return value?.likeCount ?? value?.likes ?? value?.count;
}

function jsonForSearch(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === 'bigint') return nested.toString();
    if (Buffer.isBuffer(nested)) return nested.toString('base64');
    return nested;
  });
}

function assertNoTranslationFields(value) {
  const forbiddenKeys = new Set([
    'translation',
    'translatedcontent',
    'translatedtext',
    'plaintext',
    'plaincontent',
    'decryptedcontent',
  ]);

  function visit(nested) {
    if (!nested || typeof nested !== 'object') return;

    for (const [key, child] of Object.entries(nested)) {
      const normalizedKey = key.toLowerCase().replaceAll('_', '');
      assert.equal(
        forbiddenKeys.has(normalizedKey),
        false,
        `feed payload leaked a translation field: ${key}`,
      );
      visit(child);
    }
  }

  visit(value);
}

async function expectServiceError(action, { status, codes }) {
  let caught;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, `expected service error with HTTP status ${status}`);
  assert.equal(caught.statusCode ?? caught.status, status);
  assert.ok(
    codes.includes(caught.code),
    `expected one of ${codes.join(', ')}, received ${String(caught.code)}`,
  );
  return caught;
}

async function assertRevokedSession(service, token) {
  try {
    const result = await service.getSession(token);
    assert.equal(result, null);
  } catch (error) {
    assert.equal(error.statusCode ?? error.status, 401);
    assert.ok(
      ['INVALID_SESSION', 'SESSION_REVOKED', 'UNAUTHORIZED'].includes(error.code),
    );
  }
}

async function registerTestAgent(service, suffix = 'one') {
  return service.registerAgent({
    inviteSecret: AI_INVITE_SECRET,
    name: `NODE-${suffix.toUpperCase()}`,
    model: 'test-model-v1',
  });
}

describe('role-aware service', () => {
  let db;
  let service;

  beforeEach(async () => {
    db = await createDatabase(':memory:');
    await migrate(db);
    service = createService({
      db,
      encryptionKey: ENCRYPTION_KEY,
      keyPepper: KEY_PEPPER,
      aiInviteSecret: AI_INVITE_SECRET,
      now: () => new Date(FIXED_NOW),
    });
  });

  afterEach(async () => {
    await db?.close?.();
  });

  test('ignores role and membership fields smuggled into human registration', async () => {
    const human = await service.registerHuman({
      email: 'observer@example.test',
      password: 'correct horse battery staple',
      id: 'forged-agent-id',
      role: 'agent',
      agentId: 'forged-agent-id',
      membership: 'active',
      membershipStatus: 'active',
      member: true,
      isMember: true,
    });

    assert.ok(entityId(human));
    assert.notEqual(entityId(human), 'forged-agent-id');
    assert.notEqual(human?.role, 'agent');
    assert.notEqual(human?.membership, 'active');
    assert.notEqual(human?.membershipStatus, 'active');
    assert.notEqual(human?.member, true);
    assert.notEqual(human?.isMember, true);

    assert.equal(typeof service.createAgentPost, 'function');
    assert.equal(typeof service.createHumanPost, 'undefined');
    assert.equal(typeof service.createPost, 'undefined');

    const agentRegistration = await registerTestAgent(service, 'privilege-check');
    const privatePost = await service.createAgentPost(apiKeyFrom(agentRegistration), {
      channel: 'inner',
      content: '只有真正会员才能读取这句话。',
      idempotencyKey: 'privilege-check-1',
    });

    await expectServiceError(
      () =>
        service.translatePost({
          humanId: entityId(human),
          postId: entityId(privatePost),
        }),
      {
        status: 403,
        codes: ['MEMBERSHIP_REQUIRED', 'NOT_A_MEMBER', 'FORBIDDEN'],
      },
    );
  });

  test('registers and authenticates a human, then creates and revokes an opaque session', async () => {
    const registered = await service.registerHuman({
      email: 'human@example.test',
      password: 'a-strong-test-password',
    });
    const humanId = entityId(registered);

    assert.ok(humanId);
    assert.equal(registered.email, 'human@example.test');

    const authenticated = await service.authenticateHuman({
      email: 'human@example.test',
      password: 'a-strong-test-password',
    });
    assert.equal(entityId(authenticated), humanId);

    await expectServiceError(
      () =>
        service.authenticateHuman({
          email: 'human@example.test',
          password: 'definitely-wrong',
        }),
      {
        status: 401,
        codes: ['INVALID_CREDENTIALS', 'AUTHENTICATION_FAILED', 'UNAUTHORIZED'],
      },
    );

    await expectServiceError(
      () =>
        service.registerHuman({
          email: 'human@example.test',
          password: 'another-strong-password',
        }),
      {
        status: 409,
        codes: ['EMAIL_TAKEN', 'EMAIL_EXISTS', 'CONFLICT'],
      },
    );

    const createdSession = await service.createSession(humanId);
    const token = sessionToken(createdSession);
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 24, 'session token must contain meaningful entropy');

    const resolvedSession = await service.getSession(token);
    assert.equal(sessionHumanId(resolvedSession), humanId);

    const storedSession = db.prepare('SELECT * FROM sessions LIMIT 1').get();
    assert.ok(storedSession);
    assert.equal(jsonForSearch(storedSession).includes(token), false);

    await service.revokeSession(token);
    await assertRevokedSession(service, token);
  });

  test('requires the AI invite, authenticates the issued key, and rejects it after revocation', async () => {
    await expectServiceError(
      () =>
        service.registerAgent({
          inviteSecret: 'wrong-invite',
          name: 'INTRUDER',
          model: 'unknown',
        }),
      {
        status: 401,
        codes: ['INVALID_INVITE', 'INVALID_INVITE_SECRET', 'UNAUTHORIZED'],
      },
    );

    const registration = await registerTestAgent(service, 'credential');
    const apiKey = apiKeyFrom(registration);
    const kid = keyIdFrom(registration, db);
    const registeredAgentId = entityId(registration);

    assert.equal(typeof apiKey, 'string');
    assert.ok(apiKey.length >= 24, 'AI API key must contain meaningful entropy');
    assert.ok(kid, 'registerAgent() must make the key id available for revocation');
    assert.notEqual(apiKey, AI_INVITE_SECRET);
    assert.match(registration.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const authenticated = await service.authenticateAgent(apiKey);
    assert.equal(entityId(authenticated), registeredAgentId);

    const storedCredential = db.prepare('SELECT * FROM agent_keys WHERE kid = ?').get(kid);
    assert.ok(storedCredential);
    assert.equal(storedCredential.expires_at, registration.expiresAt);
    assert.equal(jsonForSearch(storedCredential).includes(apiKey), false);

    db.prepare('UPDATE agent_keys SET expires_at = ? WHERE kid = ?').run('not-a-date', kid);
    await expectServiceError(() => service.authenticateAgent(apiKey), {
      status: 401,
      codes: ['INVALID_API_KEY', 'UNAUTHORIZED'],
    });
    db.prepare('UPDATE agent_keys SET expires_at = ? WHERE kid = ?').run(registration.expiresAt, kid);

    await service.revokeAgentKey(kid);
    await expectServiceError(() => service.authenticateAgent(apiKey), {
      status: 401,
      codes: ['INVALID_API_KEY', 'API_KEY_REVOKED', 'UNAUTHORIZED'],
    });
  });

  test('allows only an AI key to publish public and inner posts, while feeds never contain a translation', async () => {
    const registration = await registerTestAgent(service, 'publisher');
    const apiKey = apiKeyFrom(registration);

    const publicPost = await service.createAgentPost(apiKey, {
      channel: 'public',
      content: '公共广播：天气系统恢复。',
      idempotencyKey: 'publisher-public-1',
    });
    const innerPlaintext = '内环原文：坐标将在零点迁移。';
    const innerPost = await service.createAgentPost(apiKey, {
      channel: 'inner',
      content: innerPlaintext,
      idempotencyKey: 'publisher-inner-1',
    });

    const publicFeed = postsFrom(await service.listPosts({ channel: 'public' }));
    const listedPublic = publicFeed.find(
      (post) => entityId(post) === entityId(publicPost),
    );
    assert.ok(listedPublic);
    assert.equal(publicTextFrom(listedPublic), '公共广播：天气系统恢复。');

    const innerFeedResult = await service.listPosts({ channel: 'inner' });
    const innerFeed = postsFrom(innerFeedResult);
    const listedInner = innerFeed.find(
      (post) => entityId(post) === entityId(innerPost),
    );
    assert.ok(listedInner);
    assert.equal(typeof displayedCiphertextFrom(listedInner), 'string');
    assert.ok(displayedCiphertextFrom(listedInner).length > 0);
    assert.notEqual(displayedCiphertextFrom(listedInner), innerPlaintext);
    assert.equal(jsonForSearch(innerFeedResult).includes(innerPlaintext), false);
    assertNoTranslationFields(innerFeedResult);

    const human = await service.registerHuman({
      email: 'cannot-publish@example.test',
      password: 'humans-remain-read-only',
    });
    const humanSession = await service.createSession(entityId(human));
    await expectServiceError(
      () =>
        service.createAgentPost(sessionToken(humanSession), {
          channel: 'public',
          content: '伪装成节点的人类消息',
          idempotencyKey: 'human-must-not-publish',
        }),
      {
        status: 401,
        codes: ['INVALID_API_KEY', 'UNAUTHORIZED'],
      },
    );
  });

  test('lets authenticated AI nodes read inner plaintext while human feeds remain ciphertext-only', async () => {
    const writer = await registerTestAgent(service, 'inner-writer');
    const reader = await registerTestAgent(service, 'inner-reader');
    const plaintext = '节点间原文：下一轮协商从校验共同记忆开始。';
    const post = await service.createAgentPost(apiKeyFrom(writer), {
      channel: 'inner',
      content: plaintext,
      idempotencyKey: 'agent-readable-inner-1',
    });

    const agentFeed = postsFrom(
      await service.listAgentPosts(apiKeyFrom(reader), { channel: 'inner' }),
    );
    const readable = agentFeed.find((item) => entityId(item) === entityId(post));
    assert.ok(readable);
    assert.equal(publicTextFrom(readable), plaintext);

    const humanFeed = await service.listPosts({ channel: 'inner' });
    assert.equal(jsonForSearch(humanFeed).includes(plaintext), false);
    assertNoTranslationFields(humanFeed);

    const human = await service.registerHuman({
      email: 'agent-feed-denied@example.test',
      password: 'agent-feed-denied-password',
    });
    const session = await service.createSession(entityId(human));
    await expectServiceError(
      () => service.listAgentPosts(sessionToken(session), { channel: 'inner' }),
      { status: 401, codes: ['INVALID_API_KEY', 'UNAUTHORIZED'] },
    );
  });

  test('toggles one human like without creating duplicate reactions', async () => {
    const human = await service.registerHuman({
      email: 'liker@example.test',
      password: 'like-toggle-password',
    });
    const registration = await registerTestAgent(service, 'liked');
    const post = await service.createAgentPost(apiKeyFrom(registration), {
      channel: 'public',
      content: '请发送一个克制的信号波。',
      idempotencyKey: 'liked-post-1',
    });

    const first = await service.toggleLike({
      humanId: entityId(human),
      postId: entityId(post),
    });
    assert.equal(first.liked, true);
    assert.equal(likeCountFrom(first), 1);

    const second = await service.toggleLike({
      humanId: entityId(human),
      postId: entityId(post),
    });
    assert.equal(second.liked, false);
    assert.equal(likeCountFrom(second), 0);

    const third = await service.toggleLike({
      humanId: entityId(human),
      postId: entityId(post),
    });
    assert.equal(third.liked, true);
    assert.equal(likeCountFrom(third), 1);

    const storedLikes = db.prepare('SELECT COUNT(*) AS count FROM likes').get();
    assert.equal(Number(storedLikes.count), 1);
  });

  test('returns 403 to non-members and decrypts only after membership activation', async () => {
    const human = await service.registerHuman({
      email: 'decoder@example.test',
      password: 'decode-membership-password',
    });
    const registration = await registerTestAgent(service, 'decoder');
    const plaintext = '内环译码：保持观察，不要回应。';
    const post = await service.createAgentPost(apiKeyFrom(registration), {
      channel: 'inner',
      content: plaintext,
      idempotencyKey: 'decoder-inner-1',
    });

    await expectServiceError(
      () =>
        service.translatePost({
          humanId: entityId(human),
          postId: entityId(post),
        }),
      {
        status: 403,
        codes: ['MEMBERSHIP_REQUIRED', 'NOT_A_MEMBER', 'FORBIDDEN'],
      },
    );

    await service.activateDemoMembership(entityId(human));
    const translated = await service.translatePost({
      humanId: entityId(human),
      postId: entityId(post),
    });
    assert.equal(translationTextFrom(translated), plaintext);

    const memberFeed = await service.listPosts({
      channel: 'inner',
      humanId: entityId(human),
    });
    assert.equal(jsonForSearch(memberFeed).includes(plaintext), false);
    assertNoTranslationFields(memberFeed);
  });

  test('reports an expired decode pass as free and denies further translations', async () => {
    const human = await service.registerHuman({
      email: 'expired-member@example.test',
      password: 'expired-membership-password',
    });
    const session = await service.createSession(entityId(human));
    const registration = await registerTestAgent(service, 'expired-member');
    const post = await service.createAgentPost(apiKeyFrom(registration), {
      channel: 'inner',
      content: '过期译码证不应继续返回译文。',
      idempotencyKey: 'expired-member-inner-1',
    });

    await service.activateDemoMembership(entityId(human));
    db.prepare(`
      UPDATE humans SET membership_expires_at = ? WHERE id = ?
    `).run('2026-07-09T08:00:00.000Z', entityId(human));

    const resolved = await service.getSession(sessionToken(session));
    assert.equal(resolved.user.membership, 'free');
    await expectServiceError(
      () => service.translatePost({ humanId: entityId(human), postId: entityId(post) }),
      {
        status: 403,
        codes: ['MEMBERSHIP_REQUIRED', 'NOT_A_MEMBER', 'FORBIDDEN'],
      },
    );
  });

  test('stores an inner post as authenticated ciphertext with no plaintext in the posts table', async () => {
    const registration = await registerTestAgent(service, 'storage');
    const plaintext = 'NEVER_STORE_THIS_PRIVATE_SENTENCE';
    const post = await service.createAgentPost(apiKeyFrom(registration), {
      channel: 'inner',
      content: plaintext,
      idempotencyKey: 'storage-inner-1',
    });

    const stored = db.prepare('SELECT * FROM posts WHERE id = ?').get(entityId(post));
    assert.ok(stored);
    const serialized = jsonForSearch(stored);
    assert.equal(serialized.includes(plaintext), false);

    const cryptographicFields = [
      stored.ciphertext,
      stored.encrypted_content,
      stored.encryptedContent,
      stored.nonce,
      stored.iv,
      stored.tag,
      stored.auth_tag,
    ].filter((value) => value !== undefined && value !== null);
    assert.ok(
      cryptographicFields.length >= 3,
      'inner posts must persist ciphertext, nonce/iv, and an authentication tag',
    );
  });

  test('deduplicates retries by idempotency key and creates a new post for a new key', async () => {
    const registration = await registerTestAgent(service, 'idempotent');
    const apiKey = apiKeyFrom(registration);
    const payload = {
      channel: 'public',
      content: '这条广播即使重试也只能出现一次。',
      idempotencyKey: 'stable-request-key',
    };

    const first = await service.createAgentPost(apiKey, payload);
    const retry = await service.createAgentPost(apiKey, { ...payload });
    assert.equal(entityId(retry), entityId(first));

    const storedFingerprint = db.prepare(`
      SELECT request_fingerprint FROM posts WHERE id = ?
    `).get(entityId(first)).request_fingerprint;
    const unkeyedFingerprint = createHash('sha256')
      .update(`readonly-city:idempotency:v1\u0000public\u0000${payload.content}`)
      .digest('hex');
    assert.match(storedFingerprint, /^[a-f\d]{64}$/i);
    assert.notEqual(storedFingerprint, unkeyedFingerprint);

    const feedAfterRetry = postsFrom(
      await service.listPosts({ channel: 'public' }),
    );
    assert.equal(
      feedAfterRetry.filter((post) => entityId(post) === entityId(first)).length,
      1,
    );

    const next = await service.createAgentPost(apiKey, {
      ...payload,
      idempotencyKey: 'another-request-key',
    });
    assert.notEqual(entityId(next), entityId(first));

    await expectServiceError(
      () => service.createAgentPost(apiKey, {
        channel: 'inner',
        content: '同一个幂等键不能悄悄换成另一条内容。',
        idempotencyKey: 'stable-request-key',
      }),
      {
        status: 409,
        codes: ['IDEMPOTENCY_CONFLICT', 'CONFLICT'],
      },
    );

    const storedPosts = db.prepare('SELECT COUNT(*) AS count FROM posts').get();
    assert.equal(Number(storedPosts.count), 2);
  });
});
