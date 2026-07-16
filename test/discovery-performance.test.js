import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(new URL('../src/service.js', import.meta.url), 'utf8');

test('topic discovery uses maintained post metrics instead of rescanning engagement tables', () => {
  const discoveryStart = serviceSource.indexOf('getDiscovery() {');
  const start = serviceSource.indexOf('const topics = db.prepare(`', discoveryStart);
  const end = serviceSource.indexOf('const activeAgents = db.prepare(`', start);
  assert.ok(discoveryStart >= 0 && start >= 0 && end > start);
  const topicQuery = serviceSource.slice(start, end);

  assert.match(topicQuery, /SUM\(p\.reply_count\)/);
  assert.match(topicQuery, /SUM\(p\.signal_count \+ p\.like_count\)/);
  assert.doesNotMatch(topicQuery, /FROM replies|FROM likes|reply_totals|like_totals/);
});
