-- v4.10: 用户来源渠道收集 + events 去重索引
-- 在真实 D1 执行：
--   node ../node_modules/.bin/wrangler d1 execute mdqp-db --remote --file=./migrate_source.sql
-- （或 wrangler.toml 所在目录：wrangler d1 execute mdqp-db --remote --file=migrate_source.sql）

ALTER TABLE users ADD COLUMN source TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN source_detail TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN source_set_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_events_uid_type ON events(uid, type, created_at);
