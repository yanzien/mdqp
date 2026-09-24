// 校验「老内核兜底提示」脚本：① 必须是纯 ES5（IE 才能解析）② IE UA 下必须真的输出提示 ③ 现代浏览器不得误伤
// 用法：node scripts/check-legacy.mjs
import fs from 'fs';
import vm from 'vm';

const ROOT = 'C:/Users/xinyu6290/WorkBuddy/2026-08-13-20-39-22/';
const files = [
  ['oiwb  ', ROOT + 'oiwb/index.html'],
  ['mdqp  ', ROOT + 'mdqp/public/index.html'],
];
const ES6_MARKS = [['箭头函数', '=>'], ['模板字符串', '`'], ['const', 'const '], ['let', 'let '], ['class', 'class '], ['可选链', '?.'], ['展开', '...']];

function run(code, ua, win) {
  let out = '';
  const sandbox = { navigator: { userAgent: ua }, window: win, document: { write: (s) => { out += s; } } };
  sandbox.window.navigator = sandbox.navigator;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return out;
}

const IE_UA = 'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko';
const NEW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const OLD_WIN = { Promise: undefined };                               // IE：无 Promise / URLSearchParams
const NEW_WIN = { Promise: function () {}, URLSearchParams: function () {} }; // 现代浏览器

let fail = 0;
for (const [tag, path] of files) {
  const html = fs.readFileSync(path, 'utf8');
  const m = html.match(/<script>([\s\S]*?老内核兜底提示[\s\S]*?)<\/script>/);
  if (!m) { console.log(tag + ' ❌ 未找到兜底脚本'); fail++; continue; }
  const code = m[1];

  // ① ES5 纯净度
  const hits = ES6_MARKS.filter(([, s]) => code.indexOf(s) > -1).map(([n]) => n);
  console.log(tag + ' ES5 纯净度: ' + (hits.length ? '❌ 含 ' + hits.join('/') : '✅ 无 ES6 语法'));
  if (hits.length) fail++;

  // ② IE 下必须输出提示
  const ieOut = run(code, IE_UA, OLD_WIN);
  const ok = ieOut.indexOf('legacy-mask') > -1
    && ieOut.indexOf('pc.qq.com/detail/1/detail_321.html') > -1
    && ieOut.indexOf('firefox.com') > -1;
  console.log(tag + ' IE11 触发:  ' + (ok ? '✅ 输出提示（' + ieOut.length + ' 字节，含两个下载入口）' : '❌ 未输出'));
  if (!ok) fail++;

  // ③ 现代浏览器不得误伤
  const newOut = run(code, NEW_UA, NEW_WIN);
  const quiet = newOut === '';
  console.log(tag + ' 现代浏览器:  ' + (quiet ? '✅ 不打扰' : '❌ 误弹提示'));
  if (!quiet) fail++;
}
console.log(fail ? '\n=== 有 ' + fail + ' 项未通过 ===' : '\n=== 全部通过 ===');
process.exit(fail ? 1 : 0);
