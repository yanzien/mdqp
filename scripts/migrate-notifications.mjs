// 通知系统迁移：notifications 表 + users/clipboards 加列（幂等，可重复跑）
import { execSync } from 'node:child_process';

const DB = 'mdqp-db';
const WR = 'node_modules/wrangler/wrangler-dist/cli.js';

function d1(sql) {
  const clean = String(sql).replace(/\s+/g, ' ').trim();
  return execSync(`node ${WR} d1 execute ${DB} --remote --command ${JSON.stringify(clean)}`, { encoding: 'utf8' });
}
function addColumn(table, col, def) {
  try {
    d1(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`+ ${table}.${col}`);
  } catch (e) {
    const s = String(e.stderr || e.stdout || e);
    if (/duplicate column|already exists/i.test(s)) console.log(`= ${table}.${col} 已存在，跳过`);
    else throw e;
  }
}

// 通知表
d1('CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT DEFAULT "", link TEXT DEFAULT "", is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime("now")))');
d1('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at)');

// 加列
addColumn('users', 'last_trust_level', 'INTEGER DEFAULT 0');
addColumn('clipboards', 'visit_notified', 'INTEGER DEFAULT 0');
addColumn('clipboards', 'expiry_notified', 'INTEGER DEFAULT 0');

console.log('✅ 通知系统迁移完成');
