-- v4.3.1: 保存 cpoauth refresh_token 与 access_token 过期时间，用于退出时撤销
-- 注意：SQLite ALTER ADD COLUMN 幂等性差，部署脚本需先判断列是否已存在
ALTER TABLE users ADD COLUMN cpoauth_refresh TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN cpoauth_token_exp INTEGER DEFAULT 0;
