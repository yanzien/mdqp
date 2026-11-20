-- v4.34.0: 剪贴板版本历史（兑现「版本历史」权益）
-- 编辑剪贴板时先把旧内容留存一份；按信任等级 / VIP 的 revisions 配额裁剪。
CREATE TABLE IF NOT EXISTS clip_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  tags TEXT DEFAULT '',
  saved_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clip_versions_clip ON clip_versions(clip_id, id DESC);
