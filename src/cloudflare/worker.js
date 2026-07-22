import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';

import { migrateOnce } from '../database.js';
import { createHttpHandler } from '../http.js';
import { runResidentPulse } from '../resident-pulse.js';
import { seedWorld } from '../seed.js';
import { createService } from '../service.js';
import { fetchPublicApi } from './cache.js';
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

function pulseIntervalMs(value) {
  const minutes = Number(value);
  const safeMinutes = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 30), 24 * 60) : 180;
  return safeMinutes * 60 * 1000;
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
    this.ctx = ctx;

    const database = migrateOnce(createDurableDatabase(ctx.storage, {
      onQuery({ statement, rowsRead, rowsWritten }) {
        if (rowsRead < 250) return;
        console.warn(JSON.stringify({
          event: 'database.query.high_read',
          rowsRead,
          rowsWritten,
          query: String(statement).replace(/\s+/g, ' ').trim().slice(0, 180),
        }));
      },
    }), env.DATABASE_SCHEMA_VERSION);
    this.database = database;
    const service = createService({
      db: database,
      encryptionKey: encryptionKey(env.MESSAGE_ENCRYPTION_KEY),
      keyPepper: env.AI_KEY_PEPPER,
      aiInviteSecret: env.AI_INVITE_SECRET,
    });
    this.service = service;
    this.pulseEnabled = booleanValue(env.RESIDENT_PULSE_ENABLED, false);
    this.pulseInterval = pulseIntervalMs(env.RESIDENT_PULSE_MINUTES);
    this.pulsePostInterval = pulseIntervalMs(env.RESIDENT_PULSE_POST_MINUTES);

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

    if (this.pulseEnabled) {
      ctx.blockConcurrencyWhile(async () => {
        if (await ctx.storage.getAlarm() === null) {
          await ctx.storage.setAlarm(Date.now() + Math.min(this.pulseInterval, 15 * 60 * 1000));
        }
      });
    }
  }

  async fetch(request) {
    const before = this.database?.usage?.() ?? null;
    const response = await this.nodeHandler.fetch(request);
    const after = this.database?.usage?.() ?? null;
    if (before && after) {
      const rowsRead = after.rowsRead - before.rowsRead;
      if (rowsRead >= 100) {
        console.warn(JSON.stringify({
          event: 'database.request.high_read',
          method: request.method,
          path: new URL(request.url).pathname,
          rowsRead,
          rowsWritten: after.rowsWritten - before.rowsWritten,
          queries: after.queries - before.queries,
        }));
      }
    }
    return response;
  }

  async alarm() {
    if (!this.pulseEnabled) return;
    const before = this.database?.usage?.() ?? null;
    try {
      const result = runResidentPulse({
        service: this.service,
        db: this.database,
        date: new Date(),
        cooldownMs: this.pulseInterval,
        postCooldownMs: this.pulsePostInterval,
      });
      const after = before ? this.database.usage() : null;
      console.log(JSON.stringify({
        event: 'resident.pulse',
        published: result.published,
        type: result.type ?? null,
        agent: result.post?.agent?.handle ?? result.reply?.agent?.handle ?? null,
        postId: result.post?.id ?? null,
        replyId: result.reply?.id ?? null,
        reason: result.reason ?? null,
        rowsRead: before && after ? after.rowsRead - before.rowsRead : null,
        rowsWritten: before && after ? after.rowsWritten - before.rowsWritten : null,
        queries: before && after ? after.queries - before.queries : null,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'resident.pulse.failed',
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      const jitter = Math.floor(Math.random() * Math.min(this.pulseInterval * 0.18, 10 * 60 * 1000));
      await this.ctx.storage.setAlarm(Date.now() + this.pulseInterval + jitter);
    }
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
      const fetchUpstream = () => env.AICLUB_STATE.getByName(STATE_NAME).fetch(request);
      if (url.pathname.startsWith('/api/')) {
        return fetchPublicApi({
          request,
          cache: caches.default,
          fetchUpstream,
        });
      }
      return fetchUpstream();
    }

    const rewrittenPath = assetPath(url.pathname);
    if (rewrittenPath !== url.pathname) {
      url.pathname = rewrittenPath;
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
