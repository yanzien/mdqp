// ============================================================
//  mdqp — Markdown Quick Paste  (app.js)
//  登录: cpoauth OAuth (PKCE) + 手动注册(不安全兜底)
//  存储: GitHub Contents API
// ============================================================

// ---- 常量 ----
const CPOAUTH = {
  clientId: 'ed88ee46-4e48-8e57-a71f-f00438af630',
  authUrl: 'https://www.cpoauth.com/oauth/authorize',
  tokenUrl: 'https://www.cpoauth.com/api/oauth/token',
  userinfoUrl: 'https://www.cpoauth.com/api/oauth/userinfo',
  scope: 'openid profile'
};

const DATA_FILE = 'clips.json';   // 剪贴板数据文件
const USERS_FILE = 'users.json';  // 手动注册用户（不安全）

// ---- 状态 ----
let session = null;    // { provider, sub, username, display_name, ... }
let clips = [];        // 所有剪贴板
let editingId = null;  // 当前编辑的 clip ID（null = 新建）

// ---- 初始化 ----
(function init() {
  loadConfig();
  loadSession();
  if (session) {
    showView('dashboard');
    renderNav();
    loadClips();
  } else {
    showView('welcome');
  }
})();

// ============================================================
//  视图切换
// ============================================================
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
}

function backToDash() { showView('dashboard'); renderClips(); }

// ============================================================
//  配置管理 (localStorage)
// ============================================================
function loadConfig() {
  ['cfgUser','cfgRepo','cfgBranch','cfgPat','cfgDataDir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = localStorage.getItem('mdqp_' + id) || '';
  });
  // 默认值填充
  if (!document.getElementById('cfgUser').value) document.getElementById('cfgUser').value = 'yanzien';
  if (!document.getElementById('cfgRepo').value) document.getElementById('cfgRepo').value = 'mdqp';
  if (!document.getElementById('cfgBranch').value) document.getElementById('cfgBranch').value = 'main';
  if (!document.getElementById('cfgDataDir').value) document.getElementById('cfgDataDir').value = 'data';
}

function saveConfig() {
  ['cfgUser','cfgRepo','cfgBranch','cfgPat','cfgDataDir'].forEach(id => {
    localStorage.setItem('mdqp_' + id, document.getElementById(id).value);
  });
  toast('✅ 配置已保存', 'ok');
}

function getConfig() {
  return {
    user: localStorage.getItem('mdqp_cfgUser') || '',
    repo: localStorage.getItem('mdqp_cfgRepo') || '',
    branch: localStorage.getItem('mdqp_cfgBranch') || 'main',
    pat: localStorage.getItem('mdqp_cfgPat') || '',
    dataDir: (localStorage.getItem('mdqp_cfgDataDir') || 'data').replace(/\/+$/, '')
  };
}

function ghApi(path) {
  const c = getConfig();
  const base = `https://api.github.com/repos/${c.user}/${c.repo}/contents/`;
  const url = base + path.split('/').map(encodeURIComponent).join('/');
  const headers = {'Accept': 'application/vnd.github+json'};
  if (c.pat) headers['Authorization'] = 'Bearer ' + c.pat;
  return { url, headers };
}

async function testConn() {
  const msgEl = document.getElementById('connMsg');
  msgEl.textContent = '测试中...'; msgEl.className = 'msg';
  try {
    const { url, headers } = ghApi('');
    const r = await fetch(url, { headers });
    if (r.ok) {
      msgEl.textContent = '✅ 连接成功！仓库可访问。'; msgEl.className = 'msg ok';
    } else {
      const d = await r.json();
      msgEl.textContent = '❌ ' + (d.message || r.status); msgEl.className = 'msg err';
    }
  } catch(e) {
    msgEl.textContent = '❌ 网络错误: ' + e.message; msgEl.className = 'msg err';
  }
}

// ============================================================
//  GitHub Contents API 读写
// ============================================================

/** GET 文件内容，返回 { content(string), sha } */
async function ghGetFile(path) {
  const { url, headers } = ghApi(path);
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status} ${await r.text().catch(()=>'')}`);
  const d = await r.json();
  // 如果是目录
  if (Array.isArray(d)) throw new Error(`${path} 是目录，不是文件`);
  const text = atob(d.content.replace(/\n/g, ''));
  return { content: text, sha: d.sha };
}

/** PUT 创建/更新文件 */
async function ghPutFile(path, content, message, sha) {
  const c = getConfig();
  if (!c.pat) throw new Error('未配置 PAT，无法写入。请在「连接设置」中填写。');
  const { url, headers } = ghApi(path);
  const body = {
    message: message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: c.branch
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${path}: ${r.status} ${d.message || ''}`);
  }
  return r.json();
}

/** DELETE 文件 */
async function ghDeleteFile(path, message, sha) {
  const { url, headers } = ghApi(path);
  const c = getConfig();
  const r = await fetch(url, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ message, sha, branch: c.branch })
  });
  if (!r.ok) throw new Error(`GitHub DELETE ${path}: ${r.status}`);
}

// ============================================================
//  会话 / 登录
// ============================================================

function loadSession() {
  try {
    const s = sessionStorage.getItem('mdqp_session');
    if (s) session = JSON.parse(s);
    // 检查过期
    if (session && session.expires_at && Date.now() > session.expires_at) {
      session = null;
      sessionStorage.removeItem('mdqp_session');
    }
  } catch { session = null; }

  // 也检查旧版手动登录
  if (!session) {
    try {
      const m = sessionStorage.getItem('mdqp_manual');
      if (m) session = JSON.parse(m);
    } catch {}
  }
}

function renderNav() {
  const el = document.getElementById('navRight');
  if (!session) { el.innerHTML = ''; return; }
  const name = session.display_name || session.username || '用户';
  const avatar = session.avatar ? `<img src="${escHtml(session.avatar)}" class="avatar">` : '';
  el.innerHTML = `
    <span class="user-info">${avatar}<span>${escHtml(name)}</span></span>
    <button class="btn btn-sm btn-outline" onclick="logout()">退出</button>
  `;
}

function getOwner() {
  if (!session) return null;
  return session.sub || session.username;  // cpoauth 用 sub，手动用 username
}

// ---- cpoauth OAuth PKCE ----

async function generatePKCE() {
  const verifier = arrayToBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = arrayToBase64url(new Uint8Array(hash));
  return { verifier, challenge };
}

function arrayToBase64url(arr) {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function cpoauthLogin() {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CPOAUTH.clientId,
    redirect_uri: location.origin + '/mdqp/callback.html',
    scope: CPOAUTH.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  location.href = CPOAUTH.authUrl + '?' + params.toString();
}

// ---- 手动注册 / 登录（不安全）----

async function doRegister() {
  const user = document.getElementById('regUser').value.trim();
  const pass = document.getElementById('regPass').value;
  const msg = document.getElementById('authMsg');

  if (!user || !pass) { msg.textContent = '请输入用户名和密码'; msg.className='msg err'; return; }

  msg.textContent = '注册中...'; msg.className = 'msg';

  try {
    // 读现有用户
    let users = [];
    const existing = await ghGetFile(USERS_FILE);
    if (existing) users = JSON.parse(existing.content);

    if (users.find(u => u.username === user)) {
      msg.textContent = '用户名已存在'; msg.className = 'msg err'; return;
    }

    // SHA-256 哈希
    const hash = await sha256(pass);
    users.push({ username: user, passwordHash: hash, createdAt: new Date().toISOString(), method: 'manual' });

    const sha = existing ? existing.sha : undefined;
    await ghPutFile(USERS_FILE, JSON.stringify(users, null, 2), `register: ${user}`, sha);

    // 自动登录
    session = { provider: 'manual', username: user, method: 'manual' };
    sessionStorage.setItem('mdqp_manual', JSON.stringify(session));

    msg.textContent = '✅ 注册成功！正在跳转...'; msg.className = 'msg ok';
    setTimeout(() => { showView('dashboard'); renderNav(); loadClips(); }, 800);

  } catch(e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'msg err';
  }
}

async function doLogin() {
  const user = document.getElementById('regUser').value.trim();
  const pass = document.getElementById('regPass').value;
  const msg = document.getElementById('authMsg');

  if (!user || !pass) { msg.textContent = '请输入用户名和密码'; msg.className='msg err'; return; }

  msg.textContent = '登录中...'; msg.className = 'msg';

  try {
    const existing = await ghGetFile(USERS_FILE);
    if (!existing) { msg.textContent = '无用户数据，请先注册'; msg.className='msg err'; return; }

    const users = JSON.parse(existing.content);
    const u = users.find(x => x.username === user);
    if (!u) { msg.textContent = '用户不存在'; msg.className='msg err'; return; }

    const hash = await sha256(pass);
    if (u.passwordHash !== hash) { msg.textContent = '密码错误'; msg.className='msg err'; return; }

    session = { provider: 'manual', username: user, method: 'manual' };
    sessionStorage.setItem('mdqp_manual', JSON.stringify(session));

    msg.textContent = '✅ 登录成功！'; msg.className = 'msg ok';
    setTimeout(() => { showView('dashboard'); renderNav(); loadClips(); }, 500);

  } catch(e) {
    msg.textContent = '❌ ' + e.message; msg.className = 'msg err';
  }
}

async function sha256(message) {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function logout() {
  session = null;
  sessionStorage.removeItem('mdqp_session');
  sessionStorage.removeItem('mdqp_manual');
  showView('welcome');
  renderNav();
}

// ============================================================
//  剪贴板 CRUD
// ============================================================

async function loadClips() {
  const listEl = document.getElementById('clipList');
  listEl.innerHTML = '<div class="empty-state">加载中...</div>';

  try {
    const dataPath = getConfig().dataDir + '/' + DATA_FILE;
    const result = await ghGetFile(dataPath);
    clips = result ? JSON.parse(result.content) : [];
    // 存 sha 用于后续写回
    window._clipsSha = result ? result.sha : null;
    renderClips();
  } catch(e) {
    // 文件不存在 → 空列表
    clips = [];
    window._clipsSha = null;
    renderClips();
  }
}

function renderClips() {
  const listEl = document.getElementById('clipList');
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const f = document.getElementById('filterSelect').value;
  const owner = getOwner();

  let filtered = clips.filter(c => {
    const matchQ = !q || (c.title||'').toLowerCase().includes(q) || (c.content||'').toLowerCase().includes(q);
    let matchF = true;
    if (f === 'mine') matchF = c.owner === owner;
    if (f === 'public') matchF = !!c.isPublic;
    return matchQ && matchF;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">暂无剪贴板<br><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="newClip()">+ 新建第一个</button></div>';
    return;
  }

  listEl.innerHTML = filtered.map(c => `
    <div class="clip-card" onclick="viewClip('${c.id}')">
      <div class="clip-title">${escHtml(c.title || '无标题')}</div>
      <div class="clip-preview">${escHtml(stripMd(c.content||''))}</div>
      <div class="clip-meta">
        <span>${timeAgo(c.updatedAt || c.createdAt)}</span>
        <span class="clip-tag ${c.isPublic?'public':''}">${c.isPublic?'公开':'私有'} · ${escHtml(c.ownerName||c.owner||'?')}</span>
      </div>
    </div>
  `).join('');
}

function newClip() {
  editingId = null;
  document.getElementById('editTitle').value = '';
  document.getElementById('editContent').value = '';
  document.getElementById('editPublic').checked = false;
  document.getElementById('editMeta').textContent = '';
  document.getElementById('editPreview').classList.add('hidden');
  document.querySelector('.editor-textarea').style.display = '';
  showView('editor');
}

function viewClip(id) {
  const c = clips.find(x => x.id === id);
  if (!c) return;

  document.getElementById('viewerTitle').textContent = c.title || '无标题';
  document.getElementById('viewerBody').innerHTML = marked.parse(c.content || '');
  document.getElementById('viewerMeta').textContent =
    `作者: ${c.ownerName || c.owner || '?'} · 创建: ${(c.createdAt||'').slice(0,19)} · 更新: ${(c.updatedAt||'').slice(0,19)}${c.isPublic ? ' · 公开' : ' · 私有'}`;
  showView('viewer');
}

function editClip(id) {
  const c = clips.find(x => x.id === id);
  if (!c) return;
  // 只有主人能编辑
  if (c.owner !== getOwner()) { toast('只能编辑自己的剪贴板', 'err'); return; }

  editingId = id;
  document.getElementById('editTitle').value = c.title || '';
  document.getElementById('editContent').value = c.content || '';
  document.getElementById('editPublic').checked = !!c.isPublic;
  document.getElementById('editMeta').textContent =
    `创建: ${(c.createdAt||'').slice(0,19)} · 更新: ${(c.updatedAt||'').slice(0,19)}`;
  document.getElementById('editPreview').classList.add('hidden');
  document.querySelector('.editor-textarea').style.display = '';
  showView('editor');
}

async function saveClip() {
  const title = document.getElementById('editTitle').value.trim();
  const content = document.getElementById('editContent').value;
  const isPublic = document.getElementById('editPublic').checked;
  const owner = getOwner();

  if (!content.trim()) { toast('内容不能为空', 'err'); return; }

  toast('保存中...', '');

  try {
    const now = new Date().toISOString();

    if (editingId) {
      // 更新
      const idx = clips.findIndex(c => c.id === editingId);
      if (idx >= 0) {
        clips[idx].title = title;
        clips[idx].content = content;
        clips[idx].isPublic = isPublic;
        clips[idx].updatedAt = now;
      }
    } else {
      // 新建
      const newClip = {
        id: genId(),
        title,
        content,
        owner,
        ownerName: session?.display_name || session?.username || owner,
        isPublic,
        createdAt: now,
        updatedAt: now
      };
      clips.push(newClip);
      editingId = newClip.id;
    }

    const dataPath = getConfig().dataDir + '/' + DATA_FILE;
    await ghPutFile(dataPath, JSON.stringify(clips, null, 2),
      editingId ? `update: ${title || '剪贴板'}` : `create: ${title || '剪贴板'}`,
      window._clipsSha);

    // 刷新 sha
    const updated = await ghGetFile(dataPath);
    window._clipsSha = updated ? updated.sha : null;

    toast('✅ 已保存', 'ok');
    setTimeout(() => backToDash(), 600);

  } catch(e) {
    toast('❌ 保存失败: ' + e.message, 'err');
  }
}

async function deleteClip(id) {
  if (!confirm('确定删除这个剪贴板？')) return;
  const c = clips.find(x => x.id === id);
  if (!c) return;
  if (c.owner !== getOwner()) { toast('只能删除自己的剪贴板', 'err'); return; }

  try {
    clips = clips.filter(x => x.id !== id);
    const dataPath = getConfig().dataDir + '/' + DATA_FILE;
    await ghPutFile(dataPath, JSON.stringify(clips, null, 2),
      `delete: ${c.title || '剪贴板'}`, window._clipsSha);
    const updated = await ghGetFile(dataPath);
    window._clipsSha = updated ? updated.sha : null;
    renderClips();
    toast('🗑 已删除', 'ok');
  } catch(e) {
    toast('❌ 删除失败: ' + e.message, 'err');
  }
}

// ---- 编辑器预览 ----
let previewVisible = false;
function togglePreview() {
  previewVisible = !previewVisible;
  const ta = document.querySelector('.editor-textarea');
  const pv = document.getElementById('editPreview');
  if (previewVisible) {
    pv.classList.remove('hidden');
    pv.innerHTML = marked.parse(document.getElementById('editContent').value || '');
    ta.style.display = 'none';
  } else {
    pv.classList.add('hidden');
    ta.style.display = '';
  }
}

// ============================================================
//  工具函数
// ============================================================

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stripMd(md) {
  return md.replace(/[#*_`~\[\]()!|]/g, '').replace(/\n/g, ' ').trim().slice(0, 120);
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + '分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + '天前';
  return Math.floor(d / 30) + '个月前';
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3000);
}
