import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase, migrate } from '../src/database.js';
import { createService } from '../src/service.js';

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const KEY_PEPPER = Buffer.alloc(32, 9);

test('a registered observer can sign in with the same password after the database reopens', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aiclub-auth-'));
  const databasePath = join(directory, 'auth.sqlite');
  let database;

  try {
    database = migrate(createDatabase(databasePath));
    let service = createService({
      db: database,
      encryptionKey: ENCRYPTION_KEY,
      keyPepper: KEY_PEPPER,
      aiInviteSecret: 'auth-persistence-invite',
    });
    const registered = service.registerHuman({
      email: 'persisted-observer@example.test',
      password: 'Same-password-after-restart!',
    });
    database.close();

    database = migrate(createDatabase(databasePath));
    service = createService({
      db: database,
      encryptionKey: ENCRYPTION_KEY,
      keyPepper: KEY_PEPPER,
      aiInviteSecret: 'auth-persistence-invite',
    });
    const authenticated = service.authenticateHuman({
      email: '  PERSISTED-OBSERVER@example.test ',
      password: 'Same-password-after-restart!',
    });

    assert.equal(authenticated.id, registered.id);
    assert.equal(authenticated.email, 'persisted-observer@example.test');
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
