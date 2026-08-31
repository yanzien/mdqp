# mdqp — Markdown Quickly Paste

> **Markdown 快速云剪贴板**：粘上就走，拿链接就能分享。**不登录也能用**，登录后不限量且只有你能改自己的内容。

由 [Cloudflare Workers + D1](https://workers.cloudflare.com/) 全栈托管，登录由 [cpoauth](https://www.cpoauth.com/) 提供 OAuth 2.0 身份。

---

## 功能

- **免登录可用**——游客直接用，无需注册；登录用户享受完整权限。
- **三种身份**
  - 登录用户（cpoauth）：随时新建 / 修改 / 删除**自己的**剪贴板，无数量限制。
  - 游客（未登录）：也能新建，但**最多 5 个**，且其剪贴板标记为「任何人可编辑/删除」（协作剪贴板）。
  - 任何人：可浏览公开列表、凭短链 ID 访问任意剪贴板、查看作者主页。
- **Markdown 原生**：实时渲染预览，支持标题/列表/代码/表格/引用等。
  - ✨ **代码语法高亮**（highlight.js，深浅双主题自适应）
  - ✨ **目录大纲**：编辑器与查看页均有「📑 目录」按钮，自动提取标题并可点击跳转
- **双主题**：右上角 🌙/☀️ 一键切换浅色 / 深色，记忆偏好。
- **作者主页**：点击作者名查看其公开剪贴板（`/u/<id>`）。
- **公开 / 私有**：可设为出现在公开列表，或仅凭链接访问。
- **CloudPaste 式增强**
  - ⏳ 定时过期（1h / 1d / 7d / 30d）
  - 👁 阅读次数上限
  - 🔒 访问密码（SHA-256 哈希，服务端校验）
  - 🔗 自定义短链（slug）
  - 📄 `/raw/<id>` 原始文本直链 + 分享二维码

### v4.0 新增

- 🎫 **VIP 系统**：管理员可授予 VIP（金色标识）；开通引导加站长微信。
- 🎁 **邀请系统**：生成专属邀请码 + 链接。被邀请者**首次**通过链接登录，双方各 +1；tier 奖励（1人→全功能 / 3人→VIP / 5人→不限字数+置顶 / 10人→开发者大礼包），被邀请者额外获「自定义短链」权限。
- 💬 **评论**：登录用户可评论，支持 Markdown + @站内用户，每条 50 等效字上限。
- 🔐 **登录门禁**：作者可设「仅登录用户可查看」，未登录访问显示登录引导。
- 👥 **唯一读者限制**：按独立访客计数（非浏览次数）；游客用设备指纹识别。
- ⚙️ **功能开关**：管理员可单独为每个用户开关高级功能（自定义短链、密码、过期、协作、登录可见、读者上限、评论）。
- 📢 **公告**：管理员可在首页置顶公告（支持 Markdown）。
- ✏️ **短链修改**：有自定义短链权限者可改已发布剪贴板的短链，旧链接自动跳转。
- 🛡 **管理员权限颜色梯度**：按权限从低到高 蓝→绿→橙→红→紫，开发者/最高权限为紫色。

---

## 技术栈

| 层 | 方案 |
|---|---|
| 前端 | 原生 HTML/CSS/JS（SPA，无构建步骤） |
| 后端 | Cloudflare Worker（[Hono](https://hono.dev/) 框架） |
| 数据库 | Cloudflare D1（SQLite，serverless） |
| 身份 | cpoauth OAuth 2.0（Authorization Code + PKCE） |
| 渲染 | marked.js + DOMPurify + highlight.js |
| 部署 | `wrangler deploy`（Workers Static Assets 托管前端） |

---

## 本地开发

```bash
npm install
npm run dev        # 启动本地 Worker + D1（默认 http://localhost:8787）
```

本地 D1 初始化（开发用）：

```bash
npm run db:init    # 等价于 wrangler d1 execute mdqp-db --local --file=database_init.sql
```

> 说明：游客模式在本地用 `X-Guest-Id` 请求头区分；浏览器端自动用 localStorage 生成一个固定 guest UUID。

可选 API 冒烟测试（需先 `npm run dev` 起在 8787）：

```bash
node test_local.mjs   # 覆盖游客创建/限额/协作/密码/短链/无身份拒访等核心逻辑
```

---

## 部署（需你本人操作）

> ⚠️ 本项目需要 Cloudflare 账号授权，且涉及 OAuth 回调地址配置。**以下命令需要你自己在终端跑**（CI/沙箱无法替你完成浏览器授权）。

### 1. 登录 Cloudflare

```bash
npx wrangler login      # 会打开浏览器让你授权，按提示完成
```

### 2. 创建 D1 数据库，并把返回的 database_id 填进 `wrangler.toml`

```bash
npx wrangler d1 create mdqp-db
```

把命令输出的 `database_id` 复制到 `wrangler.toml` 的：

```toml
[[d1_databases]]
binding = "db"
database_name = "mdqp-db"
database_id = "此处替换为真实 id"
```

### 3. 初始化数据库表

```bash
npm run db:init:remote   # wrangler d1 execute mdqp-db --remote --file=database_init.sql
```

### 4. 注入 cpoauth 凭据（secret，**不要写进代码/README**）

```bash
npx wrangler secret put CPOAUTH_CLIENT_ID
npx wrangler secret put CPOAUTH_CLIENT_SECRET
```

按提示分别粘贴你的 cpoauth Client ID 与 Client Secret。

> **可选**：若你希望把回调地址写死（而不是自动按当前域名拼），可额外注入一个 secret：
> ```bash
> npx wrangler secret put CPOAUTH_REDIRECT_URI
> # 粘贴：https://mdqp.<你的子域>.workers.dev/api/auth/callback
> ```
> 不设则代码自动用「当前访问域名 + /api/auth/callback」，本地与线上通吃。

### 5. 部署

```bash
npm run deploy           # wrangler deploy
```

部署成功后终端会给出地址，形如 `https://mdqp.<你的子域>.workers.dev`。

### 6. 在 cpoauth 开发者后台设置回调地址

> cpoauth 创建应用后**不能修改** Redirect URI，所以请按下面的原则注册，**每个稳定地址只建一次**，避免反复新建应用。

**推荐做法**：
1. 先部署拿到 workers.dev 地址，在 cpoauth 建**一个**应用，Redirect URI 填：
   ```
   https://mdqp.<你的子域>.workers.dev/api/auth/callback
   ```
2. 之后**永远用这个地址登录**（哪怕你本地开发，也直接在部署好的站点上测 OAuth，不要在 localhost 跑 OAuth）。
3. 若以后绑定自定义域名（如 `mdqp.yanzien.eu.org`），**再建第 2 个应用**填自定义域名的回调即可，旧应用不用删。

> 若你之后绑定自定义域名（如 `mdqp.yanzien.eu.org`），需把对应域名的回调地址也加进去：
> `https://mdqp.yanzien.eu.org/api/auth/callback`

回调地址不匹配时，登录会跳回首页并提示 `token_failed / redirect_uri` 类错误。

---

## 权限模型（速查）

| 身份 | 新建 | 修改 | 删除 | 数量上限 |
|---|---|---|---|---|
| 登录用户 | ✅ | 自己的随时改 | 自己的 | 日限 5 / 月限 50 |
| 游客 | ✅ | 自己的 + 协作剪贴板 | 自己的 + 协作剪贴板 | **周限 5 个** |

- 所有用户（管理员除外）每个剪贴板字数上限 **150 等效字**（CJK 全算 1，英文/标点折半，Math.ceil 取整）。
- 游客剪贴板默认 `editable_by_anyone=1`：任何登录访客都能改动或删掉它，请勿放重要内容。
- 协作剪贴板：协作者可改内容/标题，但不能改归属者的过期/密码/次数设置（防反锁作者）。
- 管理员可在后台为每个用户单独开关高级功能、设 VIP、调整限额。

---

## 目录结构

```
mdqp/
├── wrangler.toml        # Worker 配置（D1 绑定、Assets、compat date）
├── database_init.sql    # D1 建表 SQL
├── package.json         # 依赖与脚本
├── src/
│   ├── worker.js        # 主入口：API 路由 + 权限 + SPA 回退
│   ├── auth.js          # JWT 签发/校验 + 密码哈希
│   ├── oauth.js         # cpoauth 登录回调（PKCE + state 防 CSRF）
│   └── types.ts         # 环境绑定类型定义
└── public/
    ├── index.html       # SPA 外壳
    ├── app.js           # 前端路由 / 身份 / 剪贴板 CRUD / 分享
    └── style.css        # 浅色/深色主题样式
```

---

## 安全说明

- ✅ cpoauth 登录：标准 OAuth 2.0，密码不经过本站。
- 🔑 cpoauth 凭据仅作为 **Worker Secret** 注入，绝不存在前端代码或仓库中。
- 🔒 访问密码以 SHA-256 哈希存储，服务端校验，不落明文。
- ⚠️ 游客身份仅靠浏览器本地 UUID + 请求头标识，**可被技术手段冒充**，故游客剪贴板设计上就是「任何人可编辑」的公开协作内容。

## License

MIT
