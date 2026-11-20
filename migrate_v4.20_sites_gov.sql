-- v4.20.0 站点治理：举报关联站点 + 封禁原因 + 清理死列
-- 幂等：可重复执行

-- 1) 工单可关联被举报的站点（站点举报走统一工单系统）
ALTER TABLE tickets ADD COLUMN related_site_slug TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_site ON tickets(related_site_slug);

-- 2) 站点封禁原因（管理员封禁时填写，展示给站长）
ALTER TABLE sites ADD COLUMN suspend_reason TEXT;

-- 3) P0-1.4：sites.hits 是建了从不更新的死列，删除避免误导
ALTER TABLE sites DROP COLUMN hits;
