// v4.7 迁移：账号互通 + oiwb 快照同步
//   oiwb_tickets: jti TEXT PK · uid · scope · exp · used_at · created_at
//   oiwb_snapshots: uid INTEGER PK · size · blob · updated_at
import { execSync } from 'node:child_process';

const DB = 'mdqp-db';
const WR = 'node_modules/wrangler/wrangler-dist/cli.js';

function d1(sql) {
  const clean = String(sql).replace(/\s+/g, ' ').trim();
  return execSync(`node ${WR} d1 execute ${DB} --remote --command ${JSON.stringify(clean)}`, { encoding: 'utf8' });
}
function verify(sql) {
  return d1(sql);
}

console.log('=== v4.7 迁移开始 ===');

// 1. 跨站 ticket / refresh 吊销表
d1('CREATE TABLE IF NOT EXISTS oiwb_tickets (jti TEXT PRIMARY KEY, uid INTEGER NOT NULL, scope TEXT NOT NULL, exp INTEGER NOT NULL, used_at INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime(\'%s\', \'now\')))');
d1('CREATE INDEX IF NOT EXISTS idx_oiwb_tickets_uid ON oiwb_tickets(uid, exp)');
console.log('+ oiwb_tickets');

// 2. oiwb 快照表
d1('CREATE TABLE IF NOT EXISTS oiwb_snapshots (uid INTEGER PRIMARY KEY, size INTEGER NOT NULL, blob TEXT NOT NULL, updated_at INTEGER NOT NULL)');
console.log('+ oiwb_snapshots');

console.log('=== 反查验证 ===');
console.log(verify('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (\'oiwb_tickets\', \'oiwb_snapshots\')'));
console.log(verify('SELECT sql FROM sqlite_master WHERE name = \'oiwb_tickets\''));
console.log(verify('SELECT sql FROM sqlite_master WHERE name = \'oiwb_snapshots\''));
console.log('✅ v4.7 迁移完成');