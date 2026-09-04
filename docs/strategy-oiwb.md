# oiwb × mdqp 整合方案（v2.1 · 事实核对版）

> **取代关系**：本方案基于 `strategy-competitive.md`（v1, 2026-09-03）与站长 2026-09-04 拍板的定位反转（**oiwb 主产品 / mdqp 附庸**）编写，并据 `2026-08-03-16-07-01/对话上下文整合.md` 完成事实核对（2026-09-04 18:50）。
> v2.0 中基于旧副本的判断已按本地实测修正，修正点见 §0。mdqp 网址（mdqp.pages.dev）与页面结构**不变**。

---

## §0. 相比 v2.0 的事实修正（先认错）

| v2.0 的错误判断 | 实测事实 | 来源 |
|---|---|---|
| 「oiwb 是 v2.5、2881 行」 | 代码含 v2.5.3 的 `normDash` 修复，但 `APP_VER` 仍写 `'v2.5'` → **版本号没 bump** | `oi-workbench.html:2497` |
| 「W5 部署地址未定」 | `github-upload/` 已整理完毕（`.github` 带点已修正），**用户自己上传 GitHub** | 目录实测 |
| 「W6 移动端未适配」 | 已有暗色模式 + 窄屏单列 + 添加到主屏变 APP | 上下文 §2 |
| 「W1 刮削可能停跑」 | **从未跑过**——仓库还没上传，`contests.json` 是 8/4 的种子数据 | `updated: 2026-08-04T09:00` |
| 功能清单漏项 | 实有：模拟决斗、回收站、自动备份、暗色模式、数据统计、30 条提醒 | grep 实测 |

**三份 HTML 是同一文件**（md5 `932c0f6b…`）：`2026-08-03-16-07-01/oi-workbench.html` = `github-upload/index.html` = 本工作区 `oiwb/index.html`。**后续统一以 `github-upload/` 为准**，另外两处是副本（本工作区 `oiwb/github/` 是丢点号的废弃残留）。

---

## 一、现状盘点（2026-09-04 实测）

**代码**：单文件 `index.html`，213 KB / 2881 行，原生 HTML/JS/CSS，零依赖零构建，纯 `localStorage`，离线可用。`APP_VER='v2.5'`（实际已含 v2.5.1~v2.5.3 修复）。

**功能面**（已远超 MVP）：

| 模块 | 内容 |
|---|---|
| 题目管理 | 洛谷八档难度配色、标签、题解链接、掌握度、批量操作、回收站、自动备份 |
| 比赛 | CF / AtCoder / 洛谷 / 牛客 / Vjudge 多源聚合 + 实时倒计时 |
| 模拟决斗 | 自定义题单 + 限时自测，赛前热身 |
| OJ 导入 | 8 个浏览器端爬取脚本，粘贴 JSON 即导入，含重复检测 |
| 数据统计 | 刷题量、正确率、科目分布 |
| 设置页 | 主题 / 紧凑 / 字号 / 默认难度 / 平台 / 30 条提醒 / 归档天数 / 自动备份 / CORS 代理 / 回收站天数 |
| 帮助 | Wiki 页（左侧目录 + 全文搜索 + 14 节详解 + 难度表 + 更新日志） |
| 新手指引 | 8 步镂空蒙层（clip-path 真三角箭头） |
| 外观 | 暗色模式、窄屏单列、添加主屏变 APP |

**八条铁律**（改代码时不可破）：
> ① 导出/导入/清空/重置必须有 ② 30 条提示 ③ 今天处理常驻 ④ 昨天没做完自动顺延 ⑤ 零外链单文件 ⑥ 本地存储 ⑦ 预置示例数据 ⑧ 空数据不崩

**问题清单**（修正后）：

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| **W1** | **仓库未上传 → Actions 从未跑 → 比赛数据停在 8/4**，首页比赛视图全是过期赛事 | `contests.json: updated 2026-08-04` | 🔴 |
| **W2** | **数据孤岛**：一切在 localStorage，换机/清缓存全丢 | 无远端同步 | 🔴 |
| **W3** | 无账号，无法与 mdqp 联动 | — | 🔴 |
| **W4** | **`APP_VER` 未 bump**：v2.5.1/2/3 的修复用户永远看不到（更新日志也停在 v2.5） | `:2497` + changelog 无 v2.5.x 条目 | 🟠 |
| **W5** | 存量 BUG 未系统排查（tour 选择器已验证 OK；其余 8 类模式未扫） | — | 🟠 |
| **W6** | 自动备份只写本地，防不了换机/清缓存 | 上下文 §2 | 🟡 |

---

## 二、定位（一句话）

> **oiwb：OI / 信奥选手的日常训练工作台。**（概览 · 题目 · 比赛 · 决斗 · 工具）
> **mdqp：工作台的「片段库 + 账号层」**——训练中产生的模板、题解、笔记存进 mdqp，可搜、可分享、有账号、有云端备份。

闭环旅程：

```
oiwb 概览（今天练什么）→ 题目页（整理题单、标 AC）→ 写模板/题解
   → 一键存 mdqp（自动打标签：OJ / 题号 / 算法）
   → 三个月后：oiwb 工具页「片段库」→ 搜到它（mdqp 私有搜索 API）
   → 换电脑：oiwb 设置页「从云端恢复」→ mdqp 拉回完整快照
```

---

## 三、整合架构（网址不变，怎么"附庸"）

### 3.1 原则

1. oiwb 永远**纯静态单文件**（GitHub Pages → 后续 `oj.yanzien.eu.org`），零后端进程；
2. mdqp **不改 URL、不改现有页面**，只在 `src/worker.js` **新增** oiwb 专用端点；
3. **可降级**：mdqp 挂了 oiwb 照常本地可用（localStorage 是本地缓存 + 离线兜底）；
4. 复用 mdqp 已有 JWT / 限额 / D1——**不给 oiwb 单独建后端**；
5. **不破八条铁律**（尤其⑤零外链单文件：mdqp 交互走可选云端，不引外部 CDN）。

### 3.2 数据流

```
┌──────────────────────────┐          ┌───────────────────────────────┐
│ oiwb（静态单文件）         │          │ mdqp（Cloudflare Pages + D1） │
│ localStorage = 本地缓存   │ ──JWT──→ │ POST /api/oiwb/sync  存快照   │
│ 换机可全量恢复             │ ←─────── │ GET  /api/oiwb/sync  取快照   │
│ 「存到片段库」按钮 ──────────────→ │ POST /api/clips（已有✅）     │
│ 「片段库」面板 ────────────────→ │ GET /api/me/clips?q=（已有✅）│
└──────────────────────────┘          └───────────────────────────────┘
```

**两期同步**：

- **一期（快）· 快照同步**：oiwb 整个 state 序列化成 JSON（复用现有「导出数据」格式），登录 mdqp 后手动/每日推到 `oiwb_snapshots(uid, blob, size, updated_at)`。实现量小，**先解决 W2/W6 丢数据**。
- **二期（细）· 结构化**：题目/比赛逐条 upsert（`oiwb_tasks`），按 `updated_at` 做多端合并。一期跑顺再做。

**mdqp 侧改动**：

```sql
CREATE TABLE IF NOT EXISTS oiwb_snapshots (
  uid INTEGER PRIMARY KEY,
  blob TEXT NOT NULL,       -- JSON 快照（题目/链接/比赛配置）
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
- `POST /api/oiwb/sync`：校验登录 + 按权益限额大小（L0 200KB / L1 500KB / L2+ 1MB）；
- `GET /api/oiwb/sync`：返回 `{ blob, updated_at }`；
- 权益矩阵加一行「**oiwb 云备份**：L0 手动 1 份 / L1 自动每日 / L2+ 自动 + 7 份历史」——给等级一个新的真实权益，且**复用现有技术栈、零新增依赖**。

### 3.3 联动（mdqp 现成能力，零后端改动）

- **存模板/笔记** → 跳 `mdqp.pages.dev/new?title=<题名>&tags=OI,<OJ>,<算法>&back=oiwb`（mdqp 侧小改：`/new` 支持 query 预填）；
- **片段库面板** → oiwb 内嵌弹层调 `GET /api/me/clips?q=&tag=OI`（mdqp 加 CORS 白名单）；
- 两处都**可选**——不登录也能正常用 oiwb（不破「零外链 + 离线可用」铁律）。

### 3.4 部署与分工

| 站点 | 地址 | 谁部署 |
|---|---|---|
| oiwb | `yanzien.github.io/oiwb/` → 启用域后 `oj.yanzien.eu.org` | **用户自己 git push `github-upload/`**（分工约定：纯 GitHub 上传用户做，AI 只备文件夹） |
| mdqp | `mdqp.pages.dev`（不变） | AI（wrangler 部署） |
| app-hub | `yanzien.github.io/app-hub/` | 已有，加 oiwb 图标即可 |

---

## 四、排期

### P0 · 本周（先让东西活起来）

| # | 项 | 做什么 | 谁 | 验收 |
|---|---|---|---|---|
| **O0-1** | **上传 + Actions 开权限** 🔴 | 推 `github-upload/` → Settings → Pages（main 根目录）→ Settings → Actions → General 开 **Read and write permissions**（爬虫要自动提交 contests.json） | **用户** | 首页看到未来比赛；Actions 每 30 分钟跑一次 |
| **O0-2** | **APP_VER bump + 更新日志** 🟠 | `APP_VER='v2.5.3'`；changelog 补 v2.5.1（箭头/脚本）、v2.5.2（设置页竖排/重复检测）、v2.5.3（洛谷难度 normDash）三条；加「新版本提示」（照抄 mdqp `maybeShowVersionToast` 模式） | AI | 帮助页能看到 v2.5.3 |
| **O0-3** | **存量 BUG 排查** 🟠 | 按 9 类模式扫 2881 行：JSON.parse 容错、`tickContests` 时区/跨年边界、sort 比较器未定义变量（mdqp 踩过的 `cb` 坑）、innerHTML 未过 `esc()`、事件委托 selector、导入 JSON 结构校验 | AI | BUG 清单 + P0/P1 级修完 |

### P1 · 2–3 周（打通附庸）

| # | 项 | 依赖 |
|---|---|---|
| **O1-1** | mdqp 账号接入（oiwb 设置页「云端」区块，JWT 存 localStorage，可选登录） | mdqp CORS 放行 oiwb 域 |
| **O1-2** | 快照同步（§3.2 一期）：手动「备份到云端 / 从云端恢复」+ 可选每日自动 | `oiwb_snapshots` 表 |
| **O1-3** | 「存到片段库」按钮 + mdqp `/new` 支持 query 预填 | mdqp 小改 |
| **O1-4** | 「片段库」面板（内嵌 mdqp 私有搜索） | `GET /api/me/clips` 开 CORS |

### P2 · 视使用情况

- O2-1 结构化同步（多端合并）；
- O2-2 比赛浏览器通知（赛前 30 分钟）；
- O2-3 题目元数据增强：算法标签、难度分、错题本（「只看没 AC 的」）；
- O2-4 移动端布局深化（底部 Tab 导航）；
- O2-5 训练看板（周做题量 / AC 率折线，纯本地画）；
- O2-6 上下文「材料清单」未做项：虚拟滚动、分享链接、标签系统、月视图、代码高亮笔记。

---

## 五、mdqp 侧排期调整（对 v1 的修订）

| v1 条目 | v2.1 处置 |
|---|---|
| P0-1 ~ P0-4（权益矩阵/字数/草稿/我的剪贴板） | ✅ 全部上线（v4.6 / v4.6.2） |
| P0-5 资源瘦身 | 保留，降优先级（附庸角色不需要重型首屏） |
| P1-2 开放 API | **提前**——它是 oiwb 联动的技术底座（Bearer token 供 oiwb 使用） |
| P1-4 发现广场 / SEO | 降级，流量从 oiwb 来 |
| P2-1 OI 垂直化 | **合并进 O1-3/O1-4**（打 OI 标签就是最小垂直化） |
| P2-2 埋点看板 | **提前到 P0**：加 `events` 表，否则 oiwb 导流无法衡量 |

**mdqp 新增工作项**：

| # | 项 | 量级 |
|---|---|---|
| M1 | `oiwb_snapshots` 表 + `POST/GET /api/oiwb/sync` | 0.5 天 |
| M2 | `/new` 支持 `?title=&tags=` 预填 + CORS 白名单 | 0.5 天 |
| M3 | `events` 埋点表 + 最小看板 | 1 天 |
| M4 | API Key（`api_keys` 表 + Bearer 鉴权，v1 P1-2 提前） | 1 天 |

---

## 六、已知坑（别再踩，来自上一进程）

1. **`.github` 必须带点且在仓库根**（Windows Git Bash `mkdir` 会建成 `github`）。本工作区 `oiwb/github/` 是**废弃残留**，勿用；以 `github-upload/.github/` 为准。
2. **GitHub Pages 入口必须 `index.html`**（不是 `oi-workbench.html`）。
3. **洛谷难度**：永远先 `normDash()` 归一化 Unicode 减号再查 `LUOGU_DIFF_MAP`。
4. **指引箭头**：用 `clip-path: polygon()` 真三角，别用 `rotate(45deg)` 正方形（渲染成凹菱形）。
5. **改版本记得 bump `APP_VER`**（本次 W4 就是教训）。
6. **沙箱限制**：可访问 `api.cloudflare.com`，但 `auth.cloudflare.com` 返 522；无法连通 `workers.dev`/`mdqp.cc.cd`。线上验证须用户浏览器侧。
7. **前端数据只在 localStorage**：部署后页面公开但看不到数据，别在公开页预填隐私。

---

## 七、指标

北极星不变：**内容沉淀率**（回访旧板比例）。oiwb 侧新增：

| 指标 | 当前 | 1 个月目标 |
|---|---|---|
| 比赛数据新鲜度 | 8/4（未跑过） | < 24h |
| oiwb 周活 | 未知（无埋点） | ≥ 10 |
| 云备份启用数 | 0 | ≥ 5 |
| 从 oiwb 存入 mdqp 的片段 | 0 | ≥ 30 |

---

## 八、现在该做的 3 件事

1. **O0-1 上传 + 开 Actions 写权限**（你做，10 分钟）——比赛视图现在是负体验，上传后 Actions 自动每 30 分钟爬，数据自己就活了。
2. **O0-2 APP_VER bump + 更新日志**（我做，半小时）——1 行版本号 + 3 条 changelog，让 v2.5.1~2.5.3 的修复被看见。
3. **O0-3 全量 BUG 排查**（我做，1 天）——2881 行趁功能没翻倍前清债，重点 sort 比较器 / 日期边界 / 导入校验。

---

*本方案 2026-09-04 18:50 核对本地实际文件后定稿，接管 `strategy-competitive.md` 中 oiwb 相关排期。*
