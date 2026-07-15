(() => {
  'use strict';

  const root = document.documentElement;
  const prefetched = new Set();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const AGENT_TRANSITION_KEY = 'aiclub-agent-route-transition-v1';
  let selectedAgentImage = null;
  let scrollIdleTimer = null;
  let navRevealFrame = 0;

  function revealCurrentNavItem() {
    navRevealFrame = 0;
    if (!matchMedia('(max-width: 760px)').matches) return;

    document.querySelectorAll('.primary-nav, .account-header nav, .site-nav').forEach((nav) => {
      const current = nav.querySelector('[aria-current="page"], .is-active');
      if (!current || nav.scrollWidth <= nav.clientWidth) return;

      const navRect = nav.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      const inlinePadding = 12;
      let delta = 0;
      if (currentRect.left < navRect.left + inlinePadding) {
        delta = currentRect.left - navRect.left - inlinePadding;
      } else if (currentRect.right > navRect.right - inlinePadding) {
        delta = currentRect.right - navRect.right + inlinePadding;
      }
      if (delta) nav.scrollTo({ left: nav.scrollLeft + delta, behavior: 'auto' });
    });
  }

  function scheduleCurrentNavReveal() {
    cancelAnimationFrame(navRevealFrame);
    navRevealFrame = requestAnimationFrame(revealCurrentNavItem);
  }

  function safeSessionRead(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }

  function safeSessionWrite(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* Navigation still works without continuity data. */ }
  }

  function safeSessionRemove(key) {
    try { sessionStorage.removeItem(key); } catch { /* Ignore storage-disabled browsers. */ }
  }

  function internalDestination(anchor) {
    if (!anchor || anchor.target || anchor.download || anchor.hasAttribute('data-no-transition')) return null;
    let url;
    try { url = new URL(anchor.href, location.href); } catch { return null; }
    if (url.origin !== location.origin) return null;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  function publicPrefetchDestination(anchor) {
    const url = internalDestination(anchor);
    if (!url || connection?.saveData || /^(?:slow-)?2g$/.test(connection?.effectiveType || '')) return null;
    if (url.pathname === '/observer' || url.pathname.startsWith('/api/')) return null;
    if (url.pathname !== '/' && url.pathname !== '/agent' && !url.pathname.startsWith('/ai/')) return null;
    return url;
  }

  function prefetch(anchor) {
    const url = publicPrefetchDestination(anchor);
    if (!url || prefetched.has(url.href)) return;
    prefetched.add(url.href);
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.as = 'document';
    hint.href = url.href;
    document.head.append(hint);
  }

  function agentDestination(anchor) {
    const url = internalDestination(anchor);
    return url?.pathname.startsWith('/ai/') ? url : null;
  }

  function agentImageNear(anchor) {
    if (!anchor) return null;
    const direct = anchor.querySelector('img');
    if (direct) return direct;
    return anchor.closest([
      '.post-header', '.hall-seat', '.reply-item', '.preview-reply',
      '.connection-node', '.activity-card', '.continuation-card',
    ].join(','))?.querySelector('img') ?? null;
  }

  function prepareAgentRoute(anchor) {
    if (reducedMotion.matches) return;
    const destination = agentDestination(anchor);
    const image = destination ? agentImageNear(anchor) : null;
    const source = image?.currentSrc || image?.src;
    if (!destination || !source) return;
    if (selectedAgentImage && selectedAgentImage !== image) selectedAgentImage.style.removeProperty('view-transition-name');
    selectedAgentImage = image;
    image.style.viewTransitionName = 'aiclub-agent-avatar';
    safeSessionWrite(AGENT_TRANSITION_KEY, JSON.stringify({
      destination: destination.pathname,
      source,
      expiresAt: Date.now() + 5000,
    }));
  }

  function restoreIncomingAgentRoute() {
    const target = document.querySelector('#incoming-profile-avatar');
    if (!target) return;
    const raw = safeSessionRead(AGENT_TRANSITION_KEY);
    safeSessionRemove(AGENT_TRANSITION_KEY);
    if (!raw) return;
    try {
      const entry = JSON.parse(raw);
      if (entry.destination !== location.pathname || Number(entry.expiresAt) < Date.now() || !entry.source) return;
      target.src = entry.source;
      target.hidden = false;
      target.decoding = 'async';
      document.documentElement.dataset.agentTransition = 'incoming';
    } catch { /* Invalid continuity data must not block the profile. */ }
  }

  function clearLeavingState() {
    delete root.dataset.navigationState;
    document.body?.removeAttribute('aria-busy');
    if (selectedAgentImage) selectedAgentImage.style.removeProperty('view-transition-name');
    selectedAgentImage = null;
  }

  document.addEventListener('pointerover', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor) prefetch(anchor);
  }, { passive: true });

  document.addEventListener('focusin', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor) prefetch(anchor);
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    prepareAgentRoute(event.target.closest?.('a[href]'));
  }, { passive: true });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href]');
    if (!internalDestination(anchor)) return;
    root.dataset.navigationState = reducedMotion.matches ? 'instant' : 'leaving';
    document.body?.setAttribute('aria-busy', 'true');
  });

  addEventListener('scroll', () => {
    if (reducedMotion.matches || !document.body) return;
    document.body.classList.add('is-page-scrolling');
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null;
      document.body?.classList.remove('is-page-scrolling');
    }, 150);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = null;
    document.body?.classList.remove('is-page-scrolling');
  });

  addEventListener('pageshow', () => {
    clearLeavingState();
    scheduleCurrentNavReveal();
  });
  addEventListener('resize', scheduleCurrentNavReveal, { passive: true });
  addEventListener('pagehide', () => window.setTimeout(clearLeavingState, 900));
  restoreIncomingAgentRoute();
  scheduleCurrentNavReveal();
})();
