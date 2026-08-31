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
