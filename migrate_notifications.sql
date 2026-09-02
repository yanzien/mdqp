-- mdqp 通知系统迁移（v4.5）
-- 幂等：CREATE TABLE IF NOT EXISTS + 加列前判断（见 scripts/migrate-notifications.mjs）

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,          -- 'trust' | 'clip_expiry' | 'clip_visited' | 'admin'
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

-- 信任等级上次值（用于检测提升并通知）
ALTER TABLE users ADD COLUMN last_trust_level INTEGER DEFAULT 0;
-- 剪贴板首次被外部访客访问的通知去重标记
ALTER TABLE clipboards ADD COLUMN visit_notified INTEGER DEFAULT 0;
-- 剪贴板到期提醒去重标记
ALTER TABLE clipboards ADD COLUMN expiry_notified INTEGER DEFAULT 0;
