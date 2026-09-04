/**
 * mdqp v4.0 — Cloudflare Worker (Hono + D1)
 *
 * 权限模型 v4.0:
 *  - 登录用户(cpoauth): 日限5/月限50剪贴板；每板300字(中文全算英文折半)；管理员与有效VIP豁免字数；功能开关可单独关闭
 *  - 游客(未登录): 周限5个；协作板；按设备指纹算唯一读者
 *  - VIP: 金色标识，管理员授予
 *  - 邀请系统: 邀请码+链接，tier 奖励自动发放
 *  - 评论: 登录可用，50字/条，支持 @mention
 *  - 公告: 管理员编辑，首页置顶
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyJWT, hashPassword } from './auth.js';
import { oauthRoutes } from './oauth.js';

const app = new Hono();

const GUEST_LIMIT = 5;
const PAGE_SIZE = 20;
const VERSION = '4.6.2';
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
    if (p) return { type: 'user', userId: p.userId, sub: p.sub, name: p.name, avatar: p.avatar };
  }
  const auth = req.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const p = await verifyJWT(auth.slice(7), secret);
    if (p) return { type: 'user', userId: p.userId, sub: p.sub, name: p.name, avatar: p.avatar };
  }
  const guestId = req.headers.get('X-Guest-Id');
  if (guestId && /^[a-zA-Z0-9-]{8,64}$/.test(guestId)) return { type: 'guest', guestId, name: '游客' };
  return { type: 'none' };
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

/** 检查管理员是否有某项管理权限 */
async function hasAdminPerm(db, identity, perm) {
  if (!(await isAdminIdentity(db, identity))) return false;
  const u = await db.prepare('SELECT role, admin_permissions FROM users WHERE id = ?').bind(String(identity.userId)).first();
  if (!u) return false;
  if (u.role === 'developer') return true; // 开发者拥有所有权限
  try { const perms = JSON.parse(u.admin_permissions || '{}'); return !!perms[perm]; } catch { return false; }
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

const ALL_PERMS = ['delete_user', 'set_clip_limit', 'edit_pages', 'edit_public_clips', 'edit_private_clips', 'view_code'];

/** 获取站点设置值 */
async function getSiteSetting(db, key, fallback) {
  const r = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
  return r ? r.value : fallback;
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

// ========== API ==========

app.get('/api/health', (c) => c.json({ ok: true, version: VERSION, time: Date.now() }));

// 站点统计
app.get('/api/stats', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const db = c.env.db;
  const [clips, users] = await Promise.all([
    db.prepare('SELECT COUNT(*) as cnt FROM clipboards').first(),
    db.prepare('SELECT COUNT(*) as cnt FROM users').first()
  ]);
  return c.json({ clips: clips?.cnt || 0, users: users?.cnt || 0 });
});

// ========== 公告 API ==========

app.get('/api/announcements', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  const db = c.env.db;
  const rows = await db
    .prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY pinned DESC, created_at DESC')
    .all();
  return c.json({ announcements: rows.results });
});

app.put('/api/announcements', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const content = (body.content || '').toString().slice(0, 5000);
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);

  await db.prepare(
    `INSERT INTO announcements (content, is_active, pinned, updated_at, updated_by)
     VALUES (?, 1, 1, datetime('now'), ?)`
  ).bind(content, identity.name || String(identity.userId)).run();

  // 保留最新 N 条公告（默认最多 5 条活跃）
  await db.exec(`DELETE FROM announcements WHERE id NOT IN (
    SELECT id FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5
  ) AND is_active = 1`);

  return c.json({ ok: true });
});

app.delete('/api/announcements/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  await db.prepare('DELETE FROM announcements WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ========== 官方反馈贴 API（Bug 反馈 / 意见反馈） ==========
app.post('/api/feedback', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const type = body.type === 'suggestion' ? 'suggestion' : 'bug';
  const content = (body.content || '').toString().slice(0, 5000);
  if (!content.trim()) return c.json({ error: 'empty_content' }, 400);
  const env = (body.env || '').toString().slice(0, 500);
  const situation = (body.situation || '').toString().slice(0, 2000);
  const console_log = (body.console_log || '').toString().slice(0, 4000);
  const contact = (body.contact || '').toString().slice(0, 200);
  const identity = await getIdentity(c);
  let authorId = '', authorName = '匿名', authorType = 'guest';
  if (identity.type === 'user') { authorId = String(identity.userId); authorName = identity.name || '用户'; authorType = 'user'; }
  else if (identity.type === 'guest') { authorId = identity.guestId || ''; authorName = '游客'; authorType = 'guest'; }
  const db = c.env.db;
  const info = await db.prepare(
    `INSERT INTO feedback (type, env, situation, console_log, content, contact, author_id, author_name, author_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'), datetime('now'))`
  ).bind(type, env, situation, console_log, content, contact, authorId, authorName, authorType).run();
  return c.json({ ok: true, id: info?.meta?.last_row_id ?? null });
});

app.get('/api/feedback', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  const status = c.req.query('status');
  const rows = status
    ? await db.prepare('SELECT * FROM feedback WHERE status = ? ORDER BY created_at DESC').bind(status).all()
    : await db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  return c.json({ feedback: rows.results });
});

app.patch('/api/feedback/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const id = c.req.param('id');
  const allowed = ['open', 'reviewing', 'resolved', 'rejected'];
  const sets = [], binds = [];
  if (body.status) {
    if (!allowed.includes(body.status)) return c.json({ error: 'bad_status' }, 400);
    sets.push('status = ?'); binds.push(body.status);
  }
  if (body.admin_note !== undefined) { sets.push('admin_note = ?'); binds.push((body.admin_note || '').toString().slice(0, 2000)); }
  if (!sets.length) return c.json({ error: 'nothing' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  await db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ ok: true });
});

app.delete('/api/feedback/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  await db.prepare('DELETE FROM feedback WHERE id = ?').bind(c.req.param('id')).run();
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

// 其他管理：提交改动审批（覆盖同文件未完成审批）
app.post('/api/admin/code/submit', async (c) => {
  const db = c.env.db; const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'view_code'))) return c.json({ error: 'forbidden' }, 403);
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
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim().slice(0, SEARCH_MAX);
  const offset = (page - 1) * PAGE_SIZE;

  let where = "WHERE is_public = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) AND (max_views = 0 OR views < max_views)";
  const params = [];
  if (q) {
    where += ' AND (title LIKE ? OR content LIKE ? OR owner_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM clipboards ${where}`).bind(...params).first();
  const total = totalRow?.cnt || 0;

  const rows = await db
    .prepare(
      `SELECT clip_id, title, content, owner_type, owner_id, owner_name, editable_by_anyone,
              password_hash, expires_at, max_views, views, created_at, updated_at,
              login_required, max_readers
       FROM clipboards ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
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
      editable_by_anyone: !!r.editable_by_anyone,
      expires_at: r.expires_at,
      max_views: r.max_views,
      views: r.views,
      login_required: !!r.login_required,
      max_readers: r.max_readers,
      created_at: r.created_at,
      updated_at: r.updated_at
    })),
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE))
  });
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

  return c.json({
    clip_id: r.clip_id,
    title: r.title,
    content: r.content,
    owner_type: r.owner_type,
    owner_id: r.owner_id,
    owner_name: r.owner_name,
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
  const admin = await isAdminIdentity(db, identity);
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

  await db.prepare(
    `UPDATE clipboards SET title = ?, content = ?, is_public = ?, expires_at = ?, max_views = ?,
       password_hash = ?, updated_at = datetime('now'), login_required = ?, max_readers = ?, tags = ? WHERE clip_id = ?`
  ).bind(title, content, isPublic, expiresAt, maxViews, passwordHash, loginRequired, maxReaders, tagsStr, newClipId).run();

  return c.json({ ok: true, clip_id: newClipId, tags: parseTags(tagsStr) });
});

// ========== 删除 ==========

app.delete('/api/clips/:clipId', async (c) => {
  const db = c.env.db;
  const clipId = c.req.param('clipId');
  const identity = await getIdentity(c);
  if (identity.type === 'none') return c.json({ error: 'unauthorized' }, 401);
  const r = await db.prepare('SELECT * FROM clipboards WHERE clip_id = ?').bind(clipId).first();
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (!canWrite(identity, r) && !(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
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
      avatar: u.avatar, bio: u.bio || '', signature: u.signature || '',
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

  if (identity.type === 'user') {
    const uRow = await db.prepare(
      `SELECT username, role, bio, signature, linked_accounts, is_vip, vip_until,
              invite_code, invite_count, feature_flags, password_hash,
              email, email_verified, no_cpoauth_nudge, created_at
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
      quota: { daily_used: dayCnt?.cnt || 0, daily_limit: dailyLimit, monthly_used: monthCnt?.cnt || 0, monthly_limit: monthlyLimit },
      clips: clips.results.map((r) => ({
        clip_id: r.clip_id, title: r.title || '无标题', preview: makePreview(r.content),
        has_password: !!r.password_hash, is_public: !!r.is_public,
        editable_by_anyone: !!r.editable_by_anyone, expires_at: r.expires_at,
        max_views: r.max_views, views: r.views, created_at: r.created_at,
        tags: parseTags(r.tags), pinned: !!r.pinned
      }))
    });
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
  // v4.4: 「不再提示绑定 cpoauth」持久化（跨设备一致）
  if (body.no_cpoauth_nudge !== undefined) fields.no_cpoauth_nudge = body.no_cpoauth_nudge ? 1 : 0;
  if (Object.keys(fields).length === 0) return c.json({ error: 'nothing_to_update' }, 400);
  const cols = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const vals = Object.values(fields);
  await db.prepare(`UPDATE users SET ${cols} WHERE id = ?`).bind(...vals, String(identity.userId)).run();
  return c.json({ ok: true, ...fields });
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
  // 列表
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
});

app.post('/api/notifications/:id/read', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (identity.type !== 'user') return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const n = await db.prepare('SELECT id, user_id FROM notifications WHERE id = ?').bind(id).first();
  if (!n || String(n.user_id) !== String(identity.userId)) return c.json({ error: 'not_found' }, 404);
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(id).run();
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
  await db.prepare(sql).bind(...params).run();
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

  const rows = await db.prepare(
    "SELECT id, username, display_name, avatar FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 10"
  ).bind(`%${q}%`, `%${q}%`).all();

  return c.json({ users: rows.results.map((r) => ({
    id: r.id, username: r.username, display_name: r.display_name || r.username, avatar: r.avatar
  })) });
});

// ========== 邀请系统 API ==========

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
  const rewards = parseJSON(await getSiteSetting(db, 'invite_rewards', '{}'));
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
  const rewards = parseJSON(await getSiteSetting(db, 'invite_rewards', '{}')) || {};
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
          // 开通 VIP（永久）
          await db.prepare("UPDATE users SET is_vip = 1, vip_until = NULL WHERE id = ?").bind(inviter.id).run();
          granted.push({ threshold: tier.threshold, reward: 'vip', desc: '已开通 VIP' });
          break;
        case 'unlimited_chars_pin':
          // 不限字数 + 置顶权限（用 feature_flags 或特殊标记）
          // 这里简化为：给一个特殊标记，前端识别
          granted.push({ threshold: tier.threshold, reward: 'unlimited_chars_pin', desc: '获得不限字数及置顶权限（待管理员手动授予）' });
          break;
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
  if (!(await hasAdminPerm(db, identity, 'delete_user'))) return c.json({ error: 'forbidden' }, 403);

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim();
  const offset = (page - 1) * PAGE_SIZE;
  let where = ''; const params = [];
  if (q) { where = 'WHERE u.username LIKE ? OR u.display_name LIKE ?'; params.push(`%${q}%`, `%${q}%`); }

  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM users u ${where}`).bind(...params).first();
  const rows = await db.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.bio, u.signature,
            u.linked_accounts, u.clip_limit, u.limit_period, u.admin_permissions,
            u.created_at, u.last_login, u.is_vip, u.vip_until, u.invite_code,
            u.invite_count, u.feature_flags,
            (SELECT COUNT(*) FROM clipboards c WHERE c.owner_type = 'user' AND c.owner_id = u.id) AS clip_count
     FROM users u ${where} ORDER BY u.id ASC LIMIT ? OFFSET ?`
  ).bind(...params, PAGE_SIZE, offset).all();

  return c.json({
    users: rows.results.map((r) => ({
      id: r.id, username: r.username, display_name: r.display_name || r.username,
      avatar: r.avatar, role: r.role || 'user',
      linked_accounts: parseLinkedAccounts(r.linked_accounts),
      clip_limit: r.clip_limit, limit_period: r.limit_period,
      admin_permissions: parseAdminPerms(r.admin_permissions),
      created_at: r.created_at, last_login: r.last_login, clip_count: r.clip_count || 0,
      is_vip: !!r.is_vip, vip_until: r.vip_until,
      invite_code: r.invite_code || '', invite_count: r.invite_count || 0,
      feature_flags: parseFeatureFlags(r.feature_flags)
    })),
    page, total: totalRow?.cnt || 0, totalPages: Math.max(1, Math.ceil((totalRow?.cnt || 0) / PAGE_SIZE))
  });
});

app.patch('/api/admin/users/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);

  const targetId = c.req.param('id');
  const target = await db.prepare('SELECT id, role, username, display_name FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'developer') return c.json({ error: 'forbidden', message: '开发者身份不可更改' }, 403);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad_json' }, 400); }
  const changes = [];

  // 角色变更
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!['user', 'admin'].includes(role)) return c.json({ error: 'bad_role' }, 400);
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, targetId).run();
    changes.push(role === 'admin' ? '被设为管理员' : '管理员权限被撤销');
  }

  // 剪贴板数量限制
  if (body.clip_limit !== undefined || body.limit_period !== undefined) {
    const limit = body.clip_limit === null ? null : Math.max(0, parseInt(body.clip_limit) || 0);
    const period = body.limit_period === null ? null : String(body.limit_period || '');
    if (limit !== null && !['month', 'week', 'year', 'forever', ''].includes(period))
      return c.json({ error: 'bad_period' }, 400);
    await db.prepare('UPDATE users SET clip_limit = ?, limit_period = ?, limit_start = datetime(\'now\') WHERE id = ?')
      .bind(limit, period, targetId).run();
    changes.push('剪贴板数量限制被调整');
  }

  // 管理员权限
  if (body.admin_permissions !== undefined) {
    let perms = parseAdminPerms(body.admin_permissions);
    const clean = {};
    for (const p of ALL_PERMS) { if (perms[p]) clean[p] = true; }
    await db.prepare('UPDATE users SET admin_permissions = ? WHERE id = ?').bind(JSON.stringify(clean), targetId).run();
    changes.push('管理权限被更新');
  }

  // === v4.0: VIP 设置 ===
  if (body.is_vip !== undefined) {
    const isVip = body.is_vip ? 1 : 0;
    const vipUntil = body.vip_until || null;
    await db.prepare('UPDATE users SET is_vip = ?, vip_until = ? WHERE id = ?').bind(isVip, vipUntil, targetId).run();
    changes.push(isVip ? 'VIP 已开通' : 'VIP 已被撤销');
  }

  // === v4.0: 功能开关 ===
  if (body.feature_flags !== undefined) {
    let ff = parseFeatureFlags(body.feature_flags);
    // 只保留已知 key
    const clean = {};
    for (const k of FEATURE_KEYS) { if (ff[k] !== undefined) clean[k] = ff[k]; }
    await db.prepare('UPDATE users SET feature_flags = ? WHERE id = ?').bind(JSON.stringify(clean), targetId).run();
    changes.push('功能开关被更新');
  }

  // 后台管理操作 → 通知目标用户（操作者本人除外）
  if (changes.length && String(identity.userId) !== String(targetId)) {
    const whom = target.display_name || target.username || ('用户#' + targetId);
    await createNotification(db, targetId, 'admin', '🛡 账号变动通知', `你的账号（${whom}）${changes.join('；')}。`, '/me');
  }

  return c.json({ ok: true, id: Number(targetId) });
});

app.delete('/api/admin/users/:id', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await hasAdminPerm(db, identity, 'delete_user'))) return c.json({ error: 'forbidden' }, 403);
  const targetId = c.req.param('id');
  if (String(identity.userId) === String(targetId)) return c.json({ error: 'forbidden', message: '不能删除自己的账号' }, 403);
  const target = await db.prepare('SELECT id, role, username FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'developer') return c.json({ error: 'forbidden', message: '开发者账号不可删除' }, 403);
  await db.prepare("DELETE FROM clipboards WHERE owner_type = 'user' AND owner_id = ?").bind(targetId).run();
  await db.prepare('DELETE FROM comments WHERE author_id = ?').bind(targetId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
  return c.json({ ok: true, deleted: target.username });
});

// 全部剪贴板（不变）
app.get('/api/admin/clips', async (c) => {
  const db = c.env.db;
  const identity = await getIdentity(c);
  if (!(await isAdminIdentity(db, identity))) return c.json({ error: 'forbidden' }, 403);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const q = (c.req.query('q') || '').trim().slice(0, SEARCH_MAX);
  const offset = (page - 1) * PAGE_SIZE;
  let where = ''; const params = [];
  if (q) { where = 'WHERE title LIKE ? OR content LIKE ? OR owner_name LIKE ? OR clip_id LIKE ?'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const totalRow = await db.prepare(`SELECT COUNT(*) as cnt FROM clipboards ${where}`).bind(...params).first();
  const rows = await db.prepare(
    `SELECT clip_id, title, content, owner_type, owner_id, owner_name, is_public, editable_by_anyone,
            password_hash, expires_at, max_views, views, created_at, updated_at, login_required, max_readers
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
      max_readers: r.max_readers, created_at: r.created_at
    })),
    page, total: totalRow?.cnt || 0, totalPages: Math.max(1, Math.ceil((totalRow?.cnt || 0) / PAGE_SIZE))
  });
});

// OAuth 子路由
app.route('/api/auth', oauthRoutes);

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

export default app;
