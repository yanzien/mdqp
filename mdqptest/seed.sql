-- mdqptest 独立数据库初始化 + 种子数据
-- 用法：wrangler d1 execute mdqp-test-db --remote --file=mdqptest/schema.sql
--      然后 wrangler d1 execute mdqp-test-db --remote --file=mdqptest/seed.sql

-- uid=1 站长（yanzien），密码 mdqptest123456
-- password_hash = SHA-256('mdqp$' || 'mdqptest123456')
INSERT OR IGNORE INTO users (id, sub, username, display_name, provider, password_hash, role, admin_level, admin_permissions, tag, bio, signature, invite_code, created_at, last_login)
VALUES (1, NULL, 'yanzien', 'yanzien（站长）', 'password',
        '057f0ec0bcea96b84fb150edabb45631d791e656717156eedc7f8f438ac44c0f', 'developer', 3, '{}', '站长', 'mdqp 测试站站长账号', '测试站专用',
        'TESTADM01', datetime('now'), datetime('now'));