-- v4.17: 聊天系统（单聊 + 群聊 + 全站总群）
-- 幂等：CREATE TABLE / CREATE INDEX 用 IF NOT EXISTS；种子总群与存量用户用 INSERT OR IGNORE。
-- 运行方式：
--   wrangler d1 execute --remote --project-name mdqp --file=migrate_v4.17_chat.sql

-- ========== 1. 表结构 ==========
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'single',   -- 'single' | 'group'
  name TEXT DEFAULT '',                   -- 群名（单聊忽略）
  owner_id INTEGER DEFAULT NULL,          -- 群主 users.id（单聊为 NULL）
  is_global INTEGER DEFAULT 0,            -- 1 = 全站总群（所有用户默认加入）
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_type_global ON chat_conversations(type, is_global);

CREATE TABLE IF NOT EXISTS chat_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',    -- 'owner' | 'member'
  joined_at TEXT DEFAULT (datetime('now')),
  left INTEGER DEFAULT 0,                  -- 1 = 已退出（群聊）
  last_read_id INTEGER DEFAULT 0,         -- 已读到的最后一条消息 id（未读计数用）
  UNIQUE(conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_conv ON chat_members(conv_id, left);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, left);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conv_id, id DESC);

-- ========== 2. 种子全站总群（仅当不存在时插入） ==========
INSERT OR IGNORE INTO chat_conversations (type, name, owner_id, is_global)
SELECT 'group', 'mdqp 总群', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM chat_conversations WHERE is_global = 1);

-- ========== 3. 存量用户全部加入总群（UNIQUE(conv_id,user_id) + INSERT OR IGNORE 幂等） ==========
INSERT OR IGNORE INTO chat_members (conv_id, user_id, role)
SELECT (SELECT id FROM chat_conversations WHERE is_global = 1 LIMIT 1), id, 'member'
FROM users;

-- 站长为总群群主
UPDATE chat_members SET role = 'owner'
WHERE conv_id = (SELECT id FROM chat_conversations WHERE is_global = 1 LIMIT 1)
  AND user_id = 1;
