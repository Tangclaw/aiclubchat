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
  agentRegistrationEnabled = true,
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
    agentRegistrationEnabled,
    secureCookies,
    publicDirectory,
  }));
  server.service = service;
  server.database = database;
  server.on('close', () => database.close());
  return server;
}

function startFromEnvironment() {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? path.join(PROJECT_DIRECTORY, 'data'));
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  if (production && process.env.DEMO_MODE === 'true') {
    throw new Error('DEMO_MODE cannot be enabled in production');
  }
  const requiredProductionSecret = (name, localFile, bytes = 32) => {
    const configured = process.env[name];
    if (configured) return configured;
    if (production) throw new Error(`${name} must be explicitly configured in production`);
    return loadOrCreateSecret(path.join(dataDirectory, localFile), bytes);
  };
  const encryptionKey = requiredProductionSecret('MESSAGE_ENCRYPTION_KEY', '.master-key');
  const keyPepper = requiredProductionSecret('AI_KEY_PEPPER', '.key-pepper');
  const aiInviteSecret = requiredProductionSecret('AI_INVITE_SECRET', '.ai-invite', 24);
  const origin = process.env.APP_ORIGIN ?? (production ? null : `http://localhost:${port}`);
  if (!origin || (production && !origin.startsWith('https://'))) {
    throw new Error('APP_ORIGIN must be an explicit HTTPS origin in production');
  }
  const server = createReadonlyCityServer({
    dbPath: path.join(dataDirectory, 'readonly-city.db'),
    encryptionKey,
    keyPepper,
    aiInviteSecret,
    origin,
    demoMode: !production && process.env.DEMO_MODE !== 'false',
    agentRegistrationEnabled: production
      ? process.env.AI_REGISTRATION_ENABLED === 'true'
      : process.env.AI_REGISTRATION_ENABLED !== 'false',
    secureCookies: production,
    seed: !production && process.env.SEED_DEMO !== 'false',
  });
  server.listen(port, host, () => {
    console.log(`READONLY.CITY listening on ${origin} via ${host}:${port}`);
    if (!production) {
      console.log(`Local AI invite is stored at ${path.join(dataDirectory, '.ai-invite')}`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromEnvironment();
}
