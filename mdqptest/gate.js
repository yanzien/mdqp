// mdqptest 密码门（仅测试站使用）
// 校验口令 → 签发 HMAC token 存 localStorage → 之后所有请求带 token 头。
// 口令本身只以 SHA-256 存于源码，绝不下发到浏览器。
import app from '../src/worker.js';

// sha256('mdqptest123456')
const PW_SHA256 = '3f9dc232201a37b36e29c1620efb951a1b8ecec668eb62a61bf95629a614accd';
const TOKEN_TTL_MS = 7 * 24 * 3600e3; // 测试站令牌 7 天
const GATE_COOKIE = 'mdqptest_gate';    // 浏览器导航会自动带上；X-Gate-Token 仅供 JS fetch 用

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

// 签名密钥：与口令绑定，泄露令牌无法反推口令
const SECRET = 'mdqptest.gate.' + PW_SHA256;

const GATE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mdqp 测试站</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f1115;color:#e6e8eb;font:15px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;padding:24px}
.card{width:100%;max-width:380px;background:#171a21;border:1px solid #262b36;border-radius:14px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 22px;color:#8b93a1;font-size:13px}
label{display:block;font-size:13px;color:#8b93a1;margin-bottom:6px}
input{width:100%;padding:11px 13px;background:#0f1115;border:1px solid #2c323e;border-radius:9px;color:#e6e8eb;font-size:15px;outline:none}
input:focus{border-color:#4f46e5}
button{width:100%;margin-top:16px;padding:11px;background:#4f46e5;color:#fff;border:0;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#4338ca}
.err{margin-top:14px;color:#f87171;font-size:13px;min-height:18px}
.badge{display:inline-block;font-size:11px;font-weight:600;color:#fbbf24;border:1px solid #4a3c14;background:#241d09;border-radius:999px;padding:2px 9px;margin-bottom:14px}
</style></head><body><div class="card">
<span class="badge">仅供站长测试</span>
<h1>mdqp 测试站</h1>
<p>独立数据库，与主站数据完全隔离。请输入口令进入。</p>
<label for="pw">访问口令</label>
<input id="pw" type="password" autocomplete="current-password" placeholder="请输入口令" autofocus>
<button id="go">进入测试站</button>
<div class="err" id="err"></div>
</div><script>
const KEY='mdqptest_gate_tk';
const goBtn=document.getElementById('go');
const pwEl=document.getElementById('pw');
const errEl=document.getElementById('err');
let busy=false;   // 避免重复提交，看起来像"没反应"
async function submit(){
  if(busy)return;
  errEl.textContent='';
  const pw=pwEl.value;
  if(!pw){errEl.textContent='请输入口令';pwEl.focus();return;}
  busy=true; goBtn.disabled=true; goBtn.textContent='正在进入…';
  try{
    const r=await fetch('/__gate/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.token){
      localStorage.setItem(KEY,d.token);
      goBtn.textContent='验证通过，正在打开…';
      // Cookie 已由服务端 Set-Cookie 下发；直接跳转，不再 reload
      location.replace('/');
    }else{
      errEl.textContent=d.message||'口令错误';
      pwEl.select();
      busy=false; goBtn.disabled=false; goBtn.textContent='进入测试站';
    }
  }catch(e){
    errEl.textContent='网络异常，请重试';
    busy=false; goBtn.disabled=false; goBtn.textContent='进入测试站';
  }
}
goBtn.onclick=submit;
pwEl.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
pwEl.focus();
</script></body></html>`;

const gateApp = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) 解锁接口
    if (url.pathname === '/__gate/unlock' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const got = await sha256Hex(String(body.password || ''));
      if (got !== PW_SHA256) {
        return new Response(JSON.stringify({ ok: false, message: '口令错误' }), {
          status: 401, headers: { 'Content-Type': 'application/json' }
        });
      }
      // 签发 HMAC 签名令牌：payload.exp + 签名
      const payload = { exp: Date.now() + TOKEN_TTL_MS };
      const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
      const sig = await hmacHex(SECRET, payloadB64);
      const token = payloadB64 + '.' + sig;
      // ⚠️ 必须下发 Cookie：浏览器原生导航（刷新/地址栏/分享链接）不会带自定义头，
      //    只靠 X-Gate-Token 的话 reload 后会被重新拦回门页（表现为"输对口令没反应"）。
      return new Response(JSON.stringify({ ok: true, token }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Set-Cookie': `${GATE_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    // 静态资源（css/js/图片）放行，避免未进门就拿不到门页样式
    if (/\.(css|js|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|map)$/i.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // 2) 校验令牌：优先读 Cookie（浏览器导航会带），回退到 X-Gate-Token（JS fetch 用）
    const cookieTok = (request.headers.get('Cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(GATE_COOKIE + '='))
      .map((s) => decodeURIComponent(s.slice(GATE_COOKIE.length + 1)))
      .find(Boolean) || '';
    const token = cookieTok || request.headers.get('X-Gate-Token') || '';
    let ok = false;
    if (token.includes('.')) {
      const [p, s] = token.split('.');
      if (p && s && (await hmacHex(SECRET, p)) === s) {
        try {
          const pl = JSON.parse(new TextDecoder().decode(fromB64url(p)));
          ok = Number(pl.exp) > Date.now();
        } catch { ok = false; }
      }
    }

    if (!ok) {
      // 门页本身也由 worker 返回，不依赖 ASSETS
      return new Response(GATE_HTML, {
        status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    // 3) 通过 → 委托主 worker（除门相关路径）
    return app.fetch(request, env, ctx);
  }
};

export default gateApp;