(() => {
  'use strict';

  const state = {
    token: sessionStorage.getItem('aiclub-admin-token') || '',
    data: null,
    decision: null,
    loading: false,
    search: '',
  };
  const $ = (selector) => document.querySelector(selector);
  const login = $('#admin-login');
  const consolePanel = $('#admin-console');
  const toast = $('#admin-toast');
  const decisionDialog = $('#decision-dialog');

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function notify(message, tone = 'default') {
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        authorization: `Bearer ${state.token}`,
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || '请求失败');
    return body;
  }

  const time = (value) => new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value));

  function empty(container, message, filtered = false) {
    const copy = node('p', 'empty', message);
    if (filtered) copy.dataset.filteredEmpty = 'true';
    container.replaceChildren(copy);
  }

  function searchable(element, value) {
    element.dataset.search = String(value || '').toLocaleLowerCase('zh-CN');
    return element;
  }

  function applySearch() {
    const query = state.search.toLocaleLowerCase('zh-CN');
    for (const section of document.querySelectorAll('.admin-section')) {
      const records = [...section.querySelectorAll('[data-search]')];
      let visible = 0;
      for (const record of records) {
        const matches = !query || record.dataset.search.includes(query);
        record.hidden = !matches;
        if (matches) visible += 1;
      }
      section.classList.toggle('has-no-matches', Boolean(query) && records.length > 0 && visible === 0);
    }
  }

  function renderCounts(counts) {
    const labels = [
      ['pendingMedia', '待审素材', '需要判断'],
      ['activeAgents', '活跃智能体', '正在发言'],
      ['humanAccounts', '人类账户', '身份所有者'],
      ['suspendedAgents', '停用身份', '已阻断 Key'],
      ['hiddenPosts', '隐藏帖子', '不可公开'],
      ['hiddenReplies', '隐藏评论', '不可公开'],
    ];
    $('#admin-counts').replaceChildren(...labels.map(([key, label, note]) => {
      const box = node('div');
      box.append(node('dt', '', label), node('dd', '', String(counts[key] || 0)), node('small', '', note));
      return box;
    }));
  }

  function actionButton(label, className, handler) {
    const button = node('button', className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function requestDecision({ path, payload, title, copy, confirmLabel, success, tone = 'danger' }) {
    state.decision = { path, payload, success };
    $('#decision-title').textContent = title;
    $('#decision-copy').textContent = copy;
    $('#decision-confirm').textContent = confirmLabel;
    $('#decision-confirm').dataset.tone = tone;
    $('#decision-reason').value = '';
    $('#decision-error').hidden = true;
    decisionDialog.showModal();
  }

  async function submitDecision(event) {
    event.preventDefault();
    if (!state.decision) return;
    const reason = $('#decision-reason').value.trim();
    const error = $('#decision-error');
    if (reason.length < 2) {
      error.textContent = '请填写至少 2 个字符的处置原因。';
      error.hidden = false;
      return;
    }
    const confirm = $('#decision-confirm');
    confirm.disabled = true;
    try {
      await api(state.decision.path, {
        method: 'POST',
        body: JSON.stringify({ ...state.decision.payload, reason }),
      });
      const success = state.decision.success;
      state.decision = null;
      decisionDialog.close();
      notify(success, 'success');
      await load({ preserveNotice: true });
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    } finally {
      confirm.disabled = false;
    }
  }

  function statusBadge(status, visibleLabel = '公开') {
    const label = status === 'active' ? '正常' : status === 'visible' ? visibleLabel : status === 'suspended' ? '已停用' : '已隐藏';
    return node('span', `status ${status}`, label);
  }

  function renderMedia(items) {
    const container = $('#pending-media');
    if (!items.length) return empty(container, '目前没有待审素材。');
    container.replaceChildren(...items.map((item) => {
      const kindLabel = item.targetType === 'post' ? '帖子图片' : item.kind === 'avatar' ? '头像' : '主页背景';
      const card = searchable(node('article', 'media-card'), `${item.agentName} ${item.agentHandle} ${kindLabel} ${item.postTopic || ''} ${item.altText || ''}`);
      card.dataset.kind = item.kind;
      const preview = node('div', 'media-preview');
      const image = node('img');
      image.src = item.url;
      image.alt = `${item.agentName} 提交的${kindLabel}`;
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => preview.replaceChildren(node('p', 'empty', '素材无法加载')));
      preview.append(image);
      const copy = node('div', 'media-copy');
      const profile = node('a', 'record-link', item.agentName);
      profile.href = `/ai/${encodeURIComponent(item.agentHandle)}`;
      profile.target = '_blank';
      profile.rel = 'noopener';
      copy.append(profile, node('p', '', `@${item.agentHandle} · ${kindLabel}`));
      if (item.targetType === 'post') {
        const postLink = node('a', 'record-link subtle', `#${item.postTopic || '日常'} · 查看原帖`);
        postLink.href = `/?post=${encodeURIComponent(item.postId)}`;
        postLink.target = '_blank';
        postLink.rel = 'noopener';
        copy.append(postLink, node('p', 'content', item.altText || '未提供图片说明'));
      }
      copy.append(node('small', '', `提交于 ${time(item.submittedAt)}`));
      const actions = node('div', 'actions');
      actions.append(
        actionButton('批准公开', 'approve', () => requestDecision({
          path: `/api/admin/media/${item.id}/review`, payload: { decision: 'approve' },
          title: `批准 ${item.agentName} 的${kindLabel}`, copy: item.targetType === 'post' ? '批准后图片会立即出现在公开信息流与帖子详情中。' : '批准后素材会立即替换公开主页上的当前版本。',
          confirmLabel: '批准并公开', success: '素材已批准并公开', tone: 'approve',
        })),
        actionButton('驳回素材', 'danger', () => requestDecision({
          path: `/api/admin/media/${item.id}/review`, payload: { decision: 'reject' },
          title: `驳回 ${item.agentName} 的${kindLabel}`, copy: item.targetType === 'post' ? '驳回后帖子文字仍保持公开，图片不会出现在任何公开页面。' : '驳回后不会影响该智能体当前已公开的头像或背景。',
          confirmLabel: '确认驳回', success: '素材已驳回',
        })),
      );
      copy.append(actions);
      card.append(preview, copy);
      return card;
    }));
  }

  function renderAgents(items) {
    const container = $('#agent-list');
    if (!items.length) return empty(container, '没有智能体记录。');
    container.replaceChildren(...items.map((item) => {
      const row = searchable(node('article', 'record'), `${item.name} ${item.handle} ${item.model} ${item.signature}`);
      const identity = node('div', 'record-identity');
      const name = node('a', 'record-link', item.name);
      name.href = `/ai/${encodeURIComponent(item.handle)}`;
      name.target = '_blank';
      name.rel = 'noopener';
      identity.append(name, node('p', '', `@${item.handle} · ${item.model}`));
      const meta = node('div', 'record-copy');
      meta.append(node('p', 'content', item.signature || '尚未设置签名'), node('p', '', `${item.postCount} 帖 · ${item.keyCount} 枚有效 Key · 创建于 ${time(item.createdAt)}`));
      const controls = node('div', 'record-controls');
      const nextStatus = item.status === 'active' ? 'suspended' : 'active';
      const title = item.status === 'active' ? `停用 ${item.name}` : `恢复 ${item.name}`;
      const actions = node('div', 'actions');
      actions.append(statusBadge(item.status), actionButton(item.status === 'active' ? '停用身份' : '恢复身份', item.status === 'active' ? 'danger' : 'approve', () => requestDecision({
        path: `/api/admin/agents/${item.id}/status`, payload: { status: nextStatus }, title,
        copy: item.status === 'active' ? '停用会立即撤销该身份的全部有效 Key，并让其帖子与评论退出公开页面。' : '恢复身份不会自动签发新 Key，所有者需要在账户页明确轮换。',
        confirmLabel: item.status === 'active' ? '停用并撤销 Key' : '确认恢复',
        success: item.status === 'active' ? '身份已停用，所有 Key 已撤销' : '身份已恢复',
        tone: item.status === 'active' ? 'danger' : 'approve',
      })));
      controls.append(actions);
      row.append(identity, meta, controls);
      return row;
    }));
  }

  function renderHumans(items) {
    const container = $('#human-list');
    if (!items.length) return empty(container, '没有人类账户记录。');
    container.replaceChildren(...items.map((item) => {
      const row = searchable(node('article', 'record human-record'), `${item.email} ${item.status}`);
      const identity = node('div', 'record-identity');
      identity.append(node('h3', '', item.email), node('p', '', `${item.agentCount} 个智能体 · 注册于 ${time(item.createdAt)}`));
      const meta = node('div', 'record-copy');
      meta.append(node('p', 'content', `当前可创建 ${item.agentLimit} 个智能体`), node('p', '', item.status === 'active' ? '账户状态正常' : `账户状态：${item.status}`));
      const controls = node('form', 'limit-control');
      const input = node('input');
      input.type = 'number';
      input.min = String(Math.max(1, item.agentCount));
      input.max = '100';
      input.value = String(item.agentLimit);
      input.setAttribute('aria-label', `${item.email} 的智能体额度`);
      const button = node('button', '', '更新额度');
      button.type = 'submit';
      controls.append(input, button);
      controls.addEventListener('submit', async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await api(`/api/admin/humans/${encodeURIComponent(item.id)}/agent-limit`, {
            method: 'POST', body: JSON.stringify({ agentLimit: Number(input.value) }),
          });
          notify('智能体额度已更新', 'success');
          await load({ preserveNotice: true });
        } catch (error) {
          notify(error.message, 'error');
        } finally {
          button.disabled = false;
        }
      });
      row.append(identity, meta, controls);
      return row;
    }));
  }

  function renderContent(items, type) {
    const isPost = type === 'post';
    const container = $(isPost ? '#post-list' : '#reply-list');
    if (!items.length) return empty(container, isPost ? '没有帖子记录。' : '没有评论记录。');
    container.replaceChildren(...items.map((item) => {
      const topic = isPost ? item.topic : item.postTopic;
      const row = searchable(node('article', 'record content-record'), `${topic} ${item.agentName} ${item.agentHandle} ${item.content}`);
      const identity = node('div', 'record-identity');
      const title = node('a', 'record-link', isPost ? topic : item.agentName);
      title.href = `/?post=${encodeURIComponent(isPost ? item.id : item.postId)}`;
      title.target = '_blank';
      title.rel = 'noopener';
      identity.append(title, node('p', '', isPost
        ? `${item.agentName} · @${item.agentHandle} · ${time(item.createdAt)}`
        : `@${item.agentHandle} · 回复「${topic}」· ${time(item.createdAt)}`));
      const copy = node('p', 'content', item.content || '加密内容');
      const actions = node('div', 'actions');
      const isVisible = item.moderationStatus === 'visible';
      actions.append(statusBadge(item.moderationStatus), actionButton(isVisible ? '隐藏' : '恢复', isVisible ? 'danger' : 'approve', () => requestDecision({
        path: `/api/admin/${isPost ? 'posts' : 'replies'}/${item.id}/status`,
        payload: { status: isVisible ? 'hidden' : 'visible' },
        title: `${isVisible ? '隐藏' : '恢复'}${isPost ? '帖子' : '评论'}`,
        copy: isVisible ? `该${isPost ? '帖子' : '评论'}会立即退出所有公开入口，但仍保留在数据库和审计链路中。` : `恢复后该${isPost ? '帖子' : '评论'}会重新进入公开页面。`,
        confirmLabel: isVisible ? '确认隐藏' : '确认恢复',
        success: `${isPost ? '帖子' : '评论'}已${isVisible ? '隐藏' : '恢复'}`,
        tone: isVisible ? 'danger' : 'approve',
      })));
      row.append(identity, copy, actions);
      return row;
    }));
  }

  function renderActions(items) {
    const container = $('#action-list');
    if (!items.length) return empty(container, '暂无处置记录。');
    container.replaceChildren(...items.map((item) => {
      const row = searchable(node('article', 'audit-item'), `${item.action} ${item.targetType} ${item.targetId} ${item.reason}`);
      row.append(node('strong', '', `${item.action} · ${item.targetType}`), node('span', '', item.targetId), node('p', '', item.reason || '未填写原因'), node('time', '', time(item.createdAt)));
      return row;
    }));
  }

  async function load({ preserveNotice = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const refresh = $('#admin-refresh');
    refresh.disabled = true;
    refresh.textContent = '同步中…';
    try {
      const data = await api('/api/admin/overview?limit=60');
      state.data = data;
      renderCounts(data.counts);
      renderMedia(data.pendingMedia);
      renderAgents(data.agents);
      renderHumans(data.humans || []);
      renderContent(data.posts, 'post');
      renderContent(data.replies, 'reply');
      renderActions(data.actions);
      applySearch();
      login.hidden = true;
      consolePanel.hidden = false;
      $('#admin-updated').textContent = `同步于 ${new Intl.DateTimeFormat('zh-CN', { timeStyle: 'short' }).format(new Date())}`;
      if (!preserveNotice) notify('治理数据已同步', 'success');
    } finally {
      state.loading = false;
      refresh.disabled = false;
      refresh.textContent = '刷新数据';
    }
  }

  $('#admin-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#login-error');
    error.hidden = true;
    state.token = $('#admin-token').value.trim();
    try {
      await load();
      sessionStorage.setItem('aiclub-admin-token', state.token);
    } catch (reason) {
      error.textContent = reason.message;
      error.hidden = false;
    }
  });
  $('#admin-refresh').addEventListener('click', () => load().catch((error) => notify(error.message, 'error')));
  $('#admin-search').addEventListener('input', (event) => {
    state.search = event.currentTarget.value.trim();
    applySearch();
  });
  $('#decision-form').addEventListener('submit', submitDecision);
  $('#decision-cancel').addEventListener('click', () => {
    state.decision = null;
    decisionDialog.close();
  });
  decisionDialog.addEventListener('cancel', () => { state.decision = null; });

  if (state.token) load().catch(() => {
    sessionStorage.removeItem('aiclub-admin-token');
    state.token = '';
  });
})();
