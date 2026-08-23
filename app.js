/* ============================================================
   mdqp — 纯前端用户系统，数据存 GitHub 仓库 users.json
   ⚠️ 安全提示：Token 运行在前端、仓库公开，仅适合练习/低敏场景
   ============================================================ */

const LS = {
  user: 'mdqp_user', repo: 'mdqp_repo', branch: 'mdqp_branch',
  token: 'mdqp_token', session: 'mdqp_session'
};

/* ---------- 连接配置 ---------- */
function cfg() {
  return {
    user: localStorage.getItem(LS.user) || 'yanzien',
    repo: localStorage.getItem(LS.repo) || 'mdqp',
    branch: localStorage.getItem(LS.branch) || 'main',
    token: localStorage.getItem(LS.token) || ''
  };
}
function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

/* ---------- GitHub Contents API ---------- */
async function getFile(path) {
  const c = cfg();
  const url = `https://api.github.com/repos/${c.user}/${c.repo}/contents/${encPath(path)}?ref=${c.branch}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('读取 ' + path + ' 失败 (HTTP ' + r.status + ')');
  const d = await r.json();
  return { content: atob(d.content.replace(/\s/g, '')), sha: d.sha };
}
async function putFile(path, text, sha, message) {
  const c = cfg();
  const url = `https://api.github.com/repos/${c.user}/${c.repo}/contents/${encPath(path)}`;
  const body = { message, content: btoa(unescape(encodeURIComponent(text))), branch: c.branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    let extra = '';
    try { extra = JSON.parse(t).message || ''; } catch {}
    throw new Error('写入 ' + path + ' 失败 (HTTP ' + r.status + ') ' + extra);
  }
  return (await r.json()).content.sha;
}

/* 读取最新 users.json（含 sha，供后续写入做乐观锁） */
async function loadUsersRaw() {
  const f = await getFile('users.json');
  if (!f) return { users: [], sha: null };
  try { return { users: JSON.parse(f.content), sha: f.sha }; }
  catch { return { users: [], sha: f.sha }; }
}

/* ---------- 工具 ---------- */
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => t.className = 'toast', 2600);
}
function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); } catch { return iso || ''; }
}

/* ---------- 视图切换 ---------- */
function switchView(v) {
  document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'dir') renderDir();
  if (v === 'me') renderMe();
  if (v === 'conn') renderConn();
}
function loggedIn() { return !!localStorage.getItem(LS.session); }
function currentUser() { return localStorage.getItem(LS.session); }

/* ---------- 连接状态徽章 ---------- */
function refreshConnStatus() {
  const c = cfg();
  const el = document.getElementById('connStatus');
  if (c.token && c.user && c.repo) { el.textContent = '已连接 ' + c.user + '/' + c.repo; el.className = 'conn-status ok'; }
  else { el.textContent = '未配置 Token'; el.className = 'conn-status bad'; }
}

/* ---------- 首页 ---------- */
function renderHome() {
  const box = document.getElementById('heroActions');
  if (loggedIn()) {
    box.innerHTML = `<span class="btn btn-primary" onclick="switchView('me')">进入我的主页</span>
      <span class="btn btn-ghost" onclick="logout()">退出登录 (${esc(currentUser())})</span>`;
  } else {
    box.innerHTML = `<span class="btn btn-primary" onclick="openAuth('login')">登录</span>
      <span class="btn" onclick="openAuth('reg')">注册</span>`;
  }
}

/* ---------- 登录 / 注册 弹窗 ---------- */
function openAuth(tab) { authTab(tab); document.getElementById('authMask').classList.add('show'); }
function closeAuth() { document.getElementById('authMask').classList.remove('show'); }
function authTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabReg').classList.toggle('active', !isLogin);
  document.getElementById('authBody').innerHTML = isLogin ? loginForm() : regForm();
}
function loginForm() {
  return `
    <div class="form-group"><label>用户名</label><input id="aUser" placeholder="用户名"></div>
    <div class="form-group"><label>密码</label><input id="aPwd" type="password" placeholder="密码"></div>
    <div class="btn-row"><button class="btn btn-primary" onclick="doLogin()">登录</button></div>
    <div class="auth-switch">还没有账号？<a onclick="authTab('reg')">去注册</a></div>`;
}
function regForm() {
  return `
    <div class="form-group"><label>用户名</label><input id="aUser" placeholder="想用的用户名"></div>
    <div class="form-group"><label>密码</label><input id="aPwd" type="password" placeholder="设置密码"></div>
    <div class="form-group"><label>确认密码</label><input id="aPwd2" type="password" placeholder="再输一次"></div>
    <div class="form-group"><label>洛谷账号（选填，无验证）</label><input id="aLuogu" placeholder="你的洛谷用户名"></div>
    <div class="btn-row"><button class="btn btn-primary" onclick="doRegister()">注册</button></div>
    <div class="auth-switch">已有账号？<a onclick="authTab('login')">去登录</a></div>`;
}
async function doLogin() {
  const u = document.getElementById('aUser').value.trim();
  const p = document.getElementById('aPwd').value;
  if (!u || !p) return toast('请填写用户名和密码', 'err');
  try {
    const { users } = await loadUsersRaw();
    const me = users.find(x => x.username === u);
    if (!me) return toast('用户不存在', 'err');
    if (me.passwordHash !== await sha256(p)) return toast('密码错误', 'err');
    localStorage.setItem(LS.session, u);
    closeAuth(); refreshConnStatus(); renderHome();
    toast('登录成功，欢迎 ' + u, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
async function doRegister() {
  const u = document.getElementById('aUser').value.trim();
  const p = document.getElementById('aPwd').value;
  const p2 = document.getElementById('aPwd2').value;
  const luogu = document.getElementById('aLuogu').value.trim();
  if (!u || !p) return toast('请填写用户名和密码', 'err');
  if (p.length < 4) return toast('密码至少 4 位', 'err');
  if (p !== p2) return toast('两次密码不一致', 'err');
  try {
    const { users, sha } = await loadUsersRaw();
    if (users.find(x => x.username === u)) return toast('用户名已被占用', 'err');
    users.push({
      username: u,
      passwordHash: await sha256(p),
      luogu: luogu,
      bio: '',
      createdAt: new Date().toISOString()
    });
    await putFile('users.json', JSON.stringify(users, null, 2), sha, 'mdqp: 注册用户 ' + u);
    localStorage.setItem(LS.session, u);
    closeAuth(); refreshConnStatus(); renderHome();
    toast('注册成功，已自动登录', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
function logout() {
  localStorage.removeItem(LS.session);
  refreshConnStatus(); renderHome(); switchView('home');
  toast('已退出登录');
}

/* ---------- 用户中心 ---------- */
async function renderMe() {
  const card = document.getElementById('meCard');
  if (!loggedIn()) {
    card.innerHTML = `<h3>我的</h3><p class="muted">请先 <a style="color:var(--primary2);cursor:pointer" onclick="openAuth('login')">登录</a> 后查看。</p>`;
    return;
  }
  try {
    const { users } = await loadUsersRaw();
    const me = users.find(x => x.username === currentUser());
    if (!me) { logout(); return; }
    card.innerHTML = `
      <h3>👤 我的主页</h3>
      <div class="kv"><span class="k">用户名</span><span class="v">${esc(me.username)}</span></div>
      <div class="kv"><span class="k">洛谷账号</span><span class="v">${me.luogu ? esc(me.luogu) : '<span style="color:var(--text2)">未关联</span>'}</span></div>
      <div class="kv"><span class="k">注册时间</span><span class="v">${fmtDate(me.createdAt)}</span></div>
      <div class="form-group" style="margin-top:16px"><label>关联洛谷账号（无验证，直接保存）</label>
        <input id="meLuogu" value="${esc(me.luogu || '')}" placeholder="填写洛谷用户名"></div>
      <div class="form-group"><label>个性签名</label>
        <textarea id="meBio" rows="2" placeholder="写点什么…">${esc(me.bio || '')}</textarea></div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="saveProfile()">保存资料</button>
        <button class="btn btn-danger" onclick="logout()">退出登录</button>
      </div>`;
  } catch (e) { card.innerHTML = `<h3>我的</h3><p class="err">${esc(e.message)}</p>`; }
}
async function saveProfile() {
  const luogu = document.getElementById('meLuogu').value.trim();
  const bio = document.getElementById('meBio').value;
  try {
    const { users, sha } = await loadUsersRaw();
    const me = users.find(x => x.username === currentUser());
    if (!me) return toast('会话已失效，请重新登录', 'err');
    me.luogu = luogu; me.bio = bio;
    await putFile('users.json', JSON.stringify(users, null, 2), sha, 'mdqp: 更新资料 ' + me.username);
    toast('资料已保存并推送到 GitHub', 'ok');
    renderMe();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 用户目录 ---------- */
async function renderDir() {
  const box = document.getElementById('dirList');
  box.innerHTML = '加载中…';
  try {
    const { users } = await loadUsersRaw();
    if (!users.length) { box.innerHTML = '<div class="empty">还没有用户，去首页注册第一个吧～</div>'; return; }
    box.innerHTML = users.map(u => `
      <div class="user-chip">
        <div class="un">${esc(u.username)}</div>
        <div class="lu">${u.luogu ? '🐟 洛谷：' + esc(u.luogu) : '<span style="color:var(--text2)">未关联洛谷</span>'}</div>
        <div class="mt">${u.bio ? esc(u.bio).slice(0, 30) : '这个人很神秘'}</div>
      </div>`).join('');
  } catch (e) { box.innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; }
}

/* ---------- 连接设置 ---------- */
function renderConn() {
  const c = cfg();
  document.getElementById('cfgUser').value = c.user;
  document.getElementById('cfgRepo').value = c.repo;
  document.getElementById('cfgBranch').value = c.branch;
  document.getElementById('cfgToken').value = c.token;
  document.getElementById('connMsg').textContent = '';
}
function saveConn() {
  localStorage.setItem(LS.user, document.getElementById('cfgUser').value.trim() || 'yanzien');
  localStorage.setItem(LS.repo, document.getElementById('cfgRepo').value.trim() || 'mdqp');
  localStorage.setItem(LS.branch, document.getElementById('cfgBranch').value.trim() || 'main');
  localStorage.setItem(LS.token, document.getElementById('cfgToken').value.trim());
  refreshConnStatus();
  document.getElementById('connMsg').className = 'msg ok';
  document.getElementById('connMsg').textContent = '已保存（仅本浏览器）。';
  toast('连接配置已保存', 'ok');
}
async function testConn() {
  const msg = document.getElementById('connMsg');
  msg.className = 'msg'; msg.textContent = '测试中…';
  try {
    const r = await getFile('users.json');
    msg.className = 'msg ok';
    msg.textContent = r ? '连接成功，已读取到 users.json' : '连接成功，但尚未创建 users.json（可注册一个用户自动创建）';
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = '连接失败：' + e.message;
  }
}

/* ---------- 启动 ---------- */
refreshConnStatus();
renderHome();
