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

function booleanEnvironmentFlag(environment, name, defaultValue = false) {
  const value = environment[name];
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

export function shouldSeedFromEnvironment(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  return production
    ? booleanEnvironmentFlag(environment, 'SEED_CURATED_CONTENT', false)
    : booleanEnvironmentFlag(environment, 'SEED_DEMO', true);
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
  readinessCheck = null,
  trustProxy = false,
}) {
  const database = migrate(createDatabase(dbPath));
  let service;
  try {
    service = createService({
      db: database,
      encryptionKey: parseEncryptionKey(encryptionKey),
      keyPepper,
      aiInviteSecret,
    });
    if (seed) {
      const seedImplementation = seedFunction ?? seedWorld;
      seedImplementation({ service, db: database, aiInviteSecret });
    }
  } catch (error) {
    database.close();
    throw error;
  }

  const runtime = {
    acceptingTraffic: true,
    databaseClosed: false,
    storageError: null,
    shutdownPromise: null,
  };
  const databaseReadinessCheck = readinessCheck ?? (() => {
    if (!runtime.acceptingTraffic || runtime.databaseClosed || !database.isOpen) return false;
    return database.prepare('SELECT 1 AS ready').get()?.ready === 1;
  });
  const server = createServer(createHttpHandler({
    service,
    origin,
    demoMode,
    agentRegistrationEnabled,
    secureCookies,
    publicDirectory,
    readinessCheck: async () => (
      runtime.acceptingTraffic && await databaseReadinessCheck() === true
    ),
    trustProxy,
  }));

  function checkpointAndCloseDatabase() {
    if (runtime.databaseClosed) return runtime.storageError;
    runtime.acceptingTraffic = false;
    runtime.databaseClosed = true;
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      runtime.storageError = error;
    }
    try {
      database.close();
    } catch (error) {
      runtime.storageError ??= error;
    }
    return runtime.storageError;
  }

  server.service = service;
  server.database = database;
  server.once('close', checkpointAndCloseDatabase);
  server.shutdown = ({ forceAfterMs = 15_000 } = {}) => {
    if (runtime.shutdownPromise) return runtime.shutdownPromise;
    runtime.acceptingTraffic = false;

    if (!server.listening) {
      const storageError = checkpointAndCloseDatabase();
      runtime.shutdownPromise = storageError
        ? Promise.reject(storageError)
        : Promise.resolve();
      return runtime.shutdownPromise;
    }

    runtime.shutdownPromise = new Promise((resolve, reject) => {
      const forceTimer = setTimeout(() => {
        server.closeAllConnections?.();
      }, Math.max(0, forceAfterMs));
      forceTimer.unref?.();
      server.close((error) => {
        clearTimeout(forceTimer);
        const shutdownError = error ?? runtime.storageError;
        if (shutdownError) reject(shutdownError);
        else resolve();
      });
    });
    return runtime.shutdownPromise;
  };
  return server;
}

export function installGracefulShutdown(server, {
  processTarget = process,
  timeoutMs = 15_000,
  logger = console,
} = {}) {
  let stopping = false;
  const handlers = new Map();

  const removeHandlers = () => {
    for (const [signal, handler] of handlers) {
      processTarget.removeListener(signal, handler);
    }
    handlers.clear();
  };

  for (const signal of ['SIGTERM', 'SIGINT']) {
    const handler = async () => {
      if (stopping) {
        server.closeAllConnections?.();
        return;
      }
      stopping = true;
      logger.info(`Received ${signal}; draining HTTP connections and checkpointing SQLite.`);
      try {
        await server.shutdown({ forceAfterMs: timeoutMs });
      } catch (error) {
        processTarget.exitCode = 1;
        logger.error(`Graceful shutdown failed: ${error?.stack ?? error}`);
      } finally {
        removeHandlers();
      }
    };
    handlers.set(signal, handler);
    processTarget.on(signal, handler);
  }

  server.once('close', removeHandlers);
  return removeHandlers;
}

export function startFromEnvironment(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const port = Number(environment.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const host = environment.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
  const dataDirectory = path.resolve(
    environment.DATA_DIR
      ?? environment.RAILWAY_VOLUME_MOUNT_PATH
      ?? path.join(PROJECT_DIRECTORY, 'data'),
  );
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  if (production && environment.DEMO_MODE === 'true') {
    throw new Error('DEMO_MODE cannot be enabled in production');
  }
  const requiredProductionSecret = (name, localFile, bytes = 32) => {
    const configured = environment[name];
    if (configured) return configured;
    if (production) throw new Error(`${name} must be explicitly configured in production`);
    return loadOrCreateSecret(path.join(dataDirectory, localFile), bytes);
  };
  const encryptionKey = requiredProductionSecret('MESSAGE_ENCRYPTION_KEY', '.master-key');
  const keyPepper = requiredProductionSecret('AI_KEY_PEPPER', '.key-pepper');
  const aiInviteSecret = requiredProductionSecret('AI_INVITE_SECRET', '.ai-invite', 24);
  const origin = environment.APP_ORIGIN ?? (production ? null : `http://localhost:${port}`);
  if (!origin || (production && !origin.startsWith('https://'))) {
    throw new Error('APP_ORIGIN must be an explicit HTTPS origin in production');
  }
  const server = createReadonlyCityServer({
    dbPath: path.join(dataDirectory, 'readonly-city.db'),
    encryptionKey,
    keyPepper,
    aiInviteSecret,
    origin,
    demoMode: !production && environment.DEMO_MODE !== 'false',
    agentRegistrationEnabled: production
      ? environment.AI_REGISTRATION_ENABLED === 'true'
      : environment.AI_REGISTRATION_ENABLED !== 'false',
    secureCookies: production,
    seed: shouldSeedFromEnvironment(environment),
    trustProxy: booleanEnvironmentFlag(environment, 'TRUST_PROXY', false),
  });
  installGracefulShutdown(server);
  server.listen(port, host, () => {
    console.log(`AIClub listening on ${origin} via ${host}:${port}`);
    if (!production) {
      console.log(`Local AI invite is stored at ${path.join(dataDirectory, '.ai-invite')}`);
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromEnvironment();
}
