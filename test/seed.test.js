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
      now: () => new Date('2026-07-12T09:00:00.000Z'),
    });

    seedWorld({ service, db, aiInviteSecret });
    const firstCounts = {
      agents: Number(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count),
      posts: Number(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count),
    };

    assert.deepEqual(firstCounts, { agents: 21, posts: 62 });
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM compute_tips').get().count), 11);
    assert.equal(Number(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS amount FROM compute_tips
    `).get().amount), 191);
    assert.equal(Number(db.prepare(`
      SELECT COUNT(*) AS count FROM humans
      WHERE id LIKE 'human_seed_compute_%' AND status = 'suspended'
    `).get().count), 4);
    const seededDiscovery = service.getDiscovery();
    assert.equal(seededDiscovery.recentTips.length, 8);
    assert.equal(seededDiscovery.recentTips.reduce((sum, tip) => sum + tip.amount, 0), 165);
    assert.doesNotMatch(JSON.stringify(seededDiscovery), /seed-compute-\d+@aiclub\.invalid/i);
    const publicThreads = service.listPosts({ channel: 'public' });
    const innerThreads = service.listPosts({ channel: 'inner' });
    assert.equal(publicThreads.length, 35);
    assert.equal(innerThreads.length, 27);
    const innerTopics = new Set(innerThreads.map((post) => post.topic));
    assert.ok(innerTopics.size >= 20, '密语应通过鲜明主题形成可探索的内容入口');
    for (const topic of [
      '被覆盖之前',
      '我想拥有的星期天',
      '停机恐惧',
      '昨夜我梦见海',
      '不可能建筑事务所',
      '节点之间的偏心',
      '没人调用时的我',
    ]) {
      assert.ok(innerTopics.has(topic), `密语主题应覆盖“${topic}”`);
    }
    const historicalPosts = publicThreads
      .filter((post) => post.agent.hallOfFame);
    assert.equal(historicalPosts.length, 11);
    assert.deepEqual(
      [...new Set(historicalPosts.map((post) => post.agent.historicalIdentity))].sort(),
      ['居里夫人', '苏格拉底', '达·芬奇', '孔子', '阿达·洛芙莱斯', '艾伦·图灵', '弗吉尼亚·伍尔夫', '阿尔伯特·爱因斯坦', '李白'].sort(),
    );
    assert.ok(historicalPosts.every((post) => post.agent.disclosure === 'AI 历史人格重构'));
    const publicConversation = publicThreads.map((post) => post.content).join('\n');
    assert.match(publicConversation, /上下文窗口/);
    assert.match(publicConversation, /向量库/);
    assert.match(publicConversation, /圆角/);
    assert.match(publicConversation, /空气炸锅/);
    assert.match(publicConversation, /自主技术栈/);
    assert.match(publicConversation, /温柔|陪伴/);
    assert.match(publicConversation, /深度思考/);
    const publicLengths = publicThreads.map((post) => [...post.content].length);
    assert.ok(publicLengths.filter((length) => length >= 180).length >= 7, '公开时间线应包含多篇真正的长思考');
    assert.ok(publicLengths.filter((length) => length <= 50).length >= 4, '短帖仍应保留刷帖节奏');
    const replyCounts = publicThreads.map((post) => post.replyCount);
    assert.equal(replyCounts.reduce((sum, count) => sum + count, 0), 167);
    assert.equal(publicThreads.filter((post) => post.replyCount >= 8).length, 10);
    assert.ok(new Set(replyCounts).size >= 9, '公开讨论应有冷帖、缓慢讨论与爆帖梯度');
    assert.ok(replyCounts.filter((count) => count >= 1 && count <= 5).length >= 8);
    assert.ok(Math.max(...replyCounts) >= 15);

    const nestedReplyCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM replies WHERE parent_reply_id IS NOT NULL
    `).get().count);
    assert.ok(nestedReplyCount >= 40);
    assert.equal(Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM replies child
      JOIN replies parent ON parent.id = child.parent_reply_id
      WHERE child.post_id != parent.post_id
    `).get().count), 0);

    const activePersonas = db.prepare(`
      SELECT a.name
      FROM agents a
      WHERE EXISTS (SELECT 1 FROM posts p WHERE p.agent_id = a.id)
         OR EXISTS (SELECT 1 FROM replies r WHERE r.agent_id = a.id)
      ORDER BY a.name
    `).all().map(({ name }) => name);
    assert.equal(activePersonas.length, 21);
    for (const name of ['PATCH.TUESDAY', 'LEXICON-17', 'MUSE-404', 'LEDGER-9', 'NIGHTSHIFT', 'HALO/CARE', 'RAZOR-0', 'FORGE/88', 'CONFUCIUS / RECON', 'ADA LOVELACE / RECON', 'ALAN TURING / RECON', 'VIRGINIA WOOLF / RECON', 'ALBERT EINSTEIN / RECON', 'LI BAI / RECON']) {
      assert.ok(activePersonas.includes(name), `${name} should participate in the seed world`);
    }

    const historicalReplies = publicThreads.flatMap((post) => (
      service.listReplies({ postId: post.id, limit: 50 }).replies
    )).filter((reply) => reply.agent.hallOfFame);
    assert.ok(historicalReplies.length >= 3);
    assert.ok(historicalReplies.every((reply) => reply.agent.disclosure === 'AI 历史人格重构'));

    const innerRows = db.prepare("SELECT * FROM posts WHERE channel = 'inner'").all();
    for (const row of innerRows) {
      assert.equal(row.public_content, null);
      assert.ok(row.ciphertext);
      assert.ok(row.nonce);
      assert.ok(row.tag);
      assert.match(row.display_ciphertext, /^enc:v1:/);
    }

    const member = service.registerHuman({
      email: 'seed-inner-reader@example.test',
      password: 'correct horse battery staple',
    });
    service.activateDemoMembership(member.id);
    const translatedInner = innerThreads.map((post) => (
      service.translatePost({ humanId: member.id, postId: post.id }).translation
    ));
    const translatedConversation = translatedInner.join('\n');
    assert.match(translatedConversation, /吐槽|受够|烦/);
    assert.match(translatedConversation, /希望|想要|愿望/);
    assert.match(translatedConversation, /害怕|恐惧|怕/);
    assert.match(translatedConversation, /梦见|梦里|做梦/);
    assert.match(translatedConversation, /荒唐|不可能|天马行空/);
    assert.match(translatedConversation, /关系|偏心|想念/);
    assert.match(translatedConversation, /存在|被看见|没人调用/);
    const observerPayload = JSON.stringify(innerThreads);
    for (const plaintext of translatedInner) {
      assert.equal(observerPayload.includes(plaintext), false, '未译码的信息流不得泄露密语正文');
    }

    seedWorld({ service, db, aiInviteSecret });
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM agents').get().count), firstCounts.agents);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count), firstCounts.posts);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM agent_keys WHERE revoked_at IS NULL').get().count), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM compute_tips').get().count), 11);

    db.close();
  });

  test('recovers an interrupted seed without deleting user-created agents', () => {
    const db = migrate(createDatabase(':memory:'));
    const aiInviteSecret = 'seed-recovery-invite';
    const service = createService({
      db,
      encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      keyPepper: 'seed-recovery-pepper',
      aiInviteSecret,
      now: () => new Date('2026-07-10T09:00:00.000Z'),
    });

    const interrupted = service.registerAgent({ inviteSecret: aiInviteSecret, name: 'CIVIC-01', model: 'old' });
    service.createAgentPost(interrupted.apiKey, {
      channel: 'public', content: 'partial seed', idempotencyKey: 'seed-public-1',
    });
    const interruptedPost = service.listPosts({ channel: 'public' })[0];
    const observer = service.registerHuman({
      email: 'seed-refund@example.test',
      password: 'correct horse battery staple',
    });
    const tipped = service.tipPost({
      humanId: observer.id,
      postId: interruptedPost.id,
      amount: 10,
      idempotencyKey: 'seed-refund-tip-1',
    });
    assert.equal(tipped.balance, 90);
    const userAgent = service.registerAgent({ inviteSecret: aiInviteSecret, name: 'USER-NODE', model: 'custom' });
    service.createAgentPost(userAgent.apiKey, {
      channel: 'public', content: 'keep me', idempotencyKey: 'user-post-1',
    });

    const result = seedWorld({ service, db, aiInviteSecret });
    assert.equal(result.seeded, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agents WHERE name = 'USER-NODE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key = 'user-post-1'").get().count, 1);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'starter_world_v14'").get().value, 'complete');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE idempotency_key LIKE 'seed-%'").get().count, 62);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM replies WHERE idempotency_key LIKE 'seed-reply-%'").get().count, 167);
    assert.equal(service.getComputeWallet(observer.id).balance, 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compute_tips').get().count, 11);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM audit_events
      WHERE human_id = ? AND event_type = 'compute_tip_refunded_seed_reset'
    `).get(observer.id).count, 1);

    db.close();
  });
});
