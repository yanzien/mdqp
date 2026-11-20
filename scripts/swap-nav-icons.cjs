const fs = require('fs');
const p = 'C:/Users/xinyu6290/WorkBuddy/2026-08-13-20-39-22/mdqp/public/index.html';
let html = fs.readFileSync(p, 'utf8');

const ICONS = {
  home: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 20v-5h5v5"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  me: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  chat: '<path d="M20 14a2 2 0 0 1-2 2H9l-4 4V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2z"/>',
  sites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
  invite: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 13h16M12 9v11"/><path d="M9 9c0-1.8 3-3 3-3s3 1.2 3 3"/>',
  vip: '<path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.9 6.9 19.2l1-5.7-4.1-4 5.7-.8z"/>',
  oiwb: '<path d="M12 3c3.2 1.8 5 5 5 9l-2.5 2H9.5L7 12c0-4 1.8-7.2 5-9z"/><circle cx="12" cy="10" r="1.7"/><path d="M9 19l-1.5 3M15 19l1.5 3"/>',
  admin: '<path d="M12 3l7 3v5.5c0 4.3-3 7.5-7 9-4-1.5-7-4.7-7-9V6z"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1 .9-1 1.8"/><path d="M12 17h.01"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  changelog: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  tickets: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M13 7v10" stroke-dasharray="2 2"/>',
};
const LABELS = {
  home: '首页', new: '新建剪贴板', me: '我的', chat: '聊天', sites: '网站', invite: '邀请',
  vip: 'VIP', oiwb: '去 oiwb', admin: '管理后台', code: '查看代码', help: '帮助',
  about: '关于', changelog: '更新日志', tickets: '工单'
};
const svgFor = (k) =>
  '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + '</svg>';

const re = /<a\b([^>]*\bdata-nav="(\w+)"[^>]*)>([\s\S]*?)<\/a>/g;
let count = 0;
html = html.replace(re, (m, attrs, nav) => {
  if (!ICONS[nav]) return m;
  let a = attrs;
  const label = LABELS[nav] || nav;
  if (!/\btitle=/.test(a)) a += ' title="' + label + '"';
  if (!/\bdata-tip=/.test(a)) a += ' data-tip="' + label + '"';
  const inner = '<span class="nav-ico">' + svgFor(nav) + '</span><span class="nav-label">' + label + '</span>';
  count++;
  return '<a' + a + '>' + inner + '</a>';
});
fs.writeFileSync(p, html);
console.log('replaced', count, 'nav items');
