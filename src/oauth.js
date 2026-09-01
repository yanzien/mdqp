/**
 * oauth.js — cpoauth 登录回调 (Hono 子路由)
 * 机密客户端（client_secret 只存在 Worker Secret 里）+ PKCE + state 防 CSRF
 */

import { Hono } from 'hono';
import { signJWT, verifyJWT, hashPassword } from './auth.js';

const SESSION_MAX_AGE = 7 * 24 * 3600; // 7 天

const oauthRoutes = new Hono();

const CPOAUTH = {
  authUrl: 'https://www.cpoauth.com/oauth/authorize',
  tokenUrl: 'https://www.cpoauth.com/api/oauth/token',
  userinfoUrl: 'https://www.cpoauth.com/api/oauth/userinfo',
  // cp:linked: 返回 linked_accounts（洛谷/AtCoder/Codeforces/GitHub 等绑定账号）
  // 可用 Worker Secret CPOAUTH_SCOPE 覆盖（如 cpoauth 后台未放行该 scope 时退回 'openid profile'）
  defaultScope: 'openid profile cp:linked'
};

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(len = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}
function genInviteCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of buf) s += chars[b % chars.length];
  return s;
}
async function sha256B64url(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return b64url(new Uint8Array(digest));
}

/** 多个 Set-Cookie 必须逐条 append，不能塞数组（会被拼成一条非法 header） */
function redirectWithCookies(location, cookies) {
  const headers = new Headers({ Location: location });
  for (const ck of cookies) headers.append('Set-Cookie', ck);
  return new Response(null, { status: 302, headers });
}

// 第一步：跳转 cpoauth 授权页
oauthRoutes.get('/login', async (c) => {
  if (!c.env.CPOAUTH_CLIENT_ID) return c.redirect('/?error=oauth_not_configured');

  const verifier = randomToken(32);
  const challenge = await sha256B64url(verifier);
  const state = randomToken(16);
  const redirectUri = c.env.CPOAUTH_REDIRECT_URI || new URL('/api/auth/callback', c.req.url).href;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.env.CPOAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: c.env.CPOAUTH_SCOPE || CPOAUTH.defaultScope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });

  // 邀请码透传：登录入口可能带 ?invite_code=CODE，用 cookie 暂存，
  // 回调成功后带回前端，由前端自动绑定邀请关系
  const inviteCode = (c.req.query('invite_code') || '').toString().trim();
  const inviteCookie = inviteCode
    ? [`mdqp_invite=${encodeURIComponent(inviteCode)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`]
    : [];

  return redirectWithCookies(CPOAUTH.authUrl + '?' + params.toString(), [
    `pkce_v=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    ...inviteCookie
  ]);
});

// 第二步：回调 → 换 token → userinfo → upsert 用户 → 签发会话 Cookie
oauthRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error');
  if (err) return c.redirect(`/?error=${encodeURIComponent(err)}`);
  if (!code) return c.redirect('/?error=no_code');

  const cookieHeader = c.req.header('Cookie') || '';
  const stateCookie = cookieHeader.match(/oauth_state=([^;]+)/)?.[1];
  if (!stateCookie || stateCookie !== state) return c.redirect('/?error=state_mismatch');
  const verifier = cookieHeader.match(/pkce_v=([^;]+)/)?.[1];
  if (!verifier) return c.redirect('/?error=pkce_missing');
  // 取出登录入口透传的邀请码（如有）
  const inviteCookie = cookieHeader.match(/mdqp_invite=([^;]+)/)?.[1];
  const inviteCode = inviteCookie ? decodeURIComponent(inviteCookie) : '';

  const clearCookies = [
    'pkce_v=; Path=/; Max-Age=0',
    'oauth_state=; Path=/; Max-Age=0',
    'mdqp_invite=; Path=/; Max-Age=0'
  ];

  try {
    const redirectUri = c.env.CPOAUTH_REDIRECT_URI || new URL('/api/auth/callback', c.req.url).href;

    // 换 token（有些实现只认 form 编码，失败后自动回退一次）
    const payload = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: c.env.CPOAUTH_CLIENT_ID,
      client_secret: c.env.CPOAUTH_CLIENT_SECRET,
      code_verifier: verifier
    };
    let tokenRes = await fetch(CPOAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    let token = await tokenRes.json().catch(() => ({}));
    if (!token.access_token) {
      tokenRes = await fetch(CPOAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(payload).toString()
      });
      token = await tokenRes.json().catch(() => ({}));
    }
    if (!token.access_token) {
      return redirectWithCookies('/?error=' + encodeURIComponent(token.error || 'token_failed'), clearCookies);
    }

    // 保存 refresh_token 与 access_token 过期时间，供退出登录时撤销
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : '';
    const tokenExp = token.expires_in
      ? Math.floor(Date.now() / 1000) + Number(token.expires_in)
      : 0;

    const userRes = await fetch(CPOAUTH.userinfoUrl, {
      headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' }
    });
    const user = await userRes.json().catch(() => ({}));
    if (!user.sub) return redirectWithCookies('/?error=userinfo_failed', clearCookies);

    const name = user.display_name || user.username || '用户';
    const avatar = user.avatar_url || user.avatar || '';
    // cpoauth 绑定的第三方账号（scope cp:linked；未授权该 scope 时为空数组）
    const linked = Array.isArray(user.linked_accounts) ? JSON.stringify(user.linked_accounts) : '';
    // cpoauth 个人简介：多字段兜底（不同版本 cpoauth 可能返回 bio / description / about / summary）
    const cbio = [user.bio, user.description, user.about, user.summary].find((v) => typeof v === 'string' && v.trim());
    const db = c.env.db;

    const existing = await db.prepare('SELECT id, role, bio AS curBio FROM users WHERE sub = ?').bind(user.sub).first();
    // 重新登录时：cpoauth 有简介则同步，否则保留用户已在站点手动设置的 bio（不覆盖）
    const bio = cbio ? cbio.slice(0, 500) : (existing ? (existing.curBio || '') : '');
    let userId;
    if (existing) {
      await db
        .prepare("UPDATE users SET username = ?, display_name = ?, avatar = ?, linked_accounts = ?, bio = ?, cpoauth_refresh = ?, cpoauth_token_exp = ?, last_login = datetime('now') WHERE sub = ?")
        .bind(user.username || name, name, avatar, linked, bio, refreshToken, tokenExp, user.sub)
        .run();
      userId = existing.id;
      // 同步该用户历史剪贴板的冗余显示名
      await db.prepare("UPDATE clipboards SET owner_name = ? WHERE owner_type = 'user' AND owner_id = ?")
        .bind(name, String(userId)).run();
    } else {
      const r = await db
        .prepare("INSERT INTO users (sub, username, display_name, avatar, linked_accounts, bio, cpoauth_refresh, cpoauth_token_exp, invite_code, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
        .bind(user.sub, user.username || name, name, avatar, linked, bio, refreshToken, tokenExp, genInviteCode())
        .run();
      userId = r.meta.last_row_id;
      // 站点首位用户 = 开发者（全新部署时自动册封）
      if (userId === 1) {
        await db.prepare("UPDATE users SET role = 'developer' WHERE id = 1").run();
      }
    }

    const jwt = await signJWT(
      {
        userId: Number(userId),
        sub: user.sub,
        name,
        avatar,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600
      },
      c.env.CPOAUTH_CLIENT_SECRET
    );

    const finalRedirect = inviteCode ? `/?logged_in=1&invite_code=${encodeURIComponent(inviteCode)}` : '/?logged_in=1';
    return redirectWithCookies(finalRedirect, [
      `mdqp_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`,
      ...clearCookies
    ]);
  } catch (e) {
    return redirectWithCookies('/?error=server_error', clearCookies);
  }
});

// 退出：清会话 Cookie，并尽力撤销 cpoauth 的 refresh_token（失败不能阻塞退出）
oauthRoutes.post('/logout', async (c) => {
  try {
    const cookieHeader = c.req.header('Cookie') || '';
    const m = cookieHeader.match(/mdqp_session=([^;]+)/);
    if (m) {
      const payload = verifyJWT(decodeURIComponent(m[1]), c.env.CPOAUTH_CLIENT_SECRET);
      if (payload && payload.userId) {
        const row = await c.env.db
          .prepare('SELECT cpoauth_refresh FROM users WHERE id = ?')
          .bind(payload.userId)
          .first();
        const rt = row && row.cpoauth_refresh;
        if (rt && c.env.CPOAUTH_CLIENT_ID) {
          // 尽力而为：撤销失败（cpoauth 宕机等）不阻塞退出
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4000);
          try {
            await fetch('https://www.cpoauth.com/api/oauth/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: rt,
                token_type_hint: 'refresh_token',
                client_id: c.env.CPOAUTH_CLIENT_ID,
                client_secret: c.env.CPOAUTH_CLIENT_SECRET
              })
            });
          } catch {
            /* 忽略撤销失败 */
          } finally {
            clearTimeout(timer);
          }
        }
      }
    }
  } catch {
    /* 任何异常都不影响退出 */
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'mdqp_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return new Response(JSON.stringify({ ok: true }), { headers });
});

/** 生成全局唯一邀请码（带查重，避免 UNIQUE 冲突） */
async function uniqueInviteCode(db) {
  for (let i = 0; i < 8; i++) {
    const code = genInviteCode();
    const hit = await db.prepare('SELECT id FROM users WHERE invite_code = ?').bind(code).first();
    if (!hit) return code;
  }
  return genInviteCode() + Math.floor(Math.random() * 90 + 10);
}

/** JSON 响应 + 多条 Set-Cookie（必须用 append，否则多条会被拼成一条非法 header） */
function jsonWithCookies(body, cookies, status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const ck of cookies) headers.append('Set-Cookie', ck);
  return new Response(JSON.stringify(body), { status, headers });
}

function sessionCookie(jwt) {
  return `mdqp_session=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

/** 探测可用登录方式（前端据此决定展示 cpoauth 按钮 / 降级横幅） */
oauthRoutes.get('/methods', (c) =>
  c.json({ cpoauth: !!c.env.CPOAUTH_CLIENT_ID, password: true })
);

/**
 * cpoauth 真实连通性探测（仅在用户打开登录弹窗时调用，不影响首屏）
 * 判定：能拿到任何非 5xx 响应即视为存活（ authorize 端点无参数时返回 4xx 也说明服务在）
 */
oauthRoutes.get('/cpoauth-status', async (c) => {
  if (!c.env.CPOAUTH_CLIENT_ID) return c.json({ ok: false, reason: 'not_configured' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(CPOAUTH.authUrl, { redirect: 'manual', signal: ctrl.signal });
    return c.json({ ok: r.status < 500, status: r.status });
  } catch {
    return c.json({ ok: false, reason: 'unreachable' });
  } finally {
    clearTimeout(timer);
  }
});

// ========== 密码策略 / 限流工具 ==========

const PW_MIN = 6;
/** 上限必须存在：hashPassword 是纯 SHA-256，无 KDF 拉伸，
 *  实测 20 万字符密码会让单次请求从 1.0s 涨到 4.7s（CPU 放大 ≈4.7 倍），
 *  并发即可构成 DoS。128 位足够任何正常使用。 */
const PW_MAX = 128;

/** 限流窗口与阈值 */
const GUARD_WINDOW_MIN = 15;
const GUARD_IP_MAX = 10;      // 单 IP 窗口内失败上限
const GUARD_USER_MAX = 8;     // 单账号窗口内失败上限（略低，防分布式撞库）

function clientIP(c) {
  return (
    c.req.header('CF-Connecting-IP') ||
    (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/** 恒定时间字符串比较，避免通过响应耗时逐字节试探哈希 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** 登录前检查：超过阈值直接拒绝。返回 null 表示放行 */
async function loginGuard(db, ip, username) {
  const since = `-${GUARD_WINDOW_MIN} minutes`;
  const [byIp, byUser] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS cnt FROM login_attempts WHERE ip = ? AND ok = 0 AND created_at >= datetime('now', ?)").bind(ip, since).first(),
    db.prepare("SELECT COUNT(*) AS cnt FROM login_attempts WHERE username = ? AND ok = 0 AND created_at >= datetime('now', ?)").bind(username, since).first()
  ]);
  if ((byIp?.cnt || 0) >= GUARD_IP_MAX) return 'ip';
  if ((byUser?.cnt || 0) >= GUARD_USER_MAX) return 'account';
  return null;
}

/** 记录一次尝试。ok=1 时顺带清掉该 IP 的历史失败计数 */
async function recordAttempt(db, ip, username, ok) {
  if (ok) {
    await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  } else {
    await db.prepare('INSERT INTO login_attempts (ip, username, ok) VALUES (?, ?, 0)').bind(ip, username).run();
  }
  // 概率清理，避免表无限增长（约 5% 的请求触发一次）
  if (Math.random() < 0.05) {
    await db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')").run();
  }
}

/** 密码注册（cpoauth 兜底身份，provider='password'） */
oauthRoutes.post('/password/register', async (c) => {
  const db = c.env.db;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  const username = (body.username || '').toString().trim();
  const password = (body.password || '').toString();
  const inviteCode = (body.invite_code || '').toString().trim();

  if (username.length < 2 || username.length > 20)
    return c.json({ error: 'invalid_username', message: '用户名需 2–20 个字符' }, 400);
  if (password.length < PW_MIN)
    return c.json({ error: 'weak_password', message: `密码至少 ${PW_MIN} 位` }, 400);
  if (password.length > PW_MAX)
    return c.json({ error: 'password_too_long', message: `密码最多 ${PW_MAX} 位` }, 400);

  // 用户名全局唯一（含 cpoauth 用户），避免密码登录歧义。
  // 额外做大小写查重：username 列没有 COLLATE NOCASE，登录走精确匹配，
  // 若同时存在 abc / ABC，登录将无法确定身份。
  const dup = await db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (dup) return c.json({ error: 'username_taken', message: '用户名已被占用' }, 409);

  const ph = await hashPassword(password);
  let inviterId = null;
  if (inviteCode) {
    const inv = await db.prepare('SELECT id FROM users WHERE invite_code = ?').bind(inviteCode).first();
    if (inv) inviterId = inv.id;
  }
  const r = await db
    .prepare(
      "INSERT INTO users (sub, username, display_name, provider, password_hash, invite_code, inviter_id, last_login) VALUES (NULL, ?, ?, 'password', ?, ?, ?, datetime('now'))"
    )
    .bind(username, username, ph, await uniqueInviteCode(db), inviterId)
    .run();
  const userId = r.meta.last_row_id;
  // 站点首位用户 = 开发者（全新部署时自动册封）
  if (userId === 1) await db.prepare("UPDATE users SET role = 'developer' WHERE id = 1").run();
  // 邀请关系：被邀请者绑定邀请人（仅首次）
  if (inviterId) {
    const me = await db.prepare('SELECT inviter_id FROM users WHERE id = ?').bind(String(userId)).first();
    if (me && !me.inviter_id) {
      await db.prepare('UPDATE users SET inviter_id = ? WHERE id = ?').bind(inviterId, userId).run();
      await db.prepare('UPDATE users SET invite_count = invite_count + 1 WHERE id = ?').bind(inviterId).run();
    }
  }

  const jwt = await signJWT(
    { userId: Number(userId), sub: null, name: username, avatar: '', exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE },
    c.env.CPOAUTH_CLIENT_SECRET
  );
  return jsonWithCookies({ ok: true, user: { id: Number(userId), name: username } }, [sessionCookie(jwt)]);
});

/** 密码登录 */
oauthRoutes.post('/password/login', async (c) => {
  const db = c.env.db;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  const username = (body.username || '').toString().trim();
  const password = (body.password || '').toString();
  if (!username || !password) return c.json({ error: 'missing_fields', message: '请输入用户名和密码' }, 400);
  // 先拦超长密码再做任何 hash 计算，否则等于把 CPU 放大漏洞敞开给匿名请求
  if (password.length > PW_MAX)
    return c.json({ error: 'invalid_credentials', message: '用户名或密码错误' }, 401);

  const ip = clientIP(c);
  const blockedBy = await loginGuard(db, ip, username);
  if (blockedBy) {
    return c.json(
      { error: 'too_many_attempts', message: `尝试过于频繁，请 ${GUARD_WINDOW_MIN} 分钟后再试` },
      429
    );
  }

  const row = await db
    .prepare('SELECT id, username, display_name, avatar, password_hash, sub FROM users WHERE username = ? AND password_hash != \'\'')
    .bind(username)
    .first();

  // 注意：无论"用户不存在"还是"密码错误"，都返回同一句话，避免泄露账号是否存在
  if (!row) {
    await recordAttempt(db, ip, username, false);
    return c.json({ error: 'invalid_credentials', message: '用户名或密码错误' }, 401);
  }

  const ph = await hashPassword(password);
  if (!safeEqual(ph, row.password_hash || '')) {
    await recordAttempt(db, ip, username, false);
    return c.json({ error: 'invalid_credentials', message: '用户名或密码错误' }, 401);
  }

  const name = row.display_name || row.username;
  const jwt = await signJWT(
    { userId: Number(row.id), sub: row.sub, name, avatar: row.avatar || '', exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE },
    c.env.CPOAUTH_CLIENT_SECRET
  );
  await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(row.id).run();
  await recordAttempt(db, ip, username, true);
  return jsonWithCookies({ ok: true, user: { id: Number(row.id), name } }, [sessionCookie(jwt)]);
});

/** 为已登录用户（多为 cpoauth 用户）设置/重置密码，作为 cpoauth 宕机时的兜底 */
oauthRoutes.post('/password/set', async (c) => {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/mdqp_session=([^;]+)/);
  if (!m) return c.json({ error: 'unauthorized' }, 401);
  const p = await verifyJWT(m[1], c.env.CPOAUTH_CLIENT_SECRET);
  if (!p) return c.json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const password = (body.password || '').toString();
  if (password.length < PW_MIN) return c.json({ error: 'weak_password', message: `密码至少 ${PW_MIN} 位` }, 400);
  if (password.length > PW_MAX) return c.json({ error: 'password_too_long', message: `密码最多 ${PW_MAX} 位` }, 400);

  const db = c.env.db;
  // 校验账号仍然存在：JWT 在 7 天内有效，但账号可能已被管理员删除
  const u = await db.prepare('SELECT id, username FROM users WHERE id = ?').bind(String(p.userId)).first();
  if (!u) return c.json({ error: 'account_gone', message: '账号不存在' }, 401);

  const ph = await hashPassword(password);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(ph, String(p.userId)).run();
  // 返回登录名，前端据此提示"以后可用 xxx + 密码登录"
  return c.json({ ok: true, username: u.username || '' });
});

export { oauthRoutes };
