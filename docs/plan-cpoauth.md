# mdqp × CPOAuth 引导接入与功能升级 · 完整方案（v2）

> 状态：**v4.5 已上线**。本文件为完整路线图，未实现项标注优先级，等待指令后分批开工。
> 关键现实：cpoauth 服务稳定性波动（历史实测过 502 宕机，用户侧个别时刻正常），密码兜底 + 刷新引导降级已验证有效；mdqp 目前仅用了 cpoauth 约 23% 的能力。
> **v4.5 关键变更**：① 上线**站内通知系统**（信用等级提升 / 剪贴板到期 / 剪贴板被访问 / 后台管理审批 四类，按类别筛选、未读红点、一键已读）；② **cp:summary 详细战绩上游暂未放行，已在「我的」/个人主页标注「⚠️ 详细战绩（cp:summary）暂无法使用，等待更新」**；③ 微信名片仅本人可见、竞赛名片仅在有关联账号时展示。
>
> 🔗 **排期已被 `docs/strategy-competitive.md`（竞争分析与提升方案 v1，2026-09-03）接管**。本文件剩余未完成项全部映射到该方案的 P0–P2 编号（对照表见其 §9）。**开工前先看那份文档**——它基于实测数据（全站 12 个剪贴板 / 5 个用户）重排了优先级：先止血（字数分级 / 权益矩阵 / 草稿自动保存 / 私有搜索），再谈差异化。

---

## 〇、已实现（本批，v4.3.1）

| 项 | 内容 | 验证 |
|---|---|---|
| P0-1 退出撤销令牌 | `users` 表新增 `cpoauth_refresh` / `cpoauth_token_exp`；回调保存 `refresh_token`；`/api/auth/logout` 读取并调 `/api/oauth/revoke`（失败不阻塞退出） | 登出返回 `ok`；cpoauth 502 时仍正常退出 |
| P0-3 宕机三步自救 | cpoauth 不可用时按钮**置灰 + tooltip**（不再隐藏），并按登录态分支：已登录未设密码→「立即设置密码」；其余→「登录帮助 / 联系站长」指向 `/c/loginhelp` | cpoauth-status 返回 502，前端降级链路激活 |
| L0 登录弹窗改造 | cpoauth 按钮下方加一句话说明（是什么、同步哪些竞赛账号） | 线上 `index.html` 含新文案 |
| 关联账号品牌卡片 | `linkedAccountChips` 升级为带品牌色、可点击跳转平台主页的卡片网格；本人未绑定时显示空态 | `style.css` 含 `linked-card` 样式并已部署 |
| 浏览器引导 | 用 `?.`/`??` 语法探测，过旧浏览器（IE / 旧 Edge / Chrome<60 / FF<55 / Safari<11）打开即弹「下载 Firefox」引导并跳过 SPA 初始化防白屏 | `index.html` 含 `legacyOverlay` 与探测脚本 |

> 遗留：本批**未**做「仅密码用户 → 每次打开弹窗引导绑定 cpoauth」（原需求头条）。理由见 P1-B，需先补后端「账号关联」端点，否则会把密码账号 orphan 成新 cpoauth 账号。

## 〇-2、已实现（v4.4）

| 项 | 内容 | 验证 |
|---|---|---|
| P0-E 战绩名片 + 概览 | 「我的」与个人主页嵌入 cpoauth 竞赛名片 `card.svg`（随主题明暗切换），并 best-effort 代理 `cp:summary`（需用户绑 Clist.by，未绑/上游未放行时优雅留空）；D1 `user_stats` 缓存表（10min TTL） | 线上 `/api/me/cp-summary` 已部署，cpoauth 502 时降级不崩 |
| P1-A 邮箱登录（简化） | scope 加 `email`；绑 cpoauth 后可用「回传邮箱 + 密码」登录本站；**不**做独立注册/验证链接/密码找回 | 密码登录 `WHERE (username=? OR email=?)` 已上线 |
| P1-B 账号关联端点 | 复用 OAuth 回调：已登录密码用户点「绑定 cpoauth」写 `mdqp_link=1` cookie，回调 `WHERE id=?` 把 `sub` 写回当前账号（不 orphan），双登录并存 | 链路已打通（cpoauth 502 期间无法端到端，逻辑评审通过） |
| P1-C 绑定引导弹窗 | 打开网站自动检测：未绑 cpoauth→建议绑定、已绑未设密码→建议设密码、皆备→不弹；结果本地缓存 10min + 「稍后」1天 /「不再」永久（写服务端 `no_cpoauth_nudge`） | `getCpoauthStatus()` localStorage 缓存 + `checkRefreshGuide()` 已上线 |
| P2-A 信任等级 | `computeTrustLevel` 按剪贴板数/邀请数/账号年龄/VIP/管理员算 L0–L3，资料卡 + API 展示 | `/api/me`、`/api/users/:id` 返回 `trust_level` |
| P2-B 徽章系统 | 派生成就徽章：已连 cpoauth / 双保险 / 密码 / VIP / 剪贴板达人 / 邀请达人 / 管理员 | `userBadges()` 已渲染到个人主页 |
| 「我的」+ 个人主页重做 | 资料卡升级（头像+信息+齿轮⚙️）；移除低劣内联编辑；新增**设置弹窗**分「通用」（签名/简介/主题）与「账号与安全」（密码态/cpoauth 态/邮箱/信任等级/登出） | 线上 `renderMe()`/`renderUser()` 已重写 |

> v4.4 DB 迁移：`migrate_account_features.sql`（加 `email`/`email_verified`/`no_cpoauth_nudge` 列 + `user_stats` 表，已在远程 D1 执行）。

## 〇-3、已实现（v4.5）

| 项 | 内容 | 验证 |
|---|---|---|
| **站内通知系统** | 新增 D1 `notifications` 表；铃铛 🔔（未登录隐藏，登录显示红点未读数）+ 下拉面板（全部/信用/到期/访问/管理 分类筛选 + 一键已读）。四类通知：① 信用等级提升（懒生成：读取时比对 `last_trust_level`，升级才插入）② 剪贴板到期（读取时扫描 `expires_at <= now+1天 AND expiry_notified=0`）③ 剪贴板被访问（唯一访客写入 `clip_readers` 时触发，`visit_notified` 去重）④ 后台管理审批（`PATCH /api/admin/users/:id` 改了角色/限额/权限/VIP/功能开关时，通知被改账号本人）。所有插入包 try/catch，绝不阻断主流程 | 端点 `GET /api/notifications`（401 未登录验证通过）、`POST /api/notifications/:id/read`、`POST /api/notifications/read-all` 均已部署 |
| **cp:summary 标注暂不可用** | 上游未放行 scope，无法取详细战绩；「我的」/个人主页 cp:summary 兜底文案改为「⚠️ 详细战绩（cp:summary）暂无法使用，等待更新」，不再误导用户 | 线上帮助页含「详细战绩暂无法使用」 |
| **微信名片仅本人可见** | 原先 `/wechat-qr.png` 站级二维码在所有用户主页都显示；改为 `self` 时才渲染（仅 yanzie/yzetest 等本人账号可见） | 渲染逻辑 `renderUser` / `renderMe` 已改 |
| **竞赛名片仅有关联账号时展示** | `hasCpCard()` 判定 `cpoauth_bound && linked_accounts.length`；无关联账号显示中性说明文字 | `renderUser` / `renderMe` 已改 |
| **个人主页布局修复** | `.profile-card` 补 `flex-direction: column`，修复 v4.4 引入的卡片横排错位（微信名片浮到右侧） | `style.css` 已改并部署 |
| 文档同步 | `CHANGELOG.md` → v4.5；`docs/help.md` 新增「通知 🔔」章节、`sync-docs --check` 通过 | D1 帮助页含「通知」+「详细战绩暂无法使用」 |

> v4.5 DB 迁移：`migrate_notifications.sql`（`notifications` 表 + idx + `users.last_trust_level` / `clipboards.visit_notified` / `clipboards.expiry_notified` 三列，由 `scripts/migrate-notifications.mjs` 幂等执行，已在远程 D1 执行）。

---

## 一、CPOAuth 绑定引导

### 1.1 触发规则（设计）
- **触发条件**：`state.me.type==='user'` 且 `has_password===true` 且 `sub` 为空（即纯密码账号，未绑 cpoauth）且 cpoauth 当前可用（`/api/auth/cpoauth-status` 为 ok）。
- **不触发**：已绑 cpoauth、本次会话已关闭、处于登录/绑定流程中、cpoauth 不可用（宕机时走 P0-3 自救，不叠加打扰）。
- **频次控制**：
  - 弹窗为**非阻断式顶部条 / 轻量 Modal**，主按钮「立即绑定」跳转 `/api/auth/login`；次按钮「查看注册指南」新标签打开 `/c/loginhelp?from=mdqp`。
  - 关闭策略：①「稍后再说」→ `localStorage` 记录 7 天免打扰；②「不再提示」→ 写用户偏好字段 `prefs.no_cpoauth_nudge=1`（DB `users.feature_flags` 或独立列），服务端下发的 `/api/me` 携带，前端据此永久不弹。
- **实现要点**：
  - `checkCpoauthNudge()` 在 `render()` 后调用，复用 `state.me` 与 `authMethods`。
  - 需后端新增字段：在 `/api/me` 的响应用 `prefs.no_cpoauth_nudge`（admin 可改），前端「不再提示」→ `PATCH /api/me` 写入。

### 1.2 弹窗内容
- 一句话价值：「绑定 cpoauth 后，一次登录即可同步你的洛谷 / Codeforces / AtCoder 战绩，再也不用手动记密码。」
- 主按钮「立即绑定」→ `/api/auth/login`（走标准 OAuth，成功后回跳本站并**关联**到当前账号，见 P1-B）。
- 次按钮「查看注册指南」→ `/c/loginhelp`（新标签，携 `?from=mdqp` 来源参数，便于埋点）。

### 1.3 `/c/loginhelp` 图文注册指南页（待补）
- 当前仅被弹窗/横幅引用，**内容尚未创建**。建议为独立静态页（`public/c/loginhelp.html` 或由 `/api/pages` 托管），含：
  - 什么是 cpoauth、支持哪些平台；
  - 从注册到绑定洛谷/CF/AtCoder 的图文步骤；
  - 常见问题（收不到回调、绑定失败、密码忘了怎么办）。
- 埋点：`/c/loginhelp` 访问量、来源（`from=mdqp` vs 直接）、「立即绑定」点击率。

### 1.4 待确认项
- `/c/loginhelp` 内容由谁产出（用户手写的图文 vs 我生成骨架）？
- 「不再提示」是否要服务端持久化，还是仅本地 `localStorage` 即可（建议服务端，跨设备一致）。

---

## 二、CPOAuth 能力盘点（可落地产品设想）

### 2.1 已用能力
| 能力 | 现状 |
|---|---|
| 登录鉴权（authorize/token/userinfo） | ✅ 已用 |
| 用户基本信息（openid + profile：display_name/avatar/username/bio） | ✅ 已用 |
| 关联账号（cp:linked） | ✅ 已用（v4.3.1 升级为卡片展示） |

### 2.2 未用但高价值
| 能力 | 适用性 | 难度 | 风险 |
|---|---|---|---|
| **cp:summary**（各平台 rating/最高分/参赛场次/排名） | 个人主页「战绩概览」卡片 | 中（需上游放行 scope） | ⚠️ **上游暂未放行 scope，v4.5 起标注「暂无法使用，等待更新」**；覆盖低：须绑 Clist.by，预计 <20% 用户有数据 |
| **cp:details**（完整 rating 历史） | 战绩曲线图（Chart.js） | 中 | 同上；数据量大需缓存 |
| **email** | 邮箱验证、找回、通知 | 低 | 隐私合规 |
| **per-platform link:\***（7 个单平台 scope） | 精细化「仅同步某平台」开关 | 低 | 需上游逐个放行 |
| **refresh_token 主动刷新** | 延长登录、避免 1h access 过期反复重定向 | 低（已存 refresh） | 必须处理 refresh 轮换（每次刷新返回新 refresh，旧失效） |
| **/api/oauth/revoke** | ✅ 本批已在登出调用 | — | — |
| **TOTP / WebAuthn 2FA** | 高安全账号（管理员/VIP）二次验证 | 高 | cpoauth 侧实现未知 |
| **GET /api/users/{username}/card.svg** | 个人主页嵌入「竞赛名片」`<img>` | 极低（一行代码） | 样式不可控 |
| **事件通知 / webhook** | cpoauth 绑定变更 → 本站联动 | 高（依赖上游） | 上游未确认支持 |

### 2.3 产品设想（按能力）
1. **战绩概览卡片**（cp:summary）：个人主页顶部展示洛谷/CF/AtCoder 的 rating、最高分、参赛场次；无数据时优雅降级为「去绑定 Clist.by 解锁战绩」。
2. **Rating 成长曲线**（cp:details）：Chart.js 折线图，按平台分色；缓存到 D1，每日增量刷新。
3. **竞赛名片**（card.svg）：个人主页 / 公开主页嵌入 `<img src="cpoauth card.svg">`，社交分享用。
4. **邮箱体系**：绑定邮箱后开放「邮箱找回 / 重要通知 / 周报」。
5. **2FA（远期）**：管理员账号强制 TOTP。

---

## 三、站点功能升级规划（参考 Discourse）

> Discourse 核心理念：**信任等级（Trust Levels）+ 徽章（Badges）+ 用户卡片（User Card）+ 自动化引导（Discobot/Onboarding）+ 节点式系统私信**。mdqp 是工具站，无「发帖阅读」，故把触发条件映射为自身行为事件。

### P0（立即做，无外部依赖）
- **P0-A 退出撤销令牌** ✅ 已完成
- **P0-B 宕机三步自救** ✅ 已完成
- **P0-C 登录弹窗 + 关联账号卡片** ✅ 已完成
- **P0-D 低版本浏览器引导** ✅ 已完成
- **P0-E 战绩名片 card.svg + 概览**：「我的」与个人主页嵌入竞赛名片 `<img>`（随主题明暗切换）；best-effort 代理 `cp:summary` 已保留接口但**上游未放行，v4.5 标注「暂无法使用，等待更新」**。✅ 已完成（概览卡片 + 降级提示，曲线图未做）

### P1（需后端小改 / 用户重授权）
- **P1-A 邮箱登录（简化版，已落地）**：仅实现「用 cpoauth 回传的绑定邮箱 + 密码登录」（scope 加 `email`），**不做**独立注册/验证链接/密码找回；绑定邮箱走 cpoauth，无需本站流程。✅ 已完成（简化）
- **P1-B 账号关联端点（已落地，改走 `?link=1` 流程）**：未新建 `POST /api/auth/link-cpoauth`，而是复用 OAuth 回调——已登录密码用户点「绑定 cpoauth」写 `mdqp_link=1` cookie，回调 `WHERE id=?` 把 `sub` 写回当前账号（不 orphan），双登录并存。✅ 已完成
- **P1-C 绑定引导弹窗（刷新判定）**：打开网站自动检测——未绑 cpoauth→建议绑定、已绑未设密码→建议设密码、皆备→不弹；结果本地缓存 10min + 「稍后」1天/「不再」永久（写服务端）。✅ 已完成
- **P1-D 战绩概览**：见 P0-E，概览卡片已落地，**cp:summary 上游未放行，已标注暂无法使用**；**曲线图未做**（远期）。

### P2（想象力，远期）
- **P2-A 信任等级**：已落地，`computeTrustLevel` 按剪贴板数/邀请数/账号年龄/VIP/管理员算 L0–L3，资料卡 + API 展示。✅ 已完成
- **P2-B 徽章系统**：已落地，派生成就徽章（已连 cpoauth/双保险/密码/VIP/剪贴板达人/邀请达人/管理员）。✅ 已完成
- **P2-C 通知与消息**：✅ **v4.5 已落地**站内通知系统（信用等级提升 / 剪贴板到期 / 剪贴板被访问 / 后台管理审批 四类，铃铛红点 + 分类筛选 + 一键已读；懒生成 + 去重，无需 cron）；站内信（被@/收藏/邀请）、邮件周报仍为远期。
- **P2-D 搜索与组织**：全站剪贴板/用户搜索（标题+内容），标签（#算法 #模板）聚合页。
- **P2-E 后台数据看板**：DAU/留存/各登录方式占比/战绩覆盖率，admin 页图表。
- **P2-F OI 垂直化**：基于战绩的「同水平对手」「近期赛事日历」「模板推荐」，把 mdqp 从剪贴板工具升级为 OI 选手工作台（对齐你「OI 风格算法」主线）。

---

## 四、优先级 / 排期（建议）

| 优先级 | 项 | 估时 | 外部依赖 |
|---|---|---|---|
| P0 | A–D（已完成）+ E card.svg | 0.5d | 无 |
| P1 | A 邮箱 | 1d | 无（站内邮件可选 SMTP Secret） |
| P1 | B 账号关联端点 | 1d | 无 |
| P1 | C 绑定引导弹窗 | 0.5d | 依赖 B |
| P1 | D 战绩概览 | 2d | **需上游放行 scope** |
| P2 | A/B/C/D/E/F | 各 1–3d | 部分需上游 |

**建议顺序**：P0-E / P1-B / P1-C / P1-A / P1-D 概览 **均已落地（v4.4）**；P2-C 通知系统 **已落地（v4.5）**；剩余 P2-D 搜索、P2-E 后台看板、P2-F OI 垂直化仍为远期。

---

## 五、验收标准（通用模板）
- 功能：对照「用户故事」逐条可走通；异常分支（cpoauth 宕机 / 用户取消 / 网络超时）不白屏、不卡死。
- 安全：令牌仅存 Worker Secret / D1，不外泄前端；撤销在退出时尽力执行；限流与长度上限在位。
- 埋点：每个新入口埋 `event + from + uid(匿名则设备指纹)`；周维度看转化。
- 文档：`CHANGELOG.md` + `docs/help.md` 同步更新，`sync-docs --check` 通过。

## 六、风险 / 灰度 / 回滚
- **风险 R1（最高）**：cpoauth 可用性。缓解：密码兜底 + P0-B 自救 + 所有 cpoauth 功能默认降级。
- **风险 R2**：新 scope 上游不放行 / 老用户需重授权导致绑定率骤降。缓解：先用 card.svg、关联卡片等零 scope 改动；scope 类功能灰度 10% 再全量。
- **风险 R3**：P1-B 关联逻辑写错会 orphan 账号。缓解：回调先查 `session` 用户，再 `WHERE id` upsert；上线前用脚本模拟「已登录密码用户点绑定」回归。
- **灰度**：前端用 `feature_flags` 按用户白名单放量；后端用 D1 列默认 NULL 兼容老数据。
- **回滚**：Pages 每个 deploy 有版本哈希，出问题 `wrangler pages deployment tail` + 回退上一版；DB 变更均为**加法**（加列/加表），不删不改旧列，回滚代码即兼容。

## 七、待确认项（阻塞排期）
1. ~~**绑定引导头条需求**：是否推进 P1-B→P1-C？~~ ✅ **已落地（v4.4）**：刷新判定 + `?link=1` 账号关联，不 orphan。
2. **战绩展示**：`cp:summary`/`cp:details` 上游暂未放行 scope，v4.5 已统一标注「暂无法使用，等待更新」；待你与上游确认放行后再排 P1-D 曲线图（概览卡片已用 best-effort 兜底）。
3. **`/c/loginhelp` 内容**：你手写的图文 vs 我生成骨架你填图？
4. **邮箱体系**：当前仅做「绑定邮箱登录」简化版；是否需要真实发信/验证流程（需 SMTP Secret）？
5. **方向**：是否认可把 mdqp 往「OI 选手工作台」（P2-F）方向走，还是保持纯剪贴板工具？

---
*本方案为路线图。P0/P1 已在 v4.4 落地，P2-C 通知系统已在 v4.5 落地；P2-D~F 仍为远期，待指令后开工。*
