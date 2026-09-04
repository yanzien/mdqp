# oiwb × mdqp 整合方案（v2 · 定位反转版）

> **取代关系**：本方案基于 `strategy-competitive.md`（v1, 2026-09-03）改写，落实站长 2026-09-04 拍板的新定位——
> **「oiwb（OI 信奥工作台）是主产品，mdqp 是它的附庸」**。mdqp 网址（mdqp.pages.dev）与页面结构**不变**，只做定位与接口层调整。
> v1 中与本文冲突的条目，以本文为准；未冲突条目（P0 已完成的、P1/P2 生态项）继续有效。

---

## 〇、一句话定位

> **oiwb：OI / 信奥选手的日常训练工作台**（概览 · 题目 · 比赛 · 工具）。
> **mdqp：工作台的「片段库 + 账号层」**——训练中产生的模板、题解、笔记，一跳存进 mdqp，可搜、可分享、有账号。

用户旅程（闭环）：

```
oiwb 概览页（今天该练什么）
   → 题目页（整理题单、标记 AC）
   → 写模板/题解（oiwb 编辑或任意编辑器）
   → 一键存入 mdqp（自动打标签：来源 OJ / 题号 / 算法标签）
   → 三个月后：oiwb 工具页 → 「片段库」→ 搜到它（mdqp 私有搜索 API）
```

**为什么这个定位成立**（承接 v1 §4.2 的三支柱，主从关系换位）：

| 支柱 | v1 说法（mdqp 本位） | v2 说法（oiwb 本位） |
|---|---|---|
| 存得下找得到 | mdqp 是片段库 | oiwb 管训练状态，mdqp 管**内容沉淀**，两边共用一个账号 |
| 控得住 | 密码/过期/读者数 | 不变（mdqp 独有能力，oiwb 不重复造） |
| 认得出 | 竞赛身份名片 | cpoauth 名片挂在 oiwb 个人页，mdqp 只做底层 |

---

## 一、oiwb 现状盘点（2026-09-04 实测）

**代码**：`yanzien/oiwb`，单文件 `index.html` 2881 行（原生 HTML/JS/CSS，无框架、无构建），`APP_VER='v2.5'`，纯 `localStorage` 持久化。

**功能面**（已相当完整）：
- 五视图：概览 / 网站（导航） / 题目（任务表：增删改、批量操作、AC 标记、搜索/排序/筛选） / 比赛（多源聚合） / 工具；
- 设置 + 帮助 + wiki 搜索 + 新手指引 tour（选择器已全部验证有效）；
- OJ 粘贴导入（`parseOJJson` / `importProblems` / `importContests`）；
- 导入导出 / 清空 / 重置 / CSV 导出；
- 数据源：GitHub Actions 刮削（`scrape.py`：CF / 洛谷 / AtCoder / 牛客，串行 + 2s 间隔）+ Cloudflare Worker（`luogu-contests.js`）。

**问题清单**（按严重度）：

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| W1 | **比赛数据过期**：contests.json 全是 2026-08-09~12 的旧赛事，首页比赛视图等于摆设 | `contests.json` 内容 | 🔴 |
| W2 | **数据孤岛**：一切在 localStorage，换电脑 / 清缓存 / 手机访问 = 全丢 | 无任何远端同步 | 🔴 |
| W3 | **无账号**：没有登录，无法识别用户，也无法与 mdqp 联动 | — | 🔴 |
| W4 | 存量 BUG 未系统排查（第一轮 review 只验证了 tour 选择器；sort 比较器 / JSON.parse 容错 / innerHTML 转义等模式还没扫完） | — | 🟠 |
| W5 | 部署地址未定（本地 oiwb/ 目录 + GitHub 仓库，未见稳定线上入口；个人域 yanzien.eu.org 未启用） | — | 🟠 |
| W6 | 移动端未适配（桌面优先的单文件布局） | — | 🟡 |

---

## 二、整合架构（网址不变，怎么"附庸"）

### 2.1 原则

1. **oiwb 永远是纯静态前端**（GitHub Pages / 后续 yanzien.eu.org 子域 oj.yanzien.eu.org），零后端进程——与现有 serverless 架构一致；
2. **mdqp 不改 URL、不改现有页面**，只在 `src/worker.js` **新增** oiwb 专用 API；
3. 所有同步**可降级**：mdqp 挂了，oiwb 照常本地可用（localStorage 为本地缓存 + 离线兜底，mdqp 为云端备份）；
4. 复用 mdqp 已有的 JWT 鉴权、限额、D1——**不给 oiwb 单独建后端**。

### 2.2 数据流

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ oiwb (静态 SPA)          │        │ mdqp (Cloudflare Pages + D1) │
│ localStorage = 本地缓存  │ ─────→ │ POST /api/oiwb/sync          │
│ 换机器/清缓存可全量恢复   │ ←───── │ GET  /api/oiwb/sync          │
│                         │  JWT   │ （新表 oiwb_snapshots）       │
│ 「存到片段库」按钮 ─────────→ │ POST /api/clips（已有！）      │
│ 「片段库」搜索面板 ─────────→ │ GET  /api/me/clips?q=（已有！）│
└─────────────────────────┘        └──────────────────────────────┘
```

**关键决策：两种同步粒度，分两期做**

- **一期（快）· 快照同步**：oiwb 整个 state 序列化成一个 JSON blob（现有「导出数据」的格式），登录 mdqp 账号后手动/定时推到 `oiwb_snapshots(uid, blob, updated_at)`。换机器时拉回来一键恢复。实现量小（一个新端点 + oiwb 设置页加「云端备份」区块），**先解决 W2 数据丢失**。
- **二期（细）· 结构化同步**：题目/比赛逐条 upsert（`oiwb_tasks(uid, task_id, status, ...)`），支持多端合并（按 updated_at 冲突取舍）。等一期用起来再做。

**mdqp 侧改动清单（一期）**：

```sql
CREATE TABLE IF NOT EXISTS oiwb_snapshots (
  uid INTEGER PRIMARY KEY,
  blob TEXT NOT NULL,            -- JSON 快照（task/link/contest 配置）
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
- `POST /api/oiwb/sync`：body = { blob }，校验登录 + 大小上限（按权益等级：L0 200KB / L1 500KB / L2+ 1MB），写快照；
- `GET /api/oiwb/sync`：返回 { blob, updated_at }；
- 权益矩阵加一行「oiwb 云备份：L0 手动 1 份 / L1 自动每日 / L2+ 自动 + 7 份历史」——**给等级一个新的真实权益**（呼应 v1 P0-1）。

### 2.3 「存到片段库」联动（mdqp 现成能力，零后端改动）

oiwb 题目条目 / 工具页加按钮：
- **存模板/笔记** → 跳 `mdqp.pages.dev/new?title=<题目名>&tags=OI,<OJ名>,<算法标签>&back=oiwb`（mdqp 编辑器读 URL 参数预填，需 mdqp 侧小改：`/new` 支持 query 预填 title/tags）；
- **片段库面板** → oiwb 内嵌一个弹层，调 mdqp `GET /api/me/clips?q=&tag=OI`（跨域：mdqp API 已有 CORS 或加 `oiwb` 来源白名单），展示 + 一键复制。

### 2.4 部署归位

| 站点 | 地址 | 说明 |
|---|---|---|
| oiwb | `yanzien.github.io/oiwb/` → 启用域后 `oj.yanzien.eu.org` | 主产品入口 |
| mdqp | `mdqp.pages.dev`（不变） | 片段库 + oiwb 同步后端 |
| app-hub | `yanzien.github.io/app-hub/` | 桌面中枢，加 oiwb 图标 |

---

## 三、oiwb 自身优化排期

### P0 · 本周（修复 + 存活）

| # | 项 | 做什么 | 验收 |
|---|---|---|---|
| **O0-1** | **比赛数据复活** 🔴 | ① 检查 GitHub Actions 刮削 workflow 是否停跑（`scrape.py` 的触发记录）；② 修好或改手动触发 + oiwb 首页加「数据更新于 X 天前」过期标黄；③ contests.json 404/空时前端降级提示「赛事源维护中」 | 首页能看到未来的比赛 |
| **O0-2** | **存量 BUG 排查** 🟠 | 按 9 类模式扫 2881 行：JSON.parse 容错、日期/时区边界（`tickContests` 倒计时）、sort 比较器未定义变量（mdqp 踩过的 `cb` 坑）、innerHTML 未过 `esc()`、事件委托 selector、导入 JSON 结构校验 | 产出 BUG 清单并修 P0/P1 级 |
| **O0-3** | **版本提示** 🟢 | 照抄 mdqp 的 `maybeShowVersionToast` 模式：`APP_VER` 对比 localStorage，新版弹更新日志 | 用户知道更新了什么 |

### P1 · 2–3 周（云同步 + 联动）

| # | 项 | 做什么 | 依赖 |
|---|---|---|---|
| **O1-1** | **mdqp 账号接入** | oiwb 设置页「云端」区块：登录 mdqp（跳 mdqp 登录 / 或 oiwb 内嵌登录弹层调 mdqp API）；JWT 存 localStorage | mdqp CORS 放行 oiwb 域 |
| **O1-2** | **快照同步（一期）** | §2.2 一期方案：手动「备份到云端 / 从云端恢复」+ 可选每日自动 | `oiwb_snapshots` 表 |
| **O1-3** | **存到片段库** | §2.3 联动按钮 + mdqp `/new` 支持 query 预填 | mdqp 小改 |
| **O1-4** | **片段库面板** | oiwb 工具页内嵌 mdqp 私有搜索 | `GET /api/me/clips` 开 CORS |

### P2 · 视使用情况

- **O2-1** 结构化同步（二期，多端合并）；
- **O2-2** 比赛浏览器通知 / 桌面提醒（赛前 30 分钟）；
- **O2-3** 题目元数据增强：算法标签、难度分、错题本视图（「只看没 AC 的」）；
- **O2-4** 移动端布局（至少概览 + 比赛两视图可用）；
- **O2-5** 训练数据看板（每周做题量、AC 率折线——本地画，不上传）。

---

## 四、mdqp 侧排期调整（对 v1 的修订）

| v1 条目 | v2 处置 |
|---|---|
| P0-1 ~ P0-4（权益矩阵/字数/草稿/我的剪贴板） | ✅ 已全部上线（v4.6 / v4.6.2） |
| P0-5 资源瘦身 | 保留，优先级降（附庸角色不需要重型首屏） |
| P1-1 版本历史 / P1-2 开放 API / P1-5 收藏 Fork | **保留但重排**：P1-2 开放 API 提前——它是 oiwb 联动的技术底座（Bearer token 供 oiwb 使用） |
| P1-4 发现广场 / SEO | 降级。附庸角色不需要独立获客，流量从 oiwb 来 |
| P2-1 OI 垂直化 | **提前合并进本方案 O1-3/O1-4**（题解打 OI 标签就是最小垂直化） |
| P2-2 埋点看板 | **保留且提前到 P0**：加 `events` 表，否则 oiwb 导流效果无法衡量 |

**mdqp 新增工作项**：

| # | 项 | 量级 |
|---|---|---|
| M1 | `oiwb_snapshots` 表 + `POST/GET /api/oiwb/sync` | 0.5 天 |
| M2 | `/new` 支持 `?title=&tags=` 预填 + CORS 白名单（`yanzien.github.io` / `oj.yanzien.eu.org`） | 0.5 天 |
| M3 | `events` 埋点表 + 管理员看板最小版 | 1 天 |
| M4 | API Key（`api_keys` 表 + Bearer 鉴权，v1 P1-2 提前） | 1 天 |

---

## 五、指标（对 v1 §六的修订）

北极星指标不变：**内容沉淀率**（回访旧板比例）。

新增 oiwb 侧指标：

| 指标 | 当前 | 1 个月目标 |
|---|---|---|
| oiwb 周活（本地 version 上报） | 未知 | ≥ 10 |
| 云备份启用数 | 0 | ≥ 5（= 全部注册用户的一半） |
| 从 oiwb 存入 mdqp 的片段数 | 0 | ≥ 30 |
| 比赛数据新鲜度 | 停在 8-12 | < 24h |

---

## 六、现在该做的 3 件事（按 ROI 排序）

1. **O0-1 比赛数据复活**（半天）——首页比赛视图现在是负体验（全是过期比赛），这是工作台的门面。
2. **O0-2 oiwb 全量 BUG 排查 + 修复**（1 天）——单文件 2881 行，趁功能没翻倍前清一次债。
3. **M1+M2 mdqp 联动端点 + O1-1/O1-2 oiwb 登录与快照同步**（2 天）——打通「附庸」架构的第一根管子，也是唯一能防「用户数据全丢」的事。

---

## 七、风险与红线

| 风险 | 缓解 |
|---|---|
| oiwb 数据格式演进后旧快照恢复失败 | blob 里带 `schema_ver`，恢复时做迁移函数；mdqp 只存不解析（opaque blob） |
| mdqp 挂了拖垮 oiwb | 同步失败静默降级（本地照常）；超时 ≤4s；失败重试队列 |
| 跨域/凭证滥用 | JWT + CORS 白名单只放 oiwb 两个域；snapshot 大小按权益限额 |
| 两边版本节奏不同步 | oiwb 的 mdqp API 调用带 `X-Oiwb-Ver` 头，mdqp 侧可统计存量版本 |
| **过度设计复发**（v1 §八原样有效） | 每个新功能先回答：这让选手更愿意**每天打开 oiwb**吗？ |

---

*本方案 2026-09-04 起生效，接管 `strategy-competitive.md` 中 oiwb 相关排期。mdqp 自身（片段库）仍按 v1 未完成项推进，优先级让位于本方案 M1–M4。*
