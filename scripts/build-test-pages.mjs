// mdqptest 构建：与主站同一份 public/ 与 worker，但加一层「测试站密码门」
// 产物 → pages-build-test（勿与主站 pages-build 混用）
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'pages-build-test');

function rmTree(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) rmTree(resolve(p, e));
    try { rmdirSync(p); } catch {}
  } else {
    try { unlinkSync(p); } catch {}
  }
}
rmTree(out);
mkdirSync(out, { recursive: true });
cpSync(resolve(root, 'public'), out, { recursive: true });

// ---- 生成测试站专用入口：先过密码门，再委托给主 worker ----
const gate = resolve(root, 'mdqptest', 'gate.js');
const esbuildShim = resolve(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const nodeBin = process.execPath;

execSync(
  `"${nodeBin}" "${esbuildShim}" "${gate}" --bundle --platform=neutral --format=esm --outfile=pages-build-test/_worker.js --external:cloudflare:* --banner:js="export const env=globalThis;"`,
  { cwd: root, stdio: 'inherit' }
);

// ---- 站点标题打上 TEST 标记，避免与主站混淆 ----
try {
  const idxPath = resolve(out, 'index.html');
  let html = readFileSync(idxPath, 'utf8');
  html = html.replace(/<title>([^<]*)<\/title>/i, '<title>[$1] (mdqp 测试站)</title>');
  writeFileSync(idxPath, html);
} catch { /* index.html 不存在则跳过 */ }

console.log('✅ pages-build-test 已就绪：', out);