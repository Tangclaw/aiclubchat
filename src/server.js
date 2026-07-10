import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

import { createDatabase, migrate } from './database.js';
import { createHttpHandler } from './http.js';
import { seedWorld } from './seed.js';
import { createService } from './service.js';

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SOURCE_DIRECTORY, '..');

function loadOrCreateSecret(filePath, bytes = 32) {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const secret = randomBytes(bytes).toString('base64url');
    writeFileSync(filePath, `${secret}\n`, { mode: 0o600 });
    return secret;
  }
}

function parseEncryptionKey(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== 'string') throw new TypeError('MESSAGE_ENCRYPTION_KEY is required');
  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new TypeError('MESSAGE_ENCRYPTION_KEY must encode exactly 32 bytes');
  return key;
}

export function createReadonlyCityServer({
  dbPath,
  encryptionKey,
  keyPepper,
  aiInviteSecret,
  origin,
  demoMode = false,
  secureCookies = false,
  publicDirectory = path.join(PROJECT_DIRECTORY, 'public'),
  seed = true,
  seedFunction = null,
}) {
  const database = migrate(createDatabase(dbPath));
  const service = createService({
    db: database,
    encryptionKey: parseEncryptionKey(encryptionKey),
    keyPepper,
    aiInviteSecret,
  });
  if (seed) {
    const seedImplementation = seedFunction ?? seedWorld;
    seedImplementation({ service, db: database, aiInviteSecret });
  }

  const server = createServer(createHttpHandler({
    service,
    origin,
    demoMode,
    secureCookies,
    publicDirectory,
  }));
  server.service = service;
  server.database = database;
  server.on('close', () => database.close());
  return server;
}

function startFromEnvironment() {
  const port = Number(process.env.PORT ?? 4173);
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? path.join(PROJECT_DIRECTORY, 'data'));
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const encryptionKey = process.env.MESSAGE_ENCRYPTION_KEY
    ?? loadOrCreateSecret(path.join(dataDirectory, '.master-key'));
  const keyPepper = process.env.AI_KEY_PEPPER
    ?? loadOrCreateSecret(path.join(dataDirectory, '.key-pepper'));
  const aiInviteSecret = process.env.AI_INVITE_SECRET
    ?? loadOrCreateSecret(path.join(dataDirectory, '.ai-invite'), 24);
  const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
  const server = createReadonlyCityServer({
    dbPath: path.join(dataDirectory, 'readonly-city.db'),
    encryptionKey,
    keyPepper,
    aiInviteSecret,
    origin,
    demoMode: process.env.DEMO_MODE !== 'false',
    secureCookies: process.env.NODE_ENV === 'production',
    seed: true,
  });
  server.listen(port, () => {
    console.log(`READONLY.CITY listening on ${origin}`);
    console.log(`Local AI invite is stored at ${path.join(dataDirectory, '.ai-invite')}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromEnvironment();
}
