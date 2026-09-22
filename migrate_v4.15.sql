-- v4.15: 管理员权限细粒化 + 层级（admin_level）
-- 新增 admin_level 字段：1-5 表示管理员层级（developer 视为 99，由代码判定，不在本列体现）。
-- 层级规则：层级 L 的管理员只能管理层级 < L 的管理员与普通用户，不能管理同级或更高层级者，也不能碰 developer。

-- 幂等：列已存在时 D1 会报错，用简单探测避免重跑失败。
-- SQLite/D1 不支持 "ADD COLUMN IF NOT EXISTS"，故先尝试添加，失败可忽略。
ALTER TABLE users ADD COLUMN admin_level INTEGER NOT NULL DEFAULT 1;

-- 存量管理员（role='admin' 且无层级）统一归为 1 级（最小权限，符合「先给最小权限」原则）；开发者不受影响。
UPDATE users SET admin_level = 1 WHERE role = 'admin' AND (admin_level IS NULL OR admin_level = 0);
