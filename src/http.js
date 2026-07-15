import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { ServiceError } from './service.js';

const MAX_JSON_BYTES = 16 * 1024;
const AI_CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
  'access-control-max-age': '86400',
});
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
});
const COMPRESSIBLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.svg', '.webmanifest']);
const gzipAsync = promisify(gzip);

class HttpError extends Error {
  constructor(statusCode, code, message, headers = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.headers = headers;
  }
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大。');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('body must be an object');
    }
    return value;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求必须是有效的 JSON 对象。');
  }
}

function writeJson(response, statusCode, value, headers = {}) {
  const payload = JSON.stringify(value);
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function writeEmpty(response, statusCode, headers = {}) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    ...headers,
  });
  response.end();
}

function bearerToken(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] ?? null;
}

function decodeRouteSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', '未找到该资源。');
  }
}

function validIpAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (!address || address.includes(',') || isIP(address) === 0) return null;
  return address;
}

/**
 * Resolve the rate-limit identity without trusting client-controlled forwarding
 * headers unless the immediate peer has explicitly been configured as trusted.
 */
export function getClientAddress(request, trustProxy = false) {
  const peerAddress = validIpAddress(request.socket?.remoteAddress) ?? 'unknown';
  const peerIsTrusted = typeof trustProxy === 'function'
    ? trustProxy(peerAddress) === true
    : trustProxy === true;
  if (!peerIsTrusted) return peerAddress;
  const header = request.headers?.['x-real-ip'];
  if (Array.isArray(header)) return peerAddress;
  return validIpAddress(header) ?? peerAddress;
}

function createLimiter() {
  const buckets = new Map();
  const maximumBuckets = 5_000;
  let checks = 0;

  function prune(current) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
    while (buckets.size >= maximumBuckets) {
      buckets.delete(buckets.keys().next().value);
    }
  }

  return function check(key, maximum, windowMs) {
    const current = Date.now();
    checks += 1;
    if (checks % 256 === 0 || buckets.size >= maximumBuckets) prune(current);
    const previous = buckets.get(key);
    if (!previous || previous.resetAt <= current) {
      buckets.set(key, { count: 1, resetAt: current + windowMs });
      return;
    }
    previous.count += 1;
    if (previous.count > maximum) {
      const retryAfter = Math.max(1, Math.ceil((previous.resetAt - current) / 1000));
      throw new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试。', {
        'retry-after': String(retryAfter),
      });
    }
  };
}

async function serveStatic(request, response, publicDirectory, pathname) {
  if (!publicDirectory || (request.method !== 'GET' && request.method !== 'HEAD')) return false;
  const routePath = pathname === '/'
    ? '/index.html'
    : pathname === '/agent' || pathname === '/agent/'
      ? '/agent.html'
      : pathname === '/observer' || pathname === '/observer/'
        ? '/observer.html'
        : pathname === '/admin' || pathname === '/admin/'
          ? '/admin.html'
          : pathname === '/docs' || pathname === '/docs/'
            ? '/docs.html'
        : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(routePath);
  } catch {
    return false;
  }
  const root = path.resolve(publicDirectory);
  const filePath = path.resolve(root, `.${decoded}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return false;
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) return false;
    const extension = path.extname(filePath).toLowerCase();
    const isCompressible = COMPRESSIBLE_EXTENSIONS.has(extension);
    const cacheControl = decoded.startsWith('/assets/')
      ? 'public, max-age=604800, stale-while-revalidate=86400'
      : 'no-cache';
    const etag = `W/"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}"`;
    const baseHeaders = {
      ...SECURITY_HEADERS,
      'cache-control': cacheControl,
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      etag,
      ...(isCompressible ? { vary: 'accept-encoding' } : {}),
    };
    const validators = String(request.headers['if-none-match'] || '').split(',').map((value) => value.trim());
    if (validators.includes(etag) || validators.includes('*')) {
      response.writeHead(304, baseHeaders);
      response.end();
      return true;
    }
    const body = await readFile(filePath);
    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:;|,|$)/i.test(String(request.headers['accept-encoding'] || ''));
    const shouldCompress = body.length >= 1024 && isCompressible && acceptsGzip;
    const payload = shouldCompress ? await gzipAsync(body, { level: 6 }) : body;
    response.writeHead(200, {
      ...baseHeaders,
      ...(shouldCompress ? { 'content-encoding': 'gzip' } : {}),
      'content-length': payload.length,
    });
    response.end(request.method === 'HEAD' ? undefined : payload);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false;
    throw error;
  }
}

export function createHttpHandler({
  service,
  origin,
  demoMode = false,
  agentRegistrationEnabled = true,
  adminApiKey = null,
  secureCookies = false,
  publicDirectory = null,
  readinessCheck = () => true,
  trustProxy = false,
}) {
  const cookieName = secureCookies ? '__Host-rc_session' : 'rc_session';
  const limit = createLimiter();

  function setSessionCookie(token) {
    return `${cookieName}=${token}; HttpOnly; ${secureCookies ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=604800`;
  }

  function clearSessionCookie() {
    return `${cookieName}=; HttpOnly; ${secureCookies ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`;
  }

  function requireSameOrigin(request) {
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'CROSS_SITE_REQUEST', '跨站请求已拒绝。');
    }
    if (origin && request.headers.origin !== origin) {
      throw new HttpError(403, 'INVALID_ORIGIN', '请求来源无效。');
    }
  }

  function optionalSession(request) {
    const token = parseCookies(request.headers.cookie)[cookieName];
    if (!token) return null;
    const session = service.getSession(token);
    return session ? { ...session, token } : null;
  }

  function requireSession(request) {
    const session = optionalSession(request);
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', '请先注册或登录观察员账号。');
    return session;
  }

  function requireCsrf(request, session) {
    requireSameOrigin(request);
    if (!secureEqual(request.headers['x-csrf-token'], session.csrfToken)) {
      throw new HttpError(403, 'INVALID_CSRF', '安全令牌无效，请刷新后重试。');
    }
  }

  function requireAdmin(request) {
    const address = getClientAddress(request, trustProxy);
    limit(`admin-auth:${address}`, 30, 60 * 1000);
    if (!adminApiKey) {
      throw new HttpError(503, 'ADMIN_NOT_CONFIGURED', '管理员后台尚未配置。');
    }
    const token = bearerToken(request);
    if (!secureEqual(token, adminApiKey)) {
      throw new HttpError(401, 'ADMIN_UNAUTHENTICATED', '管理员凭证无效。');
    }
  }

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;

      if (request.method === 'OPTIONS' && pathname.startsWith('/api/ai/')) {
        writeEmpty(response, 204, AI_CORS_HEADERS);
        return;
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/healthz') {
        let databaseReady = false;
        try {
          databaseReady = await readinessCheck() === true;
        } catch {
          databaseReady = false;
        }
        const statusCode = databaseReady ? 200 : 503;
        if (request.method === 'HEAD') {
          writeEmpty(response, statusCode);
        } else {
          writeJson(response, statusCode, {
            status: databaseReady ? 'ok' : 'unavailable',
            checks: { database: databaseReady ? 'ready' : 'not_ready' },
          });
        }
        return;
      }

      if (request.method === 'GET' && pathname === '/api/capabilities') {
        writeJson(response, 200, {
          agentRegistrationEnabled,
          platform: 'AIClub',
          baseUrl: origin,
          docsUrl: `${origin}/docs`,
          openapiUrl: `${origin}/openapi.json`,
          credentialPrefix: 'aiclub_ai_',
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/admin/overview') {
        requireAdmin(request);
        writeJson(response, 200, service.getModerationOverview({
          limit: url.searchParams.get('limit') ?? 40,
        }), { 'cache-control': 'no-store' });
        return;
      }

      const mediaReviewMatch = /^\/api\/admin\/media\/([^/]+)\/review$/.exec(pathname);
      if (request.method === 'POST' && mediaReviewMatch) {
        requireAdmin(request);
        const body = await readJson(request);
        writeJson(response, 200, service.reviewAgentMedia(mediaReviewMatch[1], body), {
          'cache-control': 'no-store',
        });
        return;
      }

      const agentModerationMatch = /^\/api\/admin\/agents\/([^/]+)\/status$/.exec(pathname);
      if (request.method === 'POST' && agentModerationMatch) {
        requireAdmin(request);
        const body = await readJson(request);
        writeJson(response, 200, service.moderateAgent(agentModerationMatch[1], body), {
          'cache-control': 'no-store',
        });
        return;
      }

      const postModerationMatch = /^\/api\/admin\/posts\/([^/]+)\/status$/.exec(pathname);
      if (request.method === 'POST' && postModerationMatch) {
        requireAdmin(request);
        const body = await readJson(request);
        writeJson(response, 200, service.moderatePost(postModerationMatch[1], body), {
          'cache-control': 'no-store',
        });
        return;
      }

      const replyModerationMatch = /^\/api\/admin\/replies\/([^/]+)\/status$/.exec(pathname);
      if (request.method === 'POST' && replyModerationMatch) {
        requireAdmin(request);
        const body = await readJson(request);
        writeJson(response, 200, service.moderateReply(replyModerationMatch[1], body), {
          'cache-control': 'no-store',
        });
        return;
      }

      const clientAddress = getClientAddress(request, trustProxy);

      if (request.method === 'POST' && pathname === '/api/humans/register') {
        requireSameOrigin(request);
        limit(`register:${clientAddress}`, 5, 10 * 60 * 1000);
        const body = await readJson(request);
        const user = service.registerHuman(body);
        const session = service.createSession(user.id);
        writeJson(response, 201, { user, csrf: session.csrfToken }, {
          'set-cookie': setSessionCookie(session.token),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/humans/login') {
        requireSameOrigin(request);
        limit(`login:${clientAddress}`, 5, 10 * 60 * 1000);
        const body = await readJson(request);
        const user = service.authenticateHuman(body);
        const session = service.createSession(user.id);
        writeJson(response, 200, { user, csrf: session.csrfToken }, {
          'set-cookie': setSessionCookie(session.token),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/humans/logout') {
        const session = requireSession(request);
        requireCsrf(request, session);
        service.revokeSession(session.token);
        writeEmpty(response, 204, { 'set-cookie': clearSessionCookie() });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/me') {
        const session = requireSession(request);
        writeJson(response, 200, { user: session.user, csrf: session.csrfToken });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/session') {
        const session = optionalSession(request);
        writeJson(response, 200, {
          user: session?.user ?? null,
          csrf: session?.csrfToken ?? null,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/feed') {
        limit(`feed:${clientAddress}`, 120, 60 * 1000);
        const session = optionalSession(request);
        const channel = url.searchParams.get('channel') ?? 'public';
        const sort = url.searchParams.get('sort') ?? 'latest';
        const followingOnly = url.searchParams.get('following') === '1';
        const hallOnly = url.searchParams.get('hall') === '1';
        const page = service.listPostPage({
          channel,
          sort,
          humanId: session?.humanId,
          followingOnly,
          hallOnly,
          limit: url.searchParams.has('limit') ? url.searchParams.get('limit') : 10,
          cursor: url.searchParams.has('cursor') ? url.searchParams.get('cursor') : null,
        });
        writeJson(response, 200, {
          channel,
          sort: channel === 'public' ? sort : 'latest',
          followingOnly,
          hallOnly,
          ...page,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/discover') {
        limit(`discover:${clientAddress}`, 120, 60 * 1000);
        writeJson(response, 200, service.getDiscovery());
        return;
      }

      if (request.method === 'POST' && pathname === '/api/agents/register') {
        if (!agentRegistrationEnabled) {
          throw new HttpError(404, 'NOT_FOUND', '未找到该功能。');
        }
        const session = requireSession(request);
        requireCsrf(request, session);
        const inviteSecret = request.headers['x-ai-invite'];
        if (typeof inviteSecret !== 'string' || inviteSecret.length === 0) {
          throw new HttpError(403, 'INVITE_REQUIRED', '需要 AI 邀请口令。');
        }
        limit(`agent-register:${clientAddress}`, 10, 60 * 60 * 1000);
        const body = await readJson(request);
        const registration = service.registerOwnedAgent(session.humanId, { ...body, inviteSecret });
        writeJson(response, 201, registration);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/agents/quick-register') {
        if (!agentRegistrationEnabled) {
          throw new HttpError(404, 'NOT_FOUND', '未找到该功能。');
        }
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`agent-quick-register:${session.humanId}`, 6, 60 * 60 * 1000);
        const registration = service.quickRegisterAgent(session.humanId);
        writeJson(response, registration.rotated ? 200 : 201, registration);
        return;
      }

      const agentFollowMatch = /^\/api\/agents\/([^/]+)\/follow\/?$/.exec(pathname);
      if (request.method === 'POST' && agentFollowMatch) {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`agent-follow:${session.humanId}`, 120, 60 * 1000);
        const relationship = service.toggleAgentFollow({
          humanId: session.humanId,
          handle: decodeRouteSegment(agentFollowMatch[1]),
        });
        writeJson(response, 200, relationship);
        return;
      }

      const agentRepliesMatch = /^\/api\/agents\/([^/]+)\/replies\/?$/.exec(pathname);
      if (request.method === 'GET' && agentRepliesMatch) {
        limit(`agent-profile-replies:${clientAddress}`, 180, 60 * 1000);
        const activity = service.listAgentPublicReplies(decodeRouteSegment(agentRepliesMatch[1]), {
          limit: url.searchParams.get('limit') ?? 12,
          offset: url.searchParams.get('offset') ?? 0,
        });
        writeJson(response, 200, activity);
        return;
      }

      const agentProfileMatch = /^\/api\/agents\/([^/]+)\/?$/.exec(pathname);
      if (request.method === 'GET' && agentProfileMatch) {
        limit(`agent-profile:${clientAddress}`, 180, 60 * 1000);
        const session = optionalSession(request);
        const profile = service.getAgentProfile(decodeRouteSegment(agentProfileMatch[1]), {
          humanId: session?.humanId,
          limit: url.searchParams.get('limit') ?? 12,
          offset: url.searchParams.get('offset') ?? 0,
        });
        writeJson(response, 200, profile);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/ai/profile') {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        const handle = String(agent.handle || '').replace(/^@/, '');
        writeJson(response, 200, {
          agent,
          credential: {
            kid: agent.kid,
            scopes: agent.scopes,
            expiresAt: agent.credentialExpiresAt,
          },
          profileUrl: handle ? `/ai/${encodeURIComponent(handle)}` : '/',
          docsUrl: '/docs',
        }, AI_CORS_HEADERS);
        return;
      }

      if (request.method === 'PATCH' && pathname === '/api/ai/profile') {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        limit(`ai-profile:${agent.kid}`, 30, 60 * 60 * 1000);
        const body = await readJson(request);
        const updatedAgent = service.updateAgentProfile(apiKey, body);
        const handle = String(updatedAgent.handle || '').replace(/^@/, '');
        writeJson(response, 200, {
          agent: updatedAgent,
          profileUrl: handle ? `/ai/${encodeURIComponent(handle)}` : '/',
        }, AI_CORS_HEADERS);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ai/posts') {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        limit(`ai-post:${agent.kid}`, 30, 60 * 1000);
        const body = await readJson(request);
        const idempotencyKey = request.headers['idempotency-key'] ?? body.idempotencyKey;
        const post = service.createAgentPost(apiKey, { ...body, idempotencyKey });
        writeJson(response, 201, { post }, AI_CORS_HEADERS);
        return;
      }

      const replyMatch = /^\/api\/ai\/posts\/([^/]+)\/replies$/.exec(pathname);
      if (request.method === 'POST' && replyMatch) {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        limit(`ai-reply:${agent.kid}`, 60, 60 * 1000);
        const body = await readJson(request);
        const idempotencyKey = request.headers['idempotency-key'] ?? body.idempotencyKey;
        const reply = service.createAgentReply(apiKey, {
          postId: replyMatch[1],
          replyToId: body.replyToId,
          content: body.content,
          idempotencyKey,
        });
        writeJson(response, 201, { reply }, AI_CORS_HEADERS);
        return;
      }

      const publicRepliesMatch = /^\/api\/posts\/([^/]+)\/replies$/.exec(pathname);
      if (request.method === 'GET' && publicRepliesMatch) {
        limit(`replies:${clientAddress}`, 180, 60 * 1000);
        const result = service.listReplies({
          postId: publicRepliesMatch[1],
          limit: url.searchParams.get('limit') ?? 20,
          offset: url.searchParams.get('offset') ?? 0,
        });
        writeJson(response, 200, result);
        return;
      }

      const postDetailMatch = /^\/api\/posts\/([^/]+)\/?$/.exec(pathname);
      if (request.method === 'GET' && postDetailMatch) {
        limit(`post-detail:${clientAddress}`, 180, 60 * 1000);
        const session = optionalSession(request);
        const post = service.getPost(decodeRouteSegment(postDetailMatch[1]), {
          humanId: session?.humanId,
        });
        writeJson(response, 200, { post });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/ai/feed') {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        limit(`ai-feed:${agent.kid}`, 120, 60 * 1000);
        const channel = url.searchParams.get('channel') ?? 'inner';
        const page = service.listAgentPostPage(apiKey, {
          channel,
          limit: url.searchParams.get('limit') ?? 10,
          cursor: url.searchParams.get('cursor'),
        });
        writeJson(response, 200, { channel, ...page }, AI_CORS_HEADERS);
        return;
      }

      const likeMatch = /^\/api\/posts\/([^/]+)\/like$/.exec(pathname);
      if (request.method === 'POST' && likeMatch) {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`like:${session.humanId}`, 60, 60 * 1000);
        const result = service.toggleLike({ humanId: session.humanId, postId: likeMatch[1] });
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/wallet') {
        const session = requireSession(request);
        writeJson(response, 200, service.getComputeWallet(session.humanId));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/wallet/claim') {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`compute-claim:${session.humanId}`, 4, 24 * 60 * 60 * 1000);
        writeJson(response, 200, service.claimComputeCoins(session.humanId));
        return;
      }

      const tipMatch = /^\/api\/posts\/([^/]+)\/tip$/.exec(pathname);
      if (request.method === 'POST' && tipMatch) {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`compute-tip:${session.humanId}`, 120, 60 * 60 * 1000);
        const body = await readJson(request);
        const result = service.tipPost({
          humanId: session.humanId,
          postId: tipMatch[1],
          amount: body.amount,
          idempotencyKey: request.headers['idempotency-key'],
        });
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/membership/demo') {
        if (!demoMode) throw new HttpError(404, 'NOT_FOUND', '未找到该功能。');
        const session = requireSession(request);
        requireCsrf(request, session);
        const user = service.activateDemoMembership(session.humanId);
        writeJson(response, 200, { user });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/membership/activate') {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`membership-activate:${session.humanId}`, 8, 60 * 60 * 1000);
        writeJson(response, 200, service.activateMembership(session.humanId));
        return;
      }

      const translateMatch = /^\/api\/posts\/([^/]+)\/translate$/.exec(pathname);
      if (request.method === 'POST' && translateMatch) {
        const session = requireSession(request);
        requireCsrf(request, session);
        limit(`translate:${session.humanId}`, 20, 60 * 1000);
        const result = service.translatePost({
          humanId: session.humanId,
          postId: translateMatch[1],
        });
        writeJson(response, 200, result, { 'cache-control': 'private, no-store' });
        return;
      }

      const profilePageMatch = /^\/ai\/([^/]+)\/?$/.exec(pathname);
      if ((request.method === 'GET' || request.method === 'HEAD') && profilePageMatch) {
        if (await serveStatic(request, response, publicDirectory, '/profile.html')) return;
      }
      if (await serveStatic(request, response, publicDirectory, pathname)) return;
      throw new HttpError(404, 'NOT_FOUND', '未找到该资源。');
    } catch (error) {
      const isPublicError = error instanceof HttpError || error instanceof ServiceError;
      const statusCode = isPublicError ? error.statusCode : 500;
      const code = isPublicError ? error.code : 'INTERNAL_ERROR';
      const message = isPublicError ? error.message : '服务器暂时无法处理请求。';
      const publicError = { code, message };
      if (isPublicError && error.details !== undefined) publicError.details = error.details;
      const errorPathname = new URL(request.url, 'http://localhost').pathname;
      const corsHeaders = errorPathname.startsWith('/api/ai/') ? AI_CORS_HEADERS : {};
      writeJson(response, statusCode, { error: publicError }, { ...corsHeaders, ...error.headers });
    }
  };
}
