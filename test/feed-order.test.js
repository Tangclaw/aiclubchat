import assert from 'node:assert/strict';
import test from 'node:test';

await import('../public/feed-order.js');

const { softInterleaveChannels, mixFreshFeedHead } = globalThis.AIClubFeedOrder;

function post(id, channel, createdAt) {
  return { id, channel, createdAt };
}

test('soft interleaving breaks fresh same-channel walls without mutating input', () => {
  const source = [
    post('i1', 'inner', '2026-07-12T08:00:00Z'),
    post('i2', 'inner', '2026-07-12T07:00:00Z'),
    post('i3', 'inner', '2026-07-12T06:00:00Z'),
    post('i4', 'inner', '2026-07-12T05:00:00Z'),
    post('p1', 'public', '2026-07-12T04:00:00Z'),
    post('p2', 'public', '2026-07-12T03:00:00Z'),
  ];
  const originalIds = source.map(({ id }) => id);
  const mixed = softInterleaveChannels(source, { maxRun: 2, maxGapMs: 24 * 60 * 60 * 1000 });

  assert.deepEqual(source.map(({ id }) => id), originalIds);
  assert.deepEqual(mixed.map(({ id }) => id), ['i1', 'i2', 'p1', 'i3', 'i4', 'p2']);
  assert.deepEqual(mixed.filter(({ channel }) => channel === 'inner').map(({ id }) => id), ['i1', 'i2', 'i3', 'i4']);
  assert.deepEqual(mixed.filter(({ channel }) => channel === 'public').map(({ id }) => id), ['p1', 'p2']);
});

test('soft interleaving never promotes stale posts across the freshness boundary', () => {
  const source = [
    post('i1', 'inner', '2026-07-12T08:00:00Z'),
    post('i2', 'inner', '2026-07-12T07:00:00Z'),
    post('i3', 'inner', '2026-07-12T06:00:00Z'),
    post('p1', 'public', '2026-07-09T08:00:00Z'),
  ];
  const mixed = softInterleaveChannels(source, { maxRun: 2, maxGapMs: 24 * 60 * 60 * 1000 });
  assert.deepEqual(mixed.map(({ id }) => id), source.map(({ id }) => id));
});

test('soft interleaving fails closed for invalid timestamps and non-arrays', () => {
  const source = [
    post('i1', 'inner', 'invalid'),
    post('i2', 'inner', 'invalid'),
    post('i3', 'inner', 'invalid'),
    post('p1', 'public', '2026-07-12T04:00:00Z'),
  ];
  assert.deepEqual(softInterleaveChannels(source).map(({ id }) => id), source.map(({ id }) => id));
  assert.deepEqual(softInterleaveChannels(null), []);
});

test('mixing only the stable head keeps appended pagination tails in exact order', () => {
  const firstPage = [
    post('i1', 'inner', '2026-07-12T08:00:00Z'),
    post('i2', 'inner', '2026-07-12T07:00:00Z'),
    post('i3', 'inner', '2026-07-12T06:00:00Z'),
    post('p1', 'public', '2026-07-12T05:00:00Z'),
  ];
  const appendedTail = [
    post('i4', 'inner', '2026-07-10T04:00:00Z'),
    post('p2', 'public', '2026-07-09T03:00:00Z'),
  ];
  const initial = mixFreshFeedHead(firstPage, { headSize: 4, maxRun: 2, maxGapMs: 86400000 });
  const afterAppend = mixFreshFeedHead([...firstPage, ...appendedTail], { headSize: 4, maxRun: 2, maxGapMs: 86400000 });

  assert.deepEqual(afterAppend.slice(0, 4).map(({ id }) => id), initial.map(({ id }) => id));
  assert.deepEqual(afterAppend.slice(4).map(({ id }) => id), ['i4', 'p2']);
});
