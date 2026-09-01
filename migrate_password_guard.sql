-- mdqp v4.3 · 密码登录限流表
-- 用于 /api/auth/password/login 的失败次数统计（防暴力破解）
-- 幂等：可重复执行

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,          -- 1=成功 0=失败
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 按 IP 查最近窗口的失败次数
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts (ip, created_at);

-- 按用户名查最近窗口的失败次数
CREATE INDEX IF NOT EXISTS idx_login_attempts_user
  ON login_attempts (username, created_at);
