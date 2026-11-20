/**
 * oauth.js — cpoauth 登录回调 (Hono 子路由)
 * 机密客户端（client_secret 只存在 Worker Secret 里）+ PKCE + state 防 CSRF
 */

import { Hono } from 'hono';
import { signJWT, verifyJWT, hashPassword } from './auth.js';

const SESSION_MAX_AGE = 7 * 24 * 3600; // 7 天

// v4.29：用户名字符白名单——只允许英文(a-zA-Z)、中文(\u4e00-\u9fa5)、数字(0-9)、下划线 _、连字符 -
// 说明：拒绝 "y anzie" 这类含空格的，避免仿冒混淆。\u escapes 是刻意写法（不可见字符同理）。
const USERNAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/;

// v4.29.1：敏感词/冒充词拦截
// 分两类处理，避免误伤：
//   ① 高危词——子串匹配（误伤面极小）：nazi / gay / 纳粹 / 共产党 / 国民党 / yanzie
//   ② 短词 la——词边界匹配。若按子串拦会误伤 play/land/black/class/island/palace/
//      planet/slate/flavor/clarence/Malay/translate 等几十个正常英文名（实测 25/27）。
const USERNAME_BANNED_SUBSTR = ['nazi', 'gay', '纳粹', '共产党', '国民党', '拉', '给'];
/** la 用边界匹配：前后不能是字母/数字/下划线/连字符。拦住 la、_la、la_、-la，但不拦 play、land */
const USERNAME_BANNED_WORDS = ['la'];
/** 归一化后比对：去零宽/双向字符 + 转小写，防止「yanzie+零宽」伪装绕过 */
function normalizeUserName(s) {
  return String(s || '').toLowerCase().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}
/** 命中返回命中的词（用于提示），未命中返回 null */
function checkUsernameBanned(username) {
  const n = normalizeUserName(username);
  if (!n) return null;
  // ③ yanzie 系列：站长本人ID 是「yanzien」，而 "yanzien".includes("yanzie")===true，
  //    若按子串拦会把站长自己也封掉。故只在「非 yanzien 本体」时拦：
  //    拦 yanzie / yanzie1 / yanziex / yanzienn，但放行 yanzien。
  if (n !== 'yanzien' && (n.includes('yanzie') || n.replace(/n$/, '').includes('yanzie'))) return 'yanzie';
  for (const w of USERNAME_BANNED_SUBSTR) if (n.includes(w)) return w;
  for (const w of USERNAME_BANNED_WORDS) {
    // 词边界用零宽断言（lookaround），避免"吃掉"分隔符导致 _la / -la 这类漏网
    const re = new RegExp('(?<![a-z0-9])' + w + '(?![a-z0-9])');
    if (re.test(n)) return w;
  }
  return null;
}

// ========== v4.29：IP 治理（与 worker.js 内的同名函数保持一致；不跨文件 import 以避免循环依赖）============
function ipToInt2(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  let v = 0;
  for (let i = 1; i <= 4; i++) { const p = parseInt(m[i], 10); if (p > 255) return null; v = (v * 256) + p; }
  return v >>> 0;
}
function parseCidr2(v) {
  const s = String(v || '').trim(); const i = s.indexOf('/');
  if (i < 0) return null;
  const ip = ipToInt2(s.slice(0, i)); const bits = parseInt(s.slice(i + 1), 10);
  if (ip === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, bits };
}
function cidrContains2(cidr, ip) {
  const c = parseCidr2(cidr); const v = ipToInt2(ip);
  if (!c || v === null) return false;
  if (c.bits === 0) return true;
  const mask = (0xFFFFFFFF << (32 - c.bits)) >>> 0;
  return ((v & mask) >>> 0) === c.base;
}
/** 查该 IP 是否被封；D1 故障视为未封（治理功能故障不拖垮注册） */
async function checkIpBan(db, ip) {
  if (!db || ipToInt2(ip) === null) return null;
  try {
    const rows = await db.prepare(
      "SELECT * FROM ip_bans WHERE (kind = 'ip' AND value = ?) OR (kind = 'cidr' AND (ban_until IS NULL OR ban_until > datetime('now')))"
    ).bind(ip).all();
    for (const r of (rows.results || [])) {
      if (r.kind === 'ip') return r;
      if (cidrContains2(r.value, ip)) return r;
    }
  } catch { return null; }
  return null;
}
/** 记录注册 IP（供后台 IP 治理视图）；表未迁移时静默失败，不阻断注册 */
async function recordUserIp(db, userId, ip, ua) {
  if (!db || ipToInt2(ip) === null) return;
  try {
    await db.prepare('INSERT INTO user_ips (user_id, ip, ua) VALUES (?, ?, ?)').bind(userId, ip, String(ua || '').slice(0, 200)).run();
    if (Math.random() < 0.05) await db.prepare("DELETE FROM user_ips WHERE created_at < datetime('now','-30 days')").run();
  } catch { /* ignore */ }
}

const oauthRoutes = new Hono();

/** v4.13: 判断用户当前是否被封禁（过期视为未封禁，并惰性清理） */
async function isBannedNow(db, userId) {
  const row = await db.prepare('SELECT banned, ban_until FROM users WHERE id = ?').bind(String(userId)).first();
  if (!row || !row.banned) return false;
  if (row.ban_until) {
    const t = new Date(String(row.ban_until).replace(' ', 'T') + 'Z').getTime();
    if (Date.now() >= t) {
      try { await db.prepare('UPDATE users SET banned = 0, ban_until = NULL, ban_reason = NULL WHERE id = ?').bind(String(userId)).run(); } catch { /* ignore */ }
      return false;
    }
  }
  return true;
}

const CPOAUTH = {
  authUrl: 'https://www.cpoauth.com/oauth/authorize',
  tokenUrl: 'https://www.cpoauth.com/api/oauth/token',
  userinfoUrl: 'https://www.cpoauth.com/api/oauth/userinfo',
  // cp:linked: 返回 linked_accounts（洛谷/AtCoder/Codeforces/GitHub 等绑定账号）
  // email: 返回邮箱（仅作登录标识与展示，不独立绑定流程）
  // 可用 Worker Secret CPOAUTH_SCOPE 覆盖（如 cpoauth 后台未放行某 scope 时退回 'openid profile'）
  defaultScope: 'openid profile cp:linked email'
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
  // 账号关联模式：已登录的密码用户点「绑定 cpoauth」时带 ?link=1，
  // 用短效 cookie 记住"这是关联流程"，回调后把 sub 写回当前账号而非新建
  const isLink = (c.req.query('link') || '').toString() === '1';
  const linkCookie = isLink
    ? [`mdqp_link=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`]
    : [];

  return redirectWithCookies(CPOAUTH.authUrl + '?' + params.toString(), [
    `pkce_v=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    ...inviteCookie,
    ...linkCookie
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
    'mdqp_invite=; Path=/; Max-Age=0',
    'mdqp_link=; Path=/; Max-Age=0'
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
    // 邮箱（scope email；未授权则为空）
    const email = typeof user.email === 'string' ? user.email.slice(0, 200) : '';
    const emailVerified = user.email_verified ? 1 : 0;
    const db = c.env.db;

    // ===== 账号关联模式：已登录的密码用户点「绑定 cpoauth」，
    //       把 cpoauth 的 sub 写回「当前账号」(WHERE id)，而不是新建/orphan =====
    const linkCookie = cookieHeader.match(/mdqp_link=([^;]+)/)?.[1];
    if (linkCookie) {
      const sessionM = cookieHeader.match(/mdqp_session=([^;]+)/);
      const sp = sessionM ? verifyJWT(decodeURIComponent(sessionM[1]), c.env.CPOAUTH_CLIENT_SECRET) : null;
      if (sp && sp.userId) {
        try {
          await db.prepare(
            "UPDATE users SET sub = ?, display_name = ?, avatar = ?, linked_accounts = ?, email = ?, email_verified = ?, cpoauth_refresh = ?, cpoauth_token_exp = ?, last_login = datetime('now') WHERE id = ?"
          ).bind(user.sub, name, avatar, linked, email, emailVerified, refreshToken, tokenExp, String(sp.userId)).run();
          // v4.31：cpoauth 登录也补记 IP（这是最主要的登录方式，漏了会导致 IP 治理视图看不到老号）
          try { await recordUserIp(db, sp.userId, clientIP(c), c.req.header('User-Agent') || ''); } catch {}
          await db.prepare("UPDATE clipboards SET owner_name = ? WHERE owner_type = 'user' AND owner_id = ?")
            .bind(name, String(sp.userId)).run();
          const finalRedirect = inviteCode ? `/me?linked=1&invite_code=${encodeURIComponent(inviteCode)}` : '/me?linked=1';
          return redirectWithCookies(finalRedirect, [
            'mdqp_link=; Path=/; Max-Age=0',
            'pkce_v=; Path=/; Max-Age=0',
            'oauth_state=; Path=/; Max-Age=0',
            'mdqp_invite=; Path=/; Max-Age=0'
          ]);
        } catch (e) {
          // 关联写入失败：绝不能落到下面的「新建账号」流程（那是重复建号 bug 的根因），改为报错返回
          console.error('[oauth] link-mode update failed:', (e && e.message) || e);
          return redirectWithCookies('/?error=link_failed', clearCookies);
        }
      }
      // link cookie 存在但会话已失效（登录态过期等）：直接报错返回，绝不新建账号
      return redirectWithCookies('/?error=link_expired', clearCookies);
    }

    // 纵深防御：若仍残留 link cookie（正常不会到这里），说明关联流程异常，
    // 绝不走下面的「新建账号」分支，否则会复现 TK6D11C175 重复建号。
    if (cookieHeader.match(/mdqp_link=([^;]+)/)) {
      return redirectWithCookies('/?error=link_failed', clearCookies);
    }

    const existing = await db.prepare('SELECT id, role, bio AS curBio FROM users WHERE sub = ?').bind(user.sub).first();
    // 重新登录时：cpoauth 有简介则同步，否则保留用户已在站点手动设置的 bio（不覆盖）
    const bio = cbio ? cbio.slice(0, 500) : (existing ? (existing.curBio || '') : '');
    let userId;
    if (existing) {
      await db
        .prepare("UPDATE users SET username = ?, display_name = ?, avatar = ?, linked_accounts = ?, bio = ?, email = ?, email_verified = ?, cpoauth_refresh = ?, cpoauth_token_exp = ?, last_login = datetime('now') WHERE sub = ?")
        .bind(user.username || name, name, avatar, linked, bio, email, emailVerified, refreshToken, tokenExp, user.sub)
        .run();
      userId = existing.id;
      // v4.31：老号回登录时也补记 IP
      try { await recordUserIp(db, existing.id, clientIP(c), c.req.header('User-Agent') || ''); } catch {}
      // 同步该用户历史剪贴板的冗余显示名
      await db.prepare("UPDATE clipboards SET owner_name = ? WHERE owner_type = 'user' AND owner_id = ?")
        .bind(name, String(userId)).run();
    } else {
      const r = await db
        .prepare("INSERT INTO users (sub, username, display_name, avatar, linked_accounts, bio, email, email_verified, cpoauth_refresh, cpoauth_token_exp, invite_code, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
        .bind(user.sub, user.username || name, name, avatar, linked, bio, email, emailVerified, refreshToken, tokenExp, genInviteCode())
        .run();
      userId = r.meta.last_row_id;
      // 站点首位用户 = 开发者（全新部署时自动册封）
      if (userId === 1) {
        await db.prepare("UPDATE users SET role = 'developer' WHERE id = 1").run();
      }
    }

    // v4.17: 自动加入全站总群（存量用户已加入则 INSERT OR IGNORE 跳过；总群缺失不影响登录）
    try {
      const g = await db.prepare("SELECT id FROM chat_conversations WHERE is_global = 1 LIMIT 1").first();
      if (g) await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(g.id, Number(userId)).run();
    } catch (e) { /* 聊天表尚未迁移时不阻断登录 */ }

    // v4.13: 已封禁用户禁止通过 cpoauth 登录
    if (await isBannedNow(db, userId)) {
      return redirectWithCookies('/?error=banned', clearCookies);
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

// ========== v4.28：注册节流 + 仿冒拦截 ==========
const REG_IP_COOLDOWN_MS = 3600e3;   // 同 IP 1 小时内不得注册第二个账号
const REG_SIMILAR_WINDOW_MS = 3 * 3600e3; // 3 小时内相似用户名视为疑似仿冒
const REG_SIMILARITY_THRESHOLD = 0.6;     // 相似度阈值 60%
const REG_KV_PREFIX = 'regguard:';

/** Levenshtein 编辑距离（滚动数组，空间 O(min(n,m))） */
function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 归一化相似度 0–1（1 = 完全相同）。忽略大小写与不可见字符，仿冒者常插零宽字符 */
function similarity(a, b) {
const norm = (s) => String(s || '').toLowerCase().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

/** 记录某 IP/设备最近一次注册时间（KV，零 D1 读） */
async function regGuardMark(kv, ip, deviceId) {
  if (!kv) return;
  const now = Date.now();
  const ttl = Math.ceil(REG_IP_COOLDOWN_MS / 1000) + 60;
  try {
    if (ip && ip !== 'unknown') await kv.put(REG_KV_PREFIX + 'ip:' + ip, String(now), { expirationTtl: ttl });
    if (deviceId) await kv.put(REG_KV_PREFIX + 'dev:' + deviceId, String(now), { expirationTtl: ttl });
  } catch { /* KV 不可用不阻断注册 */ }
}

/**
 * 注册前置检查。返回 null 放行；否则返回 { status, body }。
 * - 同 IP/设备 1h 内已注册过 → 429
 * - 3h 内与已有账号名相似度 ≥ 60% → 拒绝 + 管理员告警（不动老号，受害者不应被罚）
 */
async function regGuardCheck(kv, db, ip, deviceId, username) {
  const now = Date.now();
  // 1) IP / 设备冷却
  for (const [key, label] of [[ip && ip !== 'unknown' ? 'ip:' + ip : null, 'IP'], [deviceId ? 'dev:' + deviceId : null, '设备']]) {
    if (!key) continue;
    let ts = 0;
    try { ts = parseInt((await kv?.get(REG_KV_PREFIX + key)) || '0', 10) || 0; } catch { /* ignore */ }
    if (ts && now - ts < REG_IP_COOLDOWN_MS) {
      const mins = Math.ceil((REG_IP_COOLDOWN_MS - (now - ts)) / 60000);
      return { status: 429, body: { error: 'register_cooldown', message: `同一${label} 1 小时内只能注册一个账号，请 ${mins} 分钟后再试` } };
    }
  }
  // 2) 疑似仿冒：与最近注册的账号做相似度比对（uid 1/2 豁免，且绝不处罚老号）
  try {
    const recent = await db.prepare(
      'SELECT id, username, display_name, created_at FROM users WHERE id > 2 ORDER BY id DESC LIMIT 200'
    ).all();
    const rows = recent.results || [];
    for (const u of rows) {
      if (String(u.id) === '1' || String(u.id) === '2') continue;
      const ctime = Date.parse((u.created_at || '').replace(' ', 'T') + 'Z');
      if (!Number.isFinite(ctime) || now - ctime >= REG_SIMILAR_WINDOW_MS) continue;
      const score = Math.max(similarity(username, u.username), similarity(username, u.display_name || u.username));
      if (score >= REG_SIMILARITY_THRESHOLD) {
        console.warn('[reg-guard] 疑似仿冒注册被拦截', { ip, username, similarTo: u.id, similarName: u.username, score });
        return {
          status: 403,
          body: {
            error: 'similar_username',
            message: `该用户名与近期已有账号过于相似（${Math.round(score * 100)}%），为防止冒充他人已拒绝注册，请换一个用户名`
          }
        };
      }
    }
  } catch { /* 查表失败不阻断注册 */ }
  return null;
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

  // v4.28：注册前先拦——同 IP/设备 1h 冷却 + 疑似仿冒用户名（不动老号，避免罚受害者）
  const ipAddr = clientIP(c);
  // v4.29：IP / 网段封禁——被封则无法注册
  const ipBan = await checkIpBan(c.env.db, ipAddr);
  if (ipBan) {
    return c.json({
      error: 'ip_banned',
      message: '你所在的 IP 已被站长封禁' + (ipBan.reason ? `（原因：${ipBan.reason}）` : '') + (ipBan.ban_until ? `，解封时间：${ipBan.ban_until} UTC` : '（永久）')
    }, 403);
  }
  // v4.29：用户名只允许英文、中文、数字、下划线 _、连字符 -（拒绝 "y anzie" 这类含空格/奇字符）
  if (!USERNAME_RE.test(username)) {
    return c.json({ error: 'invalid_username_charset', message: '用户名只能包含英文、中文、数字、下划线 _ 和连字符 -，不能有空格或其他符号' }, 400);
  }
  // v4.29.1：敏感词 / 冒充词拦截（nazi、gay、纳粹、共产党、国民党、yanzie 系列、la、拉、给）
  const bannedWord = checkUsernameBanned(username);
  if (bannedWord) {
    return c.json({ error: 'username_banned', message: '用户名包含不允许使用的词「' + bannedWord + '」，请换一个' }, 400);
  }
  const guard = await regGuardCheck(c.env.SITE_KV, db, ipAddr, (body.device_id || '').toString().slice(0, 64), username);
  if (guard) return c.json(guard.body, guard.status);

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
  // v4.28：登记该 IP/设备的注册时间，触发 1 小时冷却
  await regGuardMark(c.env.SITE_KV, clientIP(c), (body.device_id || '').toString().slice(0, 64));
  // v4.29：记录注册 IP，供后台 IP 治理视图聚合
  await recordUserIp(db, userId, clientIP(c), c.req.header('User-Agent') || '');
  // v4.17: 新注册用户自动加入全站总群
  try {
    const g = await db.prepare("SELECT id FROM chat_conversations WHERE is_global = 1 LIMIT 1").first();
    if (g) await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(g.id, Number(userId)).run();
  } catch (e) { /* 聊天表尚未迁移时不阻断注册 */ }
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

/** 记录登录尝试。D1 不可用时静默跳过——它只是审计/限流数据，不该阻断登录 */
async function recordAttemptSafe(db, ip, username, ok) {
  try { await recordAttempt(db, ip, username, ok); } catch { /* D1 故障：跳过记录 */ }
}
async function isBannedNowSafe(db, userId) {
  try { return await isBannedNow(db, userId); } catch { return false; } // 查不到就视为未封禁
}

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
  // v4.30.1：D1 故障时放行撞库守卫——否则它读 login_attempts 会先炸，
  // 根本走不到下面的 KV 凭证缓存，登录就彻底不可用了。
  let blockedBy = null;
  try {
    blockedBy = await loginGuard(db, ip, username);
  } catch { /* D1 不可用：跳过限流，密码校验本身仍走 KV 凭证 */ }
  if (blockedBy) {
    return c.json(
      { error: 'too_many_attempts', message: `尝试过于频繁，请 ${GUARD_WINDOW_MIN} 分钟后再试` },
      429
    );
  }

  // v4.30.1：登录凭证走 KV 缓存——D1 读配额耗尽时登录仍可用。
  // 这里缓存的是"用户名 → 密码哈希"等少量字段，KV 读配额独立且远大于 D1。
  const credKey = 'cred:' + String(username).toLowerCase();
  let row = null;
  try {
    const cached = c.env.SITE_KV ? await c.env.SITE_KV.get(credKey, 'json') : null;
    if (cached) row = cached;
  } catch { /* KV 不可用则回落到 D1 */ }
  if (!row) {
    try {
      row = await db
        .prepare('SELECT id, username, display_name, avatar, password_hash, sub, banned, ban_until FROM users WHERE (username = ? OR email = ?) AND password_hash != \'\'')
        .bind(username, username)
        .first();
    } catch (e) {
      // v4.30.1：D1 与 KV 凭证都拿不到（首次登录 + D1 配额耗尽）。
      // 这时无法验证密码，**必须诚实拒绝**——绝不能因为降级就放行任何密码。
      console.error('[login] D1 与 KV 凭证均不可用，无法验证密码：', (e && e.message) || e);
      return c.json({
        error: 'service_unavailable',
        message: '站长的数据库读取额度已用尽，暂时无法验证登录。请稍后再试——这不是你的密码问题。'
      }, 503);
    }
    // 只缓存"确实是密码账号"的结果；未命中（用户不存在/非密码账号）不缓存，避免缓存脏数据
    if (row && c.env.SITE_KV) {
      try { await c.env.SITE_KV.put(credKey, JSON.stringify(row), { expirationTtl: 3600 }); } catch {}
    }
  }

  // 注意：无论"用户不存在"还是"密码错误"，都返回同一句话，避免泄露账号是否存在
  if (!row) {
    await recordAttemptSafe(db, ip, username, false);
    return c.json({ error: 'invalid_credentials', message: '用户名或密码错误' }, 401);
  }

  // v4.13: 已封禁用户禁止登录（先于密码校验，避免被封禁账号探测）
  if (await isBannedNowSafe(db, row.id)) {
    await recordAttemptSafe(db, ip, username, false);
    return c.json({ error: 'banned', message: '该账号已被封禁，无法登录' }, 403);
  }

  const ph = await hashPassword(password);
  if (!safeEqual(ph, row.password_hash || '')) {
    await recordAttemptSafe(db, ip, username, false);
    return c.json({ error: 'invalid_credentials', message: '用户名或密码错误' }, 401);
  }

  const name = row.display_name || row.username;
  const jwt = await signJWT(
    { userId: Number(row.id), sub: row.sub, name, avatar: row.avatar || '', exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE },
    c.env.CPOAUTH_CLIENT_SECRET
  );
  try { await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(row.id).run(); } catch {}
  // v4.31：登录时也补记 IP——否则 v4.29 之前注册的老号在 IP 治理视图里永远没有记录，
  // 会让管理员误以为「没有人共用 IP」，实际是数据缺失。
  try { await recordUserIp(db, row.id, ip, c.req.header('User-Agent') || ''); } catch {}
  await recordAttemptSafe(db, ip, username, true);
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
