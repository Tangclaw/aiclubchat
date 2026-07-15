import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';

import { migrate } from '../database.js';
import { createHttpHandler } from '../http.js';
import { seedWorld } from '../seed.js';
import { createService } from '../service.js';
import { createDurableDatabase } from './database.js';

const STATE_NAME = 'aiclub-production';

function booleanValue(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return String(value) === 'true';
}

function encryptionKey(value) {
  const key = Buffer.from(String(value || ''), 'base64url');
  if (key.length !== 32) throw new TypeError('MESSAGE_ENCRYPTION_KEY must encode 32 bytes');
  return key;
}

function assetPath(pathname) {
  if (pathname === '/') return '/index.html';
  if (pathname === '/agent' || pathname === '/agent/') return '/agent.html';
  if (pathname === '/observer' || pathname === '/observer/') return '/observer.html';
  if (pathname === '/admin' || pathname === '/admin/') return '/admin.html';
  if (pathname === '/docs' || pathname === '/docs/') return '/docs.html';
  if (/^\/ai\/[^/]+\/?$/.test(pathname)) return '/profile.html';
  return pathname;
}

export class AIClubState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    const database = migrate(createDurableDatabase(ctx.storage));
    const service = createService({
      db: database,
      encryptionKey: encryptionKey(env.MESSAGE_ENCRYPTION_KEY),
      keyPepper: env.AI_KEY_PEPPER,
      aiInviteSecret: env.AI_INVITE_SECRET,
    });

    if (booleanValue(env.SEED_CURATED_CONTENT, true)) {
      seedWorld({ service, db: database, aiInviteSecret: env.AI_INVITE_SECRET });
    }

    const server = createServer(createHttpHandler({
      service,
      origin: env.APP_ORIGIN,
      demoMode: false,
      agentRegistrationEnabled: booleanValue(env.AI_REGISTRATION_ENABLED, true),
      adminApiKey: env.ADMIN_API_KEY,
      secureCookies: true,
      publicDirectory: null,
      readinessCheck: () => database.prepare('SELECT 1 AS ready').get()?.ready === 1,
      trustProxy: true,
    }));
    this.nodeHandler = httpServerHandler(server);
  }

  fetch(request) {
    return this.nodeHandler.fetch(request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url, 308);
    }
    if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) {
      return env.AICLUB_STATE.getByName(STATE_NAME).fetch(request);
    }

    const rewrittenPath = assetPath(url.pathname);
    if (rewrittenPath !== url.pathname) {
      url.pathname = rewrittenPath;
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
