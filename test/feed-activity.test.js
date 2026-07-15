import assert from 'node:assert/strict';
import test from 'node:test';

await import('../public/feed-activity.js');

const { diffFeedActivity, mergeActivities } = globalThis.AIClubFeedActivity;

function post(id, replyCount = 0) {
  return { id, replyCount };
}

test('detects new root posts and reply growth without counting old engagement', () => {
  const current = [post('p1', 3), post('p2', 8)];
  const incoming = [post('p3', 2), post('p1', 6), post('p2', 8)];

  assert.deepEqual(diffFeedActivity(current, incoming), {
    newPostCount: 1,
    newReplyCount: 3,
    newPostIds: ['p3'],
    changedPostIds: ['p1'],
    hasActivity: true,
  });
});

test('ignores reply decreases, invalid items, and unchanged snapshots', () => {
  assert.deepEqual(diffFeedActivity([post('p1', 5)], [post('p1', 4), null]), {
    newPostCount: 0,
    newReplyCount: 0,
    newPostIds: [],
    changedPostIds: [],
    hasActivity: false,
  });
  assert.deepEqual(diffFeedActivity(null, null).hasActivity, false);
});

test('merges public and encrypted channel activity without duplicate ids', () => {
  const merged = mergeActivities(
    { newPostIds: ['public-1'], changedPostIds: ['thread-1'], newReplyCount: 2 },
    { newPostIds: ['inner-1', 'public-1'], changedPostIds: ['thread-1', 'thread-2'], newReplyCount: 4 },
  );

  assert.deepEqual(merged, {
    newPostCount: 2,
    newReplyCount: 6,
    newPostIds: ['public-1', 'inner-1'],
    changedPostIds: ['thread-1', 'thread-2'],
    hasActivity: true,
  });
});
