// 一键同步站点文档：更新日志 + 帮助页
//   CHANGELOG.md  -> public/app.js 顶部的 CHANGELOG_MD 常量（/changelog 页直接读它）
//   docs/help.md  -> 远程 D1 的 pages.help（/help 页从数据库读，不读本地文件）
//
// 用法：
//   node scripts/sync-docs.mjs            # 全量同步
//   node scripts/sync-docs.mjs changelog  # 仅同步更新日志
//   node scripts/sync-docs.mjs help       # 仅同步帮助页
//   node scripts/sync-docs.mjs --check    # 只检查是否过期，不写入（适合发布前自检）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NODE = process.execPath;
const CLI = 'node_modules/wrangler/wrangler-dist/cli.js';
const DB = 'mdqp-db';
const HELP_TITLE = '📋 mdqp 使用帮助';

const args = process.argv.slice(2);
const only = args.find((a) => ['changelog', 'help'].includes(a));
const checkOnly = args.includes('--check');

/* ---------------- 更新日志：CHANGELOG.md -> app.js ---------------- */
function syncChangelog() {
  let md = fs.readFileSync('CHANGELOG.md', 'utf8').trim();
  // 去掉内部维护约定块（以 > 开头、含「维护约定」，直到下一个 --- 分隔线；不面向用户展示）
  md = md.replace(/^>.*维护约定[\s\S]*?(?=\n---)/m, '').replace(/\n{3,}/g, '\n\n').trim();
  const escaped = md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

  const appPath = 'public/app.js';
  let app = fs.readFileSync(appPath, 'utf8');
  const mark = app.indexOf('// 更新日志：随代码发布自动同步');
  if (mark === -1) throw new Error('未找到 CHANGELOG_MD 起始标记');
  const head = 'const CHANGELOG_MD = `';
  const bodyStart = app.indexOf(head, mark);
  if (bodyStart === -1) throw new Error('未找到 CHANGELOG_MD 常量');
  const from = bodyStart + head.length;
  const bodyEnd = app.indexOf('`;', from);
  if (bodyEnd === -1) throw new Error('未找到 CHANGELOG_MD 结束标记');

  if (app.slice(from, bodyEnd) === escaped) {
    console.log('• 更新日志：已是最新，无需写入');
    return false;
  }
  if (checkOnly) {
    console.log('✗ 更新日志：app.js 中的 CHANGELOG_MD 落后于 CHANGELOG.md');
    return true;
  }
  fs.writeFileSync(appPath, app.slice(0, from) + escaped + app.slice(bodyEnd), 'utf8');
  console.log(`✓ 更新日志：已写入 app.js（${escaped.length} 字符）`);
  return true;
}

/* ---------------- 帮助页：docs/help.md -> D1 pages.help ---------------- */
function d1(sql, label) {
  fs.writeFileSync('tmp/_exec.sql', sql, 'utf8');
  const out = execFileSync(NODE, [CLI, 'd1', 'execute', DB, '--remote', '--file', 'tmp/_exec.sql'], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  if (!/"success":\s*true/.test(out)) { console.log(out.slice(-600)); throw new Error(label + ' 执行失败'); }
}

function remoteHelp() {
  const out = execFileSync(NODE, [CLI, 'd1', 'execute', DB, '--remote', '--json', '--command',
    "SELECT content FROM pages WHERE slug='help';"], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const j = out.indexOf('[\n');
  if (j === -1) return null;
  return JSON.parse(out.slice(j))[0]?.results?.[0]?.content ?? null;
}

function syncHelp() {
  const md = fs.readFileSync('docs/help.md', 'utf8');
  const cur = remoteHelp();
  if (cur === md) { console.log('• 帮助页：数据库已是最新，无需写入'); return false; }
  if (checkOnly) { console.log('✗ 帮助页：数据库 pages.help 落后于 docs/help.md'); return true; }
  if (cur !== null) fs.writeFileSync('tmp/db_pages_help_backup.md', cur, 'utf8');
  const esc = (s) => s.replace(/'/g, "''");
  d1(`UPDATE pages SET title='${esc(HELP_TITLE)}', content='${esc(md)}', updated_at=datetime('now'), updated_by='system' WHERE slug='help';`, 'pages.help');
  console.log(`✓ 帮助页：已写入数据库（${md.length} 字符）`);
  return true;
}

/* ---------------- 主流程 ---------------- */
fs.mkdirSync('tmp', { recursive: true });
let changed = false;
if (!only || only === 'changelog') changed = syncChangelog() || changed;
if (!only || only === 'help') changed = syncHelp() || changed;

if (checkOnly) {
  if (changed) { console.error('\n文档未同步，请先运行: node scripts/sync-docs.mjs'); process.exit(1); }
  console.log('\n✓ 文档全部同步');
} else if (changed) {
  fs.rmSync('tmp/_exec.sql', { force: true });
  console.log('\n下一步：npm run pages:build 并部署（帮助页走数据库，改完即生效无需部署）');
}
