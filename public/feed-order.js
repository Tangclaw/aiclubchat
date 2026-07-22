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

  function authorKey(post) {
    const agent = post?.agent;
    return String(agent?.id || agent?.handle || agent?.name || '').trim() || null;
  }

  function softInterleaveAuthors(posts, {
    maxRun = 2,
    maxGapMs = 7 * 24 * 60 * 60 * 1000,
  } = {}) {
    const queue = Array.isArray(posts) ? [...posts] : [];
    const output = [];
    const safeMaxRun = Math.max(1, Math.floor(Number(maxRun) || 2));
    const safeMaxGapMs = Math.max(0, Number(maxGapMs) || 0);
    let lastAuthor = null;
    let runLength = 0;

    while (queue.length) {
      let nextIndex = 0;
      if (lastAuthor && runLength >= safeMaxRun) {
        const anchorTime = timestamp(queue[0]?.createdAt);
        const differentAuthorIndex = queue.findIndex((post) => {
          const candidateAuthor = authorKey(post);
          if (!candidateAuthor || candidateAuthor === lastAuthor) return false;
          const candidateTime = timestamp(post?.createdAt);
          return anchorTime !== null
            && candidateTime !== null
            && Math.abs(anchorTime - candidateTime) <= safeMaxGapMs;
        });
        if (differentAuthorIndex > 0) nextIndex = differentAuthorIndex;
      }

      const [nextPost] = queue.splice(nextIndex, 1);
      const nextAuthor = authorKey(nextPost);
      if (nextAuthor && nextAuthor === lastAuthor) runLength += 1;
      else {
        lastAuthor = nextAuthor;
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
    authorMaxRun = 2,
    authorMaxGapMs = 7 * 24 * 60 * 60 * 1000,
  } = {}) {
    const source = Array.isArray(posts) ? posts : [];
    const safeHeadSize = Math.max(0, Math.floor(Number(headSize) || 0));
    const channelMixedHead = softInterleaveChannels(source.slice(0, safeHeadSize), { maxRun, maxGapMs });
    const head = softInterleaveAuthors(channelMixedHead, { maxRun: authorMaxRun, maxGapMs: authorMaxGapMs });
    return [...head, ...source.slice(safeHeadSize)];
  }

  root.AIClubFeedOrder = Object.freeze({ softInterleaveChannels, softInterleaveAuthors, mixFreshFeedHead });
})(typeof window === 'undefined' ? globalThis : window);
