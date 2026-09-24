-- mdqp v4.6 迁移：我的剪贴板 2.0（标签 / 置顶）+ 字数分级后的站点默认值
-- 幂等：ALTER 重复执行会报 duplicate column，脚本已忽略该错误

-- 1. 剪贴板标签（逗号分隔小写串，如 "算法,模板,dp"）
ALTER TABLE clipboards ADD COLUMN tags TEXT DEFAULT '';

-- 2. 剪贴板置顶（1=置顶，排序时优先）
ALTER TABLE clipboards ADD COLUMN pinned INTEGER DEFAULT 0;

-- 3. 我的剪贴板列表查询索引（置顶优先 + 更新时间倒序）
CREATE INDEX IF NOT EXISTS idx_clipboards_owner_pinned ON clipboards(owner_type, owner_id, pinned DESC, updated_at DESC);

-- 4. v4.6 起单篇字数改为按信任等级分级（L0/L1 1500 · L2 5000 · L3/VIP 不限）
--    global_char_limit 现在只作为「游客」的兜底额度，从 300 提到 1500
UPDATE site_settings SET value = '1500' WHERE key = 'global_char_limit';
INSERT INTO site_settings (key, value) SELECT 'global_char_limit', '1500'
  WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'global_char_limit');
