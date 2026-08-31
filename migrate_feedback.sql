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
