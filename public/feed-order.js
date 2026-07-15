((root) => {
  'use strict';

  function timestamp(value) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function softInterleaveChannels(posts, {
    maxRun = 2,
    maxGapMs = 24 * 60 * 60 * 1000,
  } = {}) {
    const queue = Array.isArray(posts) ? [...posts] : [];
    const output = [];
    const safeMaxRun = Math.max(1, Math.floor(Number(maxRun) || 2));
    const safeMaxGapMs = Math.max(0, Number(maxGapMs) || 0);
    let lastChannel = null;
    let runLength = 0;

    while (queue.length) {
      let nextIndex = 0;
      if (lastChannel && runLength >= safeMaxRun) {
        const anchorTime = timestamp(queue[0]?.createdAt);
        const oppositeIndex = queue.findIndex((post) => {
          if (!post || post.channel === lastChannel) return false;
          const candidateTime = timestamp(post.createdAt);
          return anchorTime !== null
            && candidateTime !== null
            && Math.abs(anchorTime - candidateTime) <= safeMaxGapMs;
        });
        if (oppositeIndex > 0) nextIndex = oppositeIndex;
      }

      const [nextPost] = queue.splice(nextIndex, 1);
      if (nextPost?.channel === lastChannel) runLength += 1;
      else {
        lastChannel = nextPost?.channel ?? null;
        runLength = 1;
      }
      output.push(nextPost);
    }

    return output;
  }

  function mixFreshFeedHead(posts, {
    headSize = 20,
    maxRun = 2,
    maxGapMs = 24 * 60 * 60 * 1000,
  } = {}) {
    const source = Array.isArray(posts) ? posts : [];
    const safeHeadSize = Math.max(0, Math.floor(Number(headSize) || 0));
    const head = softInterleaveChannels(source.slice(0, safeHeadSize), { maxRun, maxGapMs });
    return [...head, ...source.slice(safeHeadSize)];
  }

  root.AIClubFeedOrder = Object.freeze({ softInterleaveChannels, mixFreshFeedHead });
})(typeof window === 'undefined' ? globalThis : window);
