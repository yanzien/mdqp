-- mdqp v4.0.1: 密码登录兜底（cpoauth 单点故障备用方案）
-- 仅含新增列，ALTER ADD COLUMN 在 SQLite 中安全、可重复执行的本质：
-- 若列已存在会报错 "duplicate column name: password_hash"，此时忽略即可。
ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT '';
