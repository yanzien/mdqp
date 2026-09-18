-- mdqp v4.13.0 迁移：用户封禁 + 举报审核闭环
-- 幂等：ALTER 重复执行会被 D1 忽略；CREATE TABLE/INDEX 用 IF NOT EXISTS。

-- ========== 1. 用户封禁字段 ==========
ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN banned_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT NULL;
-- 封禁到期时间：NULL = 永久封禁；有值 = 解封时间（ISO 字符串）
ALTER TABLE users ADD COLUMN ban_until TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned);

-- ========== 2. 举报表（内容审核闭环） ==========
CREATE TABLE IF NOT EXISTS clip_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  reporter_id INTEGER DEFAULT NULL,        -- users.id；游客举报为 NULL（用 IP 追溯）
  reporter_type TEXT NOT NULL DEFAULT 'user', -- 'user' | 'guest'
  reporter_ip TEXT DEFAULT '',
  reason TEXT NOT NULL,                    -- spam(恶意/垃圾) | porn(低俗色情) | sensitive(擦边) | illegal(违法违规) | other(其他)
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'resolved' | 'dismissed'
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT DEFAULT NULL,
  resolved_by INTEGER DEFAULT NULL,
  resolution TEXT DEFAULT ''               -- 处理说明
);
CREATE INDEX IF NOT EXISTS idx_clip_reports_status ON clip_reports(status);
CREATE INDEX IF NOT EXISTS idx_clip_reports_clip ON clip_reports(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_reports_reporter ON clip_reports(reporter_id);
