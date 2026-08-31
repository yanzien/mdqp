// mdqp v3.4 本地自测：签名 CRUD / bio 只读 / 管理员权限 / 剪贴板限制
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:8787';
const SECRET = 'dev-secret'; // 本地无 secret 时 getIdentity 回退到此

// ---- 复刻 auth.js 的 JWT 签发 ----
function b64urlEncodeUtf8(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}
async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64urlEncodeUtf8(JSON.stringify(header));
  const p = b64urlEncodeUtf8(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}
const tokenFor = async (userId, name = 'U', sub = 's' + userId) =>
  signJWT({ userId, sub, name, avatar: '', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

const adminTok = await tokenFor(1, 'Yanzie', 'dev-sub-0001'); // 开发者
const userTok = await tokenFor(2, '测试用户A', 'user-sub-0002');
const limitTok = await tokenFor(3, '限额用户B', 'user-sub-0003');

async function req(method, path, { body, token, guest } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (guest) h['X-Guest-Id'] = guest;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
let pass = 0, fail = 0;
function log(name, res, expectStatus, extra) {
  const ok = res.status === expectStatus;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name} → HTTP ${res.status}${ok ? '' : ` (期望 ${expectStatus})`}`);
  if (!ok) console.log('   ', JSON.stringify(res.data));
  if (extra) console.log('   ', extra);
  return res;
}

async function main() {
  console.log('=== A. 个性签名 CRUD（v3.4）===');
  const setSig = log('PATCH /api/me 设签名', await req('PATCH', '/api/me', { token: userTok, body: { signature: '热爱开源的初中生 🚀' } }), 200);
  const me = await req('GET', '/api/me', { token: userTok });
  log('GET /api/me 含 signature', me, 200, 'signature=' + JSON.stringify(me.data?.signature));
  const sigOk = me.data?.signature === '热爱开源的初中生 🚀';
  if (!sigOk) { fail++; console.log('❌ 签名未回显'); } else pass++;

  console.log('\n=== B. bio 只读（cpoauth 同步，本地不可改）===');
  // PATCH /api/me 只接受 signature；传 bio 应被拒绝(nothing_to_update)，且 bio 不变
  const tryBio = await req('PATCH', '/api/me', { token: userTok, body: { bio: '黑客乱改bio' } });
  log('PATCH /api/me 仅传 bio → 400 拒绝(正确)', tryBio, 400);
  const me2 = await req('GET', '/api/me', { token: userTok });
  const bioUntouched = me2.data?.bio === '我是测试用户';
  console.log(bioUntouched ? '✅ bio 未被本地覆盖(仍=我是测试用户)' : `❌ bio 被改了=${me2.data?.bio}`);
  if (bioUntouched) pass++; else fail++;

  console.log('\n=== C. 管理员细粒度权限 + 剪贴板限制（v3.4）===');
  const setPerm = log('PATCH /api/admin/users/2 设权限+限制', await req('PATCH', '/api/admin/users/2', {
    token: adminTok,
    body: { admin_permissions: { delete_user: true, set_clip_limit: true, edit_pages: false, edit_public_clips: true, edit_private_clips: false }, clip_limit: 5, limit_period: 'month' }
  }), 200);
  const adminList = await req('GET', '/api/admin/users', { token: adminTok });
  const u2 = adminList.data?.users?.find(u => u.id === 2);
  log('GET /api/admin/users 含 u2 限制', adminList, 200, `clip_limit=${u2?.clip_limit} period=${u2?.limit_period}`);
  const permOk = u2 && u2.clip_limit === 5 && u2.limit_period === 'month' &&
    u2.admin_permissions?.delete_user === true && !u2.admin_permissions?.edit_pages;
  if (permOk) pass++; else { fail++; console.log('❌ 权限/限制未正确落库', JSON.stringify(u2?.admin_permissions)); }

  console.log('\n=== D. 剪贴板数量限制生效（v3.4）===');
  // 给 limituser(id=3) 设上限 2
  log('PATCH /api/admin/users/3 设 clip_limit=2', await req('PATCH', '/api/admin/users/3', {
    token: adminTok, body: { clip_limit: 2, limit_period: 'forever' }
  }), 200);
  for (let i = 1; i <= 3; i++) {
    const r = await req('POST', '/api/clips', { token: limitTok, body: { title: `限额板${i}`, content: 'x' } });
    if (i <= 2) log(`limituser 创建#${i} 应200`, r, 200);
    else log(`limituser 创建#${i} 应403(超限)`, r, 403);
  }

  console.log('\n=== E. 权限键名清洗（防注入未知键）===');
  const dirty = await req('PATCH', '/api/admin/users/2', { token: adminTok, body: { admin_permissions: { delete_user: true, evil_key: true } } });
  log('PATCH 含未知权限键', dirty, 200);
  const adminList2 = await req('GET', '/api/admin/users', { token: adminTok });
  const u2b = adminList2.data?.users?.find(u => u.id === 2);
  const cleaned = u2b && u2b.admin_permissions?.evil_key === undefined;
  console.log(cleaned ? '✅ 未知权限键被丢弃(evil_key 不在)' : `❌ 注入了未知键=${JSON.stringify(u2b?.admin_permissions)}`);
  if (cleaned) pass++; else fail++;

  console.log(`\n==== 结果：PASS=${pass} FAIL=${fail} ====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
