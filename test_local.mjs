// 本地 API 全流程测试（合规长 guest id，避开残留数据）
const BASE = 'http://127.0.0.1:8787';
const G = (s) => 'guest-' + s + '-' + Math.random().toString(36).slice(2, 10); // 合规 >8 字符

async function req(method, path, { body, guest, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (guest) h['X-Guest-Id'] = guest;
  const r = await fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function log(name, res, expectStatus) {
  const ok = res.status === expectStatus;
  console.log(`${ok ? '✅' : '❌'} ${name} → HTTP ${res.status}${ok ? '' : ` (期望 ${expectStatus})`}`);
  if (!ok) console.log('   ', JSON.stringify(res.data));
  return res;
}

async function main() {
  const A = G('A'), B = G('B'), C = G('C'), D = G('D'), E = G('E'), F = G('F');

  console.log('=== 1. 游客创建 + 详情 ===');
  const r1 = log('游客A创建#1', await req('POST', '/api/clips', { guest: A, body: { title: '游客测试1', content: '# Hi\n这是**游客**剪贴板' } }), 200);
  const id1 = r1.data?.clip_id;
  console.log('   clip_id =', id1);
  const det = log('读取#1详情', await req('GET', `/api/clips/${id1}`, { guest: A }), 200);
  console.log('   title =', det.data?.title, '| editable_by_anyone =', det.data?.editable_by_anyone, '| can_edit =', det.data?.can_edit);

  console.log('\n=== 2. 游客限额（最多5）===');
  for (let i = 2; i <= 6; i++) {
    const r = await req('POST', '/api/clips', { guest: A, body: { title: `游客测试${i}`, content: 'x' } });
    if (i <= 5) log(`游客A创建#${i}`, r, 200); else log(`游客A创建#${i}(应拒403)`, r, 403);
  }

  console.log('\n=== 3. 游客板默认任何人可改 ===');
  const rB = log('游客B创建板', await req('POST', '/api/clips', { guest: B, body: { title: '游客B的板', content: '初始' } }), 200);
  const idB = rB.data?.clip_id;
  log('游客A改游客B的板(应允200)', await req('PUT', `/api/clips/${idB}`, { guest: A, body: { content: '被改' } }), 200);

  console.log('\n=== 4. 密码保护 ===');
  const rPw = log('游客D创建带密码板', await req('POST', '/api/clips', { guest: D, body: { title: '保密板', content: 'secret', password: '1234' } }), 200);
  const pwId = rPw.data?.clip_id;
  const locked = await req('GET', `/api/clips/${pwId}`, { guest: E });
  console.log(locked.status === 401 ? '✅ 无密码读取被锁(401)' : `❌ 密码未生效 ${locked.status}`);
  log('带密码读取(?pwd=1234)', await req('GET', `/api/clips/${pwId}?pwd=1234`, { guest: E }), 200);
  log('错误密码(应403)', await req('GET', `/api/clips/${pwId}?pwd=wrong`, { guest: E }), 403);

  console.log('\n=== 5. 列表 & 统计 ===');
  const list = log('首页列表', await req('GET', '/api/clips?page=1', {}), 200);
  console.log('   本页条数 =', list.data?.clips?.length, '| total =', list.data?.total);
  log('统计', await req('GET', '/api/stats', {}), 200);

  console.log('\n=== 6. 删除协作板 ===');
  log('游客A删游客B的板(应允200)', await req('DELETE', `/api/clips/${idB}`, { guest: A }), 200);
  log('删后读取(应404)', await req('GET', `/api/clips/${idB}`, { guest: A }), 404);

  console.log('\n=== 7. 自定义短链 ===');
  const rSlug = log('游客F用自定义短链 mynote', await req('POST', '/api/clips', { guest: F, body: { title: '我的笔记', content: 'slug test', custom_id: 'mynote' } }), 200);
  log('访问 /api/clips/mynote', await req('GET', '/api/clips/mynote', { guest: F }), 200);
  log('重复短链(应409)', await req('POST', '/api/clips', { guest: F, body: { title: 'x', content: 'y', custom_id: 'mynote' } }), 409);

  console.log('\n=== 8. 无身份创建（应401）===');
  log('无 X-Guest-Id 创建(应401)', await req('POST', '/api/clips', { body: { title: 'x', content: 'y' } }), 401);

  console.log('\n全部测试完成。');
}
main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
