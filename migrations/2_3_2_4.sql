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
