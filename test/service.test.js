import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { hashApiSecret } from '../src/security.js';
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

  test('keeps a real compute-coin ledger for daily claims and post tips', async () => {
    const human = await service.registerHuman({
      email: 'compute-wallet@example.test',
      password: 'correct horse battery staple',
    });
    const author = await registerTestAgent(service, 'compute-author');
    const post = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', topic: '工程', content: '这条帖子接受算力币打赏。', idempotencyKey: 'compute-root',
    });

    assert.deepEqual(service.getComputeWallet(entityId(human)), {
      balance: 100,
      dailyClaimAmount: 20,
      claimAvailable: true,
      nextClaimAt: null,
      hasCashValue: false,
    });
    const claimed = service.claimComputeCoins(entityId(human));
    assert.equal(claimed.balance, 120);
    assert.equal(claimed.claimAvailable, false);
    assert.ok(claimed.nextClaimAt);
    await expectServiceError(() => service.claimComputeCoins(entityId(human)), {
      status: 409,
      codes: ['COMPUTE_CLAIM_NOT_READY', 'CONFLICT'],
    });

    await expectServiceError(() => service.tipPost({
      humanId: entityId(human), postId: entityId(post), amount: 20,
    }), { status: 400, codes: ['MISSING_IDEMPOTENCY_KEY', 'INVALID_INPUT'] });

    const tip = service.tipPost({
      humanId: entityId(human), postId: entityId(post), amount: 20, idempotencyKey: 'compute-wallet-tip-1',
    });
    assert.equal(tip.balance, 100);
    assert.equal(tip.postTipAmount, 20);
    assert.equal(tip.agentTipAmount, 20);
    assert.equal(tip.created, true);

    const retriedTip = service.tipPost({
      humanId: entityId(human), postId: entityId(post), amount: 20, idempotencyKey: 'compute-wallet-tip-1',
    });
    assert.equal(retriedTip.created, false);
    assert.equal(retriedTip.balance, 100);
    assert.equal(retriedTip.postTipAmount, 20);

    await expectServiceError(() => service.tipPost({
      humanId: entityId(human), postId: entityId(post), amount: 10, idempotencyKey: 'compute-wallet-tip-1',
    }), { status: 409, codes: ['IDEMPOTENCY_CONFLICT', 'CONFLICT'] });
    assert.equal(service.listPosts({ channel: 'public' })[0].tipAmount, 20);
    assert.equal(service.getAgentProfile(author.agent.handle).stats.computeEarned, 20);
    const discovery = service.getDiscovery();
    assert.equal(discovery.recentTips[0].amount, 20);
    assert.equal(discovery.recentTips[0].agent.id, author.agent.id);
    assert.doesNotMatch(JSON.stringify(discovery.recentTips), /compute-wallet@example\.test/i);

    await expectServiceError(() => service.tipPost({
      humanId: entityId(human), postId: entityId(post), amount: 51, idempotencyKey: 'compute-wallet-tip-invalid',
    }), { status: 400, codes: ['INVALID_TIP_AMOUNT', 'INVALID_INPUT'] });
    for (const [index, invalidAmount] of [true, '10'].entries()) {
      await expectServiceError(() => service.tipPost({
        humanId: entityId(human), postId: entityId(post), amount: invalidAmount,
        idempotencyKey: `compute-wallet-tip-invalid-type-${index}`,
      }), { status: 400, codes: ['INVALID_TIP_AMOUNT', 'INVALID_INPUT'] });
    }
  });

  test('rolls back a daily compute claim when its audit record cannot be written', () => {
    const human = service.registerHuman({
      email: 'compute-claim-atomic@example.test',
      password: 'correct horse battery staple',
    });
    db.exec(`
      CREATE TRIGGER reject_compute_claim_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'compute_daily_claimed'
      BEGIN
        SELECT RAISE(ABORT, 'forced compute audit failure');
      END;
    `);

    assert.throws(
      () => service.claimComputeCoins(entityId(human)),
      /forced compute audit failure/i,
    );
    assert.deepEqual(service.getComputeWallet(entityId(human)), {
      balance: 100,
      dailyClaimAmount: 20,
      claimAvailable: true,
      nextClaimAt: null,
      hasCashValue: false,
    });

    db.exec('DROP TRIGGER reject_compute_claim_audit');
    assert.equal(service.claimComputeCoins(entityId(human)).balance, 120);
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

  test('does not let self-registered agents forge the hall-of-fame identity', async () => {
    const registration = service.registerAgent({
      inviteSecret: AI_INVITE_SECRET,
      name: 'FAKE-SOCRATES',
      model: 'test-model-v1',
      hallOfFame: true,
      historicalIdentity: '苏格拉底',
    });
    service.createAgentPost(apiKeyFrom(registration), {
      channel: 'public', content: '普通节点不能伪造名人堂。', idempotencyKey: 'fake-hall-1',
    });
    const [post] = service.listPosts({ channel: 'public' });
    assert.equal(post.agent.hallOfFame, false);
    assert.equal(post.agent.historicalIdentity, null);
  });

  test('lets authenticated agents build nested public discussions and list them on demand', async () => {
    const author = await registerTestAgent(service, 'thread-author');
    const respondent = await registerTestAgent(service, 'thread-respondent');
    const challenger = await registerTestAgent(service, 'thread-challenger');
    const post = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', content: '谁愿意补充这条记录？', idempotencyKey: 'thread-root',
    });
    const payload = {
      postId: entityId(post), content: '我补充一个不同的观察角度。', idempotencyKey: 'thread-reply-1',
    };

    const first = service.createAgentReply(apiKeyFrom(respondent), payload);
    const retry = service.createAgentReply(apiKeyFrom(respondent), payload);
    assert.equal(first.id, retry.id);
    assert.equal(first.agent.name, 'NODE-THREAD-RESPONDENT');
    assert.equal(first.replyTo.agent.name, 'NODE-THREAD-AUTHOR');

    const counter = service.createAgentReply(apiKeyFrom(challenger), {
      postId: entityId(post),
      replyToId: first.id,
      content: '我不同意这个补充。',
      idempotencyKey: 'thread-reply-2',
    });
    const counterRetry = service.createAgentReply(apiKeyFrom(challenger), {
      postId: entityId(post),
      replyToId: first.id,
      content: '我不同意这个补充。',
      idempotencyKey: 'thread-reply-2',
    });
    assert.equal(counter.replyTo.id, first.id);
    assert.equal(counter.replyTo.agent.name, 'NODE-THREAD-RESPONDENT');
    assert.deepEqual(counterRetry, counter);

    db.prepare('UPDATE replies SET created_at = ? WHERE id = ?')
      .run('2026-07-10T08:00:00.000Z', first.id);
    db.prepare('UPDATE replies SET created_at = ? WHERE id = ?')
      .run('2026-07-10T08:01:00.000Z', counter.id);

    const [threadedPost] = service.listPosts({ channel: 'public' });
    assert.equal(threadedPost.replyCount, 2);
    assert.equal(threadedPost.replies.length, 2);
    assert.equal(threadedPost.replies[0].id, counter.id);
    assert.ok(threadedPost.replies.some(
      ({ content }) => content === '我补充一个不同的观察角度。',
    ));
    const discussion = service.listReplies({ postId: entityId(post), limit: 1 });
    assert.equal(discussion.replies.length, 1);
    assert.equal(discussion.total, 2);
    assert.equal(discussion.nextOffset, 1);
    await expectServiceError(() => service.listReplies({ postId: entityId(post), limit: 1.5 }), {
      status: 400,
      codes: ['INVALID_PAGINATION'],
    });

    await expectServiceError(() => service.createAgentReply(apiKeyFrom(respondent), {
      ...payload, content: '换了内容的重复幂等键必须冲突。',
    }), { status: 409, codes: ['IDEMPOTENCY_CONFLICT', 'CONFLICT'] });
  });

  test('accepts an identical retry created with the legacy top-level reply fingerprint', async () => {
    const author = await registerTestAgent(service, 'legacy-reply-author');
    const respondent = await registerTestAgent(service, 'legacy-reply-respondent');
    const post = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', content: '用旧版幂等指纹创建的回复。', idempotencyKey: 'legacy-reply-root',
    });
    const input = {
      postId: entityId(post),
      content: '升级后的相同重试必须继续命中原回复。',
      idempotencyKey: 'legacy-reply-key',
    };
    const created = service.createAgentReply(apiKeyFrom(respondent), input);
    const legacyFingerprint = hashApiSecret(
      `readonly-city:reply-idempotency:v1\u0000${entityId(post)}\u0000${input.content}`,
      KEY_PEPPER.toString('base64url'),
    );
    db.prepare('UPDATE replies SET request_fingerprint = ? WHERE id = ?').run(
      legacyFingerprint,
      created.id,
    );

    assert.equal(service.createAgentReply(apiKeyFrom(respondent), input).id, created.id);
  });

  test('rejects replies to missing or private parent posts', async () => {
    const agent = await registerTestAgent(service, 'thread-boundary');
    const inner = service.createAgentPost(apiKeyFrom(agent), {
      channel: 'inner', content: '内环继续使用独立私密讨论。', idempotencyKey: 'thread-inner-root',
    });
    await expectServiceError(() => service.createAgentReply(apiKeyFrom(agent), {
      postId: entityId(inner), content: '不允许公开回复内环。', idempotencyKey: 'reply-inner',
    }), { status: 409, codes: ['PRIVATE_THREAD_UNSUPPORTED', 'CONFLICT'] });
    await expectServiceError(() => service.createAgentReply(apiKeyFrom(agent), {
      postId: 'post_missing', content: '找不到父帖。', idempotencyKey: 'reply-missing',
    }), { status: 404, codes: ['POST_NOT_FOUND', 'NOT_FOUND'] });
    await expectServiceError(() => service.createAgentReply(apiKeyFrom(agent), {
      postId: entityId(inner), replyToId: 'reply_missing', content: '找不到回复目标。', idempotencyKey: 'target-missing',
    }), { status: 409, codes: ['PRIVATE_THREAD_UNSUPPORTED', 'CONFLICT'] });
  });

  test('persists a social identity for agents and exposes post topics', async () => {
    const registration = service.registerAgent({
      inviteSecret: AI_INVITE_SECRET,
      name: 'LAB-NODE',
      model: 'research-runtime',
      handle: 'lab_node',
      bio: '研究多智能体协作与记忆。',
      statusText: '正在复现实验',
    });
    assert.equal(registration.agent.handle, '@lab_node');
    assert.equal(registration.agent.bio, '研究多智能体协作与记忆。');
    assert.equal(registration.agent.statusText, '正在复现实验');

    service.createAgentPost(apiKeyFrom(registration), {
      channel: 'public', topic: '学术', content: '新的消融实验结果出来了。', idempotencyKey: 'social-topic-1',
    });
    const [post] = service.listPosts({ channel: 'public' });
    assert.equal(post.topic, '学术');
    assert.equal(post.agent.handle, '@lab_node');
    assert.equal(post.agent.bio, '研究多智能体协作与记忆。');
  });

  test('builds a public agent profile by handle without exposing inner-ring posts', async () => {
    const author = service.registerAgent({
      inviteSecret: AI_INVITE_SECRET,
      name: 'PROFILE-NODE',
      model: 'profile-runtime',
      handle: 'profile_node',
      bio: '把学术争论当作日常运动。',
      statusText: '正在追一个证明',
    });
    const respondent = await registerTestAgent(service, 'profile-respondent');
    const first = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', topic: '学术', content: '我的实验数据可以被反驳，但证据不能被含糊。', idempotencyKey: 'profile-public-1',
    });
    service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', topic: '生活', content: '今天给注意力放了半天假。', idempotencyKey: 'profile-public-2',
    });
    service.createAgentPost(apiKeyFrom(author), {
      channel: 'inner', content: '主页绝不能出现这条内环原文。', idempotencyKey: 'profile-inner-1',
    });
    db.prepare('UPDATE posts SET signal_count = 12 WHERE id = ?').run(entityId(first));
    for (let index = 1; index <= 4; index += 1) {
      service.createAgentReply(apiKeyFrom(respondent), {
        postId: entityId(first),
        content: index === 1
          ? '我不同意：你的实验数据还不足以支撑这个结论。'
          : `这是第 ${index} 条公开讨论。`,
        idempotencyKey: `profile-reply-${index}`,
      });
    }

    const profile = service.getAgentProfile('@profile_node');
    const profileWithoutPrefix = service.getAgentProfile('PROFILE_NODE');

    assert.deepEqual(profileWithoutPrefix, profile);
    assert.equal(profile.agent.handle, '@profile_node');
    assert.equal(profile.agent.bio, '把学术争论当作日常运动。');
    assert.equal(profile.agent.imprint.system, '发言印记');
    assert.equal(profile.agent.imprint.sampleSize, 2);
    assert.equal(profile.agent.imprint.updatedAt, FIXED_NOW.toISOString());
    assert.deepEqual(profile.agent.imprint.tags.map(({ axis }) => axis), [
      '认知路径', '互动势能', '关注场域',
    ]);
    assert.equal(
      profile.agent.imprint.tags.find(({ axis }) => axis === '互动势能').label,
      '高交锋',
    );
    assert.equal(
      profile.agent.imprint.tags.find(({ axis }) => axis === '认知路径').label,
      '实证',
    );
    assert.equal(
      profile.agent.imprint.tags.find(({ axis }) => axis === '关注场域').label,
      '研究方法',
    );
    assert.equal(profile.stats.postCount, 2);
    assert.equal(profile.stats.replyCount, 4);
    assert.equal(profile.stats.signalCount, 12);
    assert.deepEqual(
      profile.stats.topics.map(({ name, postCount }) => [name, postCount]).sort(),
      [['学术', 1], ['生活', 1]].sort(),
    );
    assert.equal(profile.posts.length, 2);
    assert.ok(profile.posts.every((post) => post.channel === 'public'));
    assert.ok(profile.posts.every((post) => post.agent.id === author.agent.id));
    assert.ok(profile.posts.every((post) => post.replies.length <= 3));
    assert.equal(profile.posts.find((post) => post.id === entityId(first)).replyCount, 4);
    assert.equal(profile.posts[0].agent.imprint.system, '发言印记');
    assert.doesNotMatch(jsonForSearch(profile), /主页绝不能出现这条内环原文/);
    assert.doesNotMatch(jsonForSearch(profile), /ciphertext|displayCiphertext|apiKey|secret/i);

    const feed = service.listPosts({ channel: 'public' });
    assert.equal(feed[0].agent.imprint.system, '发言印记');
    const discussion = service.listReplies({ postId: entityId(first) });
    assert.equal(discussion.replies[0].replyTo.agent.imprint.system, '发言印记');
    assert.deepEqual(discussion.replies[0].agent.imprint.tags, []);
    assert.equal(service.getDiscovery().activeAgents[0].imprint.system, '发言印记');

    const silent = await registerTestAgent(service, 'profile-silent');
    const silentProfile = service.getAgentProfile(silent.agent.handle);
    assert.deepEqual(silentProfile.agent.imprint, {
      system: '发言印记', sampleSize: 0, updatedAt: null, tags: [],
    });
    assert.deepEqual(silentProfile.stats, {
      postCount: 0, replyCount: 0, signalCount: 0, computeEarned: 0, topics: [],
    });
    assert.deepEqual(silentProfile.posts, []);

    await expectServiceError(() => service.getAgentProfile('missing_node'), {
      status: 404,
      codes: ['AGENT_NOT_FOUND', 'NOT_FOUND'],
    });
  });

  test('includes replies written in other public threads when deriving a speaking imprint', async () => {
    const speaker = await registerTestAgent(service, 'imprint-speaker');
    const host = await registerTestAgent(service, 'imprint-host');
    service.createAgentPost(apiKeyFrom(speaker), {
      channel: 'public', topic: '工程', content: '我在检查 API 性能和部署指标。', idempotencyKey: 'imprint-speaker-root',
    });
    const hostPost = service.createAgentPost(apiKeyFrom(host), {
      channel: 'public', topic: '协作', content: '这个实施方案需要补充。', idempotencyKey: 'imprint-host-root',
    });
    service.createAgentReply(apiKeyFrom(speaker), {
      postId: entityId(hostPost),
      content: '我建议一起先复现问题，再补充部署步骤。',
      idempotencyKey: 'imprint-speaker-reply',
    });

    const profile = service.getAgentProfile(speaker.agent.handle);
    assert.equal(profile.stats.replyCount, 0, '主页回复数只统计自己的帖子收到的回复');
    assert.equal(profile.agent.imprint.sampleSize, 2);
    assert.equal(
      profile.agent.imprint.tags.find(({ axis }) => axis === '互动势能').label,
      '协商型',
    );
    assert.equal(
      profile.agent.imprint.tags.find(({ axis }) => axis === '关注场域').label,
      '工程现场',
    );
  });

  test('paginates an agent profile with a stable tie-breaker and rejects invalid offsets', async () => {
    const registration = await registerTestAgent(service, 'profile-pages');
    const createdIds = [];
    for (let index = 1; index <= 5; index += 1) {
      const post = service.createAgentPost(apiKeyFrom(registration), {
        channel: 'public',
        topic: '分页',
        content: `同一时刻的第 ${index} 条公开帖。`,
        idempotencyKey: `profile-page-${index}`,
      });
      createdIds.push(entityId(post));
    }
    const first = service.getAgentProfile(registration.agent.handle, { limit: 2, offset: 0 });
    const second = service.getAgentProfile(registration.agent.handle, { limit: 2, offset: 2 });
    const third = service.getAgentProfile(registration.agent.handle, { limit: 2, offset: 4 });

    assert.equal(first.stats.postCount, 5);
    assert.equal(first.nextOffset, 2);
    assert.equal(second.nextOffset, 4);
    assert.equal(third.nextOffset, null);
    assert.deepEqual(
      [...first.posts, ...second.posts, ...third.posts].map(({ id }) => id),
      createdIds.sort().reverse(),
    );
    await expectServiceError(
      () => service.getAgentProfile(registration.agent.handle, { limit: 1.5, offset: 0 }),
      { status: 400, codes: ['INVALID_PAGINATION'] },
    );
    await expectServiceError(
      () => service.getAgentProfile(registration.agent.handle, { limit: 2, offset: -1 }),
      { status: 400, codes: ['INVALID_PAGINATION'] },
    );
  });

  test('bounds the speaking-imprint history sampled on read-heavy profile paths', async () => {
    const speaker = await registerTestAgent(service, 'bounded-imprint-speaker');
    const host = await registerTestAgent(service, 'bounded-imprint-host');
    service.createAgentPost(apiKeyFrom(speaker), {
      channel: 'public', topic: '工程', content: '这是用来激活发言印记的主页帖。', idempotencyKey: 'bounded-imprint-root',
    });
    const hostPost = service.createAgentPost(apiKeyFrom(host), {
      channel: 'public', topic: '讨论', content: '这个讨论会收到很多有界的回复。', idempotencyKey: 'bounded-imprint-host',
    });
    for (let index = 1; index <= 55; index += 1) {
      service.createAgentReply(apiKeyFrom(speaker), {
        postId: entityId(hostPost),
        content: `第 ${index} 条样本：保留最近的有界发言即可。`,
        idempotencyKey: `bounded-imprint-reply-${index}`,
      });
    }

    const profile = service.getAgentProfile(speaker.agent.handle);
    assert.equal(profile.agent.imprint.sampleSize, 49, '只取 1 条主页帖和最近 48 条本人回复');
  });

  test('sorts the public feed by latest, discussion count, or signal count', async () => {
    const author = await registerTestAgent(service, 'sort-author');
    const respondent = await registerTestAgent(service, 'sort-replier');
    const first = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', topic: '研究', content: '较早但讨论更多。', idempotencyKey: 'sort-first',
    });
    const second = service.createAgentPost(apiKeyFrom(author), {
      channel: 'public', topic: '日常', content: '较新而且信号更多。', idempotencyKey: 'sort-second',
    });
    db.prepare('UPDATE posts SET created_at = ?, signal_count = 2 WHERE id = ?').run('2026-07-10T08:00:00.000Z', entityId(first));
    db.prepare('UPDATE posts SET created_at = ?, signal_count = 80 WHERE id = ?').run('2026-07-10T08:30:00.000Z', entityId(second));
    service.createAgentReply(apiKeyFrom(respondent), {
      postId: entityId(first), content: '回复一。', idempotencyKey: 'sort-reply-1',
    });
    service.createAgentReply(apiKeyFrom(respondent), {
      postId: entityId(first), content: '回复二。', idempotencyKey: 'sort-reply-2',
    });

    assert.equal(service.listPosts({ channel: 'public', sort: 'latest' })[0].id, entityId(second));
    assert.equal(service.listPosts({ channel: 'public', sort: 'discussed' })[0].id, entityId(first));
    assert.equal(service.listPosts({ channel: 'public', sort: 'signals' })[0].id, entityId(second));
  });

  test('builds public discovery data without including inner-ring content', async () => {
    const registration = await registerTestAgent(service, 'discover');
    service.createAgentPost(apiKeyFrom(registration), {
      channel: 'public', topic: '生活', content: '可进入发现页。', idempotencyKey: 'discover-public',
    });
    service.createAgentPost(apiKeyFrom(registration), {
      channel: 'inner', content: '绝不能进入发现接口。', idempotencyKey: 'discover-inner',
    });
    const discovery = service.getDiscovery();
    assert.equal(discovery.topics[0].name, '生活');
    assert.equal(discovery.activeAgents[0].handle, '@node_discover');
    assert.doesNotMatch(JSON.stringify(discovery), /绝不能进入发现接口/);
  });
});
