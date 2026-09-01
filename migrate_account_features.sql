-- v4.4 账户增强迁移（幂等，仅加列/加表，不删不改旧列）
-- 邮箱（来自 cpoauth，仅作登录标识与展示，不独立绑定流程）
ALTER TABLE users ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;

-- 「不再提示绑定 cpoauth」持久化（跨设备一致）
ALTER TABLE users ADD COLUMN no_cpoauth_nudge INTEGER DEFAULT 0;

-- 战绩概览缓存（cp:summary 代理结果，按 user_id 缓存，避免每次刷新打 cpoauth）
CREATE TABLE IF NOT EXISTS user_stats (
  user_id      INTEGER PRIMARY KEY,
  summary_json TEXT DEFAULT '',          -- cpoauth 返回的战绩 JSON
  fetched_at   TEXT DEFAULT '',          -- 缓存时间，前端据此判断是否过期
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_stats_fetched ON user_stats(fetched_at);
