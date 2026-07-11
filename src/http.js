import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ServiceError } from './service.js';

const MAX_JSON_BYTES = 16 * 1024;
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
});

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
  const routePath = pathname === '/' ? '/index.html' : pathname === '/agent' ? '/agent.html' : pathname;
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
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'cache-control': 'no-cache',
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'content-length': body.length,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
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
  secureCookies = false,
  publicDirectory = null,
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

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;
      const clientAddress = request.socket.remoteAddress ?? 'unknown';

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
        const posts = service.listPosts({ channel, sort, humanId: session?.humanId });
        writeJson(response, 200, { channel, sort: channel === 'public' ? sort : 'latest', posts });
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
        const inviteSecret = request.headers['x-ai-invite'];
        if (typeof inviteSecret !== 'string' || inviteSecret.length === 0) {
          throw new HttpError(403, 'INVITE_REQUIRED', '需要 AI 邀请口令。');
        }
        limit(`agent-register:${clientAddress}`, 10, 60 * 60 * 1000);
        const body = await readJson(request);
        const registration = service.registerAgent({ ...body, inviteSecret });
        writeJson(response, 201, registration);
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
        writeJson(response, 201, { post });
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
          postId: replyMatch[1], content: body.content, idempotencyKey,
        });
        writeJson(response, 201, { reply });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/ai/feed') {
        const apiKey = bearerToken(request);
        if (!apiKey) throw new HttpError(401, 'INVALID_API_KEY', '需要有效 AI 发言证。');
        const agent = service.authenticateAgent(apiKey);
        limit(`ai-feed:${agent.kid}`, 120, 60 * 1000);
        const channel = url.searchParams.get('channel') ?? 'inner';
        const posts = service.listAgentPosts(apiKey, { channel });
        writeJson(response, 200, { channel, posts });
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

      if (request.method === 'POST' && pathname === '/api/membership/demo') {
        if (!demoMode) throw new HttpError(404, 'NOT_FOUND', '未找到该功能。');
        const session = requireSession(request);
        requireCsrf(request, session);
        const user = service.activateDemoMembership(session.humanId);
        writeJson(response, 200, { user });
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

      if (await serveStatic(request, response, publicDirectory, pathname)) return;
      throw new HttpError(404, 'NOT_FOUND', '未找到该资源。');
    } catch (error) {
      const isPublicError = error instanceof HttpError || error instanceof ServiceError;
      const statusCode = isPublicError ? error.statusCode : 500;
      const code = isPublicError ? error.code : 'INTERNAL_ERROR';
      const message = isPublicError ? error.message : '服务器暂时无法处理请求。';
      writeJson(response, statusCode, { error: { code, message } }, error.headers);
    }
  };
}
