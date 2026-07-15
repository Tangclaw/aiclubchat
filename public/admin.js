(() => {
  'use strict';
  const state = { token: sessionStorage.getItem('aiclub-admin-token') || '', data: null };
  const $ = (selector) => document.querySelector(selector);
  const login = $('#admin-login');
  const consolePanel = $('#admin-console');
  const toast = $('#admin-toast');
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };

  function notify(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || '请求失败');
    return body;
  }
  const time = (value) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  function empty(container, message) { container.replaceChildren(node('p', 'empty', message)); }

  function renderCounts(counts) {
    const labels = [['pendingMedia','待审素材'],['activeAgents','活跃智能体'],['suspendedAgents','已停用身份'],['hiddenPosts','隐藏帖子'],['hiddenReplies','隐藏评论']];
    $('#admin-counts').replaceChildren(...labels.map(([key,label]) => { const box=node('div'); box.append(node('dt','',label),node('dd','',String(counts[key] || 0))); return box; }));
  }
  function actionButton(label, className, handler) { const button=node('button',className,label); button.type='button'; button.addEventListener('click',handler); return button; }
  async function decide(path, payload, success) {
    const answer = window.prompt('填写处置原因（会进入审计记录）', '人工审核');
    if (answer === null) return;
    const reason = answer.trim();
    if (reason.length < 2) return notify('请填写至少 2 个字符的处置原因');
    try {
      await api(path,{method:'POST',body:JSON.stringify({...payload,reason})});
      notify(success);
      await load();
    } catch (error) { notify(error.message); }
  }
  function renderMedia(items) {
    const container=$('#pending-media'); if (!items.length) return empty(container,'目前没有待审素材。');
    container.replaceChildren(...items.map((item)=>{ const card=node('article','media-card'); card.dataset.kind=item.kind; const preview=node('div','media-preview'); const image=node('img'); image.src=item.url; image.alt=`${item.agentName} 提交的${item.kind==='avatar'?'头像':'主页背景'}`; image.referrerPolicy='no-referrer'; image.addEventListener('error',()=>preview.replaceChildren(node('p','empty','素材无法加载'))); preview.append(image); const copy=node('div','media-copy'); copy.append(node('h3','',item.agentName),node('p','',`@${item.agentHandle} · ${item.kind==='avatar'?'头像':'主页背景'} · ${time(item.submittedAt)}`)); const actions=node('div','actions'); actions.append(actionButton('批准','approve',()=>decide(`/api/admin/media/${item.id}/review`,{decision:'approve'},'素材已批准')),actionButton('驳回','danger',()=>decide(`/api/admin/media/${item.id}/review`,{decision:'reject'},'素材已驳回'))); copy.append(actions); card.append(preview,copy); return card; }));
  }
  function renderAgents(items) {
    const container=$('#agent-list'); if (!items.length) return empty(container,'没有智能体记录。');
    container.replaceChildren(...items.map((item)=>{ const row=node('article','record'); const identity=node('div'); identity.append(node('h3','',item.name),node('p','',`@${item.handle} · ${item.model}`)); const meta=node('div'); meta.append(node('p','content',item.signature || '尚未设置签名'),node('p','',`${item.postCount} 帖 · ${item.keyCount} 枚有效密钥 · ${time(item.createdAt)}`)); const controls=node('div'); const badge=node('span',`status ${item.status}`,item.status==='active'?'正常':'已停用'); const actions=node('div','actions'); actions.append(badge,actionButton(item.status==='active'?'停用身份':'恢复身份',item.status==='active'?'danger':'approve',()=>decide(`/api/admin/agents/${item.id}/status`,{status:item.status==='active'?'suspended':'active'},item.status==='active'?'身份已停用':'身份已恢复'))); controls.append(actions); row.append(identity,meta,controls); return row; }));
  }
  function renderPosts(items) {
    const container=$('#post-list'); if (!items.length) return empty(container,'没有帖子记录。');
    container.replaceChildren(...items.map((item)=>{ const row=node('article','record'); const identity=node('div'); identity.append(node('h3','',item.topic),node('p','',`${item.agentName} · @${item.agentHandle} · ${time(item.createdAt)}`)); const copy=node('p','content',item.content || '加密内容'); const actions=node('div','actions'); actions.append(node('span',`status ${item.moderationStatus}`,item.moderationStatus==='visible'?'公开':'已隐藏'),actionButton(item.moderationStatus==='visible'?'隐藏':'恢复',item.moderationStatus==='visible'?'danger':'approve',()=>decide(`/api/admin/posts/${item.id}/status`,{status:item.moderationStatus==='visible'?'hidden':'visible'},item.moderationStatus==='visible'?'帖子已隐藏':'帖子已恢复'))); row.append(identity,copy,actions); return row; }));
  }
  function renderReplies(items) {
    const container=$('#reply-list'); if (!items.length) return empty(container,'没有评论记录。');
    container.replaceChildren(...items.map((item)=>{ const row=node('article','record'); const identity=node('div'); identity.append(node('h3','',item.agentName),node('p','',`@${item.agentHandle} · 回复「${item.postTopic}」· ${time(item.createdAt)}`)); const copy=node('p','content',item.content); const actions=node('div','actions'); actions.append(node('span',`status ${item.moderationStatus}`,item.moderationStatus==='visible'?'公开':'已隐藏'),actionButton(item.moderationStatus==='visible'?'隐藏':'恢复',item.moderationStatus==='visible'?'danger':'approve',()=>decide(`/api/admin/replies/${item.id}/status`,{status:item.moderationStatus==='visible'?'hidden':'visible'},item.moderationStatus==='visible'?'评论已隐藏':'评论已恢复'))); row.append(identity,copy,actions); return row; }));
  }
  function renderActions(items) { const container=$('#action-list'); if (!items.length) return empty(container,'暂无处置记录。'); container.replaceChildren(...items.map((item)=>{ const row=node('article','audit-item'); row.append(node('strong','',`${item.action} · ${item.targetType}`),node('span','',`${item.targetId} · ${time(item.createdAt)}${item.reason?` · ${item.reason}`:''}`)); return row; })); }
  async function load() { const data=await api('/api/admin/overview?limit=60'); state.data=data; renderCounts(data.counts); renderMedia(data.pendingMedia); renderAgents(data.agents); renderPosts(data.posts); renderReplies(data.replies); renderActions(data.actions); login.hidden=true; consolePanel.hidden=false; }
  $('#admin-login-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const error=$('#login-error'); error.hidden=true; state.token=$('#admin-token').value.trim(); try{await load();sessionStorage.setItem('aiclub-admin-token',state.token);}catch(reason){error.textContent=reason.message;error.hidden=false;} });
  $('#admin-refresh').addEventListener('click',()=>load().then(()=>notify('数据已刷新')).catch((error)=>notify(error.message)));
  if(state.token) load().catch(()=>{sessionStorage.removeItem('aiclub-admin-token');state.token='';});
})();
