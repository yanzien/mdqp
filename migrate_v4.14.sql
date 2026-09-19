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
