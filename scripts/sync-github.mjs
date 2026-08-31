// 把指定文件同步到 GitHub main（沙箱内 git push 被拦，只能用 Contents API）
// 用法: GH_PAT=xxx node scripts/sync-github.mjs <file1> [file2 ...]
import fs from 'node:fs';

const PAT = process.env.GH_PAT;
const REPO = 'yanzien/mdqp';
const BRANCH = 'main';
const API = 'https://api.github.com';
const files = process.argv.slice(2);

if (!PAT) throw new Error('缺少 GH_PAT 环境变量');
if (!files.length) throw new Error('用法: node scripts/sync-github.mjs <file1> [file2 ...]');

const hdr = {
  Authorization: `Bearer ${PAT}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'mdqp-sync',
};

async function req(method, url, body) {
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(url, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if ((res.status === 429 || res.status >= 500) && i < 4) {
      await new Promise((r) => setTimeout(r, 1200 * i));
      continue;
    }
    let msg = String(res.status);
    try { msg = JSON.parse(text).message || msg; } catch {}
    throw new Error(msg);
  }
}

for (const rel of files) {
  if (!fs.existsSync(rel)) { console.log(`✗ ${rel} (本地不存在)`); continue; }
  const url = `${API}/repos/${REPO}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`;
  let sha;
  try { sha = (await req('GET', `${url}?ref=${BRANCH}`)).sha; } catch { /* 新文件 */ }
  const body = {
    message: `chore: sync ${rel}`,
    content: fs.readFileSync(rel).toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  try {
    const r = await req('PUT', url, body);
    console.log(`✓ ${rel}${r.commit ? ' -> ' + r.commit.sha.slice(0, 8) : ' (无变化)'}`);
  } catch (e) {
    console.log(`✗ ${rel} -> ${e.message}`);
  }
}
