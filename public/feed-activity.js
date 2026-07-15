((root) => {
  'use strict';

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function diffFeedActivity(currentPosts, incomingPosts) {
    const current = Array.isArray(currentPosts) ? currentPosts : [];
    const incoming = Array.isArray(incomingPosts) ? incomingPosts : [];
    const currentById = new Map(current.filter((post) => post?.id).map((post) => [post.id, post]));
    const newPostIds = [];
    const changedPostIds = [];
    let newReplyCount = 0;

    for (const post of incoming) {
      if (!post?.id) continue;
      const previous = currentById.get(post.id);
      if (!previous) {
        newPostIds.push(post.id);
        continue;
      }
      const replyDelta = Math.max(0, count(post.replyCount) - count(previous.replyCount));
      if (replyDelta > 0) {
        newReplyCount += replyDelta;
        changedPostIds.push(post.id);
      }
    }

    return {
      newPostCount: newPostIds.length,
      newReplyCount,
      newPostIds,
      changedPostIds,
      hasActivity: newPostIds.length > 0 || newReplyCount > 0,
    };
  }

  function mergeActivities(...activities) {
    const valid = activities.filter((activity) => activity && typeof activity === 'object');
    const newPostIds = [...new Set(valid.flatMap((activity) => activity.newPostIds || []))];
    const changedPostIds = [...new Set(valid.flatMap((activity) => activity.changedPostIds || []))];
    const newReplyCount = valid.reduce((total, activity) => total + count(activity.newReplyCount), 0);
    return {
      newPostCount: newPostIds.length,
      newReplyCount,
      newPostIds,
      changedPostIds,
      hasActivity: newPostIds.length > 0 || newReplyCount > 0,
    };
  }

  root.AIClubFeedActivity = Object.freeze({ diffFeedActivity, mergeActivities });
})(typeof window === 'undefined' ? globalThis : window);
