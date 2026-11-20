-- mdqptest 全新库 schema（自动生成，勿手改）
-- 由 scripts/gen-test-schema.mjs 拼接 database_init + 全部 migrate_*，
-- 并自动跳过与 CREATE TABLE 重复的 ALTER ADD COLUMN。

-- ===== database_init.sql =====
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
  -- v4.10: 注册来源渠道收集（首次登录后询问）
  source TEXT DEFAULT '',            -- 来源渠道：offline/social/oj/other_share/random/ad/search/unknown，空=未填写
  source_detail TEXT DEFAULT '',     -- 来源补充说明（"其他分享"等时填写）
  source_set_at TEXT DEFAULT NULL,   -- 用户填写来源的时间，NULL=未填写（首次未问/跳过）
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
  reader_count INTEGER DEFAULT 0,       -- 当前唯一读者数（isExpired 判满员用；曾漏建导致详情 500）
  char_limit INTEGER DEFAULT NULL,      -- 字数限制覆盖（NULL=用全局默认）

  -- === v4.6 新增 ===
  tags TEXT DEFAULT '',                 -- 标签（逗号分隔小写，如 "算法,模板,dp"）
  pinned INTEGER DEFAULT 0,             -- 1=置顶（我的剪贴板排序优先）

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

-- ========== v4.5: 通知系统 ==========
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

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

-- M3 埋点（2026-09-10 建）
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app  TEXT NOT NULL DEFAULT 'mdqp',
  type TEXT NOT NULL,
  uid  TEXT DEFAULT '',
  ref  TEXT DEFAULT '',
  meta TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_app_type ON events(app, type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_uid_type ON events(uid, type, created_at); -- v4.10: page.view 去重查询加速

-- ========== v4.17: 聊天系统 ==========
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
  muted INTEGER DEFAULT 0,                 -- 1 = 免打扰（v4.18：不推送浏览器通知）
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

-- ===== migrate_account_features.sql =====
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

-- ===== migrate_code_review.sql =====
-- ========== v4.0: 代码查看/审批（查看代码 → 在线编辑 → 审批部署） ==========
-- 仅对已有数据库执行一次；database_init.sql 已含同构建表，新建库无需再跑本文件。
CREATE TABLE IF NOT EXISTS code_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  author_id TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  old_sha TEXT DEFAULT '',                 -- 提交时的 GitHub blob sha（用于查重提示）
  new_content TEXT DEFAULT '',             -- 拟写入的新内容
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  admin_note TEXT DEFAULT '',              -- 开发者处理备注（驳回原因 / 酌情采纳说明）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ccr_status ON code_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_ccr_file ON code_change_requests(file_path);

-- ===== migrate_cpoauth_token.sql =====
-- v4.3.1: 保存 cpoauth refresh_token 与 access_token 过期时间，用于退出时撤销
-- 注意：SQLite ALTER ADD COLUMN 幂等性差，部署脚本需先判断列是否已存在
ALTER TABLE users ADD COLUMN cpoauth_refresh TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN cpoauth_token_exp INTEGER DEFAULT 0;

-- ===== migrate_feedback.sql =====
-- ========== v4.0: 官方反馈贴（Bug 反馈 / 意见反馈） ==========
-- 仅对已有数据库执行一次；database_init.sql 已含同构建表，新建库无需再跑本文件。
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'bug',          -- 'bug' | 'suggestion'
  env TEXT DEFAULT '',                        -- Bug：发生环境（浏览器/系统/设备等）
  situation TEXT DEFAULT '',                  -- Bug：具体情况描述
  console_log TEXT DEFAULT '',                -- Bug：选填 F12 报错信息
  content TEXT NOT NULL,                      -- 反馈正文（Bug 的问题摘要 / 意见反馈内容）
  contact TEXT DEFAULT '',                    -- 选填联系方式
  author_id TEXT DEFAULT '',                  -- 提交者 ID（用户 id 或游客 UUID）
  author_name TEXT DEFAULT '',                -- 提交者昵称
  author_type TEXT DEFAULT 'guest',           -- 'user' | 'guest'
  status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'reviewing' | 'resolved' | 'rejected'
  admin_note TEXT DEFAULT '',                 -- 管理员处理备注
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- ===== migrate_notifications.sql =====
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

-- ===== migrate_password.sql =====
-- mdqp v4.0.1: 密码登录兜底（cpoauth 单点故障备用方案）
-- 仅含新增列，ALTER ADD COLUMN 在 SQLite 中安全、可重复执行的本质：
-- 若列已存在会报错 "duplicate column name: password_hash"，此时忽略即可。

-- ===== migrate_password_guard.sql =====
-- mdqp v4.3 · 密码登录限流表
-- 用于 /api/auth/password/login 的失败次数统计（防暴力破解）
-- 幂等：可重复执行

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,          -- 1=成功 0=失败
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 按 IP 查最近窗口的失败次数
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts (ip, created_at);

-- 按用户名查最近窗口的失败次数
CREATE INDEX IF NOT EXISTS idx_login_attempts_user
  ON login_attempts (username, created_at);

-- ===== migrate_source.sql =====
-- v4.10: 用户来源渠道收集 + events 去重索引
-- 在真实 D1 执行：
--   node ../node_modules/.bin/wrangler d1 execute mdqp-db --remote --file=./migrate_source.sql
-- （或 wrangler.toml 所在目录：wrangler d1 execute mdqp-db --remote --file=migrate_source.sql）


CREATE INDEX IF NOT EXISTS idx_events_uid_type ON events(uid, type, created_at);

-- ===== migrate_v3.2.sql =====
-- mdqp v3.2 迁移：用户管理 / 站点页面 / cpoauth 账号关联
-- 幂等：可重复执行

-- 1) users 表加角色 + 绑定账号（JSON）

-- 2) 首位用户（yanzie, id=1）册封为 developer
UPDATE users SET role = 'developer' WHERE id = 1;

-- 3) 站点页面（/help、/about），内容管理员可编辑
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,          -- 'help' | 'about'
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'help',
  '使用帮助',
  '# 📋 mdqp 使用帮助

## 这是什么？

**mdqp**（Markdown quickly paste）是一个 Markdown 云剪贴板：**粘上就走，拿链接就分享**。

## 快速上手

1. 点右上角「＋ 新建」
2. 把 Markdown 粘进编辑器（右侧实时预览）
3. 点「发布」，得到一个短链，例如 `https://mdqp.example.com/c/abc12345`
4. 任何人打开链接即可查看；你可以在详情页「复制内容」「Raw 直链」「二维码」

## 不登录能用吗？

能。**游客也可创建剪贴板**，限制如下：

- 最多 **5 个**
- 标记为「任何人可编辑/删除」的协作板
- 换浏览器 / 清缓存会失去管理权

用 **cpoauth 登录**后：不限量，且只有你能改自己的内容。

## 进阶功能

| 功能 | 说明 |
|---|---|
| 🔒 密码保护 | 高级选项里设置访问密码 |
| ⏳ 定时过期 | 1 小时 / 1 天 / 7 天 / 30 天后自动失效 |
| 👁 阅读次数上限 | 达到次数后自动失效（阅后即焚） |
| 🔗 自定义短链 | 发布时指定 3-32 位短链，如 `my-notes` |
| 🤝 协作板 | 登录用户可主动开放「任何人可编辑」 |
| 📥 Raw 直链 | `/raw/<短链>` 直接返回纯文本 |
| 📑 目录大纲 | 详情页 / 编辑器一键展开标题目录 |

## 账号与绑定

登录账号由 [cpoauth](https://www.cpoauth.com/) 提供。你可以在 cpoauth 绑定洛谷、Codeforces、AtCoder、GitHub 等账号，绑定后会在你的 mdqp 个人主页展示。

## 遇到问题？

- 输入法打不了字？本站已适配中文输入法，请尝试刷新页面
- 打不开本站？本站部署在 Cloudflare，部分地区网络可能需要自备加速
- 其他问题请联系站点管理员'
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'about',
  '关于 mdqp',
  '# 关于 mdqp

**mdqp** = **M**ark**d**own **q**uickly **p**aste。

## 定位

粘上就走，拿链接就分享的 Markdown 云剪贴板：

- **免登录也能用**（游客模式）
- 登录后不限量，且只有你能改自己的内容
- 任何人凭短链都能访问、查看作者主页

## 技术

- 前端：原生 HTML/CSS/JS（SPA，无构建）
- 后端：Cloudflare Workers（Hono）
- 数据库：Cloudflare D1（SQLite）
- 登录：[cpoauth](https://www.cpoauth.com/)（OAuth 2.0 + PKCE）

## 隐私

- 密码保护使用 SHA-256 哈希，密码原文不落库
- 公开剪贴板任何人可见；「仅链接可见」的板不出现在列表
- 过期 / 超次数的剪贴板自动失效

---

由 [yanzien](/u/1) 开发维护 · 本页面由管理员编辑'
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'changelog',
  '更新日志',
  '# 📝 更新日志

本页记录 mdqp 的主要版本变动，由管理员维护。

## v3.3（2026-08）
- 前端性能：代码高亮 highlight.js 改为**按需加载**，首屏不再阻塞
- 公开接口加 `Cache-Control` 缓存头，降低回源压力
- 新增**更新日志**页（本页）
- 关联账号管理跳转改为 cpoauth 个人中心
- 搜索关键词限长 100 字符，防滥用

## v3.2（2026-08）
- 用户管理：角色（用户/管理员/开发者）、册封/撤管理员、删号
- 管理后台 `/admin`：用户列表、全部剪贴板、站点页面
- 站点页面 `/help` `/about`：管理员可编辑
- 个人主页展示 cpoauth 绑定账号（洛谷等）+ 个人介绍

## v3.1（2026-08）
- 适配中文输入法（IME）在输入框被 Enter 劫持的问题
- 代码高亮、编辑器/查看器目录大纲

## v3.0
- 基于 Cloudflare Workers + D1 全栈重写
- 免登录可用、密码保护、定时过期、阅读次数上限、自定义短链、Raw 直链'
);

-- ===== migrate_v3.4.sql =====
-- mdqp v3.2 → v3.4 迁移（幂等，可重复执行）
-- 新增：signature（个性签名）、clip_limit/limit_period（剪贴板限制）、admin_permissions（管理员权限）

-- ===== migrate_v4.0.sql =====
-- mdqp D1 Database Migration v3.8 → v4.0
-- 幂等：每条 ALTER/CREATE 都用 IF NOT EXISTS 或 guard

-- ========== 1. 用户表扩展 ==========
-- VIP 系统
-- VIP 到期时间（NULL=永久）。注意：v1 版迁移漏了此列，会导致 /api/me 选 vip_until 报 SQL 错→500→登录态回退。已补。
-- 邀请系统（注意：不能直接 ADD COLUMN ... UNIQUE DEFAULT ''，否则线上已有用户会被填成 '' 触发唯一冲突）
-- 为已有用户补一个唯一邀请码（新注册用户由 /api/invite/me 自动生成；UNIQUE 索引允许 NULL 故不影响新用户）
UPDATE users SET invite_code = 'U' || id || '-' || lower(hex(randomblob(3))) WHERE invite_code IS NULL OR invite_code = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
-- 功能开关（JSON，每个功能独立开关）

-- ========== 2. 剪贴板表扩展 ==========
-- 登录门禁（仅登录用户可查看）
-- 唯一读者上限（0=不限，按人不算次数）
-- 字数限制覆盖（NULL=用全局默认150）

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

-- ===== migrate_v4.13.sql =====
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

-- ===== migrate_v4.14.sql =====
-- v4.14: 统一工单系统（合并「反馈」与「内容举报」为公开工单，仿洛谷工单）
-- 幂等：表用 IF NOT EXISTS；回灌用 legacy 标记防重跑重复插入。

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- 工单号，如 TK2F9A1B3C
  category TEXT NOT NULL DEFAULT 'other',     -- bug | suggestion | report | other
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',           -- 描述（Markdown / 纯文本）
  author_id TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  author_type TEXT DEFAULT 'guest',           -- user | guest
  status TEXT NOT NULL DEFAULT 'open',        -- open | reviewing | resolved | rejected
  assignee_id TEXT DEFAULT '',
  assignee_name TEXT DEFAULT '',
  related_clip_id TEXT DEFAULT '',           -- 举报类关联的剪贴板
  related_clip_reason TEXT DEFAULT '',
  is_public INTEGER DEFAULT 1,                -- 是否对所有用户可见（默认公开）
  legacy INTEGER DEFAULT 0,                   -- 1=由旧表迁移而来（用于幂等回灌）
  admin_note TEXT DEFAULT '',                 -- 处理说明 / 管理员结论
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(code);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_related_clip ON tickets(related_clip_id);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  author_id TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  author_type TEXT DEFAULT 'guest',
  is_staff INTEGER DEFAULT 0,                 -- 1=管理员 / 官方回复
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket ON ticket_replies(ticket_id, created_at ASC);

-- 回灌旧反馈（feedback）→ 工单
INSERT INTO tickets (code, category, title, content, author_id, author_name, author_type, status, admin_note, legacy, created_at, updated_at)
SELECT
  'TK' || substr(hex(randomblob(6)), 1, 8),
  CASE type WHEN 'suggestion' THEN 'suggestion' ELSE 'bug' END,
  CASE type WHEN 'suggestion' THEN '意见反馈' ELSE 'Bug 反馈' END,
  COALESCE(content, ''),
  author_id, author_name, author_type,
  CASE status WHEN 'reviewing' THEN 'reviewing' WHEN 'resolved' THEN 'resolved' WHEN 'rejected' THEN 'rejected' ELSE 'open' END,
  COALESCE(admin_note, ''),
  1,
  created_at, updated_at
FROM feedback
WHERE (SELECT COUNT(*) FROM tickets WHERE legacy = 1 AND category IN ('bug','suggestion')) = 0;

-- 回灌旧举报（clip_reports）→ 工单（保留关联剪贴板，便于管理员删除违规内容）
INSERT INTO tickets (code, category, title, content, author_id, author_name, author_type, status, related_clip_id, related_clip_reason, legacy, created_at, updated_at, resolved_at)
SELECT
  'TK' || substr(hex(randomblob(6)), 1, 8),
  'report',
  '举报内容：' || COALESCE((SELECT title FROM clipboards c WHERE c.clip_id = r.clip_id), r.clip_id),
  ('【举报原因】' || COALESCE(r.reason, '') || char(10) || COALESCE(r.detail, '')),
  r.reporter_id, '', 'user',
  CASE r.status WHEN 'resolved' THEN 'resolved' ELSE 'open' END,
  r.clip_id, r.reason,
  1,
  r.created_at, COALESCE(r.resolved_at, r.created_at), r.resolved_at
FROM clip_reports r
WHERE (SELECT COUNT(*) FROM tickets WHERE legacy = 1 AND category = 'report') = 0;

-- ===== migrate_v4.15.sql =====
-- v4.15: 管理员权限细粒化 + 层级（admin_level）
-- 新增 admin_level 字段：1-5 表示管理员层级（developer 视为 99，由代码判定，不在本列体现）。
-- 层级规则：层级 L 的管理员只能管理层级 < L 的管理员与普通用户，不能管理同级或更高层级者，也不能碰 developer。

-- 幂等：列已存在时 D1 会报错，用简单探测避免重跑失败。
-- SQLite/D1 不支持 "ADD COLUMN IF NOT EXISTS"，故先尝试添加，失败可忽略。
ALTER TABLE users ADD COLUMN admin_level INTEGER NOT NULL DEFAULT 1;

-- 存量管理员（role='admin' 且无层级）统一归为 1 级（最小权限，符合「先给最小权限」原则）；开发者不受影响。
UPDATE users SET admin_level = 1 WHERE role = 'admin' AND (admin_level IS NULL OR admin_level = 0);

-- ===== migrate_v4.17_chat.sql =====
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

-- ===== migrate_v4.18_mute.sql =====
-- ============================================================
-- mdqp v4.18.0 迁移：聊天消息免打扰
-- 变更：chat_members 增加 muted 列（1 = 免打扰，不推送浏览器通知、未读改为静默小点）
--
-- 执行：
--   node_modules/wrangler/bin/wrangler.js d1 execute mdqp-db --remote --file=migrate_v4.18_mute.sql
--
-- 注意：SQLite 不支持 ADD COLUMN IF NOT EXISTS。
--   重复执行会报 `duplicate column name: muted`，属预期，可安全忽略。
--   建议先跑一次探测确认列是否已存在：
--     wrangler d1 execute mdqp-db --remote --command="SELECT COUNT(*) FROM pragma_table_info('chat_members') WHERE name='muted';"
--   （返回 0 才需要执行下面的 ALTER）
-- ============================================================

-- ===== migrate_v4.19_sites.sql =====
-- v4.19.0 用户快速部署网站：站点元数据表（文件本体存 KV，不在此表）
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | suspended
  size_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_id);
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);

-- ===== migrate_v4.20_sites_gov.sql =====
-- v4.20.0 站点治理：举报关联站点 + 封禁原因 + 清理死列
-- 幂等：可重复执行

-- 1) 工单可关联被举报的站点（站点举报走统一工单系统）
ALTER TABLE tickets ADD COLUMN related_site_slug TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_site ON tickets(related_site_slug);

-- 2) 站点封禁原因（管理员封禁时填写，展示给站长）
ALTER TABLE sites ADD COLUMN suspend_reason TEXT;

-- 3) P0-1.4：sites.hits 是建了从不更新的死列，删除避免误导
ALTER TABLE sites DROP COLUMN hits;

-- ===== migrate_v4.6.sql =====
-- mdqp v4.6 迁移：我的剪贴板 2.0（标签 / 置顶）+ 字数分级后的站点默认值
-- 幂等：ALTER 重复执行会报 duplicate column，脚本已忽略该错误

-- 1. 剪贴板标签（逗号分隔小写串，如 "算法,模板,dp"）

-- 2. 剪贴板置顶（1=置顶，排序时优先）

-- 3. 我的剪贴板列表查询索引（置顶优先 + 更新时间倒序）
CREATE INDEX IF NOT EXISTS idx_clipboards_owner_pinned ON clipboards(owner_type, owner_id, pinned DESC, updated_at DESC);

-- 4. v4.6 起单篇字数改为按信任等级分级（L0/L1 1500 · L2 5000 · L3/VIP 不限）
--    global_char_limit 现在只作为「游客」的兜底额度，从 300 提到 1500
UPDATE site_settings SET value = '1500' WHERE key = 'global_char_limit';
INSERT INTO site_settings (key, value) SELECT 'global_char_limit', '1500'
  WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'global_char_limit');

-- ===== migrations/2_3_2_4.sql =====
-- v4.26.0：2.3 站点快照配额 + 2.4 聊天增强
-- 2.3：用户快照配额（NULL=按 VIP 派生：普通 3 / VIP 5）
ALTER TABLE users ADD COLUMN snapshot_quota INTEGER DEFAULT NULL;

-- 2.4：聊天增强
ALTER TABLE chat_conversations ADD COLUMN announcement TEXT DEFAULT '';
ALTER TABLE chat_conversations ADD COLUMN avatar TEXT DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN recalled INTEGER DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN mentions TEXT DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN attach_type TEXT DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN attach_id TEXT DEFAULT '';

-- ===== migrations/4_27.sql =====
-- v4.27：站点管控 / 功能禁用 / 用户标签
ALTER TABLE users ADD COLUMN disabled_features INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN tag TEXT DEFAULT '';

-- ===== migrations/4_29.sql =====
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

