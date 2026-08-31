/* mdqp v4.0 前端 — 路由 / 身份 / 剪贴板 CRUD / 评论 / 邀请 / VIP / 公告 / 功能开关 / 管理后台
 * v4.0 新增：限额(日/月/周) + 字数限制(CJK=1 英文=0.5) + 功能开关 + VIP + 邀请系统 +
 *       评论(@mention 50字/条) + 登录门禁 + 唯一读者追踪 + 短链修改 + 公告置顶 + 管理员权限颜色梯度
 */

// 更新日志：随代码发布自动同步
const CHANGELOG_MD = `# 📝 更新日志

mdqp 的主要版本变动记录。当前部署版本 **v4.0**。

---

## v4.0 · 2026-08-28
- 🎫 **VIP 系统**：管理员可授予用户 VIP 身份（金色标识），开通时提示加站长微信
- 🎁 **邀请系统**：每位用户专属邀请码+链接，tier 奖励（1人→全功能 / 3人→VIP / 5人→不限字数+置顶 / 10人→开发者大礼包）
- 💬 **评论系统**：登录用户可评论剪贴板（支持 Markdown + @mention），每条 50 等效字
- 🔐 **登录门禁**：作者可设置「仅登录用户可查看」，未登录显示登录引导
- 👥 **唯一读者限制**：按独立访客计算（非浏览次数），游客用设备指纹识别
- ⚙️ **功能开关**：管理员可单独为每个用户开启/关闭高级功能（自定义短链、密码保护等）
- 📊 **限额升级**：登录用户日限 5 / 月限 50；游客周限 5；每板字数限 300（CJK 全算、英文标点折半；VIP 豁免不限字数）
- 📢 **公告系统**：管理员可在首页置顶公告
- ✏️ **短链修改**：有权限的用户可修改已发布剪贴板的短链
- 🛡 **管理员权限颜色梯度**：蓝→绿→橙→红→紫（按权限从低到高），开发者/最高权限为紫色
- 📝 编辑器增强：实时等效字数统计（区分中英文）、@mention 自动补全

## v3.8 · 2026-08-28
- 📝 **更新日志页正式上线**：内容随代码发布自动同步，不再依赖后台手动维护
- ✨ 页面切换动画增强：淡入 + 轻微上移，过渡更顺滑
- 🎴 版本条目改为带左侧色条的「发布卡片」样式

## v3.7 · 2026-08-28
- 🖼 12 处空状态加入手绘风 SVG 插画
- 💡 列表加载使用 shimmer 骨架屏
- 🎨 配色层级微调：主色靛蓝、导航高亮渐变光晕、三级圆角与柔和阴影

## v3.6 · 2026-08-28
- ⌨️ 新增 **⌘K / Ctrl+K 命令面板**
- 🔎 模糊搜索 + ↑↓ 选择 + Enter 执行 + Esc 关闭

## v3.5 · 2026-08-28
- 🧱 全新「侧边栏 + 主栏」布局（shadcn-admin 设计语言）
- 🎨 neutral 调色板、统一圆角与聚焦环
- 📱 移动端抽屉式导航

## v3.4 · 2026-08-26
- ✍️ 个人签名 + bio 从 cpoauth 同步
- 🛡 管理员细粒度权限 + 密码门修复

## v3.3 ~ v3.0
- highlight.js 按需加载、Cache-Control、站点页面、用户管理、Cloudflare Workers + D1 全栈重写`;

// ==================== 基础工具 ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// 空状态 SVG 插画
const emptyHTML = (type, msg, cta) => {
  const svgs = {
    clips: `<svg viewBox="0 0 140 110" fill="none" class="empty-svg"><rect x="20" y="18" width="100" height="74" rx="10" stroke="currentColor" stroke-width="2" opacity=".2"/><path d="M35 38h70M35 55h50M35 72h36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".15"/><circle cx="98" cy="68" r="18" fill="currentColor" opacity=".06"/><path d="M92 68 L96 72 L105 61" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".25"/></svg>`,
    search: `<svg viewBox="0 0 130 100" fill="none" class="empty-svg"><circle cx="52" cy="48" r="28" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M73 69L95 91" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".15"/></svg>`,
    me: `<svg viewBox="0 0 130 110" fill="none" class="empty-svg"><circle cx="65" cy="42" r="26" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M30 95c0-20 16-34 35-34s35 14 35 34" stroke="currentColor" stroke-width="2.5" opacity=".12"/></svg>`,
    gate: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><rect x="28" y="16" width="64" height="68" rx="8" stroke="currentColor" stroke-width="2.5" opacity=".2"/><circle cx="60" cy="50" r="16" stroke="currentColor" stroke-width="2" opacity=".15"/><path d="M53 50 L57 54 L67 44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".2"/></svg>`,
    admin: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><path d="M60 14L90 28v28c0 22-13 38-30 46-17-8-30-24-30-46V28l30-14z" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M52 50l6 6 14-14" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".2"/></svg>`,
    comments: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><path d="M20 24h80a8 8 0 018 8v40a8 8 0 01-8 8H60L40 96V80H20a8 8 0 01-8-8V32a8 8 0 018-8z" stroke="currentColor" stroke-width="2" opacity=".2"/><path d="M36 44h48M36 56h32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".15"/></svg>`
  };
  const svg = svgs[type] || svgs.clips;
  const ctaHTML = cta ? `<div>${cta}</div>` : '';
  return `<div class="empty-illo"><div class="empty-art">${svg}</div><h3>${msg}</h3>${ctaHTML}</div>`;
};

const state = { me: null, page: 1, q: '', editing: null, editingPage: null, adminTab: 'users' };

const PLATFORM_NAMES = { luogu: '洛谷', codeforces: 'Codeforces', atcoder: 'AtCoder', github: 'GitHub', google: 'Google', clist: 'Clist' };

function isAdmin() { return state.me?.type === 'user' && (state.me.role === 'admin' || state.me.role === 'developer'); }
/** v4.0: 有效 VIP（is_vip 且 vip_until 未过期）——VIP 豁免字数限制 */
function isVip() {
  const me = state.me;
  if (!me || me.type !== 'user' || !me.is_vip) return false;
  if (!me.vip_until) return true;
  const t = new Date(String(me.vip_until).replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(t) ? t > Date.now() : true;
}

/** v4.0: 角色徽章（含 VIP 金色 + 管理员权限颜色梯度） */
function roleBadge(role, opts = {}) {
  if (role === 'developer') return '<span class="badge badge-role badge-dev">🛠 开发者</span>';
  if (role === 'admin') {
    // 管理员权限等级由调用方传入 permLevel (1-5)，对应 蓝<绿<橙<红<紫
    const lvl = opts.permLevel || 1;
    return `<span class="badge badge-role badge-admin badge-admin-lvl${lvl}">🛡 管理员</span>`;
  }
  // VIP 金色徽章
  if (opts.is_vip) return '<span class="badge badge-role badge-vip">⭐ VIP</span>';
  return '';
}

function toast(msg, type = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = 'toast'), 2600);
}

function guestId() {
  let g = localStorage.getItem('mdqp_guest');
  if (!g) { g = (crypto.randomUUID ? crypto.randomUUID() : 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, ''); localStorage.setItem('mdqp_guest', g); }
  return g;
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Guest-Id': guestId() }, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  let data = null; try { data = await res.json(); } catch { /* 非 JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/** 全局数学块占位符计数器（避免嵌套调用冲突） */
let _mathBlockId = 0;

function md(text) {
  const s = String(text || '');
  // ── 第 1 步：把 $$..$ 和 $..$ 数学块提取出来，用占位符保护 ──
  //    marked.js 会把 \f \s 等反斜杠序列当转义符吞掉（\f→换页符），
  //    必须在 marked 之前把整块数学内容隔离。
  const mathBlocks = [];
  const protected = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: true });
    return '\x00MATH' + id + 'D\x00';
  }).replace(/\$([^\$\n]+?)\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: false });
    return '\x00MATH' + id + 'I\x00';
  });

  // ── 第 2 步：marked 解析 Markdown（此时文本中已无 LaTeX 反斜杠）──
  let raw = marked.parse(protected, { breaks: true, gfm: true });

  // ── 第 3 步：还原数学块（在 DOMPurify 净化之前，先放回原始 LaTeX 源码）──
  raw = raw.replace(/\x00MATH(\d+)([DI])\x00/g, (_, num, type) => {
    const b = mathBlocks.find(m => m.id === Number(num));
    if (!b) return '';
    return type === 'D' ? '$$' + b.body + '$$' : '$' + b.body + '$';
  });

  // ── 第 4 步：净化 + @提及链接 ──
  const safe = linkifyMentions(DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] }));

  // ── 第 5 步：KaTeX 渲染（code/pre 内忽略数学定界符）──
  if (window.renderMathInElement) {
    const tmp = document.createElement('div');
    tmp.innerHTML = safe;
    try {
      renderMathInElement(tmp, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        throwOnError: false
      });
    } catch (e) { /* 数学渲染失败不影响正文 */ }
    return tmp.innerHTML;
  }
  return safe;
}

/** 把 @用户名（[A-Za-z0-9_]）解析为指向 /u/用户名 的可点击链接。
 *  跳过：HTML 标签内、<a> 内（避免重复链接）、<code>/<pre> 内（代码块中 @types/react、
 *  npm i @babel/core、Python 装饰器等不是提及，误解析会破坏代码）。*/
function linkifyMentions(html) {
  const re = /@([A-Za-z0-9_]{2,30})/g; let out = '', last = 0, m;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    const before = html.slice(0, m.index);
    const inTag = before.lastIndexOf('<') > before.lastIndexOf('>');
    const inAnchor = before.lastIndexOf('<a ') > before.lastIndexOf('</a>');
    const lastCodeOpen = Math.max(before.lastIndexOf('<pre'), before.lastIndexOf('<code'));
    const lastCodeClose = Math.max(before.lastIndexOf('</pre>'), before.lastIndexOf('</code>'));
    const inCode = lastCodeOpen > lastCodeClose;
    if (inTag || inAnchor || inCode) out += m[0];
    else out += `<a href="/u/${m[1]}" class="mention">@${m[1]}</a>`;
    last = m.index + m[0].length;
  }
  return out + html.slice(last);
}

let _hljsReady = null;
function ensureHljs() {
  if (window.hljs) return Promise.resolve();
  if (_hljsReady) return _hljsReady;
  _hljsReady = new Promise((resolve, reject) => {
    if (!document.getElementById('hljs-css')) {
      const light = document.createElement('link'); light.id = 'hljs-css'; light.rel = 'stylesheet';
      light.href = '/vendor/highlight-github.min.css';
      document.head.appendChild(light);
      const dark = document.createElement('link'); dark.rel = 'stylesheet';
      dark.href = '/vendor/highlight-github-dark.min.css';
      dark.media = '(prefers-color-scheme: dark)'; document.head.appendChild(dark);
    }
    const s = document.createElement('script'); s.src = '/vendor/highlight.min.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('hljs load failed'));
    document.head.appendChild(s);
  });
  return _hljsReady;
}

function renderMd(el, text) {
  el.innerHTML = md(text);
  const codes = el.querySelectorAll('pre code');
  if (!codes.length) return;
  ensureHljs().then(() => codes.forEach((b) => { try { window.hljs.highlightElement(b); } catch { /* skip */ } })).catch(() => {});
}

function buildOutline(container) {
  const hs = container.querySelectorAll('h1, h2, h3, h4');
  if (!hs.length) return '';
  let i = 0; let html = '<div class="toc-title">📑 目录</div><ul class="toc-list">';
  hs.forEach((h) => { if (!h.id) h.id = 'toc-' + i++; const lvl = +h.tagName[1]; html += `<li class="toc-l${lvl}"><a href="javascript:void(0)" data-toc="${h.id}">${esc(h.getAttribute('data-toc-text') || h.textContent || '')}</a></li>`; });
  html += '</ul>'; return html;
}
function setupToc(toggleBtn, panel, contentEl) {
  if (!toggleBtn) return;
  toggleBtn.onclick = () => { if (panel.classList.contains('hidden')) { panel.innerHTML = buildOutline(contentEl); panel.classList.remove('hidden'); } else panel.classList.add('hidden'); }; 
  panel.onclick = (e) => { const a = e.target.closest('[data-toc]'); if (a) { const t = document.getElementById(a.dataset.toc); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
}

function timeAgo(s) {
  if (!s) return ''; const t = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime(); const d = Date.now() - t;
  if (d < 6e4) return '刚刚'; if (d < 36e5) return Math.floor(d / 6e4) + ' 分钟前'; if (d < 864e5) return Math.floor(d / 36e5) + ' 小时前'; if (d < 2592e6) return Math.floor(d / 864e5) + ' 天前';
  return new Date(t).toLocaleDateString('zh-CN');
}
function expiryText(s) {
  if (!s) return ''; const t = new Date(s.replace(' ', 'T') + 'Z').getTime(); const left = t - Date.now();
  if (left <= 0) return '已过期'; if (left < 36e5) return Math.ceil(left / 6e4) + ' 分钟后过期'; if (left < 864e5) return Math.ceil(left / 36e5) + ' 小时后过期';
  return Math.ceil(left / 864e5) + ' 天后过期';
}

/** v4.0: 字数统计（CJK=1, ASCII=0.5） */
function countChars(text) {
  if (!text) return 0; let score = 0;
  for (const ch of text) { score += ch.charCodeAt(0) > 127 ? 1 : 0.5; }
  return Math.ceil(score);
}

// ==================== 主题 ====================
function initTheme() {
  const saved = localStorage.getItem('mdqp_theme') || 'light';
  document.documentElement.dataset.theme = saved;
  $('#themeBtn').textContent = saved === 'dark' ? '☀️' : '🌙';
  $('#themeBtn').onclick = () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('mdqp_theme', next); $('#themeBtn').textContent = next === 'dark' ? '☀️' : '🌙'; };
}

// ==================== 路由 ====================
function go(path, replace = false) { if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path); render(); }
function showView(id) { $$('.view').forEach((v) => v.classList.remove('active')); $('#view-' + id).classList.add('active'); window.scrollTo(0, 0); }
function closeNav() { document.body.classList.remove('nav-open'); }
function updateNav() {
  const p = location.pathname.replace(/\/+$/, '') || '/'; const seg = p.split('/').filter(Boolean);
  const map = { home: p === '/', new: p === '/new' || (seg[0] === 'edit' && seg[1]), me: p === '/me', admin: seg[0] === 'admin', help: p === '/help', about: p === '/about', changelog: p === '/changelog', feedback: p === '/feedback', invite: seg[0] === 'invite' };
  $$('.nav-item').forEach((el) => { const key = el.dataset.nav; if (key && map[key]) el.classList.add('active'); else el.classList.remove('active'); });
}

async function render() {
  closeNav(); updateNav();
  const p = location.pathname.replace(/\/+$/, '') || '/'; const seg = p.split('/').filter(Boolean);
  if (p === '/') return renderHome();
  if (p === '/new') return renderEditor(null);
  if (p === '/me') return renderMe();
  if (seg[0] === 'edit' && seg[1]) return renderEditor(seg[1]);
  if (seg[0] === 'edit-page' && seg[1]) return renderPageEditor(seg[1]);
  if (seg[0] === 'u' && seg[1]) return renderUser(seg[1]);
  if (seg[0] === 'c' && seg[1]) return renderClip(seg[1]);
  if (p === '/help') return renderPage('help');
  if (p === '/about') return renderPage('about');
  if (p === '/changelog') return renderPage('changelog');
  if (seg[0] === 'invite' && seg[1]) return renderInviteLanding(seg[1]);
  if (p === '/invite') return renderInvitePage();
  if (p === '/vip') return renderVipPage();
  if (p === '/feedback') return renderFeedback();
  if (seg[0] === 'admin' && seg[1] === 'code') return renderAdminCode();
  if (seg[0] === 'admin') return renderAdmin();
  if (seg.length === 1) return renderClip(seg[0]);
  showView('404');
}

// ==================== 身份 ====================
async function loadMe() {
  const { data } = await api('/api/me'); state.me = data || { type: 'none' }; const box = $('#navAuth');
  if (state.me.type === 'user') {
    box.innerHTML = `<span class="nav-user" title="${esc(state.me.name)}">${avatarHtml(state.me.avatar, state.me.name)}</span><button class="btn btn-ghost" id="logoutBtn">退出</button>`;
    $('#logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
  } else {
    const left = state.me.type === 'guest' ? Math.max(0, (state.me.limit || 5) - (state.me.count || 0)) : 5;
    box.innerHTML = `<span class="guest-chip" title="游客模式">游客 · 剩 ${left}</span><button class="btn btn-primary" id="loginBtn">🔑 登录</button>`;
    $('#loginBtn').onclick = () => openAuthModal('login');
  }
  const al = $('#navAdminLink'); if (al) al.classList.toggle('hidden', !isAdmin());
  const cl = $('#navCodeLink'); if (cl) cl.classList.toggle('hidden', !isAdmin());
}

function avatarHtml(url, name) { if (url) return `<img class="avatar" src="${esc(url)}" alt="">`; const ch = (name || '?').trim().charAt(0).toUpperCase(); return `<span class="avatar avatar-txt">${esc(ch)}</span>`; }

// ==================== 卡片 ====================
function clipCard(c) {
  const badges = [];
  if (c.editable_by_anyone) badges.push('<span class="badge badge-collab">🤝 任何人可编辑</span>');
  if (c.has_password) badges.push('<span class="badge badge-lock">🔒 需密码</span>');
  if (c.expires_at) badges.push(`<span class="badge badge-time">⏳ ${esc(expiryText(c.expires_at))}</span>`);
  if (c.max_views > 0) badges.push(`<span class="badge badge-eye">👁 ${c.views}/${c.max_views}</span>`);
  if (c.login_required) badges.push('<span class="badge badge-login">🔒 登录可见</span>');
  if (c.is_public === false) badges.push('<span class="badge">🙈 仅链接可见</span>');
  const authorHtml = c.owner_type === 'user' ? `<a class="card-author" href="/u/${esc(c.owner_id)}" data-link>${esc(c.owner_name)}</a>` : `<span class="card-author guest">${esc(c.owner_name || '游客')}</span>`;
  return `<article class="clip-card"><a class="card-main" href="/c/${esc(c.clip_id)}" data-link><h3>${esc(c.title || '无标题')}</h3><p class="card-preview">${esc(c.preview || '')}</p></a><div class="card-foot">${authorHtml}<span class="muted">· ${esc(timeAgo(c.created_at))}</span><code class="card-id">${esc(c.clip_id)}</code></div>${badges.length ? `<div class="badge-row">${badges.join('')}</div>` : ''}</article>`;
}

// ==================== 首页（含公告横幅） ====================
let searchTimer = null;
async function renderHome() {
  showView('home');
  const { data: stats } = await api('/api/stats');
  if (stats) $('#heroStats').innerHTML = `<span>📋 ${stats.clips} 个剪贴板</span><span>👤 ${stats.users} 位用户</span>`;

  // v4.0: 加载公告
  loadAnnouncements();

  $('#jumpBtn').onclick = jump;
  $('#jumpInput').onkeydown = (e) => { if (e.isComposing || e.key !== 'Enter') return; jump(); };
  $('#searchInput').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadList(); }, 300); };
  $('#searchInput').value = state.q; loadList();
}

/** v4.0: 加载并渲染公告横幅 */
async function loadAnnouncements() {
  const box = $('#announcementBanner');
  if (!box) return;
  const { data } = await api('/api/announcements');
  if (!data?.announcements?.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = data.announcements.map((a) =>
    `<div class="announcement-bar">📢 ${md(a.content)}<button class="announcement-close" onclick="this.parentElement.remove()">✕</button></div>`
  ).join('');
}

function jump() { const v = $('#jumpInput').value.trim().replace(/^.*\/(c\/)?/, ''); if (v) go('/c/' + encodeURIComponent(v)); }

async function loadList() {
  const box = $('#clipList');
  box.innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div><div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div>';
  const { data } = await api(`/api/clips?page=${state.page}&q=${encodeURIComponent(state.q)}`);
  if (!data || !data.clips) return (box.innerHTML = emptyHTML('clips', '加载失败', ''));
  if (!data.clips.length) {
    box.innerHTML = state.q ? emptyHTML('search', `没有匹配「${esc(state.q)}」的剪贴板`, '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 新建剪贴板</a>') : emptyHTML('clips', '还没有公开剪贴板', '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 创建第一个</a>');
    $('#pager').innerHTML = ''; return;
  }
  box.innerHTML = data.clips.map(clipCard).join('');
  const pg = [];
  if (data.totalPages > 1) { pg.push(`<button class="btn btn-sm" ${data.page <= 1 ? 'disabled' : ''} data-p="${data.page - 1}">上一页</button>`); pg.push(`<span class="muted">${data.page} / ${data.totalPages}（共 ${data.total}）</span>`); pg.push(`<button class="btn btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} data-p="${data.page + 1}">下一页</button>`); }
  $('#pager').innerHTML = pg.join('');
  $$('#pager button[data-p]').forEach((b) => (b.onclick = () => { state.page = +b.dataset.p; loadList(); }));
}

// ==================== 详情（含评论 + 登录门禁） ====================
async function renderClip(clipId, pwd = '') {
  showView('clip'); $('#clipArticle').classList.add('hidden');
  $('#clipGate').innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div>';
  $('#clipTools').innerHTML = '';
  $('#commentSection').innerHTML = '';

  const q = pwd ? `?pwd=${encodeURIComponent(pwd)}` : '';
  const { ok, status, data } = await api(`/api/clips/${encodeURIComponent(clipId)}${q}`);

  if (status === 404) return showView('404');
  if (status === 410) {
    $('#clipGate').innerHTML = emptyHTML('gate', '这个剪贴板已失效', `<p class="muted" style="margin:0">${data?.reason === 'expired' ? '已超过设定的过期时间' : data?.reason === 'reader_limit_reached' ? '已达到读者人数上限' : '已达到阅读次数上限'}</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`);
    return;
  }
  // v4.0: 登录门禁
  if (status === 401 && data?.error === 'login_required') {
    $('#clipGate').innerHTML = `<div class="gate login-gate">
      <h2>🔒 ${esc(data.title || '受保护的剪贴板')}</h2>
      <p class="muted">作者设置了仅<b>登录用户</b>可查看此内容。</p>
      <p>登录后即可访问全部内容，还能创建自己的剪贴板。</p>
      <a class="btn btn-primary" href="/api/auth/login">🔑 立即登录</a>
    </div>`;
    return;
  }
  if (status === 401 && data?.error === 'password_required') return passwordGate(clipId, data.title, '');
  if (status === 403 && data?.error === 'password_wrong') return passwordGate(clipId, '', '密码不对，再试一次');
  if (!ok || !data) return showView('404');

  $('#clipGate').innerHTML = ''; $('#clipArticle').classList.remove('hidden');
  $('#clipTitle').textContent = data.title || '无标题'; renderMd($('#clipContent'), data.content);

  // 作者信息（含 VIP badge）
  const a = $('#clipAuthor');
  $('#clipAvatar').outerHTML = avatarHtml('', data.owner_name).replace('class="avatar', 'id="clipAvatar" class="avatar');
  $('#clipAuthorName').textContent = data.owner_name || '游客';
  if (data.owner_type === 'user') { a.href = '/u/' + data.owner_id; a.setAttribute('data-link', ''); a.classList.remove('no-link'); }
  else { a.href = 'javascript:void(0)'; a.removeAttribute('data-link'); a.classList.add('no-link'); }

  $('#clipMeta').textContent = `${timeAgo(data.created_at)}发布${data.updated_at !== data.created_at ? ' · 已编辑' : ''} · 👁 ${data.views}${data.reader_count ? ` · 👥 ${data.reader_count} 人读过` : ''}`;

  const badges = [];
  if (data.editable_by_anyone) badges.push('<span class="badge badge-collab">🤝 任何人可编辑</span>');
  if (data.has_password) badges.push('<span class="badge badge-lock">🔒 密码保护</span>');
  if (data.expires_at) badges.push(`<span class="badge badge-time">⏳ ${esc(expiryText(data.expires_at))}</span>`);
  if (data.max_views > 0) badges.push(`<span class="badge badge-eye">👁 ${data.views}/${data.max_views} 次</span>`);
  if (data.max_readers > 0) badges.push(`<span class="badge badge-reader">👥 ${data.reader_count || 0}/${data.max_readers} 人</span>`);
  if (data.login_required) badges.push('<span class="badge badge-login">🔒 登录可见</span>');
  if (!data.is_public) badges.push('<span class="badge">🙈 未公开</span>');
  $('#clipBadges').innerHTML = badges.join('');

  // 操作按钮
  $('#clipTools').innerHTML = `<button class="btn btn-sm" id="outlineBtn">📑 目录</button>`;
  if (data.can_edit) {
    $('#clipTools').innerHTML += `<a class="btn btn-sm" href="/edit/${esc(data.clip_id)}" data-link>✏️ 编辑</a><button class="btn btn-sm btn-danger" id="delBtn">🗑 删除</button>`;
    $('#delBtn').onclick = async () => { if (!confirm('确定删除？')) return; const r = await api(`/api/clips/${encodeURIComponent(data.clip_id)}`, { method: 'DELETE' }); if (r.ok) { toast('已删除'); go('/'); } else toast('删除失败：' + (r.data?.error || r.status), 'err'); };
  }
  setupToc($('#outlineBtn'), $('#clipOutline'), $('#clipContent'));

  // 分享
  const url = location.origin + '/c/' + data.clip_id;
  $('#shareLink').value = url; $('#rawLink').href = '/raw/' + data.clip_id;
  $('#copyLinkBtn').onclick = () => copy(url, '链接已复制');
  $('#copyTextBtn').onclick = () => copy(data.content, '内容已复制');
  const qrBox = $('#qrBox'); qrBox.classList.add('hidden'); qrBox.innerHTML = '';
  $('#qrBtn').onclick = () => { qrBox.classList.toggle('hidden'); if (!qrBox.dataset.done && window.QRCode) { new QRCode(qrBox, { text: url, width: 148, height: 148, correctLevel: QRCode.CorrectLevel.M }); qrBox.dataset.done = '1'; } };

  // v4.0: 加载评论
  loadComments(clipId);
}

function passwordGate(clipId, title, err) {
  $('#clipArticle').classList.add('hidden');
  $('#clipGate').innerHTML = `<div class="gate"><h2>🔒 ${esc(title || '受保护的剪贴板')}</h2><p class="muted">这个剪贴板需要密码才能查看。</p>${err ? `<p class="err-text">${esc(err)}</p>` : ''}<div class="gate-row"><input id="gatePwd" class="input" type="password" placeholder="请输入访问密码" autofocus><button class="btn btn-primary" id="gateBtn">解锁</button></div></div>`;
  const submit = () => { const v = $('#gatePwd').value; if (v) renderClip(clipId, v); };
  $('#gateBtn').onclick = submit;
  $('#gatePwd').onkeydown = (e) => { if (e.isComposing || e.key !== 'Enter') return; submit(); };
}

// ==================== v4.0: 评论系统 ====================
let mentionState = { open: false, index: 0, items: [], target: null };

async function loadComments(clipId) {
  const box = $('#commentSection');
  if (!box) return;

  const isLoggedIn = state.me?.type === 'user';
  if (!isLoggedIn) {
    box.innerHTML = `<div class="comments-wrap"><h3 class="comments-title">💬 评论</h3><p class="muted" style="padding:12px 0">登录后即可发表评论（支持 Markdown + @mention）</p></div>`;
    return;
  }

  const { data } = await api(`/api/comments/${encodeURIComponent(clipId)}`);
  const comments = data?.comments || [];

  let html = `<div class="comments-wrap">
    <h3 class="comments-title">💬 评论 (${data?.total || 0})</h3>
    <div class="comment-input-row">
      <textarea id="commentInput" class="input comment-area" placeholder="写下你的评论…（支持 @mention 用户，50 等效字内）" maxlength="200" rows="2"></textarea>
      <div class="comment-input-foot">
        <span class="muted comment-char-count">0/50</span>
        <button class="btn btn-primary btn-sm" id="commentSubmitBtn">发送</button>
      </div>
    </div>
    <div class="comment-list">`;

  if (!comments.length) {
    html += '<p class="muted" style="padding:12px 0">暂无评论，来说点什么吧～</p>';
  } else {
    for (const cm of comments) {
      const mine = isLoggedIn && String(cm.author_id) === String(state.me.userId);
      html += `<div class="comment-item" data-cid="${cm.id}">
        <div class="comment-avatar">${avatarHtml('', cm.author_name)}</div>
        <div class="comment-body">
          <div class="comment-meta"><strong>${esc(cm.author_name)}</strong><span class="muted">· ${timeAgo(cm.created_at)}</span>${mine ? `<button class="comment-del" data-del="${cm.id}" title="删除">🗑</button>` : ''}</div>
          <div class="comment-content">${md(cm.content)}</div>
        </div>
      </div>`;
    }
  }

  html += '</div></div>';
  box.innerHTML = html;

  // 评论输入事件
  const input = $('#commentInput');
  const charCountEl = box.querySelector('.comment-char-count');
  if (input) {
    input.oninput = () => { const cc = countChars(input.value); charCountEl.textContent = `${cc}/50`; charCountEl.style.color = cc > 50 ? 'var(--danger)' : ''; };
    attachMention(input);
  }

  const submitBtn = $('#commentSubmitBtn');
  if (submitBtn) submitBtn.onclick = async () => {
    const val = (input?.value || '').trim();
    if (!val) return toast('评论不能为空', 'err');
    if (countChars(val) > 50) return toast('评论过长（50 等效字）', 'err');
    submitBtn.disabled = true; submitBtn.textContent = '发送中…';
    const r = await api(`/api/comments/${encodeURIComponent(clipId)}`, { method: 'POST', body: JSON.stringify({ content: val }) });
    submitBtn.disabled = false; submitBtn.textContent = '发送';
    if (r.ok) { toast('评论已发布'); loadComments(clipId); }
    else toast(r.data?.message || '发送失败：' + (r.data?.error || r.status), 'err');
  };

  // 删除自己的评论
  box.querySelectorAll('.comment-del').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('确定删除这条评论？')) return;
      btn.disabled = true;
      const r = await api(`/api/comments/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
      if (r.ok) { toast('已删除'); loadComments(clipId); }
      else toast(r.data?.error || '删除失败', 'err');
    };
  });
}

// ============ @mention 自动补全（评论框 + 主编辑器共用） ============
/** 给任意 textarea 绑定 @ 触发 + 键盘导航 */
function attachMention(textarea) {
  if (!textarea || textarea._mentionAttached) return; textarea._mentionAttached = true;
  textarea.addEventListener('keydown', (e) => {
    if (mentionState.open && mentionState.target === textarea) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMention(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveMention(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { if (mentionState.items.length) { e.preventDefault(); chooseMention(mentionState.index); } return; }
      if (e.key === 'Escape') { e.preventDefault(); hideMentionPopup(); return; }
    }
    if (e.key === '@') { mentionState.target = textarea; openMentionAt(textarea); }
  });
  textarea.addEventListener('input', () => { if (mentionState.open && mentionState.target === textarea) refreshMentionQuery(textarea); });
  textarea.addEventListener('blur', () => setTimeout(() => { if (mentionState.target === textarea) hideMentionPopup(); }, 200));
}

function openMentionAt(textarea) {
  let popup = $('#mentionPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'mentionPopup'; popup.className = 'mention-popup hidden'; document.body.appendChild(popup); }
  positionMention(textarea);
  popup.classList.remove('hidden'); mentionState.open = true;
  refreshMentionQuery(textarea);
}
function positionMention(textarea) {
  const popup = $('#mentionPopup'); if (!popup) return;
  const rect = textarea.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  popup.style.maxHeight = Math.min(220, Math.max(120, rect.top - 8)) + 'px';
}
function refreshMentionQuery(textarea) {
  const pos = textarea.selectionStart;
  const before = textarea.value.slice(0, pos);
  const m = before.match(/@([A-Za-z0-9_一-龥]{0,20})$/);
  if (!m) { hideMentionPopup(); return; }
  const q = m[1];
  mentionState.open = true;
  const popup = $('#mentionPopup'); if (!popup) return;
  if (q.length < 1) { popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">输入用户名搜索…</div>'; mentionState.items = []; mentionState.index = 0; return; }
  searchMentionUsers(q);
}
function moveMention(dir) {
  const n = mentionState.items.length; if (!n) return;
  mentionState.index = (mentionState.index + dir + n) % n;
  const popup = $('#mentionPopup'); if (!popup) return;
  popup.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('active', i === mentionState.index));
  const active = popup.querySelector('.mention-item.active'); if (active) active.scrollIntoView({ block: 'nearest' });
}
function chooseMention(i) { const item = mentionState.items[i]; if (!item) return; insertMention(item.username, item.display_name); }

async function searchMentionUsers(q) {
  const popup = $('#mentionPopup'); if (!popup) return;
  popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">搜索中…</div>';
  const { data } = await api(`/api/search/users?q=${encodeURIComponent(q)}`);
  if (!mentionState.open) return;
  mentionState.items = data?.users || []; mentionState.index = 0;
  if (!mentionState.items.length) { popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">未找到匹配的用户</div>'; return; }
  popup.innerHTML = mentionState.items.map((u, i) =>
    `<div class="mention-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="mention-name">@${esc(u.display_name || u.username)}</span><span class="mention-handle">@${esc(u.username)}</span></div>`
  ).join('');
  popup.querySelectorAll('.mention-item').forEach((el, i) => {
    el.onclick = () => chooseMention(i);
    el.onmouseenter = () => { popup.querySelectorAll('.mention-item').forEach(e => e.classList.remove('active')); el.classList.add('active'); mentionState.index = i; };
  });
}

function insertMention(username, displayName) {
  const ta = mentionState.target; if (!ta) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos).replace(/@[A-Za-z0-9_一-龥]*$/, '');
  const after = ta.value.slice(pos);
  ta.value = before + '@' + username + ' ' + after;
  const np = before.length + username.length + 2;
  ta.focus(); ta.setSelectionRange(np, np);
  hideMentionPopup();
  ta.dispatchEvent(new Event('input'));
}

function hideMentionPopup() { const p = $('#mentionPopup'); if (p) p.classList.add('hidden'); mentionState.open = false; }

// ==================== 用户主页（扩展：VIP/邀请/功能状态） ====================
const PERM_LABELS = { delete_user: '删除用户账号', set_clip_limit: '设置剪贴板限制', edit_pages: '编辑站点文章', edit_public_clips: '修改公开剪贴板', edit_private_clips: '修改私有剪贴板', view_code: '查看源码/编辑代码' };
const FEATURE_LABELS = { custom_slug: '自定义短链', max_views: '阅读次数上限', password: '密码保护', expiry: '定时过期', collaboration: '协作模式', login_required: '登录可见', max_readers: '读者数限制', comments: '评论功能' };
const ALL_PERMS = ['delete_user', 'set_clip_limit', 'edit_pages', 'edit_public_clips', 'edit_private_clips', 'view_code'];

function promptAdminPermsDialog() {
  const keys = Object.keys(PERM_LABELS); const checked = keys.map(k => k + ':1').join('\n');
  const input = prompt(`设置管理员权限（每行一个，格式：权限名 0/1）\n\n${keys.map(k => `${k} [${PERM_LABELS[k]}]`).join('\n')}\n\n示例（全部允许）：\n${checked}`, checked);
  if (input === null) return null;
  const perms = {};
  for (const line of input.split('\n')) { const m = line.trim().match(/^(\w+)\s*[=:]\s*([01])$/); if (m && PERM_LABELS[m[1]]) perms[m[1]] = m[2] === '1'; }
  return perms;
}

// ========== 通用弹窗（替代裸 prompt，提升后台操作友好度） ==========
function openModal(title, bodyHtml) {
  let ov = $('#modalOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'modalOverlay'; ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h3 id="modalTitle"></h3><button class="modal-close" id="modalClose" aria-label="关闭">✕</button></div>
      <div class="modal-body" id="modalBody"></div>
      <div class="modal-foot" id="modalFoot"></div></div>`;
    document.body.appendChild(ov);
    ov.onclick = (e) => { if (e.target === ov) closeModal(); };
    $('#modalClose').onclick = closeModal;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('show')) closeModal(); });
  }
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalFoot').innerHTML = '';
  ov.classList.add('show');
  return { body: $('#modalBody'), foot: $('#modalFoot') };
}
function closeModal() { const ov = $('#modalOverlay'); if (ov) ov.classList.remove('show'); }

// 册封管理员：勾选权限的弹窗，返回 Promise<perms|null>
function openPermsModal(displayName) {
  return new Promise((resolve) => {
    const body = `<p class="muted" style="margin:0 0 8px">为 <b>${esc(displayName)}</b> 设置管理员权限（可多选）：</p>
      <div class="ff-grid">${ALL_PERMS.map((p) => `<label class="ff-item"><input type="checkbox" data-perm="${p}" checked> <span>${PERM_LABELS[p] || p}</span></label>`).join('')}</div>`;
    const m = openModal('册封管理员', body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="promCancel">取消</button><button class="btn btn-sm btn-primary" id="promSave">确认册封</button>`;
    m.foot.querySelector('#promCancel').onclick = () => { closeModal(); resolve(null); };
    m.foot.querySelector('#promSave').onclick = () => {
      const perms = {}; m.body.querySelectorAll('[data-perm]').forEach((c) => { perms[c.dataset.perm] = c.checked; });
      closeModal(); resolve(perms);
    };
  });
}

function linkedAccountChips(list) {
  if (!list || !list.length) return '';
  return `<div class="linked-accounts">${list.map(a => { const p = PLATFORM_NAMES[a.platform] || a.platform; const handle = a.platformUsername || a.platformUid || ''; return `<span class="chip" title="${esc(p)} UID: ${esc(String(a.platformUid || ''))}">${esc(p)} · ${esc(String(handle))}</span>`; }).join('')}</div>`;
}

/** v4.0: 功能开关标签展示 */
function featureFlagBadges(flags) {
  if (!flags) return '';
  return Object.entries(flags).map(([k, v]) => {
    const label = FEATURE_LABELS[k] || k;
    return v ? `<span class="badge" style="background:var(--primary-soft);color:var(--primary);border-color:color-mix(in srgb,var(--primary) 30%,var(--border))">${label}</span>` : `<span class="badge" style="opacity:.5;text-decoration:line-through">${label}</span>`;
  }).join(' ');
}

async function renderUser(uid) {
  showView('user'); $('#profile').innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div></div>';
  const { ok, data } = await api('/api/users/' + encodeURIComponent(uid));
  if (!ok || !data?.user) { $('#profile').innerHTML = emptyHTML('me', '找不到这个用户', ''); $('#userClips').innerHTML = ''; return; }
  const u = data.user; const self = data.is_self; const adminView = data.is_admin_viewer;
  const linked = u.linked_accounts || [];
  const sigHtml = u.signature ? `<p class="user-signature">「${esc(u.signature)}」</p>` : '';
  const bioHtml = u.bio ? `<p class="bio">${esc(u.bio)}</p>` : '';

  // v4.0: VIP + 功能开关展示
  const vipBadge = u.is_vip ? ' <span class="badge badge-vip">⭐ VIP</span>' : '';
  const flagsHtml = self || adminView ? `<div class="feature-flags-row">${featureFlagBadges(u.feature_flags)}</div>` : '';

  $('#profile').innerHTML = `<div class="profile-card">
    ${avatarHtml(u.avatar, u.display_name)}
    <div class="profile-info">
      <h1>${esc(u.display_name)} ${roleBadge(u.role, { is_vip: u.is_vip })}${vipBadge}</h1>
      ${sigHtml}
      <p class="muted">@${esc(u.username)} · 加入于 ${esc((u.created_at || '').slice(0, 10))}</p>
      ${bioHtml}
      ${flagsHtml}
      <div class="profile-stats"><span>📋 ${u.clip_count} 个剪贴板</span>${self ? '<span class="badge">这是你</span>' : ''}
        ${u.invite_code ? `<span>🎁 邀请码：<code class="card-id">${esc(u.invite_code)}</code></span>` : ''}
      </div>
      ${linkedAccountChips(linked)}
      ${linked.length || self ? `<div class="profile-actions">${self ? '<a class="btn btn-sm" href="https://www.cpoauth.com/profile" target="_blank" rel="noopener">🔗 关联账号管理（cpoauth）</a>' : ''}</div>` : ''}
      <div class="profile-wechat"><h4>扫一扫，添加我为好友</h4><img src="/wechat-qr.png" alt="WeChat QR" onerror="this.style.display='none'"></div>
      ${self ? `<div class="bio-edit"><details open><summary>✏️ 编辑个人资料</summary>
        <label class="field-label">个性签名（200 字内）</label>
        <textarea id="sigInput" class="input bio-input" maxlength="200" placeholder="写一句个性签名">${esc(u.signature || '')}</textarea>
        <label class="field-label">个人简介 / 自我介绍（500 字内，展示在个人主页）</label>
        <textarea id="bioInput" class="input bio-input" maxlength="500" placeholder="介绍一下你自己～会展示在 /u/${u.id} 主页">${esc(u.bio || '')}</textarea>
        <button class="btn btn-sm btn-primary" id="sigSaveBtn">保存</button>
      </details></div>` : ''}
      ${self ? `<div class="invite-section"><details><summary>🎁 邀请好友</summary><div id="inviteInfo" class="invite-info">加载中…</div></details></div>` : ''}
      ${self ? `<div class="bio-edit"><details><summary>🔒 设置密码（cpoauth 宕机备用登录）</summary>
        <p class="muted" style="margin:4px 0 8px">设置一个密码，之后即使第三方登录（cpoauth）服务器宕机，你也能用<b>账号密码</b>登录。</p>
        <div class="setpw-row"><input class="input" id="setPwInput" type="password" placeholder="新密码（至少 6 位）" maxlength="128"><button class="btn btn-sm btn-primary" id="setPwBtn">保存密码</button></div>
        <span id="setPwMsg" class="muted"></span>
      </details></div>` : ''}
      ${adminView && !self && u.role !== 'developer' ? `<div class="admin-user-actions">
          <b class="muted">管理操作：</b>
          ${u.role === 'admin' ? `<button class="btn btn-sm" data-role-act="user" data-uid="${u.id}">撤下管理</button>` : `<button class="btn btn-sm btn-primary" data-role-act="admin" data-uid="${u.id}">册封管理</button>`}
          <button class="btn btn-sm btn-warn" data-limit-uid="${u.id}" title="设置剪贴板数量限制">⚖️ 限制</button>
          <button class="btn btn-sm" style="background:rgba(255,215,0,.12);color:#b8860b;border-color:rgba(255,215,0,.3)" data-vip-uid="${u.id}" title="设置 VIP">⭐ VIP</button>
          <button class="btn btn-sm" data-feature-uid="${u.id}" title="功能开关">⚙️ 功能</button>
          <button class="btn btn-sm btn-danger" data-del-user="${u.id}">删除账号</button>
        </div>` : ''}
    </div></div>`;

  if (self) {
    $('#sigSaveBtn').onclick = async () => { const sig = $('#sigInput').value; const bio = ($('#bioInput') || {}).value || ''; const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ signature: sig, bio }) }); if (r.ok) { toast('已保存'); renderUser(uid); } else toast('保存失败：' + (r.data?.error || r.status), 'err'); };
    const setPwBtn = $('#setPwBtn');
    if (setPwBtn) setPwBtn.onclick = async () => {
      const pw = $('#setPwInput').value; const msg = $('#setPwMsg');
      if (pw.length < 6) { msg.textContent = '密码至少 6 位'; msg.style.color = 'var(--danger,#e5484d)'; return; }
      const r = await api('/api/auth/password/set', { method: 'POST', body: JSON.stringify({ password: pw }) });
      if (r.ok) { msg.textContent = '✅ 密码已保存，cpoauth 宕机时也能登录'; msg.style.color = ''; $('#setPwInput').value = ''; }
      else { msg.textContent = '保存失败：' + (r.data?.message || r.status); msg.style.color = 'var(--danger,#e5484d)'; }
    };
    loadInviteInfo();
  }

  // 管理员操作
  $$('#profile [data-role-act]').forEach((b) => {
    b.onclick = async () => {
      const role = b.dataset.roleAct;
      if (role === 'admin') { const perms = await openPermsModal(u.display_name); if (!perms) return; const r = await api('/api/admin/users/' + b.dataset.uid, { method: 'PATCH', body: JSON.stringify({ role, admin_permissions: perms }) }); if (r.ok) { toast('已册封'); renderUser(uid); } else toast('失败：' + (r.data?.message || r.status), 'err'); }
      else { if (!confirm(role === 'admin' ? '确认册封？' : '确认撤下？')) return; const r = await api('/api/admin/users/' + b.dataset.uid, { method: 'PATCH', body: JSON.stringify({ role }) }); if (r.ok) { toast('已更新'); renderUser(uid); } else toast('失败：' + (r.data?.error || r.status), 'err'); }
    };
  });

  const limitBtn = $('#profile [data-limit-uid]');
  if (limitBtn) limitBtn.onclick = () => { const uid = limitBtn.dataset.limitUid; const currentLimit = data.user.clip_limit || ''; const currentPeriod = data.user.limit_period || 'forever'; const limitVal = prompt(`设置该用户的剪贴板数量限制\n当前：${currentLimit ? currentLimit + ' 个/' + currentPeriod : '不限量'}\n\n输入最大数量（数字），留空或 0 = 不限量：`, currentLimit || ''); if (limitVal === null) return; const num = parseInt(limitVal) || 0; if (num > 0) { const period = prompt('限制周期？\n输入：month / week / year / forever', currentPeriod || 'month'); if (!period) return; if (!['month','week','year','forever'].includes(period)) { alert('周期必须是 month/week/year/forever'); return; } api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ clip_limit: num, limit_period: period }) }).then((r) => { if (r.ok) { toast('限制已设置'); renderUser(uid); } else toast('失败：' + (r.data?.error || r.status), 'err'); }); } else { api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ clip_limit: null, limit_period: null }) }).then((r) => { if (r.ok) { toast('已取消限制'); renderUser(uid); } else toast('失败', 'err'); }); } };

  // v4.0: VIP 设置
  const vipBtn = $('#profile [data-vip-uid]');
  if (vipBtn) vipBtn.onclick = () => { const uid = vipBtn.dataset.vipUid; const val = confirm('确定为该用户开通 VIP？\n\n取消 VIP 选择「取消」。'); api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ is_vip: val ? 1 : 0 }) }).then((r) => { if (r.ok) { toast(val ? '已开通 VIP' : '已取消 VIP'); renderUser(uid); } else toast('失败', 'err'); }); };

  // v4.0: 功能开关设置
  const featBtn = $('#profile [data-feature-uid]');
  if (featBtn) featBtn.onclick = () => { const uid = featBtn.dataset.featureUid; const current = data.user.feature_flags || {}; const input = prompt(`功能开关（每行：功能名 0/1，1=开启）\n\n${Object.entries(FEATURE_LABELS).map(([k,l])=>`${k} [${l}] ${current[k]?1:0}`).join('\n')}\n\n当前值如上，直接改数字即可：`, Object.entries(FEATURE_LABELS).map(([k]) => `${k}:${current[k]?1:0}`).join('\n')); if (input === null) return; const ff = {}; for (const line of input.split('\n')) { const m = line.trim().match(/^(\w+)\s*[=:]\s*([01])$/); if (m && FEATURE_LABELS[m[1]]) ff[m[1]] = m[2] === '1'; } api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ feature_flags: ff }) }).then((r) => { if (r.ok) { toast('功能开关已更新'); renderUser(uid); } else toast('失败', 'err'); }); };

  const delBtn = $('#profile [data-del-user]');
  if (delBtn) delBtn.onclick = async () => { if (!confirm('⚠️ 确认删除？不可恢复。')) return; const r = await api('/api/admin/users/' + delBtn.dataset.delUser, { method: 'DELETE' }); if (r.ok) { toast('账号已删除'); go('/'); } else toast('失败：' + (r.data?.message || r.status), 'err'); };

  $('#userClipsTitle').textContent = (self ? '你' : esc(u.display_name)) + ' 的剪贴板';
  $('#userClips').innerHTML = data.clips.length ? data.clips.map((c) => clipCard(Object.assign({ owner_type: 'user', owner_id: u.id }, c))).join('') : emptyHTML('me', adminView ? '该用户还没有剪贴板' : 'Ta 还没有公开的剪贴板', '');
}

// ==================== v4.0: 邀请信息加载 ====================
async function loadInviteInfo() {
  const box = $('#inviteInfo'); if (!box) return;
  const { data } = await api('/api/invite/me');
  if (!data) { box.innerHTML = '<p class="muted">加载失败</p>'; return; }

  box.innerHTML = `
    <div class="invite-card">
      <p><b>你的邀请码：</b><code class="card-id">${esc(data.invite_code)}</code>
        <button class="btn btn-sm btn-ghost" id="copyInviteCodeBtn">复制</button></p>
      <p><b>邀请链接：</b><input class="input input-sm" id="inviteLinkInput" value="${esc(data.invite_link)}" readonly>
        <button class="btn btn-sm btn-primary" id="copyInviteLinkBtn">复制链接</button></p>
      <div class="invite-stats">
        <span>📤 已邀请 <b>${data.invite_count}</b> 人</span>
        <span>📥 被邀请 <b>${data.invited_count}</b> 人首次注册</span>
      </div>
      <div class="invite-rewards">
        <h4>🎁 邀请奖励</h4>
        <ul>
          <li>邀请 <b>1</b> 人 → 开放所有高级功能</li>
          <li>邀请 <b>3</b> 人 → 开通 <b>VIP</b></li>
          <li>邀请 <b>5</b> 人 → 不限字数 + 置顶权限</li>
          <li>邀请 <b>10</b> 人 → 开发者大礼包 🎁</li>
        </ul>
      </div>
      ${data.vip_contact ? `<div class="vip-contact">💡 ${data.vip_contact}</div>` : ''}
    </div>`;

  $('#copyInviteCodeBtn').onclick = () => copy(data.invite_code, '邀请码已复制');
  $('#copyInviteLinkBtn').onclick = () => { copy(data.invite_link, '邀请链接已复制'); $('#inviteLinkInput').select(); };
}

/** 邀请落地页（/invite/:code） */
async function renderInviteLanding(code) {
  showView('home'); // 复用首页布局
  const { data } = await api(`/api/invite/${encodeURIComponent(code)}`);
  const hero = $('.hero');
  if (!hero) return;

  if (!data?.valid) {
    hero.innerHTML = `<h1>❌ 邀请无效</h1><p class="hero-sub">此邀请码不存在或已被使用。</p><a class="btn btn-primary" href="/" data-link>返回首页</a>`;
    return;
  }

  hero.innerHTML = `
    <h1>🎁 你被 ${esc(data.inviter?.name || '一位用户')} 邀请加入 mdqp</h1>
    <p class="hero-sub">mdqp 是一个 Markdown 云剪贴板——粘上就走，拿链接就分享。<br>注册后你和邀请人都能获得奖励！</p>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
      <button class="btn btn-primary" id="inviteLoginBtn">🔑 注册 / 登录（接受邀请）</button>
      <a class="btn btn-ghost" href="/" data-link>先看看再说</a>
    </div>
    <div class="hero-stats" style="margin-top:24px">
      <span>📋 免登录可用</span><span>🔐 密码保护</span><span>🎁 邀请奖励</span>
    </div>`;

  // 清空列表区域
  $('#clipList').innerHTML = ''; $('#pager').innerHTML = '';
  // 接受邀请→打开注册弹窗（兼容 cpoauth 不可用）
  $('#inviteLoginBtn').onclick = () => openAuthModal('register');
  // 尝试自动绑定邀请（如果已登录）
  if (state.me?.type === 'user') bindInvite(code);
}

async function bindInvite(code) {
  const r = await api('/api/invite/bind', { method: 'POST', body: JSON.stringify({ code }) });
  if (r.ok) {
    const granted = r.data?.granted || [];
    if (granted.length) toast(`🎉 邀请绑定成功！获得：${granted.map(g => g.desc).join('、')}`);
    else toast('✅ 邀请绑定成功！');
  } else if (r.data?.error === 'cannot_invite_self') { toast('不能邀请自己哦'); }
  else if (r.data?.error === 'invalid_or_used') { toast('邀请码无效或已使用'); }
}

// ==================== 邀请中心（营销风格独立页） ====================
async function renderInvitePage() {
  showView('invite'); const box = $('#invitePageContent');
  if (state.me?.type !== 'user') { box.innerHTML = `<div class="marketing-page"><div class="mkt-hero"><h1>🎁 <span class="gold">邀请好友</span>，共赢奖励</h1><p class="sub">登录后即可获取你的专属邀请码和链接，分享给朋友，双方都能获得丰厚奖励！</p><div class="cta-row"><a class="btn btn-primary" href="/api/auth/login">🔑 立即登录</a></div></div></div>`; return; }

  box.innerHTML = '<div class="marketing-page"><div class="skeleton-card" style="height:200px"></div></div>';
  const { data } = await api('/api/invite/me');
  if (!data) { box.innerHTML = '<p class="muted">加载失败</p>'; return; }

  const rewards = data.rewards?.inviter || [];
  const tiers = [
    { num: '1', reward: '开放所有高级功能', cls: '' },
    { num: '3', reward: '开通 ⭐ VIP（永久）', cls: 'tier-gold' },
    { num: '5', reward: '不限字数 + 剪贴板置顶权限', cls: '' },
    { num: '10', reward: '开发者大礼包 🎁（加站长微信细谈）', cls: 'tier-diamond' }
  ];

  box.innerHTML = `
    <div class="marketing-page">
      <!-- Hero -->
      <div class="mkt-hero">
        <h1>🎁 <span class="gold">邀请好友</span>，共赢奖励</h1>
        <p class="sub">每邀请一位朋友注册 mdqp，你和朋友都能获得奖励。<br>邀请越多，福利越丰厚——甚至可以直接成为 VIP！</p>
        <div class="cta-row">
          <a class="btn btn-ghost" href="/me" data-link>← 返回个人中心</a>
          <a class="btn btn-primary" href="/vip" data-link>了解 VIP 特权 →</a>
        </div>
      </div>

      <!-- 邀请卡片 -->
      <div class="mkt-section invite-card">
        <h2>📨 你的专属邀请</h2>
        <p>分享以下链接或邀请码给你的朋友，他们通过链接<strong>首次注册/登录</strong>后，你们双方都会获得奖励。</p>
        <div class="invite-code-big">${esc(data.invite_code || '------')}</div>
        <input class="input invite-link-input" id="invitePageLink" value="${esc(data.invite_link || '')}" readonly>
        <div class="invite-btn-row">
          <button class="btn btn-primary btn-sm" id="invCopyLink">📋 复制链接</button>
          <button class="btn btn-sm" id="invCopyCode">🔤 复制邀请码</button>
        </div>
      </div>

      <!-- 奖励阶梯 -->
      <div class="mkt-section">
        <h2>🏆 邀请奖励阶梯</h2>
        <p>累计邀请人数达到以下目标，自动发放对应奖励（无需手动领取）。</p>
        <table class="tier-table">
          <thead><tr><th>邀请人数</th><th>获得奖励</th></tr></thead>
          <tbody>${tiers.map(t => `<tr class="${t.cls}"><td><span class="tier-num ${t.cls ? t.cls : ''}">${t.num}</span></td><td class="tier-reward">${t.reward}</td></tr>`).join('')}</tbody>
        </table>
        <p style="margin-top:14px;font-size:13px;color:var(--muted)">
          已邀请：<b>${data.invited_count || 0}</b> 人 · 当前累计：<b>${data.invite_count || 0}</b> 人
          ${data.is_vip ? ' · ✅ 你已是 VIP' : ''}
        </p>
      </div>

      <!-- 被邀请者奖励 -->
      <div class="mkt-section">
        <h2>🎁 被邀请者也能获得奖励</h2>
        <p>通过邀请链接注册的朋友，将自动获得以下特权：</p>
        <ul style="margin:10px 0 0 20px;line-height:2;color:var(--text);font-size:14px">
          <li>✅ <b>自定义短链</b> — 用好记的短链代替随机 ID</li>
          <li>✅ <b>解锁更多高级功能</b>（由管理员配置）</li>
        </ul>
      </div>

      <!-- 微信联系 -->
      ${data.vip_contact ? `<div class="wechat-contact"><h3>💬 想了解更多？加站长微信</h3><p>${esc(data.vip_contact)}</p><div class="wechat-qr"><img src="/wechat-qr.png" alt="站长微信二维码" onerror="this.style.display='none'"></div></div>` : ''}
    </div>`;

  // 绑定复制按钮
  const copyLinkBtn = $('#invCopyLink');
  if (copyLinkBtn) copyLinkBtn.onclick = () => { copy(data.invite_link, '✅ 邀请链接已复制'); $('#invitePageLink').select(); };
  const copyCodeBtn = $('#invCopyCode');
  if (copyCodeBtn) copyCodeBtn.onclick = () => copy(data.invite_code, '✅ 邀请码已复制');
}

// ==================== VIP 页面（营销风格） ====================
async function renderVipPage() {
  showView('vip'); const box = $('#vipPageContent');
  const isVipUser = state.me?.is_vip;
  const isDev = state.me?.role === 'developer';
  const isAdmin = state.me?.role === 'admin' || isDev;

  box.innerHTML = `
    <div class="marketing-page">
      <div class="mkt-hero">
        <h1>⭐ <span class="gold">VIP</span> · 解锁全部潜力</h1>
        <p class="sub">成为 mdqp VIP，享受专属标识、优先支持与更多特权。<br>让你的剪贴板体验更上一层楼。</p>
        <div class="cta-row">
          <a class="btn btn-ghost" href="/" data-link>← 返回首页</a>
          <a class="btn btn-primary" href="/invite" data-link>免费邀请赚 VIP →</a>
        </div>
      </div>

      <!-- VIP 特权展示 -->
      <div class="mkt-section">
        <h2>💎 VIP 专属特权</h2>
        <div class="vip-grid">
          <div class="vip-feature-item"><div class="vip-feature-icon">⭐</div><h3>金色标识</h3><p>个人名片上闪耀的 VIP 金色徽章，彰显身份</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🚀</div><h3>无限可能</h3><p>不受普通用户的功能限制，自由使用全部能力</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🎯</div><h3>优先支持</h3><p>VIP 用户的问题和建议会被优先处理</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🎁</div><h3>未来新功能</h3><p>VIP 将自动解锁后续版本新增的高级特性</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🏷️</div><h3>置顶权限</h3><p>邀请满 5 人后获管理员授予的不限字数+置顶</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">👑</div><h3>社区认可</h3><p>在用户列表中突出显示，更容易被他人发现</p></div>
        </div>
      </div>

      <!-- 功能对比 -->
      <div class="mkt-section">
        <h2>📊 功能对比</h2>
        <table class="compare-table">
          <thead><tr><th>功能</th><th>普通用户</th><th class="compare-highlight">VIP</th></tr></thead>
          <tbody>
            <tr><td>每日创建上限</td><td>5 个</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>每月创建上限</td><td>50 个</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>字数限制</td><td>300 字</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>自定义短链</td><td>${isAdmin ? '<span class="compare-check">✅</span>' : '<span class="compare-cross">需邀请</span>'}</td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>密码保护</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>定时过期</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>评论功能</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>@提及</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>登录门禁</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>读者数限制</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>⭐ 金色 VIP 标识</td><td><span class="compare-cross">—</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>置顶权限</td><td><span class="compare-cross">—</span></td><td class="compare-highlight"><span class="compare-check">✅ 邀请 5 人</span></td></tr>
          </tbody>
        </table>
      </div>

      <!-- 如何获得 VIP -->
      <div class="mkt-section">
        <h2>🎯 如何获得 VIP？</h2>
        <ol style="margin:10px 0 0 22px;line-height:2.1;font-size:14px;color:var(--text)">
          <li><b>邀请 3 位朋友</b>注册 → 自动开通永久 VIP（推荐！）</li>
          <li><b>联系站长</b> → 微信扫码添加好友，说明来意即可开通</li>
        </ol>
      </div>

      <!-- 微信联系卡 -->
      <div class="wechat-contact">
        <h3>💬 扫码加站长微信，开通 VIP 或了解详情</h3>
        <p>备注 "mdqp VIP" 可优先通过</p>
        <div class="wechat-qr"><img src="/wechat-qr.png" alt="站长微信二维码" onerror="this.parentElement.innerHTML='<p style=\'color:rgba(255,255,255,.7)\'>二维码加载中…</p>'"></div>
      </div>
    </div>`;
}

// ==================== 我的（含配额显示） ====================
async function renderMe() {
  showView('me'); await loadMe(); const me = state.me;
  if (me.type === 'user') {
    const linked = me.linked_accounts || []; const sigHtml = me.signature ? `<p class="user-signature">「${esc(me.signature)}」</p>` : ''; const bioHtml = me.bio ? `<p class="bio">${esc(me.bio)}</p>` : '';
    const vipBadge = me.is_vip ? ' <span class="badge badge-vip">⭐ VIP</span>' : '';
    const flagsHtml = `<div class="feature-flags-row">${featureFlagBadges(me.feature_flags)}</div>`;

    // v4.0: 配额显示
    const quota = me.quota || {};
    const quotaHtml = `<div class="quota-bar">
      <span>今日 <b>${quota.daily_used || 0}/${quota.daily_limit || 5}</b></span>
      <span>本月 <b>${quota.monthly_used || 0}/${quota.monthly_limit || 50}</b></span>
    </div>`;

    $('#meHead').innerHTML = `<div class="profile-card">
      ${avatarHtml(me.avatar, me.name)}
      <div class="profile-info"><h1>${esc(me.name)} ${roleBadge(me.role, { is_vip: me.is_vip })}${vipBadge}</h1>
      ${sigHtml}
      <p class="muted">已登录 · 剪贴板有配额限制${me.role === 'developer' ? ' · 你是本站开发者' : me.role === 'admin' ? ' · 你是管理员' : ''}</p>
      ${bioHtml}
      ${flagsHtml}
      ${quotaHtml}
      ${linkedAccountChips(linked)}
      <div class="profile-stats">
        <a class="btn btn-sm" href="/u/${esc(me.userId)}" data-link>查看公开主页</a>
        <a class="btn btn-sm" href="/invite" data-link>🎁 邀请好友</a>
        <a class="btn btn-sm" href="/vip" data-link>⭐ VIP</a>
        <a class="btn btn-sm" href="https://www.cpoauth.com/profile" target="_blank" rel="noopener">🔗 关联账号</a>
        <a class="btn btn-sm btn-primary" href="/new" data-link>＋ 新建</a>
      </div>
      <div class="profile-wechat"><h4>扫一扫，添加我为好友</h4><img src="/wechat-qr.png" alt="WeChat QR" onerror="this.style.display='none'"></div>
      <div class="bio-edit"><details><summary>✏️ 编辑个人资料</summary>
        <label class="field-label">个性签名（200 字内）</label>
        <textarea id="sigInput" class="input bio-input" maxlength="200" placeholder="写一句个性签名">${esc(me.signature || '')}</textarea>
        <label class="field-label">个人简介（500 字内，展示在个人主页）</label>
        <textarea id="bioInput" class="input bio-input" maxlength="500" placeholder="介绍一下你自己">${esc(me.bio || '')}</textarea>
        <button class="btn btn-sm btn-primary" id="meSaveBtn">保存</button>
      </details></div>
    </div></div>`;

    // 邀请已移至独立页面 /invite
    $('#meSaveBtn').onclick = async () => { const sig = $('#sigInput').value; const bio = ($('#bioInput') || {}).value || ''; const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ signature: sig, bio }) }); if (r.ok) { toast('已保存'); renderMe(); } else toast('保存失败：' + (r.data?.error || r.status), 'err'); };
  } else {
    const left = Math.max(0, (me.limit || 5) - (me.count || 0));
    const period = me.period === 'weekly' ? '本周' : '';
    $('#meHead').innerHTML = `<div class="notice notice-warn">
      <b>你现在是游客模式</b>
      <p>已创建 ${me.count || 0} / ${me.limit || 5} 个（${period}），还能建 ${left} 个。游客剪贴板<b>任何人都能编辑或删除</b>。</p>
      <p><a class="btn btn-sm btn-primary" href="/api/auth/login">🔑 用 cpoauth 登录</a> 后日限 5 / 月限 50，且仅你可改自己的内容。</p></div>`;
  }
  const clips = me.clips || [];
  $('#meClips').innerHTML = clips.length ? clips.map((c) => clipCard(Object.assign({ owner_type: me.type, owner_id: me.type === 'user' ? me.userId : me.guestId, owner_name: me.type === 'user' ? me.name : '游客' }, c))).join('') : emptyHTML('me', '还没有剪贴板', '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 新建一个</a>');
}

// ==================== 站点页面 ====================
async function renderPage(slug) {
  if (slug === 'changelog') {
    showView('page'); $('#pageTitle').textContent = '📝 更新日志'; $('#pageMeta').textContent = 'mdqp 主要版本变动记录 · 随代码发布自动更新';
    const el = $('#pageContent'); el.className = 'markdown-body changelog'; renderMd(el, CHANGELOG_MD); $('#pageTools').innerHTML = ''; return;
  }
  showView('page'); $('#pageContent').className = 'markdown-body';
  const { ok, data } = await api('/api/pages/' + slug);
  if (!ok || !data?.page) { $('#pageTitle').textContent = slug === 'help' ? '使用帮助' : '关于'; $('#pageMeta').textContent = ''; $('#pageContent').innerHTML = emptyHTML('clips', '这个页面还不存在', ''); $('#pageTools').innerHTML = ''; return; }
  const p = data.page; $('#pageTitle').textContent = p.title || slug; $('#pageMeta').textContent = p.updated_at ? `更新于 ${esc(timeAgo(p.updated_at))}${p.updated_by ? ' · 由 ' + esc(p.updated_by) + ' 编辑' : ''}` : '';
  renderMd($('#pageContent'), p.content); $('#pageTools').innerHTML = isAdmin() ? `<a class="btn btn-sm" href="/edit-page/${esc(slug)}" data-link>✏️ 编辑此页</a><button class="btn btn-sm" id="pageOutlineBtn">📑 目录</button>` : '';
  const ob = $('#pageOutlineBtn'); if (ob) setupToc(ob, $('#pageOutline'), $('#pageContent'));
}

async function renderPageEditor(slug) {
  showView('edit'); await loadMe(); if (!isAdmin()) { toast('只有管理员能编辑站点页面', 'err'); return go('/' + slug, true); }
  state.editing = null; state.editingPage = slug; $('#guestNotice').classList.add('hidden'); $('#editorIdentity').textContent = '正在编辑站点页面 /' + slug; $('#edCollabWrap').classList.add('hidden'); $('#advBox').classList.add('hidden');
  const { ok, data } = await api('/api/pages/' + slug);
  if (ok && data?.page) { $('#edTitle').value = data.page.title || ''; $('#edContent').value = data.page.content || ''; }
  else { $('#edTitle').value = slug === 'help' ? '使用帮助' : '关于'; $('#edContent').value = ''; }
  $('#saveBtn').textContent = '💾 保存页面'; $('#saveBtn').disabled = false; updatePreview(); $('#edContent').oninput = updatePreview; $('#saveBtn').onclick = savePage; bindToolbar(); setupToc($('#tocToggle'), $('#edToc'), $('#edPreview'));
}
async function savePage() { const content = $('#edContent').value; if (!content.trim()) return toast('内容不能为空', 'err'); $('#saveBtn').disabled = true; $('#saveBtn').textContent = '保存中…'; try { const r = await api('/api/pages/' + encodeURIComponent(state.editingPage), { method: 'PUT', body: JSON.stringify({ title: $('#edTitle').value.trim(), content }) }); $('#saveBtn').disabled = false; $('#saveBtn').textContent = '💾 保存页面'; if (r.ok) { toast('页面已保存'); go('/' + state.editingPage); } else toast(r.data?.message || '保存失败：' + (r.data?.error || r.status), 'err'); } catch (e) { $('#saveBtn').disabled = false; $('#saveBtn').textContent = '💾 保存页面'; toast('网络错误，请检查连接后重试', 'err'); } }

// ==================== 管理后台（v4.0 扩展 tab） ====================
async function renderAdmin() {
  showView('admin'); await loadMe(); if (!isAdmin()) { $('#adminBox').innerHTML = emptyHTML('admin', '🚫 无权访问', `<p class="muted" style="margin:0">管理后台仅对站点管理员开放</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`); return; }
  $('#adminBox').innerHTML = `<h1 class="clip-title">🛡 管理后台</h1><p class="muted">${state.me.role === 'developer' ? '你是本站开发者，拥有一切权限。' : '你是管理员：可管理用户与所有剪贴板、编辑站点页面、发布公告、管理邀请/VIP/评论。'}</p>
    <div class="admin-tabs">
      <button class="btn btn-sm ${state.adminTab === 'users' ? 'btn-primary' : ''}" data-tab="users">👥 用户</button>
      <button class="btn btn-sm ${state.adminTab === 'clips' ? 'btn-primary' : ''}" data-tab="clips">📋 全部剪贴板</button>
      <button class="btn btn-sm ${state.adminTab === 'pages' ? 'btn-primary' : ''}" data-tab="pages">📄 站点页面</button>
      <button class="btn btn-sm ${state.adminTab === 'announcements' ? 'btn-primary' : ''}" data-tab="announcements">📢 公告</button>
      <button class="btn btn-sm ${state.adminTab === 'invites' ? 'btn-primary' : ''}" data-tab="invites">🎁 邀请</button>
      <button class="btn btn-sm ${state.adminTab === 'settings' ? 'btn-primary' : ''}" data-tab="settings">⚙️ 设置</button>
    </div><div id="adminBody"></div>`;
  $$('#adminBox [data-tab]').forEach((b) => { b.onclick = () => { state.adminTab = b.dataset.tab; renderAdmin(); }; });
  if (state.adminTab === 'users') return loadAdminUsers();
  if (state.adminTab === 'clips') return loadAdminClips();
  if (state.adminTab === 'pages') return loadAdminPages();
  if (state.adminTab === 'announcements') return loadAdminAnnouncements();
  if (state.adminTab === 'invites') return loadAdminInvites();
  if (state.adminTab === 'settings') return loadAdminSettings();
}

const ADMIN_FULL_PERMS = ALL_PERMS.reduce((o, p) => (o[p] = true, o), {});

async function loadAdminUsers() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/admin/users');
  if (!data?.users) return (box.innerHTML = emptyHTML('admin', '加载失败（需要管理员权限）', ''));
  const rows = data.users.map((u) => {
    const lvl = u.role === 'admin' ? Math.max(1, Math.min(5, Object.values(u.admin_permissions || {}).filter(Boolean).length)) : 0;
    const roleHtml = u.role === 'developer' ? roleBadge('developer') : u.role === 'admin' ? roleBadge('admin', { permLevel: lvl }) : '';
    const vipHtml = u.is_vip ? roleBadge('user', { is_vip: true }) : '';
    const ff = u.feature_flags || {};
    const ffOn = Object.keys(FEATURE_LABELS).filter((k) => ff[k]).map((k) => FEATURE_LABELS[k]);
    return `<tr>
      <td><a href="/u/${u.id}" data-link>${avatarHtml(u.avatar, u.display_name)} <b>${esc(u.display_name)}</b></a><div class="muted" style="font-size:12px">@${esc(u.username)} · #${u.id}</div></td>
      <td>${roleHtml} ${vipHtml}</td>
      <td>${u.clip_count}</td>
      <td>${u.invite_count}</td>
      <td class="muted" style="font-size:12px;max-width:170px">${ffOn.length ? ffOn.join('、') : '—'}</td>
      <td class="admin-actions">
        <button class="btn btn-sm" data-vip="${u.id}">${u.is_vip ? '取消VIP' : '设VIP'}</button>
        <button class="btn btn-sm" data-ff="${u.id}">功能</button>
        ${u.role === 'developer' ? '<span class="muted">开发者</span>' : `<button class="btn btn-sm" data-role="${u.id}">${u.role === 'admin' ? '撤管' : '升管'}</button>`}
        <button class="btn btn-sm btn-danger" data-deluser="${u.id}">删除</button>
      </td>
    </tr>`;
  }).join('');
  box.innerHTML = `<div class="list-head"><h2>👥 用户管理（${data.users.length} 人）</h2>
    <input id="adminUserSearch" class="input input-sm admin-search" placeholder="🔍 搜索用户名 / @账号 / ID"></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色 / VIP</th><th>剪贴板</th><th>邀请</th><th>功能开关</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  const search = $('#adminUserSearch');
  if (search) search.oninput = (e) => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll('tbody tr').forEach((tr) => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };

  $$('#adminBody [data-vip]').forEach((b) => b.onclick = async () => {
    const u = data.users.find((x) => String(x.id) === b.dataset.vip);
    if (!u) return;
    try {
      const r = await api('/api/admin/users/' + b.dataset.vip, { method: 'PATCH', body: JSON.stringify({ is_vip: u.is_vip ? 0 : 1 }) });
      if (!r.ok) return toast(r.data?.message || '操作失败', 'err');
      toast(u.is_vip ? '已取消 VIP' : '已设为 VIP');
      loadAdminUsers();
    } catch { toast('网络错误，请重试', 'err'); }
  });
  $$('#adminBody [data-ff]').forEach((b) => b.onclick = () => {
    const u = data.users.find((x) => String(x.id) === b.dataset.ff);
    const cur = u.feature_flags || {};
    const body = `<div class="ff-grid">${Object.entries(FEATURE_LABELS).map(([k, l]) => `<label class="ff-item"><input type="checkbox" data-ffk="${k}" ${cur[k] ? 'checked' : ''}> <span>${l}</span></label>`).join('')}</div>`;
    const m = openModal('功能开关 · ' + u.display_name, body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="ffCancel">取消</button><button class="btn btn-sm btn-primary" id="ffSave">保存</button>`;
    m.foot.querySelector('#ffCancel').onclick = closeModal;
    m.foot.querySelector('#ffSave').onclick = async () => {
      const ff = {}; m.body.querySelectorAll('[data-ffk]').forEach((c) => { ff[c.dataset.ffk] = c.checked; });
      const r = await api('/api/admin/users/' + b.dataset.ff, { method: 'PATCH', body: JSON.stringify({ feature_flags: ff }) });
      if (r.ok) { toast('已更新'); closeModal(); loadAdminUsers(); } else toast('失败', 'err');
    };
  });
  $$('#adminBody [data-role]').forEach((b) => b.onclick = async () => {
    const u = data.users.find((x) => String(x.id) === b.dataset.role);
    if (u.role === 'admin') {
      if (!confirm('确认撤下该用户的管理员身份？')) return;
      const r = await api('/api/admin/users/' + b.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) });
      if (r.ok) loadAdminUsers(); else toast('失败', 'err');
      return;
    }
    const perms = await openPermsModal(u.display_name);
    if (!perms) return;
    const r = await api('/api/admin/users/' + b.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: 'admin', admin_permissions: perms }) });
    if (r.ok) { toast('已册封'); loadAdminUsers(); } else toast('失败', 'err');
  });
  $$('#adminBody [data-deluser]').forEach((b) => b.onclick = async () => {
    if (!confirm('删除该用户及其全部剪贴板？不可恢复')) return;
    const r = await api('/api/admin/users/' + b.dataset.deluser, { method: 'DELETE' });
    if (r.ok) { toast('已删除'); loadAdminUsers(); } else toast('失败：' + (r.data?.message || r.status), 'err');
  });
}

async function loadAdminClips() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/admin/clips');
  if (!data?.clips) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  const rows = data.clips.map((c) => `<tr>
    <td><a href="/c/${esc(c.clip_id)}" data-link>${esc(c.title)}</a></td>
    <td>${c.owner_type === 'user' ? `<a href="/u/${esc(c.owner_id)}" data-link>${esc(c.owner_name || c.owner_id)}</a>` : esc(c.owner_name || '游客')}</td>
    <td>${c.is_public ? '✅' : '🙈'}</td>
    <td>${c.login_required ? '🔒' : '—'}</td>
    <td>${c.max_readers ? c.max_readers : '—'}</td>
    <td class="admin-actions"><a class="btn btn-sm" href="/c/${esc(c.clip_id)}" data-link>查看</a><button class="btn btn-sm btn-danger" data-delclip="${esc(c.clip_id)}">删除</button></td>
  </tr>`).join('');
  box.innerHTML = `<div class="list-head"><h2>📋 剪贴板管理（${data.clips.length} 条）</h2>
    <input id="adminClipSearch" class="input input-sm admin-search" placeholder="🔍 搜索标题 / 作者"></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>标题</th><th>作者</th><th>公开</th><th>登录可见</th><th>读者上限</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const cs = $('#adminClipSearch');
  if (cs) cs.oninput = (e) => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll('tbody tr').forEach((tr) => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  $$('#adminBody [data-delclip]').forEach((b) => b.onclick = async () => {
    if (!confirm('删除该剪贴板？')) return;
    const r = await api('/api/clips/' + b.dataset.delclip, { method: 'DELETE' });
    if (r.ok) { toast('已删除'); loadAdminClips(); } else toast('失败', 'err');
  });
}

async function loadAdminPages() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const slugs = ['help', 'about'];
  const pages = await Promise.all(slugs.map(async (s) => { const { data } = await api('/api/pages/' + s); return data?.page || { slug: s, title: s }; }));
  box.innerHTML = `<div class="list-head"><h2>📄 站点页面</h2><p class="muted">编辑帮助 / 关于页（Markdown）</p></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>页面</th><th>标题</th><th>操作</th></tr></thead><tbody>${
    pages.map((p) => `<tr><td><code class="card-id">${esc(p.slug)}</code></td><td>${esc(p.title || '')}</td><td><a class="btn btn-sm" href="/edit-page/${esc(p.slug)}" data-link>编辑</a></td></tr>`).join('')
  }</tbody></table></div>`;
}

// v4.0: 公告管理
async function loadAdminAnnouncements() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/announcements');
  if (!data?.announcements) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  box.innerHTML = `<div class="list-head"><h2>📢 公告管理</h2><button class="btn btn-sm btn-primary" id="addAnnounceBtn">＋ 新增公告</button></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>内容预览</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${
    data.announcements.map((a) => `<tr><td>${esc(a.content.slice(0, 80))}${a.content.length > 80 ? '…' : ''}</td><td>${a.is_active ? '✅ 活跃' : '❌ 停用'}</td><td class="muted">${esc((a.updated_at || a.created_at || '').slice(0, 16))}</td><td><button class="btn btn-sm btn-danger" data-del-announce="${a.id}">删除</button></td></tr>`).join('')
  }</tbody></table></div>`;
  $$('#adminBody [data-del-announce]').forEach((b) => { b.onclick = async () => { if (!confirm('删除公告？')) return; const r = await api(`/api/announcements/${b.dataset.delAnnounce}`, { method: 'DELETE' }); if (r.ok) { toast('已删除'); loadAdminAnnouncements(); } else toast('失败', 'err'); }; });
  $('#addAnnounceBtn').onclick = () => {
    const body = `<textarea id="annContent" class="input bio-input" style="min-height:120px" placeholder="输入公告内容（支持 Markdown）"></textarea>
      <div class="ann-preview"><b>预览：</b><div id="annPrev" class="markdown-body"></div></div>`;
    const m = openModal('发布新公告', body);
    const ta = m.body.querySelector('#annContent');
    const prev = m.body.querySelector('#annPrev');
    ta.oninput = () => renderMd(prev, ta.value);
    m.foot.innerHTML = `<button class="btn btn-sm" id="annCancel">取消</button><button class="btn btn-sm btn-primary" id="annSave">发布</button>`;
    m.foot.querySelector('#annCancel').onclick = closeModal;
    m.foot.querySelector('#annSave').onclick = async () => {
      const content = ta.value.trim(); if (!content) return toast('内容不能为空', 'err');
      const r = await api('/api/announcements', { method: 'PUT', body: JSON.stringify({ content }) });
      if (r.ok) { toast('公告已发布'); closeModal(); loadAdminAnnouncements(); } else toast('发布失败', 'err');
    };
  };
}

// v4.0: 邀请管理
async function loadAdminInvites() {
  const box = $('#adminBody'); box.innerHTML = '<div class="skeleton-row"></div>';
  const { data } = await api('/api/admin/users');
  if (!data?.users) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  const inviteRows = data.users.filter((u) => u.invite_count > 0 || u.inviter_id);
  box.innerHTML = `<div class="list-head"><h2>🎁 邀请记录</h2><p class="muted">以下用户有邀请活动（共 ${inviteRows.length} 人）</p></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>邀请码</th><th>邀请人数</th><th>被谁邀请</th><th>VIP</th></tr></thead><tbody>${
    inviteRows.map((u) => `<tr><td><a href="/u/${u.id}" data-link>${avatarHtml(u.avatar, u.display_name)} ${esc(u.display_name)}</a></td><td><code class="card-id">${esc(u.invite_code)}</code></td><td><b>${u.invite_count}</b></td><td>${u.inviter_id ? `<a href="/u/${u.inviter_id}" data-link">ID:${u.inviter_id}</a>` : '—'}</td><td>${u.is_vip ? '⭐ VIP' : '—'}</td></tr>`).join('')
  }</tbody></table></div>`;
}

// v4.0: 站点设置
async function loadAdminSettings() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/admin/settings');
  if (!data?.settings) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  box.innerHTML = `<div class="list-head"><h2>⚙️ 站点设置</h2></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>键</th><th>值</th><th>操作</th></tr></thead><tbody>${
    data.settings.map((s) => `<tr><td><code class="card-id">${esc(s.key)}</code></td><td style="max-width:400px;word-break:break-all">${esc(String(s.value).slice(0, 120))}${String(s.value).length > 120 ? '…' : ''}</td><td><button class="btn btn-sm" data-set-key="${esc(s.key)}">修改</button></td></tr>`).join('')
  }</tbody></table></div>`;
  $$('#adminBody [data-set-key]').forEach((b) => { b.onclick = () => {
    const key = b.dataset.setKey;
    const row = data.settings.find((s) => s.key === key);
    const cur = row ? String(row.value) : '';
    const body = `<p class="muted" style="margin:0 0 8px">键：<code class="card-id">${esc(key)}</code></p><textarea id="setVal" class="input bio-input" style="min-height:120px">${esc(cur)}</textarea>`;
    const m = openModal('修改站点设置', body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="setCancel">取消</button><button class="btn btn-sm btn-primary" id="setSave">保存</button>`;
    m.foot.querySelector('#setCancel').onclick = closeModal;
    m.foot.querySelector('#setSave').onclick = async () => {
      const r = await api('/api/admin/settings/' + encodeURIComponent(key), { method: 'PUT', body: JSON.stringify({ value: m.body.querySelector('#setVal').value }) });
      if (r.ok) { toast('已更新'); closeModal(); loadAdminSettings(); } else toast('失败', 'err');
    };
  }; });
}

// ========== 编辑器（v4.0 增强：等效字数 + 短链修改 + 登录可见选项） ==========
async function renderEditor(clipId) {
  showView('edit'); await loadMe(); const me = state.me; state.editing = null; state.editingPage = null; $('#advBox').classList.remove('hidden');
  const notice = $('#guestNotice');
  if (me.type === 'user') { notice.classList.add('hidden'); $('#editorIdentity').textContent = '以 ' + me.name + ' 身份发布'; $('#edCollabWrap').classList.remove('hidden'); }
  else { const left = Math.max(0, (me.limit || 5) - (me.count || 0)); notice.classList.remove('hidden'); notice.className = 'notice notice-warn'; notice.innerHTML = `<b>⚠️ 游客模式（还能建 ${left} 个）</b><p>游客创建的剪贴板会被标记为<b>「任何人可编辑/删除」</b>。<a href="/api/auth/login">登录</a> 后额度更多且仅你可改。</p>`; $('#editorIdentity').textContent = '以游客身份发布'; $('#edCollabWrap').classList.add('hidden'); if (!clipId && left <= 0) { notice.innerHTML = `<b>🚫 游客配额已用完</b><p>请删掉一些旧剪贴板，或 <a href="/api/auth/login">登录</a>。</p>`; $('#saveBtn').disabled = true; } else { $('#saveBtn').disabled = false; } }

  if (clipId) {
    const { ok, data } = await api('/api/clips/' + encodeURIComponent(clipId));
    if (!ok || !data) return showView('404');
    if (!data.can_edit) { toast('没有编辑权限', 'err'); return go('/c/' + clipId, true); }
    state.editing = data; $('#edTitle').value = data.title || ''; $('#edContent').value = data.content || ''; $('#edPublic').checked = !!data.is_public; $('#edCollab').checked = !!data.editable_by_anyone; $('#edMaxViews').value = data.max_views || 0; $('#edSlug').value = data.clip_id; $('#edPassword').placeholder = data.has_password ? '（已设密码，留空=保持不变）' : '留空 = 不加密'; $('#saveBtn').textContent = '💾 保存修改';
    // v4.0: 短链修改（如果有权限）
    const canEditSlug = me.feature_flags?.custom_slug || isAdmin();
    if (canEditSlug) { $('#edSlug').disabled = false; $('#edSlug').title = '可修改短链（保存后旧链接自动跳转新链接）'; }
    // v4.0: 预填登录门禁 / 读者上限
    $('#edLoginRequired').checked = !!data.login_required;
    $('#edMaxReaders').value = data.max_readers || 0;
  } else { $('#edTitle').value = ''; $('#edContent').value = ''; $('#edPublic').checked = true; $('#edCollab').checked = false; $('#edMaxViews').value = 0; $('#edPassword').value = ''; $('#edSlug').value = ''; $('#edSlug').disabled = !(me.feature_flags?.custom_slug || isAdmin()); $('#edExpiry').value = 'never'; $('#saveBtn').textContent = '🚀 发布'; }

  const ed = $('#edContent');
  updatePreview(); autoGrow(ed);
  ed.oninput = () => { updatePreview(); autoGrow(ed); };
  $('#saveBtn').onclick = saveClip; bindToolbar(); attachMention(ed); setupEditorShortcuts(ed); setupScrollSync(); setupToc($('#tocToggle'), $('#edToc'), $('#edPreview'));
}

function updatePreview() {
  const v = $('#edContent').value;
  if (v.trim()) renderMd($('#edPreview'), v); else $('#edPreview').innerHTML = '<p class="muted">预览区：左侧输入 Markdown，这里实时渲染。</p>';
  // v4.0: 等效字数统计
  const cc = countChars(v); const limit = state.me?.char_limit || 300; // 后端可配 global_char_limit
  if (isVip()) { $('#charCount').textContent = `${cc} 等效字 · VIP 不限`; $('#charCount').style.color = 'var(--primary)'; }
  else { $('#charCount').textContent = `${cc}/${limit} 等效字`; $('#charCount').style.color = cc > limit ? 'var(--danger)' : ''; }
  if (!$('#edToc').classList.contains('hidden')) $('#edToc').innerHTML = buildOutline($('#edPreview'));
}

function bindToolbar() {
  $('#previewToggle').onclick = () => { const s = $('#editorSplit'); s.classList.toggle('no-preview'); $('#previewToggle').classList.toggle('off', s.classList.contains('no-preview')); };
  const wraps = {
    h1: ['\n# ', '', '一级标题'], h2: ['\n## ', '', '二级标题'], h3: ['\n### ', '', '三级标题'],
    bold: ['**', '**', '加粗'], italic: ['*', '*', '斜体'], strike: ['~~', '~~', '删除线'],
    link: ['[', '](https://)', '链接文字'], image: ['![', '](https://)', '图片描述'],
    code: ['\n```\n', '\n```\n', '代码'], quote: ['\n> ', '', '引用'],
    list: ['\n- ', '', '列表项'], table: ['\n| 列1 | 列2 |\n|---|---|\n| ', ' |  |\n', '内容'], hr: ['\n\n---\n\n', '', '']
  };
  $$('.editor-toolbar button[data-md]').forEach((b) => { b.onclick = () => { const ta = $('#edContent'); const [pre, post, ph] = wraps[b.dataset.md]; const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph; ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e); ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length; updatePreview(); }; });
  const fixerBtn = $('#fixerBtn'); if (fixerBtn) fixerBtn.onclick = () => openFixer($('#edContent')?.value || '');
}

/** 编辑器增强：自动撑高 / 快捷键 / 滚动同步 */
function autoGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 720) + 'px'; }

function wrapSelection(ta, pre, post, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph;
  ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e);
  ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length;
}
function indentSelection(ta, dir) {
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  const lineStart = val.lastIndexOf('\n', s - 1) + 1;
  if (dir > 0) { ta.value = val.slice(0, lineStart) + '  ' + val.slice(lineStart); ta.selectionStart = s + 2; ta.selectionEnd = e + 2; }
  else if (val.slice(lineStart, lineStart + 2) === '  ') { ta.value = val.slice(0, lineStart) + val.slice(lineStart + 2); ta.selectionStart = Math.max(lineStart, s - 2); ta.selectionEnd = Math.max(lineStart, e - 2); }
}
function setupEditorShortcuts(ta) {
  if (!ta || ta._shortcuts) return; ta._shortcuts = true;
  ta.addEventListener('keydown', (e) => {
    if (mentionState.open) return; // @提及打开时，方向键/回车交给提及选择
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); wrapSelection(ta, '**', '**', '加粗'); updatePreview(); }
    else if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); wrapSelection(ta, '*', '*', '斜体'); updatePreview(); }
    else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveClip(); }
    else if (e.key === 'Tab') { e.preventDefault(); indentSelection(ta, e.shiftKey ? -1 : 1); updatePreview(); }
  });
}
function setupScrollSync() {
  const ed = $('#edContent'), pv = $('#edPreview'); if (!ed || !pv) return;
  let lock = null;
  ed.addEventListener('scroll', () => { if (lock === 'pv') return; lock = 'ed'; const r = ed.scrollHeight - ed.clientHeight; if (r > 0) pv.scrollTop = pv.scrollHeight * (ed.scrollTop / r); requestAnimationFrame(() => { lock = null; }); });
  pv.addEventListener('scroll', () => { if (lock === 'ed') return; lock = 'pv'; const r = pv.scrollHeight - pv.clientHeight; if (r > 0) ed.scrollTop = ed.scrollHeight * (pv.scrollTop / r); requestAnimationFrame(() => { lock = null; }); });
}

async function saveClip() {
  const content = $('#edContent').value; if (!content.trim()) return toast('内容不能为空', 'err');
  // 保存前预检字数，避免白跑一次请求（后端对管理员与有效 VIP 豁免，这里保持一致）
  if (!isAdmin() && !isVip()) {
    const lim = state.me?.char_limit || 300; const cc = countChars(content);
    if (cc > lim) { toast(`内容 ${cc} 等效字，超出上限 ${lim}`, 'err'); return; }
  }
  const body = { title: $('#edTitle').value.trim(), content, is_public: $('#edPublic').checked, expires_in: $('#edExpiry').value, max_views: parseInt($('#edMaxViews').value) || 0 };
  const pwd = $('#edPassword').value;
  if (state.editing) { if (pwd) body.password = pwd; if (state.me.type === 'user') body.editable_by_anyone = $('#edCollab').checked;
    // v4.0: 短链修改
    const newSlug = $('#edSlug').value.trim().toLowerCase();
    if (newSlug && newSlug !== state.editing.clip_id) body.new_slug = newSlug;
    // v4.0: 登录可见 & 读者限制
    body.login_required = $('#edLoginRequired')?.checked || false;
    body.max_readers = parseInt($('#edMaxReaders')?.value) || 0;
  } else { if (pwd) body.password = pwd; const slug = $('#edSlug').value.trim().toLowerCase(); if (slug) body.custom_id = slug; if (state.me.type === 'user') body.editable_by_anyone = $('#edCollab').checked; body.login_required = $('#edLoginRequired')?.checked || false; body.max_readers = parseInt($('#edMaxReaders')?.value) || 0; }

  $('#saveBtn').disabled = true; $('#saveBtn').textContent = '提交中…';
  const path = state.editing ? '/api/clips/' + encodeURIComponent(state.editing.clip_id) : '/api/clips';
  try {
    const r = await api(path, { method: state.editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
    $('#saveBtn').disabled = false; $('#saveBtn').textContent = state.editing ? '💾 保存修改' : '🚀 发布';
    if (r.ok) { toast(state.editing ? '已保存' : '发布成功！'); go('/c/' + (r.data.clip_id || state.editing.clip_id)); }
    else { toast(r.data?.message || '失败：' + (r.data?.error || '状态码 ' + r.status), 'err'); }
  } catch (e) {
    $('#saveBtn').disabled = false; $('#saveBtn').textContent = state.editing ? '💾 保存修改' : '🚀 发布';
    toast('网络错误，请检查连接后重试', 'err');
  }
}

// ==================== 官方反馈贴 ====================
async function renderFeedback() {
  showView('feedback');
  const box = $('#feedbackBox');
  box.innerHTML = `
    <h1 class="clip-title">💬 官方反馈</h1>
    <p class="muted">遇到问题或有好点子？在这里提交 Bug 反馈或意见反馈，站长会亲自查看。</p>
    <div class="fb-card">
      <div class="fb-type" id="fbType">
        <button type="button" class="fb-type-btn active" data-type="bug">🐞 Bug 反馈</button>
        <button type="button" class="fb-type-btn" data-type="suggestion">💡 意见反馈</button>
      </div>
      <form id="fbForm" class="fb-form">
        <div class="fb-fields" id="fbBugFields">
          <label class="fb-label">发生环境<span class="muted">（浏览器 / 系统 / 设备）</span>
            <input class="input" id="fbEnv" placeholder="例如：Chrome 128 / Windows 11 / 机房电脑" maxlength="500">
          </label>
          <label class="fb-label">具体情况<span class="fb-req">*</span>
            <textarea class="input fb-textarea" id="fbSituation" placeholder="描述你做了什么、期望怎样、实际怎样" maxlength="2000"></textarea>
          </label>
          <label class="fb-label">F12 报错信息<span class="muted">（选填，可在控制台复制）</span>
            <textarea class="input fb-textarea fb-mono" id="fbConsole" placeholder="粘贴控制台 / Network 里的报错" maxlength="4000"></textarea>
          </label>
        </div>
        <div class="fb-fields hidden" id="fbSuggestFields">
          <label class="fb-label">你的建议<span class="fb-req">*</span>
            <textarea class="input fb-textarea" id="fbContentSug" placeholder="随便说，内容不限" maxlength="5000"></textarea>
          </label>
        </div>
        <label class="fb-label">联系方式<span class="muted">（选填，方便回访）</span>
          <input class="input" id="fbContact" placeholder="邮箱 / QQ / 微信 任选" maxlength="200">
        </label>
        <div class="fb-actions">
          <button type="submit" class="btn btn-primary" id="fbSubmit">🚀 提交反馈</button>
          <span class="muted" id="fbHint"></span>
        </div>
      </form>
    </div>
    <div id="fbAdmin" class="fb-admin hidden"></div>
  `;
  let curType = 'bug';
  $$('#fbType .fb-type-btn').forEach((b) => b.onclick = () => {
    curType = b.dataset.type;
    $$('#fbType .fb-type-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('#fbBugFields').classList.toggle('hidden', curType !== 'bug');
    $('#fbSuggestFields').classList.toggle('hidden', curType !== 'suggestion');
  });
  $('#fbForm').onsubmit = async (e) => {
    e.preventDefault();
    const env = $('#fbEnv').value.trim();
    const situation = $('#fbSituation').value.trim();
    const console_log = $('#fbConsole').value.trim();
    const contact = $('#fbContact').value.trim();
    const content = curType === 'bug' ? situation : $('#fbContentSug').value.trim();
    if (!content) { const h = $('#fbHint'); h.textContent = curType === 'bug' ? '请填写具体情况' : '请填写你的建议'; h.style.color = 'var(--danger)'; return; }
    const btn = $('#fbSubmit'); btn.disabled = true; btn.textContent = '提交中…';
    const { ok, data } = await api('/api/feedback', { method: 'POST', body: JSON.stringify({ type: curType, env, situation, console_log, content, contact }) });
    btn.disabled = false; btn.textContent = '🚀 提交反馈';
    if (ok) {
      toast('感谢反馈，已提交！', 'ok');
      $('#fbForm').reset(); curType = 'bug';
      $$('#fbType .fb-type-btn').forEach((x) => x.classList.toggle('active', x.dataset.type === 'bug'));
      $('#fbBugFields').classList.remove('hidden'); $('#fbSuggestFields').classList.add('hidden');
      if (isAdmin()) loadFeedbackAdmin();
    } else toast(data?.message || data?.error || '提交失败', 'err');
  };
  if (isAdmin()) loadFeedbackAdmin();
}

async function loadFeedbackAdmin() {
  const el = $('#fbAdmin'); if (!el) return;
  const { ok, data } = await api('/api/feedback');
  if (!ok || !data?.feedback) { el.classList.add('hidden'); return; }
  const list = data.feedback;
  el.classList.remove('hidden');
  if (!list.length) { el.innerHTML = '<div class="fb-admin-head"><h2>🛡 管理：反馈审核</h2></div><p class="muted">还没有任何反馈。</p>'; return; }
  const statusLabel = { open: '待处理', reviewing: '处理中', resolved: '已解决', rejected: '已驳回' };
  el.innerHTML = '<div class="fb-admin-head"><h2>🛡 管理：反馈审核（' + list.length + '）</h2></div>' + list.map((f) => {
    const isBug = f.type === 'bug';
    return `<div class="fb-item" data-id="${f.id}">
      <div class="fb-item-head">
        <span class="badge ${isBug ? 'badge-lock' : 'badge-collab'}">${isBug ? '🐞 Bug' : '💡 建议'}</span>
        <span class="badge fb-status fb-status-${f.status}">${statusLabel[f.status] || f.status}</span>
        <span class="muted">${esc(f.author_name || '匿名')} · ${esc(timeAgo(f.created_at))}</span>
      </div>
      ${isBug ? `<div class="fb-meta"><b>环境：</b>${esc(f.env || '—')}</div><div class="fb-meta"><b>情况：</b>${esc(f.situation || '—')}</div>${f.console_log ? `<div class="fb-meta"><b>F12：</b><pre class="fb-pre">${esc(f.console_log)}</pre></div>` : ''}` : ''}
      <div class="fb-content">${esc(f.content)}</div>
      ${f.contact ? `<div class="fb-meta muted">联系方式：${esc(f.contact)}</div>` : ''}
      ${f.admin_note ? `<div class="fb-meta fb-note"><b>处理备注：</b>${esc(f.admin_note)}</div>` : ''}
      <div class="fb-item-actions">
        <select class="input-sm fb-status-sel" data-id="${f.id}">
          <option value="open" ${f.status === 'open' ? 'selected' : ''}>待处理</option>
          <option value="reviewing" ${f.status === 'reviewing' ? 'selected' : ''}>处理中</option>
          <option value="resolved" ${f.status === 'resolved' ? 'selected' : ''}>已解决</option>
          <option value="rejected" ${f.status === 'rejected' ? 'selected' : ''}>已驳回</option>
        </select>
        <input class="input-sm fb-note-in" data-id="${f.id}" placeholder="处理备注（选填）" value="${esc(f.admin_note || '')}">
        <button class="btn btn-sm btn-primary fb-save" data-id="${f.id}">保存</button>
        <button class="btn btn-sm btn-ghost fb-del" data-id="${f.id}">删除</button>
      </div>
    </div>`;
  }).join('');
  $$('#fbAdmin .fb-save').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id;
    const status = $(`#fbAdmin .fb-status-sel[data-id="${id}"]`).value;
    const note = $(`#fbAdmin .fb-note-in[data-id="${id}"]`).value;
    const { ok } = await api('/api/feedback/' + id, { method: 'PATCH', body: JSON.stringify({ status, admin_note: note }) });
    if (ok) { toast('已更新', 'ok'); loadFeedbackAdmin(); } else toast('更新失败', 'err');
  });
  $$('#fbAdmin .fb-del').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm('确认删除这条反馈？')) return;
    const { ok } = await api('/api/feedback/' + id, { method: 'DELETE' });
    if (ok) { toast('已删除', 'ok'); loadFeedbackAdmin(); } else toast('删除失败', 'err');
  });
}

// ==================== 查看代码 / 在线编辑 / 审批部署 ====================
function diffLines(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: 'eq', x: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', x: A[i] }); i++; }
    else { out.push({ t: 'add', x: B[j] }); j++; }
  }
  while (i < n) { out.push({ t: 'del', x: A[i++] }); }
  while (j < m) { out.push({ t: 'add', x: B[j++] }); }
  return out;
}

async function renderAdminCode() {
  showView('admin-code');
  await loadMe();
  if (!isAdmin()) { $('#adminCodeBox').innerHTML = emptyHTML('code', '🚫 无权访问', `<p class="muted" style="margin:0">查看代码仅对站点管理员开放</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`); return; }
  const isDev = state.me.role === 'developer';
  const box = $('#adminCodeBox');
  box.innerHTML = `
    <h1 class="clip-title">💻 查看代码</h1>
    <p class="muted">浏览 <b>yanzien/mdqp</b> 全部源码（实时来自 GitHub）。${isDev ? '你是开发者，可直接编辑并<span class="gold">即刻部署</span>。' : '你可将改动提交给开发者审批，通过后会自动部署。'}</p>
    <div class="code-tabs">
      <button class="code-tab active" data-tab="browse">📂 代码浏览</button>
      <button class="code-tab" data-tab="review">📝 审批队列</button>
    </div>
    <div id="codeBrowse" class="code-layout">
      <div class="code-list-pane">
        <input id="codeSearch" class="input" placeholder="🔍 搜索文件…" style="margin-bottom:8px">
        <div id="codeFileList" class="code-filelist"><div class="muted">加载中…</div></div>
      </div>
      <div class="code-main-pane">
        <div id="codeToolbar" class="code-toolbar hidden"></div>
        <div id="codeView" class="code-view"><div class="muted" style="padding:24px">← 从左侧选择一个文件查看</div></div>
      </div>
    </div>
    <div id="codeReview" class="code-review hidden"></div>
  `;
  $$('#adminCodeBox .code-tab').forEach((b) => b.onclick = () => {
    $$('#adminCodeBox .code-tab').forEach((x) => x.classList.toggle('active', x === b));
    const tab = b.dataset.tab;
    $('#codeBrowse').classList.toggle('hidden', tab !== 'browse');
    $('#codeReview').classList.toggle('hidden', tab !== 'review');
    if (tab === 'review') loadCodeReview();
  });
  const search = $('#codeSearch');
  search.oninput = () => renderFileList(search.value.trim().toLowerCase());
  await loadCodeTree();
}

async function loadCodeTree() {
  const list = $('#codeFileList'); list.innerHTML = '<div class="muted">加载文件树…</div>';
  const { ok, data } = await api('/api/admin/code/tree');
  if (!ok) {
    if (data?.error === 'forbidden') list.innerHTML = '<div class="code-noperm">🚫 你没有被授予「查看代码」权限。<br>请让开发者在「管理后台 → 用户 → 权限设置」中为你勾选 <b>查看源码/编辑代码</b>。</div>';
    else list.innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '未知错误') + '</div>';
    return;
  }
  state.codeFiles = (data.files || []).slice().sort((a, b) => a.path.localeCompare(b.path));
  renderFileList('');
}

function renderFileList(filter) {
  const list = $('#codeFileList'); if (!list || !state.codeFiles) return;
  const items = state.codeFiles.filter((f) => !filter || f.path.toLowerCase().includes(filter));
  if (!items.length) { list.innerHTML = '<div class="muted">无匹配文件</div>'; return; }
  list.innerHTML = items.map((f) => `<div class="code-file ${state.codeCur && state.codeCur.path === f.path ? 'active' : ''}" data-path="${esc(f.path)}" title="${esc(f.path)}"><span class="cf-name">${esc(f.path)}</span><span class="cf-size">${f.size > 9999 ? (f.size / 1024).toFixed(0) + 'K' : f.path.split('/').pop()}</span></div>`).join('');
  $$('#codeFileList .code-file').forEach((el) => el.onclick = () => loadCodeFile(el.dataset.path));
}

async function loadCodeFile(path) {
  const { ok, data } = await api('/api/admin/code/file?path=' + encodeURIComponent(path));
  if (!ok) { $('#codeView').innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '') + '</div>'; return; }
  state.codeCur = { path, content: data.content, sha: data.sha };
  state.codeEditing = false;
  renderFileList(($('#codeSearch').value || '').trim().toLowerCase());
  renderCodeViewer();
}

function renderCodeViewer() {
  const cur = state.codeCur; if (!cur) return;
  const isDev = state.me.role === 'developer';
  const tb = $('#codeToolbar');
  tb.classList.remove('hidden');
  tb.innerHTML = `
    <span class="code-path">${esc(cur.path)}</span>
    <span class="muted">${cur.content.length} 字符</span>
    <span class="code-actions">
      ${state.codeEditing ? '' : '<button class="btn btn-sm" id="codeEditBtn">✏️ 编辑</button>'}
      ${state.codeEditing ? '<button class="btn btn-sm" id="codePreviewBtn">👁 本地预览</button><button class="btn btn-sm btn-primary" id="codeSaveBtn">' + (isDev ? '🚀 直接部署' : '📨 提交审批') + '</button><button class="btn btn-sm btn-ghost" id="codeCancelBtn">取消</button>' : ''}
    </span>`;
  const view = $('#codeView');
  if (state.codeEditing) {
    view.innerHTML = `<textarea id="codeEditor" class="code-editor" spellcheck="false">${esc(cur.content)}</textarea><div id="codePreviewBox" class="code-preview hidden"></div>`;
    $('#codeEditBtn') && ($('#codeEditBtn').onclick = () => { state.codeEditing = true; renderCodeViewer(); });
    $('#codeCancelBtn').onclick = () => { state.codeEditing = false; renderCodeViewer(); };
    $('#codePreviewBtn').onclick = () => {
      const pb = $('#codePreviewBox'); pb.classList.toggle('hidden');
      if (!pb.classList.contains('hidden')) {
        const txt = $('#codeEditor').value;
        if (cur.path.endsWith('.md')) renderMd(pb, txt);
        else pb.innerHTML = '<pre class="code-pre">' + esc(txt) + '</pre>';
      }
    };
    $('#codeSaveBtn').onclick = applyOrSubmit;
  } else {
    const lang = (cur.path.split('.').pop() || '').toLowerCase();
    const pre = `<pre class="code-pre"><code class="language-${lang}" id="codeCode">${esc(cur.content)}</code></pre>`;
    view.innerHTML = pre;
    if (window.hljs) { try { window.hljs.highlightElement($('#codeCode')); } catch {} }
    $('#codeEditBtn').onclick = () => { state.codeEditing = true; renderCodeViewer(); };
  }
}

async function applyOrSubmit() {
  const cur = state.codeCur; if (!cur) return;
  const content = $('#codeEditor').value;
  const btn = $('#codeSaveBtn'); btn.disabled = true;
  const isDev = state.me.role === 'developer';
  const endpoint = isDev ? '/api/admin/code/apply' : '/api/admin/code/submit';
  const body = isDev ? { path: cur.path, content, sha: cur.sha, message: 'edit: ' + cur.path } : { path: cur.path, content, sha: cur.sha };
  const { ok, data } = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
  btn.disabled = false;
  if (ok) {
    if (isDev) toast('已写入 GitHub，Actions 正在自动部署…', 'ok');
    else toast(data?.overwritten ? '已覆盖之前的待审改动' : '已提交审批，等待开发者审核', 'ok');
    state.codeEditing = false; cur.content = content; renderCodeViewer();
  } else toast('失败：' + (data?.message || data?.error || '未知错误'), 'err');
}

async function loadCodeReview() {
  const box = $('#codeReview'); box.innerHTML = '<div class="muted">加载审批队列…</div>';
  const { ok, data } = await api('/api/admin/code/requests');
  if (!ok) { box.innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '') + '</div>'; return; }
  const list = data.requests || [];
  if (!list.length) { box.innerHTML = '<div class="muted">📭 暂无待审批的代码改动。</div>'; return; }
  const label = { pending: '待审批', approved: '已通过·已部署', rejected: '已驳回' };
  box.innerHTML = '<h2 class="clip-title" style="font-size:1.2em">📝 审批队列（' + list.length + '）</h2>' + list.map((r) => `
    <div class="ccr-item" data-id="${r.id}">
      <div class="ccr-head">
        <span class="badge ${r.status === 'pending' ? 'badge-collab' : r.status === 'approved' ? 'badge-lock' : 'badge-ghost'}">${label[r.status] || r.status}</span>
        <b>${esc(r.file_path)}</b>
        <span class="muted">${esc(r.author_name || '匿名')} · ${esc(timeAgo(r.updated_at))}</span>
      </div>
      ${r.admin_note ? `<div class="muted">处理备注：${esc(r.admin_note)}</div>` : ''}
      <div class="ccr-actions"><button class="btn btn-sm" data-diff="${r.id}">🔍 查看改动</button></div>
    </div>`).join('');
  $$('#codeReview [data-diff]').forEach((b) => b.onclick = () => openDiffModal(b.dataset.diff));
}

async function openDiffModal(id) {
  const { ok, data } = await api('/api/admin/code/diff?id=' + id);
  let current = '', proposed = '';
  if (ok) { current = data.current || ''; proposed = data.proposed || ''; }
  const diff = diffLines(current, proposed);
  const diffHtml = diff.map((d) => `<div class="diff-line diff-${d.t}">${d.t === 'del' ? '-' : d.t === 'add' ? '+' : ' '} ${esc(d.x)}</div>`).join('');
  const isDev = state.me.role === 'developer';
  const m = openModal('🔍 改动对比 #' + id, `
    <div class="diff-box">${diffHtml || '<div class="muted">无差异</div>'}</div>
    <label class="fb-label" style="margin-top:12px">最终内容（开发者可在此修改后通过，即「酌情采纳」）<span class="muted">提交审批的内容如下，可直接编辑</span>
      <textarea id="diffFinal" class="code-editor" style="min-height:160px" spellcheck="false">${esc(proposed)}</textarea>
    </label>
  `);
  if (isDev) {
    m.foot.innerHTML = `
      <button class="btn btn-ghost" id="diffReject">🚫 不允许（驳回）</button>
      <button class="btn btn-primary" id="diffApprove">✅ 通过并部署</button>`;
    $('#diffApprove').onclick = async () => {
      const finalContent = $('#diffFinal').value;
      const { ok: ok2, data: d2 } = await api('/api/admin/code/request/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'approved', final_content: finalContent, admin_note: '' }) });
      if (ok2) { toast('已应用并触发部署', 'ok'); closeModal(); loadCodeReview(); }
      else toast('失败：' + (d2?.message || d2?.error || ''), 'err');
    };
    $('#diffReject').onclick = async () => {
      const note = prompt('驳回原因（选填，将反馈给提交者）：', '') || '';
      const { ok: ok2, data: d2 } = await api('/api/admin/code/request/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', admin_note: note }) });
      if (ok2) { toast('已驳回', 'ok'); closeModal(); loadCodeReview(); }
      else toast('失败：' + (d2?.message || d2?.error || ''), 'err');
    };
  } else {
    m.foot.innerHTML = '<span class="muted">只有开发者可以审批并部署。</span>';
  }
}

// ==================== 命令面板 (⌘K) ====================
const cmdkState = { open: false, index: 0, items: [] };
function buildCmds() {
  const me = state.me; const cmds = [
    { icon: '🏠', label: '首页', hint: 'Home', run: () => go('/') },
    { icon: '＋', label: '新建剪贴板', hint: 'New', run: () => go('/new') },
    { icon: '👤', label: '我的', hint: 'Me', run: () => go('/me') },
    { icon: '❓', label: '帮助', hint: 'Help', run: () => go('/help') },
    { icon: '💬', label: '反馈', hint: 'Feedback', run: () => go('/feedback') },
    { icon: 'ℹ️', label: '关于', hint: 'About', run: () => go('/about') },
    { icon: '📝', label: '更新日志', hint: 'Log', run: () => go('/changelog') },
    { icon: '🌙', label: '切换主题', hint: 'Theme', run: () => $('#themeBtn').click() },
    { icon: '🎁', label: '邀请中心', hint: 'Invite', run: () => go('/invite') },
    { icon: '⭐', label: 'VIP 页面', hint: 'VIP', run: () => go('/vip') }
  ];
  if (me && me.type === 'user') { if (isAdmin()) cmds.splice(3, 0, { icon: '🛡', label: '管理后台', hint: 'Admin', run: () => go('/admin') }); cmds.push({ icon: '🚪', label: '退出登录', hint: 'Logout', run: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; } }); }
  else cmds.push({ icon: '🔑', label: '登录', hint: 'Login', run: () => { openAuthModal('login'); } });
  return cmds;
}
function highlight(text, q) { const t = String(text || ''); if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return esc(t); return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); }
function openCmdk() { if (cmdkState.open) return; cmdkState.open = true; $('#cmdk').classList.add('open'); const inp = $('#cmdkInput'); inp.value = ''; renderCmdk(''); inp.focus(); }
function closeCmdk() { cmdkState.open = false; $('#cmdk').classList.remove('open'); }
function renderCmdk(q) { const all = buildCmds(); const ql = q.trim().toLowerCase(); let items; if (ql) { items = all.filter((c) => (c.label + ' ' + c.hint).toLowerCase().includes(ql)); if (q.trim().length >= 3 && !items.length) items = [{ icon: '📎', label: '前往剪贴板「' + q.trim() + '」', hint: 'Jump', run: () => go('/c/' + encodeURIComponent(q.trim())) }]; } else { items = all; } cmdkState.items = items; cmdkState.index = 0; const list = $('#cmdkList'); if (!items.length) { list.innerHTML = '<div class="cmdk-empty">没有匹配的命令</div>'; return; } list.innerHTML = items.map((c, i) => `<button class="cmdk-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="cmdk-ico">${c.icon}</span><span class="cmdk-label">${highlight(c.label, q.trim())}</span><span class="cmdk-kbd">${esc(c.hint)}</span></button>`).join(''); $$('#cmdk-list .cmdk-item').forEach((el) => { el.onmouseenter = () => setCmdkIndex(+el.dataset.i); el.onclick = () => execCmdk(+el.dataset.i); }); }
function setCmdkIndex(i) { const n = cmdkState.items.length; if (!n) return; cmdkState.index = (i + n) % n; $$('#cmdk-list .cmdk-item').forEach((el, idx) => el.classList.toggle('active', idx === cmdkState.index)); const active = $('#cmdk-list .cmdk-item.active'); if (active) active.scrollIntoView({ block: 'nearest' }); }
function execCmdk(i) { const item = cmdkState.items[i]; if (!item) return; closeCmdk(); item.run(); }
function setupCmdk() { $('#cmdkTrigger').onclick = openCmdk; $('#cmdkBackdrop').onclick = closeCmdk; $('#cmdkInput').oninput = (e) => renderCmdk(e.target.value); $('#cmdkInput').onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setCmdkIndex(cmdkState.index + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdkIndex(cmdkState.index - 1); } else if (e.key === 'Enter') { e.preventDefault(); execCmdk(cmdkState.index); } else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); } }; document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkState.open ? closeCmdk() : openCmdk(); } else if (e.key === 'Escape' && cmdkState.open && e.target !== $('#cmdkInput')) closeCmdk(); }); }

// ==================== Markdown / LaTeX / KaTeX 自动修复 ====================
function countOcc(s, sub) { let c = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { c++; i += sub.length; } return c; }

/** 尽量自动修复结构问题：未闭合代码块 / 数学定界符 / 加粗 / 删除线，清理行尾空白，并用 katex 校验公式 */
function autoFixMd(text) {
  const changes = [];
  let t = String(text || '');

  // 1) 代码块围栏 ``` 配对
  if (countOcc(t, '```') % 2 !== 0) { t += '\n```'; changes.push('检测到未闭合的代码块（``` 数量为奇数），已在末尾补上 ```'); }

  // 2) 保护 $$...$$ 块，处理剩余单 $
  const blocks = [];
  let i = 0;
  while ((i = t.indexOf('$$', i)) !== -1) {
    const j = t.indexOf('$$', i + 2);
    if (j === -1) break;
    blocks.push(t.slice(i, j + 2));
    const ph = ' MATHB' + (blocks.length - 1) + ' ';
    t = t.slice(0, i) + ph + t.slice(j + 2);
    i += ph.length;
  }
  if (countOcc(t, '$') % 2 !== 0) {
    const idx = t.lastIndexOf('$');
    if (idx >= 0) { t = t.slice(0, idx) + '\\$' + t.slice(idx + 1); changes.push('检测到奇数个行内 $（可能被误判为数学），已将最后一个转义为 \\$'); }
  }
  blocks.forEach((b, k) => { t = t.replace(' MATHB' + k + ' ', b); });

  // 3) 加粗 ** 配对
  if (countOcc(t, '**') % 2 !== 0) { t += '**'; changes.push('检测到未闭合的 **（加粗），已在末尾补上 **'); }
  // 4) 删除线 ~~ 配对
  if (countOcc(t, '~~') % 2 !== 0) { t += '~~'; changes.push('检测到未闭合的 ~~（删除线），已在末尾补上 ~~'); }

  // 5) 行尾空白清理 + 结尾换行
  const before = t;
  const newLines = t.split('\n').map((l) => { let x = l; while (x.endsWith(' ') || x.endsWith('\t')) x = x.slice(0, -1); return x; });
  t = newLines.join('\n');
  while (t.endsWith('\n')) t = t.slice(0, -1);
  t += '\n';
  if (t !== before) changes.push('已清理行尾多余空白并确保以换行结尾');

  // 6) 公式语法校验（katex）
  if (window.katex) {
    const snips = [];
    blocks.forEach((b) => snips.push(b.slice(2, -2)));
    let p = 0;
    while ((p = t.indexOf('$', p)) !== -1) {
      const q = t.indexOf('$', p + 1);
      if (q === -1) break;
      snips.push(t.slice(p + 1, q));
      p = q + 1;
    }
    for (const s of snips) {
      if (!s.trim()) continue;
      try { window.katex.renderToString(s, { throwOnError: true, displayMode: false }); }
      catch (e) { changes.push('⚠️ 公式可能语法有误：' + s.slice(0, 50) + '…（' + (e.message || '未知错误') + '）'); }
    }
  }

  if (!changes.length) changes.push('未发现明显可修复的结构问题，内容结构看起来正常。');
  return { text: t, changes };
}

function openFixer(prefill = '') {
  const modal = $('#fixerModal'); if (!modal) return;
  $('#fixerInput').value = prefill || '';
  $('#fixerOutput').value = '';
  $('#fixerChanges').classList.add('hidden'); $('#fixerChanges').innerHTML = '';
  modal.classList.remove('hidden');
  $('#fixerInput').focus();
}
function closeFixer() { $('#fixerModal')?.classList.add('hidden'); }

(function setupFixer() {
  const run = $('#fixerRun'); if (!run) return;
  const close = $('#fixerClose'), bd = $('#fixerBackdrop'), toEd = $('#fixerToEditor'), copy = $('#fixerCopy');
  run.onclick = () => {
    const { text, changes } = autoFixMd($('#fixerInput').value);
    $('#fixerOutput').value = text;
    const box = $('#fixerChanges'); box.classList.remove('hidden');
    box.innerHTML = '<b>修复记录：</b><ul>' + changes.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    toast('已尝试自动修复，请检查下方结果', 'ok');
  };
  close.onclick = closeFixer; if (bd) bd.onclick = closeFixer;
  toEd.onclick = () => {
    const out = $('#fixerOutput').value; const ta = $('#edContent');
    if (ta && out) { ta.value = out; ta.dispatchEvent(new Event('input')); toast('已填入编辑器', 'ok'); }
    else toast('没有可填入的修复结果', 'err');
  };
  copy.onclick = async () => {
    const out = $('#fixerOutput').value; if (!out) return;
    try { await navigator.clipboard.writeText(out); toast('已复制修复结果', 'ok'); } catch { toast('复制失败，请手动选择', 'err'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#fixerModal')?.classList.contains('hidden')) closeFixer(); });
})();

// ============ 登录 / 注册弹窗（cpoauth 兜底：账号密码） ============
let authMode = 'login';
let authMethods = { cpoauth: true, password: true };

async function loadAuthMethods() {
  try { const { data } = await api('/api/auth/methods'); if (data) authMethods = data; } catch {}
}

function openAuthModal(mode = 'login') {
  authMode = mode || 'login';
  const modal = $('#authModal'); if (!modal) return;
  const cpoDown = !authMethods.cpoauth;
  const cpoBtn = $('#authCpoauthBtn'); const banner = $('#authBanner');
  if (cpoBtn) cpoBtn.classList.toggle('hidden', cpoDown);
  if (banner) {
    if (cpoDown) { banner.classList.remove('hidden'); banner.textContent = '⚠️ 第三方登录（cpoauth）暂时不可用，请使用账号密码登录或注册。'; }
    else banner.classList.add('hidden');
  }
  setAuthMode(authMode);
  modal.classList.remove('hidden'); modal.classList.add('show');
  setTimeout(() => $('#authUsername')?.focus(), 50);
}
function closeAuthModal() {
  const modal = $('#authModal'); if (!modal) return;
  modal.classList.remove('show'); modal.classList.add('hidden');
  $('#authError')?.classList.add('hidden');
}
function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  $('#authTabLogin')?.classList.toggle('active', login);
  $('#authTabRegister')?.classList.toggle('active', !login);
  const t = $('#authTitle'); if (t) t.textContent = login ? '🔐 登录 mdqp' : '📝 注册 mdqp';
  const s = $('#authSubmit'); if (s) s.textContent = login ? '登录' : '注册并登录';
  const p = $('#authPassword'); if (p) p.setAttribute('autocomplete', login ? 'current-password' : 'new-password');
}
async function submitAuth(e) {
  e.preventDefault();
  const username = ($('#authUsername').value || '').trim();
  const password = ($('#authPassword').value || '');
  const errBox = $('#authError'); if (errBox) errBox.classList.add('hidden');
  if (!username || !password) { if (errBox) { errBox.textContent = '请输入用户名和密码'; errBox.classList.remove('hidden'); } return; }
  // 注册时携带 URL 中的邀请码
  const invite = new URLSearchParams(location.search).get('invite_code') || '';
  if (authMode === 'register') {
    const r = await api('/api/auth/password/register', { method: 'POST', body: JSON.stringify({ username, password, invite_code: invite }) });
    if (r.ok) { toast('注册成功，已登录'); location.reload(); }
    else if (errBox) { errBox.textContent = r.data?.message || r.data?.error || '注册失败'; errBox.classList.remove('hidden'); }
  } else {
    const r = await api('/api/auth/password/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (r.ok) { toast('登录成功'); location.reload(); }
    else if (errBox) { errBox.textContent = r.data?.message || r.data?.error || '登录失败'; errBox.classList.remove('hidden'); }
  }
}
function setupAuthModal() {
  const modal = $('#authModal'); if (!modal) return;
  $('#authClose').onclick = closeAuthModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
  $('#authTabLogin').onclick = () => setAuthMode('login');
  $('#authTabRegister').onclick = () => setAuthMode('register');
  $('#authForm').onsubmit = submitAuth;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeAuthModal(); });
}

// ==================== 启动 ====================
document.addEventListener('click', (e) => { const a = e.target.closest('a[data-link]'); if (a && a.getAttribute('href')?.startsWith('/')) { e.preventDefault(); go(a.getAttribute('href')); } });
window.addEventListener('popstate', render);

(async function init() {
  initTheme(); const mt = $('#menuToggle'); if (mt) mt.onclick = () => document.body.classList.toggle('nav-open');
  const ov = $('#navOverlay'); if (ov) ov.onclick = closeNav; setupCmdk();
  setupAuthModal(); loadAuthMethods();
  // 侧边栏折叠（仅桌面生效，状态持久化）
  const st = $('#sidebarToggle');
  if (st) {
    if (localStorage.getItem('mdqp_sidebar_collapsed') === '1') document.body.classList.add('sidebar-collapsed');
    st.onclick = () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('mdqp_sidebar_collapsed', collapsed ? '1' : '0');
    };
  }
  const sp = new URLSearchParams(location.search);
  if (sp.get('logged_in')) { toast('登录成功'); history.replaceState({}, '', location.pathname); }
  if (sp.get('error')) { const m = { state_mismatch: '登录校验失败，请重试', token_failed: '换取令牌失败，检查 cpoauth 回调地址配置', userinfo_failed: '获取用户信息失败', oauth_not_configured: '尚未配置 cpoauth 凭据', pkce_missing: '会话丢失，请重新登录' }; toast(m[sp.get('error')] || '登录失败：' + sp.get('error'), 'err'); history.replaceState({}, '', location.pathname); }
  // v4.0: 如果有邀请码参数且已登录，尝试绑定
  const inviteCode = sp.get('invite_code');
  if (inviteCode && sp.get('logged_in')) { setTimeout(() => bindInvite(inviteCode), 1500); }
  await loadMe(); render();
})();
