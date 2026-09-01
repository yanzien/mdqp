# mdqp × CPOAuth：引导接入与功能升级方案

> 文档性质：规划设计稿，不是站点内容页（不会被同步到 `/help` 或 `/changelog`）。
> 撰写时间：2026-09-01 · 对应 mdqp v4.3
> 一句话结论：**mdqp 目前只把 CPOAuth 当成"登录按钮"，而它其实还能提供身份数据、竞赛战绩和撤销能力 —— 只用了不到两成。**

---

## 〇、先看一个事实

写这份方案时实测：

```
GET https://www.cpoauth.com/  →  502（连续 3 次）
GET https://mdqp.pages.dev/api/auth/cpoauth-status  →  {"ok":false,"status":502}
```

**CPOAuth 此刻正在宕机，mdqp 已自动进入降级模式。** 这不是假设性的风险，是正在发生的状态。

v4.2 做的密码兜底是对的，但它只解决了"进得去"，没解决"引导用户主动把兜底准备好"，更没解决"CPOAuth 明明还有很多能力没用上"。这份方案就是要补这两件事。

---

## 一、现状盘点：mdqp 现在到底用了 CPOAuth 的什么

### 1.1 已接入的部分

| 项目 | 现状 |
|---|---|
| 流程 | 授权码模式 + PKCE(S256) + state 防 CSRF（标准、正确） |
| 端点 | `/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo` |
| scope | `openid profile cp:linked`（可用 Secret `CPOAUTH_SCOPE` 覆盖） |
| 用到字段 | `sub`、`username`、`display_name`、`avatar_url`、`bio`、`linked_accounts` |
| 落库 | `users.sub` 作主键；`linked_accounts` 存 JSON |
| 展示 | `linkedAccountChips()` 渲染成纯文字 chip（`洛谷 · xxx`），无图标、无跳转 |
| 其他 | `/api/auth/cpoauth-status` 连通性探测（4s 超时）、宕机时隐藏按钮 + 降级横幅 |

### 1.2 一句话诊断

> **登录链路是及格的，身份价值是零开发的。**
> 用户绑定了洛谷 / Codeforces / AtCoder，mdqp 只把它显示成一行灰字，既不能点、也不好看、更不影响任何功能。

---

## 二、CPOAuth 完整能力清单（及 mdqp 未用部分）

数据来源：CPOAuth 官方仓库 `Ark-Aak/cp-oauth`。

### 2.1 Scope 全景

| Scope | 返回内容 | mdqp 是否使用 | 说明 |
|---|---|---|---|
| `openid` | `sub`（用户唯一 ID） | ✅ 已用 | 必需 |
| `profile` | `username` `display_name` `avatar_url` `bio` | ✅ 已用 | |
| `cp:linked` | `linked_accounts[]`（全部已绑平台） | ✅ 已用 | 但只做了文字展示 |
| `email` | `email` `email_verified` | ❌ **未用** | 可用于账号找回 / 通知 |
| `link:luogu` | 仅洛谷绑定项 | ❌ 未用 | 单平台最小授权 |
| `link:atcoder` | 仅 AtCoder | ❌ 未用 | |
| `link:codeforces` | 仅 Codeforces | ❌ 未用 | |
| `link:github` | 仅 GitHub | ❌ 未用 | |
| `link:google` | 仅 Google | ❌ 未用 | |
| `link:clist` | 仅 Clist | ❌ 未用 | 见下方"重要前提" |
| `link:leetcode` | 仅 LeetCode | ❌ 未用 | 上游尚未开放用户绑定入口 |
| **`cp:summary`** | **`cp_summary`：各平台 rating、最高 rating、比赛场次、平台排名、最近活动** | ❌ **未用** | **价值最高的未用能力** |
| **`cp:details`** | **`cp_details.rating_history[]`：逐场比赛的 old/new rating、名次、得分、时间** | ❌ **未用** | 可画 rating 曲线 |

> **重要前提**：`cp:summary` / `cp:details` 的数据来自 **Clist.by**，**必须用户已绑定 Clist 账号**才有数据；否则返回 `{ "available": false, "message": "..." }`。
> 这意味着它**覆盖不到大多数用户**，方案设计必须遵循"有则锦上添花，无则引导去绑" —— 不能做成核心依赖。

### 2.2 端点全景

| 端点 | 作用 | mdqp 是否使用 |
|---|---|---|
| `GET /oauth/authorize` | 发起授权 | ✅ |
| `POST /api/oauth/token`（`grant_type=authorization_code`） | 换 token | ✅ |
| `POST /api/oauth/token`（`grant_type=refresh_token`） | **刷新令牌** | ❌ **未用** |
| `GET /api/oauth/userinfo` | 取用户资料 | ✅ |
| `POST /api/oauth/revoke` | **撤销令牌（RFC 7009）** | ❌ **未用** |
| `GET /api/users/{username}/card.svg` | **用户资料卡 SVG**（支持 `width` / `theme` / `lang`） | ❌ **未用** |

**Token 生命周期（关键，mdqp 完全没管）：**
- `access_token`：JWT，**有效期 1 小时**
- `refresh_token`：不透明 token，**有效期 30 天**，且**强制轮换**（每次刷新都作废旧 token、发新 token）
- 撤销 `refresh_token` 会连带使该 client + user 下所有 `access_token` 失效

> **⚠️ 当前隐患**：mdqp 拿到的 `access_token` **用完即弃，从不保存**（换完 userinfo 就丢）。这在现在没问题（只用一次），但**一旦要做"后台定时同步竞赛数据"，就必须存 refresh_token 并实现轮换**。

### 2.3 CPOAuth 侧的其他能力（mdqp 可借势）

| 能力 | 说明 | 对 mdqp 的意义 |
|---|---|---|
| TOTP 2FA | CPOAuth 账号支持 | 可作为"高信任账号"信号 |
| WebAuthn | CPOAuth 账号支持 | 同上 |
| 用户端撤销授权 | 用户在 CPOAuth 个人页可撤销第三方应用 | mdqp 应提供直达入口（现在只有"关联账号"按钮） |
| 多语言 | CPOAuth 支持 en / zh / ja | `card.svg` 有 `lang` 参数 |

**小结 —— 未使用的能力占比：约 80%。**

---

## 三、第一部分：引导接入方案

### 3.1 为什么参考 Discourse

Discourse 是论坛软件里把"新用户引导"做得最彻底的一个。它的核心思想是：

> **登录不是终点，是起点。** 用户登录后的前 10 分钟，决定了他会不会留下。

Discourse 具体用了五招，我逐条对照 mdqp 已有的基础：

| Discourse 做法 | 机制 | mdqp 现状 | 可迁移性 |
|---|---|---|---|
| **Discobot 交互式教程** | 新用户收到私信，通过"边做边学"掌握回复、@提及、格式化 | 无 | ⭐⭐⭐⭐ 高（改造为 checklist） |
| **信任等级 TL0–TL4** | 沙盒：新用户受限，随行为渐进解锁权限 | 有 `feature_flags`，但是**管理员手动开关** | ⭐⭐⭐⭐⭐ 极高（改为自动解锁） |
| **徽章 Badges** | 成就系统，可自动触发或授予 | 有 VIP / 角色徽章，无成就体系 | ⭐⭐⭐⭐ 高 |
| **用户卡片 User Card** | 悬浮展示摘要 + 关联账号 + 徽章 | 有 `linkedAccountChips`，纯文字 | ⭐⭐⭐⭐⭐ 极高 |
| **节点式系统私信** | TL1/TL2/TL3 晋升各触发一封祝贺+下一步引导 | 无 | ⭐⭐⭐ 中（改为条件触发引导条） |
| **渐进式披露** | 对 TL0 隐藏高级功能，避免界面吓人 | 无，所有功能一次铺开 | ⭐⭐⭐⭐ 高 |
| **Bootstrap 模式** | 前 50 名注册用户自动 TL1 + 每日摘要，冷启动 | 无 | ⭐⭐⭐ 中 |

**关键判断**：mdqp 是工具站不是社区，没有"发帖/阅读"这类行为，**不能照搬 Discourse 的 TL 判定条件**，必须换成本站自己的行为事件（发板、设密码、绑定平台、邀请）。但"**沙盒 → 渐进解锁 → 成就激励 → 节点式触达**"这套骨架是完全可迁移的。

### 3.2 引导模型：三层四态

```
┌─ L0 匿名态 ──────────── 首屏一句话价值 + 单一 CTA ──────────┐
│                              ↓ 登录                          │
├─ L1 首登引导 ─────────── 3 步 Onboarding Checklist ─────────┤
│                              ↓ 完成/跳过                     │
├─ L2 能力解锁 ─────────── 按行为解锁功能 + 成就徽章 ──────────┤
│                              ↓ 长期                          │
└─ L3 条件召回 ─────────── 情境触发的引导条（可关闭）──────────┘
```

### 3.3 L0：登录弹窗改造（工作量：小）

**现状问题**：弹窗只给两个按钮，用户不知道为什么要选密码登录，也不知道 CPOAuth 是什么。

**改造后**：

```
┌────────────────────────────────────────┐
│  登录 mdqp                              │
│                                         │
│  [ 使用 CPOAuth 登录 ]        ← 主按钮  │
│    竞赛账号一站式登录，自动同步洛谷 /    │
│    Codeforces / AtCoder 绑定信息        │
│                                         │
│  ───────── 或 ─────────                │
│                                         │
│  [ 用户名 ] [ 密码 ] [ 登录 ]            │
│  [ 注册新账号 ]                          │
│                                         │
│  ⓘ 建议两种都设置：CPOAuth 是外部服务， │
│    设了密码等于留一把备用钥匙。          │
└────────────────────────────────────────┘
```

- CPOAuth 按钮下方补一行**说明文字**（现在没有，用户不知道 CPOAuth 是什么）
- 底部固定一行 ⓘ 提示，讲清"为什么要设密码"
- 宕机时（`/cpoauth-status` 返回 false）：CPOAuth 按钮置灰 +  tooltip「服务暂时不可用」+ 顶部黄色横幅

### 3.4 L1：首次登录 Onboarding Checklist（工作量：中）——对标 Discobot

Discourse 用对话式教程，mdqp 更适合 **checklist**（工具站，用户要的是快，不想陪机器人聊天）。

**三步，登录后立即以卡片形式出现在首页顶部：**

| 步骤 | 任务 | 对应现实风险 | 完成奖励 |
|---|---|---|---|
| ① | **设置密码**（30 秒） | CPOAuth 宕机 = 账号锁死 | 解锁"密码登录"成就 |
| ② | **发布第一篇剪贴板** | 用户不知道从哪开始 | 解锁"自定义短链" |
| ③ | **完善资料 / 绑定竞赛账号** | 主页空白、无辨识度 | 解锁"@提及" + 主页展示战绩 |

**规则：**
- 进度写库（`users.onboarding_step`），**换设备/清缓存不丢**
- 每步可单独跳过，底部有「全部跳过」（尊重用户，不强制）
- **全部完成后自动消失**，不再打扰
- 7 天内未完成则折叠为一行小字（不消失也不烦人）

**为什么第 ① 步是设密码**：这是唯一一个"用户不设、风险由用户自己承担、且此刻正在发生"的事（CPOAuth 现在就 502）。把它放第一步是最有说服力的。

### 3.5 L2：能力渐进解锁（工作量：中）——对标 Trust Levels

**现状**：`feature_flags` 由管理员逐个手动开关，新用户默认全开或全关。

**改造**：改为 **自动解锁 + 管理员可覆盖** 的双层模型。

| 等级 | 触发条件 | 解锁内容 |
|---|---|---|
| **Lv0 新用户** | 刚注册 | 基础创建、编辑自己的板 |
| **Lv1 常客** | 发布 ≥3 篇 **且** 设置密码 | 自定义短链、Markdown 高级语法 |
| **Lv2 活跃** | 发布 ≥10 篇 **或** 绑定 ≥1 个竞赛平台 | 协作板、评论、@提及、密码保护 |
| **Lv3 核心** | 邀请 ≥1 人 **或** 发布 ≥30 篇 | 不限字数、置顶、读者上限设置 |

- 管理员的手动开关**优先级更高**（`feature_flags` 保留，作为 override）
- 未解锁的功能**不隐藏**（避免用户困惑），而是**置灰 + 点击后提示解锁条件**（这比 Discourse 的"直接隐藏"更友好，因为工具站用户会以为功能不存在）

> 这一条直接复用现有的 `feature_flags` 数据结构，改动量比想象中小。

### 3.6 L3：条件触发的引导条（工作量：小）——对标节点式系统私信

| 触发条件 | 引导条内容 | 优先级 |
|---|---|---|
| 已登录 & `has_password === false` | 「设置密码，防止 CPOAuth 宕机时进不去」 | **P0（v4.3 已实现）** |
| CPOAuth 宕机 & 已登录无密码 | 「服务暂时不可用，现在设置密码才能保住账号」 | **P0** |
| 未绑定任何竞赛平台 | 「绑定洛谷/CF 账号，主页展示你的战绩」 | P1 |
| 已绑 Clist & 24h 未刷新战绩 | 「战绩数据已过期，点此刷新」 | P2 |
| 日配额用尽 | 「今日额度用完，邀请好友可提升」 | P1 |
| 剪贴板接近 300 字上限 | 「内容较长，VIP 不限字数」 | P2 |

**通用规则**（v4.3 已建立模式，复用即可）：
- localStorage 记录「忽略时间」，关闭后 7 天内不再出现
- 同一时刻**最多显示一条**，按优先级排序
- 每条都有明确 CTA 按钮 + 关闭按钮

### 3.7 关联账号区块升级（工作量：小，性价比极高）

**现状**：`洛谷 · xxx` 灰字 chip，不能点、无图标。

**改造后**：

```
已绑定平台                          [ 管理绑定 ↗ ]
┌──────────┬──────────┬──────────┐
│  🟦 洛谷   │  🟧 AtCoder│  🟥 CF    │
│  yanzien  │  yanzien  │  yanzien │
│  UID 123  │  rating    │  rating  │
└──────────┴──────────┴──────────┘
        [ ＋ 绑定更多平台 ]
```

- 每个平台一个**带品牌色的卡片**，显示 handle
-整块**可点击**，跳转到该平台的个人主页（`platform` + `platformUid` 拼 URL）
- 有 `cp_summary` 数据时，**在卡片上直接显示 rating**（这是关键增值点）
- 未绑定任何平台时，显示引导空态：「绑定竞赛账号，让主页展示你的战绩 [去绑定]」
- 「管理绑定 ↗」直达 `https://www.cpoauth.com/profile`

---

## 四、第二部分：功能升级规划

按优先级排列。**P0 都是安全/稳定性项，建议优先做。**

### P0-1 退出登录时撤销令牌（工作量：极小）

**问题**：用户点"退出"，mdqp 只清了自己的 cookie，CPOAuth 侧的 token 仍然有效（refresh_token 30 天）。

**做法**：存 refresh_token → 退出时调 `POST /api/oauth/revoke`。

```js
// 回调时保存
await db.prepare('UPDATE users SET cpoauth_refresh = ?, token_expires = ? WHERE id = ?')
        .bind(token.refresh_token, Date.now() + token.expires_in * 1000, userId).run();

// 退出时撤销
oauthRoutes.post('/logout', async (c) => {
  const rt = /* 从 DB 取 */;
  if (rt) await fetch('https://www.cpoauth.com/api/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: rt, token_type_hint: 'refresh_token',
      client_id: c.env.CPOAUTH_CLIENT_ID, client_secret: c.env.CPOAUTH_CLIENT_SECRET
    })
  });
  // 撤销失败也要清本地 cookie，不能卡住用户
  ...
});
```

**注意**：revoke **始终返回 200**，无法据此判断是否成功；且**撤销失败绝不能阻塞用户退出**——要 try/catch 吞掉。

### P0-2 Refresh Token 存取与轮换（工作量：中）

**为什么需要**：只要想做"后台定时拉竞赛数据"，就必须有它。

**要点**：
- 新表或新列存 `refresh_token` + `expires_at`
- **强制轮换**：每次刷新后必须用返回的新 refresh_token **覆盖**旧值，否则下次刷新直接失败
- 轮换失败（token 失效）→ 标记 `reauth_required`，前端引导用户重新授权一次

### P0-3 宕机引导升级为"三步自救"（工作量：小）

**现状**：横幅只说"服务不可用，请用密码登录"。但用户如果**没设密码**，这句话是把人堵死在门外。

**改造**：分支处理

| 用户状态 | 横幅内容 |
|---|---|
| 已设密码 | 「CPOAuth 暂时不可用，可用用户名+密码登录」+ [用密码登录] |
| 未设密码 & 已登录 | 「CPOAuth 暂时不可用，现在设置密码，否则下次登录可能进不去」+ [立即设置] |
| 未设密码 & 未登录 | 「CPOAuth 暂时不可用，且你没有设置密码。请联系站长 x 恢复账号」+ 微信二维码 |

第三条很重要：**不能出现"用户彻底无法自救"的场景**。

### P1-1 竞赛战绩展示（工作量：中，依赖高）

**scope**：新增 `cp:summary`

**展示位置**：个人主页 + `/u/:id` 公开主页

```
竞赛战绩                    （数据来自 Clist.by）
Codeforces     3800  🔴 Legendary
AtCoder        2290  🟨 4 kyu
─────────────────────────────
最高 rating  AtCoder 2290
参赛场次     230
```

**三种状态都必须处理**：
1. 未授权 scope → 「授权后展示战绩 [授权]」
2. 已授权但未绑 Clist → 「战绩数据需要绑定 Clist 账号 [去绑定]」（展示引导，不报错）
3. Clist API 故障 → `available: false` → 静默隐藏区块（不显示错误，避免吓到用户）

**现实约束**：Clist 绑定门槛高，预计覆盖率 <20%。所以这块定位是"**有则展示的加分项**"，不能作为核心卖点。

### P1-2 CPOAuth 资料卡嵌入（工作量：极小）

`GET https://www.cpoauth.com/api/users/{username}/card.svg?theme=dark&lang=zh&width=480`

**用法**：个人主页底部放一张 `<img>`，一行代码搞定，是最低成本的身份展示升级。

**必须处理**：`<img>` 加载失败要 `onerror` 隐藏（CPOAuth 会宕机）。且建议**后端代理缓存**（避免暴露用户 IP、避免每次都打外部服务）。

### P2-1 Rating 曲线（工作量：中大）

**scope**：`cp:details` → `rating_history[]`（含 old/new rating、名次、比赛名、日期）

用 Canvas 或 SVG 画折线图，放在个人主页。数据量大，建议**落库缓存**（`cp_rating_cache` 表），不要每次实时拉。

### P2-2 成就 / 徽章系统（工作量：中）——对标 Discourse Badges

| 徽章 | 条件 |
|---|---|
| 🔑 有备无患 | 设置密码 |
| 📝 开张大吉 | 发布第一篇 |
| 🏅 身经百战 | 发布 50 篇 |
| 🔗 跨界达人 | 绑定 ≥3 个平台 |
| 🎁 伯乐 | 邀请 ≥1 人 |
| ⭐ 元老 | 注册满 1 年 |

展示在用户名后面 + 个人主页徽章墙。这是**零成本提升留存**的手段。

### P2-3 站内竞赛排行榜（工作量：大）

有 `cp_summary` 数据的用户排个序，做 `/rank` 页面。**强依赖 Clist 绑定率**，建议等 P1-1 上线后看实际数据再决定。

### P2-4 题解场景（工作量：大，脑洞）

绑定洛谷后，新建剪贴板时可一键插入「题解模板」（题号、难度、思路、代码）。**这是把 mdqp 从"通用剪贴板"推向"OI 垂直工具"的关键差异化**，但需要想清楚是否要改产品定位 —— 建议单独立项讨论。

---

## 五、实施路线图

| 阶段 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **第 1 批（稳）** | P0-1 revoke、P0-3 宕机引导升级、L0 登录弹窗改造、3.7 关联账号升级 | 无 | 低 |
| **第 2 批（引导）** | L1 Onboarding Checklist、L2 渐进解锁、L3 条件引导条 | 需加 DB 字段 | 中（影响新用户路径） |
| **第 3 批（数据）** | P0-2 refresh token、P1-1 战绩展示、P1-2 资料卡 | **CPOAuth 后台放行新 scope** | 中（依赖外部） |
| **第 4 批（社区）** | P2-1 曲线、P2-2 徽章 | 第 3 批数据 | 中 |

**建议**：第 1 批可以马上做，不依赖任何外部变更，且能立刻改善"CPOAuth 宕机"这个正在进行的问题。

---

## 六、风险与前置条件（需要你决策）

### 6.1 三个硬约束

1. **新增 scope 需要 CPOAuth 后台为你的 client 放行**
   现有 app（`f0d923cd-...`）是否已开放 `cp:summary` / `email` 未知。按以往经验，**CPOAuth 后台不能改回调 URL（改了只能新建 app）**，scope 能否后加也需要实测。
   → **需要你去 CPOAuth 后台确认，或联系服务方。**

2. **老用户需要重新授权才能拿到新 scope**
   scope 变更不会自动生效于已有 token。做法：引导用户再点一次「CPOAuth 登录」（同一个 `sub` 会 upsert 到同一账号，不会创建新用户），走一遍增量授权。
   → 需要一个"**重新授权以解锁战绩展示**"的引导入口。

3. **CPOAuth 本身不稳定（此刻就是 502）**
   所有新增依赖都必须：① 可降级（外部挂了不影响核心功能）② 有缓存（不实时打外部）③ 有超时（≤4s）。
   → 这条要写进代码规范，不是可选项。

### 6.2 需要你拍板的三件事

| # | 决策点 | 选项 |
|---|---|---|
| 1 | 是否推进 `cp:summary` 战绩展示？ | A. 推进（需先确认 scope 能否放行）<br>B. 暂缓，先只做引导和安全项 |
| 2 | Onboarding checklist 是否强制？ | A. 可跳过（尊重用户）<br>B. 强制完成前两步（转化优先） |
| 3 | mdqp 是否要往 OI 垂直工具走（P2-4 题解模板）？ | A. 保持通用剪贴板<br>B. 试探性做 OI 垂直功能 |

---

## 七、附：参考来源

- CPOAuth 官方仓库（能力清单、scope 表、端点、token 生命周期）：<https://github.com/Ark-Aak/cp-oauth>
- Discourse 新用户引导机制：
  - Discobot 交互式教程：<https://blog.discourse.org/2017/08/who-is-discobot/>
  - 信任等级体系：<https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/>
  - 用系统私信定制引导节奏：<https://meta.discourse.org/t/customizing-trust-level-promotion-messages-for-new-users/193270>
