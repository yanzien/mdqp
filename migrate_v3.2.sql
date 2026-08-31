-- mdqp v3.2 迁移：用户管理 / 站点页面 / cpoauth 账号关联
-- 幂等：可重复执行

-- 1) users 表加角色 + 绑定账号（JSON）
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN linked_accounts TEXT DEFAULT '';

-- 2) 首位用户（yanzie, id=1）册封为 developer
UPDATE users SET role = 'developer' WHERE id = 1;

-- 3) 站点页面（/help、/about），内容管理员可编辑
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,          -- 'help' | 'about'
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'help',
  '使用帮助',
  '# 📋 mdqp 使用帮助

## 这是什么？

**mdqp**（Markdown quickly paste）是一个 Markdown 云剪贴板：**粘上就走，拿链接就分享**。

## 快速上手

1. 点右上角「＋ 新建」
2. 把 Markdown 粘进编辑器（右侧实时预览）
3. 点「发布」，得到一个短链，例如 `https://mdqp.example.com/c/abc12345`
4. 任何人打开链接即可查看；你可以在详情页「复制内容」「Raw 直链」「二维码」

## 不登录能用吗？

能。**游客也可创建剪贴板**，限制如下：

- 最多 **5 个**
- 标记为「任何人可编辑/删除」的协作板
- 换浏览器 / 清缓存会失去管理权

用 **cpoauth 登录**后：不限量，且只有你能改自己的内容。

## 进阶功能

| 功能 | 说明 |
|---|---|
| 🔒 密码保护 | 高级选项里设置访问密码 |
| ⏳ 定时过期 | 1 小时 / 1 天 / 7 天 / 30 天后自动失效 |
| 👁 阅读次数上限 | 达到次数后自动失效（阅后即焚） |
| 🔗 自定义短链 | 发布时指定 3-32 位短链，如 `my-notes` |
| 🤝 协作板 | 登录用户可主动开放「任何人可编辑」 |
| 📥 Raw 直链 | `/raw/<短链>` 直接返回纯文本 |
| 📑 目录大纲 | 详情页 / 编辑器一键展开标题目录 |

## 账号与绑定

登录账号由 [cpoauth](https://www.cpoauth.com/) 提供。你可以在 cpoauth 绑定洛谷、Codeforces、AtCoder、GitHub 等账号，绑定后会在你的 mdqp 个人主页展示。

## 遇到问题？

- 输入法打不了字？本站已适配中文输入法，请尝试刷新页面
- 打不开本站？本站部署在 Cloudflare，部分地区网络可能需要自备加速
- 其他问题请联系站点管理员'
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'about',
  '关于 mdqp',
  '# 关于 mdqp

**mdqp** = **M**ark**d**own **q**uickly **p**aste。

## 定位

粘上就走，拿链接就分享的 Markdown 云剪贴板：

- **免登录也能用**（游客模式）
- 登录后不限量，且只有你能改自己的内容
- 任何人凭短链都能访问、查看作者主页

## 技术

- 前端：原生 HTML/CSS/JS（SPA，无构建）
- 后端：Cloudflare Workers（Hono）
- 数据库：Cloudflare D1（SQLite）
- 登录：[cpoauth](https://www.cpoauth.com/)（OAuth 2.0 + PKCE）

## 隐私

- 密码保护使用 SHA-256 哈希，密码原文不落库
- 公开剪贴板任何人可见；「仅链接可见」的板不出现在列表
- 过期 / 超次数的剪贴板自动失效

---

由 [yanzien](/u/1) 开发维护 · 本页面由管理员编辑'
);

INSERT OR IGNORE INTO pages (slug, title, content) VALUES (
  'changelog',
  '更新日志',
  '# 📝 更新日志

本页记录 mdqp 的主要版本变动，由管理员维护。

## v3.3（2026-08）
- 前端性能：代码高亮 highlight.js 改为**按需加载**，首屏不再阻塞
- 公开接口加 `Cache-Control` 缓存头，降低回源压力
- 新增**更新日志**页（本页）
- 关联账号管理跳转改为 cpoauth 个人中心
- 搜索关键词限长 100 字符，防滥用

## v3.2（2026-08）
- 用户管理：角色（用户/管理员/开发者）、册封/撤管理员、删号
- 管理后台 `/admin`：用户列表、全部剪贴板、站点页面
- 站点页面 `/help` `/about`：管理员可编辑
- 个人主页展示 cpoauth 绑定账号（洛谷等）+ 个人介绍

## v3.1（2026-08）
- 适配中文输入法（IME）在输入框被 Enter 劫持的问题
- 代码高亮、编辑器/查看器目录大纲

## v3.0
- 基于 Cloudflare Workers + D1 全栈重写
- 免登录可用、密码保护、定时过期、阅读次数上限、自定义短链、Raw 直链'
);
