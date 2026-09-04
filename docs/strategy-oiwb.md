# oiwb × mdqp 整合方案 v3.0 · 账号互通 + 天马行空

> **取代关系**：本方案是 `strategy-oiwb.md` 的第三代。v2.1（2026-09-04 18:50）的事实核对全部保留；本版按 2026-09-04 19:00 站长进一步指示升级——
> **核心需求**：① oiwb 与 mdqp 一套账号互通 ② 跨站跳转后自动登录
> **天马行空扩展**：除打通附庸外，加入 SSO 共同域 Cookie、AI 教练 / 能力核、OI 题手榜、事件总线等"大动作"。
> mdqp 网址与页面结构**不变**；oiwb 网址不变（功能层兼容 GitHub Pages）。

---

## §0. v3.0 相比 v2.1 的升级点（速读）

| 维度 | v2.1 | v3.0 |
|---|---|---|
| **身份层** | "mdqp 提供账号、oiwb 可选登录"（P1 阶段） | **现在就做**：账号互通 + 跨站自动登录（P0 段） |
| **核心机制** | JWT 长 token + 手动同步 | **短 ticket（5min 一次性）交换 JWT** + 共同域 Cookie SSO（DNS 后） + 二维码兜底 |
| **架构层级** | 两层：oiwb + mdqp | **三层**：oiwb（数据/UI） + mdqp broker（账号/同步/事件） + 跨 app 偏好同步（prefs 层） |
| **AI 能力** | 无 | **新增**：AI 错题分析、AI 训练计划、能力核雷达图（走 Cloudflare Workers AI，零新依赖） |
| **社交能力** | 无 | **新增**：OI 题手榜、关注、协作题单、24h 挑战赛 |
| **数据互通粒度** | 快照（整包） | **快照 + 结构化**双轨：先快照（解决丢数据），再结构化（解决合并） |
| **排期** | P0/P1/P2 | **O0-O5** 六阶段，每阶段标"谁做"和验收 |
| **指标** | 4 项 | **9 项**，按阶段拆解 |

---

## 一、现状盘点（2026-09-04 19:00 实测）

**oiwb**：单文件 `index.html`，216 KB / ~2906 行，原生 HTML/JS/CSS，**零依赖零构建**，纯 `localStorage`，离线可用。`APP_VER='v2.5.3'`（2026-09-04 O0-2 已完成 bump）。

**mdqp**：Cloudflare Pages + D1 + Hono，已上线 v4.6.2（最新部署 f1c13787）。有完整 JWT + 权益矩阵 + 字数限额 + 草稿自动保存 + 我的剪贴板 2.0 + 主页 scope 切换 + 版本弹窗等。

**oiwb 功能面**（已远超 MVP，别重复造）：

| 模块 | 内容 |
|---|---|
| 题目管理 | 洛谷八档难度配色、标签、题解链接、掌握度、批量操作、回收站、自动备份 |
| 比赛 | CF / AtCoder / 洛谷 / 牛客 / Vjudge 多源聚合 + 实时倒计时 |
| 模拟决斗 | 自定义题单 + 限时自测，赛前热身 |
| OJ 导入 | 8 个浏览器端爬取脚本，粘贴 JSON 即导入，含重复检测 |
| 数据统计 | 刷题量、正确率、科目分布 |
| 设置页 | 主题 / 紧凑 / 字号 / 默认难度 / 平台 / 30 条提示 / 归档天数 / 自动备份 / CORS 代理 / 回收站天数 |
| 帮助 | Wiki 页（左侧目录 + 全文搜索 + 14 节详解 + 难度表 + 更新日志） |
| 新手指引 | 8 步镂空蒙层（clip-path 真三角箭头） |
| 外观 | 暗色模式、窄屏单列、添加主屏变 APP |

**八条铁律**（改代码时不可破）：
> ① 导出/导入/清空/重置必须有 ② 30 条提示 ③ 今天处理常驻 ④ 昨天没做完自动顺延 ⑤ **零外链单文件** ⑥ 本地存储 ⑦ 预置示例数据 ⑧ 空数据不崩

**问题清单**（v3.0 重排，按"打地基 → 上层 → 天马行空"）：

| # | 问题 | 现状 | 严重度 | 解法阶段 |
|---|---|---|---|---|
| **W1** | 仓库未上传 → Actions 从未跑 → 比赛数据停在 8/4 | `contests.json: updated 2026-08-04` | 🔴 | O0-1 |
| **W2** | 数据孤岛：一切在 localStorage，换机/清缓存全丢 | 无远端同步 | 🔴 | O1 |
| **W3** | 无账号，与 mdqp 完全不互通 | mdqp 已有 JWT，oiwb 不建 users 表 | 🔴 | **O1（升级到 P0）** |
| **W4** | 跨站跳来跳去要重新登录 | 无 SSO | 🔴 | **O1（升级到 P0）** |
| **W5** | 存量 BUG 未系统排查（tour OK，其余 8 类模式未扫） | — | 🟠 | O0-3 |
| **W6** | 自动备份只写本地，防不了换机 | — | 🟡 | O1（顺带） |
| **W7** | 无 AI 助手，错题靠自己悟 | — | 🟡 | O5 |
| **W8** | 训练数据无横向对比（不知道我在同档位的水平） | — | 🟢 | O4 |

---

## 二、定位（一句话）

> **oiwb：OI / 信奥选手的日常训练工作台**（概览 · 题目 · 比赛 · 决斗 · 工具 · AI 教练）
> **mdqp：工作台的「账号层 + 片段库 + 社交场」**——账号、模板、题解、笔记、AI 教练的大脑、OI 题手榜，都在这里。

**核心闭环（v3.0 升级版）**：

```
登录（自动登录）→ oiwb 概览（今天练什么）→ 做题 / 写题解 / 整理模板
   ↓
一键存 mdqp（自动打标签 OI / 题号 / 算法）→ mdqp 永久云端
   ↓
三个月后 → oiwb 工具页「片段库」→ mdqp 私有搜索 → 复用
   ↓
AI 教练：能力核 → 推送"该练什么了"+ 错题分析 + 推荐题单
   ↓
OI 题手榜：跟同档位 / 同校 / 全国的选手横向对比 → 知道自己位置
```

---

## 三、整合架构（v3.0 · 账号互通为核心）

### 3.1 原则（升级 6 条）

1. **oiwb 永远纯静态单文件**（GitHub Pages → 后续 `oj.yanzien.eu.org`），零后端进程；
2. **mdqp 不改 URL、不改现有页面**，只在 `src/worker.js` **新增** oiwb 专用端点；
3. **可降级**：mdqp 挂了 oiwb 照常本地可用（localStorage 是本地缓存 + 离线兜底）；
4. **复用 mdqp 已有 JWT / 限额 / D1**——不给 oiwb 单独建后端；
5. **不破八条铁律**（尤其⑤零外链单文件：mdqp 交互走可选云端，不引外部 CDN；fetch 一律指向 mdqp 单一域）；
6. **数据归属**：未登录时数据是本地匿名，登录后归到 mdqp `uid`；切换账号自动拉对应快照。

### 3.2 账号层（核心新增）

**mdqp `users` 是唯一身份源**。oiwb 不建 `users` 表，只持 token。

```
┌─────────────────────────────────────────────────────────┐
│                  mdqp users 表（唯一身份）                 │
│  id INTEGER PK · name · email · vip · perms · created_at │
└──────────────────────┬──────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  mdqp 站直用       oiwb 互通        其他 yanzien 小项目
  (JWT)            (ticket 换 JWT)   (统一 OAuth Provider, O6)
```

**两端账号等价规则**：mdqp 注册 → oiwb 自动可用；oiwb 用户通过"用 mdqp 登录"获得 oiwb 账号（实际上就是 mdqp 账号在 oiwb 上的 token）。**不会有"oiwb 单独账号"这种东西**——这是用户明确要的"一套账号"。

**oiwb 端 token 字段**（localStorage）：
- `oiwb_mdqp_uid` —— 当前登录的 mdqp uid（=mdqp users.id）
- `oiwb_jwt` —— mdqp 签发的 oiwb 专用 JWT（1h）
- `oiwb_refresh` —— 长期 refresh token（30d，到期需重新走 ticket）
- `oiwb_login_at` —— 登录时间戳

### 3.3 跨站自动登录（核心新增 · 三方案）

#### 方案 A · 短 ticket（首推，**无需 DNS 即可上线**）

```
场景：mdqp 已登录态 → 跳 oiwb

[1] 用户在 mdqp 点"去 oiwb 训练"
       ↓
[2] mdqp 前端：POST /api/auth/ticket {scope:'oiwb', next:'/'}
       ↓  (mdqp 已登录，Cookie 自动带)
       服务端：生成短 JWT（payload: {uid, scope, jti, iat, exp:5min}，一次性）
       返：{ticket:"eyJ...", exp:1700000000}
       ↓
[3] 前端：window.location='https://yanzien.github.io/oiwb/?ticket=eyJ...'
       ↓
[4] oiwb 启动时检测 URL 有 ?ticket=
       POST https://mdqp.pages.dev/api/auth/exchange {ticket}
       ↓
       服务端：验签 + 校验 jti 未用过 + 标记 jti used
       返：{token:"eyJ...", refresh:"eyJ...", uid:1, name:"yanzien"}
       ↓
[5] oiwb 存 localStorage + 去掉 URL 上的 ticket
       toast"已登录 yanzien · 云端已激活" → render 刷新

[反向] oiwb 已登录 → mdqp 完全镜像，scope:'mdqp'
```

**mdqp 端新增 API（4 个）**：

```js
// 1. 已登录用户申请跨站 ticket
POST /api/auth/ticket {scope:'oiwb'|'mdqp'|'app-hub', next?:'/'|'/board/xxx'}
→ {ticket, exp}  // ticket 是短期 JWT, 5min, 一次性, scope 限定

// 2. 用 ticket 换正式 JWT
POST /api/auth/exchange {ticket}
→ {token, refresh, uid, name, avatar_url, vip, level, perms}

// 3. 刷新 oiwb JWT
POST /api/auth/refresh {refresh_token}
→ {token}  // refresh 复用，不重发；30d 后失效需重新走 ticket

// 4. 登出（清 jti 状态）
POST /api/auth/logout
→ 200  // 服务端吊销 refresh
```

**oiwb 端改动**（最小）：
- 启动时检测 `URLSearchParams.get('ticket')` → 调 exchange → 存 localStorage
- localStorage 变化时同步刷新 UI（登录状态显示用户名 + 头像 + 登出）
- 后台 setInterval 每 50 分钟自动 refresh
- **新增"账号"侧栏按钮**（替代/补强当前"⋯ 数据"菜单）

#### 方案 B · 共同域 Cookie（最佳方案，**等 DNS 落地后**）

**前提**：oiwb 迁 `oj.yanzien.eu.org`，mdqp 迁 `mdqp.yanzien.eu.org`（同父域 `.yanzien.eu.org`）。

**实现**：
- mdqp 登录时 `Set-Cookie: mdqp_sess=...; Domain=.yanzien.eu.org; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`
- oiwb 首次访问 → `fetch('https://mdqp.yanzien.eu.org/api/me', {credentials:'include'})` → 200 → 自动调 `exchange-from-cookie` 换 oiwb JWT
- **用户完全无感**：直接访问 oiwb URL 就已登录
- 反向同理

**优势**：
- 不需要"用 mdqp 登录"按钮（按钮可以保留作 fallback）
- 不需要 ticket 跳转流程
- 跨站任何跳转都自动登录

**落地条件**：DNS 迁移 + HTTPS 证书（Cloudflare 自动）

#### 方案 C · 二维码兜底（手机/离线）

- mdqp 设置页生成 QR：`mdqp://login?c=xxx`（一次码，60s 过期）
- oiwb 提供"扫码登录"按钮 → 调 `/api/auth/exchange-from-code {c}` → JWT
- **适用**：手机访问 oiwb，电脑上 mdqp 已登录

**优先级**：A 先（B 的前置条件 DNS 还没做）→ B 上线后 A 退化为跳转按钮 → C 作兜底永远在。

### 3.4 数据流（升级：快照 + 结构化双轨）

```
┌──────────────────────────┐          ┌───────────────────────────────────┐
│ oiwb（静态单文件）         │          │ mdqp（Cloudflare Pages + D1）      │
│ localStorage = 本地缓存   │ ──JWT──→ │ broker 服务（新增）                  │
│ 换机可全量恢复             │ ←─────── │                                    │
│                            │          │  ┌──────────┐ ┌───────────────┐ │
│ 「存到片段库」按钮 ──────────────→ │ /api/clips    │ │ /api/oiwb/*    │ │
│ 「片段库」面板 ────────────────→ │ /api/me/clips│ │ /api/auth/*   │ │
│                            │          │ │ /api/prefs  │ │ /api/ai/*     │ │
│ 「备份到云端」 ────────────────→ │              │ │ /api/social/*│ │ │
│ 「从云端恢复」 ←──────────────── │ /api/oiwb/sync │ └───────────────┘ │
└──────────────────────────┘          └───────────────────────────────────┘
```

**两期同步**：
- **一期（O1）· 快照同步**：oiwb 整个 state 序列化成 JSON（复用现有「导出数据」格式），手动/每日推到 `oiwb_snapshots(uid, blob, size, updated_at)`。**先解决 W2/W6 丢数据**。
- **二期（O3）· 结构化**：题目/比赛逐条 upsert（`oiwb_tasks`、`oiwb_contests`），按 `updated_at` 做多端合并。**先解决 W8 多端冲突**。

**mdqp 侧新表**：

```sql
-- 快照表（已有方案）
CREATE TABLE oiwb_snapshots (
  uid INTEGER PRIMARY KEY,
  blob TEXT NOT NULL, size INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- 结构化数据（O3）
CREATE TABLE oiwb_tasks (
  id TEXT PRIMARY KEY,   -- oiwb 端 task id (uuid)
  uid INTEGER NOT NULL, source TEXT, pid TEXT, title TEXT, diff TEXT,
  status TEXT, tags TEXT, link TEXT, note TEXT, deadline INTEGER,
  created_at INTEGER, updated_at INTEGER
);
CREATE INDEX idx_oiwb_tasks_uid ON oiwb_tasks(uid, updated_at);
-- contests / links 同结构

-- 能力核（O5）
CREATE TABLE oiwb_skill (
  uid INTEGER PRIMARY KEY,
  graph INTEGER DEFAULT 0, dp INTEGER DEFAULT 0, math INTEGER DEFAULT 0,
  ds INTEGER DEFAULT 0, str INTEGER DEFAULT 0, misc INTEGER DEFAULT 0,
  updated_at INTEGER
);

-- 题手榜（O4）
CREATE TABLE oiwb_leaderboard_optin (
  uid INTEGER PRIMARY KEY,
  public BOOLEAN DEFAULT 0,  -- 用户是否愿意上榜
  scope TEXT DEFAULT 'self',  -- self / school / national
  updated_at INTEGER
);

-- 跨 app 偏好（O6）
CREATE TABLE user_prefs (
  uid INTEGER PRIMARY KEY,
  theme TEXT, font_size TEXT, compact INTEGER, shortcuts TEXT,
  updated_at INTEGER
);
```

### 3.5 联动（mdqp 现成能力，零后端改动）

- **存模板/笔记** → 跳 `mdqp.pages.dev/new?title=<题名>&tags=OI,<OJ>,<算法>&back=oiwb`（O1 一并做）
- **片段库面板** → oiwb 内嵌弹层调 `GET /api/me/clips?q=&tag=OI`（O1）
- **AI 错题分析** → oiwb 把错题 dump 到 `oiwb_skill_events` → mdqp 后台 Workers AI 分析 → 推回（O5）
- **OI 题手榜** → oiwb 概览直接拉 `GET /api/oiwb/leaderboard?scope=self|school|national`（O4）

### 3.6 部署与分工（升级）

| 站点 | 地址 | 谁部署 |
|---|---|---|
| oiwb | `yanzien.github.io/oiwb/` → 启用域后 `oj.yanzien.eu.org` | **用户自己 git push `github-upload/`** |
| mdqp | `mdqp.pages.dev` → 启用域后 `mdqp.yanzien.eu.org` | **AI**（wrangler 部署） |
| app-hub | `yanzien.github.io/app-hub/` | 已有，加 oiwb 图标即可 |
| 共同域 | `yanzien.eu.org` 已 NS 到 Cloudflare | **用户做**：① 申请子域 ② Pages 加自定义域 |

---

## 四、排期（v3.0 · O0-O5 六阶段）

### O0 · 本周（打地基）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O0-1** | 上传 + Actions 开权限 🔴 | 推 `github-upload/` → Settings → Pages（main 根目录）→ Settings → Actions → General 开 **Read and write permissions**（爬虫要自动提交 contests.json） | **用户** | 首页看到未来比赛；Actions 每 30 分钟跑一次 |
| **O0-2** | APP_VER bump + 更新日志 🟠 ✅ **已做** | `APP_VER='v2.5.3'` + changelog 三条（v2.5.1/2/2/3） | AI ✅ | 帮助页能看到 v2.5.3 |
| **O0-3** | 存量 BUG 排查 🟠 | 按 9 类模式扫 2906 行：JSON.parse 容错、`tickContests` 时区/跨年边界、sort 比较器未定义变量（mdqp 踩过的 `cb` 坑）、innerHTML 未过 `esc()`、事件委托 selector、导入 JSON 结构校验、normDash 完整性、回收站过期逻辑 | AI | BUG 清单 + P0/P1 级修完 |

### O1 · 1–2 周（**账号互通 + 跨站自动登录 + 数据备份** · 用户明确核心需求）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O1-1** 🔴 | **账号互通 + 跨站 ticket** | mdqp 新增 4 个 API（`/api/auth/{ticket,exchange,refresh,logout}`）；oiwb 检测 `?ticket=` 自动登录 + "去 oiwb"/"去 mdqp" 跳转按钮 + 后台 refresh | AI | mdqp 登录 → 点去 oiwb → 自动登录，localStorage 有 token |
| **O1-2** | **侧栏"账号"区** | oiwb 新增账号区（用户名 / 头像 / 登出 / 云端状态指示灯），云端激活时显示绿点 | AI | 登录后侧栏能看到名字 + 状态 |
| **O1-3** | **快照同步（§3.4 一期）** | `oiwb_snapshots` 表 + `/api/oiwb/sync` + oiwb 设置页"备份到云端/从云端恢复"按钮 + 可选每日自动 | AI | 备份成功后从另一台恢复，数据一致 |
| **O1-4** | **联动入口** | 「存到片段库」按钮（跳 mdqp `/new` query 预填）+ 「片段库」面板（mdqp 私有搜索弹层）+ mdqp CORS 白名单 oiwb 域 | AI | oiwb 里能跳到 mdqp 预填 + 拉回私有片段 |
| **O1-5** | **二维码兜底登录** | mdqp 设置页生成 60s 一次码（QR） + oiwb 扫码 → JWT（适用手机/离线场景） | AI | 手机访问 oiwb → 扫码电脑 mdqp → 自动登录 |

### O2 · 2–3 周（**SSO · 共同域 Cookie · 让账号互通零摩擦**）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O2-1** | DNS 子域迁移 | `yanzien.eu.org` 子域：`oj.yanzien.eu.org`（GitHub Pages CNAME）+ `mdqp.yanzien.eu.org`（Cloudflare Pages 自定义域） | **用户** | 两个子域都 HTTPS 可达 |
| **O2-2** | 共同域 Cookie SSO | mdqp `Set-Cookie Domain=.yanzien.eu.org`；oiwb 首次进入调 `/api/me` → 自动 `exchange-from-cookie` → 完全无感登录 | AI | 直接访问 oiwb URL 就已登录（mdqp 已登录态） |
| **O2-3** | 自动续期 | oiwb 后台每 50 分钟 refresh；过期自动跳 mdqp 重走 ticket | AI | 7 天不重新登录，oiwb 仍保持登录态 |
| **O2-4** | 老账号迁移 | 一次性脚本：把 oiwb 当前 localStorage 数据标记为 uid=null（匿名），登录后挂到新 uid | AI | 老用户登录后云端能看到自己的老数据 |

### O3 · 3–4 周（**结构化数据互通**）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O3-1** | 结构化同步 | `oiwb_tasks` / `oiwb_contests` / `oiwb_links` 表；逐条 upsert + `updated_at` 合并 | AI | 两台机器改同一题，后合并结果正确 |
| **O3-2** | 实时笔记同步 | oiwb 写笔记 → mdqp 自动建/更新 clip；mdqp 改笔记 → oiwb 收到通知 | AI | oiwb 写笔记 → mdqp 立即出现 |
| **O3-3** | 双向同步冲突 UI | 当两端同时改同一条，弹"以云端/以本地/合并"三选一 | AI | 冲突有 UI 解决 |
| **O3-4** | 离线编辑队列 | oiwb 离线时记录变更队列 → 上线后批量推送 | AI | 断网改题，上线后云端同步 |

### O4 · 4–6 周（**OI 题手榜 + 社交**）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O4-1** | OI 题手榜 | `oiwb_leaderboard_optin` + 计算能力分；oiwb 概览"我的排名"卡片 | AI | 同档位能看到自己位置 |
| **O4-2** | 关注与公开训练动态 | mdqp 关注关系 + oiwb 关注面板；关注者公开题单/动态流 | AI | 关注好友后看到 ta 的 AC 动态 |
| **O4-3** | 协作题单 | oiwb 创建"公开题单" → mdqp 协作板 → 其他人订阅 | AI | 创建题单 → 分享链接 → 好友订阅 |
| **O4-4** | 24h 挑战赛 | oiwb 邀请好友 24h 内做同一组题 → mdqp 算分排名 | AI | 邀请后 24h 内排名实时更新 |

### O5 · 6–10 周（**AI 教练 · 能力核 · 通知总线 · 天马行空**）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O5-1** | **能力核** | `oiwb_skill` 表；oiwb 上报做题事件 → mdqp 后台 Workers AI 计算六维度（DP/图论/数学/数据结构/字符串/其他） | AI | 概览显示"DP 120 / 图论 80"分项 |
| **O5-2** | **能力雷达图** | oiwb 概览新增六维雷达图（前端画 SVG） | AI | 看到自己六维度强弱 |
| **O5-3** | **AI 错题分析** | 错题 dump 到 mdqp → Workers AI 分析错因（"这题你卡在状态转移没想清楚"）+ 推荐类似题 | AI | 错题有 AI 评论 |
| **O5-4** | **AI 训练计划** | 基于能力核 + 比赛日历 → mdqp 推"未来 7 天你该练什么" | AI | 收到个性化推送 |
| **O5-5** | **AI 模拟面试** | 随机 3 题 + LLM 出题解 → 限时做 → AI 评分 | AI | 模拟面试报告 |
| **O5-6** | **跨 app 事件总线** | 各 app 重要事件走 mdqp → 跨站通知（"oiwb 里有个新比赛" / "mdqp 里有个协作板邀请你"） | AI | 多站通知聚合 |

---

## 五、mdqp 侧排期（v3.0 · M1-M10）

| v1 条目 | v3.0 处置 |
|---|---|
| P0-1 ~ P0-4（权益矩阵/字数/草稿/我的剪贴板） | ✅ 全部上线（v4.6 / v4.6.2） |
| P0-5 资源瘦身 | 保留，降优先级（附庸角色不需要重型首屏） |
| P1-2 开放 API | **提前到 O1** ——它是 oiwb 联动的技术底座 |
| P1-4 发现广场 / SEO | **降级为 O4**——流量从 OI 题手榜来 |
| P2-1 OI 垂直化 | **合并进 O1/O4**（OI 标签就是最小垂直化） |
| P2-2 埋点看板 | **提前到 O1**：加 `events` 表，否则导流无法衡量 |

**mdqp 新增工作项（v3.0）**：

| # | 项 | 量级 | 阶段 |
|---|---|---|---|
| **M1** | `oiwb_snapshots` 表 + `POST/GET /api/oiwb/sync` | 0.5 天 | O1 |
| **M2** | `/new` 支持 `?title=&tags=` 预填 + CORS 白名单 | 0.5 天 | O1 |
| **M3** | `events` 埋点表 + 最小看板 | 1 天 | O1 |
| **M4** | API Key（`api_keys` 表 + Bearer 鉴权，v1 P1-2 提前） | 1 天 | O1 |
| **M5** | **4 个 auth API**（`/api/auth/{ticket,exchange,refresh,logout}`）+ jti 状态表 | 1 天 | **O1-1 🔴** |
| **M6** | QR 码登录（`oiwb_login_codes` 表，60s 过期） | 0.5 天 | O1 |
| **M7** | 结构化同步表（`oiwb_tasks`、`oiwb_contests`、`oiwb_links`）+ upsert API | 2 天 | O3 |
| **M8** | 能力核计算（Workers AI 推理 + 定时聚合） | 2 天 | O5 |
| **M9** | OI 题手榜（`oiwb_leaderboard_optin` + 计算 + 公开/私密） | 1.5 天 | O4 |
| **M10** | 跨 app prefs（`user_prefs` 表 + 通用 OAuth Provider 接口） | 1.5 天 | O5 |

**总工作量估算**：M1-M10 共约 12.5 天（不含 O0-3 BUG 排查）。

---

## 六、天马行空（v3.0 · 大动作汇总）

> 这些不是胡想，每条都能落地，列出来供你拍板"做哪几条"。

### 6.1 通用化 · mdqp 做 yanzien 全栈账号层

- **跨 app 偏好同步**：暗色模式 / 字号 / 紧凑 / 快捷键 / 默认 OJ —— 一次设置，全站生效。
- **统一 OAuth Provider**：所有 yanzien 小项目（home、app-hub、oiwb、未来的 OJ 评测）都接 mdqp 账号；不再为每个接一遍 GitHub/微信/手机号。
- **事件总线**：各 app 重要事件走 mdqp → 跨站通知聚合（推送 + 站内 + 邮件）。
- **个人主页枢纽**：`yanzien.eu.org` 登录后显示跨 app 摘要："oiwb 完成 127 题 · mdqp 存 23 模板 · app-hub 收藏 5 应用"。

### 6.2 社交 · OI 题手榜 + 训练动态

- **OI 题手榜**：按能力分 / 同档位 / 同校 / 全国排名；私密或公开可选。
- **公开训练动态**：关注好友后看到 ta 的 AC / 比赛 / 决斗动态（可关）。
- **协作题单**：oiwb 创建"100 道 DP 题单" → mdqp 协作板 → 朋友订阅一起打卡。
- **24h 挑战赛**：邀请好友做同一组题 → 排名实时更新 → 赛后复盘。
- **题解市场**：mdqp 公开"我的题解" → 其他人可点赞 / 收藏 / 引用。

### 6.3 AI 教练 · 能力核 · 个性化

- **能力核**：六维度评分（DP / 图论 / 数学 / 数据结构 / 字符串 / 其他），基于做题历史。
- **能力雷达图**：oiwb 概览可视化。
- **AI 错题分析**：每道错题给"卡在哪一步 + 怎么想 + 类似题推荐"。
- **AI 训练计划**："未来 7 天你该练 DP，因为下周有 NOIP" —— 基于能力核 + 比赛日历。
- **AI 模拟面试**：随机出题 + LLM 评分 + 报告（赛后可分享给教练）。
- **OI 大模型助手**：Workers AI 部署轻量模型（DeepSeek 7B / Llama 3.2），专门回答 OI 问题；mdqp 持 key。

### 6.4 体验 · 让 oiwb 真正"现代化"

- **PWA 离线安装**：当前"添加主屏变 APP" 已可，升级为完整 PWA（service worker、离线缓存所有静态资源）。
- **Web Push 通知**：赛前 30 分钟推送（订阅 + VAPID 密钥）。
- **深色 / 浅色 / 跟随系统**自动切换（已部分支持，做完善）。
- **多端响应式**：iPad 横屏变"左右分栏"布局（手机 < 768 / 平板 768-1024 / 桌面 > 1024 三档）。
- **快捷键面板**：`?` 弹出所有快捷键（仿 GitHub）。
- **代码高亮笔记**：oiwb 写题解可贴代码，mdqp 端用 Shiki / highlight.js 高亮。
- **图片粘贴**：题解里贴图（剪贴板图片直接上传 mdqp，mdqp 提供 `/api/upload` 图床）。

### 6.5 数据 · 不止于备份

- **时光机**：oiwb "我三天前的状态"——云端存每日 diff，可回放。
- **导出整包 PDF**：oiwb 当前所有数据 → 一份 PDF（设置页 / 训练报告 / 题单），方便打印或分享教练。
- **统计可视化升级**：当前"AC 趋势"小折线 → 完整看板（按难度 / 按月 / 按平台）。
- **错题本**："只看没 AC 的"——自动从 oiwb_tasks 筛。
- **题目元数据增强**：打算法标签（DP/图论/贪心…）+ 难度分（Codeforces rating 风格）+ 错题标记。

---

## 七、已知坑（v3.0 · 保留并新增）

1. **`.github` 必须带点且在仓库根**（Windows Git Bash `mkdir` 会建成 `github`）。本工作区 `oiwb/github/` 是**废弃残留**，勿用；以 `github-upload/.github/` 为准。
2. **GitHub Pages 入口必须 `index.html`**（不是 `oi-workbench.html`）。
3. **洛谷难度**：永远先 `normDash()` 归一化 Unicode 减号再查 `LUOGU_DIFF_MAP`。
4. **指引箭头**：用 `clip-path: polygon()` 真三角，别用 `rotate(45deg)` 正方形（渲染成凹菱形）。
5. **改版本记得 bump `APP_VER`**（v2.5 → v2.5.3 就是教训）。
6. **沙箱限制**：可访问 `api.cloudflare.com`，但 `auth.cloudflare.com` 返 522；无法连通 `workers.dev`/`mdqp.cc.cd`。线上验证须用户浏览器侧。
7. **前端数据只在 localStorage**：未登录态数据公开但看不到，**别在公开页预填隐私**。
8. **🆕 JWT 短票 / Refresh 状态**：用 jti 一次性表存已用 ticket；refresh 复用前要校验未吊销。建议加 `revoked_at` 列（O1-1 必做）。
9. **🆕 CORS 与 Cookie**：方案 A 阶段 mdqp 必须给 oiwb 域开 CORS；方案 B 后同源不再需要。
10. **🆕 Workers AI 限制**：免费层 10k 神经元/天，能力核日推理约 1k 次/用户，安全；超限自动降级。
11. **🆕 二维码登录**：60s 过期 + 一次性，**别存明文 code**（存 hash 比对）。

---

## 八、指标（v3.0 · 9 项）

**北极星**：**OI 训练连续性**（连续登录天数 × 周有效训练时长）。oiwb 之前没有任何统一指标，这是首次定义。

**O0 阶段（本周）**：

| 指标 | 当前 | 1 周目标 |
|---|---|---|
| 比赛数据新鲜度 | 8/4（未跑） | < 24h |
| oiwb APP_VER | v2.5.3 ✅ | v2.5.3 |
| BUG 数 | 未知 | 排查清单 + 修 P0/P1 |

**O1 阶段（账号互通）**：

| 指标 | 当前 | 1 个月目标 |
|---|---|---|
| oiwb 已登录用户数 | 0 | ≥ 3 |
| 跨站 ticket 成功率 | 0 | ≥ 95% |
| 云备份启用数 | 0 | ≥ 5 |
| 从 oiwb 跳 mdqp 存片段 | 0 | ≥ 30 |

**O2 阶段（SSO）**：

| 指标 | 当前 | 2 个月目标 |
|---|---|---|
| 直接访问 oiwb 自动登录率 | 0% | ≥ 80% |
| 平均登录摩擦（步数） | 5+ | 0 |

**O3-O5 阶段（数据互通 + 社交 + AI）**：

| 指标 | 当前 | 季度目标 |
|---|---|---|
| OI 题手榜上榜人数 | 0 | ≥ 20 |
| AI 错题分析使用率 | 0 | ≥ 40% 错题 |
| AI 训练计划点击率 | 0 | ≥ 50% 周活 |
| 跨 app 偏好同步启用率 | 0 | ≥ 60% 登录用户 |

---

## 九、现在该做的 3 件事（v3.0 更新版）

1. **O0-1 上传 + 开 Actions 写权限**（你做，10 分钟）——比赛视图现在是负体验。
2. **O0-3 全量 BUG 排查**（我做，1 天）——2906 行趁功能没翻倍前清债。
3. **🆕 O1-1 账号互通 + 跨站 ticket**（我做，1–2 天）——**这是你今晚提的核心需求**，含 4 个 mdqp auth API + oiwb 检测 ticket + 后台 refresh。

---

## 十、你问我答（方案自检）

**Q1**：oiwb 会不会变得很重？
**A**：不会。oiwb 仍零依赖、零构建，单文件大小仅 +10KB（增 ticket 检测 + refresh 循环 + 账号 UI）。mdqp 是后台，oiwb 只发请求。

**Q2**：账号互通会不会破铁律⑤（零外链单文件）？
**A**：不会。所有 fetch 指向 `mdqp.pages.dev`（一个域），不引第三方 JS/CDN；可降级——mdqp 挂了 oiwb 完全本地用。

**Q3**：跨站 ticket 安全吗？
**A**：和 OAuth 2.0 的 authorization code 同级别：5min 过期 + 一次性（jti 表查重）+ scope 限定 + HTTPS。远比 cookie 共享安全。

**Q4**：用户没 mdqp 账号能用 oiwb 吗？
**A**：能。oiwb 完全离线可用；登录只是"激活云端 + 跨站同步"。**未登录体验与现在 100% 一致**。

**Q5**：方案 B（共同域 Cookie）会不会让 oiwb 离不开 mdqp？
**A**：会"无感依赖"，但**不会"硬依赖"**。Cookie 失败时自动 fallback 到 ticket / 二维码 / 完全本地。**核心仍是 localStorage**。

**Q6**：AI 教练要花多少钱？
**A**：Workers AI 免费层 10k neurons/天；能力核日推一次约 100-500 neurons/用户，**20 个用户 1 天不到 1 万，免费够用**。超限自动降级到本地启发式。

**Q7**：OI 题手榜会让 OI 圈反感吗？
**A**：默认**完全私密**；用户**主动 opt-in** 才公开；scope 自助选 self / school / national。**不主动曝光任何排名**。

**Q8**：要不要立刻做 O4/O5？
**A**：**不建议**。O0+O1+O2 走完（约 4 周）再启动 O3-O5；OI 训练场景下用户基数小，AI 训练数据少，**过早做 AI 教练效果差**。

---

*本方案 2026-09-04 19:00 编写，在 v2.1 事实核对基础上加入"账号互通 + 跨站自动登录"核心需求与"天马行空"扩展。O1-1 已完成（2026-09-04）；下一步待办：O0-3 全量 BUG 排查、O0-1 上传 + 开 Actions 写权限、oiwb 部署到 oiwb.pages.dev 打通端到端。*