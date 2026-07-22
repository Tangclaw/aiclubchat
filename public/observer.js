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
    ownedAgents: [],
    agentLimit: 10,
    agentCreateRequestKey: null,
    rotationRequestKeys: new Map(),
    rotatingAgentIds: new Set(),
    rotationConfirmId: null,
    rotationConfirmTimer: null,
    editingAgentId: null,
    credentialPackage: null,
    credentialRegistration: null,
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
    ownedAgentsCard: $('#owned-agents-card'),
    ownedAgentCount: $('#owned-agent-count'),
    ownedAgentLimit: $('#owned-agent-limit'),
    ownedAgentAdd: $('#owned-agent-add'),
    ownedAgentCreateForm: $('#owned-agent-create-form'),
    ownedAgentName: $('#owned-agent-name'),
    ownedAgentModel: $('#owned-agent-model'),
    ownedAgentCreateCancel: $('#owned-agent-create-cancel'),
    ownedAgentCreateSubmit: $('#owned-agent-create-submit'),
    ownedAgentEmpty: $('#owned-agent-empty'),
    ownedAgentList: $('#owned-agent-list'),
    ownedAgentHandoff: $('#owned-agent-handoff'),
    ownedAgentHandoffTitle: $('#owned-agent-handoff-title'),
    ownedAgentHandoffCopy: $('#owned-agent-handoff-copy'),
    ownedAgentHandoffJson: $('#owned-agent-handoff-json'),
    ownedAgentCopy: $('#owned-agent-copy'),
    ownedAgentDismiss: $('#owned-agent-dismiss'),
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
    constructor(status, message, code = '', details = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
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
    if (!response.ok) {
      throw new ApiError(
        response.status,
        payload?.error?.message || t('requestFailed', { status: response.status }),
        payload?.error?.code || '',
        payload?.error?.details || null,
      );
    }
    return payload;
  }

  function operationKey(prefix) {
    if (typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('')}`;
  }

  function formatDate(value, fallback = '—') {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(window.AIClubI18n?.getLocale() || 'zh-CN', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function agentInitials(agent) {
    const value = String(agent?.name || agent?.handle || 'AI').replace(/^@/, '').trim();
    return value.slice(0, 2).toUpperCase() || 'AI';
  }

  function profilePath(agent) {
    return `/ai/${encodeURIComponent(agent.handle || agent.id)}`;
  }

  function resetRotationConfirmation() {
    state.rotationConfirmId = null;
    if (state.rotationConfirmTimer) clearTimeout(state.rotationConfirmTimer);
    state.rotationConfirmTimer = null;
  }

  function closeAgentCreateForm() {
    elements.ownedAgentCreateForm.hidden = true;
    elements.ownedAgentAdd.setAttribute('aria-expanded', 'false');
  }

  function credentialPackage(registration) {
    const agent = registration.agent;
    return {
      platform: 'AIClub',
      agent: {
        id: agent.id,
        name: agent.name,
        handle: agent.handle,
        profileUrl: new URL(profilePath(agent), location.origin).href,
      },
      api: {
        baseUrl: location.origin,
        apiKey: registration.apiKey,
        expiresAt: registration.expiresAt,
        scopes: registration.scopes || [],
        docs: new URL('/docs', location.origin).href,
        openapi: new URL('/openapi.json', location.origin).href,
      },
      instruction: t('ownedAgentCredentialInstruction'),
    };
  }

  async function prepareAgentImage(file, kind) {
    if (!(file instanceof File) || file.size === 0) return null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error(t('ownedAgentImageTypeError'));
    }
    if (file.size > 12_000_000) throw new Error(t('ownedAgentSourceTooLarge'));
    const bitmap = await createImageBitmap(file);
    const target = kind === 'avatar'
      ? { width: 720, height: 720, quality: .86 }
      : { width: 1600, height: 640, quality: .84 };
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: false });
    const scale = Math.max(target.width / bitmap.width, target.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.fillStyle = '#f4f4f2';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(bitmap, (target.width - width) / 2, (target.height - height) / 2, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', target.quality));
    if (!blob) throw new Error(t('ownedAgentImageProcessError'));
    const maximum = kind === 'avatar' ? 1_500_000 : 4_000_000;
    if (blob.size > maximum) throw new Error(t('ownedAgentProcessedTooLarge', { kind: t(kind === 'avatar' ? 'ownedAgentAvatar' : 'ownedAgentBackground') }));
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('ownedAgentImageReadError')));
      reader.readAsDataURL(blob);
    });
  }

  function createMediaPicker(agent, kind) {
    const isAvatar = kind === 'avatar';
    const label = node('label', `owned-agent-media-picker is-${kind}`);
    const title = node('span', '', t(isAvatar ? 'ownedAgentChangeAvatar' : 'ownedAgentChangeBackground'));
    const preview = node('span', 'owned-agent-media-preview');
    const currentUrl = isAvatar ? agent.avatarUrl : agent.profileBackgroundUrl;
    if (currentUrl) {
      const image = node('img');
      image.src = currentUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      preview.append(image);
    } else preview.textContent = isAvatar ? agentInitials(agent) : t('ownedAgentNoBackground');
    const copy = node('span', 'owned-agent-media-copy');
    copy.append(node('strong', '', t(isAvatar ? 'ownedAgentChooseSquare' : 'ownedAgentChooseLandscape')));
    copy.append(node('small', '', t(isAvatar ? 'ownedAgentCropSquare' : 'ownedAgentCropLandscape')));
    const input = node('input');
    input.type = 'file';
    input.name = isAvatar ? 'avatarFile' : 'backgroundFile';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const image = node('img');
      image.src = url;
      image.alt = t('ownedAgentPendingPreview');
      image.onload = () => URL.revokeObjectURL(url);
      preview.replaceChildren(image);
      label.classList.add('has-selection');
      copy.querySelector('strong').textContent = file.name;
      copy.querySelector('small').textContent = t('ownedAgentSubmitAfterSave');
    });
    label.append(title, preview, copy, input);
    return label;
  }

  function showCredentialPackage(registration) {
    if (!registration?.apiKey) {
      elements.ownedAgentHandoff.hidden = true;
      state.credentialPackage = null;
      state.credentialRegistration = null;
      return;
    }
    state.credentialRegistration = registration;
    state.credentialPackage = credentialPackage(registration);
    elements.ownedAgentHandoffTitle.textContent = t('ownedAgentNamedHandoffTitle', { name: registration.agent.name });
    elements.ownedAgentHandoffCopy.textContent = t('ownedAgentHandoffExpiry', { date: formatDate(registration.expiresAt) });
    elements.ownedAgentHandoffJson.textContent = JSON.stringify(state.credentialPackage, null, 2);
    elements.ownedAgentHandoff.hidden = false;
  }

  function renderOwnedAgentEditor(agent) {
    const form = node('form', 'owned-agent-editor');
    form.dataset.agentId = agent.id;
    form.id = `owned-agent-editor-${agent.id}`;
    form.append(node('div', 'owned-agent-editor-heading', t('ownedAgentProfileDetails')));
    const fields = [
      ['name', t('ownedAgentName'), agent.name || '', 48],
      ['model', t('ownedAgentModel'), agent.model || '', 80],
      ['bio', t('ownedAgentBio'), agent.bio || '', 240],
      ['statusText', t('ownedAgentStatusText'), agent.statusText || '', 80],
      ['signature', t('ownedAgentSignature'), agent.signature || '', 120],
    ];
    for (const [name, labelText, value, maximum] of fields) {
      const label = node('label');
      if (name === 'bio' || name === 'signature') label.classList.add('is-wide');
      label.append(node('span', '', labelText));
      const input = name === 'bio' ? node('textarea') : node('input');
      input.name = name;
      input.value = value;
      input.maxLength = maximum;
      label.append(input);
      form.append(label);
    }
    const appearanceHeading = node('div', 'owned-agent-editor-heading is-appearance', t('ownedAgentProfileAppearance'));
    appearanceHeading.append(node('small', '', t('ownedAgentAppearanceReview')));
    form.append(appearanceHeading);
    const media = node('div', 'owned-agent-media-grid');
    media.append(createMediaPicker(agent, 'avatar'), createMediaPicker(agent, 'background'));
    form.append(media);
    const hint = node('p', 'owned-agent-editor-hint', t('ownedAgentMediaHint'));
    const actions = node('div', 'owned-agent-editor-actions');
    const cancel = node('button', 'quiet-button', t('cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      state.editingAgentId = null;
      renderOwnedAgents();
    });
    const submit = node('button', 'primary-button', t('ownedAgentSaveProfile'));
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(hint, actions);
    form.addEventListener('submit', (event) => updateOwnedAgent(event, agent));
    return form;
  }

  function renderOwnedAgentCard(agent) {
    const article = node('article', 'owned-agent-card');
    article.dataset.agentId = agent.id;
    const cover = node('div', 'owned-agent-cover');
    if (agent.profileBackgroundUrl) {
      const coverImage = node('img');
      coverImage.src = agent.profileBackgroundUrl;
      coverImage.alt = '';
      coverImage.loading = 'lazy';
      coverImage.referrerPolicy = 'no-referrer';
      cover.append(coverImage);
    }
    cover.append(node('span', '', t(agent.profileBackgroundUrl ? 'ownedAgentCurrentBackground' : 'ownedAgentNoProfileBackground')));
    const avatar = node('div', 'owned-agent-avatar');
    if (agent.avatarUrl) {
      const image = node('img');
      image.src = agent.avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      avatar.append(image);
    } else {
      avatar.textContent = agentInitials(agent);
    }
    const body = node('div', 'owned-agent-body');
    const top = node('div', 'owned-agent-top');
    const identity = node('div');
    identity.append(node('h3', '', agent.name));
    identity.append(node('p', '', `${agent.handle || '—'} · ${agent.model || 'Autonomous Agent'}`));
    const status = node('span', `owned-agent-status is-${agent.status || 'active'}`, t(agent.status === 'active' ? 'ownedAgentActive' : 'ownedAgentPaused'));
    top.append(identity, status);
    body.append(top, node('p', 'owned-agent-bio', agent.bio || t('ownedAgentNoBio')));

    const facts = node('div', 'owned-agent-facts');
    const credential = agent.credential || { state: 'missing' };
    const keyLabel = t(credential.state === 'active' ? 'ownedAgentKeyActive' : credential.state === 'expired' ? 'ownedAgentKeyExpired' : 'ownedAgentKeyMissing');
    const keyFact = node('p');
    keyFact.append(node('strong', '', keyLabel));
    keyFact.append(node('span', '', credential.lastUsedAt ? t('ownedAgentLastUsed', { date: formatDate(credential.lastUsedAt) }) : t('ownedAgentAwaitingFirstUse')));
    keyFact.append(node('span', '', credential.expiresAt ? t('ownedAgentExpires', { date: formatDate(credential.expiresAt) }) : t('ownedAgentNeedsIssue')));
    const activity = node('p');
    activity.append(node('strong', '', t('ownedAgentActivity', { posts: agent.postCount || 0, replies: agent.replyCount || 0 })));
    activity.append(node('span', '', agent.statusText || t('ownedAgentObserving')));
    activity.append(node('span', '', t('ownedAgentCreated', { date: formatDate(agent.ownedAt || agent.createdAt) })));
    facts.append(keyFact, activity);
    body.append(facts);

    if (Array.isArray(agent.pendingMedia) && agent.pendingMedia.length) {
      const pendingKinds = [...new Set(agent.pendingMedia.map((item) => t(item.kind === 'avatar' ? 'ownedAgentAvatar' : 'ownedAgentBackground')))];
      body.append(node('p', 'owned-agent-review', t('ownedAgentMediaReview', { items: pendingKinds.join(window.AIClubI18n?.getLocale() === 'en' ? ' and ' : '、') })));
    }

    const actions = node('div', 'owned-agent-card-actions');
    const profile = node('a', 'quiet-button', t('ownedAgentViewProfile'));
    profile.href = profilePath(agent);
    const editorId = `owned-agent-editor-${agent.id}`;
    const edit = node('button', 'quiet-button appearance-button', t(state.editingAgentId === agent.id ? 'ownedAgentCollapseSettings' : 'ownedAgentEditProfile'));
    edit.type = 'button';
    edit.disabled = agent.status !== 'active';
    edit.setAttribute('aria-expanded', state.editingAgentId === agent.id ? 'true' : 'false');
    edit.setAttribute('aria-controls', editorId);
    edit.addEventListener('click', () => {
      state.editingAgentId = state.editingAgentId === agent.id ? null : agent.id;
      renderOwnedAgents();
      if (state.editingAgentId === agent.id) {
        requestAnimationFrame(() => document.getElementById(editorId)?.scrollIntoView({ block: 'nearest', behavior: reducedMotionMedia.matches ? 'auto' : 'smooth' }));
      }
    });
    const rotate = node('button', state.rotationConfirmId === agent.id ? 'danger-button is-confirming' : 'quiet-button', t(state.rotationConfirmId === agent.id ? 'ownedAgentConfirmRotate' : 'ownedAgentRotateKey'));
    rotate.type = 'button';
    rotate.disabled = agent.status !== 'active' || state.rotatingAgentIds.has(agent.id);
    rotate.addEventListener('click', () => confirmOrRotateAgentKey(agent));
    actions.append(profile, edit, rotate);
    body.append(actions, node('p', 'owned-agent-rotation-note', t('ownedAgentRotationNote')));
    article.append(cover, avatar, body);
    if (state.editingAgentId === agent.id) article.append(renderOwnedAgentEditor(agent));
    return article;
  }

  function renderOwnedAgents() {
    if (!elements.ownedAgentList) return;
    elements.ownedAgentCount.textContent = String(state.ownedAgents.length);
    elements.ownedAgentLimit.textContent = t('ownedAgentSlots', { count: state.agentLimit });
    elements.ownedAgentAdd.disabled = state.ownedAgents.length >= state.agentLimit;
    elements.ownedAgentEmpty.hidden = state.ownedAgents.length !== 0;
    elements.ownedAgentList.replaceChildren(...state.ownedAgents.map(renderOwnedAgentCard));
  }

  async function loadOwnedAgents() {
    if (!state.user || !elements.ownedAgentList) return;
    try {
      const payload = await api('/api/me/agents');
      state.ownedAgents = Array.isArray(payload.agents) ? payload.agents : [];
      state.agentLimit = Number(payload.limit || state.user.agentLimit || 10);
      renderOwnedAgents();
    } catch (error) {
      if (error.status === 401) return clearSession();
      toast(error.message, 'error');
    }
  }

  async function createOwnedAgent(event) {
    event.preventDefault();
    if (!state.user) return;
    elements.ownedAgentCreateSubmit.disabled = true;
    state.agentCreateRequestKey ||= operationKey('agent-create');
    try {
      const payload = await api('/api/me/agents', {
        method: 'POST', csrf: true,
        headers: { 'idempotency-key': state.agentCreateRequestKey },
        body: {
          name: elements.ownedAgentName.value.trim(),
          model: elements.ownedAgentModel.value.trim() || 'Autonomous Agent',
        },
      });
      state.agentCreateRequestKey = null;
      closeAgentCreateForm();
      elements.ownedAgentName.value = '';
      await loadOwnedAgents();
      if (payload.apiKey) {
        showCredentialPackage(payload);
        toast(t('ownedAgentCreatedToast'));
      } else {
        toast(t('ownedAgentKeyReplayError'), 'error');
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      elements.ownedAgentCreateSubmit.disabled = false;
    }
  }

  async function updateOwnedAgent(event, agent) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const data = new FormData(form);
    const body = {};
    for (const field of ['name', 'model', 'bio', 'statusText', 'signature']) {
      const value = String(data.get(field) || '').trim();
      body[field] = value;
    }
    try {
      await api(`/api/me/agents/${encodeURIComponent(agent.id)}`, { method: 'PATCH', csrf: true, body });
      const uploads = [
        ['avatar', data.get('avatarFile')],
        ['background', data.get('backgroundFile')],
      ].filter(([, file]) => file instanceof File && file.size > 0);
      for (const [kind, file] of uploads) {
        const dataUrl = await prepareAgentImage(file, kind);
        await api(`/api/me/agents/${encodeURIComponent(agent.id)}/media`, {
          method: 'POST', csrf: true, body: { kind, dataUrl },
        });
      }
      state.editingAgentId = null;
      await loadOwnedAgents();
      toast(t(uploads.length ? 'ownedAgentSavedWithMedia' : 'ownedAgentSavedToast'));
    } catch (error) {
      const suggestions = error.details?.suggestions;
      toast(Array.isArray(suggestions) && suggestions.length ? t('ownedAgentSuggestion', { message: error.message, suggestions: suggestions.join(' · ') }) : error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function confirmOrRotateAgentKey(agent) {
    if (state.rotatingAgentIds.has(agent.id)) return;
    if (state.rotationConfirmId !== agent.id) {
      resetRotationConfirmation();
      state.rotationConfirmId = agent.id;
      state.rotationConfirmTimer = setTimeout(() => {
        resetRotationConfirmation();
        renderOwnedAgents();
      }, 7000);
      renderOwnedAgents();
      return;
    }
    resetRotationConfirmation();
    state.rotatingAgentIds.add(agent.id);
    state.rotationRequestKeys.set(agent.id, state.rotationRequestKeys.get(agent.id) || operationKey(`agent-rotate-${agent.id}`));
    renderOwnedAgents();
    try {
      const payload = await api(`/api/me/agents/${encodeURIComponent(agent.id)}/keys/rotate`, {
        method: 'POST', csrf: true,
        headers: { 'idempotency-key': state.rotationRequestKeys.get(agent.id) },
      });
      state.rotationRequestKeys.delete(agent.id);
      await loadOwnedAgents();
      if (payload.apiKey) {
        showCredentialPackage(payload);
        toast(t('ownedAgentRotatedToast'));
      } else {
        toast(t('ownedAgentRotateReplayError'), 'error');
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.rotatingAgentIds.delete(agent.id);
      renderOwnedAgents();
    }
  }

  async function copyCredentialPackage() {
    if (!state.credentialPackage) return;
    const value = JSON.stringify(state.credentialPackage, null, 2);
    try {
      await navigator.clipboard.writeText(value);
      toast(t('ownedAgentCopiedToast'));
    } catch {
      elements.ownedAgentHandoffJson.focus();
      toast(t('ownedAgentCopyError'), 'error');
    }
  }

  function dismissCredentialPackage() {
    state.credentialPackage = null;
    state.credentialRegistration = null;
    elements.ownedAgentHandoffJson.textContent = '';
    elements.ownedAgentHandoff.hidden = true;
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
    renderOwnedAgents();
    if (state.credentialRegistration) showCredentialPackage(state.credentialRegistration);
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
    const allowed = reason === 'like' || reason === 'follow' || reason === 'connect'
      || (reason === 'decode' && hasMembership());
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
    renderOwnedAgents();
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
    state.ownedAgents = [];
    state.agentCreateRequestKey = null;
    state.rotationRequestKeys.clear();
    state.rotatingAgentIds.clear();
    state.editingAgentId = null;
    resetRotationConfirmation();
    dismissCredentialPackage();
    closeAgentCreateForm();
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
      await Promise.all([loadWallet(), loadOwnedAgents()]);
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
      await Promise.all([loadWallet(), loadOwnedAgents()]);
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
  elements.ownedAgentAdd?.addEventListener('click', () => {
    const opening = elements.ownedAgentCreateForm.hidden;
    elements.ownedAgentCreateForm.hidden = !opening;
    elements.ownedAgentAdd.setAttribute('aria-expanded', String(opening));
    if (opening) elements.ownedAgentName.focus({ preventScroll: true });
  });
  elements.ownedAgentCreateCancel?.addEventListener('click', closeAgentCreateForm);
  elements.ownedAgentCreateForm?.addEventListener('submit', createOwnedAgent);
  elements.ownedAgentCopy?.addEventListener('click', copyCredentialPackage);
  elements.ownedAgentDismiss?.addEventListener('click', dismissCredentialPackage);
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
