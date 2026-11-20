// 生成 mdqptest/schema.sql（全新库一次性建表用）
// 背景：database_init.sql 的 CREATE TABLE 已含部分列，而历史 migrate_*.sql 里还有
// 对同一列的 ALTER ADD COLUMN。原迁移靠"手工忽略 duplicate column 错误"跑通，
// 但全量重放会直接失败。这里自动剔除与 CREATE TABLE 重复的 ALTER。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'database_init.sql',
  'migrate_account_features.sql', 'migrate_code_review.sql', 'migrate_cpoauth_token.sql',
  'migrate_feedback.sql', 'migrate_notifications.sql', 'migrate_password.sql',
  'migrate_password_guard.sql', 'migrate_source.sql', 'migrate_v3.2.sql', 'migrate_v3.4.sql',
  'migrate_v4.0.sql', 'migrate_v4.13.sql', 'migrate_v4.14.sql', 'migrate_v4.15.sql',
  'migrate_v4.17_chat.sql', 'migrate_v4.18_mute.sql', 'migrate_v4.19_sites.sql',
  'migrate_v4.20_sites_gov.sql', 'migrate_v4.6.sql',
  'migrations/2_3_2_4.sql', 'migrations/4_27.sql', 'migrations/4_29.sql'
];

// 1) 先建「表 -> 已定义列」索引
const base = readFileSync(resolve(root, 'database_init.sql'), 'utf8');
const declared = new Map(); // table -> Set(col)
for (const m of base.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
  const [, tbl, body] = m;
  const cols = new Set();
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    const c = t.match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB)/i);
    if (c) cols.add(c[1].toLowerCase());
  }
  declared.set(tbl.toLowerCase(), cols);
}

// 2) 逐个迁移文件，剔除重复 ADD COLUMN
let out = '-- mdqptest 全新库 schema（自动生成，勿手改）\n-- 由 scripts/gen-test-schema.mjs 拼接 database_init + 全部 migrate_*，\n-- 并自动跳过与 CREATE TABLE 重复的 ALTER ADD COLUMN。\n\n';
let skipped = 0, kept = 0;
for (const f of files) {
  const src = readFileSync(resolve(root, f), 'utf8');
  const lines = src.split('\n');
  const keptLines = [];
  for (const line of lines) {
    const am = line.match(/^\s*ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i);
    if (am) {
      const tbl = am[1].toLowerCase(), col = am[2].toLowerCase();
      if (declared.get(tbl)?.has(col)) { skipped++; continue; }
      declared.get(tbl)?.add(col); // 后续迁移再加同列也跳过
      kept++;
    }
    keptLines.push(line);
  }
  out += `-- ===== ${f} =====\n${keptLines.join('\n').trim()}\n\n`;
}

const dest = resolve(root, 'mdqptest', 'schema.sql');
writeFileSync(dest, out);
console.log(`✅ 已生成 ${dest}`);
console.log(`   跳过重复 ADD COLUMN: ${skipped} 条，保留 ${kept} 条`);
console.log(`   总行数 ${out.split('\n').length}，CREATE TABLE ${(out.match(/CREATE TABLE/gi) || []).length} 张`);