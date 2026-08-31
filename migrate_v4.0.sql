-- mdqp D1 Database Migration v3.8 → v4.0
-- 幂等：每条 ALTER/CREATE 都用 IF NOT EXISTS 或 guard

-- ========== 1. 用户表扩展 ==========
-- VIP 系统
ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0;
-- VIP 到期时间（NULL=永久）。注意：v1 版迁移漏了此列，会导致 /api/me 选 vip_until 报 SQL 错→500→登录态回退。已补。
ALTER TABLE users ADD COLUMN vip_until TEXT DEFAULT NULL;
-- 邀请系统（注意：不能直接 ADD COLUMN ... UNIQUE DEFAULT ''，否则线上已有用户会被填成 '' 触发唯一冲突）
ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT NULL;
-- 为已有用户补一个唯一邀请码（新注册用户由 /api/invite/me 自动生成；UNIQUE 索引允许 NULL 故不影响新用户）
UPDATE users SET invite_code = 'U' || id || '-' || lower(hex(randomblob(3))) WHERE invite_code IS NULL OR invite_code = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
ALTER TABLE users ADD COLUMN inviter_id INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN invite_count INTEGER DEFAULT 0;
-- 功能开关（JSON，每个功能独立开关）
ALTER TABLE users ADD COLUMN feature_flags TEXT DEFAULT '{}';

-- ========== 2. 剪贴板表扩展 ==========
-- 登录门禁（仅登录用户可查看）
ALTER TABLE clipboards ADD COLUMN login_required INTEGER DEFAULT 0;
-- 唯一读者上限（0=不限，按人不算次数）
ALTER TABLE clipboards ADD COLUMN max_readers INTEGER DEFAULT 0;
-- 字数限制覆盖（NULL=用全局默认150）
ALTER TABLE clipboards ADD COLUMN char_limit INTEGER DEFAULT NULL;

-- ========== 3. 新表：公告 ==========
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  pinned INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

-- ========== 4. 新表：唯一读者追踪（替代 views 次数计数） ==========
CREATE TABLE IF NOT EXISTS clip_readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  reader_type TEXT NOT NULL,        -- 'user' | 'guest'
  reader_id TEXT NOT NULL,           -- user.id 或 fingerprint hash
  first_seen TEXT DEFAULT (datetime('now')),
  UNIQUE(clip_id, reader_type, reader_id)
);
CREATE INDEX IF NOT EXISTS idx_clip_readers_clip ON clip_readers(clip_id);

-- ========== 5. 新表：评论 ==========
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  author_type TEXT NOT NULL,         -- 'user'（目前只支持登录用户）
  author_id INTEGER NOT NULL,       -- users.id
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_clip ON comments(clip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

-- ========== 6. 新表：邀请记录 ==========
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  inviter_id INTEGER NOT NULL,       -- users.id（邀请人）
  invitee_id INTEGER DEFAULT NULL,  -- users.id（被邀请人，首次登录后填入）
  status TEXT DEFAULT 'pending',    -- 'pending' | 'used' | 'expired'
  used_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id);

-- ========== 7. 站点设置表（邀请奖励规则等全局配置） ==========
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 默认邀请奖励配置
INSERT OR IGNORE INTO site_settings (key, value) VALUES (
  'invite_rewards',
  JSON_OBJECT(
    'inviter', JSON_ARRAY(
      JSON_OBJECT('threshold', 1, 'reward', 'all_features'),
      JSON_OBJECT('threshold', 3, 'reward', 'vip'),
      JSON_OBJECT('threshold', 5, 'reward', 'unlimited_chars_pin'),
      JSON_OBJECT('threshold', 10, 'reward', 'developer_gift')
    ),
    'invitee', JSON_OBJECT('reward', 'custom_slug')
  )
);

-- 全局默认功能开关（新用户继承此值）
INSERT OR IGNORE INTO site_settings (key, value) VALUES (
  'default_feature_flags',
  JSON_OBJECT(
    'custom_slug', 0,
    'max_views', 1,
    'password', 1,
    'expiry', 1,
    'collaboration', 1,
    'login_required', 1,
    'max_readers', 0,
    'comments', 1
  )
);

-- 全局字数限制默认值
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('global_char_limit', '150');

-- 登录用户每日/每月限额
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('user_daily_limit', '5');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('user_monthly_limit', '50');

-- 游客每周限额
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('guest_weekly_limit', '5');
