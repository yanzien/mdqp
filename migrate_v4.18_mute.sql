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

ALTER TABLE chat_members ADD COLUMN muted INTEGER DEFAULT 0;
