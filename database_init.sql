-- mdqp D1 Database Schema v4.0（全新安装用）
-- Markdown Quick Paste — 剪贴板 + 用户 + 游客 + 管理 + VIP + 邀请 + 评论 + 公告 + 功能开关

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub TEXT UNIQUE,              -- cpoauth UUID
  username TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  provider TEXT DEFAULT 'cpoauth',  -- 'cpoauth' | 'password'
  password_hash TEXT DEFAULT '',    -- 非空=可用密码登录（cpoauth 兜底）；SHA-256('mdqp$'+pwd)
  bio TEXT DEFAULT '',              -- 从 cpoauth 同步（profile scope），每次登录覆盖
  signature TEXT DEFAULT '',        -- 个性签名（本地，用户自己编辑）
  role TEXT DEFAULT 'user',           -- 'user' | 'admin' | 'developer'（id=1 自动 developer）
  linked_accounts TEXT DEFAULT '',    -- cpoauth 绑定账号 JSON [{platform,platformUid,platformUsername}]
  -- 管理员可设的限制
  clip_limit INTEGER DEFAULT NULL,   -- NULL=不限量；否则为该用户允许的最大剪贴板数
  limit_period TEXT DEFAULT NULL,    -- 'month' | 'week' | 'year' | 'forever'（限制周期）
  limit_start TEXT DEFAULT NULL,     -- 限制起始时间（datetime），NULL=从首次限制设置时算起
  admin_permissions TEXT DEFAULT '{}', -- 管理员权限 JSON：{delete_user, set_clip_limit, edit_pages, edit_public_clips, edit_private_clips}
  -- v4.0: VIP 系统
  is_vip INTEGER DEFAULT 0,
  vip_until TEXT DEFAULT NULL,       -- VIP 到期时间，NULL=永久
  -- v4.0: 邀请系统
  invite_code TEXT UNIQUE DEFAULT '',
  inviter_id INTEGER DEFAULT NULL,   -- 邀请人的 users.id
  invite_count INTEGER DEFAULT 0,    -- 成功邀请人数
  -- v4.0: 功能开关（JSON，每个高级功能独立开关）
  feature_flags TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,          -- 'help' | 'about'
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clipboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL UNIQUE,   -- 公开短 ID（可自定义 slug）
  title TEXT DEFAULT '',
  content TEXT NOT NULL,

  -- 归属
  owner_type TEXT DEFAULT 'user', -- 'user' | 'guest'
  owner_id TEXT NOT NULL,         -- users.id(数字) 或 guest UUID
  owner_name TEXT NOT NULL,       -- 冗余显示名

  -- 权限
  is_public INTEGER DEFAULT 1,          -- 1=公开列表可见 0=仅凭ID访问
  editable_by_anyone INTEGER DEFAULT 0, -- 1=任何人可改/删（游客剪贴板）

  -- === CloudPaste 式增强 ===
  password_hash TEXT DEFAULT '',   -- 非空则需密码才能查看（SHA-256）
  expires_at TEXT DEFAULT NULL,    -- 过期时间（UTC datetime 字符串），NULL=永不过期
  max_views INTEGER DEFAULT 0,     -- 最大查看次数（旧版兼容，保留），0=无限
  views INTEGER DEFAULT 0,         -- 已查看次数（旧版兼容，保留）

  -- === v4.0 新增 ===
  login_required INTEGER DEFAULT 0,     -- 仅登录用户可查看
  max_readers INTEGER DEFAULT 0,        -- 唯一读者上限（按人不算次数），0=无限
  char_limit INTEGER DEFAULT NULL,      -- 字数限制覆盖（NULL=用全局默认150）

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clipboards_clip_id ON clipboards(clip_id);
CREATE INDEX IF NOT EXISTS idx_clipboards_owner ON clipboards(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_clipboards_created ON clipboards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clipboards_public ON clipboards(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clipboards_expires ON clipboards(expires_at);

-- ========== v4.0: 唯一读者追踪 ==========
CREATE TABLE IF NOT EXISTS clip_readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  reader_type TEXT NOT NULL,        -- 'user' | 'guest'
  reader_id TEXT NOT NULL,           -- user.id 或 fingerprint hash
  first_seen TEXT DEFAULT (datetime('now')),
  UNIQUE(clip_id, reader_type, reader_id)
);
CREATE INDEX IF NOT EXISTS idx_clip_readers_clip ON clip_readers(clip_id);

-- ========== v4.0: 评论 ==========
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  author_type TEXT NOT NULL,         -- 目前只支持 'user'
  author_id INTEGER NOT NULL,       -- users.id
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_clip ON comments(clip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

-- ========== v4.0: 邀请码 / 邀请记录 ==========
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  inviter_id INTEGER NOT NULL,
  invitee_id INTEGER DEFAULT NULL,
  status TEXT DEFAULT 'pending',    -- 'pending' | 'used' | 'expired'
  used_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id);

-- ========== v4.0: 公告 ==========
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  pinned INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

-- ========== v4.0: 代码查看/审批 ==========
CREATE TABLE IF NOT EXISTS code_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  author_id TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  old_sha TEXT DEFAULT '',
  new_content TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ccr_status ON code_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_ccr_file ON code_change_requests(file_path);

-- ========== v4.0: 站点设置 ==========
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ========== v4.0: 官方反馈贴（Bug 反馈 / 意见反馈） ==========
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'bug',          -- 'bug' | 'suggestion'
  env TEXT DEFAULT '',                        -- Bug：发生环境
  situation TEXT DEFAULT '',                  -- Bug：具体情况
  console_log TEXT DEFAULT '',                -- Bug：选填 F12 报错
  content TEXT NOT NULL,                      -- 反馈正文
  contact TEXT DEFAULT '',                    -- 选填联系方式
  author_id TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  author_type TEXT DEFAULT 'guest',           -- 'user' | 'guest'
  status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'reviewing' | 'resolved' | 'rejected'
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- 默认邀请奖励配置
INSERT OR IGNORE INTO site_settings (key, value) VALUES (
  'invite_rewards',
  '{"inviter":[{"threshold":1,"reward":"all_features"},{"threshold":3,"reward":"vip"},{"threshold":5,"reward":"unlimited_chars_pin"},{"threshold":10,"reward":"developer_gift"}],"invitee":{"reward":"custom_slug"}}'
);

-- 全局默认功能开关
INSERT OR IGNORE INTO site_settings (key, value) VALUES (
  'default_feature_flags',
  '{"custom_slug":0,"max_views":1,"password":1,"expiry":1,"collaboration":1,"login_required":1,"max_readers":0,"comments":1}'
);

-- 全局字数限制默认值
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('global_char_limit', '150');

-- 限额配置
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('user_daily_limit', '5');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('user_monthly_limit', '50');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('guest_weekly_limit', '5');

-- VIP 联系微信二维码提示（管理员可改文案）
INSERT OR IGNORE INTO site_settings (key, value) VALUES (
  'vip_contact',
  '开通 VIP 请添加站长微信：扫描页面二维码或搜索 Young 添加好友'
);

-- 默认站点页面内容
INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'help',
  '使用帮助',
  '# 📋 mdqp 使用帮助

## 这是什么？

**mdqp**（Markdown quickly paste）是一个 Markdown 云剪贴板：**粘上就走，拿链接就分享**。

## 快速上手

1. 点「＋ 新建」
2. 把 Markdown 粘进编辑器（右侧实时预览）
3. 点「发布」，得到一个短链
4. 任何人打开链接即可查看；支持评论、@提及、分享

## 不登录能用吗？

能。**游客也可创建剪贴板**，限制如下：

- 每周最多 **5 个**
- 标记为「任何人可编辑/删除」的协作板
- 换浏览器 / 清缓存会失去管理权

登录后：
- 每天 **5 个**、每月 **50 个**剪贴板
- 每个剪贴板 **150 字**（中文全算、英文标点折半）
- 解锁全部高级功能

## 高级功能

| 功能 | 说明 | 默认 |
|---|---|---|
| 🔒 密码保护 | 访问密码才能查看 | ✅ 开放 |
| ⏳ 定时过期 | 1h/1d/7d/30d 后自动失效 | ✅ 开放 |
| 👁 阅读上限 | 按唯一人计算（非次数） | ❌ 需开启 |
| 🔗 自定义短链 | 发布时指定短链 | ❌ 需开启 |
| 🔒 登录可见 | 仅登录用户可查看 | ✅ 开放 |
| 📝 评论 | 登录用户可评论（支持 @mention） | ✅ 开放 |

## 邀请与 VIP

- 每位用户有专属邀请码和链接
- 邀请好友注册后双方获得奖励
- 邀请 **3 人** 可开通 **VIP**（金色标识）
- 更多奖励见邀请页面

## 账号与绑定

登录由 [cpoauth](https://www.cpoauth.com/) 提供。可绑定洛谷、Codeforces、AtCoder、GitHub 等账号。'
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'about',
  '关于 mdqp',
  '# 关于 mdqp

**mdqp** = **M**ark**d**own **q**uickly **p**aste。

## 定位

粘上就走，拿链接就分享的 Markdown 云剪贴板。

## 技术

- 前端：原生 HTML/CSS/JS（SPA，无构建）
- 后端：Cloudflare Workers（Hono）
- 数据库：Cloudflare D1（SQLite）
- 登录：[cpoauth](https://www.cpoauth.com/)（OAuth 2.0 + PKCE）

## 版本

当前版本 **v4.0**。'

);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'changelog',
  '更新日志',
  '# 📝 更新日志

mdqp 的主要版本变动记录。当前部署版本 **v4.0**。'
);
