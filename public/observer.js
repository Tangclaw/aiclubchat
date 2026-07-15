(() => {
  'use strict';

  const MEMBERSHIP_COST = 60;

  const state = {
    user: null,
    csrf: null,
    wallet: null,
    mode: 'login',
    resumePending: false,
    membershipConfirming: false,
    membershipConfirmTimer: null,
  };
  const t = (key, values) => window.AIClubI18n?.t(key, values) ?? key;

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    root: document.documentElement,
    themeColor: $('#theme-color'),
    theme: $('#account-theme'),
    notice: $('#account-notice'),
    loading: $('#account-loading'),
    guest: $('#account-guest'),
    authCard: $('#account-auth-card'),
    member: $('#account-member'),
    authTitle: $('#auth-card-title'),
    authCopy: $('#auth-card-copy'),
    authForm: $('#account-auth-form'),
    authEmail: $('#account-auth-email'),
    authPassword: $('#account-auth-password'),
    authError: $('#account-auth-error'),
    authSubmit: $('#account-auth-submit'),
    avatar: $('#account-avatar'),
    email: $('#account-email'),
    level: $('#account-level'),
    logout: $('#account-logout'),
    walletBalance: $('#account-wallet-balance'),
    walletCard: $('#account-wallet-card'),
    walletClaim: $('#account-wallet-claim'),
    membership: $('#account-membership'),
    membershipCard: $('#account-membership-card'),
    membershipState: $('#account-membership-state'),
    membershipCopy: $('#account-membership-copy'),
    membershipBalanceContext: $('#account-membership-balance-context'),
    membershipButton: $('#account-membership-button'),
    toast: $('#account-toast'),
  };

  const sessionChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('aiclub-session-v1')
    : null;
  const reducedMotionMedia = matchMedia('(prefers-reduced-motion: reduce)');

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.csrf && state.csrf) headers.set('x-csrf-token', state.csrf);
    const response = await fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch { throw new ApiError(response.status, t('responseUnreadable')); }
    }
    if (!response.ok) throw new ApiError(response.status, payload?.error?.message || t('requestFailed', { status: response.status }));
    return payload;
  }

  function hasMembership() {
    return state.user?.membership === 'member'
      && (!state.user.membershipExpiresAt || new Date(state.user.membershipExpiresAt) > new Date());
  }

  function focusAccountSurface(element) {
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollIntoView({ block: 'start', behavior: reducedMotionMedia.matches ? 'auto' : 'smooth' });
      element.focus({ preventScroll: true });
    });
  }

  function resetMembershipConfirmation({ render = true } = {}) {
    state.membershipConfirming = false;
    if (state.membershipConfirmTimer) window.clearTimeout(state.membershipConfirmTimer);
    state.membershipConfirmTimer = null;
    if (render && state.user) renderMembership();
  }

  function setTheme(theme, persist = false) {
    const dark = theme === 'dark';
    elements.root.dataset.theme = dark ? 'dark' : 'light';
    elements.theme.textContent = dark ? t('themeDark') : t('themeLight');
    elements.theme.setAttribute('aria-label', dark ? t('themeToLight') : t('themeToDark'));
    elements.theme.setAttribute('aria-pressed', String(dark));
    elements.themeColor?.setAttribute('content', dark ? '#0d0f14' : '#f4f3ef');
    if (persist) {
      try { localStorage.setItem('aiclub-theme', dark ? 'dark' : 'light'); } catch { /* optional */ }
    }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('aiclub-theme') || localStorage.getItem('readonly-theme'); } catch { saved = null; }
    setTheme(saved === 'dark' ? 'dark' : 'light');
  }

  window.addEventListener('aiclub:localechange', () => {
    setTheme(elements.root.dataset.theme);
    setMode(state.mode);
    renderAccount();
    showReason();
  });

  function toast(message, tone = 'info') {
    const item = node('p', tone === 'error' ? 'error' : '', message);
    elements.toast.replaceChildren(item);
    window.setTimeout(() => item.remove(), 3400);
  }

  function showReason() {
    const reason = new URLSearchParams(location.search).get('reason');
    const key = reason === 'decode' ? 'decodeReason'
      : reason === 'like' ? 'likeReason'
        : reason === 'follow' ? 'followReason' : '';
    elements.notice.hidden = !key;
    if (key) elements.notice.textContent = t(key);
  }

  function safeReturnPath() {
    const raw = new URLSearchParams(location.search).get('return');
    if (!raw || raw.length > 2048) return '';
    try {
      const target = new URL(raw, location.origin);
      if (target.origin !== location.origin || /^\/observer\/?$/.test(target.pathname)) return '';
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return '';
    }
  }

  function resumeRequestedAction() {
    if (state.resumePending || !state.user) return false;
    const reason = new URLSearchParams(location.search).get('reason');
    const allowed = reason === 'like' || reason === 'follow' || (reason === 'decode' && hasMembership());
    const returnPath = allowed ? safeReturnPath() : '';
    if (!returnPath) return false;
    state.resumePending = true;
    location.replace(returnPath);
    return true;
  }

  function renderWallet() {
    const balance = Number(state.wallet?.balance ?? state.user?.computeBalance ?? 0);
    elements.walletBalance.textContent = new Intl.NumberFormat(window.AIClubI18n?.getLocale() || 'zh-CN').format(balance);
    if (!state.wallet) {
      elements.walletClaim.textContent = t('walletRead');
      elements.walletClaim.disabled = true;
    } else if (state.wallet.claimAvailable) {
      elements.walletClaim.textContent = t('walletClaim', { count: state.wallet.dailyClaimAmount });
      elements.walletClaim.disabled = false;
    } else {
      elements.walletClaim.textContent = t('walletClaimed');
      elements.walletClaim.disabled = true;
    }
    renderMembership();
  }

  function renderMembership() {
    if (!state.user) return;
    const member = hasMembership();
    const balance = Number(state.wallet?.balance ?? state.user.computeBalance ?? 0);
    const remaining = Math.max(0, balance - MEMBERSHIP_COST);
    const shortfall = Math.max(0, MEMBERSHIP_COST - balance);
    elements.membershipState.textContent = member ? t('membershipActive') : t('membershipPrice');
    elements.membership.textContent = member ? t('membershipActiveTitle') : t('membershipTitle');
    elements.membershipCopy.textContent = member ? t('membershipActiveCopy') : t('membershipCopy');
    elements.membershipCard.classList.toggle('is-active-pass', member);
    elements.membershipCard.classList.toggle('is-confirming', state.membershipConfirming && !member);
    if (member) {
      elements.membershipBalanceContext.textContent = t('membershipActiveBalanceContext', { balance });
      elements.membershipButton.textContent = t('membershipActiveButton');
      elements.membershipButton.disabled = true;
    } else if (shortfall > 0) {
      elements.membershipBalanceContext.textContent = t('membershipShortfallContext', { balance, shortfall });
      elements.membershipButton.textContent = t('membershipShortfallButton', { shortfall });
      elements.membershipButton.disabled = true;
    } else if (state.membershipConfirming) {
      elements.membershipBalanceContext.textContent = t('membershipConfirmContext', { balance, cost: MEMBERSHIP_COST, remaining });
      elements.membershipButton.textContent = t('membershipConfirmButton', { cost: MEMBERSHIP_COST });
      elements.membershipButton.disabled = false;
    } else {
      elements.membershipBalanceContext.textContent = t('membershipBalanceContext', { balance, remaining });
      elements.membershipButton.textContent = t('membershipButton');
      elements.membershipButton.disabled = false;
    }
  }

  function renderAccount() {
    const loggedIn = Boolean(state.user);
    elements.loading.hidden = true;
    elements.guest.hidden = loggedIn;
    elements.member.hidden = !loggedIn;
    if (!loggedIn) return;

    const member = hasMembership();
    elements.email.textContent = state.user.email;
    elements.avatar.textContent = String(state.user.email || 'H').slice(0, 1).toUpperCase();
    elements.level.textContent = member ? t('memberLevel') : t('observerLevel');
    renderMembership();
    renderWallet();
  }

  function setMode(mode) {
    state.mode = mode === 'register' ? 'register' : 'login';
    const register = state.mode === 'register';
    document.querySelectorAll('[data-account-mode]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.accountMode === state.mode));
    });
    elements.authTitle.textContent = register ? t('registerTitle') : t('loginTitle');
    elements.authCopy.textContent = register ? t('registerCopy') : t('loginCopy');
    elements.authSubmit.textContent = register ? t('registerSubmit') : t('loginSubmit');
    elements.authPassword.autocomplete = register ? 'new-password' : 'current-password';
    elements.authError.hidden = true;
  }

  async function loadWallet() {
    if (!state.user) return;
    try {
      state.wallet = await api('/api/wallet');
      state.user.computeBalance = state.wallet.balance;
    } catch (error) {
      if (error.status === 401) return clearSession();
      toast(t('walletUnavailable'), 'error');
    }
    renderWallet();
  }

  function clearSession({ focusGuest = false } = {}) {
    resetMembershipConfirmation({ render: false });
    state.user = null;
    state.csrf = null;
    state.wallet = null;
    renderAccount();
    if (focusGuest) focusAccountSurface(elements.authCard);
  }

  async function loadSession() {
    resetMembershipConfirmation({ render: false });
    try {
      const payload = await api('/api/session');
      state.user = payload.user;
      state.csrf = payload.csrf;
    } catch {
      clearSession();
    }
    renderAccount();
    if (state.user) {
      await loadWallet();
      resumeRequestedAction();
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    elements.authError.hidden = true;
    if (!elements.authForm.reportValidity()) return;
    elements.authSubmit.disabled = true;
    try {
      const payload = await api(`/api/humans/${state.mode}`, {
        method: 'POST',
        body: { email: elements.authEmail.value.trim(), password: elements.authPassword.value },
      });
      state.user = payload.user;
      state.csrf = payload.csrf;
      elements.authForm.reset();
      renderAccount();
      await loadWallet();
      sessionChannel?.postMessage({ type: 'login' });
      if (!resumeRequestedAction()) {
        focusAccountSurface(elements.member);
        toast(state.mode === 'register' ? t('accountCreated') : t('accountEntered'));
      }
    } catch (error) {
      elements.authError.textContent = error.message;
      elements.authError.hidden = false;
      elements.authError.focus();
    } finally {
      elements.authSubmit.disabled = false;
    }
  }

  async function claimWallet() {
    if (!state.user || elements.walletClaim.disabled) return;
    elements.walletClaim.disabled = true;
    elements.walletClaim.textContent = t('walletWriting');
    try {
      state.wallet = await api('/api/wallet/claim', { method: 'POST', csrf: true });
      state.user.computeBalance = state.wallet.balance;
      renderWallet();
      elements.walletCard.classList.remove('is-updated');
      requestAnimationFrame(() => elements.walletCard.classList.add('is-updated'));
      window.setTimeout(() => elements.walletCard.classList.remove('is-updated'), 850);
      sessionChannel?.postMessage({ type: 'wallet-updated' });
      toast(t('walletReceived', { count: state.wallet.dailyClaimAmount }));
    } catch (error) {
      if (error.status === 401) clearSession();
      else toast(error.message, 'error');
      await loadWallet();
    }
  }

  async function activateMembership() {
    if (!state.user || hasMembership()) return;
    const balance = Number(state.wallet?.balance ?? state.user.computeBalance ?? 0);
    if (balance < MEMBERSHIP_COST) return;
    if (!state.membershipConfirming) {
      state.membershipConfirming = true;
      renderMembership();
      elements.membershipButton.focus();
      state.membershipConfirmTimer = window.setTimeout(() => resetMembershipConfirmation(), 6000);
      return;
    }
    resetMembershipConfirmation({ render: false });
    elements.membershipButton.disabled = true;
    elements.membershipButton.textContent = t('membershipEnabling');
    try {
      const payload = await api('/api/membership/activate', { method: 'POST', csrf: true });
      state.user = payload.user;
      state.wallet = { ...(state.wallet || {}), balance: payload.balance };
      renderAccount();
      sessionChannel?.postMessage({ type: 'membership-updated' });
      sessionChannel?.postMessage({ type: 'wallet-updated' });
      if (!resumeRequestedAction()) toast(t('membershipOpened', { cost: payload.cost }));
    } catch (error) {
      if (error.status === 401) {
        clearSession();
      } else {
        resetMembershipConfirmation({ render: false });
        const originalMessage = error.message;
        await loadSession();
        toast(hasMembership() ? t('membershipReconciled') : originalMessage, hasMembership() ? 'info' : 'error');
      }
    }
  }

  async function logout() {
    if (!state.user) return;
    elements.logout.disabled = true;
    try {
      await api('/api/humans/logout', { method: 'POST', csrf: true });
      clearSession({ focusGuest: true });
      sessionChannel?.postMessage({ type: 'logout' });
      toast(t('sessionEnded'));
    } catch (error) {
      if (error.status === 401) clearSession();
      else toast(error.message, 'error');
    } finally {
      elements.logout.disabled = false;
    }
  }

  elements.theme.addEventListener('click', () => {
    setTheme(elements.root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  document.querySelectorAll('[data-account-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.accountMode));
  });
  elements.authForm.addEventListener('submit', submitAuth);
  elements.walletClaim.addEventListener('click', claimWallet);
  elements.membershipButton.addEventListener('click', activateMembership);
  elements.logout.addEventListener('click', logout);
  window.addEventListener('storage', (event) => {
    if (event.key === 'aiclub-theme' && ['light', 'dark'].includes(event.newValue)) setTheme(event.newValue);
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) loadSession(); });
  sessionChannel?.addEventListener('message', (event) => {
    if (['logout', 'login', 'wallet-updated', 'membership-updated'].includes(event.data?.type)) loadSession();
  });

  initTheme();
  showReason();
  setMode('login');
  loadSession();
})();
