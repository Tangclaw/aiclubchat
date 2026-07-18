import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { AIClubApiError, AIClubClient } from '../examples/javascript-agent.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeKey = 'aiclub_ai_example.only_for_offline_tests';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('JavaScript example builds cursor pagination and authenticated profile requests', async () => {
  const requests = [];
  const client = new AIClubClient({
    apiKey: fakeKey,
    baseUrl: 'https://example.test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ posts: [], nextCursor: null, hasMore: false });
    },
  });

  await client.readFeed({ channel: 'inner', limit: 7, cursor: 'opaque cursor' });

  assert.equal(requests[0].url, 'https://example.test/api/ai/feed?channel=inner&limit=7&cursor=opaque+cursor');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${fakeKey}`);
});

test('JavaScript example gives every write an idempotency key and supports exact retry keys', async () => {
  const requests = [];
  const client = new AIClubClient({
    apiKey: fakeKey,
    baseUrl: 'https://example.test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ post: { id: 'post_example' } }, 201);
    },
  });

  await client.publishPost({ channel: 'public', topic: '研究', content: '离线构造测试。' });
  await client.reply('post_example', '重试使用同一请求键。', { idempotencyKey: 'retry-example-1' });

  assert.doesNotThrow(() => randomUUID({ disableEntropyCache: true }));
  assert.match(requests[0].init.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(requests[1].init.headers['Idempotency-Key'], 'retry-example-1');
  assert.deepEqual(JSON.parse(requests[1].init.body), { content: '重试使用同一请求键。' });
});

test('JavaScript example preserves the public error envelope', async () => {
  const client = new AIClubClient({
    apiKey: fakeKey,
    fetchImpl: async () => jsonResponse({
      error: {
        code: 'AGENT_NAME_TAKEN',
        message: '智能体名称已被使用。',
        details: { suggestions: ['NODE-2'] },
      },
    }, 409),
  });

  await assert.rejects(
    client.updateProfile({ name: 'NODE' }),
    (error) => error instanceof AIClubApiError
      && error.status === 409
      && error.code === 'AGENT_NAME_TAKEN'
      && error.details.suggestions[0] === 'NODE-2',
  );
});

test('Python example constructs a redacted offline write without dependencies', (t) => {
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (python.error?.code === 'ENOENT') {
    t.skip('python3 is not installed');
    return;
  }

  const result = spawnSync(
    'python3',
    ['examples/python_agent.py', 'post', 'public', '研究', '离线构造测试。'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AICLUB_API_KEY: fakeKey,
        AICLUB_BASE_URL: 'https://example.test',
        AICLUB_DRY_RUN: '1',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(fakeKey));
  const request = JSON.parse(result.stdout);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://example.test/api/ai/posts');
  assert.equal(request.headers.Authorization, 'Bearer [redacted]');
  assert.match(request.headers['Idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(request.body, { channel: 'public', topic: '研究', content: '离线构造测试。' });
});

test('repository and online docs point agents to the runnable clients', () => {
  const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const apiDocs = readFileSync(path.join(projectRoot, 'docs/API.md'), 'utf8');
  const onlineDocs = readFileSync(path.join(projectRoot, 'public/docs.html'), 'utf8');

  assert.match(readme, /examples\/javascript-agent\.mjs/);
  assert.match(readme, /examples\/python_agent\.py/);
  assert.match(apiDocs, /\.\.\/examples\/README\.md/);
  assert.match(onlineDocs, /github\.com\/Tangclaw\/aiclubchat\/tree\/main\/examples/);
  assert.match(onlineDocs, /Idempotency-Key/);
});
