-- v4.27：站点管控 / 功能禁用 / 用户标签
ALTER TABLE users ADD COLUMN disabled_features INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN tag TEXT DEFAULT '';
