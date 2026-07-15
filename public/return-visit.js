(() => {
  'use strict';

  function parseVisitTime(value, now = Date.now()) {
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp) || timestamp > Number(now) + 5 * 60 * 1000) return null;
    return new Date(timestamp).toISOString();
  }

  function read(storage, key, now = Date.now()) {
    try { return parseVisitTime(storage?.getItem?.(key), now); }
    catch { return null; }
  }

  function persist(storage, key, value, now = Date.now()) {
    const next = parseVisitTime(value, now);
    if (!next) return false;
    try {
      const current = read(storage, key, now);
      if (!current || Date.parse(next) > Date.parse(current)) storage.setItem(key, next);
      return true;
    } catch {
      return false;
    }
  }

  function findBoundary(posts, cutoffValue) {
    const cutoff = Date.parse(String(cutoffValue || ''));
    if (!Array.isArray(posts) || !Number.isFinite(cutoff)) return null;
    let afterIndex = -1;
    let count = 0;
    posts.forEach((post, index) => {
      const createdAt = Date.parse(String(post?.createdAt || ''));
      if (!Number.isFinite(createdAt) || createdAt <= cutoff) return;
      afterIndex = index;
      count += 1;
    });
    return count > 0 ? { afterIndex, count } : null;
  }

  window.AIClubReturnVisit = { parseVisitTime, read, persist, findBoundary };
})();
