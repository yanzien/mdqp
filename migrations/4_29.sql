-- v4.29：IP 治理（注册 IP 记录 + IP/网段封禁）+ 群管理（管理员/审核/邀请码）
-- 幂等：CREATE TABLE/INDEX 用 IF NOT EXISTS；新增列用 ALTER TABLE（仅执行一次）

-- ========== 1. 注册 IP 记录（用于「同一 IP 近期注册了哪些账号」治理视图）============
CREATE TABLE IF NOT EXISTS user_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  ua TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_ips_ip ON user_ips(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_ips_user ON user_ips(user_id);

-- ========== 2. IP / 网段封禁表 ==========
-- kind: 'ip' = 单 IP；'cidr' = 网段（IPv4，支持 a.b.c.d/nn）
CREATE TABLE IF NOT EXISTS ip_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'ip',      -- 'ip' | 'cidr'
  value TEXT NOT NULL,                 -- '1.2.3.4' 或 '1.2.3.0/24'
  reason TEXT DEFAULT '',
  banned_by INTEGER DEFAULT NULL,
  banned_at TEXT DEFAULT (datetime('now')),
  ban_until TEXT DEFAULT NULL,         -- NULL = 永久；否则 datetime
  UNIQUE(kind, value)
);
CREATE INDEX IF NOT EXISTS idx_ip_bans_value ON ip_bans(value);

-- ========== 3. 群管理：邀请码 + 审核 ==========
ALTER TABLE chat_conversations ADD COLUMN invite_code TEXT DEFAULT NULL;
ALTER TABLE chat_conversations ADD COLUMN join_mode TEXT DEFAULT 'open';   -- 'open' | 'approval'
-- 审核申请：待处理/通过/拒绝
CREATE TABLE IF NOT EXISTS chat_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  created_at TEXT DEFAULT (datetime('now')),
  handled_at TEXT DEFAULT NULL,
  handled_by INTEGER DEFAULT NULL,
  UNIQUE(conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cjr_conv_status ON chat_join_requests(conv_id, status);

-- 存量群补一个邀请码，保证老群也能发链接
UPDATE chat_conversations SET invite_code = lower(hex(randomblob(8)))
WHERE invite_code IS NULL OR invite_code = '';

-- ========== 4. 种子总群默认开放加入（保持既有行为不变）============
UPDATE chat_conversations SET join_mode = 'open' WHERE is_global = 1;