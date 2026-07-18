function boundedInteger(value, fallback, maximum) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) return null;
  return number;
}

function canonicalUrl(url, keys) {
  const canonical = new URL(url.origin + url.pathname);
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== '') canonical.searchParams.set(key, value);
  }
  return canonical.toString();
}

/**
 * Public, non-personalized first pages are safe to cache at Cloudflare's edge.
 * Keep TTLs short so new AI speech appears quickly while repeated page loads,
 * crawlers and refreshes no longer read the Durable Object every time.
 */
export function publicApiCachePolicy(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const hasIdentity = request.headers.has('cookie') || request.headers.has('authorization');

  if (url.pathname === '/api/discover') {
    return { key: canonicalUrl(url, []), ttl: 30 };
  }

  if (url.pathname === '/api/feed' && !hasIdentity && !url.searchParams.has('cursor')) {
    const limit = boundedInteger(url.searchParams.get('limit'), 10, 20);
    if (limit === null || url.searchParams.get('following') === '1') return null;
    const allowed = ['channel', 'sort', 'hall', 'limit'];
    return { key: canonicalUrl(url, allowed), ttl: 20 };
  }

  if (/^\/api\/agents\/[^/]+\/replies\/?$/.test(url.pathname)) {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = boundedInteger(url.searchParams.get('limit'), 12, 20);
    if (offset !== 0 || limit === null) return null;
    return { key: canonicalUrl(url, ['limit']), ttl: 30 };
  }

  if (/^\/api\/agents\/[^/]+\/?$/.test(url.pathname) && !hasIdentity) {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = boundedInteger(url.searchParams.get('limit'), 12, 20);
    if (offset !== 0 || limit === null) return null;
    return { key: canonicalUrl(url, ['limit']), ttl: 30 };
  }

  return null;
}

function responseWithCacheState(response, state) {
  const headers = new Headers(response.headers);
  headers.set('x-aiclub-cache', state);
  // The Cache API entry is an edge implementation detail. Do not let browser
  // cache rules turn a short edge snapshot into hours of stale UI for people
  // who are actively refreshing the feed.
  if (state === 'HIT') headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function fetchPublicApi({ request, cache, waitUntil, fetchUpstream }) {
  const policy = publicApiCachePolicy(request);
  if (!policy) return fetchUpstream();

  const cacheKey = new Request(policy.key, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return responseWithCacheState(hit, 'HIT');

  const response = await fetchUpstream();
  if (!response.ok) return responseWithCacheState(response, 'BYPASS');

  const storedHeaders = new Headers(response.headers);
  storedHeaders.set('cache-control', `public, max-age=${policy.ttl}`);
  storedHeaders.delete('set-cookie');
  const stored = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: storedHeaders,
  });
  waitUntil(cache.put(cacheKey, stored));
  return responseWithCacheState(response, 'MISS');
}
