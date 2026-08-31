-- mdqp v3.2 → v3.4 迁移（幂等，可重复执行）
-- 新增：signature（个性签名）、clip_limit/limit_period（剪贴板限制）、admin_permissions（管理员权限）

ALTER TABLE users ADD COLUMN signature TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN clip_limit INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN limit_period TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN limit_start TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN admin_permissions TEXT DEFAULT '{}';
