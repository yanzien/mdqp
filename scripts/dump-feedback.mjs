#!/usr/bin/env node
/**
 * 一键导出 mdqp 反馈（D1 feedback 表）—— 免去每次手工拼 wrangler 命令
 *
 * 用法（必须在 mdqp 目录下）：
 *   node scripts/dump-feedback.mjs                        # 最近 50 条，纯文本
 *   node scripts/dump-feedback.mjs --status=open          # 只看未处理
 *   node scripts/dump-feedback.mjs --status=open,reviewing # 状态多选
 *   node scripts/dump-feedback.mjs --id=2,3,8             # 多选指定 id
 *   node scripts/dump-feedback.mjs --limit=200            # 条数
 *   node scripts/dump-feedback.mjs --format=md --out=fb.md # 导出 Markdown 到文件
 *   node scripts/dump-feedback.mjs --full                 # 含 env / console_log（很长）
 *
 * 格式：text（默认，控制台速读）| md（Markdown 表格+详情，便于存档）| json
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const getArg = (k, d = '') => {
  const m = argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const hasFlag = (k) => argv.includes(`--${k}`);

const ids = getArg('id');
const status = getArg('status');
const limit = parseInt(getArg('limit', '50'), 10) || 50;
const format = getArg('format', 'text');
const outFile = getArg('out');
const full = hasFlag('full');

const cols = full ? '*' : 'id,type,status,author_name,created_at,situation,content';
const where = [];
if (ids) {
  const list = ids.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
  if (list.length) where.push(`id IN (${list.join(',')})`);
}
if (status) {
  const list = status.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  if (list.length) where.push(`status IN (${list.map((s) => `'${s}'`).join(',')})`);
}
const sql = `SELECT ${cols} FROM feedback${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit}`;

const cli = path.resolve('node_modules/wrangler/wrangler-dist/cli.js');
const raw = execSync(
  `"${process.execPath}" "${cli}" d1 execute mdqp-db --remote --command ${JSON.stringify(sql)} --json`,
  { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }
);
const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results || [];

let out;
if (format === 'json') {
  out = JSON.stringify(rows, null, 2);
} else if (format === 'md') {
  const L = ['# mdqp 反馈导出（' + rows.length + ' 条）', ''];
  L.push('| # | 类型 | 状态 | 提交者 | 时间 | 内容摘要 |');
  L.push('|---|---|---|---|---|---|');
  rows.forEach((r) => {
    const c = ((r.content || r.situation || '').replace(/\s+/g, ' ').slice(0, 80)).replace(/\|/g, '\\|');
    L.push(`| ${r.id} | ${r.type} | ${r.status} | ${r.author_name || '匿名'} | ${r.created_at} | ${c} |`);
  });
  L.push('', '## 详情', '');
  rows.forEach((r) => {
    L.push(`### #${r.id} · ${r.type} · ${r.status} · ${r.created_at} · ${r.author_name || '匿名'}`, '');
    if (r.situation) L.push('**情况**：', '```', r.situation, '```');
    if (r.content) L.push('**内容**：', '```', r.content, '```');
    if (full && r.env) L.push('**环境**：', '```', r.env, '```');
    if (full && r.console_log) L.push('**控制台日志**：', '```', r.console_log, '```');
    L.push('');
  });
  out = L.join('\n');
} else {
  const L = [];
  rows.forEach((r) => {
    L.push(`========== #${r.id} | ${r.type} | ${r.status} | ${r.created_at} | by ${r.author_name || '匿名'} ==========`);
    L.push(`[situation] ${r.situation || '(空)'}`);
    L.push(`[content] ${r.content || '(空)'}`);
    if (full) {
      L.push(`[env] ${r.env || '(空)'}`);
      L.push(`[console] ${r.console_log || '(空)'}`);
    }
    L.push('');
  });
  out = L.join('\n');
}

if (outFile) {
  fs.writeFileSync(outFile, out, 'utf8');
  console.log(`已导出 ${rows.length} 条 → ${outFile}`);
} else {
  console.log(out);
}
