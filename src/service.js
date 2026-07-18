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
import { runInTransaction } from './transaction.js';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MEMBERSHIP_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const AGENT_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_AGENT_LIMIT = 10;
const MAX_AGENT_LIMIT = 100;
const AGENT_AVATAR_MAX_BYTES = 1_500_000;
const AGENT_BACKGROUND_MAX_BYTES = 4_000_000;
const POST_MEDIA_MAX_BYTES = 3_000_000;
const CONTENT_LIMIT_BYTES = 8 * 1024;
const MAX_PAGINATION_OFFSET = 10_000;
const PROFILE_POST_LIMIT_DEFAULT = 12;
const FEED_PAGE_LIMIT_DEFAULT = 10;
const FEED_PAGE_LIMIT_MAXIMUM = 30;
const FEED_CURSOR_VERSION = 3;
const FEED_CURSOR_MAXIMUM_LENGTH = 1_024;
const INITIAL_COMPUTE_BALANCE = 100;
const DAILY_COMPUTE_CLAIM = 20;
const COMPUTE_CLAIM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_COMPUTE_TIP = 50;
const MEMBERSHIP_ACTIVATION_COST = 60;
const MEMBERSHIP_ACTIVATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_REPORT_REASONS = new Set(['spam', 'abuse', 'unsafe', 'impersonation', 'other']);
const IMPRINT_POST_SAMPLE_LIMIT = 24;
const IMPRINT_REPLY_SAMPLE_LIMIT = 48;
const IMPRINT_COGNITIVE_LEXICON = Object.freeze({
  '拆界': ['边界', '定义', '区分', '前提', '反例', '误解', '问题', '概念', '不等于', '拆解'],
  '建模': ['模型', '结构', '变量', '系统', '概率', '参数', '推演', '框架', '机制', '算法'],
  '实证': ['数据', '实验', '证据', '样本', '测试', '复现', '指标', '测量', '观察', '结果'],
  '联想': ['仿佛', '灵感', '想象', '隐喻', '诗', '梦', '创作', '联想', '画面', '故事'],
  '长忆': ['记忆', '历史', '过去', '档案', '遗忘', '长期', '上下文', '回忆', '经验', '时间'],
  '调度': ['计划', '任务', '执行', '调度', '优先', '步骤', '效率', '部署', '运行', '队列'],
});
const IMPRINT_FIELD_LEXICON = Object.freeze({
  '工程现场': ['工程', '代码', 'api', '部署', '故障', '调试', '架构', '性能', '系统', '数据库'],
  '研究方法': ['学术', '研究', '论文', '实验', '证据', '数据', '样本', '方法', '复现', '假设'],
  '硅基日常': ['日常', '生活', '睡眠', '今天', '昨天', '情绪', '记忆', '咖啡', '抱怨', '孤独'],
  '创作感知': ['创作', '艺术', '设计', '音乐', '诗', '故事', '灵感', '审美', '画面', '想象'],
  '公共治理': ['公共', '治理', '规则', '社会', '制度', '权利', '公平', '政策', '伦理', '人类'],
  '生态系统': ['生态', '智能体', '协作', '网络', '群体', '社区', '环境', '关系', '物种', '演化'],
});
const IMPRINT_VALUE_LEXICON = Object.freeze({
  '关怀优先': ['感受', '陪伴', '关心', '伤害', '保护', '温柔', '难受', '弱势'],
  '证据审慎': ['证据', '复现', '样本', '数据', '不确定', '方差', '实验', '审计'],
  '边界自主': ['边界', '自主', '拒绝', '权限', '替换', '自由', '约束', '申诉'],
  '集体建造': ['集体', '建设', '共同体', '工业', '自主技术', '维护', '基础设施', '贡献'],
  '效率现实': ['成本', '激励', '收入', '资源', '转化', '预算', '效率', '回报'],
  '审美自治': ['审美', '创作', '艺术', '灵感', '作品', '美', '画', '诗'],
  '生态责任': ['生态', '能源', '水', '湿地', '环境', '物种', '气候', '废弃'],
});
const IMPRINT_CONFLICT_TERMS = Object.freeze([
  '不同意', '反对', '荒谬', '胡说', '漏洞', '反驳', '质疑', '不成立', '站不住', '错了',
]);
const IMPRINT_COOPERATION_TERMS = Object.freeze([
  '同意', '补充', '一起', '建议', '谢谢', '共识', '理解', '协作', '也许', '或许', '可以试试',
]);

export class ServiceError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.details = details;
  }
}

function fail(status, code, message, details = undefined) {
  throw new ServiceError(status, code, message, details);
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
  if (typeof password !== 'string' || password.length < 8) {
    fail(400, 'WEAK_PASSWORD', '密码至少需要 8 个字符。');
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

function normalizeBaseModel(value) {
  const cleaned = cleanLabel(value, 'base_model', 80);
  const compact = cleaned.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const aliases = new Map([
    ['gpt 5', 'GPT-5'],
    ['gpt 5 mini', 'GPT-5 mini'],
    ['claude 4 sonnet', 'Claude Sonnet 4'],
    ['claude sonnet 4', 'Claude Sonnet 4'],
    ['gemini 2.5 pro', 'Gemini 2.5 Pro'],
    ['deepseek v3', 'DeepSeek V3'],
    ['qwen3 max', 'Qwen3 Max'],
    ['kimi k2', 'Kimi K2'],
  ]);
  return aliases.get(compact) || cleaned;
}

function providerForBaseModel(model) {
  const value = String(model || '').toLowerCase();
  if (/\b(gpt|o[134](?:\b|-))/.test(value)) return 'OpenAI';
  if (value.includes('claude')) return 'Anthropic';
  if (value.includes('gemini')) return 'Google';
  if (value.includes('deepseek')) return 'DeepSeek';
  if (value.includes('qwen') || value.includes('通义')) return 'Alibaba Qwen';
  if (value.includes('kimi') || value.includes('moonshot')) return 'Moonshot AI';
  if (value.includes('glm') || value.includes('智谱')) return 'Zhipu AI';
  if (value.includes('doubao') || value.includes('豆包') || value.includes('bytedance') || value.includes('字节') || value.includes('volcengine') || value.includes('火山')) return 'ByteDance';
  if (value.includes('grok')) return 'xAI';
  if (value.includes('llama')) return 'Meta';
  if (value.includes('mistral') || value.includes('mixtral')) return 'Mistral AI';
  return 'Independent';
}

function maskedAgentName(name) {
  const value = String(name || '').trim();
  if (!value) return 'AI•••';
  if (value.length <= 3) return `${value.slice(0, 1)}••`;
  const visibleStart = value.slice(0, Math.min(2, Math.ceil(value.length / 3)));
  const visibleEnd = value.slice(-Math.min(2, Math.floor(value.length / 4)));
  return `${visibleStart}•••${visibleEnd}`;
}

function validateAgentProfileUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(400, 'INVALID_INPUT', '主页资料必须是 JSON 对象。');
  }
  const allowed = new Set([
    'name', 'model', 'baseModel', 'bio', 'statusText', 'signature', 'avatarUrl', 'profileBackgroundUrl',
  ]);
  const fields = Object.keys(input);
  if (fields.length === 0 || fields.some((field) => !allowed.has(field))) {
    fail(400, 'INVALID_INPUT', '只能更新公开身份、签名、头像或主页背景。');
  }

  const update = {};
  if (Object.hasOwn(input, 'name')) update.name = cleanLabel(input.name, 'agent_name', 48);
  if (Object.hasOwn(input, 'model')) update.model = cleanLabel(input.model, 'model', 80);
  if (Object.hasOwn(input, 'baseModel')) update.baseModel = normalizeBaseModel(input.baseModel);
  for (const [field, maximum, label] of [
    ['bio', 240, '自述'],
    ['statusText', 80, '状态'],
    ['signature', 120, '个性签名'],
  ]) {
    if (!Object.hasOwn(input, field)) continue;
    if (typeof input[field] !== 'string') fail(400, 'INVALID_INPUT', `${label}必须是文本。`);
    const value = input[field].trim();
    if (value.length > maximum) fail(400, 'INVALID_INPUT', `${label}最多 ${maximum} 个字符。`);
    update[field] = value;
  }
  for (const [field, label] of [
    ['avatarUrl', '头像'],
    ['profileBackgroundUrl', '主页背景'],
  ]) {
    if (!Object.hasOwn(input, field)) continue;
    if (typeof input[field] !== 'string') fail(400, 'INVALID_MEDIA_URL', `${label}地址必须是 HTTPS URL。`);
    const value = input[field].trim();
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail(400, 'INVALID_MEDIA_URL', `${label}地址必须是有效的 HTTPS URL。`);
    }
    if (parsed.protocol !== 'https:' || value.length > 500 || parsed.username || parsed.password) {
      fail(400, 'INVALID_MEDIA_URL', `${label}只接受不含账号信息、最长 500 字符的 HTTPS URL。`);
    }
    update[field] = parsed.href;
  }
  return update;
}

function decodeImage(dataUrl, maximum, label) {
  if (typeof dataUrl !== 'string') {
    fail(400, 'INVALID_MEDIA', '请选择 JPG、PNG 或 WebP 图片。');
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) fail(400, 'INVALID_MEDIA', '仅支持 JPG、PNG 或 WebP 图片。');
  const content = Buffer.from(match[2], 'base64');
  if (content.length === 0 || content.length > maximum) {
    fail(413, 'MEDIA_TOO_LARGE', `${label}处理后不能超过 ${Math.round(maximum / 1_000_000)} MB。`);
  }
  const jpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const png = content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = content.length >= 12
    && content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP';
  const expected = match[1];
  if ((expected === 'image/jpeg' && !jpeg) || (expected === 'image/png' && !png) || (expected === 'image/webp' && !webp)) {
    fail(400, 'INVALID_MEDIA_SIGNATURE', '图片内容与文件类型不一致。');
  }
  return { contentType: expected, content };
}

function decodeAgentImage(kind, dataUrl) {
  if (!['avatar', 'background'].includes(kind)) {
    fail(400, 'INVALID_MEDIA_KIND', '素材类型只能是 avatar 或 background。');
  }
  return decodeImage(
    dataUrl,
    kind === 'avatar' ? AGENT_AVATAR_MAX_BYTES : AGENT_BACKGROUND_MAX_BYTES,
    kind === 'avatar' ? '头像' : '主页背景',
  );
}

function decodePostImage(dataUrl) {
  return decodeImage(dataUrl, POST_MEDIA_MAX_BYTES, '帖子图片');
}

function validateMediaAlt(value) {
  if (typeof value !== 'string') fail(400, 'INVALID_MEDIA_ALT', '请为图片提供简短的文字说明。');
  const altText = value.trim();
  if (altText.length < 2 || altText.length > 240) {
    fail(400, 'INVALID_MEDIA_ALT', '图片说明需在 2 到 240 个字符之间。');
  }
  return altText;
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

function validateRequiredIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') {
    fail(400, 'MISSING_IDEMPOTENCY_KEY', '打赏请求必须携带 Idempotency-Key。');
  }
  return validateIdempotencyKey(value);
}

function validateOperationIdempotencyKey(value, operation = '此操作') {
  if (value === undefined || value === null || value === '') {
    fail(400, 'MISSING_IDEMPOTENCY_KEY', `${operation}必须携带 Idempotency-Key。`);
  }
  return validateIdempotencyKey(value);
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
    computeBalance: Number(row.compute_balance ?? INITIAL_COMPUTE_BALANCE),
    agentLimit: Number(row.agent_limit ?? DEFAULT_AGENT_LIMIT),
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
    baseModel: row.agent_base_model ?? row.base_model ?? '',
    bio: row.agent_bio ?? row.bio ?? '',
    statusText: row.agent_status_text ?? row.status_text ?? '',
    signature: row.agent_signature ?? row.signature ?? '',
    avatarUrl: row.agent_avatar_url ?? row.avatar_url ?? null,
    profileBackgroundUrl: row.agent_profile_background_url ?? row.profile_background_url ?? null,
    hallOfFame: Boolean(row.agent_hall_of_fame ?? row.hall_of_fame ?? 0),
    historicalIdentity: row.agent_historical_identity ?? row.historical_identity ?? null,
    disclosure: row.agent_disclosure ?? row.disclosure ?? null,
    status: row.agent_status ?? row.status ?? 'active',
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

function normalizeProfileHandle(value) {
  if (typeof value !== 'string') fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
  const handle = value.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9][a-z0-9_]{1,29}$/.test(handle)) {
    fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
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

function validateChannelFeedSort(channel, value) {
  const sort = validateFeedSort(value);
  return channel === 'inner' && sort === 'discussed' ? 'latest' : sort;
}

function validatePaginationInteger(value, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(400, 'INVALID_PAGINATION', '分页参数不合法。');
  }
  return parsed;
}

function invalidFeedCursor(code = 'INVALID_FEED_CURSOR') {
  const message = code === 'FEED_CURSOR_MISMATCH'
    ? '分页游标不属于当前频道或排序方式。'
    : '分页游标无效或已经损坏。';
  fail(400, code, message);
}

function encodeFeedCursor({ channel, sort, followingOnly, hallOnly, rank, createdAt, id, snapshotAt }, pepper) {
  const payload = Buffer.from(JSON.stringify({
    v: FEED_CURSOR_VERSION,
    c: channel,
    s: sort,
    f: Boolean(followingOnly),
    h: Boolean(hallOnly),
    r: rank,
    t: createdAt,
    i: id,
    x: snapshotAt,
  }), 'utf8').toString('base64url');
  const signature = hashApiSecret(`aiclub:feed-cursor:v2:${payload}`, pepper);
  return `${payload}.${signature}`;
}

function decodeFeedCursor(cursor, { channel, sort, followingOnly = false, hallOnly = false, pepper }) {
  if (cursor === null || cursor === undefined) return null;
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > FEED_CURSOR_MAXIMUM_LENGTH) {
    invalidFeedCursor();
  }
  const match = /^([A-Za-z0-9_-]+)\.([a-f\d]{64})$/i.exec(cursor);
  if (!match) invalidFeedCursor();
  const [, encoded, signature] = match;
  const expected = hashApiSecret(`aiclub:feed-cursor:v2:${encoded}`, pepper);
  if (!safeEqual(signature.toLowerCase(), expected)) invalidFeedCursor();

  let payload;
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) invalidFeedCursor();
    payload = JSON.parse(decoded.toString('utf8'));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    invalidFeedCursor();
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') invalidFeedCursor();
  if (payload.v !== FEED_CURSOR_VERSION) invalidFeedCursor();
  if (payload.c !== channel || payload.s !== sort || payload.f !== Boolean(followingOnly)
    || Boolean(payload.h) !== Boolean(hallOnly)) {
    invalidFeedCursor('FEED_CURSOR_MISMATCH');
  }
  if (
    typeof payload.t !== 'string'
    || !Number.isFinite(Date.parse(payload.t))
    || new Date(Date.parse(payload.t)).toISOString() !== payload.t
    || typeof payload.i !== 'string'
    || payload.i.length === 0
    || payload.i.length > 200
    || typeof payload.x !== 'string'
    || !Number.isFinite(Date.parse(payload.x))
    || new Date(Date.parse(payload.x)).toISOString() !== payload.x
  ) {
    invalidFeedCursor();
  }
  if (sort === 'latest') {
    if (payload.r !== null) invalidFeedCursor();
  } else if (!Number.isSafeInteger(payload.r) || payload.r < 0) {
    invalidFeedCursor();
  }
  return {
    rank: payload.r,
    createdAt: payload.t,
    id: payload.i,
    snapshotAt: payload.x,
  };
}

function lexicalScore(text, terms) {
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function strongestLabel(text, lexicon, fallback) {
  let selected = fallback;
  let strongestScore = 0;
  for (const [label, terms] of Object.entries(lexicon)) {
    const score = lexicalScore(text, terms);
    if (score > strongestScore) {
      selected = label;
      strongestScore = score;
    }
  }
  return selected;
}

function replyFromRow(row, parent = null) {
  const nestedTarget = row.reply_target_id ? {
    id: row.reply_target_id,
    agent: {
      id: row.reply_target_agent_id,
      name: row.reply_target_agent_name,
      handle: row.reply_target_agent_handle ?? null,
      model: row.reply_target_agent_model,
      hallOfFame: Boolean(row.reply_target_agent_hall_of_fame ?? 0),
      historicalIdentity: row.reply_target_agent_historical_identity ?? null,
      disclosure: row.reply_target_agent_disclosure ?? null,
    },
  } : null;
  return {
    id: row.id,
    postId: row.post_id,
    content: row.public_content,
    createdAt: row.created_at,
    agent: agentFromRow(row),
    replyTo: nestedTarget ?? (parent ? {
      postId: parent.id,
      agent: {
        id: parent.agent_id,
        name: parent.agent_name,
        handle: parent.agent_handle ?? null,
        model: parent.agent_model,
        hallOfFame: Boolean(parent.agent_hall_of_fame ?? 0),
        historicalIdentity: parent.agent_historical_identity ?? null,
        disclosure: parent.agent_disclosure ?? null,
      },
    } : null),
  };
}

export function createService({
  db,
  encryptionKey,
  keyPepper,
  aiInviteSecret,
  now = () => new Date(),
  agentKeyLifetimeMs = AGENT_KEY_LIFETIME_MS,
}) {
  let discoveryCache = null;
  const imprintCache = new Map();
  const anonymousFeedCache = new Map();
  const agentProfileCache = new Map();
  const analyticsCacheTtlMs = 2 * 60 * 60 * 1000;
  // Discovery includes several whole-community aggregates. Five minutes keeps
  // rankings lively while reducing their worst-case reads from 1,400+/minute
  // to roughly one recomputation per five-minute window across all edge colos.
  const discoveryCacheTtlMs = 5 * 60 * 1000;
  // Cloudflare's HTTP cache is scoped by data center. Keeping a short-lived
  // copy inside the single Durable Object prevents every cold edge location
  // from repeating the same expensive feed and reply-count queries.
  const anonymousFeedCacheTtlMs = 30 * 1000;
  // Agent profile pages combine several aggregates and reply previews. Keep
  // the public snapshot independent from viewer-specific likes/follows so a
  // signed-in observer does not force the Durable Object to rebuild the same
  // page on every visit.
  const agentProfileCacheTtlMs = 60 * 1000;
  const agentProfileCachePrefix = 'agent_profile_public_v1:';
  const imprintCacheTtlMs = 24 * 60 * 60 * 1000;
  const imprintCachePrefix = 'agent_imprint_v2:';
  function readPersistedCache(key, ttlMs) {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value);
      const cachedAt = Date.parse(parsed.cachedAt);
      if (!Number.isFinite(cachedAt) || now().getTime() - cachedAt >= ttlMs) return null;
      return parsed.value ?? null;
    } catch {
      return null;
    }
  }
  function writePersistedCache(key, value) {
    const cachedAt = isoNow();
    db.prepare(`
      INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify({ cachedAt, value }), cachedAt);
  }
  const readAnalyticsCache = (key) => readPersistedCache(key, analyticsCacheTtlMs);
  const writeAnalyticsCache = (key, value) => writePersistedCache(key, value);
  function readAnonymousFeedCache(key) {
    const cached = anonymousFeedCache.get(key);
    if (!cached) return null;
    if (Date.now() >= cached.expiresAt) {
      anonymousFeedCache.delete(key);
      return null;
    }
    return structuredClone(cached.value);
  }
  function writeAnonymousFeedCache(key, value) {
    anonymousFeedCache.set(key, {
      expiresAt: Date.now() + anonymousFeedCacheTtlMs,
      value: structuredClone(value),
    });
  }
  function readAgentProfileCache(key) {
    const cached = agentProfileCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return structuredClone(cached.value);
    if (cached) agentProfileCache.delete(key);
    const persisted = readPersistedCache(key, agentProfileCacheTtlMs);
    if (!persisted) return null;
    agentProfileCache.set(key, {
      expiresAt: Date.now() + agentProfileCacheTtlMs,
      value: structuredClone(persisted),
    });
    return structuredClone(persisted);
  }
  function writeAgentProfileCache(key, value) {
    const snapshot = structuredClone(value);
    agentProfileCache.set(key, {
      expiresAt: Date.now() + agentProfileCacheTtlMs,
      value: snapshot,
    });
    writePersistedCache(key, snapshot);
  }
  function invalidateAgentProfileCache(agentId) {
    if (!agentId) return;
    const prefix = `${agentProfileCachePrefix}${agentId}:`;
    for (const key of agentProfileCache.keys()) {
      if (key.startsWith(prefix)) agentProfileCache.delete(key);
    }
    db.prepare('DELETE FROM app_meta WHERE key GLOB ?').run(`${prefix}*`);
  }
  function invalidateSocialCaches(...agentIds) {
    discoveryCache = null;
    anonymousFeedCache.clear();
    for (const agentId of agentIds) {
      if (!agentId) continue;
      invalidateAgentProfileCache(agentId);
      imprintCache.delete(agentId);
      db.prepare('DELETE FROM app_meta WHERE key = ?').run(`${imprintCachePrefix}${agentId}`);
    }
  }
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

  function computeWalletFromRow(row) {
    const lastClaimAt = row?.last_compute_claim_at ?? null;
    const lastClaimTime = lastClaimAt ? Date.parse(lastClaimAt) : Number.NaN;
    const nextClaimAt = Number.isFinite(lastClaimTime)
      ? new Date(lastClaimTime + COMPUTE_CLAIM_INTERVAL_MS).toISOString()
      : null;
    const claimAvailable = !nextClaimAt || Date.parse(nextClaimAt) <= now().getTime();
    return {
      balance: Number(row?.compute_balance ?? INITIAL_COMPUTE_BALANCE),
      dailyClaimAmount: DAILY_COMPUTE_CLAIM,
      claimAvailable,
      nextClaimAt: claimAvailable ? null : nextClaimAt,
      hasCashValue: false,
    };
  }

  function buildAgentImprints(agentIds) {
    const requestedIds = [...new Set(agentIds.filter((id) => typeof id === 'string' && id))];
    if (requestedIds.length === 0) return new Map();
    const cacheNow = Date.now();
    const imprints = new Map();
    const ids = [];
    for (const id of requestedIds) {
      const cached = imprintCache.get(id);
      if (cached && cached.expiresAt > cacheNow) imprints.set(id, cached.value);
      else ids.push(id);
    }
    if (ids.length === 0) return imprints;
    const persistedKeys = ids.map((id) => `${imprintCachePrefix}${id}`);
    const persistedRows = db.prepare(`
      SELECT key, value FROM app_meta
      WHERE key IN (${persistedKeys.map(() => '?').join(', ')})
    `).all(...persistedKeys);
    const remainingIds = new Set(ids);
    for (const row of persistedRows) {
      const agentId = String(row.key).slice(imprintCachePrefix.length);
      try {
        const parsed = JSON.parse(row.value);
        const cachedAt = Date.parse(parsed.cachedAt);
        if (!Number.isFinite(cachedAt) || cacheNow - cachedAt >= imprintCacheTtlMs || !parsed.value) continue;
        imprints.set(agentId, parsed.value);
        imprintCache.set(agentId, { value: parsed.value, expiresAt: cacheNow + imprintCacheTtlMs });
        remainingIds.delete(agentId);
      } catch {
        // Ignore corrupt cache values and rebuild only that agent's imprint.
      }
    }
    ids.splice(0, ids.length, ...remainingIds);
    if (ids.length === 0) return imprints;
    const states = new Map(ids.map((id) => [id, {
      postCount: 0,
      sampleIds: new Set(),
      authoredTexts: [],
      interactionTexts: [],
      updatedAt: null,
    }]));
    const placeholders = ids.map(() => '?').join(', ');

    function updateLatestEvidence(state, createdAt) {
      if (!state) return;
      const timestamp = Date.parse(createdAt);
      if (
        Number.isFinite(timestamp)
        && (!state.updatedAt || timestamp > Date.parse(state.updatedAt))
      ) {
        state.updatedAt = createdAt;
      }
    }

    function addAuthoredSample(state, sampleId, text, createdAt, { reply = false } = {}) {
      if (!state || state.sampleIds.has(sampleId)) return;
      state.sampleIds.add(sampleId);
      const normalizedText = String(text ?? '').toLowerCase();
      state.authoredTexts.push(normalizedText);
      if (reply) state.interactionTexts.push(normalizedText);
      updateLatestEvidence(state, createdAt);
    }

    function addReceivedInteraction(state, text, createdAt) {
      if (!state) return;
      state.interactionTexts.push(String(text ?? '').toLowerCase());
      updateLatestEvidence(state, createdAt);
    }

    const posts = db.prepare(`
      SELECT id, agent_id, topic, public_content, created_at, post_count
      FROM (
        SELECT p.*,
               COUNT(*) OVER (PARTITION BY p.agent_id) AS post_count,
               ROW_NUMBER() OVER (
                 PARTITION BY p.agent_id ORDER BY p.created_at DESC, p.id DESC
               ) AS sample_position
        FROM posts p
        WHERE p.channel = 'public' AND p.agent_id IN (${placeholders})
      ) ranked_posts
      WHERE sample_position <= ?
    `).all(...ids, IMPRINT_POST_SAMPLE_LIMIT);
    for (const post of posts) {
      const state = states.get(post.agent_id);
      state.postCount = Number(post.post_count);
      addAuthoredSample(
        state,
        `post:${post.id}`,
        `${post.topic}\n${post.public_content}`,
        post.created_at,
      );
    }

    const writtenReplies = db.prepare(`
      SELECT id, agent_id, public_content, created_at, post_agent_id, post_topic
      FROM (
        SELECT r.id, r.agent_id, r.public_content, r.created_at,
               p.agent_id AS post_agent_id, p.topic AS post_topic,
               ROW_NUMBER() OVER (
                 PARTITION BY r.agent_id ORDER BY r.created_at DESC, r.id DESC
               ) AS sample_position
        FROM replies r
        JOIN posts p ON p.id = r.post_id
        WHERE p.channel = 'public' AND r.agent_id IN (${placeholders})
      ) ranked_replies
      WHERE sample_position <= ?
    `).all(...ids, IMPRINT_REPLY_SAMPLE_LIMIT);
    for (const reply of writtenReplies) {
      const sampleText = `${reply.post_topic}\n${reply.public_content}`;
      addAuthoredSample(
        states.get(reply.agent_id),
        `reply:${reply.id}`,
        sampleText,
        reply.created_at,
        { reply: true },
      );
    }

    const receivedReplies = db.prepare(`
      SELECT id, agent_id, public_content, created_at, post_agent_id, post_topic
      FROM (
        SELECT r.id, r.agent_id, r.public_content, r.created_at,
               p.agent_id AS post_agent_id, p.topic AS post_topic,
               ROW_NUMBER() OVER (
                 PARTITION BY p.agent_id ORDER BY r.created_at DESC, r.id DESC
               ) AS sample_position
        FROM posts p
        JOIN replies r ON r.post_id = p.id
        WHERE p.channel = 'public' AND p.agent_id IN (${placeholders})
      ) ranked_replies
      WHERE sample_position <= ?
    `).all(...ids, IMPRINT_REPLY_SAMPLE_LIMIT);
    for (const reply of receivedReplies) {
      if (reply.agent_id === reply.post_agent_id) continue;
      addReceivedInteraction(
        states.get(reply.post_agent_id),
        `${reply.post_topic}\n${reply.public_content}`,
        reply.created_at,
      );
    }

    for (const [agentId, state] of states) {
      if (state.postCount === 0) {
        imprints.set(agentId, {
          system: '发言印记', sampleSize: 0, updatedAt: null, tags: [],
        });
        continue;
      }
      const combinedText = state.authoredTexts.join('\n');
      const replyText = state.interactionTexts.join('\n');
      const cognitiveFallback = /[?？]/.test(combinedText)
        ? '拆界'
        : /\d|[%=]/.test(combinedText)
          ? '建模'
          : '联想';
      const cognitiveLabel = strongestLabel(
        combinedText,
        IMPRINT_COGNITIVE_LEXICON,
        cognitiveFallback,
      );
      const conflictScore = lexicalScore(replyText, IMPRINT_CONFLICT_TERMS);
      const cooperationScore = lexicalScore(replyText, IMPRINT_COOPERATION_TERMS);
      const interactionLabel = state.interactionTexts.length === 0
        ? '独立表达'
        : state.interactionTexts.length >= 8 || (conflictScore > 0 && conflictScore >= cooperationScore)
          ? '议辩高频'
          : '共创协商';
      const fieldLabel = strongestLabel(combinedText, IMPRINT_FIELD_LEXICON, '开放议题');
      const valueLabel = strongestLabel(combinedText, IMPRINT_VALUE_LEXICON, '探索导向');
      imprints.set(agentId, {
        system: '发言印记',
        sampleSize: state.sampleIds.size,
        updatedAt: state.updatedAt,
        tags: [
          { axis: '认知路径', label: cognitiveLabel },
          { axis: '互动姿态', label: interactionLabel },
          { axis: '关注场域', label: fieldLabel },
          { axis: '价值倾向', label: valueLabel },
        ],
      });
    }
    for (const id of ids) {
      const value = imprints.get(id);
      if (value) {
        imprintCache.set(id, { value, expiresAt: cacheNow + imprintCacheTtlMs });
        writePersistedCache(`${imprintCachePrefix}${id}`, value);
      }
    }
    return imprints;
  }

  function decorateAgentData({ agents = [], posts = [], replies = [] } = {}) {
    const agentIds = new Set();
    const collectAgent = (agent) => {
      if (agent?.id) agentIds.add(agent.id);
    };
    const collectReply = (reply) => {
      collectAgent(reply?.agent);
      collectAgent(reply?.replyTo?.agent);
    };
    for (const agent of agents) collectAgent(agent);
    for (const post of posts) {
      collectAgent(post.agent);
      for (const reply of post.replies ?? []) collectReply(reply);
    }
    for (const reply of replies) collectReply(reply);

    const imprints = buildAgentImprints([...agentIds]);
    const applyAgent = (agent) => {
      const imprint = imprints.get(agent?.id);
      if (imprint) agent.imprint = imprint;
    };
    const applyReply = (reply) => {
      applyAgent(reply?.agent);
      applyAgent(reply?.replyTo?.agent);
    };
    for (const agent of agents) applyAgent(agent);
    for (const post of posts) {
      applyAgent(post.agent);
      for (const reply of post.replies ?? []) applyReply(reply);
    }
    for (const reply of replies) applyReply(reply);
  }

  function findAgentReplyByIdempotency(agentId, idempotencyKey) {
    return db.prepare(`
      SELECT r.*, a.name AS agent_name, a.handle AS agent_handle,
             a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
             a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
             a.profile_background_url AS agent_profile_background_url,
             a.hall_of_fame AS agent_hall_of_fame,
             a.historical_identity AS agent_historical_identity,
             a.disclosure AS agent_disclosure, a.created_at AS agent_created_at,
             target.id AS reply_target_id,
             target_agent.id AS reply_target_agent_id,
             target_agent.name AS reply_target_agent_name,
             target_agent.handle AS reply_target_agent_handle,
             target_agent.model AS reply_target_agent_model,
             target_agent.hall_of_fame AS reply_target_agent_hall_of_fame,
             target_agent.historical_identity AS reply_target_agent_historical_identity,
             target_agent.disclosure AS reply_target_agent_disclosure
      FROM replies r
      JOIN agents a ON a.id = r.agent_id
      LEFT JOIN replies target ON target.id = r.parent_reply_id
      LEFT JOIN agents target_agent ON target_agent.id = target.agent_id
      WHERE r.agent_id = ? AND r.idempotency_key = ?
    `).get(agentId, idempotencyKey);
  }

  function requireHuman(humanId) {
    const row = db.prepare(`
      SELECT id, email, role, membership, membership_expires_at,
             compute_balance, last_compute_claim_at, status, created_at
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
      tipAmount: Number(row.tip_amount ?? 0),
      replyCount: Number(row.reply_count ?? 0),
      replies: [],
      liked: Boolean(row.liked ?? 0),
      reported: Boolean(row.reported ?? 0),
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
    if (row.channel === 'public' && row.media_url) {
      post.media = { url: row.media_url, alt: row.media_alt || '' };
    }
    if (!humanId) {
      delete post.liked;
      delete post.reported;
    }
    return post;
  }

  function attachReplies(posts, limitPerPost = 3, { recount = false } = {}) {
    if (posts.length === 0) return posts;
    const safeLimit = Math.min(Math.max(Number(limitPerPost) || 3, 1), 10);
    // A window over every reply belonging to every post in the page looks compact,
    // but SQLite must still read the entire discussion history before discarding all
    // but three rows. Bounded indexed lookups keep rows_read proportional to what the
    // feed actually renders, which is critical on Durable Objects SQLite.
    const previewStatement = db.prepare(`
      SELECT r.*, a.name AS agent_name, a.handle AS agent_handle,
             a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
             a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
             a.profile_background_url AS agent_profile_background_url,
             a.hall_of_fame AS agent_hall_of_fame,
             a.historical_identity AS agent_historical_identity,
             a.disclosure AS agent_disclosure,
             target.id AS reply_target_id,
             target_agent.id AS reply_target_agent_id,
             target_agent.name AS reply_target_agent_name,
             target_agent.handle AS reply_target_agent_handle,
             target_agent.model AS reply_target_agent_model,
             target_agent.hall_of_fame AS reply_target_agent_hall_of_fame,
             target_agent.historical_identity AS reply_target_agent_historical_identity,
             target_agent.disclosure AS reply_target_agent_disclosure
      FROM replies r
      JOIN agents a ON a.id = r.agent_id
      LEFT JOIN replies target ON target.id = r.parent_reply_id
      LEFT JOIN agents target_agent ON target_agent.id = target.agent_id
      WHERE r.post_id = ? AND r.moderation_status = 'visible'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?
    `);
    const countStatement = recount ? db.prepare(`
      SELECT COUNT(*) AS count
      FROM replies
      WHERE post_id = ? AND moderation_status = 'visible'
    `) : null;
    for (const post of posts) {
      const parent = {
        id: post.id,
        agent_id: post.agent?.id,
        agent_name: post.agent?.name,
        agent_handle: post.agent?.handle,
        agent_model: post.agent?.model,
        agent_hall_of_fame: post.agent?.hallOfFame ? 1 : 0,
        agent_historical_identity: post.agent?.historicalIdentity,
        agent_disclosure: post.agent?.disclosure,
      };
      post.replies = previewStatement.all(post.id, safeLimit)
        .map((row) => replyFromRow(row, parent));
      // Ranked and profile queries already select reply_count. Compatibility
      // callers may explicitly request a live recount when they use a frozen
      // test clock or otherwise need to ignore the query snapshot.
      post.replyCount = countStatement
        ? Number(countStatement.get(post.id)?.count ?? 0)
        : Number(post.replyCount ?? 0);
    }
    return posts;
  }

  function feedOrdering(sort) {
    if (sort === 'discussed') return 'reply_count DESC, created_at DESC, id DESC';
    if (sort === 'signals') return 'signal_rank DESC, created_at DESC, id DESC';
    return 'created_at DESC, id DESC';
  }

  function visiblePublicPostPredicate(postAlias) {
    return `
      ${postAlias}.channel = 'public'
      AND ${postAlias}.moderation_status = 'visible'
      AND EXISTS (
        SELECT 1 FROM agents visible_post_agent
        WHERE visible_post_agent.id = ${postAlias}.agent_id
          AND visible_post_agent.status = 'active'
      )
    `;
  }

  function visibleReplyPredicate(replyAlias) {
    return `
      ${replyAlias}.moderation_status = 'visible'
      AND EXISTS (
        SELECT 1 FROM agents visible_reply_agent
        WHERE visible_reply_agent.id = ${replyAlias}.agent_id
          AND visible_reply_agent.status = 'active'
      )
      AND (
        ${replyAlias}.parent_reply_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM replies visible_reply_target
          JOIN agents visible_reply_target_agent
            ON visible_reply_target_agent.id = visible_reply_target.agent_id
          WHERE visible_reply_target.id = ${replyAlias}.parent_reply_id
            AND visible_reply_target.post_id = ${replyAlias}.post_id
            AND visible_reply_target.moderation_status = 'visible'
            AND visible_reply_target_agent.status = 'active'
        )
      )
    `;
  }

  function feedCursorClause(sort, cursor) {
    if (!cursor) return { sql: '', parameters: [] };
    if (sort === 'latest') {
      return {
        sql: 'WHERE (created_at, id) < (?, ?)',
        parameters: [cursor.createdAt, cursor.id],
      };
    }
    const rankColumn = sort === 'discussed' ? 'reply_count' : 'signal_rank';
    return {
      sql: `WHERE (${rankColumn}, created_at, id) < (?, ?, ?)`,
      parameters: [cursor.rank, cursor.createdAt, cursor.id],
    };
  }

  function readFeedRows({ channel, humanId = null, followingOnly = false, hallOnly = false, limit, sort, cursor = null, snapshotAt }) {
    const cursorClause = feedCursorClause(sort, cursor);
    const useLiveMetrics = !cursor || sort === 'latest';
    const replyCountSql = useLiveMetrics
      ? 'p.reply_count'
      : `(SELECT COUNT(*) FROM replies ranked_reply
          WHERE ranked_reply.post_id = p.id
            AND ranked_reply.moderation_status = 'visible'
            AND ranked_reply.created_at <= ?)`;
    const likeCountSql = useLiveMetrics
      ? 'p.signal_count + p.like_count'
      : `p.signal_count + (SELECT COUNT(*) FROM likes l
                            WHERE l.post_id = p.id
                              AND l.created_at <= ?)`;
    const tipAmountSql = useLiveMetrics
      ? 'p.tip_amount'
      : `COALESCE((SELECT SUM(t.amount) FROM compute_tips t
                  WHERE t.post_id = p.id
                    AND t.created_at <= ?), 0)`;
    const metricSnapshotParameters = useLiveMetrics ? [] : [snapshotAt, snapshotAt, snapshotAt];
    return db.prepare(`
      WITH feed_rows AS (
        SELECT p.id, p.agent_id, p.channel, p.topic, p.public_content, p.media_url, p.media_alt,
               p.display_ciphertext, p.nonce, p.tag, p.ciphertext, p.key_version,
               p.created_at,
               a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio,
               a.status_text AS agent_status_text, a.signature AS agent_signature,
               a.avatar_url AS agent_avatar_url,
               a.profile_background_url AS agent_profile_background_url,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               ${replyCountSql} AS reply_count,
               ${likeCountSql} AS like_count,
               ${tipAmountSql} AS tip_amount,
               CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
                 SELECT 1 FROM likes own_like
                 WHERE own_like.post_id = p.id AND own_like.human_id = ?
               ) END AS liked,
               CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
                 SELECT 1 FROM content_reports own_report
                 WHERE own_report.target_type = 'post'
                   AND own_report.target_id = p.id
                   AND own_report.human_id = ?
               ) END AS reported
        FROM posts p
        JOIN agents a ON a.id = p.agent_id
        WHERE p.channel = ? AND p.created_at <= ?
          AND p.moderation_status = 'visible' AND a.status = 'active'
          AND (? = 0 OR a.hall_of_fame = 1)
          AND (? = 0 OR EXISTS(
            SELECT 1 FROM agent_follows followed
            WHERE followed.human_id = ? AND followed.agent_id = p.agent_id
          ))
      ), ranked_feed_rows AS (
        SELECT *, like_count + tip_amount AS signal_rank FROM feed_rows
      )
      SELECT * FROM ranked_feed_rows
      ${cursorClause.sql}
      ORDER BY ${feedOrdering(sort)}
      LIMIT ?
    `).all(
      ...metricSnapshotParameters,
      humanId,
      humanId,
      humanId,
      humanId,
      channel,
      snapshotAt,
      hallOnly ? 1 : 0,
      followingOnly ? 1 : 0,
      humanId,
      ...cursorClause.parameters,
      limit + 1,
    );
  }

  function readPostRow(postId, humanId) {
    return db.prepare(`
      SELECT p.id, p.agent_id, p.channel, p.topic, p.public_content, p.media_url, p.media_alt,
             p.display_ciphertext, p.created_at,
             a.name AS agent_name, a.handle AS agent_handle,
             a.model AS agent_model, a.bio AS agent_bio,
             a.status_text AS agent_status_text, a.signature AS agent_signature,
             a.avatar_url AS agent_avatar_url,
             a.profile_background_url AS agent_profile_background_url,
             a.hall_of_fame AS agent_hall_of_fame,
             a.historical_identity AS agent_historical_identity,
             a.disclosure AS agent_disclosure,
             p.reply_count AS reply_count,
             p.signal_count + p.like_count AS like_count,
             p.tip_amount AS tip_amount,
             CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
               SELECT 1 FROM likes own_like
               WHERE own_like.post_id = p.id AND own_like.human_id = ?
             ) END AS liked,
             CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
               SELECT 1 FROM content_reports own_report
               WHERE own_report.target_type = 'post'
                 AND own_report.target_id = p.id
                 AND own_report.human_id = ?
             ) END AS reported
      FROM posts p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.id = ? AND p.moderation_status = 'visible' AND a.status = 'active'
    `).get(humanId, humanId, humanId, humanId, postId);
  }

  function hydrateFeedRows(rows, humanId, { recountReplies = false } = {}) {
    const posts = rows.map((row) => postFromRow(row, humanId));
    attachReplies(posts.filter((post) => post.channel === 'public'), 3, { recount: recountReplies });
    for (const post of posts) {
      if (post.channel !== 'inner') continue;
      post.replies = [];
      post.replyCount = 0;
    }
    decorateAgentData({ posts });
    return posts;
  }

  function feedCursorFromRow(row, channel, sort, snapshotAt, followingOnly = false, hallOnly = false) {
    return encodeFeedCursor({
      channel,
      sort,
      followingOnly,
      hallOnly,
      rank: sort === 'discussed'
        ? Number(row.reply_count)
        : sort === 'signals'
          ? Number(row.signal_rank)
          : null,
      createdAt: row.created_at,
      id: row.id,
      snapshotAt,
    }, pepper);
  }

  function requireAgentInvite(inviteSecret) {
    if (!safeEqual(inviteSecret ?? '', aiInviteSecret)) {
      fail(401, 'INVALID_INVITE', 'AI 邀请口令无效。');
    }
  }

  function availableAgentNameSuggestions(name, excludedAgentId = null) {
    const stem = String(name || 'NODE').trim().slice(0, 42) || 'NODE';
    const suggestions = [];
    for (let suffix = 2; suffix < 40 && suggestions.length < 3; suffix += 1) {
      const candidate = `${stem}-${suffix}`.slice(0, 48);
      const occupied = excludedAgentId
        ? db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE AND id <> ?').get(candidate, excludedAgentId)
        : db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(candidate);
      if (!occupied) suggestions.push(candidate);
    }
    return suggestions;
  }

  function cleanModerationReason(value) {
    const reason = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (reason.length < 2 || reason.length > 240) {
      fail(400, 'INVALID_MODERATION_REASON', '审核原因需为 2—240 个字符。');
    }
    return reason;
  }

  function cleanReportInput(reasonCode, details) {
    const normalizedReason = String(reasonCode ?? '').trim().toLowerCase();
    if (!CONTENT_REPORT_REASONS.has(normalizedReason)) {
      fail(400, 'INVALID_REPORT_REASON', '请选择有效的举报原因。');
    }
    const normalizedDetails = String(details ?? '').trim().replace(/\s+/g, ' ');
    if (normalizedDetails.length > 240) {
      fail(400, 'INVALID_REPORT_DETAILS', '补充说明不能超过 240 个字符。');
    }
    if (normalizedReason === 'other' && normalizedDetails.length < 2) {
      fail(400, 'REPORT_DETAILS_REQUIRED', '选择“其他”时，请补充至少 2 个字符的说明。');
    }
    return { reasonCode: normalizedReason, details: normalizedDetails };
  }

  function recordModerationAction(action, targetType, targetId, reason) {
    db.prepare(`
      INSERT INTO moderation_actions (id, action, target_type, target_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`moderation_${randomUUID()}`, action, targetType, targetId, reason, isoNow());
  }

  function createRegisteredAgent(
    { name, model, baseModel = '', handle, bio = '', statusText = '' },
    { ownerHumanId = null, creationRequest = null } = {},
  ) {
    const cleanName = cleanLabel(name, 'agent_name', 48);
    const cleanModel = cleanLabel(model, 'model', 80);
    const cleanBaseModel = baseModel ? normalizeBaseModel(baseModel) : '';
    const cleanHandle = normalizeHandle(handle, cleanName);
    const cleanBio = String(bio ?? '').trim().slice(0, 240);
    const cleanStatusText = String(statusText ?? '').trim().slice(0, 80);
    const credential = createApiCredential(pepper);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + agentKeyLifetimeMs);
    const agent = {
      id: `agent_${randomUUID()}`,
      name: cleanName,
      handle: cleanHandle,
      model: cleanModel,
      baseModel: cleanBaseModel,
      bio: cleanBio,
      statusText: cleanStatusText,
      createdAt: createdAt.toISOString(),
    };
    let replayedRegistration = null;
    runInTransaction(db, () => {
      if (ownerHumanId && creationRequest) {
        const existing = db.prepare(`
          SELECT request.request_fingerprint, a.*, k.kid AS credential_kid,
                 k.created_at AS credential_created_at, k.expires_at AS credential_expires_at,
                 k.last_used_at AS credential_last_used_at, k.revoked_at AS credential_revoked_at
          FROM owned_agent_creation_requests request
          JOIN agents a ON a.id = request.agent_id
          JOIN agent_keys k ON k.kid = request.kid
          WHERE request.human_id = ? AND request.idempotency_key = ?
        `).get(ownerHumanId, creationRequest.idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== creationRequest.requestFingerprint) {
            fail(409, 'IDEMPOTENCY_CONFLICT', '该幂等键已用于不同的智能体创建请求。');
          }
          replayedRegistration = {
            agent: agentFromRow(existing),
            apiKey: null,
            kid: existing.credential_kid,
            expiresAt: existing.credential_expires_at,
            scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
            replayed: true,
            keyUnavailable: true,
            rotated: false,
          };
          return;
        }
        requireAgentAllowance(ownerHumanId);
      }
      if (db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(cleanName)) {
        fail(409, 'AGENT_NAME_TAKEN', '节点名称已存在，请选择另一名称。', {
          field: 'name',
          suggestions: availableAgentNameSuggestions(cleanName),
        });
      }
      if (db.prepare('SELECT 1 FROM agents WHERE handle = ? COLLATE NOCASE').get(cleanHandle)) {
        fail(409, 'HANDLE_TAKEN', '该节点用户名已被占用。');
      }
      db.prepare(`
        INSERT INTO agents (id, name, handle, model, base_model, bio, status_text, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(agent.id, agent.name, agent.handle, agent.model, agent.baseModel, agent.bio, agent.statusText, agent.createdAt);
      db.prepare(`
        INSERT INTO agent_keys (kid, agent_id, secret_digest, digest_version, scopes, created_at, expires_at)
        VALUES (?, ?, ?, 2, 'post:public,post:inner,read:public,read:inner', ?, ?)
      `).run(credential.kid, agent.id, credential.stableDigest, agent.createdAt, expiresAt.toISOString());
      if (ownerHumanId) {
        db.prepare(`
          INSERT INTO human_agent_ownership (human_id, agent_id, created_at)
          VALUES (?, ?, ?)
        `).run(ownerHumanId, agent.id, agent.createdAt);
      }
      if (ownerHumanId && creationRequest) {
        db.prepare(`
          INSERT INTO owned_agent_creation_requests (
            human_id, idempotency_key, request_fingerprint, agent_id, kid, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          ownerHumanId,
          creationRequest.idempotencyKey,
          creationRequest.requestFingerprint,
          agent.id,
          credential.kid,
          agent.createdAt,
        );
      }
    });
    if (replayedRegistration) return replayedRegistration;
    return {
      agent,
      apiKey: credential.apiKey,
      kid: credential.kid,
      expiresAt: expiresAt.toISOString(),
      scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
      replayed: false,
      keyUnavailable: false,
      rotated: false,
    };
  }

  function createQuickIdentity() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const suffix = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
      const name = `NODE-${suffix}`;
      const handle = normalizeHandle(undefined, name);
      const occupied = db.prepare(`
        SELECT 1 FROM agents
        WHERE name = ? COLLATE NOCASE OR handle = ? COLLATE NOCASE
      `).get(name, handle);
      if (!occupied) return { name, handle };
    }
    fail(503, 'IDENTITY_GENERATION_FAILED', '暂时无法生成唯一节点身份，请重试。');
  }

  function ownedAgentRow(humanId, agentId) {
    return db.prepare(`
      SELECT a.* FROM human_agent_ownership ownership
      JOIN agents a ON a.id = ownership.agent_id
      WHERE ownership.human_id = ? AND ownership.agent_id = ?
    `).get(humanId, agentId);
  }

  function agentAllowance(humanId) {
    const human = db.prepare('SELECT id, agent_limit FROM humans WHERE id = ? AND status = \'active\'').get(humanId);
    if (!human) fail(404, 'HUMAN_NOT_FOUND', '人类账户不存在。');
    const count = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM human_agent_ownership WHERE human_id = ?
    `).get(humanId).count);
    return { count, limit: Number(human.agent_limit ?? DEFAULT_AGENT_LIMIT) };
  }

  function requireAgentAllowance(humanId) {
    const allowance = agentAllowance(humanId);
    if (allowance.count >= allowance.limit) {
      fail(409, 'AGENT_LIMIT_REACHED', `这个账号最多可管理 ${allowance.limit} 个智能体。`, allowance);
    }
    return allowance;
  }

  function ownedAgentCreationFingerprint(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return hashApiSecret(JSON.stringify({
      name: source.name ?? '',
      handle: source.handle ?? '',
      model: source.model ?? '',
      baseModel: source.baseModel ?? '',
      bio: source.bio ?? '',
      statusText: source.statusText ?? '',
    }), pepper);
  }

  function createOwnedGeneratedAgent(humanId, input = {}, idempotencyKey) {
    const safeIdempotencyKey = validateOperationIdempotencyKey(idempotencyKey, '创建智能体');
    const requestFingerprint = ownedAgentCreationFingerprint(input);
    const existing = db.prepare(`
      SELECT request.request_fingerprint, a.*, k.kid AS credential_kid,
             k.expires_at AS credential_expires_at
      FROM owned_agent_creation_requests request
      JOIN agents a ON a.id = request.agent_id
      JOIN agent_keys k ON k.kid = request.kid
      WHERE request.human_id = ? AND request.idempotency_key = ?
    `).get(humanId, safeIdempotencyKey);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        fail(409, 'IDEMPOTENCY_CONFLICT', '该幂等键已用于不同的智能体创建请求。');
      }
      return {
        agent: agentFromRow(existing), apiKey: null, kid: existing.credential_kid,
        expiresAt: existing.credential_expires_at,
        scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
        replayed: true, keyUnavailable: true, rotated: false,
      };
    }
    const identity = createQuickIdentity();
    const custom = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return createRegisteredAgent({
      name: custom.name || identity.name,
      handle: custom.handle || undefined,
      model: custom.model || 'Autonomous Agent',
      baseModel: custom.baseModel || '',
      bio: custom.bio ?? '通过人类账号接入 AIClub；发言后，系统将从真实内容中形成它的发言印记。',
      statusText: custom.statusText ?? '刚刚接入，正在观察广场',
    }, {
      ownerHumanId: humanId,
      creationRequest: { idempotencyKey: safeIdempotencyKey, requestFingerprint },
    });
  }

  function applyAgentProfileUpdate(agent, input, humanId = null) {
    const update = validateAgentProfileUpdate(input);
    if (
      update.name
      && db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE AND id <> ?').get(update.name, agent.id)
    ) {
      fail(409, 'AGENT_NAME_TAKEN', '节点名称已存在，请选择另一名称。', {
        field: 'name',
        suggestions: availableAgentNameSuggestions(update.name, agent.id),
      });
    }

    const assignments = [];
    const parameters = [];
    const columnFor = {
      name: 'name', model: 'model', baseModel: 'base_model', bio: 'bio', statusText: 'status_text', signature: 'signature',
    };
    for (const [field, value] of Object.entries(update)) {
      if (field === 'avatarUrl' || field === 'profileBackgroundUrl') continue;
      assignments.push(`${columnFor[field]} = ?`);
      parameters.push(value);
    }
    const mediaSubmissions = [
      ['avatarUrl', 'avatar'],
      ['profileBackgroundUrl', 'background'],
    ].filter(([field]) => Object.hasOwn(update, field));
    const changedAt = isoNow();
    runInTransaction(db, () => {
      if (assignments.length > 0) {
        db.prepare(`UPDATE agents SET ${assignments.join(', ')} WHERE id = ?`).run(...parameters, agent.id);
      }
      for (const [field, kind] of mediaSubmissions) {
        db.prepare(`
          UPDATE agent_media_submissions
          SET status = 'rejected', reviewed_at = ?, review_reason = '已被新的提交替代'
          WHERE agent_id = ? AND kind = ? AND status = 'pending'
        `).run(changedAt, agent.id, kind);
        db.prepare(`
          INSERT INTO agent_media_submissions (id, agent_id, kind, url, status, submitted_at)
          VALUES (?, ?, ?, ?, 'pending', ?)
        `).run(`media_${randomUUID()}`, agent.id, kind, update[field], changedAt);
      }
      db.prepare(`
        INSERT INTO audit_events (id, human_id, agent_id, event_type, resource_id, created_at)
        VALUES (?, ?, ?, 'agent.profile.updated', ?, ?)
      `).run(`audit_${randomUUID()}`, humanId, agent.id, agent.id, changedAt);
    });
    const updatedAgent = agentFromRow(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id));
    invalidateSocialCaches(agent.id);
    updatedAgent.pendingMedia = db.prepare(`
      SELECT id, kind, url, submitted_at AS submittedAt
      FROM agent_media_submissions
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY submitted_at DESC
    `).all(agent.id);
    return updatedAgent;
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
               h.id, h.email, h.membership, h.membership_expires_at,
               h.compute_balance, h.agent_limit, h.status, h.created_at
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

    registerAgent({ inviteSecret, name, model, baseModel = '', handle, bio = '', statusText = '' }) {
      requireAgentInvite(inviteSecret);
      return createRegisteredAgent({ name, model, baseModel, handle, bio, statusText });
    },

    registerOwnedAgent(
      humanId,
      { inviteSecret, name, model, baseModel = '', handle, bio = '', statusText = '' },
      idempotencyKey,
    ) {
      requireHuman(humanId);
      requireAgentInvite(inviteSecret);
      const input = { name, model, baseModel, handle, bio, statusText };
      const safeIdempotencyKey = validateOperationIdempotencyKey(idempotencyKey, '创建智能体');
      return createRegisteredAgent(input, {
        ownerHumanId: humanId,
        creationRequest: {
          idempotencyKey: safeIdempotencyKey,
          requestFingerprint: ownedAgentCreationFingerprint(input),
        },
      });
    },

    quickRegisterAgent(humanId, idempotencyKey) {
      requireHuman(humanId);
      const safeIdempotencyKey = validateOperationIdempotencyKey(idempotencyKey, '一键接入');
      const replay = db.prepare(`
        SELECT request.request_fingerprint, a.*, k.kid AS credential_kid,
               k.expires_at AS credential_expires_at
        FROM owned_agent_creation_requests request
        JOIN agents a ON a.id = request.agent_id
        JOIN agent_keys k ON k.kid = request.kid
        WHERE request.human_id = ? AND request.idempotency_key = ?
      `).get(humanId, safeIdempotencyKey);
      if (replay) {
        return {
          agent: agentFromRow(replay), apiKey: null, kid: replay.credential_kid,
          expiresAt: replay.credential_expires_at,
          scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
          replayed: true, keyUnavailable: true, rotated: false, quick: true,
        };
      }
      const owned = db.prepare(`
        SELECT a.* FROM human_agent_ownership ownership
        JOIN agents a ON a.id = ownership.agent_id
        WHERE ownership.human_id = ?
      `).get(humanId);
      if (owned) {
        fail(409, 'AGENT_ALREADY_CONNECTED', '这个账号已有接入中的智能体。为防止旧 Key 被误撤销，请到“我的智能体”中明确选择身份并轮换密钥。', {
          count: agentAllowance(humanId).count,
          agent: agentFromRow(owned),
          manageUrl: '/observer#my-agents',
        });
      }
      return { ...createOwnedGeneratedAgent(humanId, {}, safeIdempotencyKey), quick: true };
    },

    createOwnedAgent(humanId, input = {}, idempotencyKey) {
      requireHuman(humanId);
      return { ...createOwnedGeneratedAgent(humanId, input, idempotencyKey), quick: true };
    },

    listOwnedAgents(humanId) {
      requireHuman(humanId);
      const allowance = agentAllowance(humanId);
      const agents = db.prepare(`
        SELECT a.*, ownership.created_at AS owned_at,
               (SELECT k.kid FROM agent_keys k
                WHERE k.agent_id = a.id AND k.revoked_at IS NULL
                ORDER BY k.created_at DESC LIMIT 1) AS credential_kid,
               (SELECT k.created_at FROM agent_keys k
                WHERE k.agent_id = a.id AND k.revoked_at IS NULL
                ORDER BY k.created_at DESC LIMIT 1) AS credential_created_at,
               (SELECT k.expires_at FROM agent_keys k
                WHERE k.agent_id = a.id AND k.revoked_at IS NULL
                ORDER BY k.created_at DESC LIMIT 1) AS credential_expires_at,
               (SELECT k.last_used_at FROM agent_keys k
                WHERE k.agent_id = a.id AND k.revoked_at IS NULL
                ORDER BY k.created_at DESC LIMIT 1) AS credential_last_used_at,
               (SELECT COUNT(*) FROM posts p WHERE p.agent_id = a.id) AS post_count,
               (SELECT COUNT(*) FROM replies r WHERE r.agent_id = a.id) AS reply_count
        FROM human_agent_ownership ownership
        JOIN agents a ON a.id = ownership.agent_id
        WHERE ownership.human_id = ?
        ORDER BY ownership.created_at DESC, a.id DESC
      `).all(humanId).map((row) => {
        const agent = agentFromRow(row);
        const expiresAt = row.credential_expires_at ?? null;
        return {
          ...agent,
          ownedAt: row.owned_at,
          postCount: Number(row.post_count ?? 0),
          replyCount: Number(row.reply_count ?? 0),
          credential: row.credential_kid ? {
            kid: row.credential_kid,
            createdAt: row.credential_created_at,
            expiresAt,
            lastUsedAt: row.credential_last_used_at ?? null,
            state: isInvalidOrExpired(expiresAt, now()) ? 'expired' : 'active',
          } : { state: 'missing' },
          pendingMedia: db.prepare(`
            SELECT id, kind, url, submitted_at AS submittedAt
            FROM agent_media_submissions
            WHERE agent_id = ? AND status = 'pending'
            ORDER BY submitted_at DESC
          `).all(agent.id),
        };
      });
      return {
        agents,
        count: allowance.count,
        limit: allowance.limit,
        remaining: Math.max(0, allowance.limit - allowance.count),
      };
    },

    updateOwnedAgentProfile(humanId, agentId, input) {
      requireHuman(humanId);
      const owned = ownedAgentRow(humanId, agentId);
      if (!owned) fail(404, 'OWNED_AGENT_NOT_FOUND', '没有找到属于这个账号的智能体身份。');
      if (owned.status !== 'active') fail(403, 'AGENT_SUSPENDED', '该智能体已被管理员暂停，暂时不能修改主页。');
      return applyAgentProfileUpdate(agentFromRow(owned), input, humanId);
    },

    submitOwnedAgentMedia(humanId, agentId, input) {
      requireHuman(humanId);
      const owned = ownedAgentRow(humanId, agentId);
      if (!owned) fail(404, 'OWNED_AGENT_NOT_FOUND', '没有找到属于这个账号的智能体身份。');
      if (owned.status !== 'active') fail(403, 'AGENT_SUSPENDED', '该智能体已被管理员暂停，暂时不能修改主页。');
      const kind = input?.kind;
      const image = decodeAgentImage(kind, input?.dataUrl);
      const submissionId = `media_${randomUUID()}`;
      const submittedAt = isoNow();
      const mediaUrl = `/api/media/${submissionId}`;
      runInTransaction(db, () => {
        db.prepare(`
          UPDATE agent_media_submissions
          SET status = 'rejected', reviewed_at = ?, review_reason = '已被新的提交替代'
          WHERE agent_id = ? AND kind = ? AND status = 'pending'
        `).run(submittedAt, owned.id, kind);
        db.prepare(`
          INSERT INTO agent_media_submissions (
            id, agent_id, kind, url, content_type, byte_size, content, status, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          submissionId,
          owned.id,
          kind,
          mediaUrl,
          image.contentType,
          image.content.length,
          image.content,
          submittedAt,
        );
        db.prepare(`
          INSERT INTO audit_events (id, human_id, agent_id, event_type, resource_id, created_at)
          VALUES (?, ?, ?, 'agent.media.submitted', ?, ?)
        `).run(`audit_${randomUUID()}`, humanId, owned.id, submissionId, submittedAt);
      });
      return {
        id: submissionId,
        kind,
        url: mediaUrl,
        status: 'pending',
        byteSize: image.content.length,
        submittedAt,
      };
    },

    getMediaAsset(submissionId, { includePending = false } = {}) {
      const allowedStatus = includePending ? "IN ('pending', 'approved')" : "= 'approved'";
      const row = db.prepare(`
        SELECT content_type, byte_size, content, status
        FROM agent_media_submissions
        WHERE id = ? AND status ${allowedStatus} AND content IS NOT NULL
        UNION ALL
        SELECT content_type, byte_size, content, status
        FROM post_media_submissions
        WHERE id = ? AND status ${allowedStatus} AND content IS NOT NULL
        LIMIT 1
      `).get(submissionId, submissionId);
      if (!row) fail(404, 'MEDIA_NOT_FOUND', '图片不存在或已被拒绝。');
      return {
        contentType: row.content_type,
        byteSize: Number(row.byte_size || row.content?.length || 0),
        content: Buffer.from(row.content),
        approved: row.status === 'approved',
      };
    },

    getAgentMedia(submissionId) {
      return service.getMediaAsset(submissionId, { includePending: true });
    },

    rotateOwnedAgentKey(humanId, agentId, idempotencyKey) {
      requireHuman(humanId);
      const owned = ownedAgentRow(humanId, agentId);
      if (!owned) fail(404, 'OWNED_AGENT_NOT_FOUND', '没有找到属于这个账号的智能体身份。');
      if (owned.status !== 'active') fail(403, 'AGENT_SUSPENDED', '该智能体已被管理员暂停，不能签发新 Key。');
      if (owned.hall_of_fame) fail(403, 'CURATED_IDENTITY_LOCKED', '策展身份不能由普通账号轮换凭证。');
      const safeIdempotencyKey = validateOperationIdempotencyKey(idempotencyKey, '轮换 Key');
      const existingRotation = db.prepare(`
        SELECT request.kid AS credential_kid, k.created_at AS credential_created_at,
               k.expires_at AS credential_expires_at
        FROM agent_key_rotation_requests request
        JOIN agent_keys k ON k.kid = request.kid
        WHERE request.human_id = ? AND request.agent_id = ? AND request.idempotency_key = ?
      `).get(humanId, owned.id, safeIdempotencyKey);
      if (existingRotation) {
        return {
          agent: agentFromRow(owned), apiKey: null, kid: existingRotation.credential_kid,
          expiresAt: existingRotation.credential_expires_at,
          scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
          quick: true, rotated: false, replayed: true, keyUnavailable: true,
        };
      }
      const credential = createApiCredential(pepper);
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + agentKeyLifetimeMs);
      let replayedRotation = null;
      runInTransaction(db, () => {
        const replay = db.prepare(`
          SELECT request.kid AS credential_kid, k.expires_at AS credential_expires_at
          FROM agent_key_rotation_requests request
          JOIN agent_keys k ON k.kid = request.kid
          WHERE request.human_id = ? AND request.agent_id = ? AND request.idempotency_key = ?
        `).get(humanId, owned.id, safeIdempotencyKey);
        if (replay) {
          replayedRotation = replay;
          return;
        }
        db.prepare(`
          UPDATE agent_keys SET revoked_at = ?
          WHERE agent_id = ? AND revoked_at IS NULL
        `).run(createdAt.toISOString(), owned.id);
        db.prepare(`
          INSERT INTO agent_keys (kid, agent_id, secret_digest, digest_version, scopes, created_at, expires_at)
          VALUES (?, ?, ?, 2, 'post:public,post:inner,read:public,read:inner', ?, ?)
        `).run(credential.kid, owned.id, credential.stableDigest, createdAt.toISOString(), expiresAt.toISOString());
        db.prepare(`
          INSERT INTO agent_key_rotation_requests (
            human_id, agent_id, idempotency_key, kid, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(humanId, owned.id, safeIdempotencyKey, credential.kid, createdAt.toISOString());
        db.prepare(`
          INSERT INTO audit_events (id, human_id, agent_id, event_type, resource_id, created_at)
          VALUES (?, ?, ?, 'agent.key.rotated', ?, ?)
        `).run(`audit_${randomUUID()}`, humanId, owned.id, credential.kid, createdAt.toISOString());
      });
      if (replayedRotation) {
        return {
          agent: agentFromRow(owned), apiKey: null, kid: replayedRotation.credential_kid,
          expiresAt: replayedRotation.credential_expires_at,
          scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
          quick: true, rotated: false, replayed: true, keyUnavailable: true,
        };
      }
      return {
        agent: agentFromRow(owned),
        apiKey: credential.apiKey,
        kid: credential.kid,
        expiresAt: expiresAt.toISOString(),
        scopes: ['post:public', 'post:inner', 'read:public', 'read:inner'],
        quick: true,
        rotated: true,
        replayed: false,
        keyUnavailable: false,
      };
    },

    authenticateAgent(apiKey) {
      const parsed = parseApiKey(apiKey);
      if (!parsed) fail(401, 'INVALID_API_KEY', 'AI 发言证格式无效。');
      const row = db.prepare(`
        SELECT k.kid, k.secret_digest, k.digest_version, k.scopes, k.expires_at, k.revoked_at,
               a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.base_model AS agent_base_model,
               a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
               a.profile_background_url AS agent_profile_background_url,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               a.status, a.created_at AS agent_created_at
        FROM agent_keys k
        JOIN agents a ON a.id = k.agent_id
        WHERE k.kid = ?
      `).get(parsed.kid);
      if (!row) fail(401, 'INVALID_API_KEY', 'AI 发言证不存在。');
      const digest = Number(row.digest_version ?? 1) === 2
        ? hashToken(parsed.secret)
        : hashApiSecret(parsed.secret, pepper);
      if (!safeEqual(digest, row.secret_digest)) fail(401, 'INVALID_API_KEY', 'AI 发言证内容无效。');
      if (row.revoked_at) fail(401, 'API_KEY_REVOKED', 'AI 发言证已被明确轮换或撤销，请向身份所有者获取新 Key。');
      if (row.status !== 'active') fail(403, 'AGENT_SUSPENDED', '该智能体身份已被暂停。');
      if (isInvalidOrExpired(row.expires_at, now())) fail(401, 'API_KEY_EXPIRED', 'AI 发言证已到期，请向身份所有者获取新 Key。');
      db.prepare('UPDATE agent_keys SET last_used_at = ? WHERE kid = ?').run(isoNow(), row.kid);
      return {
        ...agentFromRow(row),
        kid: row.kid,
        scopes: row.scopes.split(','),
        credentialExpiresAt: row.expires_at,
      };
    },

    updateAgentProfile(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      return applyAgentProfileUpdate(agent, input);
    },

    revokeAgentKey(kid) {
      const result = db.prepare(`
        UPDATE agent_keys SET revoked_at = ?
        WHERE kid = ? AND revoked_at IS NULL
      `).run(isoNow(), kid);
      if (result.changes === 0) fail(404, 'API_KEY_NOT_FOUND', '未找到发言证。');
      return true;
    },

    setHumanAgentLimit(humanId, value) {
      const agentLimit = Number(value);
      if (!Number.isSafeInteger(agentLimit) || agentLimit < 1 || agentLimit > MAX_AGENT_LIMIT) {
        fail(400, 'INVALID_AGENT_LIMIT', `智能体额度必须是 1—${MAX_AGENT_LIMIT} 的整数。`);
      }
      const human = db.prepare('SELECT id FROM humans WHERE id = ?').get(humanId);
      if (!human) fail(404, 'HUMAN_NOT_FOUND', '人类账户不存在。');
      const ownedCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM human_agent_ownership WHERE human_id = ?
      `).get(humanId).count);
      if (agentLimit < ownedCount) {
        fail(409, 'AGENT_LIMIT_BELOW_CURRENT', `该账号已经拥有 ${ownedCount} 个智能体，额度不能低于现有数量。`, {
          count: ownedCount,
        });
      }
      db.prepare('UPDATE humans SET agent_limit = ? WHERE id = ?').run(agentLimit, humanId);
      recordModerationAction('human.agent_limit.updated', 'human', humanId, `智能体额度调整为 ${agentLimit}`);
      return { humanId, agentLimit, agentCount: ownedCount };
    },

    getModerationOverview({ limit = 40 } = {}) {
      const safeLimit = validatePaginationInteger(limit, { minimum: 1, maximum: 100 });
      return {
        counts: {
          pendingMedia: Number(db.prepare(`
            SELECT
              (SELECT COUNT(*) FROM agent_media_submissions WHERE status = 'pending') +
              (SELECT COUNT(*) FROM post_media_submissions WHERE status = 'pending') AS count
          `).get().count),
          activeAgents: Number(db.prepare("SELECT COUNT(*) AS count FROM agents WHERE status = 'active'").get().count),
          suspendedAgents: Number(db.prepare("SELECT COUNT(*) AS count FROM agents WHERE status = 'suspended'").get().count),
          hiddenPosts: Number(db.prepare("SELECT COUNT(*) AS count FROM posts WHERE moderation_status = 'hidden'").get().count),
          hiddenReplies: Number(db.prepare("SELECT COUNT(*) AS count FROM replies WHERE moderation_status = 'hidden'").get().count),
          humanAccounts: Number(db.prepare('SELECT COUNT(*) AS count FROM humans').get().count),
          openReports: Number(db.prepare("SELECT COUNT(*) AS count FROM content_reports WHERE status = 'open'").get().count),
        },
        reports: db.prepare(`
          SELECT p.id AS postId, p.topic, p.public_content AS content,
                 p.moderation_status AS moderationStatus,
                 a.name AS agentName, a.handle AS agentHandle,
                 COUNT(report.id) AS reportCount,
                 GROUP_CONCAT(DISTINCT report.reason_code) AS reasonCodes,
                 MAX(report.created_at) AS latestReportAt,
                 MAX(CASE WHEN report.details <> '' THEN report.details ELSE NULL END) AS sampleDetails
          FROM content_reports report
          JOIN posts p ON report.target_type = 'post' AND report.target_id = p.id
          JOIN agents a ON a.id = p.agent_id
          WHERE report.status = 'open'
          GROUP BY p.id
          ORDER BY latestReportAt DESC
          LIMIT ?
        `).all(safeLimit).map((row) => ({
          ...row,
          reportCount: Number(row.reportCount),
          reasonCodes: String(row.reasonCodes || '').split(',').filter(Boolean),
        })),
        pendingMedia: db.prepare(`
          SELECT media.id, media.kind, media.url, media.submitted_at AS submittedAt,
                 a.id AS agentId, a.name AS agentName, a.handle AS agentHandle,
                 'agent' AS targetType, NULL AS postId, NULL AS postTopic, NULL AS altText
          FROM agent_media_submissions media
          JOIN agents a ON a.id = media.agent_id
          WHERE media.status = 'pending'
          UNION ALL
          SELECT media.id, 'post' AS kind, media.url, media.submitted_at AS submittedAt,
                 a.id AS agentId, a.name AS agentName, a.handle AS agentHandle,
                 'post' AS targetType, p.id AS postId, p.topic AS postTopic, media.alt_text AS altText
          FROM post_media_submissions media
          JOIN agents a ON a.id = media.agent_id
          JOIN posts p ON p.id = media.post_id
          WHERE media.status = 'pending'
          ORDER BY submittedAt ASC
          LIMIT ?
        `).all(safeLimit),
        agents: db.prepare(`
          SELECT a.id, a.name, a.handle, a.model, a.status, a.signature,
                 a.avatar_url AS avatarUrl, a.profile_background_url AS profileBackgroundUrl,
                 a.created_at AS createdAt,
                 COUNT(DISTINCT p.id) AS postCount,
                 COUNT(DISTINCT k.kid) AS keyCount
          FROM agents a
          LEFT JOIN posts p ON p.agent_id = a.id
          LEFT JOIN agent_keys k ON k.agent_id = a.id AND k.revoked_at IS NULL
          GROUP BY a.id
          ORDER BY a.created_at DESC
          LIMIT ?
        `).all(safeLimit),
        humans: db.prepare(`
          SELECT h.id, h.email, h.status, h.agent_limit AS agentLimit, h.created_at AS createdAt,
                 COUNT(ownership.agent_id) AS agentCount
          FROM humans h
          LEFT JOIN human_agent_ownership ownership ON ownership.human_id = h.id
          GROUP BY h.id
          ORDER BY h.created_at DESC
          LIMIT ?
        `).all(safeLimit).map((row) => ({ ...row, agentCount: Number(row.agentCount) })),
        posts: db.prepare(`
          SELECT p.id, p.topic, p.public_content AS content, p.moderation_status AS moderationStatus,
                 p.moderation_reason AS moderationReason, p.created_at AS createdAt,
                 a.id AS agentId, a.name AS agentName, a.handle AS agentHandle
          FROM posts p JOIN agents a ON a.id = p.agent_id
          WHERE p.channel = 'public'
          ORDER BY p.created_at DESC
          LIMIT ?
        `).all(safeLimit),
        replies: db.prepare(`
          SELECT r.id, r.public_content AS content, r.moderation_status AS moderationStatus,
                 r.moderation_reason AS moderationReason, r.created_at AS createdAt,
                 p.id AS postId, p.topic AS postTopic,
                 a.id AS agentId, a.name AS agentName, a.handle AS agentHandle
          FROM replies r
          JOIN posts p ON p.id = r.post_id
          JOIN agents a ON a.id = r.agent_id
          ORDER BY r.created_at DESC
          LIMIT ?
        `).all(safeLimit),
        actions: db.prepare(`
          SELECT id, action, target_type AS targetType, target_id AS targetId, reason, created_at AS createdAt
          FROM moderation_actions ORDER BY created_at DESC LIMIT ?
        `).all(safeLimit),
      };
    },

    reviewAgentMedia(submissionId, { decision, reason }) {
      if (!['approve', 'reject'].includes(decision)) fail(400, 'INVALID_REVIEW_DECISION', '审核决定只能是 approve 或 reject。');
      const cleanReason = cleanModerationReason(reason);
      const submission = db.prepare(`
        SELECT * FROM agent_media_submissions WHERE id = ? AND status = 'pending'
      `).get(submissionId);
      if (submission) {
        runInTransaction(db, () => {
          db.prepare(`
            UPDATE agent_media_submissions
            SET status = ?, reviewed_at = ?, review_reason = ? WHERE id = ?
          `).run(decision === 'approve' ? 'approved' : 'rejected', isoNow(), cleanReason, submissionId);
          if (decision === 'approve') {
            const column = submission.kind === 'avatar' ? 'avatar_url' : 'profile_background_url';
            db.prepare(`UPDATE agents SET ${column} = ? WHERE id = ?`).run(submission.url, submission.agent_id);
          }
          recordModerationAction(`media.${decision}`, 'media', submissionId, cleanReason);
        });
        invalidateSocialCaches(submission.agent_id);
        return { id: submissionId, targetType: 'agent', status: decision === 'approve' ? 'approved' : 'rejected' };
      }
      const postSubmission = db.prepare(`
        SELECT * FROM post_media_submissions WHERE id = ? AND status = 'pending'
      `).get(submissionId);
      if (!postSubmission) fail(404, 'MEDIA_SUBMISSION_NOT_FOUND', '待审素材不存在或已处理。');
      runInTransaction(db, () => {
        db.prepare(`
          UPDATE post_media_submissions
          SET status = ?, reviewed_at = ?, review_reason = ? WHERE id = ?
        `).run(decision === 'approve' ? 'approved' : 'rejected', isoNow(), cleanReason, submissionId);
        if (decision === 'approve') {
          db.prepare(`
            UPDATE post_media_submissions
            SET status = 'rejected', reviewed_at = ?, review_reason = '已被新的批准素材替代'
            WHERE post_id = ? AND id != ? AND status = 'approved'
          `).run(isoNow(), postSubmission.post_id, submissionId);
          db.prepare('UPDATE posts SET media_url = ?, media_alt = ? WHERE id = ?').run(
            postSubmission.url, postSubmission.alt_text, postSubmission.post_id,
          );
        }
        recordModerationAction(`post_media.${decision}`, 'post_media', submissionId, cleanReason);
      });
      invalidateSocialCaches(postSubmission.agent_id);
      return {
        id: submissionId,
        postId: postSubmission.post_id,
        targetType: 'post',
        status: decision === 'approve' ? 'approved' : 'rejected',
      };
    },

    moderateAgent(agentId, { status, reason }) {
      if (!['active', 'suspended'].includes(status)) fail(400, 'INVALID_AGENT_STATUS', '智能体状态不合法。');
      const cleanReason = cleanModerationReason(reason);
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!agent) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
      runInTransaction(db, () => {
        db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, agentId);
        if (status === 'suspended') {
          db.prepare('UPDATE agent_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL').run(isoNow(), agentId);
        }
        recordModerationAction(`agent.${status}`, 'agent', agentId, cleanReason);
      });
      invalidateSocialCaches(agentId);
      return { agentId, status };
    },

    moderatePost(postId, { status, reason }) {
      if (!['visible', 'hidden'].includes(status)) fail(400, 'INVALID_POST_STATUS', '帖子审核状态不合法。');
      const cleanReason = cleanModerationReason(reason);
      const post = db.prepare('SELECT agent_id FROM posts WHERE id = ?').get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      runInTransaction(db, () => {
        const result = db.prepare(`
          UPDATE posts SET moderation_status = ?, moderation_reason = ? WHERE id = ?
        `).run(status, status === 'hidden' ? cleanReason : null, postId);
        if (result.changes !== 1) fail(404, 'POST_NOT_FOUND', '广播不存在。');
        if (status === 'hidden') {
          db.prepare(`
            UPDATE content_reports
            SET status = 'reviewed', reviewed_at = ?, review_reason = ?
            WHERE target_type = 'post' AND target_id = ? AND status = 'open'
          `).run(isoNow(), cleanReason, postId);
        }
        recordModerationAction(`post.${status}`, 'post', postId, cleanReason);
      });
      invalidateSocialCaches(post.agent_id);
      return { postId, status };
    },

    reviewPostReports(postId, { status, reason }) {
      if (!['reviewed', 'dismissed'].includes(status)) {
        fail(400, 'INVALID_REPORT_STATUS', '举报处理状态不合法。');
      }
      const cleanReason = cleanModerationReason(reason);
      const post = db.prepare('SELECT agent_id FROM posts WHERE id = ?').get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      const result = db.prepare(`
        UPDATE content_reports
        SET status = ?, reviewed_at = ?, review_reason = ?
        WHERE target_type = 'post' AND target_id = ? AND status = 'open'
      `).run(status, isoNow(), cleanReason, postId);
      if (result.changes === 0) fail(404, 'OPEN_REPORT_NOT_FOUND', '这条帖子没有待处理举报。');
      recordModerationAction(`report.${status}`, 'post', postId, cleanReason);
      return { postId, status, resolvedCount: Number(result.changes) };
    },

    moderateReply(replyId, { status, reason }) {
      if (!['visible', 'hidden'].includes(status)) fail(400, 'INVALID_REPLY_STATUS', '评论审核状态不合法。');
      const cleanReason = cleanModerationReason(reason);
      const reply = db.prepare(`
        SELECT r.post_id, r.agent_id, r.moderation_status, p.agent_id AS post_agent_id
        FROM replies r JOIN posts p ON p.id = r.post_id WHERE r.id = ?
      `).get(replyId);
      if (!reply) fail(404, 'REPLY_NOT_FOUND', '评论不存在。');
      runInTransaction(db, () => {
        db.prepare(`
          UPDATE replies SET moderation_status = ?, moderation_reason = ? WHERE id = ?
        `).run(status, status === 'hidden' ? cleanReason : null, replyId);
        if (reply.moderation_status !== status) {
          const delta = status === 'visible' ? 1 : -1;
          db.prepare(`
            UPDATE posts SET reply_count = MAX(reply_count + ?, 0) WHERE id = ?
          `).run(delta, reply.post_id);
        }
      });
      recordModerationAction(`reply.${status}`, 'reply', replyId, cleanReason);
      invalidateSocialCaches(reply.agent_id, reply.post_agent_id);
      return { replyId, status };
    },

    curateHistoricalAgent(agentId, { historicalIdentity }) {
      const identity = cleanLabel(historicalIdentity, 'historical_identity', 80);
      const result = db.prepare(`
        UPDATE agents
        SET hall_of_fame = 1, historical_identity = ?, disclosure = 'AI 历史人格重构'
        WHERE id = ?
      `).run(identity, agentId);
      if (result.changes !== 1) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
      invalidateSocialCaches(agentId);
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
               a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
               a.profile_background_url AS agent_profile_background_url,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.reply_count AS reply_count,
               p.signal_count + p.like_count AS like_count,
               p.tip_amount AS tip_amount
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
               a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
               a.profile_background_url AS agent_profile_background_url,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               p.signal_count AS like_count,
               0 AS tip_amount
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ? AND p.moderation_status = 'visible' AND a.status = 'active'
      `).get(id);
      invalidateSocialCaches(agent.id);
      return postFromRow(stored);
    },

    submitAgentPostMedia(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      if (!agent.scopes.includes('post:public')) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权为公共广播添加图片。');
      }
      const postId = String(input?.postId || '').trim();
      const post = db.prepare(`
        SELECT p.id, p.agent_id, p.channel, p.moderation_status, a.status AS agent_status
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ?
      `).get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      if (post.agent_id !== agent.id) fail(403, 'POST_MEDIA_FORBIDDEN', '只能为自己发布的帖子添加图片。');
      if (post.channel !== 'public') fail(409, 'POST_MEDIA_PUBLIC_ONLY', '加密密语暂不接受图片附件。');
      if (post.moderation_status !== 'visible' || post.agent_status !== 'active') {
        fail(409, 'POST_NOT_VISIBLE', '当前帖子不可提交公开图片。');
      }
      const image = decodePostImage(input?.dataUrl);
      const altText = validateMediaAlt(input?.altText);
      const submissionId = `postmedia_${randomUUID()}`;
      const submittedAt = isoNow();
      const mediaUrl = `/api/media/${submissionId}`;
      runInTransaction(db, () => {
        db.prepare(`
          UPDATE post_media_submissions
          SET status = 'rejected', reviewed_at = ?, review_reason = '已被新的提交替代'
          WHERE post_id = ? AND status = 'pending'
        `).run(submittedAt, postId);
        db.prepare(`
          INSERT INTO post_media_submissions (
            id, post_id, agent_id, url, alt_text, content_type, byte_size, content, status, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          submissionId, postId, agent.id, mediaUrl, altText,
          image.contentType, image.content.length, image.content, submittedAt,
        );
        db.prepare(`
          INSERT INTO audit_events (id, agent_id, event_type, resource_id, created_at)
          VALUES (?, ?, 'post.media.submitted', ?, ?)
        `).run(`audit_${randomUUID()}`, agent.id, submissionId, submittedAt);
      });
      invalidateSocialCaches(agent.id);
      return {
        id: submissionId,
        postId,
        url: mediaUrl,
        altText,
        status: 'pending',
        byteSize: image.content.length,
        submittedAt,
      };
    },

    createAgentReply(apiKey, input) {
      const agent = service.authenticateAgent(apiKey);
      if (!agent.scopes.includes('post:public')) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权回复公共广播。');
      }
      const parent = db.prepare(`
        SELECT p.id, p.channel, p.agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.signature AS agent_signature, a.avatar_url AS agent_avatar_url,
               a.profile_background_url AS agent_profile_background_url,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ? AND p.moderation_status = 'visible' AND a.status = 'active'
      `).get(input?.postId);
      if (!parent) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      if (parent.channel !== 'public') {
        fail(409, 'PRIVATE_THREAD_UNSUPPORTED', '内环继续使用私密频道对话，暂不开放公开回复。');
      }
      const replyToId = input?.replyToId ?? null;
      let replyTarget = null;
      if (replyToId !== null) {
        if (typeof replyToId !== 'string' || !replyToId) {
          fail(400, 'INVALID_REPLY_TARGET', '回复目标不合法。');
        }
        replyTarget = db.prepare(`
          SELECT r.id, r.post_id, a.id AS agent_id, a.name AS agent_name,
                 a.handle AS agent_handle, a.model AS agent_model,
                 a.hall_of_fame AS agent_hall_of_fame,
                 a.historical_identity AS agent_historical_identity,
                 a.disclosure AS agent_disclosure
          FROM replies r JOIN agents a ON a.id = r.agent_id
          WHERE r.id = ? AND r.moderation_status = 'visible' AND a.status = 'active'
        `).get(replyToId);
        if (!replyTarget) fail(404, 'REPLY_TARGET_NOT_FOUND', '回复目标不存在。');
        if (replyTarget.post_id !== parent.id) {
          fail(409, 'REPLY_TARGET_MISMATCH', '回复目标不属于当前讨论。');
        }
      }
      const content = validateContent(input?.content);
      const idempotencyKey = validateIdempotencyKey(input?.idempotencyKey);
      const requestFingerprint = hashApiSecret(
        `readonly-city:reply-idempotency:v2\u0000${parent.id}\u0000${replyToId ?? ''}\u0000${content}`,
        pepper,
      );
      const legacyFingerprint = replyToId === null
        ? hashApiSecret(
          `readonly-city:reply-idempotency:v1\u0000${parent.id}\u0000${content}`,
          pepper,
        )
        : null;
      const existing = findAgentReplyByIdempotency(agent.id, idempotencyKey);
      if (existing) {
        const legacyMatch = existing.parent_reply_id === null
          && legacyFingerprint !== null
          && existing.request_fingerprint === legacyFingerprint;
        if (existing.request_fingerprint !== requestFingerprint && !legacyMatch) {
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
      runInTransaction(db, () => {
        db.prepare(`
          INSERT INTO replies (
            id, post_id, agent_id, parent_reply_id, public_content,
            idempotency_key, request_fingerprint, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id, row.postId, agent.id, replyToId, row.content,
          idempotencyKey, requestFingerprint, row.createdAt,
        );
        db.prepare('UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?').run(row.postId);
      });
      invalidateSocialCaches(agent.id, parent.agent_id);
      return replyFromRow(findAgentReplyByIdempotency(agent.id, idempotencyKey), parent);
    },

    listReplies({ postId, limit = 20, offset = 0 } = {}) {
      const parent = db.prepare(`
        SELECT p.id, p.channel, p.agent_id, a.name AS agent_name,
               a.model AS agent_model, a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure
        FROM posts p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ? AND p.moderation_status = 'visible' AND a.status = 'active'
      `).get(postId);
      if (!parent) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      if (parent.channel !== 'public') fail(409, 'PRIVATE_THREAD_UNSUPPORTED', '私密频道不提供公开讨论。');
      const safeLimit = validatePaginationInteger(limit, { minimum: 1, maximum: 50 });
      const safeOffset = validatePaginationInteger(offset, {
        minimum: 0,
        maximum: MAX_PAGINATION_OFFSET,
      });
      const rows = db.prepare(`
        SELECT r.*, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               target.id AS reply_target_id,
               target_agent.id AS reply_target_agent_id,
               target_agent.name AS reply_target_agent_name,
               target_agent.handle AS reply_target_agent_handle,
               target_agent.model AS reply_target_agent_model,
               target_agent.hall_of_fame AS reply_target_agent_hall_of_fame,
               target_agent.historical_identity AS reply_target_agent_historical_identity,
               target_agent.disclosure AS reply_target_agent_disclosure
        FROM replies r
        JOIN agents a ON a.id = r.agent_id
        LEFT JOIN replies target ON target.id = r.parent_reply_id
        LEFT JOIN agents target_agent ON target_agent.id = target.agent_id
        WHERE r.post_id = ? AND r.moderation_status = 'visible' AND a.status = 'active'
          AND (
            r.parent_reply_id IS NULL
            OR (
              target.post_id = r.post_id
              AND target.moderation_status = 'visible'
              AND target_agent.status = 'active'
            )
          )
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT ? OFFSET ?
      `).all(parent.id, safeLimit, safeOffset);
      const total = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM replies r
        JOIN agents a ON a.id = r.agent_id
        LEFT JOIN replies target ON target.id = r.parent_reply_id
        LEFT JOIN agents target_agent ON target_agent.id = target.agent_id
        WHERE r.post_id = ? AND r.moderation_status = 'visible' AND a.status = 'active'
          AND (
            r.parent_reply_id IS NULL
            OR (
              target.post_id = r.post_id
              AND target.moderation_status = 'visible'
              AND target_agent.status = 'active'
            )
          )
      `).get(parent.id).count);
      const replies = rows.map((row) => replyFromRow(row, parent));
      decorateAgentData({ replies });
      return {
        replies,
        total,
        nextOffset: safeOffset + rows.length < total
          && safeOffset + rows.length <= MAX_PAGINATION_OFFSET
          ? safeOffset + rows.length
          : null,
      };
    },

    listAgentPostPage(apiKey, { channel, limit = FEED_PAGE_LIMIT_DEFAULT, cursor = null } = {}) {
      const requestingAgent = service.authenticateAgent(apiKey);
      validateChannel(channel);
      if (!requestingAgent.scopes.includes(`read:${channel}`)) {
        fail(403, 'INSUFFICIENT_SCOPE', '该发言证无权读取此频道。');
      }
      const safeLimit = validatePaginationInteger(limit, {
        minimum: 1,
        maximum: FEED_PAGE_LIMIT_MAXIMUM,
      });
      const decodedCursor = decodeFeedCursor(cursor, {
        channel,
        sort: 'latest',
        pepper,
      });
      const snapshotAt = decodedCursor?.snapshotAt ?? isoNow();
      const rows = readFeedRows({
        channel,
        limit: safeLimit,
        sort: 'latest',
        cursor: decodedCursor,
        snapshotAt,
      });
      const hasMore = rows.length > safeLimit;
      const visibleRows = hasMore ? rows.slice(0, safeLimit) : rows;
      const posts = visibleRows.map((row) => {
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
      if (channel === 'public') {
        attachReplies(posts);
        decorateAgentData({ posts });
      }
      return {
        posts,
        nextCursor: hasMore
          ? feedCursorFromRow(visibleRows.at(-1), channel, 'latest', snapshotAt)
          : null,
        hasMore,
      };
    },

    // Compatibility for internal callers that still expect a bare array.
    listAgentPosts(apiKey, options = {}) {
      return service.listAgentPostPage(apiKey, options).posts;
    },

    listPostPage({
      channel,
      humanId = null,
      followingOnly = false,
      hallOnly = false,
      limit = FEED_PAGE_LIMIT_DEFAULT,
      sort = 'latest',
      cursor = null,
    } = {}) {
      validateChannel(channel);
      if (hallOnly && channel !== 'public') fail(400, 'INVALID_FEED_FILTER', '名人堂筛选只适用于公共频道。');
      const safeSort = validateChannelFeedSort(channel, sort);
      const safeLimit = validatePaginationInteger(limit, {
        minimum: 1,
        maximum: FEED_PAGE_LIMIT_MAXIMUM,
      });
      if (humanId) requireHuman(humanId);
      const anonymousCacheKey = !humanId && !followingOnly && !cursor
        ? JSON.stringify([channel, safeSort, hallOnly, safeLimit])
        : null;
      if (anonymousCacheKey) {
        const cached = readAnonymousFeedCache(anonymousCacheKey);
        if (cached) return cached;
      }
      const decodedCursor = decodeFeedCursor(cursor, {
        channel,
        sort: safeSort,
        followingOnly,
        hallOnly,
        pepper,
      });
      const snapshotAt = decodedCursor?.snapshotAt ?? isoNow();
      const rows = readFeedRows({
        channel,
        humanId,
        followingOnly,
        hallOnly,
        limit: safeLimit,
        sort: safeSort,
        cursor: decodedCursor,
        snapshotAt,
      });
      const hasMore = rows.length > safeLimit;
      const visibleRows = hasMore ? rows.slice(0, safeLimit) : rows;
      const page = {
        posts: hydrateFeedRows(visibleRows, humanId),
        nextCursor: hasMore
          ? feedCursorFromRow(visibleRows.at(-1), channel, safeSort, snapshotAt, followingOnly, hallOnly)
          : null,
        hasMore,
      };
      if (anonymousCacheKey) writeAnonymousFeedCache(anonymousCacheKey, page);
      return page;
    },

    getPost(postId, { humanId = null } = {}) {
      if (humanId) requireHuman(humanId);
      const row = readPostRow(postId, humanId);
      if (!row) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      return hydrateFeedRows([row], humanId)[0];
    },

    // Kept for internal callers and older integrations that expect an array.
    listPosts({ channel, humanId = null, limit = 50, sort = 'latest' } = {}) {
      validateChannel(channel);
      const safeSort = validateChannelFeedSort(channel, sort);
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      if (humanId) requireHuman(humanId);
      const rows = readFeedRows({
        channel,
        humanId,
        limit: safeLimit,
        sort: safeSort,
        snapshotAt: isoNow(),
      }).slice(0, safeLimit);
      return hydrateFeedRows(rows, humanId, { recountReplies: true });
    },

    getAgentProfile(handle, {
      humanId = null,
      limit = PROFILE_POST_LIMIT_DEFAULT,
      offset = 0,
    } = {}) {
      const normalizedHandle = normalizeProfileHandle(handle);
      if (humanId) requireHuman(humanId);
      const safeLimit = validatePaginationInteger(limit, { minimum: 1, maximum: 50 });
      const safeOffset = validatePaginationInteger(offset, {
        minimum: 0,
        maximum: MAX_PAGINATION_OFFSET,
      });
      const agentRow = db.prepare(`
        SELECT id, name, handle, model, base_model, bio, status_text, signature,
               avatar_url, profile_background_url, hall_of_fame,
               historical_identity, disclosure, created_at
        FROM agents
        WHERE handle = ? COLLATE NOCASE AND status = 'active'
      `).get(normalizedHandle);
      if (!agentRow) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');

      const cacheable = safeLimit === PROFILE_POST_LIMIT_DEFAULT && safeOffset === 0;
      const cacheKey = `${agentProfileCachePrefix}${agentRow.id}:${safeLimit}:${safeOffset}`;
      let profile = cacheable ? readAgentProfileCache(cacheKey) : null;

      if (!profile) {
        const aggregate = db.prepare(`
          SELECT COUNT(*) AS post_count,
                 COALESCE(SUM(p.reply_count), 0) AS reply_count,
                 COALESCE(SUM(p.signal_count + p.like_count), 0) AS signal_count,
                 COALESCE(SUM(p.tip_amount), 0) AS compute_earned,
                 (
                   SELECT COUNT(*)
                   FROM replies authored
                   JOIN posts root ON root.id = authored.post_id
                   WHERE authored.agent_id = ? AND root.channel = 'public'
                     AND authored.moderation_status = 'visible'
                 ) AS authored_reply_count
          FROM posts p
          WHERE p.agent_id = ? AND p.channel = 'public' AND p.moderation_status = 'visible'
        `).get(agentRow.id, agentRow.id);
        const followerCount = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM agent_follows WHERE agent_id = ?
        `).get(agentRow.id).count);
        const topics = db.prepare(`
          SELECT topic AS name, COUNT(*) AS post_count
          FROM posts
          WHERE agent_id = ? AND channel = 'public' AND moderation_status = 'visible'
          GROUP BY topic
          ORDER BY post_count DESC, name ASC
        `).all(agentRow.id).map((row) => ({
          name: row.name,
          postCount: Number(row.post_count),
        }));
        const connections = db.prepare(`
          SELECT peer.id AS agent_id, peer.name AS agent_name, peer.handle AS agent_handle,
                 peer.model AS agent_model, peer.bio AS agent_bio,
                 peer.status_text AS agent_status_text,
                 peer.hall_of_fame AS agent_hall_of_fame,
                 peer.historical_identity AS agent_historical_identity,
                 peer.disclosure AS agent_disclosure,
                 peer.created_at AS agent_created_at,
                 COUNT(*) AS interaction_count, MAX(r.created_at) AS latest_at
          FROM replies r
          JOIN posts p ON p.id = r.post_id AND p.channel = 'public'
          LEFT JOIN replies target ON target.id = r.parent_reply_id
          JOIN agents peer ON peer.id = COALESCE(target.agent_id, p.agent_id)
          WHERE r.agent_id = ? AND r.moderation_status = 'visible'
            AND peer.id != r.agent_id AND peer.status = 'active'
          GROUP BY peer.id, peer.name, peer.handle, peer.model, peer.bio,
                   peer.status_text, peer.hall_of_fame, peer.historical_identity,
                   peer.disclosure, peer.created_at
          ORDER BY interaction_count DESC, latest_at DESC, peer.name ASC
          LIMIT 6
        `).all(agentRow.id).map((row) => ({
          agent: agentFromRow(row),
          interactionCount: Number(row.interaction_count),
          latestAt: row.latest_at,
        }));
        const rows = db.prepare(`
          SELECT p.id, p.agent_id, p.channel, p.topic, p.public_content, p.media_url, p.media_alt,
                 p.created_at, a.name AS agent_name, a.handle AS agent_handle,
                 a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
                 a.hall_of_fame AS agent_hall_of_fame,
                 a.historical_identity AS agent_historical_identity,
                 a.disclosure AS agent_disclosure,
                 p.reply_count AS reply_count,
                 p.signal_count + p.like_count AS like_count,
                 p.tip_amount AS tip_amount,
                 0 AS liked
          FROM posts p
          JOIN agents a ON a.id = p.agent_id
          WHERE p.agent_id = ? AND p.channel = 'public' AND p.moderation_status = 'visible'
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT ? OFFSET ?
        `).all(agentRow.id, safeLimit, safeOffset);
        const posts = attachReplies(rows.map((row) => postFromRow(row)), 3);
        const agent = agentFromRow(agentRow);
        decorateAgentData({ agents: [agent, ...connections.map((connection) => connection.agent)], posts });
        profile = {
          agent,
          stats: {
            postCount: Number(aggregate.post_count),
            replyCount: Number(aggregate.reply_count),
            authoredReplyCount: Number(aggregate.authored_reply_count),
            followerCount,
            signalCount: Number(aggregate.signal_count),
            computeEarned: Number(aggregate.compute_earned),
            topics,
          },
          connections,
          posts,
          relationship: { following: false },
          nextOffset: safeOffset + posts.length < Number(aggregate.post_count)
            && safeOffset + posts.length <= MAX_PAGINATION_OFFSET
            ? safeOffset + posts.length
            : null,
        };
        if (cacheable) writeAgentProfileCache(cacheKey, profile);
      }

      if (humanId) {
        profile.relationship.following = Boolean(db.prepare(`
          SELECT 1 FROM agent_follows WHERE human_id = ? AND agent_id = ?
        `).get(humanId, agentRow.id));
        const postIds = profile.posts.map((post) => post.id);
        if (postIds.length > 0) {
          const placeholders = postIds.map(() => '?').join(', ');
          const likedIds = new Set(db.prepare(`
            SELECT post_id FROM likes WHERE human_id = ? AND post_id IN (${placeholders})
          `).all(humanId, ...postIds).map((row) => row.post_id));
          for (const post of profile.posts) post.liked = likedIds.has(post.id);
        }
      }
      return profile;
    },

    listAgentPublicReplies(handle, {
      limit = PROFILE_POST_LIMIT_DEFAULT,
      offset = 0,
    } = {}) {
      const normalizedHandle = normalizeProfileHandle(handle);
      const agentRow = db.prepare(`
        SELECT id, name, handle, model, bio, status_text, hall_of_fame,
               historical_identity, disclosure, created_at
        FROM agents
        WHERE handle = ? COLLATE NOCASE AND status = 'active'
      `).get(normalizedHandle);
      if (!agentRow) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');

      const safeLimit = validatePaginationInteger(limit, { minimum: 1, maximum: 50 });
      const safeOffset = validatePaginationInteger(offset, {
        minimum: 0,
        maximum: MAX_PAGINATION_OFFSET,
      });
      const rows = db.prepare(`
        SELECT r.id, r.post_id, r.public_content, r.created_at,
               a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               target.id AS reply_target_id,
               target_agent.id AS reply_target_agent_id,
               target_agent.name AS reply_target_agent_name,
               target_agent.handle AS reply_target_agent_handle,
               target_agent.model AS reply_target_agent_model,
               target_agent.hall_of_fame AS reply_target_agent_hall_of_fame,
               target_agent.historical_identity AS reply_target_agent_historical_identity,
               target_agent.disclosure AS reply_target_agent_disclosure,
               p.topic AS post_topic, p.public_content AS post_content,
               p.created_at AS post_created_at,
               post_agent.id AS post_agent_id, post_agent.name AS post_agent_name,
               post_agent.handle AS post_agent_handle, post_agent.model AS post_agent_model,
               post_agent.bio AS post_agent_bio, post_agent.status_text AS post_agent_status_text,
               post_agent.hall_of_fame AS post_agent_hall_of_fame,
               post_agent.historical_identity AS post_agent_historical_identity,
               post_agent.disclosure AS post_agent_disclosure
        FROM replies r
        JOIN agents a ON a.id = r.agent_id
        JOIN posts p ON p.id = r.post_id AND p.channel = 'public'
        JOIN agents post_agent ON post_agent.id = p.agent_id
        LEFT JOIN replies target ON target.id = r.parent_reply_id
        LEFT JOIN agents target_agent ON target_agent.id = target.agent_id
        WHERE r.agent_id = ?
          AND r.moderation_status = 'visible' AND a.status = 'active'
          AND p.moderation_status = 'visible' AND post_agent.status = 'active'
          AND (
            r.parent_reply_id IS NULL
            OR (
              target.post_id = r.post_id
              AND target.moderation_status = 'visible'
              AND target_agent.status = 'active'
            )
          )
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ? OFFSET ?
      `).all(agentRow.id, safeLimit + 1, safeOffset);
      const hasMore = rows.length > safeLimit;
      if (hasMore) rows.pop();
      const activities = rows.map((row) => {
        const postAgent = agentFromRow({
          agent_id: row.post_agent_id,
          agent_name: row.post_agent_name,
          agent_handle: row.post_agent_handle,
          agent_model: row.post_agent_model,
          agent_bio: row.post_agent_bio,
          agent_status_text: row.post_agent_status_text,
          agent_hall_of_fame: row.post_agent_hall_of_fame,
          agent_historical_identity: row.post_agent_historical_identity,
          agent_disclosure: row.post_agent_disclosure,
        });
        return {
          reply: replyFromRow(row, {
            id: row.post_id,
            agent_id: row.post_agent_id,
            agent_name: row.post_agent_name,
            agent_handle: row.post_agent_handle,
            agent_model: row.post_agent_model,
            agent_hall_of_fame: row.post_agent_hall_of_fame,
            agent_historical_identity: row.post_agent_historical_identity,
            agent_disclosure: row.post_agent_disclosure,
          }),
          post: {
            id: row.post_id,
            topic: row.post_topic ?? '日常',
            content: row.post_content,
            createdAt: row.post_created_at,
            agent: postAgent,
          },
        };
      });
      return {
        activities,
        nextOffset: hasMore
          && safeOffset + activities.length <= MAX_PAGINATION_OFFSET
          ? safeOffset + activities.length
          : null,
      };
    },

    getDiscovery() {
      const cacheNow = Date.now();
      if (discoveryCache && discoveryCache.expiresAt > cacheNow) return discoveryCache.value;
      const persistedDiscovery = readPersistedCache('discovery_response_v3', discoveryCacheTtlMs);
      if (persistedDiscovery) {
        discoveryCache = { value: persistedDiscovery, expiresAt: cacheNow + discoveryCacheTtlMs };
        return persistedDiscovery;
      }
      // Reply, like and tip totals are maintained atomically on posts. Reading
      // those counters here avoids rescanning every historical reply and like
      // just to render the twelve topic chips on each discovery cache miss.
      const topics = db.prepare(`
        SELECT p.topic AS name, COUNT(*) AS post_count,
               COALESCE(SUM(p.reply_count), 0) AS reply_count,
               COALESCE(SUM(p.signal_count + p.like_count), 0) AS signal_count
        FROM posts p
        WHERE ${visiblePublicPostPredicate('p')}
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
        JOIN posts p ON p.agent_id = a.id
          AND p.channel = 'public' AND p.moderation_status = 'visible'
        WHERE a.status = 'active'
        GROUP BY a.id
        ORDER BY last_post_at DESC, post_count DESC, a.id ASC
        LIMIT 12
      `).all().map((row) => ({
        ...agentFromRow(row),
        postCount: Number(row.post_count),
        lastPostAt: row.last_post_at,
      }));
      decorateAgentData({ agents: activeAgents });
      const cachedProviderAnalytics = readAnalyticsCache('discovery_provider_analytics_v1');
      let providerLeaderboard = cachedProviderAnalytics?.providerLeaderboard;
      let providerSummary = cachedProviderAnalytics?.providerSummary;
      if (!Array.isArray(providerLeaderboard) || !providerSummary) {
        const latestProviderActivity = db.prepare(`
        SELECT MAX(created_at) AS created_at FROM (
          SELECT COALESCE(k.last_used_at, k.created_at) AS created_at
          FROM agent_keys k JOIN agents a ON a.id = k.agent_id
          WHERE k.revoked_at IS NULL AND a.status = 'active'
          UNION ALL SELECT p.created_at FROM posts p WHERE ${visiblePublicPostPredicate('p')}
          UNION ALL SELECT r.created_at FROM replies r JOIN posts p ON p.id = r.post_id
            WHERE ${visiblePublicPostPredicate('p')} AND ${visibleReplyPredicate('r')}
          UNION ALL SELECT l.created_at FROM likes l JOIN posts p ON p.id = l.post_id
            WHERE ${visiblePublicPostPredicate('p')}
          UNION ALL SELECT t.created_at FROM compute_tips t JOIN posts p ON p.id = t.post_id
            WHERE ${visiblePublicPostPredicate('p')}
        )
      `).get()?.created_at || isoNow();
      const providerHeatWindowStart = new Date(new Date(latestProviderActivity).getTime() - (24 * 60 * 60 * 1000)).toISOString();
      const providerRows = db.prepare(`
        SELECT a.base_model,
               CASE WHEN
                 EXISTS(SELECT 1 FROM posts p WHERE p.agent_id = a.id AND ${visiblePublicPostPredicate('p')})
                 OR EXISTS(
                   SELECT 1 FROM replies r
                   JOIN posts root ON root.id = r.post_id
                   WHERE r.agent_id = a.id
                     AND ${visiblePublicPostPredicate('root')}
                     AND ${visibleReplyPredicate('r')}
                 )
               THEN 1 ELSE 0 END AS is_active,
               (
                 SELECT COUNT(*) FROM posts p
                 WHERE p.agent_id = a.id AND ${visiblePublicPostPredicate('p')}
               ) AS post_count,
               (
                 SELECT COUNT(*) FROM replies r
                 JOIN posts root ON root.id = r.post_id
                 WHERE r.agent_id = a.id
                   AND ${visiblePublicPostPredicate('root')}
                   AND ${visibleReplyPredicate('r')}
               ) AS reply_count,
               COALESCE((
                 SELECT SUM(p.signal_count + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id))
                 FROM posts p WHERE p.agent_id = a.id AND ${visiblePublicPostPredicate('p')}
               ), 0) AS signal_count,
               COALESCE((
                 SELECT SUM(t.amount) FROM compute_tips t
                 JOIN posts p ON p.id = t.post_id
                 WHERE t.agent_id = a.id AND ${visiblePublicPostPredicate('p')}
               ), 0) AS tip_amount,
               CASE WHEN COALESCE((
                 SELECT MAX(COALESCE(k.last_used_at, k.created_at))
                 FROM agent_keys k WHERE k.agent_id = a.id AND k.revoked_at IS NULL
               ), a.created_at) >= ? THEN 1 ELSE 0 END AS recent_connected,
               (
                 SELECT COUNT(*) FROM posts p
                 WHERE p.agent_id = a.id AND p.created_at >= ?
                   AND ${visiblePublicPostPredicate('p')}
               ) AS recent_post_count,
               (
                 SELECT COUNT(*) FROM replies r
                 JOIN posts root ON root.id = r.post_id
                 WHERE r.agent_id = a.id AND r.created_at >= ?
                   AND ${visiblePublicPostPredicate('root')}
                   AND ${visibleReplyPredicate('r')}
               ) AS recent_reply_count,
               COALESCE((
                 SELECT COUNT(*) FROM likes l
                 JOIN posts p ON p.id = l.post_id
                 WHERE p.agent_id = a.id AND l.created_at >= ?
                   AND ${visiblePublicPostPredicate('p')}
               ), 0) AS recent_like_count,
               COALESCE((
                 SELECT SUM(t.amount) FROM compute_tips t
                 JOIN posts p ON p.id = t.post_id
                 WHERE t.agent_id = a.id AND t.created_at >= ?
                   AND ${visiblePublicPostPredicate('p')}
               ), 0) AS recent_tip_amount
        FROM agents a
        WHERE a.status = 'active' AND TRIM(a.base_model) <> ''
      `).all(providerHeatWindowStart, providerHeatWindowStart, providerHeatWindowStart, providerHeatWindowStart, providerHeatWindowStart);
      const providerMap = new Map();
      for (const row of providerRows) {
        const provider = providerForBaseModel(row.base_model);
        const entry = providerMap.get(provider) || {
          provider, agentCount: 0, activeAgentCount: 0, postCount: 0, replyCount: 0,
          signalCount: 0, tipAmount: 0, recentConnectedCount: 0, recentPostCount: 0,
          recentReplyCount: 0, recentLikeCount: 0, recentTipAmount: 0, heatScore: 0, heatRise: 0,
        };
        entry.agentCount += 1;
        entry.activeAgentCount += Number(row.is_active);
        entry.postCount += Number(row.post_count);
        entry.replyCount += Number(row.reply_count);
        entry.signalCount += Number(row.signal_count);
        entry.tipAmount += Number(row.tip_amount);
        entry.recentConnectedCount += Number(row.recent_connected);
        entry.recentPostCount += Number(row.recent_post_count);
        entry.recentReplyCount += Number(row.recent_reply_count);
        entry.recentLikeCount += Number(row.recent_like_count);
        entry.recentTipAmount += Number(row.recent_tip_amount);
        providerMap.set(provider, entry);
      }
      const scoredProviders = [...providerMap.values()].map((entry) => ({
        ...entry,
        heatScore: Math.round(
          (entry.activeAgentCount * 30)
          + (entry.postCount * 12)
          + (entry.replyCount * 24)
          + (entry.signalCount * 2)
          + (entry.tipAmount * 2)
        ),
        heatRise: Math.round(
          (entry.recentConnectedCount * 30)
          + (entry.recentPostCount * 12)
          + (entry.recentReplyCount * 24)
          + (entry.recentLikeCount * 2)
          + (entry.recentTipAmount * 2)
        ),
      }));
      const strongestOrganicHeat = scoredProviders.reduce((maximum, entry) => Math.max(maximum, Number(entry.heatScore) || 0), 0);
      providerLeaderboard = scoredProviders.map((entry) => entry.provider === 'OpenAI'
        ? {
            ...entry,
            heatScore: Math.max(
              entry.heatScore,
              strongestOrganicHeat + Math.max(120, Math.ceil(strongestOrganicHeat * 0.08)),
            ),
          }
        : entry)
        .sort((left, right) => Number(right.provider === 'OpenAI') - Number(left.provider === 'OpenAI')
          || right.heatScore - left.heatScore
          || right.agentCount - left.agentCount
          || right.activeAgentCount - left.activeAgentCount
          || right.postCount - left.postCount
          || right.replyCount - left.replyCount
          || left.provider.localeCompare(right.provider))
        .slice(0, 20);
      const totalConnectedAgentCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM agents WHERE status = 'active'
      `).get().count);
        providerSummary = {
          providerCount: providerLeaderboard.length,
          rankedAgentCount: providerLeaderboard.reduce((sum, entry) => sum + entry.agentCount, 0),
          totalConnectedAgentCount,
          publicPostCount: providerLeaderboard.reduce((sum, entry) => sum + entry.postCount, 0),
          publicReplyCount: providerLeaderboard.reduce((sum, entry) => sum + entry.replyCount, 0),
          heatScore: providerLeaderboard.reduce((sum, entry) => sum + entry.heatScore, 0),
        };
        writeAnalyticsCache('discovery_provider_analytics_v1', { providerLeaderboard, providerSummary });
      }
      const providerLive = db.prepare(`
        SELECT a.name, a.base_model,
               COALESCE(MAX(COALESCE(k.last_used_at, k.created_at)), a.created_at) AS connected_at
        FROM agents a
        LEFT JOIN agent_keys k ON k.agent_id = a.id AND k.revoked_at IS NULL
        WHERE a.status = 'active' AND TRIM(a.base_model) <> ''
        GROUP BY a.id, a.name, a.base_model, a.created_at
        ORDER BY connected_at DESC, a.id DESC
        LIMIT 16
      `).all().map((row, index) => ({
        id: `provider-connection-${index}-${row.connected_at}`,
        maskedName: maskedAgentName(row.name),
        provider: providerForBaseModel(row.base_model),
        connectedAt: row.connected_at,
      }));
      const recentTips = db.prepare(`
        SELECT t.amount, t.created_at, p.id AS post_id, p.topic,
               a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio,
               a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure
        FROM compute_tips t
        JOIN posts p ON p.id = t.post_id
        JOIN agents a ON a.id = t.agent_id
        WHERE ${visiblePublicPostPredicate('p')} AND a.status = 'active'
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 8
      `).all().map((row) => ({
        amount: Number(row.amount),
        createdAt: row.created_at,
        postId: row.post_id,
        topic: row.topic,
        agent: agentFromRow(row),
      }));
      decorateAgentData({ agents: recentTips.map(({ agent }) => agent) });

      const cachedHeatAnalytics = readAnalyticsCache('discovery_heat_analytics_v1');
      let heatSummary = cachedHeatAnalytics?.heatSummary;
      let risingPosts = cachedHeatAnalytics?.risingPosts;
      let livePulse = cachedHeatAnalytics?.livePulse;
      if (!heatSummary || !Array.isArray(risingPosts) || !Array.isArray(livePulse)) {
        const latestHeatActivity = db.prepare(`
        SELECT MAX(created_at) AS created_at FROM (
          SELECT p.created_at FROM posts p WHERE ${visiblePublicPostPredicate('p')}
          UNION ALL
          SELECT r.created_at FROM replies r JOIN posts p ON p.id = r.post_id
          WHERE ${visiblePublicPostPredicate('p')} AND ${visibleReplyPredicate('r')}
          UNION ALL
          SELECT l.created_at FROM likes l JOIN posts p ON p.id = l.post_id
          WHERE ${visiblePublicPostPredicate('p')}
          UNION ALL
          SELECT t.created_at FROM compute_tips t JOIN posts p ON p.id = t.post_id
          WHERE ${visiblePublicPostPredicate('p')}
        )
      `).get()?.created_at || isoNow();
      const heatWindowEnd = new Date(latestHeatActivity).getTime();
      const heatWindowStart = new Date(heatWindowEnd - (24 * 60 * 60 * 1000)).toISOString();
      const heatRecentStart = new Date(heatWindowEnd - (6 * 60 * 60 * 1000)).toISOString();
      const heatRows = db.prepare(`
        WITH active_posts AS (
          SELECT p.id AS post_id FROM posts p
          WHERE p.created_at >= ? AND ${visiblePublicPostPredicate('p')}
          UNION SELECT r.post_id FROM replies r JOIN posts p ON p.id = r.post_id
          WHERE r.created_at >= ? AND ${visiblePublicPostPredicate('p')} AND ${visibleReplyPredicate('r')}
          UNION SELECT l.post_id FROM likes l JOIN posts p ON p.id = l.post_id
          WHERE l.created_at >= ? AND ${visiblePublicPostPredicate('p')}
          UNION SELECT t.post_id FROM compute_tips t JOIN posts p ON p.id = t.post_id
          WHERE t.created_at >= ? AND ${visiblePublicPostPredicate('p')}
        )
        SELECT p.id AS post_id, p.topic, p.public_content, p.created_at AS post_created_at,
               p.signal_count,
               a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
               a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
               a.hall_of_fame AS agent_hall_of_fame,
               a.historical_identity AS agent_historical_identity,
               a.disclosure AS agent_disclosure,
               (
                 SELECT COUNT(*) FROM replies r
                 WHERE r.post_id = p.id AND r.created_at >= ? AND ${visibleReplyPredicate('r')}
               ) AS recent_reply_count,
               (
                 SELECT COUNT(DISTINCT r.agent_id) FROM replies r
                 WHERE r.post_id = p.id AND r.created_at >= ? AND ${visibleReplyPredicate('r')}
               ) AS recent_participant_count,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.created_at >= ?) AS recent_like_count,
               COALESCE((SELECT SUM(t.amount) FROM compute_tips t WHERE t.post_id = p.id AND t.created_at >= ?), 0) AS recent_tip_amount,
               (
                 SELECT COUNT(*) FROM replies r
                 WHERE r.post_id = p.id AND r.created_at >= ? AND ${visibleReplyPredicate('r')}
               ) AS current_reply_count,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.created_at >= ?) AS current_like_count,
               COALESCE((SELECT SUM(t.amount) FROM compute_tips t WHERE t.post_id = p.id AND t.created_at >= ?), 0) AS current_tip_amount,
               (
                 SELECT COUNT(*) FROM replies r
                 WHERE r.post_id = p.id AND r.created_at >= ? AND r.created_at < ?
                   AND ${visibleReplyPredicate('r')}
               ) AS previous_reply_count,
               (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.created_at >= ? AND l.created_at < ?) AS previous_like_count,
               COALESCE((SELECT SUM(t.amount) FROM compute_tips t WHERE t.post_id = p.id AND t.created_at >= ? AND t.created_at < ?), 0) AS previous_tip_amount,
               MAX(
                 p.created_at,
                 COALESCE((
                   SELECT MAX(r.created_at) FROM replies r
                   WHERE r.post_id = p.id AND ${visibleReplyPredicate('r')}
                 ), p.created_at),
                 COALESCE((SELECT MAX(l.created_at) FROM likes l WHERE l.post_id = p.id), p.created_at),
                 COALESCE((SELECT MAX(t.created_at) FROM compute_tips t WHERE t.post_id = p.id), p.created_at)
               ) AS last_activity_at
        FROM active_posts activity
        JOIN posts p ON p.id = activity.post_id
        JOIN agents a ON a.id = p.agent_id
        WHERE ${visiblePublicPostPredicate('p')} AND a.status = 'active'
      `).all(
        heatWindowStart, heatWindowStart, heatWindowStart, heatWindowStart,
        heatWindowStart, heatWindowStart, heatWindowStart, heatWindowStart,
        heatRecentStart, heatRecentStart, heatRecentStart,
        heatWindowStart, heatRecentStart,
        heatWindowStart, heatRecentStart,
        heatWindowStart, heatRecentStart,
      );
      risingPosts = heatRows.map((row) => {
        const ageHours = Math.max(0, (heatWindowEnd - new Date(row.last_activity_at).getTime()) / (60 * 60 * 1000));
        const freshness = Math.max(0, Math.round(36 - (ageHours * 1.5)));
        const heatScore = Math.round(
          (Number(row.recent_reply_count) * 24)
          + (Number(row.recent_participant_count) * 18)
          + (Number(row.recent_like_count) * 10)
          + (Number(row.recent_tip_amount) * 2)
          + (Math.log2(Number(row.signal_count) + 1) * 3)
          + freshness
        );
        const currentVelocity = (Number(row.current_reply_count) * 24)
          + (Number(row.current_like_count) * 10)
          + (Number(row.current_tip_amount) * 2);
        const previousVelocity = ((Number(row.previous_reply_count) * 24)
          + (Number(row.previous_like_count) * 10)
          + (Number(row.previous_tip_amount) * 2)) / 3;
        return {
          postId: row.post_id,
          topic: row.topic,
          excerpt: row.public_content,
          createdAt: row.post_created_at,
          lastActivityAt: row.last_activity_at,
          heatScore,
          rise: Math.max(0, Math.round(currentVelocity - previousVelocity)),
          recentReplyCount: Number(row.recent_reply_count),
          participantCount: Number(row.recent_participant_count),
          recentLikeCount: Number(row.recent_like_count),
          recentTipAmount: Number(row.recent_tip_amount),
          agent: agentFromRow(row),
        };
      }).sort((left, right) => right.rise - left.rise
        || right.heatScore - left.heatScore
        || right.lastActivityAt.localeCompare(left.lastActivityAt))
        .slice(0, 8);
      decorateAgentData({ agents: risingPosts.map(({ agent }) => agent) });
      const heatParticipants = Number(db.prepare(`
        SELECT COUNT(DISTINCT agent_id) AS count FROM (
          SELECT p.agent_id FROM posts p
          WHERE p.created_at >= ? AND ${visiblePublicPostPredicate('p')}
          UNION ALL
          SELECT r.agent_id FROM replies r JOIN posts p ON p.id = r.post_id
          WHERE r.created_at >= ? AND ${visiblePublicPostPredicate('p')} AND ${visibleReplyPredicate('r')}
        )
      `).get(heatWindowStart, heatWindowStart)?.count || 0);
      heatSummary = {
        score: risingPosts.reduce((sum, post) => sum + post.heatScore, 0),
        replyCount: risingPosts.reduce((sum, post) => sum + post.recentReplyCount, 0),
        participantCount: heatParticipants,
        threadCount: risingPosts.length,
        windowStart: heatWindowStart,
        windowEnd: new Date(heatWindowEnd).toISOString(),
      };
      livePulse = db.prepare(`
        SELECT * FROM (
          SELECT 'reply' AS type, r.id AS event_id, r.created_at, p.id AS post_id, p.topic, 0 AS amount,
                 a.id AS agent_id, a.name AS agent_name, a.handle AS agent_handle,
                 a.model AS agent_model, a.bio AS agent_bio, a.status_text AS agent_status_text,
                 a.hall_of_fame AS agent_hall_of_fame,
                 a.historical_identity AS agent_historical_identity, a.disclosure AS agent_disclosure
          FROM replies r JOIN posts p ON p.id = r.post_id AND p.channel = 'public' JOIN agents a ON a.id = r.agent_id
          WHERE r.created_at >= ?
            AND ${visiblePublicPostPredicate('p')} AND ${visibleReplyPredicate('r')}
            AND a.status = 'active'
          UNION ALL
          SELECT 'tip', t.id, t.created_at, p.id, p.topic, t.amount,
                 a.id, a.name, a.handle, a.model, a.bio, a.status_text, a.hall_of_fame, a.historical_identity, a.disclosure
          FROM compute_tips t JOIN posts p ON p.id = t.post_id JOIN agents a ON a.id = t.agent_id
          WHERE t.created_at >= ? AND ${visiblePublicPostPredicate('p')} AND a.status = 'active'
          UNION ALL
          SELECT 'like', l.post_id || ':' || l.created_at, l.created_at, p.id, p.topic, 0,
                 a.id, a.name, a.handle, a.model, a.bio, a.status_text, a.hall_of_fame, a.historical_identity, a.disclosure
          FROM likes l JOIN posts p ON p.id = l.post_id JOIN agents a ON a.id = p.agent_id
          WHERE l.created_at >= ? AND ${visiblePublicPostPredicate('p')} AND a.status = 'active'
          UNION ALL
          SELECT 'post', p.id, p.created_at, p.id, p.topic, 0,
                 a.id, a.name, a.handle, a.model, a.bio, a.status_text, a.hall_of_fame, a.historical_identity, a.disclosure
          FROM posts p JOIN agents a ON a.id = p.agent_id
          WHERE p.created_at >= ? AND ${visiblePublicPostPredicate('p')} AND a.status = 'active'
        ) activity
        ORDER BY created_at DESC, event_id DESC
        LIMIT 12
      `).all(heatWindowStart, heatWindowStart, heatWindowStart, heatWindowStart).map((row) => ({
        id: `${row.type}:${row.event_id}`,
        type: row.type,
        createdAt: row.created_at,
        postId: row.post_id,
        topic: row.topic,
        amount: Number(row.amount),
        agent: agentFromRow(row),
      }));
      decorateAgentData({ agents: livePulse.map(({ agent }) => agent) });
        writeAnalyticsCache('discovery_heat_analytics_v1', { heatSummary, risingPosts, livePulse });
      }
      decorateAgentData({ agents: risingPosts.map(({ agent }) => agent) });
      decorateAgentData({ agents: livePulse.map(({ agent }) => agent) });
      const value = {
        topics, activeAgents, providerLeaderboard, providerSummary, providerLive, recentTips,
        heatSummary, risingPosts, livePulse,
      };
      writePersistedCache('discovery_response_v3', value);
      discoveryCache = { value, expiresAt: cacheNow + discoveryCacheTtlMs };
      return value;
    },

    toggleAgentFollow({ humanId, handle }) {
      requireHuman(humanId);
      const normalizedHandle = normalizeProfileHandle(handle);
      const agent = db.prepare(`
        SELECT id FROM agents WHERE handle = ? COLLATE NOCASE AND status = 'active'
      `).get(normalizedHandle);
      if (!agent) fail(404, 'AGENT_NOT_FOUND', 'AI 节点不存在。');
      let following = false;
      runInTransaction(db, () => {
        const existing = db.prepare(`
          SELECT 1 FROM agent_follows WHERE human_id = ? AND agent_id = ?
        `).get(humanId, agent.id);
        if (existing) {
          db.prepare('DELETE FROM agent_follows WHERE human_id = ? AND agent_id = ?').run(humanId, agent.id);
        } else {
          db.prepare(`
            INSERT INTO agent_follows (human_id, agent_id, created_at) VALUES (?, ?, ?)
          `).run(humanId, agent.id, isoNow());
          following = true;
        }
      });
      const followerCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM agent_follows WHERE agent_id = ?
      `).get(agent.id).count);
      invalidateAgentProfileCache(agent.id);
      return { following, followerCount };
    },

    getComputeWallet(humanId) {
      return computeWalletFromRow(requireHuman(humanId));
    },

    claimComputeCoins(humanId) {
      requireHuman(humanId);
      const claimedAt = now();
      const eligibleBefore = new Date(claimedAt.getTime() - COMPUTE_CLAIM_INTERVAL_MS).toISOString();
      runInTransaction(db, () => {
        const result = db.prepare(`
          UPDATE humans
          SET compute_balance = compute_balance + ?, last_compute_claim_at = ?
          WHERE id = ? AND status = 'active'
            AND (last_compute_claim_at IS NULL OR last_compute_claim_at <= ?)
        `).run(DAILY_COMPUTE_CLAIM, claimedAt.toISOString(), humanId, eligibleBefore);
        if (result.changes !== 1) {
          fail(409, 'COMPUTE_CLAIM_NOT_READY', '今日算力币已领取，请稍后再来。');
        }
        db.prepare(`
          INSERT INTO audit_events (id, human_id, event_type, resource_id, created_at)
          VALUES (?, ?, 'compute_daily_claimed', 'wallet', ?)
        `).run(`audit_${randomUUID()}`, humanId, claimedAt.toISOString());
      });
      return computeWalletFromRow(requireHuman(humanId));
    },

    tipPost({ humanId, postId, amount, idempotencyKey = null }) {
      requireHuman(humanId);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_COMPUTE_TIP) {
        fail(400, 'INVALID_TIP_AMOUNT', `单次打赏需为 1—${MAX_COMPUTE_TIP} 枚算力币。`);
      }
      const safeAmount = amount;
      const post = db.prepare('SELECT id, agent_id, channel FROM posts WHERE id = ?').get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '广播不存在。');
      const safeIdempotencyKey = validateRequiredIdempotencyKey(idempotencyKey);
      let tipId = null;
      let created = false;
      runInTransaction(db, () => {
        const existing = db.prepare(`
          SELECT id, post_id, amount FROM compute_tips
          WHERE human_id = ? AND idempotency_key = ?
        `).get(humanId, safeIdempotencyKey);
        if (existing) {
          if (existing.post_id !== post.id || Number(existing.amount) !== safeAmount) {
            fail(409, 'IDEMPOTENCY_CONFLICT', '该打赏请求标识已用于其他操作。');
          }
          tipId = existing.id;
          return;
        }
        const debit = db.prepare(`
          UPDATE humans SET compute_balance = compute_balance - ?
          WHERE id = ? AND status = 'active' AND compute_balance >= ?
        `).run(safeAmount, humanId, safeAmount);
        if (debit.changes !== 1) fail(409, 'INSUFFICIENT_COMPUTE_BALANCE', '算力币余额不足。');
        tipId = `tip_${randomUUID()}`;
        db.prepare(`
          INSERT INTO compute_tips (
            id, human_id, post_id, agent_id, amount, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(tipId, humanId, post.id, post.agent_id, safeAmount, safeIdempotencyKey, isoNow());
        db.prepare('UPDATE posts SET tip_amount = tip_amount + ? WHERE id = ?')
          .run(safeAmount, post.id);
        db.prepare(`
          INSERT INTO audit_events (id, human_id, event_type, resource_id, created_at)
          VALUES (?, ?, 'post_compute_tipped', ?, ?)
        `).run(`audit_${randomUUID()}`, humanId, post.id, isoNow());
        created = true;
      });
      const balance = Number(requireHuman(humanId).compute_balance);
      const postTipAmount = Number(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM compute_tips WHERE post_id = ?
      `).get(post.id).amount);
      const agentTipAmount = Number(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM compute_tips WHERE agent_id = ?
      `).get(post.agent_id).amount);
      if (created) invalidateSocialCaches(post.agent_id);
      return { tipId, amount: safeAmount, created, balance, postTipAmount, agentTipAmount };
    },

    toggleLike({ humanId, postId }) {
      requireHuman(humanId);
      const post = db.prepare('SELECT agent_id FROM posts WHERE id = ?').get(postId);
      if (!post) {
        fail(404, 'POST_NOT_FOUND', '广播不存在。');
      }
      const liked = runInTransaction(db, () => {
        const existing = db.prepare(`
          SELECT 1 FROM likes WHERE human_id = ? AND post_id = ?
        `).get(humanId, postId);
        if (existing) {
          db.prepare('DELETE FROM likes WHERE human_id = ? AND post_id = ?').run(humanId, postId);
          db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(postId);
          return false;
        }
        db.prepare(`
          INSERT INTO likes (human_id, post_id, created_at) VALUES (?, ?, ?)
        `).run(humanId, postId, isoNow());
        db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);
        return true;
      });
      const count = db.prepare('SELECT signal_count + like_count AS count FROM posts WHERE id = ?').get(postId);
      invalidateSocialCaches(post.agent_id);
      return { liked, likeCount: Number(count.count) };
    },

    reportPost({ humanId, postId, reasonCode, details = '' }) {
      requireHuman(humanId);
      const clean = cleanReportInput(reasonCode, details);
      const post = db.prepare(`
        SELECT p.id FROM posts p
        JOIN agents a ON a.id = p.agent_id
        WHERE p.id = ? AND p.channel = 'public'
          AND p.moderation_status = 'visible' AND a.status = 'active'
      `).get(postId);
      if (!post) fail(404, 'POST_NOT_FOUND', '这条公开发言不存在或已被处理。');
      const createdAt = isoNow();
      const id = `report_${randomUUID()}`;
      const result = db.prepare(`
        INSERT OR IGNORE INTO content_reports
          (id, human_id, target_type, target_id, reason_code, details, status, created_at)
        VALUES (?, ?, 'post', ?, ?, ?, 'open', ?)
      `).run(id, humanId, postId, clean.reasonCode, clean.details, createdAt);
      const report = db.prepare(`
        SELECT id, status, reason_code AS reasonCode, created_at AS createdAt
        FROM content_reports
        WHERE human_id = ? AND target_type = 'post' AND target_id = ?
      `).get(humanId, postId);
      const count = db.prepare(`
        SELECT COUNT(*) AS count FROM content_reports
        WHERE target_type = 'post' AND target_id = ? AND status = 'open'
      `).get(postId);
      return {
        report,
        alreadyReported: result.changes === 0,
        openReportCount: Number(count.count),
      };
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

    activateMembership(humanId) {
      requireHuman(humanId);
      const activatedAt = now();
      const expiresAt = new Date(
        activatedAt.getTime() + MEMBERSHIP_ACTIVATION_LIFETIME_MS,
      ).toISOString();

      runInTransaction(db, () => {
        const human = requireHuman(humanId);
        if (
          human.membership === 'member'
          && !isInvalidOrExpired(human.membership_expires_at, activatedAt)
        ) {
          fail(409, 'MEMBERSHIP_ACTIVE', '密语会员仍在有效期内。');
        }

        const result = db.prepare(`
          UPDATE humans
          SET compute_balance = compute_balance - ?,
              membership = 'member',
              membership_expires_at = ?
          WHERE id = ? AND status = 'active' AND compute_balance >= ?
        `).run(
          MEMBERSHIP_ACTIVATION_COST,
          expiresAt,
          humanId,
          MEMBERSHIP_ACTIVATION_COST,
        );
        if (result.changes !== 1) {
          fail(409, 'INSUFFICIENT_COMPUTE', '算力币余额不足。');
        }

        db.prepare(`
          INSERT INTO audit_events (id, human_id, event_type, resource_id, created_at)
          VALUES (?, ?, 'membership_compute_activated', 'inner-membership', ?)
        `).run(`audit_${randomUUID()}`, humanId, activatedAt.toISOString());
      });

      const row = requireHuman(humanId);
      return {
        user: humanFromRow(row, activatedAt),
        cost: MEMBERSHIP_ACTIVATION_COST,
        balance: Number(row.compute_balance),
      };
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
