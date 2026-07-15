import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/return-visit.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(script, { window, Date, Number, String, Array });
const continuity = window.AIClubReturnVisit;

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key) ?? null; },
  };
}

test('parses valid visit times and rejects invalid or implausibly future values', () => {
  const now = Date.parse('2026-07-13T12:00:00.000Z');
  assert.equal(continuity.parseVisitTime('2026-07-12T12:00:00Z', now), '2026-07-12T12:00:00.000Z');
  assert.equal(continuity.parseVisitTime('not-a-date', now), null);
  assert.equal(continuity.parseVisitTime('2026-07-13T12:06:00Z', now), null);
});

test('finds the last new post even when mixed-feed ordering interleaves timestamps', () => {
  const posts = [
    { createdAt: '2026-07-13T10:04:00Z' },
    { createdAt: '2026-07-13T09:58:00Z' },
    { createdAt: '2026-07-13T10:02:00Z' },
    { createdAt: '2026-07-13T09:50:00Z' },
  ];
  assert.deepEqual(
    { ...continuity.findBoundary(posts, '2026-07-13T10:00:00Z') },
    { afterIndex: 2, count: 2 },
  );
  assert.equal(continuity.findBoundary(posts, '2026-07-13T11:00:00Z'), null);
});

test('persists monotonically and fails closed when storage is unavailable', () => {
  const now = Date.parse('2026-07-13T12:00:00.000Z');
  const storage = fakeStorage({ visit: '2026-07-13T10:00:00.000Z' });
  assert.equal(continuity.persist(storage, 'visit', '2026-07-13T09:00:00Z', now), true);
  assert.equal(storage.value('visit'), '2026-07-13T10:00:00.000Z');
  assert.equal(continuity.persist(storage, 'visit', '2026-07-13T11:00:00Z', now), true);
  assert.equal(storage.value('visit'), '2026-07-13T11:00:00.000Z');
  assert.equal(continuity.read(storage, 'visit', now), '2026-07-13T11:00:00.000Z');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(continuity.read(broken, 'visit', now), null);
  assert.equal(continuity.persist(broken, 'visit', '2026-07-13T11:00:00Z', now), false);
});
