-- 本地测试一次性重置 + 建表 + 种子 + 自检（单次调用，避免跨调用锁竞争）
DROP TABLE IF EXISTS clipboards;
DROP TABLE IF EXISTS pages;
DROP TABLE IF EXISTS users;

-- ===== database_init.sql 内容 =====
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub TEXT UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  provider TEXT DEFAULT 'cpoauth',
  bio TEXT DEFAULT '',
  signature TEXT DEFAULT '',
  role TEXT DEFAULT 'user',
  linked_accounts TEXT DEFAULT '',
  clip_limit INTEGER DEFAULT NULL,
  limit_period TEXT DEFAULT NULL,
  limit_start TEXT DEFAULT NULL,
  admin_permissions TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clipboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL UNIQUE,
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  owner_type TEXT DEFAULT 'user',
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  is_public INTEGER DEFAULT 1,
  editable_by_anyone INTEGER DEFAULT 0,
  password_hash TEXT DEFAULT '',
  expires_at TEXT DEFAULT NULL,
  max_views INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO users (id, sub, username, display_name, avatar, bio, role, linked_accounts, created_at, last_login)
VALUES (1, 'dev-sub-0001', 'yanzie', 'Yanzie', '', '开发者bio-来自cpoauth', 'developer', '[]', datetime('now'), datetime('now'));
INSERT OR IGNORE INTO users (id, sub, username, display_name, avatar, bio, role, linked_accounts, created_at, last_login)
VALUES (2, 'user-sub-0002', 'testuser', '测试用户A', '', '我是测试用户', 'user', '[]', datetime('now'), datetime('now'));
INSERT OR IGNORE INTO users (id, sub, username, display_name, avatar, bio, role, linked_accounts, created_at, last_login)
VALUES (3, 'user-sub-0003', 'limituser', '限额用户B', '', '限额测试', 'user', '[]', datetime('now'), datetime('now'));

-- 自检：确认 v3.4 列与种子存在
SELECT id, username, role, signature, clip_limit, limit_period, admin_permissions FROM users ORDER BY id;
