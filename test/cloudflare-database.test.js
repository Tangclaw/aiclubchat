import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createDurableDatabase } from '../src/cloudflare/database.js';
import { runInTransaction } from '../src/transaction.js';

function createCursor(rows = [], rowsWritten = 0) {
  return {
    rowsRead: rows.length,
    rowsWritten,
    toArray() {
      return rows;
    },
  };
}

function createMockDurableStorage() {
  const sqlite = new DatabaseSync(':memory:');
  let transactionCalls = 0;
  return {
    sqlite,
    get transactionCalls() {
      return transactionCalls;
    },
    sql: {
      exec(statement, ...parameters) {
        if (parameters.length === 0 && /^(?:CREATE|DROP|ALTER|PRAGMA)\b/i.test(statement.trim())) {
          sqlite.exec(statement);
          return createCursor();
        }
        const prepared = sqlite.prepare(statement);
        if (/^(?:SELECT|WITH)\b/i.test(statement.trim())) {
          return createCursor(prepared.all(...parameters));
        }
        const result = prepared.run(...parameters);
        return createCursor([], Number(result.changes));
      },
    },
    transactionSync(action) {
      transactionCalls += 1;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = action();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('Cloudflare database adapter delegates atomic work to transactionSync', () => {
  const storage = createMockDurableStorage();
  const db = createDurableDatabase(storage);
  db.exec('CREATE TABLE events (id TEXT PRIMARY KEY)');

  assert.throws(() => runInTransaction(db, () => {
    db.prepare('INSERT INTO events (id) VALUES (?)').run('rolled-back');
    throw new Error('abort');
  }), /abort/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0);

  const result = runInTransaction(db, () => {
    db.prepare('INSERT INTO events (id) VALUES (?)').run('committed');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 1);
  assert.equal(storage.transactionCalls, 2);
  storage.sqlite.close();
});

test('Cloudflare database adapter reports cumulative SQLite usage', () => {
  const storage = createMockDurableStorage();
  const samples = [];
  const db = createDurableDatabase(storage, { onQuery: (sample) => samples.push(sample) });
  db.exec('CREATE TABLE events (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO events (id) VALUES (?)').run('one');
  db.prepare('INSERT INTO events (id) VALUES (?)').run('two');
  assert.equal(db.prepare('SELECT * FROM events').all().length, 2);

  assert.deepEqual(db.usage(), { rowsRead: 2, rowsWritten: 2, queries: 4 });
  assert.equal(samples.at(-1).rowsRead, 2);
  storage.sqlite.close();
});
