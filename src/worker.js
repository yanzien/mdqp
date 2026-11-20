/**
 * mdqp v4.0 — Cloudflare Worker (Hono + D1)
 *
 * 权限模型 v4.0:
 *  - 登录用户(cpoauth): 日限5/月限50剪贴板；每板字数按信任等级分级（L0/L1 1500、L2 5000、L3/VIP/站长不限，防滥用硬顶 20000 等效字）；功能开关可单独关闭
 *  - 游客(未登录): 周限5个；协作板；按设备指纹算唯一读者
 *  - VIP: 金色标识，管理员授予
 *  - 邀请系统: 邀请码+链接，tier 奖励自动发放
 *  - 评论: 登录可用，50字/条，支持 @mention
 *  - 公告: 管理员编辑，首页置顶
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyJWT, signJWT, hashPassword } from './auth.js';
import { oauthRoutes } from './oauth.js';

const app = new Hono();

const GUEST_LIMIT = 5;
const PAGE_SIZE = 20;
const VERSION = '4.34.0';
const SEARCH_MAX = 100;
const RESERVED = new Set([
  'api', 'raw', 'new', 'edit', 'u', 'user', 'users', 'admin', 'login', 'logout',
  'about', 'help', 'doc', 'docs', 'static', 'assets', 'index', 'favicon', 'robots', 'clip',
  'c', 'invite', 'invites', 'comments', 'announcements'
]);

// 高级功能列表（feature_flags 的 key 列表）
const FEATURE_KEYS = ['custom_slug', 'max_views', 'password', 'expiry', 'collaboration', 'login_required', 'max_readers', 'comments'];
// 默认功能开关（custom_slug 和 max_readers 默认关闭）
const DEFAULT_FEATURES = { custom_slug: 0, max_views: 1, password: 1, expiry: 1, collaboration: 1, login_required: 1, max_readers: 0, comments: 1 };

app.use('/api/*', cors());

// ========== 全局 API 中间件（必须注册在所有 app.get/post 之前！） ==========
// ⚠️ v4.31.6 教训：Hono 按**注册顺序**执行处理器。中间件若注册在路由之后，
//    路由 handler 直接返回响应、链条终止 → 中间件永不执行，静默失效。
//    这两个中间件曾因此双双沦为死代码（表现为 IP 封禁不生效 + 额度恒为 0）。

// --- ① IP / 网段封禁（注册/登录路径的拦截另在 oauth.js 里做）---
// 封禁列表在隔离实例内缓存 60s：否则每个 API 请求都要 SELECT 一次 ip_bans，
// 这正是拖垮 D1 读额度的开销；封禁是低频管理操作，1 分钟生效延迟可接受。
let _ipBanCache = { at: 0, list: [] };

// v4.32.x：昵称（display_name）改名复用注册时的用户名限制，防止仿冒/脏词/非法字符卡 bug
// 与 oauth.js 保持一致（不跨文件 import，避免循环依赖）
const USERNAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/;
const USERNAME_BANNED_SUBSTR = ['nazi', 'gay', '纳粹', '共产党', '国民党', '拉', '给'];
const USERNAME_BANNED_WORDS = ['la'];
function normalizeUserName(s) {
  return String(s || '').toLowerCase().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}
function checkUsernameBanned(username) {
  const n = normalizeUserName(username);
  if (!n) return null;
  if (n !== 'yanzien' && (n.includes('yanzie') || n.replace(/n$/, '').includes('yanzie'))) return 'yanzie';
  for (const w of USERNAME_BANNED_SUBSTR) if (n.includes(w)) return w;
  for (const w of USERNAME_BANNED_WORDS) {
    const re = new RegExp('(?<![a-z0-9])' + w + '(?![a-z0-9])');
    if (re.test(n)) return w;
  }
  return null;
}
async function ipBansCached(db) {
  const now = Date.now();
  if (now - _ipBanCache.at < 60_000) return _ipBanCache.list;
  try {
    const rows = await db.prepare('SELECT id, kind, value, reason, ban_until FROM ip_bans').all();
    _ipBanCache = { at: now, list: rows.results || [] };
  } catch { /* 查询失败沿用旧缓存，避免因故障误封 */ }
  return _ipBanCache.list;
}
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // 放行健康检查与治理端点本身，否则管理员无法自救
  if (path === '/api/health' || path.startsWith('/api/admin/ip-bans')) return next();
  const ip = clientIp(c);
  let ban = null;
  if (ip && c.env.db) {
    const list = await ipBansCached(c.env.db);
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const r of list) {
      if (r.ban_until && String(r.ban_until) <= nowStr) continue; // 已过期
      if (r.kind === 'ip' && r.value === ip) { ban = r; break; }
      if (r.kind === 'cidr' && cidrContains(r.value, ip)) { ban = r; break; }
    }
  }
  if (!ban) return next();
  const until = ban.ban_until ? String(ban.ban_until).replace(' ', 'T') + 'Z' : null;
  const msg = '你所在的 IP 已被封禁' + (ban.reason ? `（原因：${ban.reason}）` : '') + (until ? `，解封时间：${until}（UTC）` : '（永久）');
  return c.json({ error: 'ip_banned', message: msg, ban_until: until }, 403);
});

// --- ② 配额计量 + 定期落盘 + 超阈值自动刹车 ---
// 放在 IP 封禁中间件**之后**，这样被封 IP 的请求不计入统计（它们本来也打不到 D1）。
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // 计量：D1 读接口按经验行数估，KV/健康检查等按 0（不烧 D1）
  // 估算口径偏保守（宁可高估），确保不会真的撞到上限才发现。
  const D1_COST = {
    '/api/clips': 60, '/api/me': 30, '/api/stats': 80,
    '/api/chat/conversations': 40, '/api/chat/unread': 60,
    '/api/admin/users': 120, '/api/admin/ip-groups': 90, '/api/admin/chat-conversations': 90
  };
  let rows = 0;
  for (const [prefix, cost] of Object.entries(D1_COST)) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) { rows = cost; break; }
  }
  if (rows) quotaAddD1(c.env.SITE_KV, rows);

  await next();

  // 响应后：落盘（内部限流到每分钟一次）+ 超阈值刹车
  try { await quotaFlush(c.env.SITE_KV); } catch {}
  if (rows && _quotaState.trip !== 1) { try { await quotaAutoTrip(c.env.SITE_KV, c.env.db); } catch {} }
});


// ========== 工具函数 ==========

function genClipId(len = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of buf) s += chars[b % chars.length];
  return s;
}

function genInviteCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of buf) s += chars[b % chars.length];
  return s;
}

function validSlug(s) {
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(s) && !RESERVED.has(s);
}

function parseExpiry(v) {
  if (!v || v === 'never') return null;
  const map = { '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000 };
  if (map[v]) return new Date(Date.now() + map[v] * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  return null;
}

function isExpired(row) {
  if (row.expires_at && new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) return true;
  // v4.0: 同时检查唯一读者上限
  if (row.max_readers > 0 && row.reader_count >= row.max_readers) return true;
  // 旧版兼容：阅读次数
  if (row.max_views > 0 && row.views >= row.max_views) return true;
  return false;
}

function makePreview(content) {
  return (content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_`~\[\]()>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/**
 * 字数统计：非英文字符（CJK 等）= 1，英文字符及标点 = 0.5
 * 返回「等效字数」（向上取整）
 */
function countChars(text) {
  if (!text) return 0;
  let score = 0;
  for (const ch of text) {
    // 非 ASCII 字符（CJK、emoji 等）= 1
    if (ch.charCodeAt(0) > 127) { score += 1; continue; }
    // ASCII 字母和数字 = 0.5
    if (/[a-zA-Z0-9]/.test(ch)) { score += 0.5; continue; }
    // 标点符号等 = 0.5
    score += 0.5;
  }
  return Math.ceil(score);
}

/** 生成访客指纹（基于请求头 hash） */
function guestFingerprint(req) {
  const ua = req.headers.get('User-Agent') || '';
  const lang = req.headers.get('Accept-Language') || '';
  const enc = req.headers.get('Accept-Encoding') || '';
  const raw = ua + '|' + lang + '|' + enc;
  // 简单 hash（生产环境建议用更 robust 的方案）
  let h = 2166136261 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 'fp-' + h.toString(36);
}

async function getIdentity(c) {
  const req = c.req.raw;
  const cookie = req.headers.get('Cookie') || '';
  const secret = c.env.CPOAUTH_CLIENT_SECRET || 'dev-secret';

  const sessionMatch = cookie.match(/mdqp_session=([^;]+)/);
  if (sessionMatch) {
    const p = await verifyJWT(sessionMatch[1], secret);
    if (p) {
      const ban = await getBanStatus(c.env.db, p.userId, c.env.SITE_KV);
      if (ban) return { type: 'banned', userId: p.userId, banReason: ban.reason, banUntil: ban.until };
      return { type: 'user', userId: p.userId, sub: p.sub, name: p.name, avatar: p.avatar };
    }
  }
  const auth = req.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const p = await verifyJWT(auth.slice(7), secret);
    if (p) {
      const ban = await getBanStatus(c.env.db, p.userId, c.env.SITE_KV);
      if (ban) return { type: 'banned', userId: p.userId, banReason: ban.reason, banUntil: ban.until };
      return { type: 'user', userId: p.userId, sub: p.sub, name: p.name, avatar: p.avatar };
    }
  }
  const guestId = req.headers.get('X-Guest-Id');
  if (guestId && /^[a-zA-Z0-9-]{8,64}$/.test(guestId)) return { type: 'guest', guestId, name: '游客' };
  return { type: 'none' };
}

/** v4.13: 查询用户当前是否处于「生效中的封禁」。
 *  v4.30：加 KV 缓存（60s）——封禁判定是**全站每个 API 请求的固定开销**，
 *  包括高频的聊天轮询，每次都 SELECT users 表会白白吃掉大量读配额。
 *  封禁是低频变更，缓存 60s 完全可接受；后台改封禁时会主动失效。
 *  过期（ban_until 已过）视为未封禁，并惰性清理，避免反复判定。返回 {reason, until} 或 null。 */
async function getBanStatus(db, userId, kv) {
  if (!userId) return null;
  const ck = 'ban:' + userId;
  if (kv) {
    const cached = await cacheGet(kv, ck);
    if (cached && typeof cached === 'object') {
      if (!cached.banned) return null;
      if (!cached.until) return { reason: cached.reason || '', until: null };
      const t = new Date(String(cached.until).replace(' ', 'T') + 'Z').getTime();
      if (Number.isFinite(t) && t > Date.now()) return { reason: cached.reason || '', until: cached.until };
      // 缓存里已过期：惰性清理
      try { await cachePut(kv, ck, { banned: 0 }, 60); } catch {}
      return null;
    }
  }
  const u = await db.prepare('SELECT banned, ban_until, ban_reason FROM users WHERE id = ?').bind(String(userId)).first();
  if (!u || !u.banned) { if (kv) await cachePut(kv, ck, { banned: 0 }, 60); return null; }
  if (u.ban_until) {
    const t = new Date(String(u.ban_until).replace(' ', 'T') + 'Z').getTime();
    if (Date.now() >= t) {
      try { await db.prepare('UPDATE users SET banned = 0, ban_until = NULL, ban_reason = NULL WHERE id = ?').bind(String(userId)).run(); } catch { /* ignore */ }
      if (kv) await cachePut(kv, ck, { banned: 0 }, 60);
      return null;
    }
  }
  if (kv) await cachePut(kv, ck, { banned: 1, reason: u.ban_reason || '', until: u.ban_until || null }, 60);
  return { reason: u.ban_reason || '', until: u.ban_until || null };
}

function canWrite(identity, row) {
  if (row.editable_by_anyone) return identity.type !== 'none';
  if (identity.type === 'user') return String(identity.userId) === String(row.owner_id) && row.owner_type === 'user';
  if (identity.type === 'guest') return String(identity.guestId) === String(row.owner_id) && row.owner_type === 'guest';
  return false;
}

function isOwner(identity, row) {
  if (identity.type === 'user') return row.owner_type === 'user' && String(identity.userId) === String(row.owner_id);
  if (identity.type === 'guest') return row.owner_type === 'guest' && String(identity.guestId) === String(row.owner_id);
  return false;
}

async function isAdminIdentity(db, identity) {
  if (identity.type !== 'user') return false;
  const u = await db.prepare('SELECT role FROM users WHERE id = ?').bind(String(identity.userId)).first();
  return !!u && (u.role === 'admin' || u.role === 'developer');
}

/** v4.15.3: 管理员上下文的**唯一取数入口**（role / level / 归一化权限）
 *  ⚠️ 任何需要判断或展示管理员权限的地方都必须走这里，不要在别处手写 SELECT 列清单：
 *  列清单漏写 admin_permissions 会让 readPerms(undefined) 静默兜底成「全 false」，
 *  表现为"权限已授予但按钮全灰 / 代码页只读"——此坑已在 v4.15.1(admin_level)、v4.15.3(admin_permissions) 各犯一次。 */
async function getAdminContext(db, userId) {
  const r = await db.prepare('SELECT role, admin_level, admin_permissions FROM users WHERE id = ?').bind(String(userId)).first();
  return {
    role: r?.role || 'user',
    level: adminLevelOf(r?.role, r?.admin_level),
    perms: readPerms(r?.admin_permissions)
  };
}

/** 检查管理员是否有某项管理权限 */
async function hasAdminPerm(db, identity, perm) {
  if (identity.type !== 'user') return false;
  if (!ALL_PERMS.includes(perm)) return false; // 未知权限一律拒绝
  const ctx = await getAdminContext(db, identity.userId);
  if (ctx.role === 'developer') return true; // 开发者拥有所有权限
  if (ctx.role !== 'admin') return false;
  return !!ctx.perms[perm];
}

/** v4.21：管理员「任一」权限命中即放行（避免重复查库） */
async function hasAnyAdminPerm(db, identity, perms) {
  if (identity.type !== 'user') return false;
  const ctx = await getAdminContext(db, identity.userId);
  if (ctx.role === 'developer') return true;
  if (ctx.role !== 'admin') return false;
  return perms.some((p) => !!ctx.perms[p]);
}

/** v4.21：按剪贴板可见性判定管理员权限——action ∈ view|edit|delete，
 *  公开板查 {action}_public_clips，私有板查 {action}_private_clips。
 *  私有剪贴板是最高敏感数据，只有被显式授予 private 系列权限的管理员才可触碰。 */
async function hasAdminClipPerm(db, identity, row, action) {
  if (identity.type !== 'user') return false;
  const ctx = await getAdminContext(db, identity.userId);
  if (ctx.role === 'developer') return true;
  if (ctx.role !== 'admin') return false;
  const scope = row && row.is_public ? 'public' : 'private';
  return !!ctx.perms[action + '_' + scope + '_clips'];
}

function parseLinkedAccounts(s) {
  if (!s) return [];
  try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

function parseAdminPerms(s) {
  if (!s) return {};
  try { return typeof s === 'object' ? s : JSON.parse(s); } catch { return {}; }
}

function parseFeatureFlags(s) {
  if (!s) return { ...DEFAULT_FEATURES };
  try { const f = typeof s === 'object' ? s : JSON.parse(s); return { ...DEFAULT_FEATURES, ...f }; } catch { return { ...DEFAULT_FEATURES }; }
}

function parseJSON(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** v4.6: 标签解析（存 "a,b,c" 逗号分隔，输出去重后的小写数组） */
function parseTags(s) {
  if (!s) return [];
  return String(s).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 30);
}
/** v4.6: 标签序列化（去空、去重、限长，返回 "a,b,c"） */
function serializeTags(arr, maxTags) {
  if (!Array.isArray(arr)) return '';
  const clean = [];
  for (const raw of arr) {
    const t = String(raw || '').trim().toLowerCase().replace(/[,，\s]+/g, '-').slice(0, 20);
    if (t && !clean.includes(t)) clean.push(t);
  }
  return clean.slice(0, maxTags > 0 ? maxTags : 30).join(',');
}

/** 信任等级（v4.5.2 起为「维持制」：高等级需持续活跃，不达标会自动回落，但不发降级通知）
 *  0 新手上路 · 1 常驻用户 · 2 活跃用户 · 3 核心用户
 *  入参：clip_count 总板数 / clips_14d 近 14 天新建 / clips_5d 近 5 天新建 / invite_count / created_at / role */
function computeTrustLevel(u) {
  const clips = u.clip_count || 0;
  const c14 = u.clips_14d || 0;
  const c5 = u.clips_5d || 0;
  const invites = u.invite_count || 0;
  const ageDays = u.created_at ? Math.max(0, (Date.now() - new Date(u.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000) : 0;
  const isStaff = u.role === 'admin' || u.role === 'developer';
  let tl = 0;
  // L1 常驻：有过产出，或注册满 1 天
  if (clips >= 1 || ageDays >= 1) tl = 1;
  // L2 活跃：每 2 周 ≥5 个剪贴板 + 至少邀请 1 位好友
  if (c14 >= TRUST_REQ.L2.clips_14d && invites >= TRUST_REQ.L2.invites) tl = 2;
  // L3 核心：满足 L2 全部条件 + 每 5 天 ≥1 个剪贴板 + 邀请 ≥3 人
  if (c14 >= TRUST_REQ.L2.clips_14d && c5 >= TRUST_REQ.L3.clips_5d && invites >= TRUST_REQ.L3.invites) tl = 3;
  // 站长 / 开发者角色恒为核心
  if (isStaff) tl = Math.max(tl, 3);
  return tl;
}
const TRUST_LABELS = ['新手上路', '常驻用户', '活跃用户', '核心用户'];
/** 各等级硬指标（调规则只改这里） */
const TRUST_REQ = {
  L2: { clips_14d: 5, invites: 1 },
  L3: { clips_5d: 1, invites: 3 }
};
const TRUST_RULE_TEXT = [
  '默认等级，无需任何条件',
  '创建过 1 个剪贴板，或注册满 1 天',
  '每 2 周创建 ≥5 个剪贴板，且邀请 ≥1 位好友',
  '满足活跃用户全部条件，且每 5 天创建 ≥1 个剪贴板、邀请 ≥3 位好友'
];

/* ============ v4.6 权益矩阵：让等级「有赏有罚」 ============
 * 设计原则：
 *   · L1 就有「信任类」权益（导出数据、版本历史）——门槛低，给安全感
 *   · L2 起才有「权重类」权益（字数、日/月限额、自定义短链、标签）——活跃才配得更多
 *   · VIP / 站长 / 开发者 = 全档拉满，且字数不受硬分级限制
 * -1 表示「不限」。HARD_CHAR_CAP 是防滥用硬顶，任何人都不能越过。 */
const HARD_CHAR_CAP = 20000;
const BENEFITS = {
  0: { char: 1500, daily: 5, monthly: 50, tags: 3, private_clips: 50, revisions: 0, custom_slug: false, export_data: false, badge: false },
  1: { char: 1500, daily: 10, monthly: 100, tags: 10, private_clips: 200, revisions: 3, custom_slug: false, export_data: true, badge: false },
  2: { char: 5000, daily: 20, monthly: 300, tags: 30, private_clips: 1000, revisions: 10, custom_slug: true, export_data: true, badge: true },
  3: { char: -1, daily: 50, monthly: 800, tags: -1, private_clips: -1, revisions: 50, custom_slug: true, export_data: true, badge: true }
};
const BENEFIT_META = [
  { key: 'char', label: '单篇字数', unit: ' 等效字' },
  { key: 'daily', label: '每日新建', unit: ' 个' },
  { key: 'monthly', label: '每月新建', unit: ' 个' },
  { key: 'private_clips', label: '私有板容量', unit: ' 个' },
  { key: 'tags', label: '标签数上限', unit: ' 个/篇' },
  { key: 'revisions', label: '版本历史', unit: ' 版' },
  { key: 'custom_slug', label: '自定义短链', unit: '' },
  { key: 'export_data', label: '导出全部数据', unit: '' },
  { key: 'badge', label: '专属徽章', unit: '' }
];

/** 取某身份的权益；VIP / 站长 / 开发者一律拉满 */
function benefitsFor(level, isVip, isStaff) {
  const lv = Math.max(0, Math.min(3, Number(level) || 0));
  const b = Object.assign({}, BENEFITS[isStaff ? 3 : lv]);
  if (isVip || isStaff) {
    b.char = -1; b.daily = -1; b.monthly = -1; b.tags = -1;
    b.private_clips = -1; b.revisions = -1;
    b.custom_slug = true; b.export_data = true; b.badge = true;
  }
  return b;
}
/** -1 → '不限'；布尔 → ✅/❌ */
function fmtBenefit(v, unit) {
  if (v === -1) return '不限';
  if (typeof v === 'boolean') return v ? '✅' : '❌';
  return v + (unit || '');
}
/** 权益明细（前端直接渲染） */
function benefitList(b) {
  return BENEFIT_META.map((m) => ({ key: m.key, label: m.label, value: fmtBenefit(b[m.key], m.unit) }));
}
/** 升到下一级能解锁什么（只列有提升的项） */
function nextLevelUnlocks(level, isVip, isStaff) {
  if (isVip || isStaff || level >= 3) return [];
  const cur = benefitsFor(level, false, false), nxt = benefitsFor(level + 1, false, false);
  return BENEFIT_META.filter((m) => cur[m.key] !== nxt[m.key])
    .map((m) => `${m.label}：${fmtBenefit(cur[m.key], m.unit)} → ${fmtBenefit(nxt[m.key], m.unit)}`);
}
/** 字数上限（-1 视为不限，但仍受 HARD_CHAR_CAP 硬顶约束） */
function charLimitOf(b) { return b.char === -1 ? HARD_CHAR_CAP : b.char; }

/** v4.6: 组装信任等级入参（查一次用户 + 一次窗口统计），供 computeTrustLevel 使用 */
async function buildTrustBase(db, userId) {
  const u = await db.prepare('SELECT created_at, invite_count, is_vip, role FROM users WHERE id = ?').bind(String(userId)).first();
  const st = await getTrustStats(db, userId);
  return {
    clip_count: st.total, clips_14d: st.c14, clips_5d: st.c5,
    created_at: u?.created_at, invite_count: u?.invite_count || 0,
    is_vip: !!u?.is_vip, role: u?.role
  };
}

/** v4.6: 解析身份的完整权益包（含信任等级），一处算好到处用
 *  @returns {{level:number, isVip:boolean, isStaff:boolean, benefits:object, charLimit:number, unlimited:boolean}} */
async function resolveBenefits(db, identity, trustBase) {
  const isVip = await isVipIdentity(db, identity);
  const isStaff = await isAdminIdentity(db, identity);
  const level = trustBase ? computeTrustLevel(trustBase) : 0;
  const benefits = benefitsFor(level, isVip, isStaff);
  // 邀请奖励：unlimited_chars 标记同样拉满单篇字数
  if (identity && identity.type === 'user' && identity.userId) {
    try {
      const ff = await getUserFeatures(db, identity.userId);
      if (ff && ff.unlimited_chars) benefits.char = -1;
    } catch (_) { /* 忽略：取权益失败不阻断主流程 */ }
  }
  return { level, isVip, isStaff, benefits, charLimit: charLimitOf(benefits), unlimited: benefits.char === -1 };
}

/** 统计窗口期内的剪贴板数（created_at 存 UTC 'YYYY-MM-DD HH:MM:SS'） */
async function getTrustStats(db, userId) {
  const now = Date.now();
  const d14 = new Date(now - 14 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const d5 = new Date(now - 5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  try {
    const r = await db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS c14,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS c5
       FROM clipboards WHERE owner_type='user' AND owner_id=?`
    ).bind(d14, d5, String(userId)).first();
    return { total: Number(r?.total || 0), c14: Number(r?.c14 || 0), c5: Number(r?.c5 || 0) };
  } catch {
    return { total: 0, c14: 0, c5: 0 };
  }
}

/** 距离下一等级还差什么（前端展示进度用） */
function trustNextMissing(u, level) {
  if (level >= 3) return [];
  const c14 = u.clips_14d || 0, c5 = u.clips_5d || 0, inv = u.invite_count || 0;
  const m = [];
  if (c14 < TRUST_REQ.L2.clips_14d) m.push(`近 14 天还需创建 ${TRUST_REQ.L2.clips_14d - c14} 个剪贴板（${c14}/${TRUST_REQ.L2.clips_14d}）`);
  if (inv < TRUST_REQ.L2.invites) m.push(`还需邀请 ${TRUST_REQ.L2.invites - inv} 位好友（${inv}/${TRUST_REQ.L2.invites}）`);
  if (level < 2) return m; // L0/L1 先看 L2
  if (c5 < TRUST_REQ.L3.clips_5d) m.push(`近 5 天还需创建 ${TRUST_REQ.L3.clips_5d - c5} 个剪贴板（${c5}/${TRUST_REQ.L3.clips_5d}）`);
  if (inv < TRUST_REQ.L3.invites) m.push(`还需再邀请 ${TRUST_REQ.L3.invites - inv} 位好友（${inv}/${TRUST_REQ.L3.invites}）`);
  return m;
}

/** 组装前端用的信任等级进度对象 */
function trustProgress(u, level) {
  return {
    level,
    label: TRUST_LABELS[level] || ('L' + level),
    rule: TRUST_RULE_TEXT[level] || '',
    next_rule: level < 3 ? (TRUST_RULE_TEXT[level + 1] || '') : '',
    clips_14d: u.clips_14d || 0,
    clips_5d: u.clips_5d || 0,
    invite_count: u.invite_count || 0,
    missing: trustNextMissing(u, level)
  };
}

/** 写入一条通知（失败不应阻断主流程） */
async function createNotification(db, userId, category, title, body = '', link = '') {
  try {
    await db.prepare(
      'INSERT INTO notifications (user_id, category, title, body, link) VALUES (?, ?, ?, ?, ?)'
    ).bind(Number(userId), category, String(title).slice(0, 200), String(body || '').slice(0, 500), String(link || '').slice(0, 300)).run();
  } catch (e) { /* 通知写入失败不影响主流程 */ }
}

/** 懒检测信任等级提升并通知（仅在提升时写，避免重复；失败不影响调用方） */
async function notifyTrustUpgrade(db, userId) {
  try {
    const u = await db.prepare('SELECT created_at, invite_count, is_vip, role, last_trust_level FROM users WHERE id = ?').bind(String(userId)).first();
    if (!u) return;
    const st = await getTrustStats(db, userId);
    const base = { clip_count: st.total, clips_14d: st.c14, clips_5d: st.c5, created_at: u.created_at, invite_count: u.invite_count || 0, is_vip: !!u.is_vip, role: u.role };
    const tl = computeTrustLevel(base);
    const prev = u.last_trust_level || 0;
    if (tl > prev) {
      await createNotification(db, userId, 'trust', '🎉 信用等级提升至 ' + (TRUST_LABELS[tl] || ('L' + tl)), '你在 mdqp 的贡献获得了更高信任等级，解锁更多权益。', '/me');
      await db.prepare('UPDATE users SET last_trust_level = ? WHERE id = ?').bind(tl, String(userId)).run();
    }
  } catch (e) { /* 通知系统故障不阻断主流程 */ }
}

// v4.15 起细粒化权限；v4.21 拆细剪贴板（公开/私有 × 查看/编辑/删除）并新增网站治理三档。
// 注意：任何权限名变更都必须同步 public/app.js 的 PERM_LABELS / ALL_PERMS / PERM_GROUPS。
const ALL_PERMS = [
  'ban_user',            // 封禁 / 解封用户
  'delete_user',         // 删除用户账号
  'set_clip_limit',      // 设置剪贴板数量限制
  'manage_feature',      // 修改用户功能开关
  'manage_vip',          // 授予 / 撤销 VIP
  // v4.21：剪贴板管理拆成 公开 / 私有 × 查看 / 编辑 / 删除
  'view_public_clips',   // 查看他人公开剪贴板
  'edit_public_clips',   // 编辑他人公开剪贴板
  'delete_public_clips', // 删除他人公开剪贴板
  'view_private_clips',  // 查看他人私有剪贴板（高敏感）
  'edit_private_clips',  // 编辑他人私有剪贴板（高敏感）
  'delete_private_clips',// 删除他人私有剪贴板（高敏感）
  'manage_comments',     // 管理评论（删除他人评论）
  'manage_pages',        // 编辑站点页面（帮助 / 关于等）
  'manage_announcements',// 发布公告 / 删除
  'manage_tickets',      // 处理工单（改状态 / 删除）
  'manage_invites',      // 管理邀请
  'manage_settings',     // 站点设置
  'view_code',           // 查看源码（只读）
  'edit_code',           // 编辑并提交代码
  'manage_admins',       // 管理其他管理员（授予 / 调整权限 / 设层级）——需更高层级
  // v4.21：网站托管治理三档（递进蕴含：delete ⊃ ban ⊃ view）
  'view_sites',          // 查看网站列表
  'ban_sites',           // 查看 + 封禁 / 解封网站
  'delete_sites',        // 查看 + 封禁 + 删除网站
  // v4.32.1：治理类细粒度开关（可由站长逐项授予普通管理员）
  'manage_ip',           // IP 治理：查看 / 封禁 / 解封 IP 与网段
  'manage_sites',        // 站点治理统一开关：查看 / 封禁 / 解封 / 删除网站
  'manage_quota',        // 配额治理：修改 D1 / KV 额度上限
  'manage_snapshot_quota' // 快照配额治理：设置用户快照配额
];

// 权限蕴含：授予高阶权限即自动拥有其依赖的低阶权限（在 readPerms 里做闭包展开）
const PERM_IMPLY = {
  edit_public_clips: ['view_public_clips'],
  delete_public_clips: ['edit_public_clips', 'view_public_clips'],
  edit_private_clips: ['view_private_clips'],
  delete_private_clips: ['edit_private_clips', 'view_private_clips'],
  ban_sites: ['view_sites'],
  delete_sites: ['ban_sites', 'view_sites'],
  // v4.32.1：manage_sites 单一开关蕴含全部站点治理权限
  manage_sites: ['view_sites', 'ban_sites', 'delete_sites']
};

// 旧权限名 → 展开后的新权限集合（v4.15 / v4.21 重命名，保证存量管理员权限不丢）
const PERM_LEGACY_MAP = {
  edit_pages: ['manage_pages'],
  edit_public_clips: ['view_public_clips', 'edit_public_clips'],
  edit_private_clips: ['view_private_clips', 'edit_private_clips'],
  // v4.20 及以前的「管理剪贴板」是单一布尔，视为同时拥有全部六项（不降级老管理员）
  manage_clips: ['view_public_clips', 'edit_public_clips', 'delete_public_clips', 'view_private_clips', 'edit_private_clips', 'delete_private_clips']
};

/** 读取并归一化管理员权限：补齐全部 ALL_PERMS 键（默认 false），旧键展开映射，再做蕴含闭包 */
function readPerms(raw) {
  const out = {};
  for (const p of ALL_PERMS) out[p] = false;
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = {}; } }
  // v4.15.3 绊线：收到 undefined/null 说明调用方拿到的行里没有 admin_permissions（SELECT 漏列），
  // 曾因静默兜底成全 false 导致"权限已授予但按钮全灰 / 代码页只读"。日志：wrangler pages deployment tail
  else if (raw === undefined || raw === null) console.warn('[mdqp] readPerms(undefined) — 调用方 SELECT 可能漏选了 admin_permissions');
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (!obj[k]) continue; // 显式 false 不覆盖其它来源授予的 true
      const names = PERM_LEGACY_MAP[k] || (ALL_PERMS.includes(k) ? [k] : []);
      for (const n of names) out[n] = true;
    }
  }
  // 蕴含闭包：delete ⊃ edit ⊃ view、delete_sites ⊃ ban_sites ⊃ view_sites
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of ALL_PERMS) {
      if (!out[p]) continue;
      for (const q of (PERM_IMPLY[p] || [])) if (!out[q]) { out[q] = true; changed = true; }
    }
  }
  return out;
}

/** v4.32.3: 权限授予的「包含关系」合并。
 *  requested: 本次提交的权限（readPerms 已展开）；existing: 目标原有权限；operPerms: 操作者自身权限；operIsDev: 是否开发者。
 *  - 操作者有权授予的权限：按 submitted 值覆盖（再经 readPerms 展开蕴含，保持一致）。
 *  - 操作者无权授予的权限：保持目标原值——既不能越权加，也不会被误删。
 *  droppedOut 收集「试图授予但无权」的权限名，供前端提示。开发者拥有全部权限，直接采用提交值。 */
function mergeGrantable(requested, existing, operPerms, operIsDev, droppedOut) {
  if (operIsDev) return readPerms(requested);
  const merged = {};
  for (const p of ALL_PERMS) merged[p] = operPerms[p] ? !!requested[p] : !!existing[p];
  for (const p of ALL_PERMS) if (requested[p] && !operPerms[p]) droppedOut.push(p);
  return readPerms(merged);
}

/** 管理员层级：developer=99、admin=admin_level(默认1)、普通用户=0 */
function adminLevelOf(role, level) {
  if (role === 'developer') return 99;
  if (role === 'admin') return parseInt(level, 10) || 1;
  return 0;
}

/** 获取站点设置值 */
async function getSiteSetting(db, key, fallback) {
  const r = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
  return r ? r.value : fallback;
}

/** 删除「已过期且过期时间已超过 3 天」的剪贴板（expires_at 在过去且无续期），返回删除条数 */
async function cleanupExpiredClips(db) {
  const r = await db.prepare(
    "DELETE FROM clipboards WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now','-3 days')"
  ).run();
  return (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
}

/** 按小时节流：借高频读请求顺带清理过期剪贴板，免去独立 Cron 配置（非致命） */
async function maybeCleanupExpired(db) {
  try {
    const now = Date.now();
    const row = await db.prepare("SELECT value FROM site_settings WHERE key='expiry_cleanup_last'").first();
    const last = row ? parseInt(row.value || '0', 10) : 0;
    if (now - last < 3600 * 1000) return;
    await db.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('expiry_cleanup_last', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(String(now)).run();
    await cleanupExpiredClips(db);
  } catch { /* 清理失败不影响主流程 */ }
}

/** 获取用户的功能开关 */
async function getUserFeatures(db, userId) {
  const u = await db.prepare('SELECT feature_flags FROM users WHERE id = ?').bind(String(userId)).first();
  return parseFeatureFlags(u?.feature_flags);
}

/** 检查用户是否拥有某项功能 */
async function userHasFeature(db, userId, feature) {
  const flags = await getUserFeatures(db, userId);
  return !!flags[feature];
}

// ========== v4.27：站点管控（关战 / 功能开关 / 限流 / 零宽识别） ==========
const DF_CHAT = 1, DF_SITE = 2, DF_CLIPBOARD = 4;
async function getSiteConfig(db, kv) {
  let m = {};
  try {
    const rows = await db.prepare("SELECT key,value FROM site_settings WHERE key IN ('site_mode','maintenance_title','maintenance_text','disabled_features')").all();
    (rows.results || []).forEach((r) => { m[r.key] = r.value; });
  } catch { /* D1 故障降级为默认配置 */ }
  const df = parseInt(m.disabled_features || '0', 10) || 0;
  // v4.31：配额超阈值时自动关闭聊天，前端据此隐藏入口（读 KV 不烧 D1）
  let chatAutoOff = false;
  try { chatAutoOff = !!(kv && await kv.get('chat_autodisable')); } catch {}
  return {
    mode: m.site_mode === 'maintenance' ? 'maintenance' : 'normal',
    maintenance_title: m.maintenance_title || '网站维护中',
    maintenance_text: m.maintenance_text || '网站正在维护升级，请稍后再来。',
    disabled_features: {
      chat: !!(df & DF_CHAT) || chatAutoOff,
      site: !!(df & DF_SITE),
      clipboard: !!(df & DF_CLIPBOARD)
    },
    chat_auto_disabled: chatAutoOff
  };
}
function objToDisabledFeatures(o) { let b = 0; if (o) { if (o.chat) b |= DF_CHAT; if (o.site) b |= DF_SITE; if (o.clipboard) b |= DF_CLIPBOARD; } return b; }
async function isUserFeatureDisabled(db, userId, bit) {
  const u = await db.prepare('SELECT disabled_features FROM users WHERE id = ?').bind(String(userId)).first();
  return !!(u && (parseInt(u.disabled_features, 10) || 0) & bit);
}
// 不可见字符：零宽空格/连字、BOM、方向控制符、词连接符、全角空格
const INVISIBLE_RE = /[​-‍﻿‪-‮⁠　]/;
function hasInvisibleChars(s) { return !!(s && INVISIBLE_RE.test(s)); }
function stripInvisible(s) { return s ? s.replace(/[​-‍﻿‪-‮⁠　]/g, '') : s; }
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// v4.27.1：轻量 KV 缓存（复用 SITE_KV，key 前缀 cache:）——降低 D1 读压力；D1 读配额耗尽时热读仍可服务
async function cacheGet(kv, key) { try { return await kv.get('cache:' + key, 'json'); } catch { return null; } }
async function cachePut(kv, key, val, ttl) { try { await kv.put('cache:' + key, JSON.stringify(val), { expirationTtl: ttl }); } catch { /* ignore */ } }

// ========== v4.31：配额计量与自动刹车 ==========
// 用户诉求：D1/KV 额度到 80% 时自动关闭聊天，并在后台显示进度条。
//
// 关键事实：**Cloudflare 不提供查询 D1/KV 已用配额的 API**。所以必须自己做「估算计量」。
// 计量口径（保守，宁可高估也不要低估到爆）：
//   - 每命中一次 D1 读接口，按该接口的经验行数计费（_quotaCost）
//   - 每一次 KV 操作计 1 次
// 每日窗口 = UTC 00:00 → 次日 00:00（=北京时间 08:00 → 次日 08:00，与用户要求一致）
//
// 计量写入必须极轻：每请求都写 KV 会反过来把 KV 也烧光。
// 因此用**内存计数 + 定时批量落盘**（每 60s 或累计到阈值才 flush），并放进全局变量避免重复声明。
const _quotaState = globalThis.__mdqpQuotaState || { d1: 0, kv: 0, day: '', lastFlush: 0, trip: 0 };
globalThis.__mdqpQuotaState = _quotaState;

/** 取当前配额日（UTC 日期，北京时间 08:00 为分界） */
function quotaDayKey(now = Date.now()) {
  // UTC 00:00 = 北京 08:00，所以用 UTC 日期即可
  return new Date(now).toISOString().slice(0, 10);
}
/** 免费版默认额度（Cloudflare D1 free: 5M rows/day；KV free: 100k reads/day）。
 *  v4.31.1：可在后台修改（仅站长），存 KV；读不到时回落到这两个默认值。 */
const QUOTA_LIMITS_DEFAULT = { d1: 5_000_000, kv: 100_000 };
/** 触发自动刹车的阈值 */
const QUOTA_TRIP_RATIO = 0.8;

/** 读取当前生效的额度上限。KV 里有站长自定义值就用，否则用默认值。 */
async function quotaLimits(kv) {
  let custom = null;
  try { custom = await kv?.get('quota_limits', 'json'); } catch {}
  const d1 = Number(custom?.d1);
  const kvv = Number(custom?.kv);
  return {
    d1: Number.isFinite(d1) && d1 > 0 ? Math.floor(d1) : QUOTA_LIMITS_DEFAULT.d1,
    kv: Number.isFinite(kvv) && kvv > 0 ? Math.floor(kvv) : QUOTA_LIMITS_DEFAULT.kv,
    isDefault: !(Number.isFinite(d1) && d1 > 0) && !(Number.isFinite(kvv) && kvv > 0),
    updated_at: custom?.updated_at || null
  };
}

/** 累加本次请求的 D1 读行数估算 + KV 读。纯内存，无 IO。 */
function quotaAddD1(kv, rows = 1) {
  if (!kv) return;
  _quotaState.d1 += rows; _quotaState.kv += 1;
  _quotaState._pending = _quotaState._pending || { d1: 0, kv: 0 };
  _quotaState._pending.d1 += rows; _quotaState._pending.kv += 1;
}
/** 累加 KV 操作 */
function quotaAddKv(kv, n = 1) {
  if (!kv) return;
  _quotaState.kv += n;
  _quotaState._pending = _quotaState._pending || { d1: 0, kv: 0 };
  _quotaState._pending.kv += n;
}

/**
 * 批量把内存计数落盘到 KV。每分钟最多一次。
 * 落盘失败静默（KV 故障不该影响主流程）。
 */
async function quotaFlush(kv, force = false) {
  if (!kv) return;
  const now = Date.now();
  const day = quotaDayKey(now);
  if (_quotaState.day !== day) { // 跨天：归零重新累计
    _quotaState.day = day; _quotaState.d1 = 0; _quotaState.kv = 0; _quotaState.trip = 0;
    force = true;
  }
  if (!force && now - _quotaState.lastFlush < 60_000) return;
  const delta = _quotaState._pending;
  if (!delta) return;
  _quotaState.lastFlush = now;
  try {
    const cur = await kv.get('quota:' + day, 'json') || {};
    const next = {
      d1: (cur.d1 || 0) + (delta.d1 || 0),
      kv: (cur.kv || 0) + (delta.kv || 0),
      day
    };
    // 保留 3 天，够看趋势
    await kv.put('quota:' + day, JSON.stringify(next), { expirationTtl: 259_200 });
    _quotaState._pending = { d1: 0, kv: 0 };
  } catch { /* ignore */ }
}

// 上面的 flush 需要一个稳定的"本次未落盘增量"，初始化结构
_quotaState._pending = _quotaState._pending || { d1: 0, kv: 0 };

/** 读取当前配额用量（供后台进度条）。含当日估算 + 可自定义的上限。 */
async function quotaGet(kv, db) {
  const day = quotaDayKey();
  const lim = await quotaLimits(kv);
  let stored = { d1: 0, kv: 0 };
  try { stored = (await kv?.get('quota:' + day, 'json')) || { d1: 0, kv: 0 }; } catch {}
  // 内存里还没落盘的增量也要算进去，否则后台看到的会偏低
  const p = _quotaState._pending || { d1: 0, kv: 0 };
  const sameDay = _quotaState.day === day;
  const d1 = (stored.d1 || 0) + (sameDay ? (p.d1 || 0) : 0);
  const kvUsed = (stored.kv || 0) + (sameDay ? (p.kv || 0) : 0);
  const d1Ratio = Math.min(1, d1 / lim.d1);
  const kvRatio = Math.min(1, kvUsed / lim.kv);
  return {
    day,
    d1: { used: d1, limit: lim.d1, ratio: d1Ratio, percent: Math.round(d1Ratio * 100) },
    kv: { used: kvUsed, limit: lim.kv, ratio: kvRatio, percent: Math.round(kvRatio * 100) },
    worst: Math.max(d1Ratio, kvRatio),
    tripped: _quotaState.trip === 1,
    limits: lim,
    defaults: QUOTA_LIMITS_DEFAULT
  };
}

/**
 * 自动刹车：任一配额 ≥ 80% 时，自动关闭聊天功能（写 KV 标记）。
 * 这是**保护措施**——聊天轮询是最大消耗源，掐掉它能立刻止血。
 * 不删数据、可一键恢复（管理员在后台点恢复即可）。
 */
async function quotaAutoTrip(kv, db, siteKv) {
  if (!kv) return false;
  if (_quotaState.trip === 1) return true;
  const q = await quotaGet(kv, db);
  if (q.worst < QUOTA_TRIP_RATIO) return false;
  _quotaState.trip = 1;
  try { await kv.put('quota_tripped', JSON.stringify({ day: q.day, at: Date.now(), worst: q.worst }), { expirationTtl: 86_400 }); } catch {}
  console.error(`[quota] 达到 ${Math.round(q.worst * 100)}% 阈值，自动关闭聊天以保护站点（D1 ${q.d1.percent}% / KV ${q.kv.percent}%）`);
  // 同时打开「降级提示」让用户知道原因，而不是静默消失
  try { await kv.put('chat_autodisable', '1', { expirationTtl: 86_400 }); } catch {}
  return true;
}

/** 供 onError / 中间件等复用的轻量判定（避免重复查 KV） */
function isChatAutoDisabled(kv) { return kv && _quotaState.trip === 1; }

// v4.28：聊天限流状态（纯内存，零 D1 读）
// 旧实现每发一条消息都要 SELECT COUNT(*) 扫 chat_messages，是刷屏攻击放大 D1 读配额的主因。
// 改为进程内时间戳：每人 CHAT_USER_COOLDOWN_MS 冷却 + 全群 CHAT_GROUP_LOCK_MS 全员锁。
const CHAT_USER_COOLDOWN_MS = 3000;  // 每人 3s 内不得再发
const CHAT_GROUP_LOCK_MS = 1000;     // 全群收到任意一条消息后 1s 内任何人不得再发
const _chatLastByUser = new Map();   // userId -> 上次发送时间戳
const _chatGroupLock = new Map();   // convId -> 最近一条消息时间戳
function pruneMap(m, cap) { if (m.size <= cap) return; const cut = Date.now() - 3600e3; for (const [k, v] of m) { if (v < cut) m.delete(k); else break; } }
function chatRateCheck(convId, userId, isGlobal) {
  const now = Date.now();
  pruneMap(_chatLastByUser, 5000); pruneMap(_chatGroupLock, 2000);
  if (isGlobal) {
    const last = _chatGroupLock.get(convId) || 0;
    if (now - last < CHAT_GROUP_LOCK_MS) return { error: 'rate_limited', message: '群里有人刚发了消息，请稍候', retry_after: Math.ceil((CHAT_GROUP_LOCK_MS - (now - last)) / 1000) };
  }
  const mine = _chatLastByUser.get(userId) || 0;
  if (now - mine < CHAT_USER_COOLDOWN_MS) return { error: 'rate_limited', message: '发送过快，请 ' + Math.ceil((CHAT_USER_COOLDOWN_MS - (now - mine)) / 1000) + ' 秒后再试', retry_after: Math.ceil((CHAT_USER_COOLDOWN_MS - (now - mine)) / 1000) };
  return null;
}
function chatRateMark(convId, userId) { const now = Date.now(); _chatLastByUser.set(userId, now); _chatGroupLock.set(convId, now); }

// v4.30：聊天消息缓存失效
// KV list 是最终一致的，不能靠 list 精确删 key；直接删掉该群的 index 标记，
// 读侧发现 index 缺失即视为失效。这里用「版本号」方案：写消息时递增版本，
// 读侧把版本拼进 cache key，旧数据自然失效（KV 自身有 TTL 兜底）。
const CHAT_VER_PREFIX = 'chatver:';
async function chatBumpVersion(kv, convId) {
  if (!kv) return;
  try {
    const cur = parseInt((await kv.get(CHAT_VER_PREFIX + convId)) || '0', 10) || 0;
    await kv.put(CHAT_VER_PREFIX + convId, String(cur + 1));
  } catch { /* KV 不可用时靠 TTL 兜底 */ }
}
async function chatVer(kv, convId) {
  if (!kv) return 0;
  try { return parseInt((await kv.get(CHAT_VER_PREFIX + convId)) || '0', 10) || 0; } catch { return 0; }
}

// v4.29：IP 治理工具——IP 归一化、IPv4 数值化、CIDR 匹配
function clientIp(c) {
  return (c.req.header('CF-Connecting-IP') || (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() || '').trim();
}
/** IPv4 → 32 位无符号整数；非 IPv4（含 IPv6）返回 null */
function ipToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  let v = 0;
  for (let i = 1; i <= 4; i++) { const p = parseInt(m[i], 10); if (p > 255) return null; v = (v * 256) + p; }
  return v >>> 0;
}
function intToIp(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
/** 校验 CIDR 并返回 {base, mask} 归一化值；非法返回 null */
function parseCidr(v) {
  const s = String(v || '').trim(); const i = s.indexOf('/');
  if (i < 0) return null;
  const ip = ipToInt(s.slice(0, i)); const bits = parseInt(s.slice(i + 1), 10);
  if (ip === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, bits, text: intToIp((ip & mask) >>> 0) + '/' + bits };
}
function cidrContains(cidr, ip) {
  const c = parseCidr(cidr); const v = ipToInt(ip);
  if (!c || v === null) return false;
  if (c.bits === 0) return true;
  const mask = (0xFFFFFFFF << (32 - c.bits)) >>> 0;
  return ((v & mask) >>> 0) === c.base;
}
/** 规范化封禁目标：纯 IP → {kind:'ip'}；CIDR → {kind:'cidr'} 归一化后返回 */
function normalizeBanTarget(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const c = parseCidr(s);
  if (c) return { kind: 'cidr', value: c.text };
  if (ipToInt(s) !== null) return { kind: 'ip', value: intToIp(ipToInt(s)) };
  return null;
}
/** 查该 IP 是否被封（单 IP + 任意 CIDR 命中）。返回 ban 行或 null；D1 故障视为未封（不因治理功能拖垮全站） */
async function checkIpBan(db, ip) {
  if (!ip || !db) return null;
  const v = ipToInt(ip);
  if (v === null) return null;
  try {
    const rows = await db.prepare(
      "SELECT * FROM ip_bans WHERE (kind = 'ip' AND value = ?) OR (kind = 'cidr' AND (ban_until IS NULL OR ban_until > datetime('now')))"
    ).bind(ip).all();
    const list = rows.results || [];
    for (const r of list) {
      if (r.kind === 'ip') return r;
      if (cidrContains(r.value, ip)) return r;
    }
    // 过期 CIDR 惰性清理
    const stale = (rows.results || []).filter((r) => r.kind === 'cidr' && r.ban_until && new Date(String(r.ban_until).replace(' ', 'T') + 'Z') <= new Date());
    for (const s of stale) { try { await db.prepare('DELETE FROM ip_bans WHERE id = ?').bind(s.id).run(); } catch {} }
  } catch { return null; }
  return null;
}
/** 记录注册 IP（供治理视图） */
async function recordUserIp(db, userId, ip, ua) {
  if (!db || !ip || ipToInt(ip) === null) return;
  try {
    await db.prepare('INSERT INTO user_ips (user_id, ip, ua) VALUES (?, ?, ?)').bind(userId, ip, String(ua || '').slice(0, 200)).run();
    // 概率清理同 IP 的历史记录，防无限增长
    if (Math.random() < 0.05) {
      await db.prepare("DELETE FROM user_ips WHERE created_at < datetime('now','-30 days')").run();
    }
  } catch { /* 表未迁移时不阻断注册 */ }
}

// 站点管控配置（公开只读）
app.get('/api/site/config', async (c) => {
  const kv = c.env.SITE_KV;
  try {
    if (kv) { const cached = await cacheGet(kv, 'site_config'); if (cached) return c.json(cached); }
    const cfg = await getSiteConfig(c.env.db, c.env.SITE_KV);
    if (kv) cachePut(kv, 'site_config', cfg, 300);
    return c.json(cfg);
  } catch {
    return c.json({ mode: 'normal', maintenance_title: '网站维护中', maintenance_text: '网站正在维护升级，请稍后再来。', disabled_features: { chat: false, site: false, clipboard: false }, degraded: true });
  }
});
// 管理员读取完整配置
app.get('/api/admin/site-config', async (c) => {
  const db = c.env.db; const id = await getIdentity(c);
  if (!(await isAdminIdentity(db, id))) return c.json({ error: 'forbidden' }, 403);
  return c.json(await getSiteConfig(db, c.env.SITE_KV));
});
// 管理员更新配置（关战 / 功能开关 / 维护文案）
app.post('/api/admin/site-config', async (c) => {
  const db = c.env.db; const id = await getIdentity(c);
  if (!(await isAdminIdentity(db, id))) return c.json({ error: 'forbidden' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const mode = body.mode === 'maintenance' ? 'maintenance' : 'normal';
  const title = String(body.maintenance_title || '网站维护中').slice(0, 100);
  const text = String(body.maintenance_text || '').slice(0, 1000);
  const df = objToDisabledFeatures(body.disabled_features);
  const set = (k, v) => db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(k, v).run();
  await set('site_mode', mode);
  await set('maintenance_title', title);
  await set('maintenance_text', text);
  await set('disabled_features', String(df));
  return c.json({ ok: true, config: await getSiteConfig(db, c.env.SITE_KV) });
});

// ========== API ==========

app.get('/api/health', (c) => c.json({ ok: true, version: VERSION, time: Date.now() }));

// 站点统计
app.get('/api/stats', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const kv = c.env.SITE_KV;
  try {
    if (kv) { const cached = await cacheGet(kv, 'stats'); if (cached) return c.json(cached); }
    const db = c.env.db;
    const [clips, users] = await Promise.all([
      db.prepare('SELECT COUNT(*) as cnt FROM clipboards').first(),
      db.prepare('SELECT COUNT(*) as cnt FROM users').first()
    ]);
    const out = { clips: clips?.cnt || 0, users: users?.cnt || 0 };
    if (kv) cachePut(kv, 'stats', out, 60);
    return c.json(out);
  } catch {
    return c.json({ clips: 0, users: 0, degraded: true });
  }
});

// ========== 公告 API ==========

/** 清洗文本：剔除控制字符（保留 \n \t \r）+ 孤立代理对，避免 D1/JSON 序列化异常 */
function sanitizeText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '');
}

app.get('/api/announcements', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const db = c.env.db;
  try {
    const rows = await db
      .prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY pinned DESC, created_at DESC')
      .all();
    // 兼容 D1 不同版本返回结构（results / 直接数组）
    return c.json({ announcements: rows?.results || [] });
  } catch (e) {
    // 公告栏是全局非关键组件：D1 抖动 / 脏数据导致查询失败时降级为空，绝不 500 拖垮整站与 /admin
    console.error('[announcements] GET failed, degrade to empty:', e);
    return c.json({ announcements: [] });
  }
});

// 发布 + 清理公告（抽成函数便于失败重试一次，应对 D1 偶发抖动）
async function publishAnnouncement(db, content, updatedBy) {
  await db.prepare(
    `INSERT INTO announcements (content, is_active, pinned, updated_at, updated_by)
     VALUES (?, 1, 1, datetime('now'), ?)`
  ).bind(content, updatedBy).run();
  // 保留最新 N 条公告（默认最多 5 条活跃）。清理失败不影响已发布的公告，故非致命。
  try {
    await db.exec(`DELETE FROM announcements WHERE id NOT IN (
      SELECT id FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5
    ) AND is_active = 1`);
  } catch (e) {
    console.error('[announcements] cleanup skipped (non-fatal):', e);
  }
}

// 身份校验统一包裹：任何异常都判为未授权（401/403），绝不裸 500 拖垮 /admin
async function requireAdmin(c) {
  let identity;
  try { identity = await getIdentity(c); } catch (e) { console.error('[announcements] getIdentity failed:', e); return null; }
  if (!identity || identity.type !== 'user') return null;
  try { return (await isAdminIdentity(c.env.db, identity)) ? identity : null; } catch (e) { console.error('[announcements] isAdminIdentity failed:', e); return null; }
}

app.put('/api/announcements', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_announcements'))) return c.json({ error: 'forbidden', message: '无发布公告权限（需 manage_announcements）' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  let content = (body.content || '').toString().slice(0, 5000);
  // 清洗：剔除控制字符（保留换行/制表/回车）+ 孤立代理对（否则 JSON.stringify 会抛错→500）
  content = sanitizeText(content);
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);
  const updatedBy = identity.name || String(identity.userId);

  try {
    await publishAnnouncement(c.env.db, content, updatedBy);
    return c.json({ ok: true });
  } catch (e) {
    // 重试一次（D1 偶发抖动）：多数瞬时失败重试即可成功，避免 /admin 误报 500
    try {
      await publishAnnouncement(c.env.db, content, updatedBy);
      return c.json({ ok: true });
    } catch (e2) {
      console.error('[announcements] PUT failed after retry:', e2);
      return c.json({ error: 'db_error', message: '公告发布失败，请稍后重试' }, 500);
    }
  }
});

app.delete('/api/announcements/:id', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_announcements'))) return c.json({ error: 'forbidden', message: '无删除公告权限（需 manage_announcements）' }, 403);
  try {
    await c.env.db.prepare('DELETE FROM announcements WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  } catch (e) {
    console.error('[announcements] DELETE failed:', e);
    return c.json({ error: 'db_error', message: '公告删除失败，请稍后重试' }, 500);
  }
});

// ========== 统一工单系统（合并「反馈」+「内容举报」，仿洛谷工单） ==========
const TICKET_CATEGORY_LABEL = { bug: '程序缺陷', suggestion: '功能建议', report: '内容举报', appeal: '封禁申诉', other: '其他' };
const TICKET_STATUS_LABEL = { open: '待处理', reviewing: '处理中', resolved: '已解决', rejected: '已驳回' };
// v4.21：新增 appeal（站点 / 内容被封禁后的申诉），走独立模块，管理员处理后可直接解封
const TICKET_CATS = ['bug', 'suggestion', 'report', 'appeal', 'other'];
const TICKET_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'];

async function genTicketCode(db) {
  for (let i = 0; i < 8; i++) {
    const code = 'TK' + Math.random().toString(16).slice(2, 10).toUpperCase();
    const ex = await db.prepare('SELECT 1 FROM tickets WHERE code = ?').bind(code).first();
    if (!ex) return code;
  }
  return 'TK' + Date.now().toString(16).toUpperCase().slice(-8);
}

// 创建工单（反馈 / 举报 统一入口）
app.post('/api/tickets', async (c) => {
  const db = c.env.db;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const category = TICKET_CATS.includes(body.category) ? body.category : 'other';
  const content = (body.content || '').toString().slice(0, 5000);
  // 举报 / 申诉类由 reason/detail 拼装 finalContent（见下），本身无 content 字段，跳过此校验
  if (category !== 'report' && category !== 'appeal' && !content.trim()) return c.json({ error: 'empty_content' }, 400);
  let title = (body.title || '').toString().slice(0, 100).trim() || (category === 'report' ? '内容举报' : category === 'appeal' ? '封禁申诉' : '工单');
  const identity = await getIdentity(c);

  let relatedClipId = '', relatedClipReason = '', relatedSiteSlug = '', finalContent = content;
  // v4.21：申诉必须登录（要能确认申诉人是站长本人），且必须指向具体对象（站点 / 片段）
  if (category === 'appeal') {
    if (identity.type !== 'user') return c.json({ error: 'login_required', message: '请先登录后再提交申诉' }, 401);
    const siteSlug = (body.site_slug || '').toString().trim();
    const clipId = (body.clip_id || '').toString().trim();
    if (!siteSlug && !clipId) return c.json({ error: 'missing_target', message: '请指定申诉对象（站点或片段）' }, 400);
    const detail = (body.detail || body.content || '').toString().slice(0, 2000).trim();
    if (!detail) return c.json({ error: 'empty_content', message: '请填写申诉理由' }, 400);
    if (siteSlug) {
      const site = await db.prepare('SELECT slug, title, status, suspend_reason, owner_id FROM sites WHERE slug = ?').bind(siteSlug).first();
      if (!site) return c.json({ error: 'not_found' }, 404);
      // 只能是站长本人申诉自己的站点
      if (String(site.owner_id) !== String(identity.userId)) return c.json({ error: 'forbidden', message: '只能申诉自己的站点' }, 403);
      // 同一站长对同一站点的未处理申诉只保留一条
      const dup = await db.prepare("SELECT code FROM tickets WHERE category='appeal' AND related_site_slug=? AND status IN ('open','reviewing')")
        .bind(siteSlug).first();
      if (dup) return c.json({ ok: true, already: true, code: dup.code });
      relatedSiteSlug = siteSlug;
      finalContent = '【申诉对象】站点 ' + siteSlug + (site.title ? '（' + site.title + '）' : '')
        + '\n【当前状态】' + (site.status === 'suspended' ? '已封禁' : site.status)
        + (site.suspend_reason ? '\n【封禁原因】' + site.suspend_reason : '')
        + '\n【访问地址】' + SITES_HOST + '/' + siteSlug
        + '\n\n【申诉理由】' + detail;
    } else {
      const clip = await db.prepare('SELECT clip_id, title FROM clipboards WHERE clip_id = ?').bind(clipId).first();
      if (!clip) return c.json({ error: 'not_found' }, 404);
      const dup = await db.prepare("SELECT code FROM tickets WHERE category='appeal' AND related_clip_id=? AND status IN ('open','reviewing')")
        .bind(clipId).first();
      if (dup) return c.json({ ok: true, already: true, code: dup.code });
      relatedClipId = clipId;
      finalContent = '【申诉对象】片段 ' + clipId + (clip.title ? '（' + clip.title + '）' : '')
        + '\n\n【申诉理由】' + detail;
    }
    if (!(body.title || '').toString().trim()) {
      title = relatedSiteSlug ? ('申诉：站点 ' + relatedSiteSlug + ' 被封禁') : ('申诉：片段 ' + clipId + ' 被处理');
    }
  }
  if (category === 'report') {
    // 举报必须先登录（v4.20：举报对象可以是片段，也可以是站点）
    if (identity.type !== 'user') return c.json({ error: 'login_required', message: '请先登录后再举报' }, 401);
    const clipId = (body.clip_id || '').toString().trim();
    const siteSlug = (body.site_slug || '').toString().trim();
    if (!clipId && !siteSlug) return c.json({ error: 'missing_target', message: '请指定举报对象（片段或站点）' }, 400);
    const reasonRaw = (body.reason || '').toString().slice(0, 50);
    const reasonLabel = REPORT_REASON_LABEL[reasonRaw] || reasonRaw || '其他';
    const detail = body.detail ? '\n' + (body.detail || '').toString().slice(0, 1000) : '';
    if (clipId) {
      const clip = await db.prepare('SELECT clip_id, title FROM clipboards WHERE clip_id = ?').bind(clipId).first();
      if (!clip) return c.json({ error: 'not_found' }, 404);
      // 去重：同一用户对同一片段的未处理举报工单只计一次
      const dup = await db.prepare("SELECT code FROM tickets WHERE category='report' AND related_clip_id=? AND author_id=? AND status='open'")
        .bind(clipId, String(identity.userId || '')).first();
      if (dup) return c.json({ ok: true, already: true, code: dup.code });
      relatedClipId = clipId;
      relatedClipReason = reasonRaw;
      finalContent = '【举报原因】' + reasonLabel + detail;
    } else {
      const site = await db.prepare('SELECT slug, title FROM sites WHERE slug = ?').bind(siteSlug).first();
      if (!site) return c.json({ error: 'not_found' }, 404);
      // 去重：同一用户对同一站点的未处理举报工单只计一次
      const dup = await db.prepare("SELECT code FROM tickets WHERE category='report' AND related_site_slug=? AND author_id=? AND status='open'")
        .bind(siteSlug, String(identity.userId || '')).first();
      if (dup) return c.json({ ok: true, already: true, code: dup.code });
      relatedSiteSlug = siteSlug;
      finalContent = '【举报对象】站点 ' + siteSlug + (site.title ? '（' + site.title + '）' : '')
        + '\n【访问地址】' + SITES_HOST + '/' + siteSlug
        + '\n【举报原因】' + reasonLabel + detail;
    }
  }
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);

  let authorId = '', authorName = '匿名', authorType = 'guest';
  if (identity.type === 'user') { authorId = String(identity.userId); authorName = identity.name || '用户'; authorType = 'user'; }
  else if (identity.type === 'guest') { authorId = identity.guestId || ''; authorName = '游客'; authorType = 'guest'; }

  const code = await genTicketCode(db);
  await db.prepare(
    `INSERT INTO tickets (code, category, title, content, author_id, author_name, author_type, status, related_clip_id, related_clip_reason, related_site_slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(code, category, title, finalContent, authorId, authorName, authorType, relatedClipId, relatedClipReason, relatedSiteSlug).run();
  return c.json({ ok: true, code });
});

// 工单列表（公开可读，支持状态/分类/我的/分页筛选）
app.get('/api/tickets', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  const admin = await isAdminIdentity(db, identity);
  const status = (c.req.query('status') || '').trim();
  const category = (c.req.query('category') || '').trim();
  const mine = c.req.query('mine') === '1';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const where = [], binds = [];
  if (status && TICKET_STATUSES.includes(status)) { where.push('t.status = ?'); binds.push(status); }
  if (category && TICKET_CATS.includes(category)) { where.push('t.category = ?'); binds.push(category); }
  if (mine && identity.type === 'user') { where.push('t.author_id = ?'); binds.push(String(identity.userId)); }
  if (!admin) { where.push('t.is_public = 1'); where.push("t.status != 'rejected'"); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT t.id, t.code, t.category, t.title, t.content, t.author_name, t.status, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id) AS reply_count
     FROM tickets t ${whereSql} ORDER BY t.created_at DESC LIMIT 30 OFFSET ?`
  ).bind(...binds, (page - 1) * 30).all();
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM tickets t ${whereSql}`).bind(...binds).first();
  return c.json({
    tickets: rows.results.map((t) => ({
      ...t, category_label: TICKET_CATEGORY_LABEL[t.category] || t.category,
      status_label: TICKET_STATUS_LABEL[t.status] || t.status, reply_count: t.reply_count || 0
    })),
    total: total?.n || 0, page, admin
  });
});

// 工单详情（公开可读，含回复流 + 关联片段信息）
app.get('/api/tickets/:code', async (c) => {
  const db = c.env.db;
  const code = c.req.param('code');
  const identity = await getIdentity(c);
  const admin = await isAdminIdentity(db, identity);
  const t = await db.prepare('SELECT * FROM tickets WHERE code = ?').bind(code).first();
  if (!t) return c.json({ error: 'not_found' }, 404);
  if (!t.is_public && !admin && !(identity.type === 'user' && String(identity.userId) === String(t.author_id)))
    return c.json({ error: 'forbidden' }, 403);
  const replies = await db.prepare(
    'SELECT id, author_id, author_name, author_type, is_staff, content, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC'
  ).bind(t.id).all();
  let clip = null;
  if (t.related_clip_id) {
    const cl = await db.prepare('SELECT clip_id, title FROM clipboards WHERE clip_id = ?').bind(t.related_clip_id).first();
    clip = cl ? { clip_id: cl.clip_id, title: cl.title, exists: true } : { clip_id: t.related_clip_id, title: '', exists: false };
  }
  // v4.20：举报对象也可以是站点
  let site = null;
  if (t.related_site_slug) {
    const st = await db.prepare('SELECT slug, title, status, owner_id FROM sites WHERE slug = ?').bind(t.related_site_slug).first();
    site = st
      ? { slug: st.slug, title: st.title || '', status: st.status, exists: true, url: SITES_HOST + '/' + st.slug }
      : { slug: t.related_site_slug, title: '', status: 'gone', exists: false, url: SITES_HOST + '/' + t.related_site_slug };
  }
  return c.json({
    ticket: { ...t, category_label: TICKET_CATEGORY_LABEL[t.category] || t.category, status_label: TICKET_STATUS_LABEL[t.status] || t.status },
    replies: replies.results, clip, site,
    can_reply: identity.type !== 'none',
    can_manage: admin,
    is_author: identity.type === 'user' && String(identity.userId) === String(t.author_id)
  });
});

// 添加回复（登录即可；管理员回复记为官方回复）
app.post('/api/tickets/:code/reply', async (c) => {
  const db = c.env.db;
  const code = c.req.param('code');
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);
  const t = await db.prepare('SELECT id, code, status, author_id, author_type FROM tickets WHERE code = ?').bind(code).first();
  if (!t) return c.json({ error: 'not_found' }, 404);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const content = (body.content || '').toString().slice(0, 3000);
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);
  const isStaff = await isAdminIdentity(db, identity);
  const authorName = identity.type === 'user' ? (identity.name || '用户') : '游客';
  await db.prepare(
    "INSERT INTO ticket_replies (ticket_id, author_id, author_name, author_type, is_staff, content, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(t.id, identity.type === 'user' ? String(identity.userId) : (identity.guestId || ''), authorName, identity.type === 'user' ? 'user' : 'guest', isStaff ? 1 : 0, content).run();
  await db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").bind(t.id).run();
  // 通知工单作者（非本人回复时推送）
  try {
    if (t.author_type === 'user' && t.author_id && String(t.author_id) !== String(identity.userId)) {
      await createNotification(db, t.author_id, 'ticket',
        '💬 你的工单 ' + t.code + ' 收到新回复',
        (isStaff ? '管理员' : authorName) + '回复了你的工单',
        '/tickets/' + t.code);
    }
  } catch (e) { /* 通知失败不影响主流程 */ }
  return c.json({ ok: true });
});

// 管理员处理工单：改状态 / 处理说明 / 指派 / 删除关联内容
app.patch('/api/tickets/:code', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'manage_tickets'))) return c.json({ error: 'forbidden', message: '无处理工单权限（需 manage_tickets）' }, 403);
  const code = c.req.param('code');
  const t = await db.prepare('SELECT id, code, related_clip_id, related_site_slug, status, author_id, author_type FROM tickets WHERE code = ?').bind(code).first();
  if (!t) return c.json({ error: 'not_found' }, 404);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const sets = [], binds = [];
  if (body.status) {
    if (!TICKET_STATUSES.includes(body.status)) return c.json({ error: 'bad_status' }, 400);
    sets.push('status = ?'); binds.push(body.status);
    if (body.status === 'resolved' || body.status === 'rejected') sets.push("resolved_at = datetime('now')");
    else sets.push('resolved_at = NULL');
  }
  if (body.admin_note !== undefined) { sets.push('admin_note = ?'); binds.push((body.admin_note || '').toString().slice(0, 2000)); }
  if (body.assignee_name !== undefined) { sets.push('assignee_name = ?'); binds.push((body.assignee_name || '').toString().slice(0, 60)); }
  // v4.20：被举报对象为站点时，管理员可直接封禁 / 删除该站点
  const action = ['delete_clip', 'suspend_site', 'unsuspend_site', 'delete_site'].includes(body.action) ? body.action : '';
  // v4.21：申诉工单可直接解封站点（需 ban_sites 权限）
  if (action === 'unsuspend_site' && t.related_site_slug) {
    if (!(await hasAdminPerm(db, identity, 'ban_sites'))) return c.json({ error: 'forbidden', message: '无解封站点权限（需 ban_sites）' }, 403);
    const kv = c.env.SITE_KV;
    const slug = t.related_site_slug;
    const sr = await db.prepare('SELECT slug, file_count FROM sites WHERE slug = ?').bind(slug).first();
    if (sr) {
      const st = (sr.file_count || 0) > 0 ? 'published' : 'draft';
      await db.prepare("UPDATE sites SET status = ?, suspend_reason = NULL, updated_at = datetime('now') WHERE slug = ?").bind(st, slug).run();
      if (kv) { try { await kv.put(SITE_PREFIX(slug) + '__status', st); } catch { /* ignore */ } }
      try {
        const own = await db.prepare('SELECT owner_id FROM sites WHERE slug = ?').bind(slug).first();
        if (own) await createNotification(db, own.owner_id, 'site', '✅ 你的站点 ' + slug + ' 申诉成功，已恢复', '管理员已解除封禁，站点可正常访问。', '/sites/' + slug);
      } catch { /* ignore */ }
    }
    if (!sets.length) sets.push("updated_at = datetime('now')");
  }
  if (action === 'suspend_site' && t.related_site_slug) {
    if (!(await hasAdminPerm(db, identity, 'ban_sites'))) return c.json({ error: 'forbidden', message: '无封禁站点权限（需 ban_sites）' }, 403);
    const kv = c.env.SITE_KV;
    const slug = t.related_site_slug;
    const st = await db.prepare('SELECT slug FROM sites WHERE slug = ?').bind(slug).first();
    if (st) {
      const why = (body.reason || '').toString().slice(0, 200) || '违反站点托管规范（工单 ' + t.code + '）';
      await db.prepare("UPDATE sites SET status = 'suspended', suspend_reason = ?, updated_at = datetime('now') WHERE slug = ?").bind(why, slug).run();
      if (kv) { try { await kv.put(SITE_PREFIX(slug) + '__status', 'suspended'); } catch { /* ignore */ } }
    }
    if (!sets.length) sets.push("updated_at = datetime('now')");
  }
  if (action === 'delete_site' && t.related_site_slug) {
    if (!(await hasAdminPerm(db, identity, 'delete_sites'))) return c.json({ error: 'forbidden', message: '无删除站点权限（需 delete_sites）' }, 403);
    const kv = c.env.SITE_KV;
    const slug = t.related_site_slug;
    if (kv) {
      try {
        const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
        for (const k of (listed.keys || [])) { try { await kv.delete(k.name); } catch { /* ignore */ } }
      } catch { /* ignore */ }
    }
    await db.prepare('DELETE FROM sites WHERE slug = ?').bind(slug).run();
    if (!sets.length) sets.push("updated_at = datetime('now')");
  }
  if (action === 'delete_clip' && t.related_clip_id) {
    const clipId = t.related_clip_id;
    const cr = await db.prepare('SELECT clip_id, is_public FROM clipboards WHERE clip_id = ?').bind(clipId).first();
    if (cr && !(await hasAdminClipPerm(db, identity, cr, 'delete'))) {
      return c.json({ error: 'forbidden', message: cr.is_public ? '无删除公开剪贴板权限（需 delete_public_clips）' : '无删除私有剪贴板权限（需 delete_private_clips）' }, 403);
    }
    await db.prepare('DELETE FROM clipboards WHERE clip_id = ?').bind(clipId).run();
    await db.prepare('DELETE FROM comments WHERE clip_id = ?').bind(clipId).run();
    await db.prepare('DELETE FROM clip_readers WHERE clip_id = ?').bind(clipId).run();
    await db.prepare('DELETE FROM clip_reports WHERE clip_id = ?').bind(clipId).run();
    if (!sets.length) sets.push("updated_at = datetime('now')");
  }
  if (!sets.length) return c.json({ error: 'nothing' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(code);
  await db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE code = ?`).bind(...binds).run();
  // 通知工单作者：状态变更（仅用户作者且非本人处理时推送，避免管理员改自己工单自通知）
  try {
    if (body.status && t.author_type === 'user' && t.author_id && String(t.author_id) !== String(identity.userId)) {
      const label = TICKET_STATUS_LABEL[body.status] || body.status;
      await createNotification(db, t.author_id, 'ticket',
        '🛠 你的工单 ' + t.code + ' 状态更新为「' + label + '」',
        (body.admin_note ? '处理说明：' + String(body.admin_note).slice(0, 120) : '管理员已处理该工单'),
        '/tickets/' + t.code);
    }
  } catch (e) { /* 通知失败不影响主流程 */ }
  return c.json({ ok: true });
});

// 管理员删除工单（连带回复）
app.delete('/api/tickets/:code', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'manage_tickets'))) return c.json({ error: 'forbidden', message: '无删除工单权限（需 manage_tickets）' }, 403);
  const code = c.req.param('code');
  const t = await db.prepare('SELECT id FROM tickets WHERE code = ?').bind(code).first();
  if (!t) return c.json({ error: 'not_found' }, 404);
  await db.prepare('DELETE FROM ticket_replies WHERE ticket_id = ?').bind(t.id).run();
  await db.prepare('DELETE FROM tickets WHERE id = ?').bind(t.id).run();
  return c.json({ ok: true });
});

// ========== 查看代码 / 在线编辑 / 审批部署（GitHub 桥接） ==========
const GH_REPO = 'yanzien/mdqp';
const GH_BRANCH = 'main';
const GH_ALLOW = /\.(js|mjs|ts|tsx|jsx|html|css|scss|sql|json|md|toml|yml|yaml|txt|xml|svg|wgsl|go|py|rs|c|cpp|h|sh|lock)$/i;
const GH_SKIP_DIRS = new Set(['node_modules', 'pages-build', '.git', '.wrangler', 'dist', 'build', 'coverage', 'vendor', 'assets']);

function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); }
function b64dec(b64) { const bin = atob(b64.replace(/\s/g, '')); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }

async function ghApi(c, path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'mdqp-code', 'X-GitHub-Api-Version': '2022-11-28' };
  if (c.env.GITHUB_TOKEN) headers['Authorization'] = 'Bearer ' + c.env.GITHUB_TOKEN;
  const r = await fetch('https://api.github.com' + path, { ...opts, headers });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('GitHub ' + r.status + ' ' + t.slice(0, 160)); }
  return r;
}
async function ghGetFile(c, path) {
  const r = await ghApi(c, `/repos/${GH_REPO}/contents/${encodeURI(path)}?ref=${GH_BRANCH}`);
  const j = await r.json();
  const content = (j.content && j.encoding === 'base64') ? b64dec(j.content) : '';
  return { content, sha: j.sha, size: j.size };
}
async function ghPutFile(c, path, content, sha, message) {
  const body = { message, content: b64enc(content), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const r = await ghApi(c, `/repos/${GH_REPO}/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
  return r.json();
}
async function ghGetTree(c) {
  const r = await ghApi(c, `/repos/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
  const j = await r.json();
  const files = (j.tree || []).filter((x) => x.type === 'blob' && GH_ALLOW.test(x.path) && !x.path.split('/').some((s) => GH_SKIP_DIRS.has(s)));
  return files.map((f) => ({ path: f.path, size: f.size }));
}

// 文件树（需 view_code）
app.get('/api/admin/code/tree', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  try { return c.json({ ok: true, files: await ghGetTree(c) }); }
  catch (e) { return c.json({ error: 'gh_error', message: String(e.message || e) }, 502); }
});

// 单文件内容（需 view_code）
app.get('/api/admin/code/file', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  const path = c.req.query('path'); if (!path) return c.json({ error: 'no_path' }, 400);
  try { const f = await ghGetFile(c, path); return c.json({ ok: true, path, content: f.content, sha: f.sha, size: f.size }); }
  catch (e) { return c.json({ error: 'gh_error', message: String(e.message || e) }, 502); }
});

// 开发者：直接编辑并即刻部署（写 GitHub → 触发 Actions 自动部署）
app.post('/api/admin/code/apply', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  const u = await db.prepare('SELECT role FROM users WHERE id = ?').bind(String(identity.userId)).first();
  if (!u || u.role !== 'developer') return c.json({ error: 'need_developer' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const { path, content, sha, message } = body;
  if (!path || content === undefined) return c.json({ error: 'missing' }, 400);
  if (!c.env.GITHUB_TOKEN) return c.json({ error: 'no_gh_token' }, 500);
  try { const res = await ghPutFile(c, path, content, sha, message || ('chore: edit ' + path)); return c.json({ ok: true, commit: res?.commit?.sha || null }); }
  catch (e) { return c.json({ error: 'gh_error', message: String(e.message || e) }, 502); }
});

// 其他管理：提交改动审批（覆盖同文件未完成审批）——需「编辑并提交代码」权限（开发者始终具备）
app.post('/api/admin/code/submit', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'edit_code'))) return c.json({ error: 'forbidden' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const { path, content, sha } = body;
  if (!path || content === undefined) return c.json({ error: 'missing' }, 400);
  const authorName = identity.name || ('user#' + identity.userId);
  const existing = await db.prepare("SELECT id FROM code_change_requests WHERE file_path = ? AND author_id = ? AND status = 'pending'").bind(path, String(identity.userId)).first();
  if (existing) {
    await db.prepare("UPDATE code_change_requests SET new_content = ?, old_sha = ?, status = 'pending', admin_note = '', updated_at = datetime('now') WHERE id = ?").bind(content, sha || '', existing.id).run();
    return c.json({ ok: true, id: existing.id, overwritten: true });
  }
  await db.prepare("INSERT INTO code_change_requests (file_path, author_id, author_name, old_sha, new_content, status) VALUES (?, ?, ?, ?, ?, 'pending')").bind(path, String(identity.userId), authorName, sha || '', content).run();
  return c.json({ ok: true });
});

// 审批队列列表（需 view_code）
app.get('/api/admin/code/requests', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  const rows = await db.prepare("SELECT id, file_path, author_id, author_name, status, admin_note, created_at, updated_at FROM code_change_requests ORDER BY (status='pending') DESC, updated_at DESC").all();
  return c.json({ ok: true, requests: rows.results || [] });
});

// 审批详情：取当前线上内容用于查重对比
app.get('/api/admin/code/diff', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.query('id'); if (!id) return c.json({ error: 'no_id' }, 400);
  const req = await db.prepare('SELECT * FROM code_change_requests WHERE id = ?').bind(id).first();
  if (!req) return c.json({ error: 'not_found' }, 404);
  try { const cur = await ghGetFile(c, req.file_path); return c.json({ ok: true, current: cur.content, proposed: req.new_content }); }
  catch (e) { return c.json({ error: 'gh_error', message: String(e.message || e) }, 502); }
});

// 开发者：审批（通过→应用并触发部署；驳回→不允许/酌情采纳）
app.patch('/api/admin/code/request/:id', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
  const u = await db.prepare('SELECT role FROM users WHERE id = ?').bind(String(identity.userId)).first();
  if (!u || u.role !== 'developer') return c.json({ error: 'need_developer' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const id = c.req.param('id');
  const req = await db.prepare('SELECT * FROM code_change_requests WHERE id = ?').bind(id).first();
  if (!req) return c.json({ error: 'not_found' }, 404);
  const status = body.status;
  const adminNote = (body.admin_note || '').toString().slice(0, 2000);
  if (status === 'approved') {
    if (!c.env.GITHUB_TOKEN) return c.json({ error: 'no_gh_token' }, 500);
    const finalContent = body.final_content !== undefined && body.final_content !== null ? body.final_content : req.new_content;
    try {
      const cur = await ghGetFile(c, req.file_path); // 取最新 sha 防冲突
      await ghPutFile(c, req.file_path, finalContent, cur.sha, 'apply: ' + req.file_path + ' (admin review #' + id + ')');
      await db.prepare("UPDATE code_change_requests SET status='approved', admin_note=?, updated_at=datetime('now') WHERE id=?").bind(adminNote, id).run();
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: 'gh_error', message: String(e.message || e) }, 502); }
  } else if (status === 'rejected') {
    await db.prepare("UPDATE code_change_requests SET status='rejected', admin_note=?, updated_at=datetime('now') WHERE id=?").bind(adminNote, id).run();
    return c.json({ ok: true });
  }
  return c.json({ error: 'bad_status' }, 400);
});

// ========== 公开剪贴板列表 ==========

app.get('/api/clips', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const db = c.env.db;
  try {
  await maybeCleanupExpired(db);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim().slice(0, SEARCH_MAX);
  const offset = (page - 1) * PAGE_SIZE;

  // v4.8.2: 带 c. 前缀（需 LEFT JOIN users 取作者角色/VIP）
  let where = "WHERE c.is_public = 1 AND (c.expires_at IS NULL OR c.expires_at > datetime('now')) AND (c.max_views = 0 OR c.views < c.max_views)";
  const params = [];
  if (q) {
    where += ' AND (c.title LIKE ? OR c.content LIKE ? OR c.owner_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM clipboards c ${where}`).bind(...params).first();
  const total = totalRow?.cnt || 0;

  const rows = await db
    .prepare(
      `SELECT c.clip_id, c.title, c.content, c.owner_type, c.owner_id, c.owner_name, c.editable_by_anyone,
              c.password_hash, c.expires_at, c.max_views, c.views, c.created_at, c.updated_at,
              c.login_required, c.max_readers, COALESCE(c.tags, '') AS tags,
              u.role AS owner_role, u.admin_level AS owner_admin_level, u.is_vip AS owner_is_vip, u.vip_until AS owner_vip_until
       FROM clipboards c
       LEFT JOIN users u ON c.owner_type = 'user' AND u.id = c.owner_id
       ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, PAGE_SIZE, offset)
    .all();

  return c.json({
    clips: rows.results.map((r) => ({
      clip_id: r.clip_id,
      title: r.title || '无标题',
      preview: r.password_hash ? '🔒 此剪贴板受密码保护' : makePreview(r.content),
      has_password: !!r.password_hash,
      owner_type: r.owner_type,
      owner_id: r.owner_id,
      owner_name: r.owner_name,
      // v4.8.2: 作者角色/VIP，供首页与剪贴板页在用户名后显示身份 tag
      owner_role: r.owner_role || null,
      owner_admin_level: r.owner_admin_level != null ? parseInt(r.owner_admin_level, 10) : null,
      owner_is_vip: !!r.owner_is_vip,
      owner_vip_until: r.owner_vip_until || null,
      editable_by_anyone: !!r.editable_by_anyone,
      expires_at: r.expires_at,
      max_views: r.max_views,
      views: r.views,
      login_required: !!r.login_required,
      max_readers: r.max_readers,
      // v4.7.5 反馈 #5：列表也返回标签（此前只在 /api/me/clips 返回，首页卡片永远空）
      tags: parseTags(r.tags),
      created_at: r.created_at,
      updated_at: r.updated_at
    })),
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE))
  });
  } catch {
    // D1 读配额耗尽等故障：降级为 200 空列表，避免前端整片 500
    return c.json({ clips: [], page: 1, total: 0, totalPages: 1, degraded: true });
  }
});

// ========== 单个剪贴板（含读者追踪 + 登录门禁） ==========

app.get('/api/clips/:clipId', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);

  const identity = await getIdentity(c);
  const admin = await isAdminIdentity(db, identity);
  const mine = canWrite(identity, r) || admin;

  if (isExpired(r) && !mine) {
    const reason = r.expires_at && new Date(r.expires_at.replace(' ', 'T') + 'Z') < new Date() ? 'expired' :
      (r.max_readers > 0 ? 'reader_limit_reached' : 'view_limit_reached');
    return c.json({ error: 'gone', reason }, 410);
  }

  // === v4.0: 登录门禁 ===
  if (r.login_required && !mine && identity.type !== 'user') {
    return c.json({ error: 'login_required', message: '作者设置了仅登录用户可查看', title: r.title || '受保护的剪贴板' }, 401);
  }

  // 密码校验
  if (r.password_hash && !isOwner(identity, r) && !admin) {
    const pwd = c.req.query('pwd') || c.req.header('X-Clip-Password') || '';
    if (!pwd) return c.json({ error: 'password_required', title: r.title || '受保护的剪贴板' }, 401);
    if ((await hashPassword(pwd)) !== r.password_hash) return c.json({ error: 'password_wrong' }, 403);
  }

  // === v4.0: 唯一读者追踪 ===
  let readerCount = r.reader_count || 0;
  if (!isOwner(identity, r)) {
    const fp = identity.type === 'user' ? ('u-' + identity.userId) : guestFingerprint(c.req.raw);
    // 检查是否已记录过此读者
    const existing = await db.prepare(
      'SELECT id FROM clip_readers WHERE clip_id = ? AND reader_type = ? AND reader_id = ?'
    ).bind(clipId, identity.type, fp).first();

    if (!existing) {
      await db.prepare(
        'INSERT INTO clip_readers (clip_id, reader_type, reader_id) VALUES (?, ?, ?)'
      ).bind(clipId, identity.type, fp).run();
      // 真实写入 DB 计数，否则 isExpired 永远判不满员（P0 修复）
      await db.prepare('UPDATE clipboards SET reader_count = reader_count + 1 WHERE clip_id = ?').bind(clipId).run();
      readerCount = (r.reader_count || 0) + 1;
      // 剪贴板被外部访客首次访问 → 通知 owner（去重：每张仅提示一次；通知失败不影响阅读）
      if (r.owner_type === 'user' && !r.visit_notified) {
        try {
          await createNotification(db, r.owner_id, 'clip_visited', '👀 你的剪贴板被访问了', `《${r.title || '无标题'}》有新的访客查看。`, '/c/' + clipId);
          await db.prepare('UPDATE clipboards SET visit_notified = 1 WHERE clip_id = ?').bind(clipId).run();
        } catch (e) { /* 通知失败不影响访问 */ }
      }
    }
    // 兼容旧版 views 计数
    await db.prepare('UPDATE clipboards SET views = views + 1 WHERE clip_id = ?').bind(clipId).run();
  }

  // v4.8.2: 作者身份（角色/VIP），供剪贴板页在用户名后显示 tag
  const ownerInfo = r.owner_type === 'user'
    ? await db.prepare('SELECT role, admin_level, is_vip, vip_until FROM users WHERE id = ?').bind(String(r.owner_id)).first()
    : null;

  return c.json({
    clip_id: r.clip_id,
    title: r.title,
    content: r.content,
    owner_type: r.owner_type,
    owner_id: r.owner_id,
    owner_name: r.owner_name,
    // v4.8.2: 作者角色/VIP（游客为 null）
    owner_role: ownerInfo?.role || null,
    owner_is_vip: !!ownerInfo?.is_vip,
    owner_vip_until: ownerInfo?.vip_until || null,
    is_public: !!r.is_public,
    editable_by_anyone: !!r.editable_by_anyone,
    has_password: !!r.password_hash,
    expires_at: r.expires_at,
    max_views: r.max_views,
    views: r.views + (isOwner(identity, r) ? 0 : 1),
    reader_count: readerCount,
    max_readers: r.max_readers,
    login_required: !!r.login_required,
    can_edit: mine,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // v4.6: 标签（详情/编辑页回显用）
    tags: parseTags(r.tags)
  });
});

// ========== VIP 判定（字数限制豁免用，需考虑 vip_until 有效期） ==========
/** 判断一条用户记录是否为「有效 VIP」：is_vip=1 且 vip_until 未过期（空=永久） */
function isVipActive(row) {
  if (!row || !row.is_vip) return false;
  if (!row.vip_until) return true;
  const t = new Date(String(row.vip_until).replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(t)) return true; // 解析不出就按永久处理，避免误伤
  return t > Date.now();
}
/** 按 identity 查用户 VIP 状态（游客/匿名一律 false） */
async function isVipIdentity(db, identity) {
  if (!identity || identity.type !== 'user') return false;
  const u = await db.prepare('SELECT is_vip, vip_until FROM users WHERE id = ?').bind(String(identity.userId)).first();
  return isVipActive(u);
}

// ========== 创建剪贴板（限额 + 字数限制 + 功能开关） ==========

app.post('/api/clips', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized', message: '缺少身份标识' }, 401);
  // v4.27：全局剪贴板禁用 + 单用户剪贴板禁用
  const cdf = await db.prepare("SELECT value FROM site_settings WHERE key='disabled_features'").first();
  if (parseInt(cdf?.value || '0', 10) & DF_CLIPBOARD) return c.json({ error: 'clipboard_disabled', message: '剪贴板功能已临时关闭' }, 503);
  if (identity.type === 'user' && await isUserFeatureDisabled(db, identity.userId, DF_CLIPBOARD)) return c.json({ error: 'your_clipboard_disabled', message: '你的剪贴板功能已被管理员关闭' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  const title = (body.title || '').toString().slice(0, 200);
  const content = (body.content || '').toString();
  if (!content.trim()) return c.json({ error: 'empty_content', message: '内容不能为空' }, 400);
  if (content.length > 400000) return c.json({ error: 'too_large', message: '内容超过 400KB' }, 413);

  // === v4.6: 字数按信任等级 / VIP 分级（不再是全站一刀切 300） ===
  const isAdmin = await isAdminIdentity(db, identity);
  const isVip = await isVipIdentity(db, identity);
  const trustBase = identity.type === 'user'
    ? await buildTrustBase(db, identity.userId)
    : null;
  const ben = await resolveBenefits(db, identity, trustBase);
  const charLimit = ben.charLimit;
  const charCount = countChars(content);
  if (charCount > charLimit) {
    return c.json({
      error: 'char_limit_exceeded',
      message: `内容 ${charCount} 等效字，超出你当前的 ${charLimit} 字上限（注：非英文字符算 1 字，英文/标点算 0.5 字）。${ben.unlimited ? '' : '提升信任等级可解锁更高额度。'}`,
      char_count: charCount,
      limit: charLimit,
      trust_level: ben.level,
      tip: ben.unlimited ? '' : nextLevelUnlocks(ben.level, ben.isVip, ben.isStaff).find((s) => s.startsWith('单篇字数')) || '升级信任等级可解锁更高额度'
    }, 400);
  }

  const isPublic = body.is_public !== false;
  const expiresAt = parseExpiry(body.expires_in);
  const maxViews = Math.max(0, parseInt(body.max_views || '0') || 0);
  const passwordHash = body.password ? await hashPassword(String(body.password)) : '';

  // === v4.0: 功能开关检查 ===
  if (identity.type === 'user' && !isAdmin) {
    const flags = await getUserFeatures(db, identity.userId);
    if (body.password && !flags.password) return c.json({ error: 'feature_disabled', message: '你没有使用密码保护功能的权限' }, 403);
    if (expiresAt && !flags.expiry) return c.json({ error: 'feature_disabled', message: '你没有使用定时过期功能的权限' }, 403);
    if (maxViews > 0 && !flags.max_views) return c.json({ error: 'feature_disabled', message: '你没有设置阅读次数限制的权限' }, 403);
    if (body.login_required && !flags.login_required) return c.json({ error: 'feature_disabled', message: '你没有设置登录可见的权限' }, 403);
    if ((body.max_readers || 0) > 0 && !flags.max_readers) return c.json({ error: 'feature_disabled', message: '你没有设置读者数限制的权限' }, 403);
  }

  let ownerType, ownerId, ownerName, editableByAnyone;
  if (identity.type === 'guest') {
    // === v4.0: 游客周限 5 个 ===
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const cnt = (
      await db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'guest' AND owner_id = ? AND created_at >= ?")
        .bind(identity.guestId, weekAgo).first()
    ).cnt;
    const guestWeeklyLimit = parseInt(await getSiteSetting(db, 'guest_weekly_limit', '5')) || 5;
    if (cnt >= guestWeeklyLimit) {
      return c.json({ error: 'guest_limit', message: `游客每周最多创建 ${guestWeeklyLimit} 个剪贴板，登录后额度更多`, count: cnt, limit: guestWeeklyLimit, period: 'weekly' }, 403);
    }
    ownerType = 'guest'; ownerId = identity.guestId; ownerName = '游客'; editableByAnyone = 1;
  } else {
    ownerType = 'user'; ownerId = String(identity.userId); ownerName = identity.name || '用户';

    // === v4.0: 协作板功能开关 ===
    const flags = await getUserFeatures(db, identity.userId);
    editableByAnyone = (body.editable_by_anyone ? 1 : 0);
    if (editableByAnyone && !flags.collaboration && !isAdmin) editableByAnyone = 0;

    // === v4.0: 登录用户日限/月限 ===
    if (!isAdmin) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 19).replace('T', ' ');
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 19).replace('T', ' ');
      // v4.6: 额度按信任等级分级（-1 = 不限）
      const dailyLimit = ben.benefits.daily;
      const monthlyLimit = ben.benefits.monthly;

      const [dayCnt, monthCnt] = await Promise.all([
        db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ? AND created_at >= ?").bind(ownerId, todayStart).first(),
        db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ? AND created_at >= ?").bind(ownerId, monthStart).first()
      ]);

      if (monthlyLimit !== -1 && monthCnt.cnt >= monthlyLimit) {
        return c.json({ error: 'monthly_limit', message: `本月剪贴板数量已达上限（${monthlyLimit} 个）`, count: monthCnt.cnt, limit: monthlyLimit, period: 'monthly' }, 403);
      }
      if (dailyLimit !== -1 && dayCnt.cnt >= dailyLimit) {
        return c.json({ error: 'daily_limit', message: `今日剪贴板数量已达上限（${dailyLimit} 个），明天再来吧`, count: dayCnt.cnt, limit: dailyLimit, period: 'daily' }, 403);
      }
    }

    // 管理员设置的总量限制（保留旧逻辑）
    const limitRow = await db.prepare('SELECT clip_limit FROM users WHERE id = ?').bind(ownerId).first();
    if (limitRow?.clip_limit) {
      const totalCnt = (await db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ?").bind(ownerId).first()).cnt;
      if (totalCnt >= limitRow.clip_limit) {
        return c.json({ error: 'clip_limit', message: `你的剪贴板数量已达管理员设定的上限（${limitRow.clip_limit} 个）`, count: totalCnt, limit: limitRow.clip_limit }, 403);
      }
    }
  }

  // 自定义短链（功能开关控制）
  let clipId;
  const custom = (body.custom_id || '').toString().trim().toLowerCase();
  if (custom) {
    if (identity.type === 'user' && !isAdmin) {
      const flags = await getUserFeatures(db, identity.userId);
      if (!flags.custom_slug) return c.json({ error: 'feature_disabled', message: '你没有使用自定义短链的权限' }, 403);
    }
    if (!validSlug(custom)) return c.json({ error: 'bad_slug', message: '短链需 3-32 位小写字母/数字/-/_，且不能是保留字' }, 400);
    const dup = await db.prepare('SELECT 1 FROM clipboards WHERE clip_id = ?').bind(custom).first();
    if (dup) return c.json({ error: 'slug_taken', message: '该短链已被占用' }, 409);
    clipId = custom;
  } else {
    for (let i = 0; i < 12; i++) {
      clipId = genClipId();
      const dup = await db.prepare('SELECT 1 FROM clipboards WHERE clip_id = ?').bind(clipId).first();
      if (!dup) break;
    }
  }

  const loginRequired = body.login_required ? 1 : 0;
  const maxReaders = Math.max(0, parseInt(body.max_readers || '0') || 0);

  // v4.6: 标签（按信任等级限额截断）
  const tagsStr = serializeTags(body.tags, ben.benefits.tags);

  await db.prepare(
    `INSERT INTO clipboards
      (clip_id, title, content, owner_type, owner_id, owner_name, is_public, editable_by_anyone,
       password_hash, expires_at, max_views, login_required, max_readers, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(clipId, title, content, ownerType, ownerId, ownerName, isPublic ? 1 : 0, editableByAnyone, passwordHash, expiresAt, maxViews, loginRequired, maxReaders, tagsStr).run();

  // M3 埋点：剪贴板创建（旁路，失败不影响返回）
  await logEvent(db, 'mdqp', 'clip.create', ownerType === 'user' ? ownerId : '', clipId, isPublic ? 'public' : 'private');

  return c.json({ ok: true, clip_id: clipId, owner_type: ownerType, tags: parseTags(tagsStr) });
});

// ========== 修改剪贴板（支持修改短链） ==========

app.put('/api/clips/:clipId', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);

  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);
  // v4.21：管理员改他人剪贴板须有对应可见性的 edit 权限（公开 / 私有分开）
  const admin = await hasAdminClipPerm(db, identity, r, 'edit');
  if (!canWrite(identity, r) && !admin) return c.json({ error: 'forbidden' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  const isOwnerFlag = admin || !r.editable_by_anyone || (identity.type === 'user' && String(identity.userId) === String(r.owner_id));

  const title = body.title !== undefined ? String(body.title).slice(0, 200) : r.title;
  const content = body.content !== undefined ? String(body.content) : r.content;
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);
  const isPublic = body.is_public !== undefined ? (body.is_public ? 1 : 0) : r.is_public;

  // v4.6: 字数按信任等级 / VIP 分级（修改时同样校验）
  const isAdmin = admin;
  const isVip = await isVipIdentity(db, identity);
  const editTrustBase = identity.type === 'user' ? await buildTrustBase(db, identity.userId) : null;
  const editBen = await resolveBenefits(db, identity, editTrustBase);
  const editCharCount = countChars(content);
  if (editCharCount > editBen.charLimit) {
    return c.json({
      error: 'char_limit_exceeded',
      message: `内容 ${editCharCount} 等效字，超出你当前的 ${editBen.charLimit} 字上限`,
      char_count: editCharCount,
      limit: editBen.charLimit,
      tip: editBen.unlimited ? '' : '提升信任等级可解锁更高额度'
    }, 400);
  }

  let expiresAt = r.expires_at, maxViews = r.max_views, passwordHash = r.password_hash;
  if (isOwnerFlag) {
    if (body.expires_in !== undefined) expiresAt = parseExpiry(body.expires_in);
    if (body.max_views !== undefined) maxViews = Math.max(0, parseInt(body.max_views) || 0);
    if (body.password !== undefined) passwordHash = body.password ? await hashPassword(String(body.password)) : '';
  }

  // === v4.0: 允许修改短链（有权限的用户） ===
  let newClipId = clipId;
  if (body.new_slug && body.new_slug !== clipId && isOwnerFlag) {
    const newSlug = String(body.new_slug).trim().toLowerCase();
    if (!validSlug(newSlug)) return c.json({ error: 'bad_slug', message: '新短链格式不合法' }, 400);
    const dup = await db.prepare('SELECT 1 FROM clipboards WHERE clip_id = ?').bind(newSlug).first();
    if (dup) return c.json({ error: 'slug_taken', message: '该短链已被占用' }, 409);
    // 执行短链变更
    await db.prepare('UPDATE clipboards SET clip_id = ? WHERE clip_id = ?').bind(newSlug, clipId).run();
    // 同步更新评论表的引用
    await db.prepare('UPDATE comments SET clip_id = ? WHERE clip_id = ?').bind(newSlug, clipId).run();
    // 同步更新读者追踪
    await db.prepare('UPDATE clip_readers SET clip_id = ? WHERE clip_id = ?').bind(newSlug, clipId).run();
    newClipId = newSlug;
  }

  const loginRequired = body.login_required !== undefined ? (body.login_required ? 1 : 0) : (r.login_required || 0);
  const maxReaders = body.max_readers !== undefined ? Math.max(0, parseInt(body.max_readers) || 0) : (r.max_readers || 0);

  // v4.6: 标签（未传则保持原值；传了按等级限额截断）
  const tagsStr = body.tags !== undefined ? serializeTags(body.tags, editBen.benefits.tags) : (r.tags || '');

  // === v4.34: 版本历史——编辑前留存旧内容（L0 不留存；按权益配额裁剪） ===
  let revLimit = 0;
  try { revLimit = Number(editBen.benefits?.revisions) || 0; } catch (_) {}
  if (revLimit !== 0 && (title !== (r.title || '') || content !== (r.content || '') || tagsStr !== (r.tags || ''))) {
    try {
      await db.prepare(
        `INSERT INTO clip_versions (clip_id, title, content, tags, saved_by) VALUES (?, ?, ?, ?, ?)`
      ).bind(newClipId, r.title || '', r.content || '', r.tags || '', identity.type === 'user' ? String(identity.userId) : 'guest').run();
      if (revLimit > 0) {
        await db.prepare(
          `DELETE FROM clip_versions WHERE clip_id = ? AND id NOT IN (SELECT id FROM clip_versions WHERE clip_id = ? ORDER BY id DESC LIMIT ?)`
        ).bind(newClipId, newClipId, revLimit).run();
      }
    } catch (_) { /* 迁移未执行时不阻断保存 */ }
  }

  await db.prepare(
    `UPDATE clipboards SET title = ?, content = ?, is_public = ?, expires_at = ?, max_views = ?,
       password_hash = ?, updated_at = datetime('now'), login_required = ?, max_readers = ?, tags = ? WHERE clip_id = ?`
  ).bind(title, content, isPublic, expiresAt, maxViews, passwordHash, loginRequired, maxReaders, tagsStr, newClipId).run();

  return c.json({ ok: true, clip_id: newClipId, tags: parseTags(tagsStr) });
});

// ========== v4.14: 举报改为统一工单（见 /api/tickets，category=report） ==========

// ========== 删除 ==========

app.delete('/api/clips/:clipId', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);
  // v4.21：管理员删他人剪贴板须有对应可见性的 delete 权限（公开 / 私有分开）
  if (!canWrite(identity, r) && !(await hasAdminClipPerm(db, identity, r, 'delete'))) return c.json({ error: 'forbidden' }, 403);
  await db.prepare('DELETE FROM clipboards WHERE clip_id = ?').bind(clipId).run();
  // 级联删除关联数据
  await db.prepare('DELETE FROM comments WHERE clip_id = ?').bind(clipId).run();
  await db.prepare('DELETE FROM clip_readers WHERE clip_id = ?').bind(clipId).run();
  return c.json({ ok: true });
});

// ========== 用户主页（扩展：VIP、邀请、功能状态） ==========

app.get('/api/users/:userId', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const db = c.env.db;
  const userId = c.req.param('userId');
  const u = await db.prepare(
    // has_pw 用 SQL 计算，避免 password_hash 进入 JS 作用域后被误返回
    `SELECT id, sub, username, display_name, avatar, bio, signature, role, linked_accounts,
            clip_limit, limit_period, created_at, is_vip, vip_until, invite_code,
            inviter_id, invite_count, feature_flags,
            (password_hash IS NOT NULL AND password_hash != '') AS has_pw
     FROM users WHERE id = ? OR sub = ? OR username = ?`
  ).bind(userId, userId, userId).first();
  if (!u) return c.json({ error: 'not_found' }, 404);

  const identity = await getIdentity(c);
  const isSelf = identity.type === 'user' && String(identity.userId) === String(u.id);
  const adminViewer = await isAdminIdentity(db, identity);

  const visibility = isSelf || adminViewer
    ? '' : " AND is_public = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) AND (max_views = 0 OR views < max_views)";

  const clips = await db.prepare(
    `SELECT clip_id, title, content, owner_name, is_public, editable_by_anyone, password_hash,
            expires_at, max_views, views, created_at
     FROM clipboards WHERE owner_type = 'user' AND owner_id = ?${visibility}
     ORDER BY created_at DESC LIMIT 100`
  ).bind(String(u.id)).all();

  const totalRow = await db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ?").bind(String(u.id)).first();
  const st = await getTrustStats(db, u.id);
  const trustBase = { clip_count: st.total, clips_14d: st.c14, clips_5d: st.c5, created_at: u.created_at, invite_count: u.invite_count || 0, is_vip: !!u.is_vip, role: u.role };
  const trustLv = computeTrustLevel(trustBase);

  return c.json({
    user: {
      id: u.id, sub: u.sub, username: u.username, display_name: u.display_name || u.username,
      avatar: u.avatar, bio: u.bio || '', signature: u.signature || '', tag: u.tag || '',
      role: u.role || 'user', linked_accounts: parseLinkedAccounts(u.linked_accounts),
      clip_limit: u.clip_limit, limit_period: u.limit_period, created_at: u.created_at,
      clip_count: totalRow?.cnt || 0,
      // v4.0
      is_vip: !!u.is_vip, vip_until: u.vip_until,
      invite_code: u.invite_code || '',
      invite_count: u.invite_count || 0,
      feature_flags: parseFeatureFlags(u.feature_flags),
      // v4.4: 公开字段
      cpoauth_bound: !!u.sub,
      trust_level: trustLv,
      // v4.5.2: 维持制进度（仅本人 / 管理员可见，避免对外暴露行为细节）
      trust_progress: (isSelf || adminViewer) ? trustProgress(trustBase, trustLv) : undefined,
      // v4.3: 仅本人 / 管理员可见，用于提示"尚未设置密码"
      has_password: (isSelf || adminViewer) ? !!u.has_pw : undefined
    },
    is_self: isSelf,
    is_admin_viewer: adminViewer,
    clips: clips.results.map((r) => ({
      clip_id: r.clip_id, title: r.title || '无标题',
      preview: r.password_hash ? '🔒 受密码保护' : makePreview(r.content),
      has_password: !!r.password_hash, owner_name: r.owner_name,
      is_public: !!r.is_public, editable_by_anyone: !!r.editable_by_anyone,
      expires_at: r.expires_at, views: r.views, created_at: r.created_at
    }))
  });
});

// ========== 当前身份 + 我的剪贴板（扩展配额信息） ==========

app.get('/api/me', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);

  // v4.13: 被封禁用户：统一返回 banned 标记，前端据此展示封禁页
  if (identity.type === 'banned') {
    return c.json({ authenticated: false, type: 'banned', banned: true, banReason: identity.banReason || '', banUntil: identity.banUntil || null });
  }

  if (identity.type === 'user') {
   try {
    const uRow = await db.prepare(
      `SELECT username, role, bio, signature, linked_accounts, is_vip, vip_until,
              invite_code, invite_count, feature_flags, password_hash,
              email, email_verified, no_cpoauth_nudge, created_at,
              source, source_detail, source_set_at, admin_level
       FROM users WHERE id = ?`
    ).bind(String(identity.userId)).first();
    const clips = await db.prepare(
      `SELECT clip_id, title, content, is_public, editable_by_anyone, password_hash, expires_at,
              max_views, views, created_at, updated_at,
              COALESCE(tags, '') AS tags, COALESCE(pinned, 0) AS pinned
       FROM clipboards WHERE owner_type = 'user' AND owner_id = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(String(identity.userId)).all();

    // 配额信息
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 19).replace('T', ' ');
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 19).replace('T', ' ');
    const [dayCnt, monthCnt] = await Promise.all([
      db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ? AND created_at >= ?").bind(String(identity.userId), todayStart).first(),
      db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ? AND created_at >= ?").bind(String(identity.userId), monthStart).first()
    ]);
    // v4.5.2: 信任等级维持制所需的窗口统计；v4.6: 一并算出权益包
    const trustSt = await getTrustStats(db, identity.userId);
    const trustBase = {
      clip_count: trustSt.total, clips_14d: trustSt.c14, clips_5d: trustSt.c5,
      created_at: uRow?.created_at, invite_count: uRow?.invite_count || 0,
      is_vip: !!uRow?.is_vip, role: uRow?.role
    };
    const ben = await resolveBenefits(db, identity, trustBase);
    const level = ben.level;
    const dailyLimit = ben.benefits.daily;
    const monthlyLimit = ben.benefits.monthly;
    const charLimit = ben.charLimit;
    // v4.15.3: 走统一取数入口拿真实角色 / 层级 / 权限（此接口曾漏选 admin_permissions → 前端权限全 false）
    const adminCtx = await getAdminContext(db, identity.userId);

    return c.json({
      authenticated: true, type: 'user', userId: identity.userId, name: identity.name,
      // password 登录用的账号名（引导用户设置密码时需要展示）
      username: uRow?.username || '',
      char_limit: charLimit,
      // v4.6: 权益矩阵 —— 让等级真正「有赏有罚」
      benefits: benefitList(ben.benefits),
      benefits_raw: ben.benefits,
      next_level_unlock: nextLevelUnlocks(level, ben.isVip, ben.isStaff),
      unlimited_char: ben.unlimited,
      avatar: identity.avatar, sub: identity.sub,
      role: uRow?.role || 'user', bio: uRow?.bio || '', signature: uRow?.signature || '',
      linked_accounts: parseLinkedAccounts(uRow?.linked_accounts),
      is_vip: !!uRow?.is_vip, vip_until: uRow?.vip_until || null,
      has_password: !!uRow?.password_hash,
      // v4.4: cpoauth 绑定态（用于刷新引导）、邮箱（来自 cpoauth）、信任等级
      cpoauth_bound: !!identity.sub,
      email: uRow?.email || '', email_verified: !!uRow?.email_verified,
      trust_level: level,
      trust_progress: trustProgress(trustBase, level),
      no_cpoauth_nudge: !!uRow?.no_cpoauth_nudge,
      invite_code: uRow?.invite_code || '', invite_count: uRow?.invite_count || 0,
      feature_flags: parseFeatureFlags(uRow?.feature_flags),
      // v4.15: 暴露层级与归一化后的权限位，供前端做层级管控与按钮置灰
      // v4.15.3: 改由 getAdminContext 统一取数（不再依赖本接口手写 SELECT 的列清单）
      admin_level: adminCtx.role === 'developer' ? 99 : (adminCtx.role === 'admin' ? adminCtx.level : 1),
      admin_permissions: adminCtx.perms,
      // v4.10: 注册时间（created_at 已在 users 表）+ 来源渠道（首次登录后询问）
      created_at: uRow?.created_at || null,
      source: uRow?.source || '',
      source_detail: uRow?.source_detail || '',
      source_set_at: uRow?.source_set_at || null,
      quota: { daily_used: dayCnt?.cnt || 0, daily_limit: dailyLimit, monthly_used: monthCnt?.cnt || 0, monthly_limit: monthlyLimit },
      clips: clips.results.map((r) => ({
        clip_id: r.clip_id, title: r.title || '无标题', preview: makePreview(r.content),
        has_password: !!r.password_hash, is_public: !!r.is_public,
        editable_by_anyone: !!r.editable_by_anyone, expires_at: r.expires_at,
        max_views: r.max_views, views: r.views, created_at: r.created_at,
        tags: parseTags(r.tags), pinned: !!r.pinned
      }))
    });
   } catch {
    // D1 读配额耗尽：降级为“已登录但资料受限”，避免前端整片 500（真实资料在配额恢复后自动回来）
    return c.json({
      authenticated: true, type: 'user', userId: identity.userId, name: identity.name,
      role: 'user', is_vip: false, benefits: [], char_limit: 1500,
      degraded: true, degradedReason: 'd1_read_quota',
      clips: [], invite_count: 0, cpoauth_bound: !!identity.sub, trust_level: 0
    });
   }
  }

  if (identity.type === 'guest') {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const cnt = (await db.prepare("SELECT COUNT(*) as cnt FROM clipboards WHERE owner_type = 'guest' AND owner_id = ? AND created_at >= ?").bind(identity.guestId, weekAgo).first()).cnt;
    const guestWeeklyLimit = parseInt(await getSiteSetting(db, 'guest_weekly_limit', '5')) || 5;
    const charLimit = parseInt(await getSiteSetting(db, 'global_char_limit', '1500')) || 1500;
    return c.json({
      authenticated: false, type: 'guest', guestId: identity.guestId,
      count: cnt, limit: guestWeeklyLimit, period: 'weekly',
      char_limit: charLimit,
      clips: []
    });
  }

  return c.json({ authenticated: false, type: 'none' });
});

// ========== v4.6: 我的剪贴板 2.0（私有可搜 · 标签 · 置顶 · 排序） ==========
// GET /api/me/clips?q=&tag=&sort=&pinned=1
// 与首页 /api/clips 的区别：这里能搜到「自己的私有板」，首页只列公开板
app.get('/api/me/clips', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized', message: '请先登录' }, 401);

  const q = (c.req.query('q') || '').trim().toLowerCase();
  const tag = (c.req.query('tag') || '').trim().toLowerCase();
  const sort = c.req.query('sort') || 'updated';
  const onlyPinned = c.req.query('pinned') === '1';
  const limit = Math.min(300, Math.max(1, parseInt(c.req.query('limit') || '200') || 200));
  const uid = String(identity.userId);

  // 白名单排序，杜绝 SQL 注入；置顶恒优先
  const ORDER = {
    updated: 'pinned DESC, updated_at DESC',
    created: 'pinned DESC, created_at DESC',
    views: 'pinned DESC, views DESC, updated_at DESC',
    title: 'pinned DESC, title ASC'
  };
  const orderBy = ORDER[sort] || ORDER.updated;

  let where = "WHERE owner_type = 'user' AND owner_id = ?";
  const binds = [uid];
  if (q) {
    where += " AND (LOWER(COALESCE(title,'')) LIKE ? OR LOWER(content) LIKE ? OR LOWER(COALESCE(tags,'')) LIKE ?)";
    const like = '%' + q + '%';
    binds.push(like, like, like);
  }
  if (tag) {
    // 精确匹配单个标签：tags 形如 "a,b,c"，两侧补逗号后做精确包含
    where += " AND (',' || LOWER(COALESCE(tags,'')) || ',') LIKE ?";
    binds.push('%,' + tag + ',%');
  }
  if (onlyPinned) where += ' AND pinned = 1';

  const rows = await db.prepare(
    `SELECT clip_id, title, content, is_public, editable_by_anyone, password_hash, expires_at,
            max_views, views, created_at, updated_at,
            COALESCE(tags,'') AS tags, COALESCE(pinned,0) AS pinned
     FROM clipboards ${where} ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit).all();

  // 标签云（基于该用户全部剪贴板统计，不受筛选影响）
  const tagRows = await db.prepare(
    "SELECT COALESCE(tags,'') AS tags FROM clipboards WHERE owner_type = 'user' AND owner_id = ?"
  ).bind(uid).all();
  const cloud = new Map();
  for (const r of (tagRows.results || [])) {
    for (const t of parseTags(r.tags)) cloud.set(t, (cloud.get(t) || 0) + 1);
  }
  const tags = [...cloud.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  const totalRow = await db.prepare(
    "SELECT COUNT(*) AS cnt FROM clipboards WHERE owner_type = 'user' AND owner_id = ?"
  ).bind(uid).first();

  return c.json({
    clips: (rows.results || []).map((r) => ({
      clip_id: r.clip_id, title: r.title || '无标题', preview: makePreview(r.content),
      has_password: !!r.password_hash, is_public: !!r.is_public,
      editable_by_anyone: !!r.editable_by_anyone, expires_at: r.expires_at,
      max_views: r.max_views, views: r.views || 0,
      created_at: r.created_at, updated_at: r.updated_at,
      tags: parseTags(r.tags), pinned: !!r.pinned
    })),
    tags, total: Number(totalRow?.cnt || 0), matched: (rows.results || []).length
  });
});

// ========== v4.6: 置顶 / 改标签 ==========
// PATCH /api/clips/:id/meta  body: { pinned?: 0|1, tags?: string[] }
app.patch('/api/clips/:id/meta', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  const clipId = c.req.param('id');
  const r = await db.prepare(
    "SELECT owner_type, owner_id, tags FROM clipboards WHERE clip_id = ?"
  ).bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);

  const isOwner = identity.type === 'user' && String(identity.userId) === String(r.owner_id) && r.owner_type === 'user';
  const admin = await isAdminIdentity(db, identity);
  if (!isOwner && !admin) return c.json({ error: 'forbidden', message: '只能修改自己的剪贴板' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  // 标签数上限按信任等级
  const trustBase = identity.type === 'user' ? await buildTrustBase(db, identity.userId) : null;
  const ben = await resolveBenefits(db, identity, trustBase);
  const maxTags = ben.benefits.tags; // -1 = 不限

  const sets = [];
  const binds = [];
  if (body.pinned !== undefined) {
    sets.push('pinned = ?');
    binds.push(body.pinned ? 1 : 0);
  }
  if (body.tags !== undefined) {
    sets.push('tags = ?');
    binds.push(serializeTags(body.tags, maxTags));
  }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(clipId);

  await db.prepare(`UPDATE clipboards SET ${sets.join(', ')} WHERE clip_id = ?`).bind(...binds).run();
  const fresh = await db.prepare("SELECT COALESCE(tags,'') AS tags, COALESCE(pinned,0) AS pinned FROM clipboards WHERE clip_id = ?").bind(clipId).first();
  return c.json({ ok: true, tags: parseTags(fresh?.tags), pinned: !!fresh?.pinned, max_tags: maxTags });
});

// ========== 修改资料 ==========

app.patch('/api/me', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const fields = {};
  if (body.signature !== undefined) fields.signature = String(body.signature).slice(0, 200);
  if (body.bio !== undefined) fields.bio = String(body.bio).slice(0, 500);
  if (body.tag !== undefined) fields.tag = stripInvisible(String(body.tag || '')).slice(0, 30);
  // v4.32.x：改名（展示名 display_name）—— 允许 emoji，但禁止零宽字符、禁止含 yanzie 子串、复用其他敏感词
  if (body.display_name !== undefined) {
    let dn = String(body.display_name || '').trim();
    if (!dn) return c.json({ error: 'empty_display_name', message: '昵称不能为空' }, 400);
    // 零宽/控制字符：直接拒绝（不再静默去除）
    if (/[​-‏‪-‮⁠-⁯﻿]/g.test(dn)) {
      return c.json({ error: 'display_name_invisible', message: '昵称不能包含不可见/零宽字符' }, 400);
    }
    const dnNorm = normalizeUserName(dn); // 转小写 + 去零宽，用于敏感词比对
    if (dnNorm.length < 2) return c.json({ error: 'invalid_display_name', message: '昵称至少 2 个字符' }, 400);
    // 敏感词 / 冒充词拦截（含 yanzie 子串，连 yanzien 本体也拦，防仿冒）
    let bannedWord = null;
    for (const w of ['nazi', 'gay', '纳粹', '共产党', '国民党', '拉', '给']) if (dnNorm.includes(w)) { bannedWord = w; break; }
    // yanzie 子串拦截：站长（uid 1/2，本人昵称即 yanzie）放行，其余照拦防仿冒
    if (!bannedWord && dnNorm.includes('yanzie') && identity.userId !== 1 && identity.userId !== 2) bannedWord = 'yanzie';
    if (!bannedWord && /(?<![a-z0-9])la(?![a-z0-9])/.test(dnNorm)) bannedWord = 'la';
    if (bannedWord) {
      return c.json({ error: 'display_name_banned', message: '昵称包含不允许使用的词「' + bannedWord + '」，请换一个' }, 400);
    }
    fields.display_name = dn.slice(0, 30);
  }
  // v4.32: 头像（空串=清除；URL 或 /api/avatar/ 路径；或 emoji: 前缀的预设）
  if (body.avatar !== undefined) {
    const av = String(body.avatar || '').slice(0, 200);
    const ok = av === '' || /^https?:\/\//.test(av) || av.startsWith('/api/avatar/') || av.startsWith('emoji:') || /^\p{Extended_Pictographic}$/u.test(av);
    if (!ok) return c.json({ error: 'bad_avatar', message: '头像格式无效' }, 400);
    fields.avatar = av;
  }
  // v4.4: 「不再提示绑定 cpoauth」持久化（跨设备一致）
  if (body.no_cpoauth_nudge !== undefined) fields.no_cpoauth_nudge = body.no_cpoauth_nudge ? 1 : 0;
  // v4.10: 来源渠道（首次登录后询问；白名单校验，仅允许已知渠道 + 空/unknown）
  const SRC_OK = new Set(['', 'offline', 'social', 'oj', 'other_share', 'random', 'ad', 'search', 'unknown']);
  let srcSetAt = null; // null=不变；'now'=设为当前时间；'clear'=置 NULL
  if (body.source !== undefined) {
    const s = SRC_OK.has(body.source) ? body.source : '';
    fields.source = s;
    srcSetAt = s ? 'now' : 'clear';
  }
  if (body.source_detail !== undefined) fields.source_detail = String(body.source_detail).slice(0, 100);
  if (Object.keys(fields).length === 0) return c.json({ error: 'nothing_to_update' }, 400);
  const cols = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const vals = Object.values(fields);
  // source_set_at 用 SQL 字面量（datetime('now')/NULL），不走参数绑定
  const setAtSql = srcSetAt === 'now' ? "source_set_at = datetime('now')" : srcSetAt === 'clear' ? 'source_set_at = NULL' : null;
  const sql = `UPDATE users SET ${cols}${setAtSql ? ', ' + setAtSql : ''} WHERE id = ?`;
  await db.prepare(sql).bind(...vals, String(identity.userId)).run();

  // v4.32: 改名 / 换头像后重签会话 Cookie，使服务端身份（发帖名、聊天发送名等）即时生效
  let setCookie = null;
  if (fields.display_name || fields.avatar !== undefined) {
    const ck = c.req.header('Cookie') || '';
    const m = ck.match(/mdqp_session=([^;]+)/);
    if (m) {
      const sp = await verifyJWT(decodeURIComponent(m[1]), c.env.CPOAUTH_CLIENT_SECRET);
      if (sp && sp.userId) {
        const newJwt = await signJWT(
          {
            userId: Number(sp.userId),
            sub: sp.sub || null,
            name: fields.display_name || sp.name,
            avatar: fields.avatar !== undefined ? fields.avatar : (sp.avatar || ''),
            exp: sp.exp || Math.floor(Date.now() / 1000) + 7 * 24 * 3600
          },
          c.env.CPOAUTH_CLIENT_SECRET
        );
        setCookie = `mdqp_session=${newJwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`;
      }
    }
  }
  const res = c.json({ ok: true, ...fields, source_set_at: srcSetAt === 'now' ? (new Date().toISOString().slice(0, 19).replace('T', ' ')) : (srcSetAt === 'clear' ? null : undefined) });
  if (setCookie) c.header('Set-Cookie', setCookie);
  return res;
});

// ========== v4.32: 头像上传 / 读取 ==========
// 头像存 SITE_KV（key=avatar:{userId}），users.avatar 存可访问的短链 /api/avatar/{id}。
// 预设头像走 emoji: 前缀（由前端 avatarHtml 渲染），不进 KV。
const AVATAR_KV_PREFIX = 'avatar:';
const AVATAR_ALLOW = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AVATAR_MAX = 2 * 1024 * 1024; // 2MB

app.post('/api/me/avatar', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const ct = c.req.header('Content-Type') || '';
  let bytes, mime;
  try {
    if (ct.includes('multipart/form-data')) {
      const form = await c.req.parseFormData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return c.json({ error: 'no_file' }, 400);
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = file.type || 'image/png';
    } else {
      const body = await c.req.json();
      const du = String(body.dataUrl || '');
      const mm = du.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
      if (!mm) return c.json({ error: 'bad_dataurl' }, 400);
      mime = mm[1];
      bytes = Uint8Array.from(atob(mm[2]), (ch) => ch.charCodeAt(0));
    }
  } catch {
    return c.json({ error: 'bad_request' }, 400);
  }
  if (!AVATAR_ALLOW.has(mime)) return c.json({ error: 'unsupported_type', message: '仅支持 PNG / JPEG / WebP / GIF' }, 400);
  if (!bytes || bytes.length === 0) return c.json({ error: 'empty' }, 400);
  if (bytes.length > AVATAR_MAX) return c.json({ error: 'too_large', message: '头像不能超过 2MB' }, 400);

  const uid = String(identity.userId);
  const key = AVATAR_KV_PREFIX + uid;
  try {
    await c.env.SITE_KV.put(key, bytes, { metadata: { contentType: mime, uid } });
  } catch {
    return c.json({ error: 'kv_failed', message: '头像存储失败，请稍后重试' }, 500);
  }
  const url = '/api/avatar/' + uid;
  await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(url, uid).run();

  // 重签会话，使头像即时生效
  let setCookie = null;
  const ck = c.req.header('Cookie') || '';
  const m = ck.match(/mdqp_session=([^;]+)/);
  if (m) {
    const sp = await verifyJWT(decodeURIComponent(m[1]), c.env.CPOAUTH_CLIENT_SECRET);
    if (sp && sp.userId) {
      const newJwt = await signJWT(
        { userId: Number(sp.userId), sub: sp.sub || null, name: sp.name, avatar: url, exp: sp.exp || Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
        c.env.CPOAUTH_CLIENT_SECRET
      );
      setCookie = `mdqp_session=${newJwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`;
    }
  }
  const res = c.json({ ok: true, url });
  if (setCookie) c.header('Set-Cookie', setCookie);
  return res;
});

app.get('/api/avatar/:userId', async (c) => {
  const uid = c.req.param('userId');
  if (!/^\d+$/.test(uid)) return c.json({ error: 'bad_id' }, 400);
  // 注意：KV 单独 {type:'arrayBuffer'} 返回裸 ArrayBuffer；不要用 metadata:true（会丢 value）
  const buf = await c.env.SITE_KV.get(AVATAR_KV_PREFIX + uid, { type: 'arrayBuffer' });
  if (!buf) return c.json({ error: 'not_found' }, 404);
  const b = new Uint8Array(buf);
  let ctype = 'image/png';
  if (b[0] === 0x89 && b[1] === 0x50) ctype = 'image/png';
  else if (b[0] === 0xFF && b[1] === 0xD8) ctype = 'image/jpeg';
  else if (b[0] === 0x47 && b[1] === 0x49) ctype = 'image/gif';
  else if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) ctype = 'image/webp';
  return new Response(buf, { headers: { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=86400' } });
});

// ========== 战绩概览（cp:summary 代理，best-effort + D1 缓存） ==========
// 仅本人可调（需自己的 refresh_token）。CPOAUTH_SUMMARY_URL 未配置或上游未放行 scope 时优雅降级。
app.get('/api/me/cp-summary', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  if (!identity.sub) return c.json({ available: false, reason: 'not_bound' });

  // 缓存：10 分钟内直接返回，避免每次刷新打 cpoauth
  const cached = await db.prepare('SELECT summary_json, fetched_at FROM user_stats WHERE user_id = ?').bind(identity.userId).first();
  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at.replace(' ', 'T') + 'Z').getTime();
    if (age < 10 * 60000) return c.json({ available: true, cached: true, data: parseJSON(cached.summary_json) || {} });
  }

  const row = await db.prepare('SELECT cpoauth_refresh FROM users WHERE id = ?').bind(String(identity.userId)).first();
  const rt = row && row.cpoauth_refresh;
  const summaryUrl = c.env.CPOAUTH_SUMMARY_URL;
  if (!summaryUrl) return c.json({ available: false, reason: 'no_summary_url' });
  if (!rt) return c.json({ available: false, reason: 'no_refresh' });

  try {
    // refresh_token 换 access_token（cpoauth 强制轮换：新 refresh 写回）
    const tokRes = await fetch('https://www.cpoauth.com/api/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt, client_id: c.env.CPOAUTH_CLIENT_ID, client_secret: c.env.CPOAUTH_CLIENT_SECRET })
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tok.access_token) return c.json({ available: false, reason: 'token_failed' });
    if (tok.refresh_token && tok.refresh_token !== rt) {
      await db.prepare('UPDATE users SET cpoauth_refresh = ? WHERE id = ?').bind(tok.refresh_token, String(identity.userId)).run();
    }
    const sumRes = await fetch(summaryUrl, { headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/json' } });
    if (!sumRes.ok) return c.json({ available: false, reason: 'summary_http_' + sumRes.status });
    const data = await sumRes.json().catch(() => ({}));
    await db.prepare(
      "INSERT INTO user_stats (user_id, summary_json, fetched_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET summary_json = excluded.summary_json, fetched_at = excluded.fetched_at"
    ).bind(identity.userId, JSON.stringify(data)).run();
    return c.json({ available: true, cached: false, data });
  } catch {
    return c.json({ available: false, reason: 'network' });
  }
});

// ========== 通知系统（分类：trust / clip_expiry / clip_visited / admin） ==========
app.get('/api/notifications', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const uid = String(identity.userId);
  // 懒生成：信用等级提升
  await notifyTrustUpgrade(db, uid);
  // 懒生成：剪贴板到期提醒（24h 内或已过期，每张仅提示一次）
  try {
    const exp = await db.prepare(
      "SELECT clip_id, title, expires_at FROM clipboards WHERE owner_type='user' AND owner_id=? AND expires_at IS NOT NULL AND expiry_notified=0 AND datetime(expires_at) <= datetime('now','+1 day')"
    ).bind(uid).all();
    for (const row of (exp.results || [])) {
      const expDate = new Date((row.expires_at || '').replace(' ', 'T') + 'Z');
      const expired = expDate < new Date();
      const when = expired ? '已过期' : '即将在 24 小时内过期';
      await createNotification(db, uid, 'clip_expiry', '⏳ 剪贴板' + when, `《${row.title || '无标题'}》${when}，请及时查看或延长有效期。`, '/c/' + row.clip_id);
      await db.prepare('UPDATE clipboards SET expiry_notified = 1 WHERE clip_id = ?').bind(row.clip_id).run();
    }
  } catch (e) { /* 通知懒生成失败不影响列表返回 */ }
  // 列表（表缺失/异常时降级为空，绝不 500 拖垮铃铛刷新）
  try {
    const cat = c.req.query('category');
    const unreadOnly = c.req.query('unread') === '1';
    let sql = 'SELECT id, category, title, body, link, is_read, created_at FROM notifications WHERE user_id = ?';
    const params = [uid];
    if (cat) { sql += ' AND category = ?'; params.push(cat); }
    if (unreadOnly) { sql += ' AND is_read = 0'; }
    sql += ' ORDER BY created_at DESC, id DESC LIMIT 50';
    const rows = await db.prepare(sql).bind(...params).all();
    const unreadRow = await db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0').bind(uid).first();
    return c.json({
      notifications: (rows.results || []).map((n) => ({
        id: n.id, category: n.category, title: n.title, body: n.body, link: n.link,
        is_read: !!n.is_read, created_at: n.created_at
      })),
      unread: unreadRow?.cnt || 0
    });
  } catch (e) {
    console.error('[notifications] GET list failed, degrade to empty:', e);
    return c.json({ notifications: [], unread: 0 });
  }
});

app.post('/api/notifications/:id/read', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  try {
    const n = await db.prepare('SELECT id, user_id FROM notifications WHERE id = ?').bind(id).first();
    if (!n || String(n.user_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(id).run();
  } catch (e) { /* 表缺失等异常：视为已读成功，不阻塞交互 */ }
  return c.json({ ok: true });
});

app.post('/api/notifications/read-all', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const uid = String(identity.userId);
  const cat = c.req.query('category');
  let sql = 'UPDATE notifications SET is_read = 1 WHERE user_id = ?';
  const params = [uid];
  if (cat) { sql += ' AND category = ?'; params.push(cat); }
  try { await db.prepare(sql).bind(...params).run(); } catch (e) { /* 表缺失等异常忽略 */ }
  return c.json({ ok: true });
});

// ========== 评论 API ==========

/** 获取剪贴板的评论列表 */
app.get('/api/comments/:clipId', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const offset = (page - 1) * 30; // 每页 30 条

  // 先确认剪贴板存在
  const clip = await db.prepare('SELECT clip_id FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!clip) return c.json({ error: 'not_found' }, 404);

  const rows = await db.prepare(
    'SELECT id, author_id, author_type, author_name, content, created_at FROM comments WHERE clip_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).bind(clipId, 30, offset).all();

  const totalRow = await db.prepare('SELECT COUNT(*) as cnt FROM comments WHERE clip_id = ?').bind(clipId).first();

  return c.json({
    comments: rows.results.map((r) => ({
      id: r.id, author_id: r.author_id, author_type: r.author_type, author_name: r.author_name, content: r.content, created_at: r.created_at
    })),
    page, total: totalRow?.cnt || 0,
    totalPages: Math.max(1, Math.ceil((totalRow?.cnt || 0) / 30))
  });
});

/** 发表评论（登录必检，50 字限制） */
app.post('/api/comments/:clipId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized', message: '登录后才能评论' }, 401);

  const clipId = c.req.param('clipId');
  const clip = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!clip) return c.json({ error: 'not_found' }, 404);

  // 检查评论功能开关
  const flags = await getUserFeatures(db, identity.userId);
  const isAdmin = await isAdminIdentity(db, identity);
  if (!flags.comments && !isAdmin) return c.json({ error: 'feature_disabled', message: '你没有评论的权限' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const content = (body.content || '').toString().trim();
  if (!content) return c.json({ error: 'empty_content', message: '评论不能为空' }, 400);

  // 50 字限制（等效字数）
  if (countChars(content) > 50) {
    return c.json({ error: 'too_long', message: `评论过长（${countChars(content)}/50 等效字）`, char_count: countChars(content) }, 400);
  }

  await db.prepare(
    'INSERT INTO comments (clip_id, author_type, author_id, author_name, content) VALUES (?, \'user\', ?, ?, ?)'
  ).bind(clipId, String(identity.userId), identity.name || '用户', content).run();

  // 通知剪贴板拥有者（仅登录用户拥有且评论者非本人时推送）
  try {
    if (clip.owner_type === 'user' && clip.owner_id && String(clip.owner_id) !== String(identity.userId)) {
      await createNotification(db, clip.owner_id, 'comment',
        '💬 你的剪贴板《' + (clip.title || '无标题') + '》收到新评论',
        content.slice(0, 120),
        '/c/' + clipId);
    }
  } catch (e) { /* 通知失败不影响主流程 */ }

  return c.json({ ok: true });
});

/** 删除自己的评论（或管理员删任意） */
app.delete('/api/comments/:commentId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);

  const commentId = c.req.param('commentId');
  const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();
  if (!comment) return c.json({ error: 'not_found' }, 404);

  const admin = await isAdminIdentity(db, identity);
  if (String(comment.author_id) !== String(identity.userId) && !admin) {
    return c.json({ error: 'forbidden' }, 403);
  }

  await db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
  return c.json({ ok: true });
});

// ========== @mention 用户搜索 ==========
// 注意：路径用 /api/search/users 而非 /api/users/search，
// 否则会被 /api/users/:userId 抢匹配（把 search 当 userId 查 → not_found）。

app.get('/api/search/users', async (c) => {
  const db = c.env.db;
  const q = (c.req.query('q') || '').trim().slice(0, 50);
  if (!q || q.length < 1) return c.json({ users: [] });

  // v4.18：支持直接输入用户 ID（纯数字）——精确命中排最前，再按用户名/昵称模糊匹配
  const like = `%${q}%`;
  const num = /^\d{1,10}$/.test(q) ? parseInt(q, 10) : null;
  const rows = num !== null
    ? await db.prepare(
        'SELECT id, username, display_name, avatar FROM users WHERE id = ? OR username LIKE ? OR display_name LIKE ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC LIMIT 10'
      ).bind(num, like, like, num).all()
    : await db.prepare(
        'SELECT id, username, display_name, avatar FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY id ASC LIMIT 10'
      ).bind(like, like).all();

  return c.json({ users: rows.results.map((r) => ({
    id: r.id, username: r.username, display_name: r.display_name || r.username, avatar: r.avatar
  })) });
});

// ========== 邀请系统 API ==========

// 邀请奖励默认配置：与「邀请中心」前端展示的 1/3/5/10 人四档奖励对齐。
// 用代码默认值而非依赖站点设置，确保邀请系统真实可用（不再"假功能"）。
const DEFAULT_INVITE_REWARDS = {
  inviter: [
    { threshold: 1, reward: 'all_features' },
    { threshold: 3, reward: 'vip' },
    { threshold: 5, reward: 'unlimited_chars_pin' },
    { threshold: 10, reward: 'developer_gift' }
  ],
  invitee: { reward: 'custom_slug' }
};

/** 获取当前用户的邀请信息 */
app.get('/api/invite/me', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);

  const u = await db.prepare(
    'SELECT id, invite_code, invite_count, inviter_id, is_vip FROM users WHERE id = ?'
  ).bind(String(identity.userId)).first();

  if (!u) return c.json({ error: 'not_found' }, 404);

  // 如果没有邀请码，生成一个
  let code = u.invite_code;
  if (!code) {
    code = genInviteCode();
    await db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').bind(code, String(u.id)).run();
  }

  // 统计被邀请人数（以 users.inviter_id 为真相源，不再依赖空的 invites 表）
  const invitedCount = (await db.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE inviter_id = ?"
  ).bind(String(u.id)).first()).cnt || 0;

  // 获取奖励配置
  const rewards = parseJSON(await getSiteSetting(db, 'invite_rewards', JSON.stringify(DEFAULT_INVITE_REWARDS)));
  // VIP 联系方式
  const vipContact = await getSiteSetting(db, 'vip_contact', '');

  return c.json({
    invite_code: code,
    invite_link: `${new URL(c.req.url).origin}/invite/${code}`,
    invite_count: u.invite_count || 0,
    invited_count: invitedCount,
    is_vip: !!u.is_vip,
    inviter_id: u.inviter_id,
    rewards: rewards || {},
    vip_contact: vipContact
  });
});

/** 解析邀请码（注册/登录时调用）
 *  邀请码即 users.invite_code（用户在「邀请中心」看到的专属码），
 *  不再查 invites 表（该表从未被写入，会导致永远 404）。 */
app.get('/api/invite/:code', async (c) => {
  const db = c.env.db;
  const code = (c.req.param('code') || '').toString().trim().toUpperCase();
  if (!code) return c.json({ error: 'invalid_or_used' }, 404);

  const inviter = await db.prepare(
    'SELECT id, display_name, username, avatar FROM users WHERE UPPER(invite_code) = ?'
  ).bind(code).first();
  if (!inviter) return c.json({ error: 'invalid_or_used' }, 404);

  return c.json({
    valid: true,
    inviter: { id: inviter.id, name: inviter.display_name || inviter.username, avatar: inviter.avatar }
  });
});

/** 绑定邀请关系（OAuth 回调成功后调用，幂等） */
app.post('/api/invite/bind', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const code = (body.code || '').toString().trim().toUpperCase();
  if (!code) return c.json({ error: 'missing_code' }, 400);

  // 邀请码即邀请人的 users.invite_code
  const inviter = await db.prepare('SELECT id, invite_count FROM users WHERE UPPER(invite_code) = ?').bind(code).first();
  if (!inviter) return c.json({ error: 'invalid_or_used' }, 404);

  // 不能邀请自己
  if (String(inviter.id) === String(identity.userId)) return c.json({ error: 'cannot_invite_self' }, 400);

  // 幂等：被邀请人已经绑定过邀请关系，则不再重复计数
  const me = await db.prepare('SELECT inviter_id FROM users WHERE id = ?').bind(String(identity.userId)).first();
  if (me && me.inviter_id && String(me.inviter_id) !== '') {
    return c.json({ ok: true, already_bound: true, granted: [], invitee_reward: null });
  }

  // 绑定关系（只写一次）
  await db.prepare('UPDATE users SET inviter_id = ? WHERE id = ?')
    .bind(inviter.id, String(identity.userId)).run();

  // 更新邀请人的计数（仅首次绑定时 +1）
  await db.prepare('UPDATE users SET invite_count = invite_count + 1 WHERE id = ?').bind(inviter.id).run();

  // === 发放奖励 ===
  const rewards = parseJSON(await getSiteSetting(db, 'invite_rewards', JSON.stringify(DEFAULT_INVITE_REWARDS))) || {};
  const inviterRewards = rewards.inviter || [];
  const currentInviterCount = (await db.prepare('SELECT invite_count FROM users WHERE id = ?').bind(inviter.id).first())?.invite_count || 0;

  const granted = [];

  for (const tier of inviterRewards) {
    if (currentInviterCount >= tier.threshold) {
      switch (tier.reward) {
        case 'all_features':
          // 开放所有高级功能
          await db.prepare("UPDATE users SET feature_flags = ? WHERE id = ?")
            .bind(JSON.stringify({ custom_slug: 1, max_views: 1, password: 1, expiry: 1, collaboration: 1, login_required: 1, max_readers: 1, comments: 1 }), inviter.id).run();
          granted.push({ threshold: tier.threshold, reward: 'all_features', desc: '已开放所有高级功能' });
          break;
        case 'vip':
          // 开通 VIP（默认 1 年；v4.13 起邀请所得 VIP 限时 1 年，不再永久）
          {
            const vipUntil = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
            await db.prepare("UPDATE users SET is_vip = 1, vip_until = ? WHERE id = ?").bind(vipUntil, inviter.id).run();
            granted.push({ threshold: tier.threshold, reward: 'vip', desc: '已开通 VIP（1 年）' });
          }
          break;
        case 'unlimited_chars_pin': {
          // 真正授予"不限字数"标记（feature_flags.unlimited_chars），由 resolveBenefits 生效
          const ff = await getUserFeatures(db, inviter.id);
          ff.unlimited_chars = 1;
          await db.prepare('UPDATE users SET feature_flags = ? WHERE id = ?').bind(JSON.stringify(ff), inviter.id).run();
          granted.push({ threshold: tier.threshold, reward: 'unlimited_chars_pin', desc: '已获得不限字数权限' });
          break;
        }
        case 'developer_gift':
          granted.push({ threshold: tier.threshold, reward: 'developer_gift', desc: '🎁 开发者大礼包！请加站长微信细谈' });
          break;
      }
    }
  }

  // 被邀请者奖励：开放自定义短链
  const inviteeReward = rewards.invitee || {};
  if (inviteeReward.reward === 'custom_slug') {
    const ff = await getUserFeatures(db, identity.userId);
    ff.custom_slug = 1;
    await db.prepare('UPDATE users SET feature_flags = ? WHERE id = ?')
      .bind(JSON.stringify(ff), String(identity.userId)).run();
  }

  return c.json({ ok: true, granted, invitee_reward: inviteeReward.reward || null });
});

// ========== 站点页面（保持不变） ==========

app.get('/api/pages/:slug', async (c) => {
  c.header('Cache-Control', 'public, max-age=60');
  const db = c.env.db;
  const slug = c.req.param('slug');
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) return c.json({ error: 'bad_slug' }, 400);
  const p = await db.prepare('SELECT slug, title, content, updated_at, updated_by FROM pages WHERE slug = ?').bind(slug).first();
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json({ page: p });
});

app.put('/api/pages/:slug', async (c) => {
  const db = c.env.db;
  const slug = c.req.param('slug');
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) return c.json({ error: 'bad_slug' }, 400);
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const title = (body.title || '').toString().slice(0, 200);
  const content = (body.content || '').toString();
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);
  if (content.length > 400000) return c.json({ error: 'too_large' }, 413);
  await db.prepare(
    `INSERT INTO pages (slug, title, content, updated_at, updated_by) VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(slug) DO UPDATE SET title = excluded.title, content = excluded.content,
       updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).bind(slug, title, content, identity.name || String(identity.userId)).run();
  return c.json({ ok: true, slug });
});

// ========== 管理后台（扩展：VIP、功能开关、邀请、评论管理） ==========

app.get('/api/admin/users', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  // v4.15: 所有管理员（含无 delete_user 权限者）都能查看用户列表，仅操作按钮按权限+层级置灰
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim();
  const source = (c.req.query('source') || '').trim();
  const from = (c.req.query('from') || '').trim();
  const to = (c.req.query('to') || '').trim();
  const activeDays = parseInt(c.req.query('activeDays') || '0') || 0;
  const minClips = parseInt(c.req.query('minClips') || '0') || 0;
  const bannedOnly = c.req.query('banned'); // '1' | '0' | 不传=全部
  const sort = (c.req.query('sort') || 'id');
  const order = (c.req.query('order') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('pageSize') || '') || PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const whereParts = [];
  const params = [];
  if (q) { whereParts.push('(u.username LIKE ? OR u.display_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (source) {
    if (source === 'unset') whereParts.push("(u.source IS NULL OR u.source = '')");
    else { whereParts.push('u.source = ?'); params.push(source); }
  }
  if (from) { whereParts.push('u.created_at >= ?'); params.push(from); }
  if (to) { whereParts.push('u.created_at <= ?'); params.push(to + ' 23:59:59'); }
  if (activeDays > 0) {
    const cut = new Date(Date.now() - activeDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    whereParts.push('u.last_login >= ?'); params.push(cut);
  }
  if (bannedOnly === '1') whereParts.push('u.banned = 1');
  else if (bannedOnly === '0') whereParts.push('(u.banned = 0 OR u.banned IS NULL)');

  // clip_count 需子查询：既用于筛选（minClips）也用于排序
  const innerSql = `SELECT u.*, (SELECT COUNT(*) FROM clipboards c WHERE c.owner_type = 'user' AND c.owner_id = u.id) AS clip_count FROM users u`;
  if (minClips > 0) whereParts.push('clip_count >= ?'), params.push(minClips);

  const ORDER_COLS = { id: 'sub.id', created_at: 'sub.created_at', last_login: 'sub.last_login', clip_count: 'sub.clip_count', username: 'sub.username' };
  const orderCol = ORDER_COLS[sort] || 'sub.id';
  const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM (${innerSql}) sub ${whereSql}`).bind(...params).first();
  const rows = await db.prepare(
    `SELECT sub.id, sub.username, sub.display_name, sub.tag, sub.avatar, sub.role, sub.admin_level, sub.bio, sub.signature,
            sub.linked_accounts, sub.clip_limit, sub.limit_period, sub.admin_permissions,
            sub.created_at, sub.last_login, sub.is_vip, sub.vip_until, sub.invite_code,
            sub.invite_count, sub.feature_flags, sub.source, sub.source_set_at,
            sub.banned, sub.banned_at, sub.ban_until, sub.clip_count
     FROM (${innerSql}) sub ${whereSql} ORDER BY ${orderCol} ${order} LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  return c.json({
    users: rows.results.map((r) => ({
      id: r.id, username: r.username, display_name: r.display_name || r.username, tag: r.tag || '',
      avatar: r.avatar, role: r.role || 'user',
      admin_level: r.role === 'developer' ? 99 : (parseInt(r.admin_level, 10) || 1),
      linked_accounts: parseLinkedAccounts(r.linked_accounts),
      clip_limit: r.clip_limit, limit_period: r.limit_period,
      admin_permissions: readPerms(r.admin_permissions),
      created_at: r.created_at, last_login: r.last_login, clip_count: r.clip_count || 0,
      is_vip: !!r.is_vip, vip_until: r.vip_until,
      invite_code: r.invite_code || '', invite_count: r.invite_count || 0,
      feature_flags: parseFeatureFlags(r.feature_flags),
      source: r.source || '', source_set_at: r.source_set_at || null,
      banned: !!r.banned, ban_until: r.ban_until || null, banned_at: r.banned_at || null,
      disabled_features: parseInt(r.disabled_features, 10) || 0,
      invisible_name: hasInvisibleChars(r.display_name) || hasInvisibleChars(r.username)
    })),
    page, pageSize, total: totalRow?.cnt || 0, totalPages: Math.max(1, Math.ceil((totalRow?.cnt || 0) / pageSize))
  });
});

// ========== v4.10: 用户来源分布（仅管理员/开发者） ==========
app.get('/api/admin/users/source-stats', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  const rows = await db.prepare(
    "SELECT CASE WHEN source IS NULL OR source = '' THEN 'unset' ELSE source END AS source, COUNT(*) AS cnt FROM users GROUP BY 1 ORDER BY cnt DESC"
  ).all();
  const total = await db.prepare("SELECT COUNT(*) AS n FROM users").first();
  return c.json({
    total: total?.n || 0,
    distribution: (rows?.results || []).map((r) => ({ source: r.source, count: r.cnt }))
  });
});

app.patch('/api/admin/users/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);

  const targetId = c.req.param('id');
  const oper = await db.prepare('SELECT id, role, admin_level FROM users WHERE id = ?').bind(String(identity.userId)).first();
  const operLevel = oper ? adminLevelOf(oper.role, oper.admin_level) : 1;
  // v4.32.3: 操作者自身权限上下文——用于「包含关系」校验（只能授予自己拥有的权限）
  const operCtx = await getAdminContext(db, identity.userId);
  const operIsDev = operCtx.role === 'developer';
  const operPerms = operCtx.perms;
  const target = await db.prepare('SELECT id, role, username, display_name, banned, ban_until, ban_reason, admin_level, admin_permissions FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'developer') return c.json({ error: 'forbidden', message: '开发者身份不可更改' }, 403);

  const targetLevel = adminLevelOf(target.role, target.admin_level);
  const selfId = String(identity.userId) === String(targetId);
  // v4.15: 层级管控——不能管理级别与自己相同或更高的人（开发者 99 已被上面拦截）
  if (target.role === 'admin' && targetLevel >= operLevel) {
    return c.json({ error: 'forbidden', message: '无权限管理同级或更高层级的管理员' }, 403);
  }

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const changes = [];

  // 角色 / 权限 / 层级变更：需 manage_admins，且不能改自己这些项
  const changingAuth = body.role !== undefined || body.admin_permissions !== undefined || body.admin_level !== undefined;
  if (changingAuth) {
    if (!(await hasAdminPerm(db, identity, 'manage_admins'))) return c.json({ error: 'forbidden', message: '无管理管理员权限（需 manage_admins）' }, 403);
    if (selfId) return c.json({ error: 'forbidden', message: '不能修改自己的管理员权限 / 层级' }, 403);
  }

  // v4.27：功能禁用（撤销/恢复 进入聊天 / 站点托管 / 剪贴板 的权限）
  if (body.disabled_features !== undefined) {
    if (!(await hasAdminPerm(db, identity, 'ban_user'))) return c.json({ error: 'forbidden', message: '无封禁/限制权限' }, 403);
    if (selfId) return c.json({ error: 'forbidden', message: '不能限制自己的功能' }, 403);
    const df = objToDisabledFeatures(body.disabled_features);
    await db.prepare('UPDATE users SET disabled_features = ? WHERE id = ?').bind(df, targetId).run();
    changes.push('功能权限已更新（位标记 ' + df + '）');
  }

  // 角色变更 / 升管（免「先撤再升」，可直接设层级 + 权限）
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!['user', 'admin'].includes(role)) return c.json({ error: 'bad_role' }, 400);
    if (role === 'admin') {
      let lvl = parseInt(body.admin_level, 10) || 1;
      if (operLevel !== 99) lvl = Math.min(lvl, operLevel - 1); // 新管理员层级必须低于操作者
      lvl = Math.max(1, Math.min(5, lvl));
      const requested = readPerms(body.admin_permissions || '{}');
      const existing = readPerms(target.admin_permissions);
      const dropped = [];
      const perms = mergeGrantable(requested, existing, operPerms, operIsDev, dropped);
      await db.prepare('UPDATE users SET role = ?, admin_level = ?, admin_permissions = ? WHERE id = ?')
        .bind('admin', lvl, JSON.stringify(perms), targetId).run();
      let msg = '被设为管理员（层级 ' + lvl + '）';
      if (dropped.length) msg += '；已忽略你无权授予的权限：' + dropped.join('、');
      changes.push(msg);
    } else {
      await db.prepare("UPDATE users SET role = 'user', admin_level = 1, admin_permissions = '{}' WHERE id = ?").bind(targetId).run();
      changes.push('管理员权限被撤销');
    }
  } else if (body.admin_level !== undefined || body.admin_permissions !== undefined) {
    // 仅调整层级 / 权限（保持 admin 角色），免撤管再升管
    let lvl = parseInt(body.admin_level, 10) || (target.admin_level || 1);
    if (operLevel !== 99) lvl = Math.min(lvl, operLevel - 1);
    lvl = Math.max(1, Math.min(5, lvl));
    let perms = readPerms(target.admin_permissions);
    let dropped = [];
    if (body.admin_permissions !== undefined) {
      // v4.32.3: 仅当显式提交权限时才做「包含关系」合并；未动权限则保留目标原有授权
      const requested = readPerms(body.admin_permissions);
      const existing = readPerms(target.admin_permissions);
      perms = mergeGrantable(requested, existing, operPerms, operIsDev, dropped);
    }
    await db.prepare('UPDATE users SET admin_level = ?, admin_permissions = ? WHERE id = ?')
      .bind(lvl, JSON.stringify(perms), targetId).run();
    let msg = '管理权限/层级已更新（层级 ' + lvl + '）';
    if (dropped.length) msg += '；已忽略你无权授予的权限：' + dropped.join('、');
    changes.push(msg);
  }

  // 剪贴板数量限制（需 set_clip_limit）
  if (body.clip_limit !== undefined || body.limit_period !== undefined) {
    if (!(await hasAdminPerm(db, identity, 'set_clip_limit'))) return c.json({ error: 'forbidden', message: '无设置剪贴板限制权限' }, 403);
    const limit = body.clip_limit === null ? null : Math.max(0, parseInt(body.clip_limit) || 0);
    const period = body.limit_period === null ? null : String(body.limit_period || '');
    if (limit !== null && !['month', 'week', 'year', 'forever', ''].includes(period))
      return c.json({ error: 'bad_period' }, 400);
    await db.prepare('UPDATE users SET clip_limit = ?, limit_period = ?, limit_start = datetime(\'now\') WHERE id = ?')
      .bind(limit, period, targetId).run();
    changes.push('剪贴板数量限制被调整');
  }

  // VIP 设置（需 manage_vip）
  if (body.is_vip !== undefined) {
    if (!(await hasAdminPerm(db, identity, 'manage_vip'))) return c.json({ error: 'forbidden', message: '无管理 VIP 权限' }, 403);
    const isVip = body.is_vip ? 1 : 0;
    let vipUntil = body.vip_until || null;
    if (isVip && body.vip_duration) {
      const days = Math.max(1, parseInt(body.vip_duration) || 0);
      if (days > 0) vipUntil = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    }
    await db.prepare('UPDATE users SET is_vip = ?, vip_until = ? WHERE id = ?').bind(isVip, vipUntil, targetId).run();
    changes.push(isVip ? (vipUntil ? 'VIP 已开通（限时）' : 'VIP 已开通') : 'VIP 已被撤销');
  }

  // 封禁 / 解封（需 ban_user，不能封自己；层级管控已在上方统一拦截）
  if (body.banned !== undefined) {
    if (!(await hasAdminPerm(db, identity, 'ban_user'))) return c.json({ error: 'forbidden', message: '无封禁权限' }, 403);
    if (selfId) return c.json({ error: 'forbidden', message: '不能封禁自己' }, 403);
    const banned = body.banned ? 1 : 0;
    if (banned) {
      const reason = (body.ban_reason || '违反社区规范').toString().slice(0, 500);
      let banUntil = null;
      // v4.29：ban_days 支持小数（0.5 = 12 小时）；兼容旧的 ban_duration（整数天）
      const rawDays = body.ban_days !== undefined ? Number(body.ban_days) : parseInt(body.ban_duration);
      if (Number.isFinite(rawDays) && rawDays > 0) {
        banUntil = new Date(Date.now() + rawDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      }
      await db.prepare("UPDATE users SET banned = 1, banned_at = datetime('now'), ban_reason = ?, ban_until = ? WHERE id = ?")
        .bind(reason, banUntil, targetId).run();
      // v4.30：主动失效封禁缓存，否则被封用户最多 60s 内仍能访问
      try { await cachePut(c.env.SITE_KV, 'ban:' + targetId, { banned: 1, reason, until: banUntil }, 60); } catch {}
      changes.push(banUntil ? `已封禁至 ${banUntil}` : '已永久封禁');
    } else {
      await db.prepare("UPDATE users SET banned = 0, banned_at = NULL, ban_reason = NULL, ban_until = NULL WHERE id = ?")
        .bind(targetId).run();
      try { await cachePut(c.env.SITE_KV, 'ban:' + targetId, { banned: 0 }, 60); } catch {}
      changes.push('已解封');
    }
  }

  // 功能开关（需 manage_feature）
  if (body.feature_flags !== undefined) {
    if (!(await hasAdminPerm(db, identity, 'manage_feature'))) return c.json({ error: 'forbidden', message: '无管理功能开关权限' }, 403);
    let ff = parseFeatureFlags(body.feature_flags);
    const clean = {};
    for (const k of FEATURE_KEYS) { if (ff[k] !== undefined) clean[k] = ff[k]; }
    await db.prepare('UPDATE users SET feature_flags = ? WHERE id = ?').bind(JSON.stringify(clean), targetId).run();
    changes.push('功能开关被更新');
  }

  // 后台管理操作 → 通知目标用户（操作者本人除外）
  if (changes.length && !selfId) {
    const whom = target.display_name || target.username || ('用户#' + targetId);
    await createNotification(db, targetId, 'admin', '🛡 账号变动通知', `你的账号（${whom}）${changes.join('；')}。`, '/me');
  }

  return c.json({ ok: true, id: Number(targetId), message: changes.join('；') || '操作成功' });
});

app.delete('/api/admin/users/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'delete_user'))) return c.json({ error: 'forbidden' }, 403);
  const targetId = c.req.param('id');
  if (String(identity.userId) === String(targetId)) return c.json({ error: 'forbidden', message: '不能删除自己的账号' }, 403);
  const oper = await db.prepare('SELECT role, admin_level FROM users WHERE id = ?').bind(String(identity.userId)).first();
  const operLevel = oper ? adminLevelOf(oper.role, oper.admin_level) : 1;
  const target = await db.prepare('SELECT id, role, username, admin_level FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'developer') return c.json({ error: 'forbidden', message: '开发者账号不可删除' }, 403);
  // v4.15: 层级管控——不能删除同级或更高层级的管理员
  if (target.role === 'admin' && adminLevelOf(target.role, target.admin_level) >= operLevel) {
    return c.json({ error: 'forbidden', message: '无权限删除同级或更高层级的管理员' }, 403);
  }
  await db.prepare("DELETE FROM clipboards WHERE owner_type = 'user' AND owner_id = ?").bind(targetId).run();
  await db.prepare('DELETE FROM comments WHERE author_id = ?').bind(targetId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
  return c.json({ ok: true, deleted: target.username });
});

// 全部剪贴板（不变）
app.get('/api/admin/clips', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  // v4.21：查看剪贴板分公开 / 私有两档；无私有权限的管理员连列表里都看不到私有板
  const canViewPublic = await hasAdminPerm(db, identity, 'view_public_clips');
  const canViewPrivate = await hasAdminPerm(db, identity, 'view_private_clips');
  if (!canViewPublic && !canViewPrivate) return c.json({ error: 'forbidden', message: '无查看剪贴板权限（需 view_public_clips 或 view_private_clips）' }, 403);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim().slice(0, SEARCH_MAX);
  const offset = (page - 1) * PAGE_SIZE;
  let where = ''; const params = [], conds = [];
  if (q) { conds.push('(title LIKE ? OR content LIKE ? OR owner_name LIKE ? OR clip_id LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (!canViewPrivate) conds.push('is_public = 1');
  if (conds.length) where = 'WHERE ' + conds.join(' AND ');
  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM clipboards ${where}`).bind(...params).first();
  const rows = await db.prepare(
    `SELECT clip_id, title, content, owner_type, owner_id, owner_name, is_public, editable_by_anyone,
            password_hash, expires_at, max_views, views, created_at, updated_at, login_required, max_readers,
            (SELECT COUNT(*) FROM tickets tk WHERE tk.category = 'report' AND tk.related_clip_id = clipboards.clip_id AND tk.status = 'open') AS report_count
     FROM clipboards ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, PAGE_SIZE, offset).all();
  return c.json({
    clips: rows.results.map((r) => ({
      clip_id: r.clip_id, title: r.title || '无标题',
      preview: r.password_hash ? '🔒 受密码保护' : makePreview(r.content),
      owner_type: r.owner_type, owner_id: r.owner_id, owner_name: r.owner_name,
      is_public: !!r.is_public, editable_by_anyone: !!r.editable_by_anyone,
      has_password: !!r.password_hash, expires_at: r.expires_at,
      max_views: r.max_views, views: r.views, login_required: !!r.login_required,
      max_readers: r.max_readers, created_at: r.created_at,
      report_count: r.report_count || 0
    })),
    page, total: totalRow?.cnt || 0, totalPages: Math.max(1, Math.ceil((totalRow?.cnt || 0) / PAGE_SIZE))
  });
});

// v4.15.2: 手动触发清理「已过期且超过 3 天」的剪贴板（仅管理员）
app.delete('/api/admin/clips/expired', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAnyAdminPerm(db, identity, ['delete_public_clips', 'delete_private_clips']))) return c.json({ error: 'forbidden', message: '无删除剪贴板权限' }, 403);
  const deleted = await cleanupExpiredClips(db);
  return c.json({ ok: true, deleted });
});

// ========== v4.14: 举报审核已并入统一工单（见 /api/tickets，category=report） ==========
const REPORT_REASON_LABEL = { spam: '恶意/垃圾', porn: '低俗色情', sensitive: '擦边内容', illegal: '违法违规', other: '其他' };

// OAuth 子路由
app.route('/api/auth', oauthRoutes);

// ========== v4.7: 跨站账号互通 + oiwb 快照同步 ==========

const OIWB_TICKET_TTL = 5 * 60;       // ticket 5 分钟
const OIWB_TOKEN_TTL = 60 * 60;       // oiwb JWT 1 小时
const OIWB_REFRESH_TTL = 30 * 24 * 60 * 60;  // oiwb refresh 30 天
const OIWB_MAX_SNAPSHOT = 1024 * 1024;  // 单快照硬上限 1 MB

function genJti() {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

// 1. 申请跨站 ticket（已登录用户 → 给 5 分钟短期 JWT，含 jti 用于一次性）
app.post('/api/auth/ticket', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);

  let body = {};
  try { body = await c.req.json(); } catch { /* 允许空 body */ }
  const scope = String(body.scope || 'oiwb');
  if (!['oiwb', 'mdqp', 'app-hub'].includes(scope)) return c.json({ error: 'bad_scope' }, 400);

  const jti = genJti();
  const exp = Math.floor(Date.now() / 1000) + OIWB_TICKET_TTL;
  const secret = c.env.CPOAUTH_CLIENT_SECRET || 'dev-secret';

  await db.prepare(
    'INSERT INTO oiwb_tickets (jti, uid, scope, exp, used_at, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).bind(jti, identity.userId, scope, exp, Math.floor(Date.now() / 1000)).run();

  // ticket 本身签成 JWT（含 jti 一次性校验）
  const ticket = await signJWT(
    { jti, uid: Number(identity.userId), scope, exp, sub: identity.sub, kind: 'ticket' },
    secret
  );
  await logEvent(db, 'mdqp', 'auth.ticket', identity.userId, scope, '');
  return c.json({ ticket, exp, scope });
});

// 2. 用 ticket 换正式 oiwb JWT（含 refresh）
app.post('/api/auth/exchange', async (c) => {
  const db = c.env.db;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const ticket = String(body.ticket || '');
  if (!ticket) return c.json({ error: 'missing_ticket' }, 400);

  const secret = c.env.CPOAUTH_CLIENT_SECRET || 'dev-secret';
  const payload = await verifyJWT(ticket, secret);
  if (!payload || payload.kind !== 'ticket' || !payload.jti || !payload.uid || !payload.scope) {
    return c.json({ error: 'bad_ticket' }, 400);
  }

  // 检查 jti 一次性 + 未过期
  const row = await db.prepare('SELECT jti, uid, scope, exp, used_at FROM oiwb_tickets WHERE jti = ?').bind(payload.jti).first();
  if (!row) return c.json({ error: 'ticket_not_found' }, 400);
  if (row.used_at > 0) return c.json({ error: 'ticket_used' }, 400);
  if (row.exp < Math.floor(Date.now() / 1000)) return c.json({ error: 'ticket_expired' }, 400);

  // 一次性：标记已用
  await db.prepare('UPDATE oiwb_tickets SET used_at = ? WHERE jti = ?')
    .bind(Math.floor(Date.now() / 1000), payload.jti).run();

  // 拉用户基本信息
  const u = await db.prepare(
    'SELECT id, username, display_name, avatar, role, is_vip FROM users WHERE id = ?'
  ).bind(String(payload.uid)).first();
  if (!u) return c.json({ error: 'user_not_found' }, 404);

  const nowS = Math.floor(Date.now() / 1000);

  // 签 oiwb access JWT
  const accessJti = genJti();
  const accessExp = nowS + OIWB_TOKEN_TTL;
  const token = await signJWT(
    {
      userId: Number(u.id), name: u.username, displayName: u.display_name,
      avatar: u.avatar, scope: payload.scope, exp: accessExp,
      jti: accessJti, kind: 'oiwb'
    },
    secret
  );

  // 签 oiwb refresh（jti 入表用于吊销）
  const refreshJti = genJti();
  const refreshExp = nowS + OIWB_REFRESH_TTL;
  await db.prepare(
    'INSERT INTO oiwb_tickets (jti, uid, scope, exp, used_at, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).bind(refreshJti, Number(u.id), 'refresh:' + payload.scope, refreshExp, nowS).run();
  const refresh = await signJWT(
    { userId: Number(u.id), scope: payload.scope, exp: refreshExp, jti: refreshJti, kind: 'refresh' },
    secret
  );

  return c.json({
    token, refresh, exp: accessExp, refreshExp,
    uid: Number(u.id), name: u.username, display_name: u.display_name,
    avatar: u.avatar, role: u.role, is_vip: !!u.is_vip, scope: payload.scope
  });
});

// 3. 刷新 oiwb JWT（用 refresh 换新 token，不重发 refresh 避免无限续期）
app.post('/api/auth/refresh', async (c) => {
  const db = c.env.db;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const refresh = String(body.refresh || '');
  if (!refresh) return c.json({ error: 'missing_refresh' }, 400);

  const secret = c.env.CPOAUTH_CLIENT_SECRET || 'dev-secret';
  const payload = await verifyJWT(refresh, secret);
  if (!payload || payload.kind !== 'refresh' || !payload.jti) return c.json({ error: 'bad_refresh' }, 400);

  const row = await db.prepare('SELECT jti, exp, used_at FROM oiwb_tickets WHERE jti = ?').bind(payload.jti).first();
  if (!row) return c.json({ error: 'refresh_not_found' }, 400);
  if (row.used_at > 0) return c.json({ error: 'refresh_revoked' }, 400);
  if (row.exp < Math.floor(Date.now() / 1000)) return c.json({ error: 'refresh_expired' }, 400);

  const u = await db.prepare(
    'SELECT id, username, display_name, avatar, role, is_vip FROM users WHERE id = ?'
  ).bind(String(payload.userId)).first();
  if (!u) return c.json({ error: 'user_not_found' }, 404);

  const accessExp = Math.floor(Date.now() / 1000) + OIWB_TOKEN_TTL;
  const token = await signJWT(
    {
      userId: Number(u.id), name: u.username, displayName: u.display_name,
      avatar: u.avatar, scope: payload.scope, exp: accessExp,
      jti: genJti(), kind: 'oiwb'
    },
    secret
  );

  return c.json({
    token, exp: accessExp,
    uid: Number(u.id), name: u.username, display_name: u.display_name,
    avatar: u.avatar, role: u.role, is_vip: !!u.is_vip, scope: payload.scope
  });
});

// 4. 吊销 oiwb refresh（登出用；幂等，无 refresh 也返 200）
app.post('/api/auth/revoke-token', async (c) => {
  const db = c.env.db;
  let body = {};
  try { body = await c.req.json(); } catch { /* 空 body 也返 200 */ }
  const refresh = String(body.refresh || '');
  if (!refresh) return c.json({ ok: true, noop: true });

  const secret = c.env.CPOAUTH_CLIENT_SECRET || 'dev-secret';
  const payload = await verifyJWT(refresh, secret);
  if (payload && payload.jti) {
    // used_at > 0 即视为吊销
    await db.prepare('UPDATE oiwb_tickets SET used_at = ? WHERE jti = ? AND used_at = 0')
      .bind(Math.floor(Date.now() / 1000), payload.jti).run();
  }
  return c.json({ ok: true });
});

// 5. oiwb 推快照（登录用户）
app.post('/api/oiwb/sync', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const blob = String(body.blob || '');
  if (!blob) return c.json({ error: 'missing_blob' }, 400);
  if (blob.length > OIWB_MAX_SNAPSHOT) return c.json({ error: 'too_large_1MB', max: OIWB_MAX_SNAPSHOT }, 413);

  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    'INSERT INTO oiwb_snapshots (uid, size, blob, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(uid) DO UPDATE SET size = excluded.size, blob = excluded.blob, updated_at = excluded.updated_at'
  ).bind(identity.userId, blob.length, blob, now).run();

  await logEvent(db, 'oiwb', 'oiwb.push', identity.userId, '', 'size=' + blob.length);
  return c.json({ ok: true, size: blob.length, updated_at: now });
});

// 6. oiwb 拉快照（登录用户）
app.get('/api/oiwb/sync', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);

  const row = await db.prepare('SELECT blob, size, updated_at FROM oiwb_snapshots WHERE uid = ?')
    .bind(identity.userId).first();
  if (!row) return c.json({ blob: null, size: 0, updated_at: 0 });
  return c.json({ blob: row.blob, size: row.size, updated_at: row.updated_at });
});

// ========== M3 埋点（events 表） ==========
// 设计原则：埋点是旁路，任何失败都必须静默，绝不影响主流程。

// 事件类型白名单：未在名单内的一律丢弃，防止把表刷成垃圾堆
const EVENT_TYPES = new Set([
  'clip.create', 'clip.view', 'clip.copy', 'clip.save',
  'auth.login', 'auth.logout', 'auth.ticket',
  'oiwb.push', 'oiwb.pull', 'oiwb.restore', 'oiwb.open',
  'snippet.save', 'snippet.open', 'snippet.search',
  'page.view', 'vip.view', 'feedback.submit'
]);

async function logEvent(db, app, type, uid, ref, meta) {
  try {
    if (!EVENT_TYPES.has(type)) return;
    await db
      .prepare('INSERT INTO events (app, type, uid, ref, meta) VALUES (?, ?, ?, ?, ?)')
      .bind(app === 'oiwb' ? 'oiwb' : 'mdqp', type, String(uid || '').slice(0, 32), String(ref || '').slice(0, 64), String(meta || '').slice(0, 500))
      .run();
  } catch (e) {
    /* 埋点失败静默 */
  }
}

// 上报埋点（公开接口：游客也需打点，故不做登录校验）
// 防护组合：① EVENT_TYPES 白名单（非白名单 type 直接丢弃）
//          ② 单请求最多 10 条（body.events.slice(0,10)）
//          ③ 各字段长度截断（type 64 / ref 64 / meta 500 / uid 32，见 logEvent）
//          ④ 请求体大小上限 16KB（超直接拒，防滥用）
//          ⑤ page.view 按 uid 5 分钟去重（避免刷新刷数据，保证 DAU 真实可信）
app.post('/api/events', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);

  // ④ body 大小上限
  const len = parseInt(c.req.header('content-length') || '0', 10);
  if (len > 16 * 1024) return c.json({ error: 'payload_too_large' }, 413);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }

  const list = Array.isArray(body.events) ? body.events.slice(0, 10) : [body];
  const uid = identity.type === 'user' ? identity.userId : (identity.type === 'guest' ? 'g:' + identity.guestId : '');
  let n = 0;
  for (const ev of list) {
    const type = String((ev && ev.type) || '').slice(0, 64);
    if (!EVENT_TYPES.has(type)) continue;
    // ⑤ page.view 去重：同一 uid 5 分钟内只计一次
    if (type === 'page.view' && uid) {
      const dup = await db.prepare(
        "SELECT 1 FROM events WHERE uid = ? AND type = 'page.view' AND created_at >= datetime('now','-5 minutes') LIMIT 1"
      ).bind(uid).first();
      if (dup) continue;
    }
    await logEvent(db, ev.app, type, uid, (ev && ev.ref) || '', (ev && ev.meta) || '');
    n++;
  }
  return c.json({ ok: true, accepted: n });
});

// 看板聚合（仅管理员/开发者）
app.get('/api/admin/events/summary', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);

  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') || '7') || 7));
  const since = `-${days} days`;

  const byType = await db
    .prepare("SELECT app, type, COUNT(*) AS cnt FROM events WHERE created_at >= datetime('now', ?) GROUP BY app, type ORDER BY cnt DESC")
    .bind(since).all();

  const byDay = await db
    .prepare("SELECT date(created_at) AS d, COUNT(*) AS cnt, COUNT(DISTINCT uid) AS uv FROM events WHERE created_at >= datetime('now', ?) AND uid <> '' GROUP BY d ORDER BY d")
    .bind(since).all();

  const dau = await db
    .prepare("SELECT COUNT(DISTINCT uid) AS n FROM events WHERE created_at >= datetime('now', ?) AND uid <> ''")
    .bind(since).first();

  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE created_at >= datetime('now', ?)")
    .bind(since).first();

  return c.json({
    ok: true, days,
    total: total?.n || 0,
    dau: dau?.n || 0,
    by_type: (byType.results || []).map((r) => ({ app: r.app, type: r.type, cnt: r.cnt })),
    by_day: (byDay.results || []).map((r) => ({ d: r.d, cnt: r.cnt, uv: r.uv }))
  });
});

// ========== Raw 直链 ==========

app.get('/raw/:clipId', async (c) => {
  const db = c.env.db;
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(c.req.param('clipId')).first();
  if (!r) return c.text('Not Found', 404);
  if (isExpired(r)) return c.text('Gone: 剪贴板已过期或达到查看上限', 410);
  if (r.login_required) return c.text('401 需要登录: 此剪贴板仅登录用户可访问', 401);
  if (r.password_hash) { const pwd = c.req.query('pwd') || ''; if (!pwd || (await hashPassword(pwd)) !== r.password_hash) return c.text('401 需要密码: 追加 ?pwd=xxx', 401); }
  await db.prepare('UPDATE clipboards SET views = views + 1 WHERE clip_id = ?').bind(r.clip_id).run();
  return new Response(r.content, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
});

// ========== 站点设置 API（管理员） ==========

app.get('/api/admin/settings', async (c) => {
  const db = c.env.db;
  if (!(await isAdminIdentity(db, await getIdentity(c)))) return c.json({ error: 'forbidden' }, 403);
  const rows = await db.prepare('SELECT key, value, updated_at FROM site_settings').all();
  return c.json({ settings: rows.results });
});

app.put('/api/admin/settings/:key', async (c) => {
  const db = c.env.db;
  if (!(await isAdminIdentity(db, await getIdentity(c)))) return c.json({ error: 'forbidden' }, 403);
  const key = c.req.param('key');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const value = String(body.value || '');
  await db.prepare('INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')')
    .bind(key, value).run();
  return c.json({ ok: true, key, value });
});

// ========== v4.17: 聊天系统 ==========
// 设计：单聊 / 群聊共用 chat_conversations + chat_members + chat_messages。
// 全站总群 is_global=1，所有用户注册时自动加入（见 oauth.js）。
// 实时性：前端轮询（3-5s）+ 未读计数（chat_members.last_read_id）。
// 存储上限：单聊任一方 VIP / 群主 VIP → 保留最近 100 条，否则 50 条（超限时清理最旧）。

/** 单条聊天消息的等效字数上限（与前端 eqChars 对齐）：超过直接拒绝发送 */
const CHAT_MSG_MAX = 150;

/** 取全站总群 conv_id（无则返回 null） */
async function getGlobalConvId(db) {
  const r = await db.prepare('SELECT id FROM chat_conversations WHERE is_global = 1 LIMIT 1').first();
  return r ? r.id : null;
}

/** 计算会话保留上限：VIP 相关则 100，否则 50 */
async function chatRetentionLimit(db, conv) {
  let vip = false;
  if (conv.type === 'single') {
    const r = await db.prepare(
      "SELECT 1 FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conv_id = ? AND cm.left = 0 AND u.is_vip = 1 AND (u.vip_until IS NULL OR u.vip_until > datetime('now')) LIMIT 1"
    ).bind(conv.id).first();
    vip = !!r;
  } else if (conv.owner_id) {
    const o = await db.prepare(
      "SELECT 1 FROM users WHERE id = ? AND is_vip = 1 AND (vip_until IS NULL OR vip_until > datetime('now')) LIMIT 1"
    ).bind(conv.owner_id).first();
    vip = !!o;
  }
  return vip ? 100 : 50;
}

/** 校验当前用户是对话成员（未退出）；返回 member 行或 null */
async function getChatMember(db, convId, userId) {
  return await db.prepare('SELECT * FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(convId, userId).first();
}

// 全局未读数（轻量，供导航栏角标 / 后台轮询使用）
// 注意：未读必须按真实消息数 COUNT，不能用「最后一条 id − last_read_id」——
// chat_messages.id 是全局自增、跨会话共享 id 空间的，同一会话内 id 并不连续。
app.get('/api/chat/unread', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM chat_messages m
     JOIN chat_members cm ON cm.conv_id = m.conv_id AND cm.user_id = ? AND cm.left = 0
     WHERE m.id > COALESCE(cm.last_read_id, 0) AND m.sender_id <> ?`
  ).bind(identity.userId, identity.userId).first();
  // v4.21：附带每个会话的最新一条消息，让**全站**全局轮询就能判定「有新消息」并弹桌面通知，
  // 不必再拉一次完整会话列表（此前通知只在聊天页内发，用户在别的页面收不到）。
  const convs = await db.prepare(
    `SELECT c.id, c.type, c.name, cm.muted,
            m.id AS m_id, m.content AS m_content, m.sender_id AS m_sender_id,
            COALESCE(u.display_name, u.username, '') AS m_sender_name
       FROM chat_conversations c
       JOIN chat_members cm ON cm.conv_id = c.id AND cm.user_id = ? AND cm.left = 0
       LEFT JOIN chat_messages m ON m.id = (SELECT MAX(id) FROM chat_messages WHERE conv_id = c.id)
       LEFT JOIN users u ON u.id = m.sender_id`
  ).bind(identity.userId).all();
  const items = (convs.results || []).map((r) => ({
    id: r.id, type: r.type, name: r.name || '', muted: !!r.muted,
    last_id: r.m_id || 0, content: r.m_content || '',
    sender_id: r.m_sender_id == null ? null : String(r.m_sender_id),
    sender_name: r.m_sender_name || ''
  }));
  return c.json({ unread: row ? row.n : 0, convs: items });
});

// 会话列表（含对方/群信息、最后一条消息、未读、成员数）
// v4.20 P0-1.2：改为批量查询，原先每个会话串行 4–5 次 D1 往返，会话一多就是几十次。
app.get('/api/chat/conversations', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);

  const convs = await db.prepare(
    'SELECT c.id, c.type, c.name, c.is_global, c.owner_id, c.announcement, c.avatar, cm.role, cm.last_read_id, cm.muted FROM chat_conversations c JOIN chat_members cm ON cm.conv_id = c.id WHERE cm.user_id = ? AND cm.left = 0 ORDER BY c.id DESC'
  ).bind(identity.userId).all();

  const rows = convs.results || [];
  const ids = rows.map((r) => r.id);
  const list = rows.map((conv) => ({
    id: conv.id, type: conv.type, name: conv.name, is_global: !!conv.is_global,
    owner_id: conv.owner_id, my_role: conv.role, unread: 0, last_message: null, announcement: conv.announcement || '', avatar: conv.avatar || '',
    member_count: 0, other: null, limit: 50, muted: !!conv.muted
  }));
  if (!ids.length) return c.json({ conversations: list });

  const ph = ids.map(() => '?').join(',');

  // ① 每个会话的最后一条消息（一次查询）
  const lasts = await db.prepare(
    `SELECT m.conv_id, m.id, m.sender_id, m.content, m.created_at, u.display_name AS sender_name
     FROM chat_messages m
     JOIN (SELECT conv_id, MAX(id) AS mid FROM chat_messages WHERE conv_id IN (${ph}) GROUP BY conv_id) x ON x.mid = m.id
     LEFT JOIN users u ON u.id = m.sender_id`
  ).bind(...ids).all();
  const lastMap = new Map();
  for (const r of lasts.results || []) {
    lastMap.set(r.conv_id, { id: r.id, sender_id: r.sender_id, content: r.content, created_at: r.created_at, sender_name: r.sender_name || null });
  }

  // ② 每个会话的未读数（JOIN 出自己的 last_read_id，一次查询）
  const unread = await db.prepare(
    `SELECT m.conv_id AS conv_id, COUNT(*) AS n FROM chat_messages m
     JOIN chat_members cm ON cm.conv_id = m.conv_id AND cm.user_id = ? AND cm.left = 0
     WHERE m.conv_id IN (${ph}) AND m.id > COALESCE(cm.last_read_id, 0) AND m.sender_id <> ?
     GROUP BY m.conv_id`
  ).bind(identity.userId, ...ids, identity.userId).all();
  const unreadMap = new Map((unread.results || []).map((r) => [r.conv_id, r.n]));

  // ③ 单聊的对方信息（一次查询）
  const others = await db.prepare(
    `SELECT cm.conv_id AS conv_id, u.id, u.username, u.display_name, u.avatar
     FROM chat_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conv_id IN (${ph}) AND cm.user_id <> ? AND cm.left = 0`
  ).bind(...ids, identity.userId).all();
  const otherMap = new Map();
  for (const r of others.results || []) {
    if (!otherMap.has(r.conv_id)) otherMap.set(r.conv_id, { id: r.id, username: r.username, display_name: r.display_name || r.username, avatar: r.avatar });
  }

  // ④ 群成员数（一次查询）
  const counts = await db.prepare(
    `SELECT conv_id, COUNT(*) AS n FROM chat_members WHERE conv_id IN (${ph}) AND left = 0 GROUP BY conv_id`
  ).bind(...ids).all();
  const countMap = new Map((counts.results || []).map((r) => [r.conv_id, r.n]));

  // ⑤ 留存上限：单聊看任一方 VIP，群聊看群主 VIP（一次查询）
  const vips = await db.prepare(
    `SELECT c.id AS conv_id,
            CASE WHEN c.type = 'single'
                 THEN (SELECT MAX(CASE WHEN u.is_vip = 1 AND (u.vip_until IS NULL OR u.vip_until > datetime('now')) THEN 1 ELSE 0 END)
                       FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conv_id = c.id AND cm.left = 0)
                 ELSE (SELECT CASE WHEN u.is_vip = 1 AND (u.vip_until IS NULL OR u.vip_until > datetime('now')) THEN 1 ELSE 0 END
                       FROM users u WHERE u.id = c.owner_id) END AS vip
     FROM chat_conversations c WHERE c.id IN (${ph})`
  ).bind(...ids).all();
  const vipMap = new Map((vips.results || []).map((r) => [r.conv_id, !!r.vip]));

  for (const item of list) {
    item.last_message = lastMap.get(item.id) || null;
    item.unread = unreadMap.get(item.id) || 0;
    item.member_count = countMap.get(item.id) || 0;
    item.other = item.type === 'single' ? (otherMap.get(item.id) || null) : null;
    item.limit = vipMap.get(item.id) ? 100 : 50;
  }
  return c.json({ conversations: list });
});

// 消息列表（分页：before=最早已加载消息 id，不传则取最新 50 条）
app.get('/api/chat/conversations/:id/messages', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);

  const before = c.req.query('before');
  const since = c.req.query('since');
  // v4.30：聊天读走 KV 缓存（高频读场景，KV 配额独立且远大于 D1）。
  // 轮询是烧 D1 读配额的大头，这里命中缓存就不碰 D1；发消息/撤回时主动失效。
  const cacheBase = 'chatmsg:' + convId + ':';
  // 把版本号拼进 key：写消息时 bump 版本，旧缓存 key 自然不再被命中（无需精确删除）
  const ver = await chatVer(c.env.SITE_KV, convId);
  const cacheKey = cacheBase + 'v' + ver + ':' + (since && !isNaN(parseInt(since, 10)) ? 'since' + parseInt(since, 10) : before && !isNaN(parseInt(before, 10)) ? 'before' + parseInt(before, 10) : 'tail');
  const cached = await cacheGet(c.env.SITE_KV, cacheKey);
  if (cached && Array.isArray(cached.messages)) {
    c.header('X-Cache', 'HIT');
    return c.json({ messages: cached.messages, cached: true });
  }

  let rows;
  if (since && !isNaN(parseInt(since, 10))) {
    rows = await db.prepare('SELECT m.id, m.sender_id, m.content, m.created_at, m.recalled, m.reply_to, m.mentions, m.attach_type, m.attach_id, u.username AS sender_username, u.display_name AS sender_name, u.avatar AS sender_avatar, u.tag AS sender_tag FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conv_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 50').bind(convId, parseInt(since, 10)).all();
  } else if (before && !isNaN(parseInt(before, 10))) {
    rows = await db.prepare('SELECT m.id, m.sender_id, m.content, m.created_at, m.recalled, m.reply_to, m.mentions, m.attach_type, m.attach_id, u.username AS sender_username, u.display_name AS sender_name, u.avatar AS sender_avatar, u.tag AS sender_tag FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conv_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 50').bind(convId, parseInt(before, 10)).all();
  } else {
    rows = await db.prepare('SELECT m.id, m.sender_id, m.content, m.created_at, m.recalled, m.reply_to, m.mentions, m.attach_type, m.attach_id, u.username AS sender_username, u.display_name AS sender_name, u.avatar AS sender_avatar, u.tag AS sender_tag FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conv_id = ? ORDER BY m.id DESC LIMIT 50').bind(convId).all();
  }
  let raw = rows.results || [];
  if (!since) raw = raw.reverse(); // 旧→新，便于前端顺序渲染
  const msgs = raw.map((r) => ({
    id: r.id, sender_id: r.sender_id, content: r.content, created_at: r.created_at,
    sender: { username: r.sender_username, display_name: r.sender_name || r.sender_username, avatar: r.sender_avatar, tag: r.sender_tag || '', invisible: hasInvisibleChars(r.sender_name) },
    recalled: !!r.recalled, reply_to: r.reply_to || 0, mentions: safeParseArray(r.mentions),
    attach_type: r.attach_type || '', attach_id: r.attach_id || ''
  }));
  // 轮询结果短 TTL 缓存；翻历史（before）缓存久一点。KV 故障时 cacheGet 已吞异常，不影响主流程
  await cachePut(c.env.SITE_KV, cacheKey, { messages: msgs }, cacheKey.endsWith('tail') ? 20 : 600);
  return c.json({ messages: msgs, cached: false });
});

// 发送消息
app.post('/api/chat/conversations/:id/messages', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);

  // v4.27：全局聊天禁用（关战）+ 单用户聊天禁用
  const dfRow = await db.prepare("SELECT value FROM site_settings WHERE key='disabled_features'").first();
  if (parseInt(dfRow?.value || '0', 10) & DF_CHAT) return c.json({ error: 'chat_disabled', message: '聊天功能已临时关闭' }, 503);
  if (await isUserFeatureDisabled(db, identity.userId, DF_CHAT)) return c.json({ error: 'your_chat_disabled', message: '你的聊天功能已被管理员关闭' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const content = stripInvisible(String(body.content || '').replace(/\r\n/g, '\n')).trim();
  const attachType = String(body.attach_type || '').slice(0, 10);
  const attachId = String(body.attach_id || '').slice(0, 64);
  const replyTo = parseInt(body.reply_to, 10) || 0;
  let mentions = [];
  if (Array.isArray(body.mentions)) mentions = body.mentions.map((x) => parseInt(x, 10)).filter((x) => x).slice(0, 20);
  // 纯附件消息允许无文字；否则需有内容
  if (!content && !attachType) return c.json({ error: 'empty' }, 400);
  // v4.18：超过 150 等效字符直接拒绝（前端弹窗引导改用剪贴板链接）
  const eq = countChars(content);
  if (content && eq > CHAT_MSG_MAX) {
    return c.json({ error: 'too_long', eq, max: CHAT_MSG_MAX, message: '消息约 ' + eq + ' 等效字符，超过 ' + CHAT_MSG_MAX + ' 上限，请改用剪贴板链接' }, 413);
  }

  const conv = await db.prepare('SELECT id, type, owner_id, is_global FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv) return c.json({ error: 'not_found' }, 404);

  // v4.28：限流改为纯内存状态（旧实现每条消息都 SELECT COUNT(*) 扫表，放大 D1 读配额）
  const rl = chatRateCheck(convId, identity.userId, !!conv.is_global);
  if (rl) return c.json(rl, 429);
  chatRateMark(convId, identity.userId);

  const r = await db.prepare(
    "INSERT INTO chat_messages (conv_id, sender_id, content, created_at, reply_to, mentions, attach_type, attach_id) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)"
  ).bind(convId, identity.userId, content, replyTo, JSON.stringify(mentions), attachType, attachId).run();
  const msgId = r.meta.last_row_id;
  await chatBumpVersion(c.env.SITE_KV, convId); // v4.30：新消息使旧缓存立即失效

  // 发送者自身标记为已读（避免自己发的消息算未读）
  await db.prepare('UPDATE chat_members SET last_read_id = ? WHERE conv_id = ? AND user_id = ?').bind(msgId, convId, identity.userId).run();

  // 保留上限：VIP 相关 100，否则 50
  const limit = await chatRetentionLimit(db, conv);
  const cnt = await db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conv_id = ?').bind(convId).first();
  if (cnt && cnt.n > limit) {
    await db.prepare(
      'DELETE FROM chat_messages WHERE conv_id = ? AND id NOT IN (SELECT id FROM chat_messages WHERE conv_id = ? ORDER BY id DESC LIMIT ?)'
    ).bind(convId, convId, limit).run();
    await chatBumpVersion(c.env.SITE_KV, convId); // v4.30：清理旧消息后失效缓存
  }

  // 被 @ 的人发通知（轻量，失败不影响主流程）
  if (mentions.length) {
    try {
      const senderName = (await db.prepare('SELECT display_name, username FROM users WHERE id = ?').bind(identity.userId).first());
      const sname = senderName ? (senderName.display_name || senderName.username) : '有人';
      for (const uid of mentions) {
        if (uid === identity.userId) continue;
        await createNotification(db, uid, 'chat', '💬 ' + sname + ' 在群聊里 @ 了你', '点击查看消息', '/chat?c=' + convId);
      }
    } catch { /* ignore */ }
  }

  const msg = await db.prepare(
    'SELECT id, sender_id, content, created_at, recalled, reply_to, mentions, attach_type, attach_id FROM chat_messages WHERE id = ?'
  ).bind(msgId).first();
  msg.mentions = safeParseArray(msg.mentions);
  return c.json({ message: msg });
});

// 安全解析 JSON 数组（容错）
function safeParseArray(s) {
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}

// 发起单聊（找已有或建新）
app.post('/api/chat/single/:userId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const targetId = parseInt(c.req.param('userId'), 10);
  if (!targetId || targetId === identity.userId) return c.json({ error: 'invalid_target' }, 400);
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'user_not_found' }, 404);

  const existing = await db.prepare(
    "SELECT c.id FROM chat_conversations c JOIN chat_members a ON a.conv_id = c.id AND a.user_id = ? AND a.left = 0 JOIN chat_members b ON b.conv_id = c.id AND b.user_id = ? AND b.left = 0 WHERE c.type = 'single' LIMIT 1"
  ).bind(identity.userId, targetId).first();
  if (existing) return c.json({ conv_id: existing.id });

  const r = await db.prepare("INSERT INTO chat_conversations (type, name, owner_id, is_global) VALUES ('single', '', NULL, 0)").run();
  const convId = r.meta.last_row_id;
  await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(convId, identity.userId).run();
  await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(convId, targetId).run();
  return c.json({ conv_id: convId });
});

// 建群
app.post('/api/chat/groups', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return c.json({ error: 'name_required' }, 400);
  const memberIds = Array.isArray(body.member_ids) ? body.member_ids.map((x) => parseInt(x, 10)).filter((x) => x && x !== identity.userId) : [];

  const r = await db.prepare("INSERT INTO chat_conversations (type, name, owner_id, is_global) VALUES ('group', ?, ?, 0)").bind(name, identity.userId).run();
  const convId = r.meta.last_row_id;
  await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'owner')").bind(convId, identity.userId).run();

  for (const uid of memberIds) {
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!u) continue;
    await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(convId, uid).run();
    await createNotification(db, uid, 'chat', '👥 你被邀请加入群聊「' + name + '」', '点击进入群聊参与讨论', '/chat?c=' + convId);
  }
  return c.json({ conv_id: convId });
});

// 群内拉人（+ 按钮）
app.post('/api/chat/groups/:id/members', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const conv = await db.prepare("SELECT id, type, name FROM chat_conversations WHERE id = ?").bind(convId).first();
  if (!conv || conv.type !== 'group') return c.json({ error: 'not_group' }, 400);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const memberIds = Array.isArray(body.member_ids) ? body.member_ids.map((x) => parseInt(x, 10)).filter((x) => x && x !== identity.userId) : [];

  for (const uid of memberIds) {
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!u) continue;
    await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(convId, uid).run();
    await createNotification(db, uid, 'chat', '👥 你被邀请加入群聊「' + (conv.name || '群聊') + '」', '点击进入群聊参与讨论', '/chat?c=' + convId);
  }
  return c.json({ ok: true });
});

// 拉人候选：默认=与该用户发过消息的用户；带 q= 则按用户名/昵称搜索
app.get('/api/chat/candidates', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const q = (c.req.query('q') || '').trim().slice(0, 50);
  const convId = parseInt(c.req.query('convId') || '0', 10);

  let rows;
  if (q) {
    // 与 /api/search/users 同一套逻辑：纯数字可当作 user id 精确命中
    const like = `%${q}%`;
    const num = /^\d{1,10}$/.test(q) ? parseInt(q, 10) : null;
    rows = num !== null
      ? await db.prepare(
          'SELECT id, username, display_name, avatar FROM users WHERE (id = ? OR username LIKE ? OR display_name LIKE ?) AND id <> ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC LIMIT 10'
        ).bind(num, like, like, identity.userId, num).all()
      : await db.prepare(
          'SELECT id, username, display_name, avatar FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id <> ? ORDER BY id ASC LIMIT 10'
        ).bind(like, like, identity.userId).all();
  } else {
    rows = await db.prepare(
      `SELECT DISTINCT u.id, u.username, u.display_name, u.avatar
       FROM chat_conversations c
       JOIN chat_members cm1 ON cm1.conv_id = c.id AND cm1.user_id = ? AND cm1.left = 0
       JOIN chat_members cm2 ON cm2.conv_id = c.id AND cm2.user_id <> ? AND cm2.left = 0
       JOIN users u ON u.id = cm2.user_id
       WHERE c.type = 'single'
         AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.conv_id = c.id)
       ORDER BY u.id DESC LIMIT 20`
    ).bind(identity.userId, identity.userId).all();
  }
  let users = (rows.results || []).map((r) => ({ id: r.id, username: r.username, display_name: r.display_name || r.username, avatar: r.avatar }));
  if (convId) {
    const mem = await db.prepare('SELECT user_id FROM chat_members WHERE conv_id = ? AND left = 0').bind(convId).all();
    const inConv = new Set((mem.results || []).map((m) => m.user_id));
    users = users.filter((u) => !inConv.has(u.id));
  }
  return c.json({ users });
});

// 退出群聊（普通成员；群主不可退出，需解散）
app.post('/api/chat/conversations/:id/leave', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const conv = await db.prepare('SELECT id, type, is_global FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv || conv.type !== 'group') return c.json({ error: 'not_group' }, 400);
  if (conv.is_global) return c.json({ error: 'cannot_leave_global' }, 400);
  if (member.role === 'owner') return c.json({ error: 'owner_cannot_leave' }, 400);
  await db.prepare('UPDATE chat_members SET left = 1 WHERE conv_id = ? AND user_id = ?').bind(convId, identity.userId).run();
  return c.json({ ok: true });
});

// 解散群聊（仅群主）
app.post('/api/chat/conversations/:id/dissolve', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const conv = await db.prepare('SELECT id, type, is_global, owner_id FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv || conv.type !== 'group') return c.json({ error: 'not_group' }, 400);
  if (conv.is_global) return c.json({ error: 'cannot_dissolve_global' }, 400);
  if (member.role !== 'owner' && conv.owner_id !== identity.userId) return c.json({ error: 'not_owner' }, 403);
  await db.prepare('DELETE FROM chat_messages WHERE conv_id = ?').bind(convId).run();
  await chatBumpVersion(c.env.SITE_KV, convId); // v4.30：解散群后失效缓存
  await db.prepare('DELETE FROM chat_members WHERE conv_id = ?').bind(convId).run();
  await db.prepare('DELETE FROM chat_conversations WHERE id = ?').bind(convId).run();
  return c.json({ ok: true });
});

// 标记已读
app.post('/api/chat/conversations/:id/read', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await c.req.json(); } catch { /* ignore */ }
  let msgId = parseInt(body.messageId, 10);
  if (!msgId || isNaN(msgId)) {
    const last = await db.prepare('SELECT MAX(id) AS m FROM chat_messages WHERE conv_id = ?').bind(convId).first();
    msgId = last ? last.m : 0;
  }
  await db.prepare('UPDATE chat_members SET last_read_id = ? WHERE conv_id = ? AND user_id = ?').bind(msgId, convId, identity.userId).run();
  return c.json({ ok: true });
});

// 消息免打扰（v4.18）：置 1 后该会话不再触发浏览器通知，列表未读改为静默小点
app.post('/api/chat/conversations/:id/mute', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  let body = {};
  try { body = await c.req.json(); } catch { /* ignore */ }
  // 不传 muted 则取反（前端切换按钮用）
  const muted = body.muted === undefined ? (member.muted ? 0 : 1) : (body.muted ? 1 : 0);
  await db.prepare('UPDATE chat_members SET muted = ? WHERE conv_id = ? AND user_id = ?').bind(muted, convId, identity.userId).run();
  return c.json({ ok: true, muted: !!muted });
});

// ========== 用户快速部署网站（v4.19，独立托管 qsites.pages.dev，KV 存储） ==========
// 安全底线：用户站部署在独立 origin（qsites），与主站 mdqp 不同源，同源策略自动阻断
// 用户站 JS 读取主站 cookie / 调主站接口。文件本体存 KV（SITE_KV），元数据存 D1（sites）。

/** 用户站托管的公网 origin（与主站不同源，天然隔离） */
const SITES_HOST = 'https://qsites.pages.dev';

const RESERVED_SLUGS = new Set([
  'api', 'admin', 'chat', 's', 'u', 'www', 'assets', 'about', 'help', 'vip',
  'invite', 'tickets', 'me', 'new', 'edit', 'c', 'error', '404', 'legacy',
  'sites', 'qsite', 'qsites', 'code', 'admin', 'home', 'feedback'
]);
function siteQuota(isVip) {
  return isVip
    ? { maxSites: 10, maxSiteBytes: 20 * 1024 * 1024, maxFileBytes: 5 * 1024 * 1024, maxFiles: 500 }
    : { maxSites: 3, maxSiteBytes: 5 * 1024 * 1024, maxFileBytes: 1 * 1024 * 1024, maxFiles: 200 };
}
function validSiteSlug(s) { return /^[a-z0-9][a-z0-9-]{1,30}$/.test(s || '') && !RESERVED_SLUGS.has(s); }
function guessType(p) {
  const m = (p.split('.').pop() || '').toLowerCase();
  const map = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
    mjs: 'application/javascript', json: 'application/json', txt: 'text/plain', md: 'text/markdown',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', ico: 'image/x-icon', pdf: 'application/pdf', xml: 'application/xml',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', map: 'application/json'
  };
  return map[m] || 'application/octet-stream';
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// base64 字符串解码后的真实字节数（去掉 padding），用于精确的容量配额计算
function b64DecodedLen(b64) {
  const s = String(b64 || '');
  const pad = (s.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor(s.length * 3 / 4) - pad);
}
const SITE_PREFIX = (slug) => 'sites/' + slug + '/';

// 创建站点（仅登录用户）
app.post('/api/sites', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required', message: '登录后才能创建网站' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const slug = (body.slug || '').toString().trim().toLowerCase();
  const title = (body.title || '').toString().slice(0, 120);
  const description = (body.description || '').toString().slice(0, 500);
  if (!validSiteSlug(slug)) return c.json({ error: 'invalid_slug', message: 'slug 须为 2–31 位小写字母/数字/连字符，且非保留字' }, 400);
  const existing = await db.prepare('SELECT id FROM sites WHERE slug = ?').bind(slug).first();
  if (existing) return c.json({ error: 'slug_taken', message: '该网址标识已被占用' }, 409);
  const isVip = await isVipIdentity(db, identity);
  const quota = siteQuota(isVip);
  const cnt = (await db.prepare("SELECT COUNT(*) as c FROM sites WHERE owner_id = ?").bind(String(identity.userId)).first()).c;
  if (cnt >= quota.maxSites) return c.json({ error: 'site_limit', message: `你最多可创建 ${quota.maxSites} 个网站（VIP ${siteQuota(true).maxSites} 个）`, limit: quota.maxSites }, 403);
  await db.prepare(
    "INSERT INTO sites (slug, owner_id, title, description, status, size_bytes, file_count) VALUES (?, ?, ?, ?, 'draft', 0, 0)"
  ).bind(slug, String(identity.userId), title, description).run();
  await kv.put(SITE_PREFIX(slug) + '__status', 'draft');
  return c.json({ ok: true, slug, title, status: 'draft' });
});

// 列出我的站点
app.get('/api/sites', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const rows = await db.prepare(
    "SELECT slug, title, description, status, size_bytes, file_count, suspend_reason, created_at, updated_at FROM sites WHERE owner_id = ? ORDER BY updated_at DESC"
  ).bind(String(identity.userId)).all();
  const sites = rows.results || [];
  // v4.24：附上托管侧访问统计（KV 异步累计，最终一致；失败不影响列表）
  if (kv) {
    await Promise.all(sites.map(async (s) => {
      try {
        const raw = await kv.get(SITE_PREFIX(s.slug) + '__stats');
        const o = raw ? JSON.parse(raw) : null;
        s.visits = { total: (o && o.total) || 0, days: (o && o.days) || {} };
      } catch { s.visits = { total: 0, days: {} }; }
    }));
  }
  return c.json({ sites });
});

// 获取单个站点（仅拥有者）
app.get('/api/sites/:slug', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  // v4.24.1：附上托管侧访问统计（与列表接口一致；失败不影响返回）
  let visits = { total: 0, days: {} };
  if (kv) {
    try {
      const raw = await kv.get(SITE_PREFIX(slug) + '__stats');
      const o = raw ? JSON.parse(raw) : null;
      visits = { total: (o && o.total) || 0, days: (o && o.days) || {} };
    } catch { /* ignore */ }
  }
  // v4.26 2.3：附带快照配额信息（前端面板用）
  let snapshot = { limit: await snapshotQuotaOf(db, identity), used: 0 };
  try {
    const idxRaw = await kv.get(SNAP_INDEX(slug));
    snapshot.used = idxRaw ? JSON.parse(idxRaw).length : 0;
  } catch { /* ignore */ }
  return c.json({ site: Object.assign({}, row, { visits, snapshot }) });
});

// 上传文件（base64 数组 → KV）
app.post('/api/sites/:slug/files', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  // v4.20：被管理员封禁的站点，站长不能再改动内容
  if (row.status === 'suspended') return c.json({ error: 'suspended', message: '站点已被封禁，无法修改内容。如有异议请通过工单申诉。' }, 403);
  const isVip = await isVipIdentity(db, identity);
  const quota = siteQuota(isVip);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return c.json({ error: 'empty', message: '没有文件' }, 400);
  // 校验每个文件路径
  const seen = new Set();
  let incomingBytes = 0;
  for (const f of files) {
    let p = (f.path || '').toString().replace(/^\/+/, '');
    if (!p || p.includes('..') || p.startsWith('__status')) return c.json({ error: 'bad_path', message: '非法文件路径：' + p }, 400);
    if (seen.has(p)) return c.json({ error: 'dup_path', message: '重复文件：' + p }, 400);
    seen.add(p);
    if (!/^[\x20-\x7e]+$/.test(p)) return c.json({ error: 'bad_path', message: '路径仅支持 ASCII：' + p }, 400);
    const sz = b64DecodedLen(f.content);
    if (sz > quota.maxFileBytes) return c.json({ error: 'file_too_large', message: `文件 ${p} 超过单文件上限 ${(quota.maxFileBytes / 1024 / 1024).toFixed(0)}MB`, max: quota.maxFileBytes }, 413);
    incomingBytes += sz;
  }
  const curBytes = row.size_bytes || 0;
  const curCount = row.file_count || 0;
  // v4.19.2：同名文件是「覆盖」而非新增，必须按差额累加。
  // 旧实现直接 curBytes + incomingBytes / curCount + files.length，
  // 反复编辑保存同一个 index.html 会让容量与文件数虚高，几次就顶满配额、无法再保存。
  const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
  const existSizes = new Map();
  for (const k of (listed.keys || [])) {
    if (k.name.endsWith('/__status')) continue;
    existSizes.set(k.name.slice(SITE_PREFIX(slug).length), (k.metadata && k.metadata.size) || 0);
  }
  let deltaBytes = 0, deltaCount = 0;
  for (const f of files) {
    const p = (f.path || '').toString().replace(/^\/+/, '');
    const sz = b64DecodedLen(f.content);
    if (existSizes.has(p)) deltaBytes += sz - existSizes.get(p);
    else { deltaBytes += sz; deltaCount += 1; }
  }
  const newBytes = Math.max(0, curBytes + deltaBytes);
  const newCount = curCount + deltaCount;
  if (newBytes > quota.maxSiteBytes) return c.json({ error: 'site_too_large', message: `总大小超过 ${(quota.maxSiteBytes / 1024 / 1024).toFixed(0)}MB 上限`, max: quota.maxSiteBytes }, 413);
  if (newCount > quota.maxFiles) return c.json({ error: 'too_many_files', message: `文件数超过 ${quota.maxFiles} 上限`, max: quota.maxFiles }, 413);
  // 写入 KV
  for (const f of files) {
    let p = (f.path || '').toString().replace(/^\/+/, '');
    const ct = (f.contentType && /^[\w/-]+$/.test(f.contentType)) ? f.contentType : guessType(p);
    const bytes = b64ToBytes(f.content || '');
    await kv.put(SITE_PREFIX(slug) + p, bytes, { metadata: { contentType: ct, size: bytes.length } });
  }
  const newStatus = newCount > 0 ? 'published' : 'draft';
  await db.prepare("UPDATE sites SET size_bytes = ?, file_count = ?, status = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(newBytes, newCount, newStatus, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', newStatus);
  return c.json({ ok: true, size_bytes: newBytes, file_count: newCount, status: newStatus });
});

// 列出文件
app.get('/api/sites/:slug/files', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
  const files = (listed.keys || [])
    .filter((k) => !k.name.endsWith('/__status'))
    .map((k) => {
      const path = k.name.slice(SITE_PREFIX(slug).length);
      return { path, size: (k.metadata && k.metadata.size) || 0, contentType: (k.metadata && k.metadata.contentType) || guessType(path) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return c.json({ files });
});

// 取单个文件原始内容（供编辑使用）：返回 base64 + contentType
app.get('/api/sites/:slug/file/*', async (c) => {
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const up = new URL(c.req.url);
  const fprefix = '/api/sites/' + slug + '/file/';
  const path = up.pathname.startsWith(fprefix) ? decodeURIComponent(up.pathname.slice(fprefix.length)) : '';
  if (!path || path.includes('..') || path.startsWith('__status')) return c.json({ error: 'bad_path' }, 400);
  const row = await c.env.db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  // KV 坑：{type:'arrayBuffer',metadata:true} 同时传会丢 value → 值/metadata 分两次读。
  // 且 {type:'arrayBuffer'} 的返回形态随运行时不同：可能是裸 ArrayBuffer，也可能是 {value:ArrayBuffer}。
  const raw = await kv.get(SITE_PREFIX(slug) + path, { type: 'arrayBuffer' });
  const meta = await kv.get(SITE_PREFIX(slug) + path, { metadata: true });
  const buf = (raw && raw.value !== undefined) ? raw.value : raw;
  if (!buf) return c.json({ error: 'not_found' }, 404);
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  const b64 = btoa(bin);
  const ct = (meta && meta.metadata && meta.metadata.contentType) || guessType(path);
  return c.json({ path, contentType: ct, content: b64, size: bytes.length });
});

// 覆盖写单个文件（编辑后保存）
app.put('/api/sites/:slug/files/*', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const up = new URL(c.req.url);
  const fprefix = '/api/sites/' + slug + '/files/';
  const path = up.pathname.startsWith(fprefix) ? decodeURIComponent(up.pathname.slice(fprefix.length)) : '';
  if (!path || path.includes('..') || path.startsWith('__status')) return c.json({ error: 'bad_path' }, 400);
  if (!/^[\x20-\x7e]+$/.test(path)) return c.json({ error: 'bad_path', message: '路径仅支持 ASCII' }, 400);
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'suspended') return c.json({ error: 'suspended', message: '站点已被封禁，无法修改内容。如有异议请通过工单申诉。' }, 403);
  const isVip = await isVipIdentity(db, identity);
  const quota = siteQuota(isVip);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const content = body.content || '';
  const sz = b64DecodedLen(content);
  if (sz > quota.maxFileBytes) return c.json({ error: 'file_too_large', message: `文件超过单文件上限 ${(quota.maxFileBytes / 1024 / 1024).toFixed(0)}MB` }, 413);
  // 取旧大小用于差额计算
  const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
  const oldMeta = (listed.keys || []).find((k) => k.name === SITE_PREFIX(slug) + path);
  const oldSize = (oldMeta && oldMeta.metadata && oldMeta.metadata.size) || 0;
  const newTotal = (row.size_bytes || 0) - oldSize + sz;
  if (newTotal > quota.maxSiteBytes) return c.json({ error: 'site_too_large', message: `总大小超过 ${(quota.maxSiteBytes / 1024 / 1024).toFixed(0)}MB 上限` }, 413);
  const ct = (body.contentType && /^[\w/-]+$/.test(body.contentType)) ? body.contentType : guessType(path);
  await kv.put(SITE_PREFIX(slug) + path, b64ToBytes(content), { metadata: { contentType: ct, size: sz } });
  // 覆盖已有文件：文件数不变；写到新路径：文件数 +1
  const newCount = oldMeta ? (row.file_count || 0) : (row.file_count || 0) + 1;
  const newStatus = newCount > 0 ? 'published' : 'draft';
  await db.prepare("UPDATE sites SET size_bytes = ?, file_count = ?, status = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(newTotal, newCount, newStatus, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', newStatus);
  return c.json({ ok: true, size_bytes: newTotal, file_count: newCount, contentType: ct });
});

// 删除单个文件（通配路径）
app.delete('/api/sites/:slug/files/*', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  // 注意：本版本 Hono 的 c.req.param('*') 通配符捕获失效，改从 URL pathname 切片取值
  const up = new URL(c.req.url);
  const fprefix = '/api/sites/' + slug + '/files/';
  const path = up.pathname.startsWith(fprefix) ? decodeURIComponent(up.pathname.slice(fprefix.length)) : '';
  if (!path || path.includes('..') || path.startsWith('__status')) return c.json({ error: 'bad_path' }, 400);
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  const key = SITE_PREFIX(slug) + path;
  const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
  const meta = (listed.keys || []).find((k) => k.name === key);
  const sz = (meta && meta.metadata && meta.metadata.size) || 0;
  await kv.delete(key);
  const newCount = Math.max(0, (row.file_count || 0) - 1);
  const newBytes = Math.max(0, (row.size_bytes || 0) - sz);
  const newStatus = newCount > 0 ? row.status : 'draft';
  await db.prepare("UPDATE sites SET size_bytes = ?, file_count = ?, status = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(newBytes, newCount, newStatus, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', newStatus);
  return c.json({ ok: true, size_bytes: newBytes, file_count: newCount, status: newStatus });
});

// 重命名 / 移动文件（v4.24：站点编辑器工作台的「重命名」按钮使用）
app.post('/api/sites/:slug/rename', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const from = (body.from || '').trim();
  const to = (body.to || '').trim();
  if (!from || !to || from === to) return c.json({ error: 'bad_path' }, 400);
  if (from.includes('..') || to.includes('..') || from.startsWith('__') || to.startsWith('__')) return c.json({ error: 'bad_path' }, 400);
  if (!/^[\x20-\x7e]+$/.test(to)) return c.json({ error: 'bad_path', message: '路径仅支持 ASCII' }, 400);
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'suspended') return c.json({ error: 'suspended', message: '站点已被封禁，无法修改内容。' }, 403);
  const fromKey = SITE_PREFIX(slug) + from;
  const toKey = SITE_PREFIX(slug) + to;
  const meta = await kv.get(fromKey, { metadata: 'json' }); // 单独读 metadata（与 value 分两次，避免组合丢值）
  const raw = await kv.get(fromKey, { type: 'arrayBuffer' });
  const buf = (raw && raw.value !== undefined) ? raw.value : raw; // {type:'arrayBuffer'} 返回裸 ArrayBuffer
  if (!buf) return c.json({ error: 'not_found' }, 404);
  const m = (meta && meta.metadata) ? meta.metadata : { contentType: guessType(to), size: buf.byteLength };
  await kv.put(toKey, buf, { metadata: m });
  await kv.delete(fromKey);
  return c.json({ ok: true, from, to });
});

// 删除整个站点
app.delete('/api/sites/:slug', async (c) => {
  const db = c.env.db;
  const kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
  for (const k of (listed.keys || [])) { try { await kv.delete(k.name); } catch { /* ignore */ } }
  await db.prepare('DELETE FROM sites WHERE slug = ?').bind(slug).run();
  return c.json({ ok: true });
});

// 发布 / 下架（拥有者）
app.post('/api/sites/:slug/publish', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'suspended') return c.json({ error: 'suspended', message: '站点已被封禁，无法发布。如有异议请通过工单申诉。' }, 403);
  if ((row.file_count || 0) === 0) return c.json({ error: 'no_files', message: '请先上传文件再发布' }, 400);
  // v4.27：全局站点托管禁用 + 单用户托管禁用
  const sdf = await db.prepare("SELECT value FROM site_settings WHERE key='disabled_features'").first();
  if (parseInt(sdf?.value || '0', 10) & DF_SITE) return c.json({ error: 'sites_disabled', message: '站点托管功能已临时关闭' }, 503);
  if (await isUserFeatureDisabled(db, identity.userId, DF_SITE)) return c.json({ error: 'your_sites_disabled', message: '你的站点托管功能已被管理员关闭' }, 403);
  await db.prepare("UPDATE sites SET status = 'published', updated_at = datetime('now') WHERE slug = ?").bind(slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', 'published');
  // v4.26 2.3：发布时自动留一份快照；超配额则删除最旧的自动快照（保留手动快照）
  try {
    const limit = await snapshotQuotaOf(db, identity);
    await createSnapshot(kv, slug, '', 1);
    const idxRaw = await kv.get(SNAP_INDEX(slug));
    let idx = idxRaw ? JSON.parse(idxRaw) : [];
    while (idx.length > limit) {
      const old = idx[idx.length - 1];
      if (!old || !old.auto) break;
      const snapList = await kv.list({ prefix: SNAP_DIR(slug, old.v), limit: 1000 });
      for (const k of (snapList.keys || [])) { try { await kv.delete(k.name); } catch { /* ignore */ } }
      idx = idx.filter((x) => x.v !== old.v);
    }
    await kv.put(SNAP_INDEX(slug), JSON.stringify(idx));
  } catch { /* 快照失败不影响发布 */ }
  return c.json({ ok: true, status: 'published' });
});
app.post('/api/sites/:slug/unpublish', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  await db.prepare("UPDATE sites SET status = 'draft', updated_at = datetime('now') WHERE slug = ?").bind(slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', 'draft');
  return c.json({ ok: true, status: 'draft' });
});

// 管理员封禁 / 解封站点（滥用治理）
app.post('/api/sites/:slug/suspend', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  if (!(await hasAdminPerm(db, identity, 'ban_sites'))) return c.json({ error: 'forbidden', message: '无封禁站点权限（需 ban_sites）' }, 403);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  let reason = '';
  try { const b = await c.req.json(); reason = (b?.reason || '').toString().slice(0, 200); } catch { /* 无 body 也可封禁 */ }
  if (!reason) reason = '违反站点托管规范';
  await db.prepare("UPDATE sites SET status = 'suspended', suspend_reason = ?, updated_at = datetime('now') WHERE slug = ?").bind(reason, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', 'suspended');
  // 通知站长
  try {
    await createNotification(db, row.owner_id, 'site',
      '⛔ 你的站点 ' + slug + ' 已被下架',
      '原因：' + reason + '。如有异议请通过工单申诉。',
      '/sites/' + slug);
  } catch { /* 通知失败不影响主流程 */ }
  return c.json({ ok: true, status: 'suspended', reason });
});
app.post('/api/sites/:slug/unsuspend', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  if (!(await hasAdminPerm(db, identity, 'ban_sites'))) return c.json({ error: 'forbidden', message: '无解封站点权限（需 ban_sites）' }, 403);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const status = (row.file_count || 0) > 0 ? 'published' : 'draft';
  await db.prepare("UPDATE sites SET status = ?, suspend_reason = NULL, updated_at = datetime('now') WHERE slug = ?").bind(status, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', status);
  try {
    await createNotification(db, row.owner_id, 'site',
      '✅ 你的站点 ' + slug + ' 已恢复',
      '站点已解除封禁，可正常访问。',
      '/sites/' + slug);
  } catch { /* 通知失败不影响主流程 */ }
  return c.json({ ok: true, status });
});

// ========== v4.20：管理后台「站点管理」 ==========
// 列表：全站站点 + 站长信息 + 待处理举报数；支持封禁/解封/删除。

app.get('/api/admin/sites', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_sites'))) return c.json({ error: 'forbidden', message: '无查看站点权限（需 view_sites）' }, 403);
  const q = (c.req.query('q') || '').trim();
  const status = (c.req.query('status') || '').trim();
  const where = [], binds = [];
  if (q) { where.push('(s.slug LIKE ? OR s.title LIKE ? OR u.username LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (status) { where.push('s.status = ?'); binds.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT s.slug, s.title, s.status, s.owner_id, s.file_count, s.size_bytes, s.suspend_reason, s.created_at, s.updated_at,
            u.username AS owner_name, u.display_name AS owner_display,
            (SELECT COUNT(*) FROM tickets tk WHERE tk.category='report' AND tk.related_site_slug = s.slug AND tk.status IN ('open','reviewing')) AS report_count
     FROM sites s LEFT JOIN users u ON u.id = s.owner_id
     ${whereSql} ORDER BY s.updated_at DESC LIMIT 100`
  ).bind(...binds).all();
  const sites = (rows.results || []).map((r) => ({ ...r, url: SITES_HOST + '/' + r.slug }));
  // v4.24：附上托管侧访问统计（最终一致；失败不影响列表）
  const kv = c.env.SITE_KV;
  if (kv) {
    await Promise.all(sites.map(async (s) => {
      try {
        const raw = await kv.get(SITE_PREFIX(s.slug) + '__stats');
        const o = raw ? JSON.parse(raw) : null;
        s.visits = { total: (o && o.total) || 0, days: (o && o.days) || {} };
      } catch { s.visits = { total: 0, days: {} }; }
    }));
  }
  return c.json({ sites });
});

app.delete('/api/admin/sites/:slug', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'delete_sites'))) return c.json({ error: 'forbidden', message: '无删除站点权限（需 delete_sites）' }, 403);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT slug, owner_id FROM sites WHERE slug = ?').bind(slug).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (kv) {
    try {
      const listed = await kv.list({ prefix: SITE_PREFIX(slug) });
      for (const k of (listed.keys || [])) { try { await kv.delete(k.name); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  }
  await db.prepare('DELETE FROM sites WHERE slug = ?').bind(slug).run();
  try {
    await createNotification(db, row.owner_id, 'site',
      '🗑 你的站点 ' + slug + ' 已被管理员删除',
      '如有异议请通过工单申诉。', '/sites');
  } catch { /* ignore */ }
  return c.json({ ok: true });
});

// ========== v4.26：2.3 站点版本快照 + 配额 ==========

// 快照配额：NULL=按 VIP 派生（普通 3 / VIP 5），否则用管理员单独设置的值
function snapshotQuotaForRow(u) {
  if (u && u.snapshot_quota != null && u.snapshot_quota !== '') return Math.max(0, parseInt(u.snapshot_quota, 10) || 0);
  return isVipActive(u) ? 5 : 3;
}
async function snapshotQuotaOf(db, identity) {
  const u = await db.prepare('SELECT snapshot_quota, is_vip, vip_until FROM users WHERE id = ?').bind(String(identity.userId)).first();
  return snapshotQuotaForRow(u);
}
const SNAP_INDEX = (slug) => SITE_PREFIX(slug) + '__snapshots/__index';
const SNAP_DIR = (slug, v) => SITE_PREFIX(slug) + '__snapshots/' + v + '/';

// 取当前站点真实文件（排除 __status / __stats / __snapshots）
async function listSiteFiles(kv, slug) {
  const listed = await kv.list({ prefix: SITE_PREFIX(slug), limit: 1000 });
  return (listed.keys || []).filter((k) => {
    const p = k.name.slice(SITE_PREFIX(slug).length);
    return p && !p.startsWith('__') && !k.name.endsWith('/');
  });
}
async function readKVBytes(kv, name) {
  const raw = await kv.get(name, { type: 'arrayBuffer' });
  return (raw && raw.value !== undefined) ? raw.value : raw;
}
async function readKVMeta(kv, name) {
  const r = await kv.get(name, { metadata: true });
  return (r && r.metadata) || {};
}

// 创建快照：把当前站点文件复制到 __snapshots/{v}/
async function createSnapshot(kv, slug, label, auto) {
  const files = await listSiteFiles(kv, slug);
  const idxRaw = await kv.get(SNAP_INDEX(slug));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  const nextV = (idx.reduce((a, b) => Math.max(a, b.v), 0) || 0) + 1;
  let size = 0;
  for (const k of files) {
    const path = k.name.slice(SITE_PREFIX(slug).length);
    const buf = await readKVBytes(kv, k.name);
    const meta = await readKVMeta(kv, k.name);
    await kv.put(SNAP_DIR(slug, nextV) + path, buf, { metadata: meta });
    size += (meta && meta.size) || (buf && buf.byteLength) || 0;
  }
  const filesList = files.map((k) => k.name.slice(SITE_PREFIX(slug).length));
  const meta = {
    v: nextV,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    label: label || (auto ? '自动快照 #' + nextV : '快照 #' + nextV),
    size, files: files.length, filesList, auto: auto ? 1 : 0
  };
  idx.unshift(meta);
  await kv.put(SNAP_INDEX(slug), JSON.stringify(idx));
  return meta;
}

// 手动保存快照
app.post('/api/sites/:slug/snapshots', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'suspended') return c.json({ error: 'suspended' }, 403);
  const limit = await snapshotQuotaOf(db, identity);
  const idxRaw = await kv.get(SNAP_INDEX(slug));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  if (idx.length >= limit) return c.json({ error: 'snapshot_limit', message: `快照已达上限（${limit} 份），请先删除旧快照`, limit }, 413);
  let label = '';
  try { const b = await c.req.json(); label = (b.label || '').toString().slice(0, 60); } catch { /* 可无 body */ }
  const meta = await createSnapshot(kv, slug, label, 0);
  return c.json({ ok: true, snapshot: meta });
});

// 列出快照 + 配额
app.get('/api/sites/:slug/snapshots', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const slug = c.req.param('slug');
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  const limit = await snapshotQuotaOf(db, identity);
  const idxRaw = await kv.get(SNAP_INDEX(slug));
  const snapshots = idxRaw ? JSON.parse(idxRaw) : [];
  return c.json({ limit, used: snapshots.length, snapshots });
});

// 回滚到某快照（精确还原：删除现存真实文件，再写回快照文件）
app.post('/api/sites/:slug/snapshots/:v/restore', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const v = parseInt(c.req.param('v'), 10);
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'suspended') return c.json({ error: 'suspended' }, 403);
  const idxRaw = await kv.get(SNAP_INDEX(slug));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  const meta = idx.find((x) => x.v === v);
  if (!meta) return c.json({ error: 'snapshot_not_found' }, 404);
  // 删除当前真实文件
  const live = await listSiteFiles(kv, slug);
  for (const k of live) { try { await kv.delete(k.name); } catch { /* ignore */ } }
  // 写回快照文件（按快照索引里记录的精确路径读取，绕开 kv.list 的最终一致性延迟）
  let filesList = (meta.filesList && meta.filesList.length) ? meta.filesList : null;
  if (!filesList) {
    const snapList = await kv.list({ prefix: SNAP_DIR(slug, v), limit: 1000 });
    filesList = (snapList.keys || []).filter((k) => !k.name.endsWith('/') && !k.name.endsWith('__meta')).map((k) => k.name.slice(SNAP_DIR(slug, v).length));
  }
  let restored = 0;
  for (const path of filesList) {
    const buf = await readKVBytes(kv, SNAP_DIR(slug, v) + path);
    if (!buf) continue; // 跳过读取失败的文件，避免写出空文件导致站点损坏
    const m = await readKVMeta(kv, SNAP_DIR(slug, v) + path);
    await kv.put(SITE_PREFIX(slug) + path, buf, { metadata: m });
    restored++;
  }
  await db.prepare('UPDATE sites SET size_bytes = ?, file_count = ?, updated_at = datetime(\'now\') WHERE slug = ?').bind(meta.size || 0, meta.files || 0, slug).run();
  await kv.put(SITE_PREFIX(slug) + '__status', row.status === 'published' ? 'published' : 'draft');
  return c.json({ ok: true, size_bytes: meta.size || 0, file_count: meta.files || 0 });
});

// 删除某快照
app.delete('/api/sites/:slug/snapshots/:v', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  const slug = c.req.param('slug');
  const v = parseInt(c.req.param('v'), 10);
  const row = await db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row || String(row.owner_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  const idxRaw = await kv.get(SNAP_INDEX(slug));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  const newIdx = idx.filter((x) => x.v !== v);
  if (newIdx.length === idx.length) return c.json({ error: 'snapshot_not_found' }, 404);
  const filesList = (meta.filesList && meta.filesList.length) ? meta.filesList : [];
  for (const path of filesList) { try { await kv.delete(SNAP_DIR(slug, v) + path); } catch { /* ignore */ } }
  await kv.put(SNAP_INDEX(slug), JSON.stringify(newIdx));
  return c.json({ ok: true, limit: await snapshotQuotaOf(db, identity), used: newIdx.length });
});

// 管理员单人设置快照配额
app.post('/api/admin/users/:id/snapshot-quota', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'manage_snapshot_quota'))) return c.json({ error: 'forbidden', message: '需 manage_snapshot_quota 权限' }, 403);
  const id = c.req.param('id');
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const q = body.quota;
  if (q === null || q === undefined || q === '') {
    await db.prepare('UPDATE users SET snapshot_quota = NULL WHERE id = ?').bind(id).run();
    return c.json({ ok: true, quota: null });
  }
  const n = parseInt(q, 10);
  if (isNaN(n) || n < 0 || n > 50) return c.json({ error: 'bad_quota' }, 400);
  await db.prepare('UPDATE users SET snapshot_quota = ? WHERE id = ?').bind(n, id).run();
  return c.json({ ok: true, quota: n });
});

// 管理员批量设置快照配额：scope = all | vip | normal |（ids 数组精确指定）
app.post('/api/admin/users/snapshot-quota', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'manage_snapshot_quota'))) return c.json({ error: 'forbidden', message: '需 manage_snapshot_quota 权限' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const n = parseInt(body.quota, 10);
  if (isNaN(n) || n < 0 || n > 50) return c.json({ error: 'bad_quota' }, 400);
  const scope = body.scope || 'ids';
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => parseInt(x, 10)).filter((x) => x) : [];
  let count = 0;
  if (scope === 'all') {
    const r = await db.prepare('UPDATE users SET snapshot_quota = ?').bind(n).run(); count = r.meta.changes || 0;
  } else if (scope === 'vip') {
    const r = await db.prepare("UPDATE users SET snapshot_quota = ? WHERE is_vip = 1 AND (vip_until IS NULL OR vip_until > datetime('now'))").bind(n).run(); count = r.meta.changes || 0;
  } else if (scope === 'normal') {
    const r = await db.prepare("UPDATE users SET snapshot_quota = ? WHERE NOT (is_vip = 1 AND (vip_until IS NULL OR vip_until > datetime('now')))").bind(n).run(); count = r.meta.changes || 0;
  } else if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const r = await db.prepare('UPDATE users SET snapshot_quota = ? WHERE id IN (' + ph + ')').bind(n, ...ids).run(); count = r.meta.changes || 0;
  }
  return c.json({ ok: true, scope, quota: n, affected: count });
});

// ========== v4.26：2.4 聊天增强 ==========
const CHAT_FILE_MAX = 5 * 1024 * 1024; // 单附件上限 5MB

// 上传聊天附件（base64）→ KV，返回可访问 URL
app.post('/api/chat/upload', async (c) => {
  const db = c.env.db, kv = c.env.SITE_KV;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  if (!kv) return c.json({ error: 'kv_unbound' }, 500);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const convId = parseInt(body.conv_id, 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const name = (body.name || 'file').toString().slice(0, 120);
  const type = (body.type || 'application/octet-stream').toString().slice(0, 120);
  const data = String(body.data || '');
  const bytes = b64DecodedLen(data);
  if (!bytes) return c.json({ error: 'empty' }, 400);
  if (bytes > CHAT_FILE_MAX) return c.json({ error: 'too_large', max: CHAT_FILE_MAX }, 413);
  const id = 'cf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await kv.put('chat_files/' + id, b64ToBytes(data), { metadata: { name, type, size: bytes, conv_id: convId, uploader: String(identity.userId) } });
  return c.json({ ok: true, id, url: '/api/chat/files/' + id, name, type, size: bytes });
});

// 取聊天附件（图片 inline，其余下载）
app.get('/api/chat/files/:id', async (c) => {
  const kv = c.env.SITE_KV;
  if (!kv) return c.text('kv_unbound', 500);
  const id = c.req.param('id');
  const raw = await kv.get('chat_files/' + id, { type: 'arrayBuffer' });
  const meta = await kv.get('chat_files/' + id, { metadata: true });
  const buf = (raw && raw.value !== undefined) ? raw.value : raw;
  if (!buf) return c.text('not found', 404);
  const m = (meta && meta.metadata) || {};
  const headers = { 'Content-Type': m.type || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' };
  if ((m.type || '').startsWith('image/')) headers['Content-Disposition'] = 'inline';
  else headers['Content-Disposition'] = 'attachment; filename="' + encodeURIComponent(m.name || 'file') + '"';
  return new Response(buf, { status: 200, headers });
});

// 撤回消息（发送者本人、2 分钟内）
app.post('/api/chat/conversations/:id/messages/:mid/recall', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const mid = parseInt(c.req.param('mid'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const msg = await db.prepare('SELECT id, sender_id, created_at FROM chat_messages WHERE id = ? AND conv_id = ?').bind(mid, convId).first();
  if (!msg) return c.json({ error: 'not_found' }, 404);
  if (String(msg.sender_id) !== String(identity.userId)) return c.json({ error: 'not_sender' }, 403);
  const ts = new Date(String(msg.created_at).replace(' ', 'T') + 'Z').getTime();
  if (Date.now() - ts > 2 * 60 * 1000) return c.json({ error: 'too_late', message: '超过 2 分钟，无法撤回' }, 403);
  await db.prepare("UPDATE chat_messages SET recalled = 1, content = '' WHERE id = ?").bind(mid).run();
  await chatBumpVersion(c.env.SITE_KV, Number(msg.conv_id)); // v4.30：撤回后失效缓存
  return c.json({ ok: true });
});

// 群公告 / 群头像（仅群主、非总群）
app.post('/api/chat/groups/:id/announcement', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const conv = await db.prepare('SELECT id, type, is_global, owner_id FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv || conv.type !== 'group' || conv.is_global) return c.json({ error: 'not_allowed' }, 400);
  if (member.role !== 'owner' && conv.owner_id !== identity.userId) return c.json({ error: 'not_owner' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const announcement = String(body.announcement || '').slice(0, 500);
  await db.prepare('UPDATE chat_conversations SET announcement = ? WHERE id = ?').bind(announcement, convId).run();
  return c.json({ ok: true, announcement });
});
app.post('/api/chat/groups/:id/avatar', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'login_required' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const member = await getChatMember(db, convId, identity.userId);
  if (!member) return c.json({ error: 'forbidden' }, 403);
  const conv = await db.prepare('SELECT id, type, is_global, owner_id FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv || conv.type !== 'group' || conv.is_global) return c.json({ error: 'not_allowed' }, 400);
  if (member.role !== 'owner' && conv.owner_id !== identity.userId) return c.json({ error: 'not_owner' }, 403);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const avatar = String(body.avatar || '').slice(0, 500);
  await db.prepare('UPDATE chat_conversations SET avatar = ? WHERE id = ?').bind(avatar, convId).run();
  return c.json({ ok: true, avatar });
});

// ========== v4.29：IP 治理 ==========

// 同 IP 聚合：近 N 天内用同一 IP 注册的账号分组
app.get('/api/admin/ip-groups', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'manage_ip'))) return c.json({ error: 'forbidden', message: '无 IP 治理权限（需 manage_ip）' }, 403);
  const days = Math.min(30, Math.max(1, parseInt(c.req.query('days') || '1', 10) || 1));
  const q = (c.req.query('q') || '').trim().slice(0, 40);
  let rows;
  try {
    rows = await db.prepare(
      `SELECT ui.ip AS ip, ui.created_at AS first_at, u.id AS id, u.username, u.display_name, u.banned, u.ban_until, u.role, u.created_at AS user_created
       FROM user_ips ui JOIN users u ON u.id = ui.user_id
       WHERE ui.created_at >= datetime('now', ?)` + (q ? ' AND ui.ip LIKE ?' : '') +
      ` ORDER BY ui.ip ASC, ui.created_at DESC LIMIT 500`
    ).bind('-' + days + ' days', ...(q ? ['%' + q + '%'] : [])).all();
  } catch (e) { return c.json({ error: 'query_failed', message: String((e && e.message) || e) }, 500); }
  const byIp = new Map();
  for (const r of (rows.results || [])) {
    if (!byIp.has(r.ip)) byIp.set(r.ip, { ip: r.ip, first_at: r.first_at, users: [] });
    const g = byIp.get(r.ip);
    // 同 IP 同账号只列一次（user_ips 可能有多行）
    if (!g.users.some((u) => String(u.id) === String(r.id))) {
      g.users.push({ id: r.id, username: r.username, display_name: r.display_name || r.username, banned: !!r.banned, ban_until: r.ban_until || null, role: r.role });
    }
  }
  const groups = [...byIp.values()].filter((g) => g.users.length > 0).sort((a, b) => b.users.length - a.users.length || String(a.ip).localeCompare(String(b.ip)));
  return c.json({ groups, days });
});

// 封禁 IP / 网段
app.post('/api/admin/ip-bans', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_ip'))) return c.json({ error: 'forbidden', message: '无 IP 治理权限（需 manage_ip）' }, 403);
  const db = c.env.db;
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const target = normalizeBanTarget(body.value);
  if (!target) return c.json({ error: 'invalid_target', message: '请输入合法的 IPv4 或网段（如 1.2.3.4 或 1.2.3.0/24）' }, 400);
  // days 支持小数；<0 视为取消永久；0 表示立即解封（删除记录）
  const daysRaw = body.days === undefined || body.days === null || body.days === '' ? null : Number(body.days);
  if (daysRaw !== null && !Number.isFinite(daysRaw)) return c.json({ error: 'invalid_days' }, 400);
  const reason = String(body.reason || '').slice(0, 200);
  if (daysRaw !== null && daysRaw <= 0) {
    await db.prepare('DELETE FROM ip_bans WHERE kind = ? AND value = ?').bind(target.kind, target.value).run();
    return c.json({ ok: true, removed: true });
  }
  // v4.32.1：自锁保护——禁止把开发者（站长）或执行者自己当前的 IP / 网段拉黑，避免运维被锁在门外
  const execIp = clientIp(c);
  let devIps = [];
  try {
    const dres = await db.prepare("SELECT DISTINCT ui.ip AS ip FROM user_ips ui JOIN users u ON u.id = ui.user_id WHERE u.role = 'developer'").all();
    devIps = (dres.results || []).map((r) => r.ip).filter((x) => ipToInt(x) !== null);
  } catch { /* 表未迁移则跳过开发者保护，不阻断正常封禁 */ }
  const hitsSelfOrDev = (kind, value) => {
    if (kind === 'ip') {
      if (execIp && value === execIp) return true;
      if (devIps.includes(value)) return true;
    } else {
      if (execIp && cidrContains(value, execIp)) return true;
      if (devIps.some((ip) => cidrContains(value, ip))) return true;
    }
    return false;
  };
  if (hitsSelfOrDev(target.kind, target.value)) {
    return c.json({ error: 'ban_self_or_dev', message: '不能封禁你自己或开发者（站长）的 IP / 网段（含覆盖其 IP 的网段）' }, 400);
  }
  const until = daysRaw === null ? null : new Date(Date.now() + daysRaw * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    `INSERT INTO ip_bans (kind, value, reason, banned_by, ban_until) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, value) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, ban_until = excluded.ban_until, banned_at = datetime('now')`
  ).bind(target.kind, target.value, reason, identity?.userId ?? null, until).run();
  return c.json({ ok: true, kind: target.kind, value: target.value, ban_until: until });
});

app.get('/api/admin/ip-bans', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_ip'))) return c.json({ error: 'forbidden', message: '无 IP 治理权限（需 manage_ip）' }, 403);
  try {
    const rows = await c.env.db.prepare('SELECT id, kind, value, reason, banned_at, ban_until FROM ip_bans ORDER BY banned_at DESC LIMIT 200').all();
    return c.json({ bans: rows.results || [] });
  } catch (e) { return c.json({ bans: [], error: String((e && e.message) || e) }, 200); }
});

// 解除某个 IP 的所有封禁（精确 IP）
app.delete('/api/admin/ip-bans/:kind/:value', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_ip'))) return c.json({ error: 'forbidden', message: '无 IP 治理权限（需 manage_ip）' }, 403);
  const kind = c.req.param('kind') === 'cidr' ? 'cidr' : 'ip';
  let value = c.req.param('value'); try { value = decodeURIComponent(value); } catch {}
  const t = normalizeBanTarget(value);
  if (!t) return c.json({ error: 'invalid_target' }, 400);
  await c.env.db.prepare('DELETE FROM ip_bans WHERE kind = ? AND value = ?').bind(kind, t.value).run();
  return c.json({ ok: true });
});

// ========== v4.29：聊天治理 ==========

// 群聊列表（私聊走 separate=1）
app.get('/api/admin/chat-conversations', async (c) => {
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(c.env.db, identity))) return c.json({ error: 'forbidden' }, 403);
  const db = c.env.db;
  const mode = c.req.query('type') === 'single' ? 'single' : 'group';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10) || 50));
  const q = (c.req.query('q') || '').trim();
  try {
    const where = ["type = ?"]; const params = [mode];
    if (q) { where.push('(name LIKE ? OR id = ?)'); params.push('%' + q + '%', parseInt(q, 10) || 0); }
    const W = where.join(' AND ');
    const total = await db.prepare(`SELECT COUNT(*) AS c FROM chat_conversations WHERE ${W}`).bind(...params).first();
    const rows = await db.prepare(
      `SELECT c.id, c.name, c.is_global, c.owner_id, c.join_mode, c.created_at, u.username AS owner_name, u.display_name AS owner_display,
              (SELECT COUNT(*) FROM chat_members m WHERE m.conv_id = c.id AND m.left = 0) AS member_count,
              (SELECT COUNT(*) FROM chat_messages msg WHERE msg.conv_id = c.id) AS msg_count,
              (SELECT MAX(created_at) FROM chat_messages msg2 WHERE msg2.conv_id = c.id) AS last_at
       FROM chat_conversations c LEFT JOIN users u ON u.id = c.owner_id
       WHERE ${W} ORDER BY c.is_global DESC, member_count DESC, c.id DESC LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all();
    return c.json({
      conversations: (rows.results || []).map((r) => ({
        id: r.id, name: r.name || (r.is_global ? '全站总群' : '群聊 #' + r.id), is_global: !!r.is_global,
        owner_id: r.owner_id, owner_name: r.owner_display || r.owner_name || '', join_mode: r.join_mode || 'open',
        member_count: r.member_count || 0, msg_count: r.msg_count || 0, last_at: r.last_at || r.created_at
      })),
      page, pageSize, total: total?.c || 0, totalPages: Math.max(1, Math.ceil((total?.c || 0) / pageSize))
    });
  } catch (e) { return c.json({ error: 'query_failed', message: String((e && e.message) || e) }, 500); }
});

// 一键删群（连同消息与成员）
app.delete('/api/admin/chat-conversations/:id', async (c) => {
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(c.env.db, identity, 'delete_user'))) return c.json({ error: 'forbidden', message: '无删除权限' }, 403);
  const db = c.env.db;
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);
  const conv = await db.prepare('SELECT id, is_global FROM chat_conversations WHERE id = ?').bind(id).first();
  if (!conv) return c.json({ error: 'not_found' }, 404);
  if (conv.is_global) return c.json({ error: 'cannot_delete_global', message: '全站总群不可删除' }, 400);
  await db.prepare('DELETE FROM chat_messages WHERE conv_id = ?').bind(id).run();
  await chatBumpVersion(c.env.SITE_KV, id); // v4.30：后台删群后失效缓存
  await db.prepare('DELETE FROM chat_members WHERE conv_id = ?').bind(id).run();
  await db.prepare('DELETE FROM chat_join_requests WHERE conv_id = ?').bind(id).run();
  await db.prepare('DELETE FROM chat_conversations WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

// ========== v4.29：群管理（管理员 / 审核 / 邀请链接）============

/** 群权限：owner / admin 可管理；返回 null 表示无权 */
async function chatGroupAdminRole(db, convId, userId) {
  if (!userId) return null;
  const m = await db.prepare('SELECT role FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(convId, String(userId)).first();
  if (m && (m.role === 'owner' || m.role === 'admin')) return m.role;
  const conv = await db.prepare('SELECT owner_id FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (conv && String(conv.owner_id) === String(userId)) return 'owner';
  return null;
}

// 群详情（含我在其中的角色、成员、待审列表）
app.get('/api/chat/conversations/:id/manage', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const conv = await db.prepare('SELECT id, type, name, owner_id, is_global, join_mode, invite_code FROM chat_conversations WHERE id = ?').bind(convId).first();
  if (!conv) return c.json({ error: 'not_found' }, 404);
  const myRole = await chatGroupAdminRole(db, convId, identity.userId);
  const isMember = !!(await db.prepare('SELECT 1 AS x FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(convId, String(identity.userId)).first());
  if (conv.type !== 'group') return c.json({ error: 'not_group' }, 400);
  if (!isMember && !myRole) return c.json({ error: 'not_member' }, 403);

  const members = await db.prepare(
    `SELECT m.user_id, m.role, m.joined_at, u.username, u.display_name, u.tag
     FROM chat_members m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.conv_id = ? AND m.left = 0 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.user_id ASC LIMIT 200`
  ).bind(convId).all();

  let requests = [];
  if (myRole) {
    const rq = await db.prepare(
      `SELECT r.id, r.user_id, r.created_at, u.username, u.display_name, u.tag
       FROM chat_join_requests r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.conv_id = ? AND r.status = 'pending' ORDER BY r.created_at ASC LIMIT 100`
    ).bind(convId).all();
    requests = rq.results || [];
  }
  return c.json({
    conv: {
      id: conv.id, name: conv.name, owner_id: conv.owner_id, is_global: !!conv.is_global,
      join_mode: conv.join_mode || 'open', invite_code: conv.invite_code || null
    },
    my_role: myRole, is_member: isMember,
    members: (members.results || []).map((m) => ({ user_id: m.user_id, role: m.role, username: m.username, display_name: m.display_name || m.username, tag: m.tag || '', joined_at: m.joined_at })),
    requests: requests.map((r) => ({ id: r.id, user_id: r.user_id, username: r.username, display_name: r.display_name || r.username, tag: r.tag || '', created_at: r.created_at }))
  });
});

// 设置成员角色（owner/admin 才有权；群主才能任命/撤销 admin）
app.post('/api/chat/conversations/:id/members/:userId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const targetId = parseInt(c.req.param('userId'), 10);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const role = String(body.role || '');
  if (!['member', 'admin'].includes(role)) return c.json({ error: 'bad_role', message: 'role 只能是 member 或 admin' }, 400);
  const myRole = await chatGroupAdminRole(db, convId, identity.userId);
  if (!myRole) return c.json({ error: 'forbidden' }, 403);
  // 只有 owner 能任免 admin；admin 只能管普通成员
  if (myRole !== 'owner' && role === 'admin') return c.json({ error: 'forbidden', message: '仅群主可设置管理员' }, 403);
  const target = await db.prepare('SELECT role FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(convId, String(targetId)).first();
  if (!target) return c.json({ error: 'not_member' }, 404);
  if (target.role === 'owner') return c.json({ error: 'cannot_change_owner', message: '不能修改群主角色' }, 400);
  if (myRole !== 'owner' && target.role === 'admin') return c.json({ error: 'forbidden', message: '仅群主可任免管理员' }, 403);
  await db.prepare('UPDATE chat_members SET role = ? WHERE conv_id = ? AND user_id = ?').bind(role, convId, String(targetId)).run();
  return c.json({ ok: true, user_id: targetId, role });
});

// 移出成员（owner/admin 可踢；admin 不能踢 admin/owner）
app.delete('/api/chat/conversations/:id/members/:userId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const targetId = parseInt(c.req.param('userId'), 10);
  const myRole = await chatGroupAdminRole(db, convId, identity.userId);
  if (!myRole) return c.json({ error: 'forbidden' }, 403);
  const target = await db.prepare('SELECT role FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(convId, String(targetId)).first();
  if (!target) return c.json({ error: 'not_member' }, 404);
  if (target.role === 'owner') return c.json({ error: 'cannot_kick_owner' }, 400);
  if (myRole !== 'owner' && target.role === 'admin') return c.json({ error: 'forbidden', message: '仅群主可移出管理员' }, 403);
  await db.prepare('UPDATE chat_members SET left = 1 WHERE conv_id = ? AND user_id = ?').bind(convId, String(targetId)).run();
  return c.json({ ok: true });
});

// 群设置：入群审核开关 / 重置邀请码
app.post('/api/chat/conversations/:id/settings', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const myRole = await chatGroupAdminRole(db, convId, identity.userId);
  if (!myRole) return c.json({ error: 'forbidden' }, 403);
  if (body.join_mode !== undefined) {
    const jm = String(body.join_mode);
    if (!['open', 'approval'].includes(jm)) return c.json({ error: 'bad_join_mode' }, 400);
    await db.prepare('UPDATE chat_conversations SET join_mode = ? WHERE id = ?').bind(jm, convId).run();
  }
  if (body.reset_invite === true) {
    const code = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    await db.prepare('UPDATE chat_conversations SET invite_code = ? WHERE id = ?').bind(code, convId).run();
    return c.json({ ok: true, invite_code: code });
  }
  const row = await db.prepare('SELECT join_mode, invite_code FROM chat_conversations WHERE id = ?').bind(convId).first();
  return c.json({ ok: true, join_mode: row?.join_mode || 'open', invite_code: row?.invite_code || null });
});

// 通过邀请链接主动加入：GET 先看群信息，POST 提交加入
app.get('/api/chat/invite/:code', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  const code = String(c.req.param('code') || '').trim();
  const conv = await db.prepare('SELECT id, name, is_global, join_mode FROM chat_conversations WHERE invite_code = ?').bind(code).first();
  if (!conv) return c.json({ error: 'invalid_code', message: '邀请链接无效或已失效' }, 404);
  let isMember = false, pending = false;
  if (identity?.type === 'user') {
    isMember = !!(await db.prepare('SELECT 1 AS x FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(conv.id, String(identity.userId)).first());
    if (!isMember) pending = !!(await db.prepare("SELECT 1 AS x FROM chat_join_requests WHERE conv_id = ? AND user_id = ? AND status = 'pending'").bind(conv.id, String(identity.userId)).first());
  }
  return c.json({ conv: { id: conv.id, name: conv.name, is_global: !!conv.is_global, join_mode: conv.join_mode || 'open' }, is_member: isMember, pending, logged_in: identity?.type === 'user' });
});

app.post('/api/chat/invite/:code', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized', message: '请先登录' }, 401);
  const code = String(c.req.param('code') || '').trim();
  const conv = await db.prepare('SELECT id, name, join_mode, is_global FROM chat_conversations WHERE invite_code = ?').bind(code).first();
  if (!conv) return c.json({ error: 'invalid_code', message: '邀请链接无效或已失效' }, 404);
  const exists = await db.prepare('SELECT 1 AS x FROM chat_members WHERE conv_id = ? AND user_id = ? AND left = 0').bind(conv.id, String(identity.userId)).first();
  if (exists) return c.json({ ok: true, status: 'already_member' });
  // 需要审核：记申请，等群主/管理员处理
  if ((conv.join_mode || 'open') === 'approval') {
    try {
      await db.prepare("INSERT INTO chat_join_requests (conv_id, user_id, status) VALUES (?, ?, 'pending') ON CONFLICT(conv_id, user_id) DO UPDATE SET status = 'pending', created_at = datetime('now')").bind(conv.id, identity.userId).run();
    } catch {
      await db.prepare("INSERT OR REPLACE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(conv.id, identity.userId).run();
      return c.json({ ok: true, status: 'joined' });
    }
    return c.json({ ok: true, status: 'pending', message: '已提交申请，等待群主或管理员审核' });
  }
  await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(conv.id, identity.userId).run();
  await db.prepare("UPDATE chat_members SET left = 0 WHERE conv_id = ? AND user_id = ?").bind(conv.id, identity.userId).run();
  return c.json({ ok: true, status: 'joined', conv_id: conv.id });
});

// 处理入群申请：approve / reject（owner 或 admin 均可，和微信群管一致）
app.post('/api/chat/conversations/:id/requests/:reqId', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity?.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const convId = parseInt(c.req.param('id'), 10);
  const reqId = parseInt(c.req.param('reqId'), 10);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const action = String(body.action || '');
  if (!['approve', 'reject'].includes(action)) return c.json({ error: 'bad_action' }, 400);
  const myRole = await chatGroupAdminRole(db, convId, identity.userId);
  if (!myRole) return c.json({ error: 'forbidden', message: '仅群主或管理员可审核' }, 403);
  const rq = await db.prepare("SELECT id, user_id FROM chat_join_requests WHERE id = ? AND conv_id = ? AND status = 'pending'").bind(reqId, convId).first();
  if (!rq) return c.json({ error: 'not_found' }, 404);
  if (action === 'approve') {
    await db.prepare("INSERT OR IGNORE INTO chat_members (conv_id, user_id, role) VALUES (?, ?, 'member')").bind(convId, rq.user_id).run();
    await db.prepare("UPDATE chat_members SET left = 0 WHERE conv_id = ? AND user_id = ?").bind(convId, rq.user_id).run();
  }
  await db.prepare("UPDATE chat_join_requests SET status = ?, handled_at = datetime('now'), handled_by = ? WHERE id = ?").bind(action === 'approve' ? 'approved' : 'rejected', identity.userId, reqId).run();
  return c.json({ ok: true, action, user_id: rq.user_id });
});

// ========== v4.31：配额治理后台 API ==========
// 查看当前 D1 / KV 额度进度（估算值，见quotaGet 上方说明）
app.get('/api/admin/quota', async (c) => {
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(c.env.db, identity))) return c.json({ error: 'forbidden' }, 403);
  const q = await quotaGet(c.env.SITE_KV, c.env.db);
  // 仅站长（developer）可修改额度上限
  q.can_edit_limits = await hasAdminPerm(c.env.db, identity, 'manage_quota');
  return c.json({ ...q, trip_threshold: QUOTA_TRIP_RATIO });
});

// 修改额度上限（**仅站长 developer**，普通管理员无权）
app.post('/api/admin/quota/limits', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  if (!(await hasAdminPerm(db, identity, 'manage_quota'))) {
    return c.json({ error: 'forbidden', message: '无配额管理权限（需 manage_quota）' }, 403);
  }
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const next = {};
  for (const k of ['d1', 'kv']) {
    if (body[k] === undefined || body[k] === null || body[k] === '') continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n <= 0) {
      return c.json({ error: 'invalid_limit', message: k.toUpperCase() + ' 额度必须是大于 0 的数字' }, 400);
    }
    if (n > 1_000_000_000) {
      return c.json({ error: 'too_large', message: '额度上限似乎过大（>10 亿），请确认' }, 400);
    }
    next[k] = Math.floor(n);
  }
  if (!Object.keys(next).length) {
    return c.json({ error: 'nothing_to_update', message: '没有提供有效的额度值' }, 400);
  }
  const cur = await quotaLimits(c.env.SITE_KV);
  const merged = {
    d1: next.d1 ?? cur.d1,
    kv: next.kv ?? cur.kv,
    updated_at: Date.now(),
    updated_by: identity.userId
  };
  try {
    await c.env.SITE_KV.put('quota_limits', JSON.stringify(merged));
  } catch {
    return c.json({ error: 'kv_write_failed', message: 'KV 写入失败，无法保存额度设置' }, 500);
  }
  // 立刻重算刹车状态：改完上限后如果已经超过阈值，应当放行而不是继续关着
  _quotaState.trip = 0;
  const q = await quotaGet(c.env.SITE_KV, c.env.db);
  if (q.worst >= QUOTA_TRIP_RATIO) {
    await quotaAutoTrip(c.env.SITE_KV, c.env.db);
  } else {
    try { await c.env.SITE_KV.delete('chat_autodisable'); } catch {}
  }
  const after = await quotaGet(c.env.SITE_KV, c.env.db);
  return c.json({ ok: true, limits: after.limits, tripped: after.tripped });
});

// 恢复为Cloudflare 默认额度
app.post('/api/admin/quota/limits/reset', async (c) => {
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(c.env.db, identity))) return c.json({ error: 'forbidden' }, 403);
  if (!(await hasAdminPerm(c.env.db, identity, 'manage_quota'))) return c.json({ error: 'forbidden', message: '无配额管理权限（需 manage_quota）' }, 403);
  try { await c.env.SITE_KV.delete('quota_limits'); } catch {}
  _quotaState.trip = 0;
  const after = await quotaGet(c.env.SITE_KV, c.env.db);
  return c.json({ ok: true, limits: after.limits, message: '已恢复为 Cloudflare 默认额度' });
});

// 手动恢复聊天（清除自动刹车标记）——管理员点了就立刻放行
app.post('/api/admin/quota/reset-trip', async (c) => {
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(c.env.db, identity))) return c.json({ error: 'forbidden' }, 403);
  _quotaState.trip = 0;
  try { await c.env.SITE_KV.delete('quota_tripped'); await c.env.SITE_KV.delete('chat_autodisable'); } catch {}
  return c.json({ ok: true, message: '已恢复聊天功能。注意：配额若仍高于阈值，稍后会再次自动关闭。' });
});

// 手动清零当日计数（用于压测后重置统计，不影响真实配额）
app.post('/api/admin/quota/reset-counter', async (c) => {
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(c.env.db, identity))) return c.json({ error: 'forbidden' }, 403);
  const day = quotaDayKey();
  try { await c.env.SITE_KV.put('quota:' + day, JSON.stringify({ d1: 0, kv: 0, day }), { expirationTtl: 259_200 }); } catch {}
  _quotaState._pending = { d1: 0, kv: 0 };
  _quotaState.day = ''; // 触发下次 flush 重新归零
  return c.json({ ok: true });
});

// ========== v4.34: 版本历史 + 数据导出（兑现 BENEFITS 里挂着的权益） ==========
app.get('/api/clips/:clipId/versions', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const identity = await getIdentity(c);
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);
  const mine = canWrite(identity, r) || await isAdminIdentity(db, identity);
  if (!mine) return c.json({ error: 'forbidden' }, 403);
  const trustBase = identity.type === 'user' ? await buildTrustBase(db, identity.userId) : null;
  const ben = await resolveBenefits(db, identity, trustBase);
  const limit = Number(ben.benefits?.revisions) || 0;
  if (limit === 0) return c.json({ versions: [], limit: 0, message: '当前等级没有版本历史权益' });
  try {
    const rows = await db.prepare(
      'SELECT id, title, content, tags, saved_by, created_at FROM clip_versions WHERE clip_id = ? ORDER BY id DESC LIMIT 100'
    ).bind(clipId).all();
    return c.json({ versions: rows.results || [], limit });
  } catch (_) {
    return c.json({ versions: [], limit, message: '版本历史尚未初始化' });
  }
});

app.post('/api/clips/:clipId/restore', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);
  const mine = canWrite(identity, r) || await isAdminIdentity(db, identity);
  if (!mine) return c.json({ error: 'forbidden' }, 403);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const vid = parseInt(body.version_id, 10);
  if (!vid) return c.json({ error: 'bad_version' }, 400);
  let v = null;
  try { v = await db.prepare('SELECT * FROM clip_versions WHERE id = ? AND clip_id = ?').bind(vid, clipId).first(); } catch (_) {}
  if (!v) return c.json({ error: 'version_not_found' }, 404);
  // 回滚前先把当前状态也存一份，防止反悔
  try {
    await db.prepare('INSERT INTO clip_versions (clip_id, title, content, tags, saved_by) VALUES (?, ?, ?, ?, ?)')
      .bind(clipId, r.title || '', r.content || '', r.tags || '', identity.type === 'user' ? String(identity.userId) : 'guest').run();
  } catch (_) {}
  await db.prepare('UPDATE clipboards SET title = ?, content = ?, tags = ?, updated_at = datetime(\'now\') WHERE clip_id = ?')
    .bind(v.title || '', v.content || '', v.tags || '', clipId).run();
  return c.json({ ok: true, clip_id: clipId, title: v.title || '' });
});

app.get('/api/me/export', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const trustBase = await buildTrustBase(db, identity.userId);
  const ben = await resolveBenefits(db, identity, trustBase);
  if (!ben.benefits.export_data) return c.json({ error: 'forbidden', message: 'L1 或 VIP 才能导出全部数据' }, 403);
  const rows = await db.prepare(
    'SELECT clip_id, title, content, tags, is_public, created_at, updated_at FROM clipboards WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC'
  ).bind('user', String(identity.userId)).all();
  const clips = (rows.results || []).map((r) => ({
    clip_id: r.clip_id, title: r.title || '', content: r.content,
    tags: parseTags(r.tags), is_public: !!r.is_public,
    created_at: r.created_at, updated_at: r.updated_at
  }));
  return c.json({ ok: true, exported_at: new Date().toISOString(), count: clips.length, clips });
});

// ========== SPA 回退 ==========

app.all('*', async (c) => {
  if (!c.env.ASSETS) return c.text('ASSETS binding missing', 500);
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  const fallback = await c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }));
  return new Response(fallback.body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

// v4.27.1：全局异常兜底——任何未捕获异常（典型：D1 读配额耗尽）不再向用户抛 500。
// GET 返回 200 + degraded（前端降级渲染，不再整片报错）；写操作返回 503（诚实告知服务暂不可用）。
// v4.29：IP /网段封禁中间件 —— v4.31.6 已上移到文件顶部。
// ⚠️ 原因：Hono 按**注册顺序**匹配，中间件注册在路由之后 = 永远不会执行。
//    这个坑曾同时让「IP 封禁」和「配额计量」两个中间件沦为死代码（额度恒为 0 的根因）。

// v4.30.1：D1 读配额耗尽时的降级策略修正。
// 旧逻辑只看 HTTP 方法：GET → 200 degraded；其余（含 POST）→ 503 一锅端。
// 后果：**登录/注册/写剪贴板全部不可用**（实测 D1 配额耗尽时 POST /api/auth/password/login
// 返回 503 service_unavailable），用户感知就是"聊天一崩全站都坏"。
// 但聊天只是最先暴露症状的那个，真正被误伤的是**所有 POST/PUT/DELETE**。
// 现在改为按「该接口是否真的需要写 D1」区分：
//   - 幂等的读类写（标记已读、切静音、已加入群标记等）→ 返回 200 + degraded，前端照常工作
//   - 其余写操作 → 仍拦，但带上明确文案，让用户知道是"额度用尽"而非"站点坏了"
const DEGRADED_WRITE_OK = [
  '/api/chat/conversations/',   // 已读标记 / 静音切换等（后缀再判定）
  '/api/chat/read',
  '/api/me/read'
];
function isIdempotentWrite(path, method) {
  if (method === 'DELETE') return false;
  // 群聊相关的 POST 里，只有「标记已读」与「静音」是幂等的；发消息/删群等仍需拦
  if (path.startsWith('/api/chat/conversations/')) {
    return /\/read(\?|$)/.test(path) || /\/mute(\?|$)/.test(path) || /\/members\/\d+\/read(\?|$)/.test(path);
  }
  return DEGRADED_WRITE_OK.some((p) => path.startsWith(p));
}

// v4.31：配额计量 + 定期落盘 + 超阈值自动刹车 —— v4.31.6 已上移到文件顶部。
// ⚠️ 之前注册在这里（所有路由之后），Hono 不会执行它 → 计数永远是 0。
//    这就是「额度一直是 0、进度条不动」的真正根因（不是 quotaFlush 的冻结 bug 那么简单）。


app.onError((err, c) => {
  try { console.error('[onError]', (err && err.stack) || err); } catch {}
  const method = (c.req && c.req.method) || 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return c.json({ degraded: true, error: 'service_degraded', message: '数据库读取额度已用尽，部分数据暂时读不到' }, 200);
  }
  let path = '/';
  try { path = new URL(c.req.url).pathname; } catch {}
  if (isIdempotentWrite(path, method)) {
    // 幂等写：假装成功，前端体验不被打断（数据下次同步时会自然补上）
    return c.json({ ok: true, degraded: true, message: '当前处于降级状态，该操作可能稍后生效' }, 200);
  }
  return c.json({
    degraded: true,
    error: 'service_unavailable',
    message: '站长的数据库读取额度已用尽，暂时无法保存。请稍后再试——这不是站点故障，管理员正在处理。'
  }, 503);
});

export default app;
