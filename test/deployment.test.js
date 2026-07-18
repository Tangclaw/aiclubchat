import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { createHttpHandler, getClientAddress } from '../src/http.js';
import {
  createReadonlyCityServer,
  installGracefulShutdown,
  shouldSeedFromEnvironment,
} from '../src/server.js';

const temporaryDirectories = [];
const runningServers = [];

afterEach(async () => {
  for (const server of runningServers.splice(0)) {
    if (server.listening) await server.shutdown({ forceAfterMs: 500 });
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function createTestServer(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aiclub-deployment-'));
  temporaryDirectories.push(directory);
  const server = createReadonlyCityServer({
    dbPath: path.join(directory, 'test.db'),
    encryptionKey: randomBytes(32),
    keyPepper: 'deployment-test-pepper-with-enough-entropy',
    aiInviteSecret: 'deployment-test-ai-invite',
    origin: 'http://127.0.0.1',
    publicDirectory: null,
    seed: false,
    ...options,
  });
  runningServers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test('healthz is only healthy while the SQLite database is ready', async () => {
  const healthy = await createTestServer();
  const response = await fetch(`${healthy.baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    checks: { database: 'ready' },
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const head = await fetch(`${healthy.baseUrl}/healthz`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const unavailable = await createTestServer({ readinessCheck: () => false });
  const unavailableResponse = await fetch(`${unavailable.baseUrl}/healthz`);
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    status: 'unavailable',
    checks: { database: 'not_ready' },
  });
});

test('healthz fails closed when the database readiness probe throws', async () => {
  const server = createServer(createHttpHandler({
    service: {},
    readinessCheck() {
      throw new Error('database unavailable');
    },
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 503);
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('public capabilities accurately reports whether this deployment issues agent credentials', async () => {
  const enabled = await createTestServer({ agentRegistrationEnabled: true });
  const enabledCapabilities = await fetch(`${enabled.baseUrl}/api/capabilities`);
  assert.equal(enabledCapabilities.status, 200);
  assert.deepEqual(await enabledCapabilities.json(), {
    agentRegistrationEnabled: true,
    platform: 'AIClub',
    baseUrl: 'http://127.0.0.1',
    docsUrl: 'http://127.0.0.1/docs',
    openapiUrl: 'http://127.0.0.1/openapi.json',
    credentialPrefix: 'aiclub_ai_',
  });

  const enabledRegistration = await fetch(`${enabled.baseUrl}/api/agents/quick-register`, {
    method: 'POST',
  });
  assert.equal(enabledRegistration.status, 401);

  const disabled = await createTestServer({ agentRegistrationEnabled: false });
  const disabledCapabilities = await fetch(`${disabled.baseUrl}/api/capabilities`);
  assert.equal(disabledCapabilities.status, 200);
  assert.deepEqual(await disabledCapabilities.json(), {
    agentRegistrationEnabled: false,
    platform: 'AIClub',
    baseUrl: 'http://127.0.0.1',
    docsUrl: 'http://127.0.0.1/docs',
    openapiUrl: 'http://127.0.0.1/openapi.json',
    credentialPrefix: 'aiclub_ai_',
  });

  const disabledQuickRegistration = await fetch(`${disabled.baseUrl}/api/agents/quick-register`, {
    method: 'POST',
  });
  assert.equal(disabledQuickRegistration.status, 404);
  assert.equal((await disabledQuickRegistration.json()).error.code, 'NOT_FOUND');

  const disabledAdvancedRegistration = await fetch(`${disabled.baseUrl}/api/agents/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ai-invite': 'deployment-test-ai-invite',
    },
    body: JSON.stringify({ name: 'Disabled-Node', model: 'test-runtime' }),
  });
  assert.equal(disabledAdvancedRegistration.status, 404);
  assert.equal((await disabledAdvancedRegistration.json()).error.code, 'NOT_FOUND');
});

test('observer has a clean GET and HEAD static route', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aiclub-observer-route-'));
  temporaryDirectories.push(directory);
  const publicDirectory = path.join(directory, 'public');
  await mkdir(publicDirectory);
  await writeFile(path.join(publicDirectory, 'observer.html'), '<main>private observer fixture</main>');
  await writeFile(path.join(publicDirectory, 'fixture.css'), '.fixture{color:#4255e9}\n'.repeat(180));
  await mkdir(path.join(publicDirectory, 'assets'));
  await writeFile(path.join(publicDirectory, 'assets', 'fixture.webp'), Buffer.from('webp-fixture'));
  const { baseUrl } = await createTestServer({ publicDirectory });

  const response = await fetch(`${baseUrl}/observer`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<main>private observer fixture</main>');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const head = await fetch(`${baseUrl}/observer/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const asset = await fetch(`${baseUrl}/assets/fixture.webp`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/webp');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=604800, stale-while-revalidate=86400');

  const compressed = await fetch(`${baseUrl}/fixture.css`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal(compressed.headers.get('vary'), 'accept-encoding');
  assert.match(compressed.headers.get('etag'), /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
  assert.match(await compressed.text(), /^\.fixture/);

  const revalidated = await fetch(`${baseUrl}/fixture.css`, {
    headers: { 'if-none-match': compressed.headers.get('etag') },
  });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get('vary'), 'accept-encoding');
  assert.equal(await revalidated.text(), '');
});

test('X-Real-IP is ignored by default and accepted only from a configured trusted proxy', () => {
  const request = {
    headers: { 'x-real-ip': '203.0.113.42' },
    socket: { remoteAddress: '10.0.0.8' },
  };
  assert.equal(getClientAddress(request), '10.0.0.8');
  assert.equal(getClientAddress(request, true), '203.0.113.42');
  assert.equal(getClientAddress(request, (peer) => peer === '10.0.0.8'), '203.0.113.42');
  assert.equal(getClientAddress(request, () => false), '10.0.0.8');

  request.headers['x-real-ip'] = '203.0.113.42, 198.51.100.2';
  assert.equal(getClientAddress(request, true), '10.0.0.8');
  request.headers['x-real-ip'] = 'not-an-ip';
  assert.equal(getClientAddress(request, true), '10.0.0.8');
});

test('graceful shutdown drains HTTP, checkpoints WAL and closes SQLite once', async () => {
  const { server } = await createTestServer();
  const originalExec = server.database.exec.bind(server.database);
  let checkpointCount = 0;
  server.database.exec = (statement) => {
    if (/^PRAGMA wal_checkpoint\(TRUNCATE\)$/i.test(statement)) checkpointCount += 1;
    return originalExec(statement);
  };

  const firstShutdown = server.shutdown({ forceAfterMs: 1_000 });
  const repeatedShutdown = server.shutdown({ forceAfterMs: 1_000 });
  assert.strictEqual(repeatedShutdown, firstShutdown);
  await firstShutdown;

  assert.equal(server.listening, false);
  assert.throws(() => server.database.prepare('SELECT 1'));
  assert.equal(checkpointCount, 1);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} triggers the graceful shutdown path`, async () => {
    const { server } = await createTestServer();
    const processTarget = new EventEmitter();
    processTarget.exitCode = undefined;
    const messages = [];
    installGracefulShutdown(server, {
      processTarget,
      timeoutMs: 1_000,
      logger: {
        info(message) { messages.push(message); },
        error(message) { messages.push(message); },
      },
    });

    assert.equal(processTarget.listenerCount('SIGTERM'), 1);
    assert.equal(processTarget.listenerCount('SIGINT'), 1);
    const closed = once(server, 'close');
    processTarget.emit(signal);
    await closed;

    assert.throws(() => server.database.prepare('SELECT 1'));
    assert.match(messages.join('\n'), new RegExp(signal));
    assert.equal(processTarget.listenerCount('SIGTERM'), 0);
    assert.equal(processTarget.listenerCount('SIGINT'), 0);
    assert.notEqual(processTarget.exitCode, 1);
  });
}

test('production curated seeding is explicit while local demo seeding remains opt-out', () => {
  assert.equal(shouldSeedFromEnvironment({ NODE_ENV: 'production' }), false);
  assert.equal(shouldSeedFromEnvironment({
    NODE_ENV: 'production',
    SEED_CURATED_CONTENT: 'true',
  }), true);
  assert.throws(
    () => shouldSeedFromEnvironment({ NODE_ENV: 'production', SEED_CURATED_CONTENT: '1' }),
    /true or false/,
  );
  assert.equal(shouldSeedFromEnvironment({}), true);
  assert.equal(shouldSeedFromEnvironment({ SEED_DEMO: 'false' }), false);
});
