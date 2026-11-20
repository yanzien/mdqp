#!/usr/bin/env node
/**
 * mdqp 部署后冒烟检查（ROADMAP 4.2）
 *
 * 用法：
 *   node scripts/smoke.mjs                      # 检查线上生产站
 *   node scripts/smoke.mjs https://xxx.pages.dev # 检查指定部署预览
 *   BASE=https://xxx.pages.dev node scripts/smoke.mjs
 *
 * 设计原则：
 * - 只读，不写库（避免烧 D1 读配额）
 * - 受保护接口要求 401/403，返回 404 说明路由没注册上（SPA 回退吞了）
 * - 静态产物要求含当前版本号，防止「部署成功但内容没更新」的假成功
 * - 退出码 0 = 全过；1 = 有失败项
 */

const BASE = (process.argv[2] || process.env.BASE || 'https://mdqp.pages.dev').replace(/\/$/, '');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  \x1b[2m' + detail + '\x1b[0m' : ''}`);
}
function bad(name, detail = '') {
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  ' + detail : ''}`);
}
function skip(name, why) {
  console.log(`  \x1b[33m-\x1b[0m ${name}  \x1b[2m(${why})\x1b[0m`);
}

async function req(path, opt = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      headers: opt.headers || {},
      signal: AbortSignal.timeout(opt.timeout || 20000),
    });
    const text = opt.raw ? '' : await res.text();
    return { status: res.status, text, ms: Date.now() - t0, headers: res.headers };
  } catch (e) {
    return { status: 0, text: '', ms: Date.now() - t0, err: String(e.message || e) };
  }
}

function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

// ---------- 1. 存活 ----------
section('1. 服务存活 + 版本');
const health = await req('/api/health');
let liveVersion = null;
if (health.status === 200) {
  try {
    const j = JSON.parse(health.text);
    liveVersion = j.version;
    if (j.ok) ok('/api/health', `${health.ms}ms  version=${j.version}`);
    else bad('/api/health', 'ok=false');
  } catch {
    bad('/api/health', '返回不是 JSON');
  }
} else {
  bad('/api/health', `status=${health.status} ${health.err || ''}`);
}

// ---------- 2. 公开读接口（会读 D1，确认库没挂） ----------
section('2. 公开接口（读 D1，验证数据库可用）');
for (const [path, label] of [
  ['/api/stats', '统计'],
  ['/api/pages/help', '帮助页'],
  ['/api/announcements', '公告'],
]) {
  const r = await req(path);
  if (r.status === 200 && r.text.trim().startsWith('{')) {
    ok(path, `${r.ms}ms ${r.text.length}B · ${label}`);
  } else if (r.status === 0) {
    bad(path, `网络失败 ${r.err}`);
  } else {
    bad(path, `status=${r.status} · ${label} 可能读库失败`);
  }
}

// ---------- 3a. 游客可访问接口：要 200 且结构正确 ----------
section('3a. 游客可访问接口（未登录也该 200，结构要对）');
{
  const r = await req('/api/me');
  let j = null;
  try { j = JSON.parse(r.text); } catch {}
  if (r.status === 200 && j && j.authenticated === false) ok('/api/me', '未登录 → authenticated=false');
  else if (r.status === 500) bad('/api/me', 'status=500 — 后端抛错');
  else bad('/api/me', `status=${r.status} ${r.text.slice(0, 60)}`);
}
for (const [path, key] of [['/api/clips', 'clips'], ['/api/tickets', 'tickets']]) {
  const r = await req(path);
  let j = null;
  try { j = JSON.parse(r.text); } catch {}
  if (r.status === 200 && j && Array.isArray(j[key])) ok(path, `status=200 · ${key}=${j[key].length} 条`);
  else if (r.status === 404) bad(path, 'status=404 — 路由被 SPA 回退吞掉');
  else bad(path, `status=${r.status} ${r.text.slice(0, 60)}`);
}

// ---------- 3b. 必须鉴权的接口：要 401/403，不能 404 ----------
section('3b. 必须鉴权的接口（要 401/403；404 = 路由没注册）');
for (const path of ['/api/chat/unread', '/api/admin/users', '/api/admin/quota', '/api/me/clips']) {
  const r = await req(path);
  if (r.status === 401 || r.status === 403) ok(path, `status=${r.status}`);
  else if (r.status === 404) bad(path, 'status=404 — 路由可能被 SPA 回退吞掉');
  else if (r.status === 500) bad(path, 'status=500 — 后端抛错');
  else bad(path, `status=${r.status}（预期 401/403，可能是权限放行了）`);
}

// ---------- 4. 静态产物 ----------
section('4. 静态资源与版本号一致性');
const idx = await req('/');
if (idx.status === 200) {
  const hasCss = idx.text.includes('responsive.css');
  const hasSafe = idx.text.includes('viewport-fit=cover');
  if (hasCss && hasSafe) ok('index.html 适配层', 'responsive.css + viewport-fit');
  else bad('index.html 适配层', `${hasCss ? '' : '缺 responsive.css '}${hasSafe ? '' : '缺 viewport-fit'}`);
} else bad('首页', `status=${idx.status}`);

const app = await req('/app.js');
if (app.status === 200) {
  const m = app.text.match(/当前部署版本 \*\*v([\d.]+)\*\*/);
  const jsVersion = m ? m[1] : null;
  if (jsVersion) ok('app.js 版本标记', `v${jsVersion}（${app.text.length}B）`);
  else bad('app.js 版本标记', '找不到「当前部署版本」字符串');

  if (liveVersion && jsVersion) {
    if (liveVersion === jsVersion) ok('前后端版本一致', `v${liveVersion}`);
    else bad('前后端版本一致', `worker=v${liveVersion} / app.js=v${jsVersion}`);
  }
} else bad('app.js', `status=${app.status}`);

for (const [path, label] of [
  ['/responsive.css', '适配层样式'],
  ['/manifest.webmanifest', 'PWA 清单'],
  ['/favicon.svg', '站点图标'],
]) {
  const r = await req(path);
  if (r.status === 200) ok(path, `${r.text.length}B · ${label}`);
  else bad(path, `status=${r.status}`);
}

// ---------- 5. SPA 回退 ----------
section('5. SPA 回退（深链接刷新不能 404）');
for (const path of ['/changelog', '/help', '/chat']) {
  const r = await req(path);
  if (r.status === 200 && r.text.includes('<html')) ok(path, '返回 SPA 外壳');
  else if (r.status === 200) ok(path, 'status=200 但内容可疑');
  else bad(path, `status=${r.status}`);
}

// ---------- 6. 部署链自查 ----------
section('6. 本地是否还有没部署的改动');
try {
  const { readFileSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = path.join(root, 'src/worker.js');
  const built = path.join(root, 'pages-build/_worker.js');
  const s = statSync(src);
  const b = statSync(built);
  if (b.mtimeMs >= s.mtimeMs) ok('pages-build 不落后于 src', '可直接部署');
  else bad('pages-build 落后于 src', 'src 改过但没重新 build');
  const v = readFileSync(src, 'utf8').match(/const VERSION = '([\d.]+)'/);
  if (v && liveVersion) {
    if (v[1] === liveVersion) ok('本地 VERSION 与线上一致', `v${v[1]}`);
    else bad('本地 VERSION 与线上不一致', `本地 v${v[1]} / 线上 v${liveVersion}（有改动未部署）`);
  }
} catch (e) {
  skip('本地构建自查', String(e.message || e));
}

// ---------- 汇总 ----------
console.log(`\n${'─'.repeat(52)}`);
if (fail === 0) {
  console.log(`\x1b[32m全部通过：${pass} 项\x1b[0m  base=${BASE}`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${fail} 项失败\x1b[0m / ${pass} 项通过  base=${BASE}`);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
