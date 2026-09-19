/* mdqp v4.0 前端 — 路由 / 身份 / 剪贴板 CRUD / 评论 / 邀请 / VIP / 公告 / 功能开关 / 管理后台
 * v4.0 新增：限额(日/月/周) + 字数限制(CJK=1 英文=0.5) + 功能开关 + VIP + 邀请系统 +
 *       评论(@mention 50字/条) + 登录门禁 + 唯一读者追踪 + 短链修改 + 公告置顶 + 管理员权限颜色梯度
 */

/* 复制文本到剪贴板 —— 修复反馈 #2/#3/#8：copy() 被 6 处调用却从未定义 → ReferenceError
 * 兼容老浏览器：优先 navigator.clipboard，不支持/失败时降级 execCommand('copy') */
function copy(text, msg) {
  var t = (text == null ? '' : String(text));
  function legacy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, t.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function ok() { if (msg) toast(msg, 'ok'); }
  function bad() { toast('复制失败，请手动选择复制', 'err'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { navigator.clipboard.writeText(t).then(ok, function () { legacy() ? ok() : bad(); }); return; }
    catch (e) { /* 继续降级 */ }
  }
  legacy() ? ok() : bad();
}

// 更新日志：随代码发布自动同步
const CHANGELOG_MD = `# 📝 更新日志

mdqp 的主要版本变动记录。当前部署版本 **v4.14.2**。

---

## v4.14.2 · 2026-09-19（公告加固 + 通知系统 + 举报适配）

- 🛡 **公告接口加固**：\`PUT/DELETE /api/announcements\` 补齐 try/catch 与 D1 偶发抖动单次重试，失败返回友好 JSON 而非裸 500；后端错误上报补齐 HTTP method，消除此前「GET /api/announcements 500」误报（\`/admin\` 发布/删除公告不再静默崩）。
- 🔔 **通知系统落地（工单 / 评论）**：你的工单被管理员处理（状态变更）、工单收到新回复、你的剪贴板收到新评论时，相关用户将收到站内通知（铃铛红点 + 未读角标 + 分类筛选）；通知相关接口全部加故障隔离，表缺失/异常降级为空、不再拖垮整站。
- 🔧 **举报功能适配工单体系**：提交举报后不再强制跳转到公开工单页（避免暴露举报关系），改为停留原片段页并提示进度可在「工单」查看。
- 🗄️ 数据库：\`notifications\` 表（v4.5 引入，此前迁移未实际落库，本次通过 \`migrate-notifications.mjs\` 补齐到生产 D1）支撑上述通知；管理后台公告发布/删除失败时 toast 显示真实错误信息。

## v4.14.0 · 2026-09-19（统一工单系统：举报 + 反馈合并，仿洛谷）

- 🆕 **举报与反馈合并为统一工单系统**：新增 \`/tickets\` 工单中心（洛谷式卡片列表 + 详情页），所有用户均可**公开查看**工单与处理进度，管理员可在详情页改状态、写处理说明、回复（标记为官方回复）、删除关联违规内容或删除工单。
- 🆕 工单分类：\`程序缺陷 / 功能建议 / 内容举报 / 其他\`；状态：\`待处理 / 处理中 / 已解决 / 已驳回\`（已驳回仅管理员可见）。
- 🆕 **发起工单**：原「反馈」页升级为工单中心，支持分类发起；原片段页「⚠ 举报」入口改为提交「内容举报」类工单（关联片段，管理员可一键删除违规内容）。
- 🗄️ 数据库：\`migrate_v4.14.sql\` 新建 \`tickets\` + \`ticket_replies\` 表，并把旧 \`feedback\` 与 \`clip_reports\` 数据**回灌**为工单（幂等，不会重复）。旧两表保留为归档、不再写入。
- 🔧 接口：\`/api/tickets\`（POST 创建 / GET 列表 / GET :code 详情 / POST :code/reply 回复 / PATCH :code 管理员处理 / DELETE :code 删除）替换旧的 \`/api/feedback*\` 与 \`/api/clips/:id/report\`、\`/api/admin/clips/reports*\`。
- 🎨 UI：洛谷风工单卡片（工单号 #TKxxxx / 分类 / 状态 / 提交人 / 时间 / 回复数）+ 详情页（描述 + 处理记录时间线 + 管理员操作区）。

## v4.14.1 · 2026-09-19（工单写入改独立页 + Markdown 编辑器）

- 🆕 **工单写入搬到独立页 \`/tickets/new\`**：原「发起工单」弹窗改为整页编辑器——左侧 Markdown 输入（工具栏 + 实时预览，复用站点编辑器体验），右侧实时渲染，支持标题与分类（程序缺陷 / 功能建议 / 其他）。
- 🐞 **Bug 反馈保留结构化格式**：从报错弹窗点「🐞 反馈给站长」、命令面板「上报最近一次报错」、或横幅「去反馈」，跳到新工单页时自动预填「错误类型 / 发生时间 / 发生页面 / 错误信息 / 运行环境 / 最近控制台日志 + 我当时的操作 / 期望结果」模板；手动切到「程序缺陷」分类且内容为空时也会自动带出该模板。
- 🔧 联动：原 \`/feedback\` 别名、「＋ 发起工单」按钮、报错一键反馈现在统一跳 \`/tickets/new\`；旧的 \`openNewTicketModal\` 弹窗已删除，避免两套写入入口腐烂。

---

## v4.13.2 · 2026-09-19（访客可只读查看评论）

- 🆕 **访客可查看评论**：详情页评论区不再对未登录访客隐藏已有评论。访客现在能看到全部评论（只读），仅隐藏「发表评论」输入框；发表仍受服务端登录校验（\`POST /api/comments\` 非登录返回 401），后台读取接口本就不限登录。
- 🐞 修复点：\`loadComments\` 原先对访客直接 \`return\` 只显示占位提示、从不拉取评论，现已改为先拉取并渲染评论列表，再按登录态决定是否显示输入框。

---

## v4.13.1 · 2026-09-19（修复长内容编辑器滚动乱跳）

- 🐞 **修复长内容编辑时滚动乱跳/闪烁**：复制一大坨内容后，向上滚动编辑会闪一下跳回底部、用滚动条弄到顶部后稍微下滑又直接闪到底部。
- 🔧 根因有二：① \`autoGrow\` 每次输入都把 textarea \`height:'auto'\` 塌缩再设回，重置了内部滚动位置；② 预览默认开启，每次输入 \`updatePreview\` 重建预览 \`innerHTML\` 清空 \`pv.scrollTop\`，经滚动同步把编辑器滚动位置拽走。
- ✅ 修复：\`autoGrow\` 重算高度前保存/还原 \`scrollTop\`；\`updatePreview\` 重建前后保留预览滚动位置并临时屏蔽同步；\`setupScrollSync\` 改用程序化滚动屏蔽标志，且预览隐藏（\`no-preview\`）时不参与同步。

---

## v4.13.0 · 2026-09-18（用户封禁 + 举报审核闭环 · P2）

- 🆕 **用户封禁（可设时长）**：后台用户管理新增「封禁 / 解封」操作，可填封禁原因与封禁时长（天，留空=永久）。封禁即时生效——被封禁用户下一请求即被登出、无法再发帖/删帖，且**无法重新登录**（cpoauth 与密码登录均拦截），到期自动解封。封禁权限独立为 \`ban_user\`，开发者与本人不可被封禁。
- 🆕 **完整举报审核闭环**：任意片段详情页新增「⚠ 举报」入口（需登录，可选 恶意/垃圾、低俗色情、擦边、违法违规、其他 + 补充说明，同内容同用户去重）；后台新增「⚠️ 内容审核」tab，列出待审举报（含被举报内容、作者、时间），可一键「删除内容」（连带评论/读者/其它举报）或「忽略」。tab 角标实时显示待审数量。旨在防止恶意、低俗、擦边等不良内容。
- 🎚 **VIP / 封禁时长可设**：VIP 设置弹窗支持填写时长（天，留空=永久）；邀请所得的 VIP 由「永久」改为**默认 1 年**（\`vip_until = 注册 + 365 天\`）。
- 🔍 **用户筛选增强**：后台用户管理支持按来源、最近活跃天数、最少片段数、封禁状态筛选，并按注册时间 / 最近登录 / 片段数 / 用户名排序。
- 🗄 迁移：\`migrate_v4.13.sql\` 为 \`users\` 增加 \`banned/banned_at/ban_reason/ban_until\`，并新建 \`clip_reports\` 表（含状态流转与索引）。

---

## v4.12.0 · 2026-09-18（邀请系统真实化 · P1）

- 🆕 **邀请奖励不再"假功能"**：此前邀请系统后端已改用 \`users.invite_code\` / \`users.inviter_id\`（不再查从未写入的 \`invites\` 表），但奖励配置依赖站点设置、默认空 → 邀请任何人都不发奖。现改为**代码内置默认奖励配置**（1 人→开放所有高级功能、3 人→开通 VIP、5 人→不限字数、10 人→开发者大礼包；被邀请者注册即得自定义短链），无需任何后台配置立即生效。
- 🆕 **「不限字数」真正落地**：5 人档的 \`unlimited_chars_pin\` 现在会真实写入 \`feature_flags.unlimited_chars\`，并由 \`resolveBenefits\` 生效（单篇字数不再受限），不再是"待管理员手动授予"。
- 📌 反馈中心（P1）此前已完成：\`/feedback\` 公开只读列表 + 后台「反馈审核」tab（状态流转 + 处理备注 + 删除），\`/api/feedback\` 全接口齐备。
- 🔧 对应规划文档「二、P1」两项均已完成（反馈中心 / 邀请系统修复）。

---

## v4.11.1 · 2026-09-18（公告接口 500 加固）

- 🐞 **修复反馈 #12（\`GET /api/announcements\` 偶发 500）**：该接口是整个站点公告栏与 \`/admin\` 公告 tab 的依赖，一旦 500 会被 \`api()\` 自动错误上报反复刷屏。现改为**查询失败时降级返回空数组（绝不 500）**，并把脏文本清洗（剔除控制字符 + 孤立代理对）前置到 \`PUT /api/announcements\` 写入端——孤立代理对会让 \`JSON.stringify\` 抛错进而 500，是头号嫌疑。前端两处调用已有 \`data?.announcements\` 空值兜底，无需改动。

---

## v4.11.0 · 2026-09-18（错误页/看门狗 + \`/admin/code\` 查看编辑分离）

- 🆕 **系统错误页 \`/error\` 与 \`/404\`**：均为 SPA 路由（**不加 \`/c/\` 前缀**以与片段区分），内容复用你写的剪贴板文稿（\`clip_id=error\` / \`clip_id=404\`），老浏览器也能正常访问。未知路径统一回退到 404 文稿。
- 🆕 **看门狗（哨兵）自动跳转兼容plus**：\`index.html\` 兜底脚本新增错误分级——\`compat\`（兼容性 / 脚本启动失败等非小错误）直接跳 \`/legacy\` 兼容备用页；\`fatal\`（重大渲染错误）跳 \`/error\`。带防抖与环路保护，已处于 \`/legacy\`/\`/error\` 时不重复跳。
- 🔐 **\`/admin/code\` 查看 / 编辑权限分离**：新增 \`edit_code\` 权限位，与 \`view_code\` 解耦。仅 \`view_code\` → 只能浏览源码与审批队列；持有 \`edit_code\` 或开发者 → 才能编辑并提交改动；开发者仍可一键直部署。\`canEdit\` 显隐「编辑」按钮，并展示「👁 只读 / ✏️ 可编辑」彩色徽章；权限弹窗中两项用蓝（查看）/ 橙（编辑）配色区分。\`/api/me\` 现返回 \`admin_permissions\` 供前端判定；\`POST /api/admin/code/submit\` 改为校验 \`edit_code\`。

---

## v4.10.1 · 2026-09-18（补：设置页来源修改入口）

- 🐞 **补做 v4.10.0 的承诺**：v4.10.0 起弹窗与帮助页都写了「来源可随时在设置里修改」，但**设置弹窗当时没有入口**——填过一次后 \`source_set_at\` 写入、\`maybeAskSource\` 永久不再弹，等于填错锁死、无处可改。现已在「我的 → ⚙️ 设置 → 账号与安全」新增「📊 我的来源」行（显示当前来源 + 补充说明）和「修改」按钮，点开后复用来源弹窗并**预选当前值**，提交即覆盖。
  - 这跟之前「300 字」「频率限制」是同一类病：文案/注释承诺了、代码没落地。已用同一套自检思路（grep 接口 + 文档一致性）堵住。

---

## v4.10.0 · 2026-09-12（注册来源收集 + 埋点补全与去重）

- 📊 **用户来源渠道收集**：用户首次登录后，弹窗询问「你是怎么知道 mdqp 的」，选项含线下分享 / 社交平台分享 / OJ 分享 / 其他分享 / 随便点到 / 看到广告 / 搜索引擎搜到 / 不方便说；可填补充说明（如具体平台）。已填写（或选「不方便说」）后不再提醒；关闭弹窗本会话不再问，反复跳过（≥3 次）后彻底不再打扰。
  - 入库：\`users\` 新增 \`source\` / \`source_detail\` / \`source_set_at\` 三列；\`PATCH /api/me\` 支持上报（白名单校验，仅允许已知渠道）；\`GET /api/me\` 返回这三字段。
  - 后台用户列表新增「来源」列（含补充说明），「📊 数据看板」新增「用户来源分布」统计（人数 + 占比）。
  - 注册时间 \`users.created_at\` 早已入库并在个人页「加入于」展示，本次仅补全前端取数。
- 🐞 **修 M3 埋点两处不实**：① \`/api/events\` 注释谎称「靠频率限制兜底」，实际从未实现——现已诚实标注防护组合，并**真补了 page.view 5 分钟按 uid 去重**（避免刷新刷数据，保证 DAU 真实可信）；② 新增请求体 16KB 上限 + 既有白名单 / 字段截断 / 单请求 ≤10 条。
- ✅ **补 page.view 前端埋点**：此前全站只有 \`clip.view\` 一个调用点，DAU 完全测不出。现每次页面加载上报一次 \`page.view\`（按会话幂等），配合服务端去重，DAU 终于可统计。
- 新增索引 \`idx_events_uid_type(uid, type, created_at)\` 加速去重查询；新增迁移脚本 \`migrate_source.sql\`。

---

## v4.9.0 · 2026-09-10（M3 埋点体系 + 数据看板）

- **新增埋点体系（M3）**：新建 \`events\` 表（\`app\`/\`type\`/\`uid\`/\`ref\`/\`meta\`/\`created_at\`），记录剪贴板创建与查看、登录票据签发、oiwb 云端推送 / 恢复、片段库搜索与打开等关键行为。
- **新增 \`POST /api/events\`**：公开上报端点，事件类型走**白名单**（未在名单内一律丢弃），单次最多 10 条；埋点为旁路，失败静默，绝不影响主流程。
- **新增 \`GET /api/admin/events/summary\`**：仅管理员，返回近 N 天总事件数、活跃用户数（去重）、按事件类型聚合、按天趋势。
- **后台新增「📊 数据看板」标签页**：支持 1/7/30/90 天切换，展示事件排行与每日趋势（此前 O1 到底有没有人用只能靠猜）。
- 服务端在三个关键路径自动打点：剪贴板创建（\`clip.create\`）、签发跨站票据（\`auth.ticket\`）、oiwb 推送快照（\`oiwb.push\`）——比前端埋点更可靠。

## v4.8.2 · 2026-09-10（用户名后的身份 tag）

- 🏷 **用户名后显示身份 tag**：首页卡片与剪贴板页的作者名后面，会跟着显示「🛡 管理员」「🛠 开发者」「⭐ VIP」标识。VIP 过期后自动不再显示，与站内 VIP 有效性判定保持一致。
  - 后端：列表接口加 \`LEFT JOIN users\` 取作者 \`role / is_vip / vip_until\`；详情页接口补查作者身份；游客不显示任何 tag。
- 🐞 修正 VIP 页面对比表里过时的「300 字」——实际分级规则早已是「默认 1500 / L2 5000 / L3·VIP·管理员不限」，页面文案终于与真实规则对齐。

## v4.8.1 · 2026-09-09（新版本提示覆盖首次访问 + O0-3 排查）
- 🎉 **新版本提示现在首次打开也会弹出**：调用处原为 \`if (seen && seen !== d.version)\`，那个 \`seen &&\` 守卫把「localStorage 里没有版本记录」的首次访问用户**全挡在了门外**——老用户能收到更新日志，新用户反而一次都看不到。现去掉该守卫，并对首次访问改用欢迎文案「🎉 欢迎使用 mdqp · 当前版本 vX」（对新用户说「已发布」不合语境）
- 🧹 **O0-3 全量排查（四类扫描，0 真问题）**：容器 ID 缺失 / 无防护裸 fetch / 未定义函数 / JS 操作但 CSS 未定义的类。oiwb 103 个 ID 引用、mdqp 242 个 ID 引用全部有定义；\`oiwb* \` 自有函数无缺失；所有外部请求均已带超时或 catch。3 处告警经核实均为误报（vjudge 抓取脚本里的外部选择器、\`mdqpFetch\` 内部已带 signal、mdqp 的 class 定义在外部 \`style.css\`）
- 📝 修正 \`worker.js\` 头部过时注释：仍写着「每板 300 字」，与 v4.6 落地的分级规则（L0/L1 1500、L2 5000、L3/VIP/站长不限，硬顶 20000）矛盾，已同步为分级描述

## v4.8.0 · 2026-09-09（兼容性弹窗补全 + 兼容plus 带浏览器名）
- 🔘 **「兼容良好」状态也给出两个下载入口**：此前兼容性弹窗只在「版本过低」时才有下载按钮，检测通过的用户只能看到一行文字。现在良好状态同样提供「腾讯软件中心镜像」与「Firefox 官方」两个按钮，以防万一（换台老机器 / 其他设备遇到问题）时不必再回来找入口
- 🏷️ **「兼容plus」入口现在会带上浏览器名**：页脚链接与弹窗按钮此前是静态 \`href="/legacy"\`，跳过去后备用页不知道你用的是什么浏览器。现统一改为动态生成 \`/legacy?name=<浏览器名>\`，备用页能直接显示「检测到当前使用的是：Chrome 120」
- 🛡️ **链接生成全程兜底**：拼 \`name\` 的任一步出错都 \`try/catch\` 降级为不带参数的 \`/legacy\`——**宁可少显示浏览器名，也绝不让备用页打不开**。备用页 \`legacy.html\` 自身读取 \`name\` 时同样有 try/catch，畸形编码（如 \`name=100%\`）最多不显示名称，页面主体照常渲染

## v4.7.9 · 2026-09-09（兼容plus 路径回退 · 修复极老浏览器白屏）
- 🐞 **修复「兼容plus」备用页在极老浏览器可能白屏**：原路径 \`/legacy.html\` 会被 Cloudflare Pages 以 **308 Permanent Redirect** 重定向到 \`/legacy\`，而 308 是 2014 年才定稿的状态码（RFC 7538）——**IE8 及以下根本不认识它**，遇到未知 3xx 可能不跟随跳转，直接渲染那个 **0 字节的空响应**，结果白屏。最讽刺的是：最需要这张备用页的浏览器，恰恰倒在这一跳上
- 🔧 三处入口统一改回 \`/legacy\`：页脚「兼容plus」链接、兼容性弹窗按钮、自动兜底新标签页。\`/legacy\` 由 Pages 直出 **200**，零跳转，老浏览器无需理解任何新状态码

## v4.7.8 · 2026-09-08（兼容plus 入口 + 侧边栏闪动修复）
- 🔘 **「兼容plus」手动入口**：页脚「浏览器兼容性」右侧新增「兼容plus」链接，一键跳转到纯文本轻量备用页 \`/legacy\`；兼容性弹窗内也加了同款按钮。极旧浏览器用户无需等自动探测即可手动进入轻量模式
- 🐞 **侧边栏展开不再「闪一下」**：折叠态下标签/品牌文字由 \`display:none\` 瞬时切换改为 \`max-width + opacity\` 平滑淡入，消除鼠标靠近时从旁/从下弹出的突兀感（参照 shadcn-admin 折叠栏做法）
- 🔧 自动兜底打开的纯文本页路径统一为 \`/legacy\`（Cloudflare Pages 会自动去掉 .html 后缀）

## v4.7.7 · 2026-09-08（老内核兼容 · 兜兜兜底 plus）
- 🆘 **极老浏览器再补一层「纯文本备用页」**：检测到不兼容时，自动新开标签页跳 \`/legacy\`（纯文本、几乎零现代特性，IE6 也能渲染），并在弹窗内加「📄 在新标签页打开纯文本备用方案」手动按钮；备用页里下载链接以**纯文本网址**展示，底部注明「这是非常旧浏览器跳不出弹窗的备备用方案，如果另一个标签页弹窗能显示可以直接通过那里点击」

## v4.7.6 · 2026-09-08（老内核兼容提示修复 + 侧边栏丝滑）
- 🛡️ **老内核兼容提示真能弹出来了**：① 改用 \`createElement\`+\`insertBefore\`（不再用 \`document.write\`，IE 对 write 出来的 \`<style>\` 常失效导致提示看不见）；② 所有样式内联到每个元素，不依赖任何 \`<style>\` 块；③ 新增 ES6 语法能力探测（\`new Function\` 试解析 \`async/await\`），覆盖「能过特性检测却跑不了 ES6」的极老 Chrome
- 🐞 **修掉老内核下仍报 \`Uncaught\` 白屏**：兼容检测通过时同步置 \`window.__MDQP_LEGACY\`，让 app.js 初始化守卫真正跳过 SPA 启动（此前标记名不一致，SPA 仍在后台崩溃）
- 🎯 **侧边栏「靠近展开」不再抖**：用 \`.sidebar\` 的 \`mouseenter\`/\`mouseleave\` 替代 \`mousemove\`+\`clientX\` 阈值触发，消除边界来回抖动

## v4.7.5 · 2026-09-07（反馈清单收尾：侧边栏 / 目录 / 标签 / 反馈公开）
- 📌 **侧边栏改成「靠近展开、移开折叠」**（反馈 #6）：不再需要点钉子按钮固定。鼠标移到屏幕最左侧 24px 内自动展开，移开自动收起；想常驻展开就点一下钉子按钮（记忆到 localStorage），再点收起
- 📑 **目录固定在右侧**（反馈 #6）：宽屏（≥1100px）下剪贴板 / 编辑器 / 页面三处目录改为右侧悬浮固定（不再沉在正文后面），窄屏维持原位不遮挡
- 🏷 **标签终于看得见了**（反馈 #5）：根因是公开列表接口 \`/api/clips\` 的 SELECT 压根没查 \`tags\` 字段，首页卡片永远拿不到标签。已补上；同时在**查看页**也会显示标签，点击可跳首页按该标签搜索
- 👀 **反馈人人可看**（反馈 #4）：\`/feedback\` 页非管理员也会展示反馈列表与处理进度（只读、脱敏，隐藏联系方式与已驳回条目），管理员仍可审核。重复问题不必再提
- 🤫 **次要请求失败不再弹窗**：cpoauth 状态探测等次要请求失败时静默处理（登录框内提示即可），不再一进页面就砸出「网络请求失败」大弹窗
- 🧩 **首页骨架缺失不再整页中断**（反馈 #9）：机房代理返回旧缓存 / 被截断的 HTML 时，\`#heroStats\` 等容器缺失会让首页渲染抛 null 异常、列表全空。现改为空值保护，并在顶部显示黄条「页面结构加载不完整 → Ctrl+F5 强制刷新」，不再静默空白

---

## v4.7.4 · 2026-09-07（加载失败兜底横幅）
- 🛟 **脚本崩了也不再白屏**：新增独立于 \`app.js\` 的兜底横幅（装在 \`app.js\` **之前**）。原先的报错弹窗由 \`app.js\` 自己安装，一旦 \`app.js\` 自身崩溃或被网络拦截，那套兜底就一起没了——现在底部会浮出红条，写明失败原因，并提供「重新加载 / 去反馈 / 关闭」
- 🔍 **「脚本没启动」看门狗**：初始化未跑完且主区无内容时主动提示（多为缓存旧文件或脚本被拦截），不再留一片空白让人以为是网络坏了
- 📮 **一键带错去反馈**：点横幅的「去反馈」会把已捕获的错误自动填进反馈表单的「具体情况」，不用手抄
- 💬 **微信内置浏览器引导**：手机微信里打开会浮出引导层——**箭头指向右上角「⋯」**，提示「在浏览器打开」，并给「复制网址」按钮（微信内无法直接跳外部浏览器）；点「仍要继续访问」本次会话内不再打扰

---

## v4.7.3 · 2026-09-07（老内核浏览器兜底提示）
- 🧓 **IE / 旧 Edge 不再白屏**：新增一段**纯 ES5 + 自带内联样式**的兜底提示（不依赖 ES6，也不依赖站点 CSS 变量，否则提示自己也会渲染失败）。老内核打开即全屏提示「浏览器内核过旧」，并给出下载入口——这解释了机房里「只剩导航栏和底部按钮」的现象：主脚本用了 ES6，IE 一解析就整块不执行
- ⬇ **新增国内镜像下载**：兼容性提示里加了 **Firefox · 腾讯软件中心镜像**（Win7+，机房下载比官网快），与 Firefox 官方链接并列，二选一即可
- 🐞 **消除双层弹窗**：兜底遮罩生效时，页尾原有的兼容性弹窗自动让位，不再叠两层

---

## v4.7.2 · 2026-09-07（修复制报错 + 老浏览器复制降级）
- 🐞 **修复「复制」按钮报错**：\`copy()\` 在 6 处被调用却**从未定义**，点「复制链接 / 复制内容 / 复制邀请码 / 复制邀请链接」直接抛 \`ReferenceError: copy is not defined\`（反馈 #2 / #3 / #8，累计 3 次上报）。已补齐实现
- 🧓 **老浏览器降级**：优先 \`navigator.clipboard\`，不支持（老旧浏览器 / 非 HTTPS）时自动降级 \`execCommand('copy')\`，不再一点就失效

---

## v4.7.1 · 2026-09-04（账号互通前端 + 一键跳 oiwb）
- ✨ **「🚀 去 oiwb」侧边栏入口**：已登录用户点击 → 后台签 5 分钟一次性短票 → 自动跳 oiwb 并登录（零手动）；未登录则弹登录框
- 📥 **新建页支持外部预填**：oiwb 等来源带 \`?title=&tags=&back=oiwb\` 跳 \`/new\`，自动填好标题/标签，并显示「↩ 返回 oiwb」链接
- 🔒 全程可降级：mdqp 不可达时 oiwb 仍完全本地可用；短票一次性 + 5 分钟过期，跳错地址也不泄露账号

---

## v4.7.0 · 2026-09-04（账号互通后端 · O1-1 地基）
- 🔗 **跨站账号互通后端上线**：新增 6 个 API，为 mdqp 与 oiwb 共用一套账号打地基
  - \`POST /api/auth/ticket\`：已登录用户申请 5 分钟一次性短票（jti 入库查重）
  - \`POST /api/auth/exchange\`：用 ticket 换 1 小时 access JWT + 30 天 refresh JWT（一次性，复用即作废）
  - \`POST /api/auth/refresh\`：用 refresh 换新 token（不重发 refresh，防无限续期）
  - \`POST /api/auth/revoke-token\`：吊销 jti（幂等）
  - \`POST /api/oiwb/sync\` / \`GET /api/oiwb/sync\`：登录态下推送 / 拉取 oiwb 数据快照（≤1MB，UPSERT 入 \`oiwb_snapshots\`）
- 🗄 新增数据表 \`oiwb_tickets\`、\`oiwb_snapshots\`（已反查验证存在）
- ✅ 端到端验证全过（9 步 happy path + 5 个负例）

---

## v4.6.2 · 2026-09-04（主页也能搜私有 + 一波可见性修复）
- 🏠 **主页搜索我的剪贴板**：主页「公开剪贴板」标题旁新增「🌐 公开 / ⭐ 我的」范围切换（登录用户可见）。切到「⭐ 我的」后，主页搜索框直接搜**自己的全部剪贴板（含私有）**，支持置顶按钮，标题与搜索框占位随范围变化。游客不显示切换
- 🧭 **修复「浏览器兼容性」点击无效**：页脚按钮弹窗打开时漏加 \`show\` 类导致弹窗永远不显示（v4.6 引入的回归），已修复
- 🎨 **v4.6 功能样式补齐**：权益矩阵表、我的剪贴板工具条、标签云、置顶按钮、草稿恢复条、配额条、版本弹窗等 9 组样式此前完全缺失，新功能「看得见」了
- ✨ **版本更新弹窗重做**：检测到新版本时展示**完整更新日志**（Markdown 渲染），下方「更多日志」跳 \`/changelog\` + 「确定」按钮，去掉 8 秒自动关闭

---

## v4.6 · 2026-09-03（让信任等级「有赏有罚」+ 我的剪贴板 2.0）
- 🎁 **权益矩阵（核心）**：L0–L3 / VIP / 管理员各档位首次有**真实福利**——单篇字数上限、日/月配额、标签数、私有剪贴板数、版本回退次数、自定义短链、批量导出、徽章、专属标识，按等级阶梯解锁。高等级不再只是「限制少」，而是「能做的事更多」
  - L0: 1500字 / 日5 / 月50 / 3标签 / 50私有板
  - L1: 1500字 / 日10 / 月100 / 10标签 / 200私有板 / 3版本回退 / 批量导出 ✅
  - L2: 5000字 / 日20 / 月300 / 30标签 / 1000私有板 / 10版本回退 / 自定义短链 ✅ / 批量导出 ✅ / 成就徽章 ✅
  - L3 / VIP / 管理员: 全部**不限**（硬上限 20000 字防滥用）
- 📏 **字数分级**：默认 300 → 1500；L2 5000；L3 / VIP / 管理员不限。游客板从 300 提到 1500。「我的」顶部按权益实时显示「字数 N / 不限」
- ✏️ **草稿自动保存**：编辑页 500ms 防抖写入 \`localStorage\`（键 \`mdqp_draft_<id>\` / \`mdqp_draft_new\`），刷新 / 重开页面自动提示恢复，关闭页面 \`beforeunload\` 二次确认防误丢；保存成功后清理草稿
- 🔍 **我的剪贴板 2.0**：登录态独立工具条——搜索框（含私有板）、4 种排序（最近更新 / 创建 / 浏览 / 标题）、⭐ 只看置顶、🏷 标签云筛选（按 \`tags\` 字段，逗号分隔）；空状态自动生成「清除筛选 / 新建」按钮
- ⭐ **置顶 + 改标签**：剪贴板卡片新增 ⭐ 按钮，调用 \`PATCH /api/clips/:id/meta\` 切换置顶；标签数按权益截断（L1+ 才能加，超限返回 422 + 提示下一级权益）
- 🛡 **数据层 BUG 修复**：远程 D1 缺 \`reader_count\` 列导致部分剪贴板首次访问 500（刷新后好），已补迁移并按 \`clip_readers\` 反向回填 12 行；新建表 \`CREATE TABLE\` 也补上该列避免再次掉坑
- 🌐 **低版本浏览器提示页脚入口**：底部新增「「浏览器兼容性」链接，任何用户都能手动查看当前环境是否兼容（之前只对太旧的浏览器自动弹）
- 🔗 **登录引导链**：登录弹窗与未绑定 cpoauth 引导弹窗都加上「📖 图文注册 / 登录指南」链接（指向 \`/c/loginhelp\`），帮助新用户自助注册
- 📋 **更新日志变可见**：站点当前版本与用户上次访问版本对比，首次见到新版弹一次性「✨ v4.6 来了，5 大新功能」提示
- 📖 帮助页同步扩充：权益矩阵表、字数分级表、我的剪贴板 2.0 操作步骤

---

## v4.5.2 · 2026-09-02（信任等级维持制 + 报错自动提示）
- 🛡 **信任等级改为「维持制」**：高等级不再一劳永逸，必须持续活跃才能保住
  - **L2 活跃用户**：近 **14 天**新建 **≥ 5 个**剪贴板 **且** 邀请 **≥ 1 位**好友（两条都要满足，不再看 VIP 豁免）
  - **L3 核心用户**：满足 L2 全部条件 **且** 近 **5 天**新建 **≥ 1 个**剪贴板 **且** 累计邀请 **≥ 3 位**好友；管理员 / 开发者恒为 L3
  - 窗口按剪贴板创建时间滚动统计，**删掉的板不再计入**，不达标等级会实时回落（回落不发通知，避免打扰）
- 📊 **信任进度可视化**：「我的」新增 🛡 信任等级区块，设置 → 账号与安全同步展示「近 14 天 X 个 · 近 5 天 Y 个 · 已邀请 Z 人」以及升到下一级还差什么
- ⚠️ **报错自动提示，无需 F12**：自动捕获 JS 脚本错误、未处理的 Promise 异常、关键资源加载失败、接口 5xx 与网络请求失败，弹出可读提示（错误类型 / 时间 / 页面 / 完整调用堆栈 / 运行环境 / 最近控制台日志），支持一键复制
- 🐞 **报错一键反馈**：弹窗内点「🐞 反馈给站长」（用户同意后）自动跳转反馈页，并预填环境信息、报错堆栈、控制台日志与发生页面，补充具体情况即可提交；同一错误 30 秒内只弹一次
- ⌨️ **命令面板新增「上报最近一次报错」**（\`Ctrl / Cmd + K\`），可主动带上下文上报
- 📖 帮助页同步：信任等级判定规则表重写（含维持制细则）、新增「出错自动提示（不用开 F12）」章节

---

## v4.5.1 · 2026-09-02（v4.5 热修复 + 体验优化）
- 🛠 **修复通知「加载失败」**：根因是 v4.5 数据库迁移未实际落库（远程 D1 缺 \`notifications\` 表与 \`last_trust_level\` 等三列），通知接口读新列时报 500。已补执行迁移；同时后端通知懒生成逻辑全部加故障隔离——通知系统自身出错不再拖垮接口
- 🛠 **修复「首次打开剪贴板报找不到、刷新又好」**：同一根因——首次访问走「访客通知」代码路径时 \`visit_notified\` 列不存在导致 500，而刷新时读者已入库、跳过该路径故恢复正常。已补迁移 + 给该路径加故障隔离（通知失败不再影响阅读）
- 🖥 **加载失败不再伪装成「找不到」**：剪贴板详情页区分「真不存在（404）」与「服务器/网络出错」——后者显示明确报错页 + 一键重试按钮；通知面板「加载失败」支持点击重试
- 📖 **帮助页扩充信任系统说明**：新增 L0–L3 各等级判定规则表（剪贴板数 / 注册时长 / 邀请 / VIP / 管理员）、等级回落行为、通知触发时机等详细说明

---

## v4.5 · 2026-09-02（通知系统 + 战绩区修正）
- 🔔 **通知系统（全新）**：导航栏新增铃铛，按**类别**自动归集通知——🎉 信用等级提升、⏳ 剪贴板到期、👀 剪贴板被访问、🛡 后台管理操作。支持未读红点角标、单条已读、全部已读、分类筛选；通知存于 D1 \`notifications\` 表，随登录态拉取
- 🖼 **微信名片修正**：「扫一扫添加我为好友」二维码**仅在本人主页**显示，不再出现在他人主页（之前站点级二维码被误认为「我的名片」贴到每个主页）
- 🏆 **竞赛名片显示优化**：个人主页的竞赛名片（\`card.svg\`）改为**仅当用户已关联竞赛账号**时才渲染，未关联者显示中性说明文字，避免空占位卡满天飞
- ⚠️ **详细战绩（cp:summary）暂无法使用**：因上游调整，详细战绩数据暂不可获取，战绩区仅保留竞赛名片并标注「详细战绩暂无法使用，等待更新」；一旦上游恢复即自动可用

---

## v4.4 · 2026-09-01（账号体系完善：引导 / 邮箱 / 战绩 / 设置）
- 🔔 **刷新引导判定**：打开网站时自动检测账号状态——未绑定 cpoauth 提示「建议绑定」、已绑但未设密码提示「设置密码」、两者皆备则不打扰；判定结果本地缓存 10 分钟 + 「稍后提醒」1 天 / 「不再提示」永久（同时写入服务端），避免重复请求浪费
- 🔗 **账号关联端点**：已用密码登录的用户，点「绑定 cpoauth」后回调会把第三方 \`sub\` 写回**当前账号**（而非新建孤儿账号），实现密码账号与竞赛账号合一
- 📧 **邮箱登录（P1 简化）**：绑定 cpoauth 后用户带 \`email\` scope，可直接用第三方返回的邮箱登录本站；绑定邮箱走 cpoauth，不另设独立绑定流程
- 🏆 **战绩概览**：「我的」与个人主页新增战绩区——直接嵌入 cpoauth 竞赛名片 \`card.svg\`（随主题切换明暗），并 best-effort 代理 \`cp:summary\`（依赖用户已绑 Clist.by，缺失时优雅降级）
- 🛡 **信任等级 L0–L3**：按剪贴板数量、邀请数、账号年龄、VIP / 管理员身份综合计算，显示在个人资料卡与 API 中
- 🏅 **成就徽章**：派生徽章（已连 cpoauth / 双保险 / 密码 / VIP / 剪贴板达人 / 邀请达人 / 管理员），个人主页一图展示
- ⚙️ **「我的」与个人主页重做**：资料卡升级为头像 + 信息 + 齿轮设置按钮；移除原先低劣的内联编辑与散落的安全表单；新增**设置弹窗**，分「通用」（签名 / 简介 / 主题）与「账号与安全」（密码态 / cpoauth 绑定态 / 邮箱 / 信任等级 / 登出）

---

## v4.3.1 · 2026-09-01（CPOAuth 接入体验 + 健壮性补强）
- 🚪 **退出时撤销 cpoauth 令牌**：登出会读取用户保存的 \`refresh_token\` 并调用 cpoauth 撤销接口，避免令牌在第三方侧残留（撤销失败不阻塞退出）
- 🧭 **宕机三步自救引导**：第三方登录不可用时，按钮不再隐藏而是**置灰 + tooltip**，并按登录态给出不同指引——已登录未设密码者提示「立即设置密码」，其余用户给「登录帮助 / 联系站长」兜底入口（指向 \`/c/loginhelp\`）
- 🔑 **登录弹窗说明**：cpoauth 按钮下方新增一句话说明它是什么、能同步哪些竞赛账号
- 🃏 **关联账号品牌卡片**：个人主页的关联账号从纯文本 chip 升级为带品牌色、可点击跳转平台主页的卡片网格；本人未绑定时显示空态提示
- 🌐 **低版本浏览器引导**：通过可选链 \`?.\`/\`??\` 语法探测，过旧浏览器（如 IE、旧 Edge、Chrome<60、FF<55、Safari<11）打开即弹出引导弹窗，推荐下载 Firefox 新版，并跳过 SPA 初始化避免白屏

---

## v4.3 · 2026-09-01
- 🔑 **设置密码入口统一**：「我的」与个人主页共用同一个设置密码弹窗（两次输入确认、实时校验），去掉个人主页里重复的内联表单
- 🧭 **未设密码自动引导**：登录后若检测到账号还没有密码，顶部会出现引导条，点一下即可补设；关闭后 7 天内不再打扰
- 🛡 **「账号安全」区块**：「我的」页新增账号安全区，直观显示当前是否已设置密码、登录用户名是什么
- 🚫 **游客登录修正**：个人主页游客态原先会硬跳转授权页，现在正确弹出统一登录弹窗
- 🔒 **密码登录加固**：密码长度限制 6–128 位；登录失败按「账号 + IP」双维度限流（15 分钟窗口），超阈值返回 429；用户名查重改为大小写不敏感，杜绝 \`abc\` / \`ABC\` 并存导致登录歧义
- 📖 文档校正：帮助页与更新日志中的注册规则统一修正为**用户名 2–20 字符、密码 6–128 位**（此前误写为 3–20 / ≥8）

## v4.2 · 2026-08-31
- 🔐 **密码登录 / 注册**：新增账号密码体系作为第三方登录的备用通道，用户名 3–20 位、密码 ≥ 8 位，密码以加盐 SHA-256 存储
- 🩺 **cpoauth 连通性探测**：打开登录弹窗时实时探测第三方登录服务（4 秒超时），宕机时自动隐藏其按钮并弹出降级横幅引导密码登录
- 🔑 **老用户设置密码**：已用第三方登录的账号可在个人主页补设密码，之后两种登录方式并存
- 🧭 **统一登录弹窗**：导航栏、邀请页、⌘K 命令面板三处入口统一接入，不再直接跳转第三方授权
- 📦 **源码全量同步 GitHub**：v4.x 全部源码推送到 \`yanzien/mdqp\` 并清理 v3.x 遗留文件
- 🛠 **后台「查看代码」链路打通**：接入 \`GITHUB_TOKEN\` 后，后台可实时浏览仓库文件、在线编辑并提交审批，审批通过即写入 GitHub
- 📚 文档翻新：更新日志与帮助页补齐 v4.x 全部功能，修正帮助页中过时的字数与限额说明

## v4.1 · 2026-08-30
- 🔧 **编辑器修复弹窗**：一键自动修复 Markdown 常见问题（代码围栏 / 数学公式 / 删除线配对、行尾空白、KaTeX 语法校验）
- 🧰 **工具栏增强**：补充一级/三级标题、删除线、图片、分割线等插入按钮
- 📮 **官方反馈贴**：新增 \`/feedback\`，支持 Bug 反馈（自动附带环境与控制台日志）与意见反馈，管理员可在线审核
- 🗂 **后台代码管理**：新增 \`/admin/code\` 查看代码页，支持文件树浏览、在线编辑、本地预览、提交审批与 diff 对比
- 🔏 **后台权限细化**：代码查看权限（\`view_code\`）独立成位，开发者自动具备

## v4.0 · 2026-08-28
- 🎫 **VIP 系统**：管理员可授予用户 VIP 身份（金色标识），开通时提示加站长微信
- 🎁 **邀请系统**：专属邀请码 + 链接，tier 奖励（1人→全功能 / 3人→VIP / 5人→不限字数+置顶 / 10人→开发者大礼包），被邀请者获自定义短链权限
- 💬 **评论系统**：登录用户可评论（支持 Markdown + @mention），每条 50 等效字
- 🔐 **登录门禁**：作者可设「仅登录用户可查看」，未登录显示登录引导
- 👥 **唯一读者限制**：按独立访客计（非浏览次数），游客用设备指纹识别
- ⚙️ **功能开关**：管理员可单独开关每个用户的高级功能（自定义短链、密码、过期、协作、登录可见、读者上限、评论）
- 📊 **限额升级**：登录用户日限 5 / 月限 50；游客周限 5；每板字数限 300（CJK 全算、英文标点折半；管理员与有效 VIP 豁免）
- 📢 **公告系统**：管理员可在首页置顶公告
- ✏️ **短链修改**：有权限的用户可修改已发布剪贴板的短链
- 🛡 **管理员权限颜色梯度**：蓝→绿→橙→红→紫（按权限从低到高），开发者/最高权限为紫色
- 📝 编辑器增强：实时等效字数统计（区分中英文）、@mention 自动补全

## v3.8 · 2026-08-28
- 📝 **更新日志页正式上线**：内容随代码发布自动同步，不再依赖后台手动维护
- ✨ 页面切换动画增强：淡入 + 轻微上移，过渡更顺滑
- 🎴 版本条目改为带左侧色条的「发布卡片」样式

## v3.7 · 2026-08-28
- 🖼 12 处空状态（首页 / 搜索 / 我的 / 用户主页 / 404 等）加入手绘风 SVG 插画
- 💡 列表加载使用 shimmer 骨架屏，告别空白闪烁
- 🎨 配色层级微调：主色靛蓝 \`#4361ee\`、导航高亮渐变光晕、三级圆角与柔和阴影

## v3.6 · 2026-08-28
- ⌨️ 新增 **⌘K / Ctrl+K 命令面板**：快速跳转页面与操作、直达剪贴板
- 🔎 模糊搜索 + ↑↓ 选择 + Enter 执行 + Esc 关闭
- 顶栏搜索按钮触发命令面板

## v3.5 · 2026-08-28
- 🧱 全新「侧边栏 + 主栏」布局，借鉴 shadcn-admin 设计语言
- 🎨 neutral 调色板、统一圆角与聚焦环
- 📱 移动端抽屉式导航
- 🛡 管理后台入口按权限显隐

## v3.4 · 2026-08-26
- ✍️ 个人签名（本地编辑）+ bio 从 cpoauth 同步
- 🛡 管理员细粒度权限：删号 / 设限额 / 编辑页面 / 编辑公开板 / 编辑私有板
- 🔒 密码门修复：仅原作者免密，协作者也需密码
- 🗄 远程数据库迁移脚本 \`migrate_v3.4.sql\`

## v3.3 · 2026-08
- ⚡ highlight.js 按需加载，首屏不再阻塞
- 🌐 公开接口加 \`Cache-Control\` 缓存头
- 📝 更新日志页雏形
- 🔒 搜索关键词限长 100 字符，防滥用

## v3.2 · 2026-08
- 👥 用户管理 / 角色、册封与撤管理员、删号（级联删其剪贴板）
- 🛡 \`/admin\` 管理后台：用户列表、全部剪贴板、站点页面
- 📄 \`/help\` \`/about\` 站点页面，管理员可编辑
- 👤 个人主页展示 cpoauth 绑定账号（洛谷等）+ 个人介绍

## v3.1 · 2026-08
- 🐛 修复中文输入法（IME）在输入框被 Enter 劫持、汉字无法上屏
- 💡 代码高亮、编辑器 / 查看页目录大纲

## v3.0 · 2026-08
- 🏗 基于 Cloudflare Workers + D1 全栈重写
- 🔓 免登录可用、密码保护、定时过期、阅读次数上限、自定义短链、Raw 直链`;

// ==================== 基础工具 ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// 空状态 SVG 插画
const emptyHTML = (type, msg, cta) => {
  const svgs = {
    clips: `<svg viewBox="0 0 140 110" fill="none" class="empty-svg"><rect x="20" y="18" width="100" height="74" rx="10" stroke="currentColor" stroke-width="2" opacity=".2"/><path d="M35 38h70M35 55h50M35 72h36" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".15"/><circle cx="98" cy="68" r="18" fill="currentColor" opacity=".06"/><path d="M92 68 L96 72 L105 61" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".25"/></svg>`,
    search: `<svg viewBox="0 0 130 100" fill="none" class="empty-svg"><circle cx="52" cy="48" r="28" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M73 69L95 91" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".15"/></svg>`,
    me: `<svg viewBox="0 0 130 110" fill="none" class="empty-svg"><circle cx="65" cy="42" r="26" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M30 95c0-20 16-34 35-34s35 14 35 34" stroke="currentColor" stroke-width="2.5" opacity=".12"/></svg>`,
    gate: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><rect x="28" y="16" width="64" height="68" rx="8" stroke="currentColor" stroke-width="2.5" opacity=".2"/><circle cx="60" cy="50" r="16" stroke="currentColor" stroke-width="2" opacity=".15"/><path d="M53 50 L57 54 L67 44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".2"/></svg>`,
    admin: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><path d="M60 14L90 28v28c0 22-13 38-30 46-17-8-30-24-30-46V28l30-14z" stroke="currentColor" stroke-width="2.5" opacity=".2"/><path d="M52 50l6 6 14-14" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".2"/></svg>`,
    comments: `<svg viewBox="0 0 120 100" fill="none" class="empty-svg"><path d="M20 24h80a8 8 0 018 8v40a8 8 0 01-8 8H60L40 96V80H20a8 8 0 01-8-8V32a8 8 0 018-8z" stroke="currentColor" stroke-width="2" opacity=".2"/><path d="M36 44h48M36 56h32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".15"/></svg>`
  };
  const svg = svgs[type] || svgs.clips;
  const ctaHTML = cta ? `<div>${cta}</div>` : '';
  return `<div class="empty-illo"><div class="empty-art">${svg}</div><h3>${msg}</h3>${ctaHTML}</div>`;
};

const state = { me: null, page: 1, q: '', editing: null, editingPage: null, adminTab: 'users' };

const PLATFORM_NAMES = { luogu: '洛谷', codeforces: 'Codeforces', atcoder: 'AtCoder', github: 'GitHub', google: 'Google', clist: 'Clist' };

function isAdmin() { return state.me?.type === 'user' && (state.me.role === 'admin' || state.me.role === 'developer'); }
/** v4.0: 有效 VIP（is_vip 且 vip_until 未过期）——VIP 豁免字数限制 */
function isVip() {
  const me = state.me;
  if (!me || me.type !== 'user' || !me.is_vip) return false;
  if (!me.vip_until) return true;
  const t = new Date(String(me.vip_until).replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(t) ? t > Date.now() : true;
}

/** v4.0: 角色徽章（含 VIP 金色 + 管理员权限颜色梯度） */
function roleBadge(role, opts = {}) {
  if (role === 'developer') return '<span class="badge badge-role badge-dev">🛠 开发者</span>';
  if (role === 'admin') {
    // 管理员权限等级由调用方传入 permLevel (1-5)，对应 蓝<绿<橙<红<紫
    const lvl = opts.permLevel || 1;
    return `<span class="badge badge-role badge-admin badge-admin-lvl${lvl}">🛡 管理员</span>`;
  }
  // VIP 金色徽章
  if (opts.is_vip) return '<span class="badge badge-role badge-vip">⭐ VIP</span>';
  return '';
}

/** v4.8.2: 他人身份 tag —— 用在首页卡片与剪贴板页的用户名后面（管理员 / 开发者 / 有效 VIP）
 *  VIP 需校验 vip_until 是否过期，过期就不再显示（与 isVip() 判定保持一致）。 */
function ownerBadge(role, isVipFlag, vipUntil) {
  if (role === 'developer') return '<span class="badge badge-role badge-dev owner-tag">🛠 开发者</span>';
  if (role === 'admin') return '<span class="badge badge-role badge-admin badge-admin-lvl1 owner-tag">🛡 管理员</span>';
  if (isVipFlag) {
    let ok = true;
    if (vipUntil) {
      const t = new Date(String(vipUntil).replace(' ', 'T') + 'Z').getTime();
      ok = Number.isFinite(t) ? t > Date.now() : true;
    }
    if (ok) return '<span class="badge badge-role badge-vip owner-tag">⭐ VIP</span>';
  }
  return '';
}

function toast(msg, type = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = 'toast'), 2600);
}

// v4.6: 新版本提示（首次见到新版本时一次性横幅，展示本次完整更新日志 + 两个按钮）
function maybeShowVersionToast(oldVer, newVer) {
  const isFirst = !oldVer; // 首次访问（localStorage 无版本记录）：同样弹出，但文案换欢迎语
  // 已经看过的就别再弹
  try { if (localStorage.getItem('mdqp_version_announced') === newVer) return; } catch (_) {}
  // 距离上次访问 < 30 秒（刚刷新自己）也跳过
  try {
    const last = +localStorage.getItem('mdqp_last_seen_version_ts') || 0;
    if (Date.now() - last < 30000) { localStorage.setItem('mdqp_version_announced', newVer); return; }
  } catch (_) {}

  // 从 CHANGELOG_MD 抽取本次版本段落（## v{ver} 起到下一个 --- 或下一个 ## 前）
  let bodyHtml = '';
  try {
    const vEsc = String(newVer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('##\\s+v' + vEsc + '\\b[\\s\\S]+?(?=\\n---|\\n##\\s|v$)');
    const m = CHANGELOG_MD.match(re);
    if (m) {
      // 去掉标题行（## v4.6 · 2026-09-03（...）），留下 bullet 列表本体
      const mdBody = m[0].replace(/^##\s+v[\d.]+.*\n/, '');
      // marked.parse 转 HTML：CHANGELOG_MD 是站内常量，无 XSS 风险
      bodyHtml = typeof marked !== 'undefined' && marked.parse ? marked.parse(mdBody, { breaks: false, gfm: true }) : esc(mdBody).replace(/\n/g, '<br>');
    }
  } catch (_) {}
  if (!bodyHtml) bodyHtml = '<p class="muted" style="margin:4px 0">本次更新日志内容暂不可用，<a href="/changelog" data-link>查看完整更新日志 →</a></p>';

  const banner = document.createElement('div');
  banner.className = 'version-toast';
  banner.innerHTML = `
    <div class="vt-icon">✨</div>
    <div class="vt-body">
      <div class="vt-title">${isFirst ? '🎉 欢迎使用 mdqp · 当前版本 v' + esc(newVer) : 'v' + esc(newVer) + ' 已发布'} · 本次更新日志</div>
      <div class="vt-content">${bodyHtml}</div>
    </div>
    <div class="vt-acts">
      <a class="btn btn-sm btn-ghost" href="/changelog" data-link id="vtMore">更多日志</a>
      <button class="btn btn-sm btn-primary" id="vtOk">确定</button>
    </div>`;
  // 横向偏宽（520 → 580）+ 垂直布局：图标 / 内容 / 按钮三段垂直堆叠，避免横向挤压内容
  banner.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:9999;background:var(--surface,#fff);border:1px solid var(--primary);border-radius:14px;box-shadow:0 12px 40px rgba(15,23,48,.18);padding:16px 18px;display:flex;flex-direction:column;gap:10px;width:min(580px,calc(100vw - 24px));max-height:80vh;animation:vtIn .35s ease';
  const close = () => { banner.style.animation = 'vtOut .25s ease'; setTimeout(() => banner.remove(), 240); localStorage.setItem('mdqp_version_announced', newVer); localStorage.setItem('mdqp_last_seen_version_ts', String(Date.now())); };
  banner.querySelector('#vtOk').onclick = close;
  // 点击「更多日志」也要关掉 + 跳 /changelog
  banner.querySelector('#vtMore').onclick = () => close();
  document.body.appendChild(banner);
  // 一次性注入动画 CSS
  if (!document.getElementById('vt-css')) {
    const s = document.createElement('style'); s.id = 'vt-css';
    s.textContent = '@keyframes vtIn{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}@keyframes vtOut{from{opacity:1;transform:translateX(-50%) translateY(0)}to{opacity:0;transform:translateX(-50%) translateY(-12px)}}';
    document.head.appendChild(s);
  }
}

function guestId() {
  let g = localStorage.getItem('mdqp_guest');
  if (!g) { g = (crypto.randomUUID ? crypto.randomUUID() : 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, ''); localStorage.setItem('mdqp_guest', g); }
  return g;
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Guest-Id': guestId() }, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  } catch (e) {
    // v4.5.2：网络层失败（断网 / DNS / 被拦截）自动上报，用户不用开 F12
    // v4.7.5：opts.silent 静默模式——次要探测（cpoauth 状态等）失败只返回，不弹报错窗
    reportError({ kind: 'api', message: '网络请求失败：' + path, stack: (e && e.stack) || '', extra: String((e && e.message) || ''), silent: !!opts.silent });
    return { ok: false, status: 0, data: null };
  }
  let data = null; try { data = await res.json(); } catch { /* 非 JSON */ }
  // v4.5.2：服务端 5xx 也上报（4xx 属业务预期，不打扰用户）
  if (res.status >= 500) {
    reportError({ kind: 'api', message: '接口 ' + res.status + ' 错误：' + (opts.method || 'GET') + ' ' + path, extra: (data && (data.error || data.message)) || '' });
  }
  return { ok: res.ok, status: res.status, data };
}

/** 全局数学块占位符计数器（避免嵌套调用冲突） */
let _mathBlockId = 0;

function md(text) {
  const s = String(text || '');
  // ── 第 1 步：把 $$..$ 和 $..$ 数学块提取出来，用占位符保护 ──
  //    marked.js 会把 \f \s 等反斜杠序列当转义符吞掉（\f→换页符），
  //    必须在 marked 之前把整块数学内容隔离。
  const mathBlocks = [];
  const protected = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: true });
    return '\x00MATH' + id + 'D\x00';
  }).replace(/\$([^\$\n]+?)\$/g, (_, body) => {
    const id = _mathBlockId++;
    mathBlocks.push({ id, body, display: false });
    return '\x00MATH' + id + 'I\x00';
  });

  // ── 第 2 步：marked 解析 Markdown（此时文本中已无 LaTeX 反斜杠）──
  let raw = marked.parse(protected, { breaks: true, gfm: true });

  // ── 第 3 步：还原数学块（在 DOMPurify 净化之前，先放回原始 LaTeX 源码）──
  raw = raw.replace(/\x00MATH(\d+)([DI])\x00/g, (_, num, type) => {
    const b = mathBlocks.find(m => m.id === Number(num));
    if (!b) return '';
    return type === 'D' ? '$$' + b.body + '$$' : '$' + b.body + '$';
  });

  // ── 第 4 步：净化 + @提及链接 ──
  const safe = linkifyMentions(DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] }));

  // ── 第 5 步：KaTeX 渲染（code/pre 内忽略数学定界符）──
  if (window.renderMathInElement) {
    const tmp = document.createElement('div');
    tmp.innerHTML = safe;
    try {
      renderMathInElement(tmp, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        throwOnError: false
      });
    } catch (e) { /* 数学渲染失败不影响正文 */ }
    return tmp.innerHTML;
  }
  return safe;
}

/** 把 @用户名（[A-Za-z0-9_]）解析为指向 /u/用户名 的可点击链接。
 *  跳过：HTML 标签内、<a> 内（避免重复链接）、<code>/<pre> 内（代码块中 @types/react、
 *  npm i @babel/core、Python 装饰器等不是提及，误解析会破坏代码）。*/
function linkifyMentions(html) {
  const re = /@([A-Za-z0-9_]{2,30})/g; let out = '', last = 0, m;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    const before = html.slice(0, m.index);
    const inTag = before.lastIndexOf('<') > before.lastIndexOf('>');
    const inAnchor = before.lastIndexOf('<a ') > before.lastIndexOf('</a>');
    const lastCodeOpen = Math.max(before.lastIndexOf('<pre'), before.lastIndexOf('<code'));
    const lastCodeClose = Math.max(before.lastIndexOf('</pre>'), before.lastIndexOf('</code>'));
    const inCode = lastCodeOpen > lastCodeClose;
    if (inTag || inAnchor || inCode) out += m[0];
    else out += `<a href="/u/${m[1]}" class="mention">@${m[1]}</a>`;
    last = m.index + m[0].length;
  }
  return out + html.slice(last);
}

let _hljsReady = null;
function ensureHljs() {
  if (window.hljs) return Promise.resolve();
  if (_hljsReady) return _hljsReady;
  _hljsReady = new Promise((resolve, reject) => {
    if (!document.getElementById('hljs-css')) {
      const light = document.createElement('link'); light.id = 'hljs-css'; light.rel = 'stylesheet';
      light.href = '/vendor/highlight-github.min.css';
      document.head.appendChild(light);
      const dark = document.createElement('link'); dark.rel = 'stylesheet';
      dark.href = '/vendor/highlight-github-dark.min.css';
      dark.media = '(prefers-color-scheme: dark)'; document.head.appendChild(dark);
    }
    const s = document.createElement('script'); s.src = '/vendor/highlight.min.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('hljs load failed'));
    document.head.appendChild(s);
  });
  return _hljsReady;
}

function renderMd(el, text) {
  el.innerHTML = md(text);
  const codes = el.querySelectorAll('pre code');
  if (!codes.length) return;
  ensureHljs().then(() => codes.forEach((b) => { try { window.hljs.highlightElement(b); } catch { /* skip */ } })).catch(() => {});
}

function buildOutline(container) {
  const hs = container.querySelectorAll('h1, h2, h3, h4');
  if (!hs.length) return '';
  let i = 0; let html = '<div class="toc-title">📑 目录</div><ul class="toc-list">';
  hs.forEach((h) => { if (!h.id) h.id = 'toc-' + i++; const lvl = +h.tagName[1]; html += `<li class="toc-l${lvl}"><a href="javascript:void(0)" data-toc="${h.id}">${esc(h.getAttribute('data-toc-text') || h.textContent || '')}</a></li>`; });
  html += '</ul>'; return html;
}
function setupToc(toggleBtn, panel, contentEl) {
  if (!toggleBtn) return;
  toggleBtn.onclick = () => { if (panel.classList.contains('hidden')) { panel.innerHTML = buildOutline(contentEl); panel.classList.remove('hidden'); } else panel.classList.add('hidden'); }; 
  panel.onclick = (e) => { const a = e.target.closest('[data-toc]'); if (a) { const t = document.getElementById(a.dataset.toc); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
}

function timeAgo(s) {
  if (!s) return ''; const t = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime(); const d = Date.now() - t;
  if (d < 6e4) return '刚刚'; if (d < 36e5) return Math.floor(d / 6e4) + ' 分钟前'; if (d < 864e5) return Math.floor(d / 36e5) + ' 小时前'; if (d < 2592e6) return Math.floor(d / 864e5) + ' 天前';
  return new Date(t).toLocaleDateString('zh-CN');
}
function expiryText(s) {
  if (!s) return ''; const t = new Date(s.replace(' ', 'T') + 'Z').getTime(); const left = t - Date.now();
  if (left <= 0) return '已过期'; if (left < 36e5) return Math.ceil(left / 6e4) + ' 分钟后过期'; if (left < 864e5) return Math.ceil(left / 36e5) + ' 小时后过期';
  return Math.ceil(left / 864e5) + ' 天后过期';
}

/** v4.0: 字数统计（CJK=1, ASCII=0.5） */
function countChars(text) {
  if (!text) return 0; let score = 0;
  for (const ch of text) { score += ch.charCodeAt(0) > 127 ? 1 : 0.5; }
  return Math.ceil(score);
}

// ==================== 主题 ====================
function applyTheme(mode) {
  let dark = mode === 'dark';
  if (mode === 'auto') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const tb = $('#themeBtn'); if (tb) tb.textContent = dark ? '☀️' : '🌙';
}
function initTheme() {
  const saved = localStorage.getItem('mdqp_theme') || 'auto';
  applyTheme(saved);
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mdqp_theme', next); applyTheme(next);
  };
  // 跟随系统：系统主题变化时实时同步（仅当设置为 auto）
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('mdqp_theme') || 'auto') === 'auto') applyTheme('auto');
    });
  }
}

// ==================== 路由 ====================
function go(path, replace = false) { if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path); render(); }
function showView(id) { state._view = id; $$('.view').forEach((v) => v.classList.remove('active')); $('#view-' + id).classList.add('active'); window.scrollTo(0, 0); }
function closeNav() { document.body.classList.remove('nav-open'); }
function updateNav() {
  const p = location.pathname.replace(/\/+$/, '') || '/'; const seg = p.split('/').filter(Boolean);
  const map = { home: p === '/', new: p === '/new' || (seg[0] === 'edit' && seg[1]), me: p === '/me', admin: seg[0] === 'admin', help: p === '/help', about: p === '/about', changelog: p === '/changelog', tickets: p === '/tickets' || seg[0] === 'tickets', invite: seg[0] === 'invite' };
  $$('.nav-item').forEach((el) => { const key = el.dataset.nav; if (key && map[key]) el.classList.add('active'); else el.classList.remove('active'); });
}

async function render() {
  closeNav(); updateNav();
  const p = location.pathname.replace(/\/+$/, '') || '/'; const seg = p.split('/').filter(Boolean);
  try {
    if (p === '/') return renderHome();
    if (p === '/new') return renderEditor(null);
    if (p === '/me') return renderMe();
    if (seg[0] === 'edit' && seg[1]) return renderEditor(seg[1]);
    if (seg[0] === 'edit-page' && seg[1]) return renderPageEditor(seg[1]);
    if (seg[0] === 'u' && seg[1]) return renderUser(seg[1]);
    if (seg[0] === 'c' && seg[1]) return renderClip(seg[1]);
    if (p === '/help') return renderPage('help');
    if (p === '/about') return renderPage('about');
    if (p === '/changelog') return renderPage('changelog');
    if (seg[0] === 'invite' && seg[1]) return renderInviteLanding(seg[1]);
    if (p === '/invite') return renderInvitePage();
    if (p === '/vip') return renderVipPage();
    if (p === '/feedback') return renderTickets();          // 旧 /feedback 别名 → 工单中心
    if (p === '/tickets') return renderTickets();
    if (p === '/tickets/new') return renderNewTicket();     // 工单写入独立页（Markdown 编辑器）
    if (seg[0] === 'tickets' && seg[1]) return renderTicketDetail(seg[1]);
    // 系统错误页 / 404 页：复用剪贴板文稿（本身即 📋），不加 /c/ 前缀以便与片段区分
    if (seg[0] === 'error') return renderClip('error');
    if (seg[0] === '404') return renderClip('404');
    if (seg[0] === 'admin' && seg[1] === 'code') return renderAdminCode();
    if (seg[0] === 'admin') return renderAdmin();
    if (seg.length === 1) return renderClip(seg[0]);
    // 未知路径 → 展示用户撰写的 404 文稿（而非静态占位）
    return renderClip('404');
  } catch (e) {
    if (window.__mdqpShowErrBar) window.__mdqpShowErrBar('页面渲染出错：' + (e && e.message ? e.message : e), 'fatal');
    else throw e;
  }
}

// ==================== 身份 ====================
/** v4.13: 被封禁用户的全局横幅 */
function showBanBanner(reason, until) {
  let el = document.getElementById('banBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'banBanner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#7f1d1d,#b91c1c);color:#fff;padding:10px 16px;font-size:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.body.appendChild(el);
  }
  el.innerHTML = `🚫 <b>账号已被封禁</b> ${esc(reason)} ${until} <button id="banLogout" style="margin-left:10px;background:#fff;color:#b91c1c;border:none;border-radius:6px;padding:2px 10px;cursor:pointer">退出登录</button>`;
  const lo = document.getElementById('banLogout');
  if (lo) lo.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
}

async function loadMe() {
  const { data } = await api('/api/me'); state.me = data || { type: 'none' }; const box = $('#navAuth');
  // v4.13: 清掉可能存在的封禁横幅（非封禁用户不应显示）
  document.getElementById('banBanner')?.remove();
  if (state.me.type === 'banned') {
    const until = state.me.banUntil ? '（封禁至 ' + esc(String(state.me.banUntil).slice(0, 10)) + '）' : '（永久封禁）';
    box.innerHTML = `<span class="guest-chip" style="border-color:rgba(220,38,38,.4);color:#e0524f">🚫 已封禁</span><button class="btn btn-primary" id="loginBtn">🔑 登录</button>`;
    $('#loginBtn').onclick = () => openAuthModal('login');
    showBanBanner(state.me.banReason || '你因违反社区规范已被封禁', until);
    return;
  }
  if (state.me.type === 'user') {
    box.innerHTML = `<span class="nav-user" title="${esc(state.me.name)}">${avatarHtml(state.me.avatar, state.me.name)}</span><button class="btn btn-ghost" id="logoutBtn">退出</button>`;
    $('#logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
  } else {
    const left = state.me.type === 'guest' ? Math.max(0, (state.me.limit || 5) - (state.me.count || 0)) : 5;
    box.innerHTML = `<span class="guest-chip" title="游客模式">游客 · 剩 ${left}</span><button class="btn btn-primary" id="loginBtn">🔑 登录</button>`;
    $('#loginBtn').onclick = () => openAuthModal('login');
  }
  const al = $('#navAdminLink'); if (al) al.classList.toggle('hidden', !isAdmin());
  const cl = $('#navCodeLink'); if (cl) cl.classList.toggle('hidden', !isAdmin());
  // 刷新引导：未绑 cpoauth → 建议绑定；已绑未设密码 → 建议设密码；都符合 → 不弹
  checkRefreshGuide();
  refreshNotifBadge();
}

function avatarHtml(url, name) { if (url) return `<img class="avatar" src="${esc(url)}" alt="">`; const ch = (name || '?').trim().charAt(0).toUpperCase(); return `<span class="avatar avatar-txt">${esc(ch)}</span>`; }

// ==================== 卡片 ====================
function clipCard(c) {
  const badges = [];
  if (c.editable_by_anyone) badges.push('<span class="badge badge-collab">🤝 任何人可编辑</span>');
  if (c.has_password) badges.push('<span class="badge badge-lock">🔒 需密码</span>');
  if (c.expires_at) badges.push(`<span class="badge badge-time">⏳ ${esc(expiryText(c.expires_at))}</span>`);
  if (c.max_views > 0) badges.push(`<span class="badge badge-eye">👁 ${c.views}/${c.max_views}</span>`);
  if (c.login_required) badges.push('<span class="badge badge-login">🔒 登录可见</span>');
  if (c.is_public === false) badges.push('<span class="badge">🙈 仅链接可见</span>');
  // v4.8.2: 用户名后的身份 tag。「我的剪贴板」等接口不返回 owner_* 字段，回退到当前登录者
  let oRole = c.owner_role, oVip = c.owner_is_vip, oUntil = c.owner_vip_until;
  if (c.owner_type === 'user' && oRole === undefined && state.me && String(state.me.userId || state.me.id) === String(c.owner_id)) {
    oRole = state.me.role; oVip = state.me.is_vip; oUntil = state.me.vip_until;
  }
  const authorHtml = c.owner_type === 'user'
    ? `<a class="card-author" href="/u/${esc(c.owner_id)}" data-link>${esc(c.owner_name)}</a>${ownerBadge(oRole, oVip, oUntil)}`
    : `<span class="card-author guest">${esc(c.owner_name || '游客')}</span>`;
  // v4.6: 标签 + 置顶按钮（仅在我的剪贴板渲染时显示）
  const tagsArr = Array.isArray(c.tags) ? c.tags : [];
  const tagHtml = tagsArr.length ? `<div class="card-tags">${tagsArr.map((t) => `<a class="tag-chip" href="#" data-mytag="${esc(t)}" onclick="event.preventDefault();window.__myTagFilter&&window.__myTagFilter('${esc(t)}')">#${esc(t)}</a>`).join('')}</div>` : '';
  const pinBtn = c.__canPin ? `<button class="card-pin ${c.pinned ? 'on' : ''}" data-pin="${esc(c.clip_id)}" data-pin-state="${c.pinned ? 1 : 0}" title="${c.pinned ? '取消置顶' : '置顶'}" onclick="event.preventDefault();event.stopPropagation();window.__togglePin && window.__togglePin('${esc(c.clip_id)}', ${c.pinned ? 0 : 1})">${c.pinned ? '⭐' : '☆'}</button>` : '';
  return `<article class="clip-card ${c.pinned ? 'is-pinned' : ''}"><a class="card-main" href="/c/${esc(c.clip_id)}" data-link><h3>${esc(c.title || '无标题')}</h3><p class="card-preview">${esc(c.preview || '')}</p></a><div class="card-foot">${authorHtml}<span class="muted">· ${esc(timeAgo(c.created_at))}</span><code class="card-id">${esc(c.clip_id)}</code>${pinBtn}</div>${badges.length ? `<div class="badge-row">${badges.join('')}</div>` : ''}${tagHtml}</article>`;
}

// ==================== 首页（含公告横幅） ====================
let searchTimer = null;
async function renderHome() {
  showView('home');
  const { data: stats } = await api('/api/stats');
  // v4.7.5 反馈 #9：机房代理可能返回被截断 / 旧缓存的 index.html，容器缺失时
  // `$('#heroStats').innerHTML` 会抛 null 异常并中断整个首页渲染（列表一片空白）。
  // 这里做空值保护，并提示强制刷新，而不是静默白屏。
  const heroStats = $('#heroStats');
  if (stats && heroStats) heroStats.innerHTML = `<span>📋 ${stats.clips} 个剪贴板</span><span>👤 ${stats.users} 位用户</span>`;
  if (!heroStats || !$('#jumpBtn') || !$('#searchInput') || !$('#clipList')) showStaleShellHint();

  // v4.0: 加载公告
  loadAnnouncements();

  // v4.6.2: 主页范围切换 — 登录用户可切到「我的」，直接搜自己的（含私有）剪贴板
  const scopeBox = $('#homeScope');
  const isUser = !!(state.me && (state.me.userId || state.me.id) && state.me.type !== 'guest' && state.me.type !== 'none');
  if (scopeBox) {
    scopeBox.classList.toggle('hidden', !isUser);
    if (isUser) {
      if (!state.homeScope) state.homeScope = 'public';
      $$('#homeScope .scope-btn').forEach((b) => {
        b.classList.toggle('on', b.dataset.scope === state.homeScope);
        b.onclick = () => {
          if (state.homeScope === b.dataset.scope) return;
          state.homeScope = b.dataset.scope; state.page = 1;
          $$('#homeScope .scope-btn').forEach((x) => x.classList.toggle('on', x.dataset.scope === state.homeScope));
          renderHomeListHead(); loadList();
        };
      });
    }
  }
  renderHomeListHead();

  const jumpBtn = $('#jumpBtn'), jumpInput = $('#jumpInput'), searchInput = $('#searchInput');
  if (jumpBtn) jumpBtn.onclick = jump;
  if (jumpInput) jumpInput.onkeydown = (e) => { if (e.isComposing || e.key !== 'Enter') return; jump(); };
  if (searchInput) {
    searchInput.oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadList(); }, 300); };
    searchInput.value = state.q;
  }
  loadList();
}

/** v4.7.5：页面骨架缺失（多为代理返回旧缓存 / HTML 被截断）时的提示，替代白屏 */
function showStaleShellHint() {
  const box = $('#view-home') || document.querySelector('.view.active') || document.body;
  if (!box || box.querySelector('#staleShellHint')) return;
  const d = document.createElement('div');
  d.id = 'staleShellHint';
  d.setAttribute('style', 'margin:12px 0;padding:12px 14px;border-radius:10px;background:#fff4e5;color:#7a4b00;border:1px solid #f0c48a;font-size:13.5px;line-height:1.7');
  d.innerHTML = '<b>⚠️ 页面结构加载不完整</b><br>常见于机房代理返回了旧缓存或被截断的页面。'
    + '<a href="javascript:location.reload(true)" style="color:#a15c00;font-weight:600">点此强制刷新</a>'
    + '（或按 <b>Ctrl + F5</b>）后通常恢复。若反复出现，欢迎到「反馈」页提一条 Bug。';
  box.insertBefore(d, box.firstChild);
}

/** v4.6.2: 主页列表标题 / 搜索框占位随范围切换 */
function renderHomeListHead() {
  const t = $('#homeListTitle'); if (!t) return;
  const mine = state.homeScope === 'mine';
  t.textContent = mine ? '⭐ 我的剪贴板（含私有）' : '🌐 公开剪贴板';
  const si = $('#searchInput');
  if (si) si.placeholder = mine ? '🔍 搜索我的剪贴板（标题 / 内容 / 标签）' : '🔍 搜索标题 / 内容 / 作者';
}

/** v4.0: 加载并渲染公告横幅 */
async function loadAnnouncements() {
  const box = $('#announcementBanner');
  if (!box) return;
  const { data } = await api('/api/announcements');
  if (!data?.announcements?.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = data.announcements.map((a) =>
    `<div class="announcement-bar">📢 ${md(a.content)}<button class="announcement-close" onclick="this.parentElement.remove()">✕</button></div>`
  ).join('');
}

function jump() { const v = $('#jumpInput').value.trim().replace(/^.*\/(c\/)?/, ''); if (v) go('/c/' + encodeURIComponent(v)); }

async function loadList() {
  // v4.6.2: 主页「我的」范围 — 搜自己的（含私有）
  if (state.homeScope === 'mine') return loadHomeMine();
  const box = $('#clipList');
  box.innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div><div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div>';
  const { data } = await api(`/api/clips?page=${state.page}&q=${encodeURIComponent(state.q)}`);
  if (!data || !data.clips) return (box.innerHTML = emptyHTML('clips', '加载失败', ''));
  if (!data.clips.length) {
    box.innerHTML = state.q ? emptyHTML('search', `没有匹配「${esc(state.q)}」的剪贴板`, '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 新建剪贴板</a>') : emptyHTML('clips', '还没有公开剪贴板', '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 创建第一个</a>');
    $('#pager').innerHTML = ''; return;
  }
  box.innerHTML = data.clips.map(clipCard).join('');
  const pg = [];
  if (data.totalPages > 1) { pg.push(`<button class="btn btn-sm" ${data.page <= 1 ? 'disabled' : ''} data-p="${data.page - 1}">上一页</button>`); pg.push(`<span class="muted">${data.page} / ${data.totalPages}（共 ${data.total}）</span>`); pg.push(`<button class="btn btn-sm" ${data.page >= data.totalPages ? 'disabled' : ''} data-p="${data.page + 1}">下一页</button>`); }
  $('#pager').innerHTML = pg.join('');
  $$('#pager button[data-p]').forEach((b) => (b.onclick = () => { state.page = +b.dataset.p; loadList(); }));
}

/** v4.6.2: 主页「我的」范围 — 复用 /api/me/clips，含私有，支持置顶 */
async function loadHomeMine() {
  const box = $('#clipList');
  box.innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div></div>';
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  params.set('sort', 'updated');
  params.set('limit', '200');
  const { ok, data } = await api('/api/me/clips?' + params.toString());
  if (!ok || !data) { box.innerHTML = emptyHTML('clips', '加载失败', '<button class="btn btn-sm" onclick="loadList()">重试</button>'); $('#pager').innerHTML = ''; return; }
  const me = state.me || {};
  const clips = (data.clips || []).map((c) => Object.assign({ __canPin: true, owner_type: 'user', owner_id: me.userId || me.id, owner_name: me.name }, c));
  if (!clips.length) {
    box.innerHTML = state.q
      ? emptyHTML('search', `没有匹配「${esc(state.q)}」的剪贴板`, '<button class="btn btn-sm" onclick="document.getElementById(\'searchInput\').value=\'\';state.q=\'\';loadList()">清除搜索</button>')
      : emptyHTML('clips', '你还没有剪贴板', '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 创建第一个</a>');
    $('#pager').innerHTML = ''; return;
  }
  box.innerHTML = clips.map(clipCard).join('');
  $('#pager').innerHTML = `<span class="muted">共 ${data.total || clips.length} 条（含私有）</span>`;
}

// ==================== 详情（含评论 + 登录门禁） ====================
async function renderClip(clipId, pwd = '') {
  track('clip.view', clipId, ''); // M3 埋点（旁路）
  showView('clip'); $('#clipArticle').classList.add('hidden');
  $('#clipGate').innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div><div class="sk-line sk-meta"></div></div>';
  $('#clipTools').innerHTML = '';
  $('#commentSection').innerHTML = '';

  const q = pwd ? `?pwd=${encodeURIComponent(pwd)}` : '';
  let ok, status, data;
  try { ({ ok, status, data } = await api(`/api/clips/${encodeURIComponent(clipId)}${q}`)); }
  catch { ok = false; status = 0; data = null; } // 网络异常

  if (status === 404) return showView('404');
  if (status === 410) {
    $('#clipGate').innerHTML = emptyHTML('gate', '这个剪贴板已失效', `<p class="muted" style="margin:0">${data?.reason === 'expired' ? '已超过设定的过期时间' : data?.reason === 'reader_limit_reached' ? '已达到读者人数上限' : '已达到阅读次数上限'}</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`);
    return;
  }
  // v4.0: 登录门禁
  if (status === 401 && data?.error === 'login_required') {
    $('#clipGate').innerHTML = `<div class="gate login-gate">
      <h2>🔒 ${esc(data.title || '受保护的剪贴板')}</h2>
      <p class="muted">作者设置了仅<b>登录用户</b>可查看此内容。</p>
      <p>登录后即可访问全部内容，还能创建自己的剪贴板。</p>
      <a class="btn btn-primary" href="/api/auth/login">🔑 立即登录</a>
    </div>`;
    return;
  }
  if (status === 401 && data?.error === 'password_required') return passwordGate(clipId, data.title, '');
  if (status === 403 && data?.error === 'password_wrong') return passwordGate(clipId, '', '密码不对，再试一次');
  // 服务器错误 / 网络异常：明确区分于「找不到」，提供重试
  if (!ok || !data) {
    if (status === 0 || status >= 500) {
      $('#clipGate').innerHTML = `<div class="empty big"><h2>⚠️ 加载出错</h2><p class="muted">服务器开小差了，不是内容不存在，请重试。</p><button class="btn btn-primary" id="clipRetryBtn">重试</button></div>`;
      const rb = $('#clipRetryBtn'); if (rb) rb.onclick = () => renderClip(clipId, pwd);
      return;
    }
    return showView('404');
  }

  $('#clipGate').innerHTML = ''; $('#clipArticle').classList.remove('hidden');
  $('#clipTitle').textContent = data.title || '无标题'; renderMd($('#clipContent'), data.content);

  // 作者信息（含 VIP badge）
  const a = $('#clipAuthor');
  $('#clipAvatar').outerHTML = avatarHtml('', data.owner_name).replace('class="avatar', 'id="clipAvatar" class="avatar');
  const __an = $('#clipAuthorName');
  __an.textContent = data.owner_name || '游客';
  // v4.8.2: 用户名后的身份 tag（先清旧，避免重复渲染叠加）
  const __oldTag = __an.parentNode.querySelector('.owner-tag');
  if (__oldTag) __oldTag.remove();
  if (data.owner_type === 'user') __an.insertAdjacentHTML('afterend', ownerBadge(data.owner_role, data.owner_is_vip, data.owner_vip_until));
  if (data.owner_type === 'user') { a.href = '/u/' + data.owner_id; a.setAttribute('data-link', ''); a.classList.remove('no-link'); }
  else { a.href = 'javascript:void(0)'; a.removeAttribute('data-link'); a.classList.add('no-link'); }

  $('#clipMeta').textContent = `${timeAgo(data.created_at)}发布${data.updated_at !== data.created_at ? ' · 已编辑' : ''} · 👁 ${data.views}${data.reader_count ? ` · 👥 ${data.reader_count} 人读过` : ''}`;

  const badges = [];
  if (data.editable_by_anyone) badges.push('<span class="badge badge-collab">🤝 任何人可编辑</span>');
  if (data.has_password) badges.push('<span class="badge badge-lock">🔒 密码保护</span>');
  if (data.expires_at) badges.push(`<span class="badge badge-time">⏳ ${esc(expiryText(data.expires_at))}</span>`);
  if (data.max_views > 0) badges.push(`<span class="badge badge-eye">👁 ${data.views}/${data.max_views} 次</span>`);
  if (data.max_readers > 0) badges.push(`<span class="badge badge-reader">👥 ${data.reader_count || 0}/${data.max_readers} 人</span>`);
  if (data.login_required) badges.push('<span class="badge badge-login">🔒 登录可见</span>');
  if (!data.is_public) badges.push('<span class="badge">🙈 未公开</span>');
  // v4.7.5 反馈 #5：查看页也显示标签（点击跳首页按标签搜索）
  const vTags = Array.isArray(data.tags) ? data.tags : [];
  if (vTags.length) {
    badges.push(`<span class="card-tags" style="padding:0;display:inline-flex;gap:5px;flex-wrap:wrap">${vTags.map((t) => `<a class="tag-chip" href="/?q=${encodeURIComponent(t)}" data-link">#${esc(t)}</a>`).join('')}</span>`);
  }
  $('#clipBadges').innerHTML = badges.join('');

  // 操作按钮
  $('#clipTools').innerHTML = `<button class="btn btn-sm" id="outlineBtn">📑 目录</button>`;
  if (data.can_edit) {
    $('#clipTools').innerHTML += `<a class="btn btn-sm" href="/edit/${esc(data.clip_id)}" data-link>✏️ 编辑</a><button class="btn btn-sm btn-danger" id="delBtn">🗑 删除</button>`;
    $('#delBtn').onclick = async () => { if (!confirm('确定删除？')) return; const r = await api(`/api/clips/${encodeURIComponent(data.clip_id)}`, { method: 'DELETE' }); if (r.ok) { toast('已删除'); go('/'); } else toast('删除失败：' + (r.data?.error || r.status), 'err'); };
  }
  // v4.13: 举报入口（仅登录用户可见）
  if (state.me?.type === 'user') {
    $('#clipTools').innerHTML += `<button class="btn btn-sm" id="reportBtn" style="border-color:rgba(220,38,38,.4);color:#e0524f">⚠ 举报</button>`;
    $('#reportBtn').onclick = () => openReportModal(data.clip_id);
  }
  setupToc($('#outlineBtn'), $('#clipOutline'), $('#clipContent'));

  // 分享
  const url = location.origin + '/c/' + data.clip_id;
  $('#shareLink').value = url; $('#rawLink').href = '/raw/' + data.clip_id;
  $('#copyLinkBtn').onclick = () => copy(url, '链接已复制');
  $('#copyTextBtn').onclick = () => copy(data.content, '内容已复制');
  const qrBox = $('#qrBox'); qrBox.classList.add('hidden'); qrBox.innerHTML = '';
  $('#qrBtn').onclick = () => { qrBox.classList.toggle('hidden'); if (!qrBox.dataset.done && window.QRCode) { new QRCode(qrBox, { text: url, width: 148, height: 148, correctLevel: QRCode.CorrectLevel.M }); qrBox.dataset.done = '1'; } };

  // v4.0: 加载评论
  loadComments(clipId);
}

function passwordGate(clipId, title, err) {
  $('#clipArticle').classList.add('hidden');
  $('#clipGate').innerHTML = `<div class="gate"><h2>🔒 ${esc(title || '受保护的剪贴板')}</h2><p class="muted">这个剪贴板需要密码才能查看。</p>${err ? `<p class="err-text">${esc(err)}</p>` : ''}<div class="gate-row"><input id="gatePwd" class="input" type="password" placeholder="请输入访问密码" autofocus><button class="btn btn-primary" id="gateBtn">解锁</button></div></div>`;
  const submit = () => { const v = $('#gatePwd').value; if (v) renderClip(clipId, v); };
  $('#gateBtn').onclick = submit;
  $('#gatePwd').onkeydown = (e) => { if (e.isComposing || e.key !== 'Enter') return; submit(); };
}

// ==================== v4.0: 评论系统 ====================
let mentionState = { open: false, index: 0, items: [], target: null };

async function loadComments(clipId) {
  const box = $('#commentSection');
  if (!box) return;

  const isLoggedIn = state.me?.type === 'user';

  const { data } = await api(`/api/comments/${encodeURIComponent(clipId)}`);
  const comments = data?.comments || [];

  let html = `<div class="comments-wrap">
    <h3 class="comments-title">💬 评论 (${data?.total || 0})</h3>`;
  if (isLoggedIn) {
    html += `<div class="comment-input-row">
      <textarea id="commentInput" class="input comment-area" placeholder="写下你的评论…（支持 @mention 用户，50 等效字内）" maxlength="200" rows="2"></textarea>
      <div class="comment-input-foot">
        <span class="muted comment-char-count">0/50</span>
        <button class="btn btn-primary btn-sm" id="commentSubmitBtn">发送</button>
      </div>
    </div>`;
  } else {
    html += `<p class="muted" style="padding:6px 0 12px">登录后即可发表评论（支持 Markdown + @mention）</p>`;
  }
  html += `<div class="comment-list">`;

  if (!comments.length) {
    html += '<p class="muted" style="padding:12px 0">暂无评论，来说点什么吧～</p>';
  } else {
    for (const cm of comments) {
      const mine = isLoggedIn && String(cm.author_id) === String(state.me.userId);
      html += `<div class="comment-item" data-cid="${cm.id}">
        <div class="comment-avatar">${avatarHtml('', cm.author_name)}</div>
        <div class="comment-body">
          <div class="comment-meta"><strong>${esc(cm.author_name)}</strong><span class="muted">· ${timeAgo(cm.created_at)}</span>${mine ? `<button class="comment-del" data-del="${cm.id}" title="删除">🗑</button>` : ''}</div>
          <div class="comment-content">${md(cm.content)}</div>
        </div>
      </div>`;
    }
  }

  html += '</div></div>';
  box.innerHTML = html;

  // 评论输入事件
  const input = $('#commentInput');
  const charCountEl = box.querySelector('.comment-char-count');
  if (input) {
    input.oninput = () => { const cc = countChars(input.value); charCountEl.textContent = `${cc}/50`; charCountEl.style.color = cc > 50 ? 'var(--danger)' : ''; };
    attachMention(input);
  }

  const submitBtn = $('#commentSubmitBtn');
  if (submitBtn) submitBtn.onclick = async () => {
    const val = (input?.value || '').trim();
    if (!val) return toast('评论不能为空', 'err');
    if (countChars(val) > 50) return toast('评论过长（50 等效字）', 'err');
    submitBtn.disabled = true; submitBtn.textContent = '发送中…';
    const r = await api(`/api/comments/${encodeURIComponent(clipId)}`, { method: 'POST', body: JSON.stringify({ content: val }) });
    submitBtn.disabled = false; submitBtn.textContent = '发送';
    if (r.ok) { toast('评论已发布'); loadComments(clipId); }
    else toast(r.data?.message || '发送失败：' + (r.data?.error || r.status), 'err');
  };

  // 删除自己的评论
  box.querySelectorAll('.comment-del').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('确定删除这条评论？')) return;
      btn.disabled = true;
      const r = await api(`/api/comments/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
      if (r.ok) { toast('已删除'); loadComments(clipId); }
      else toast(r.data?.error || '删除失败', 'err');
    };
  });
}

// ============ @mention 自动补全（评论框 + 主编辑器共用） ============
/** 给任意 textarea 绑定 @ 触发 + 键盘导航 */
function attachMention(textarea) {
  if (!textarea || textarea._mentionAttached) return; textarea._mentionAttached = true;
  textarea.addEventListener('keydown', (e) => {
    if (mentionState.open && mentionState.target === textarea) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMention(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveMention(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { if (mentionState.items.length) { e.preventDefault(); chooseMention(mentionState.index); } return; }
      if (e.key === 'Escape') { e.preventDefault(); hideMentionPopup(); return; }
    }
    if (e.key === '@') { mentionState.target = textarea; openMentionAt(textarea); }
  });
  textarea.addEventListener('input', () => { if (mentionState.open && mentionState.target === textarea) refreshMentionQuery(textarea); });
  textarea.addEventListener('blur', () => setTimeout(() => { if (mentionState.target === textarea) hideMentionPopup(); }, 200));
}

function openMentionAt(textarea) {
  let popup = $('#mentionPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'mentionPopup'; popup.className = 'mention-popup hidden'; document.body.appendChild(popup); }
  positionMention(textarea);
  popup.classList.remove('hidden'); mentionState.open = true;
  refreshMentionQuery(textarea);
}
function positionMention(textarea) {
  const popup = $('#mentionPopup'); if (!popup) return;
  const rect = textarea.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  popup.style.maxHeight = Math.min(220, Math.max(120, rect.top - 8)) + 'px';
}
function refreshMentionQuery(textarea) {
  const pos = textarea.selectionStart;
  const before = textarea.value.slice(0, pos);
  const m = before.match(/@([A-Za-z0-9_一-龥]{0,20})$/);
  if (!m) { hideMentionPopup(); return; }
  const q = m[1];
  mentionState.open = true;
  const popup = $('#mentionPopup'); if (!popup) return;
  if (q.length < 1) { popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">输入用户名搜索…</div>'; mentionState.items = []; mentionState.index = 0; return; }
  searchMentionUsers(q);
}
function moveMention(dir) {
  const n = mentionState.items.length; if (!n) return;
  mentionState.index = (mentionState.index + dir + n) % n;
  const popup = $('#mentionPopup'); if (!popup) return;
  popup.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('active', i === mentionState.index));
  const active = popup.querySelector('.mention-item.active'); if (active) active.scrollIntoView({ block: 'nearest' });
}
function chooseMention(i) { const item = mentionState.items[i]; if (!item) return; insertMention(item.username, item.display_name); }

async function searchMentionUsers(q) {
  const popup = $('#mentionPopup'); if (!popup) return;
  popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">搜索中…</div>';
  const { data } = await api(`/api/search/users?q=${encodeURIComponent(q)}`);
  if (!mentionState.open) return;
  mentionState.items = data?.users || []; mentionState.index = 0;
  if (!mentionState.items.length) { popup.innerHTML = '<div class="muted" style="padding:6px 10px;font-size:12px">未找到匹配的用户</div>'; return; }
  popup.innerHTML = mentionState.items.map((u, i) =>
    `<div class="mention-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="mention-name">@${esc(u.display_name || u.username)}</span><span class="mention-handle">@${esc(u.username)}</span></div>`
  ).join('');
  popup.querySelectorAll('.mention-item').forEach((el, i) => {
    el.onclick = () => chooseMention(i);
    el.onmouseenter = () => { popup.querySelectorAll('.mention-item').forEach(e => e.classList.remove('active')); el.classList.add('active'); mentionState.index = i; };
  });
}

function insertMention(username, displayName) {
  const ta = mentionState.target; if (!ta) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos).replace(/@[A-Za-z0-9_一-龥]*$/, '');
  const after = ta.value.slice(pos);
  ta.value = before + '@' + username + ' ' + after;
  const np = before.length + username.length + 2;
  ta.focus(); ta.setSelectionRange(np, np);
  hideMentionPopup();
  ta.dispatchEvent(new Event('input'));
}

function hideMentionPopup() { const p = $('#mentionPopup'); if (p) p.classList.add('hidden'); mentionState.open = false; }

// ==================== 用户主页（扩展：VIP/邀请/功能状态） ====================
const PERM_LABELS = { delete_user: '删除用户账号', set_clip_limit: '设置剪贴板限制', edit_pages: '编辑站点文章', edit_public_clips: '修改公开剪贴板', edit_private_clips: '修改私有剪贴板', view_code: '查看源码（只读）', edit_code: '编辑并提交代码' };
const FEATURE_LABELS = { custom_slug: '自定义短链', max_views: '阅读次数上限', password: '密码保护', expiry: '定时过期', collaboration: '协作模式', login_required: '登录可见', max_readers: '读者数限制', comments: '评论功能' };
const ALL_PERMS = ['delete_user', 'set_clip_limit', 'edit_pages', 'edit_public_clips', 'edit_private_clips', 'view_code', 'edit_code'];

function promptAdminPermsDialog() {
  const keys = Object.keys(PERM_LABELS); const checked = keys.map(k => k + ':1').join('\n');
  const input = prompt(`设置管理员权限（每行一个，格式：权限名 0/1）\n\n${keys.map(k => `${k} [${PERM_LABELS[k]}]`).join('\n')}\n\n示例（全部允许）：\n${checked}`, checked);
  if (input === null) return null;
  const perms = {};
  for (const line of input.split('\n')) { const m = line.trim().match(/^(\w+)\s*[=:]\s*([01])$/); if (m && PERM_LABELS[m[1]]) perms[m[1]] = m[2] === '1'; }
  return perms;
}

// ========== 通用弹窗（替代裸 prompt，提升后台操作友好度） ==========
function openModal(title, bodyHtml) {
  let ov = $('#modalOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'modalOverlay'; ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h3 id="modalTitle"></h3><button class="modal-close" id="modalClose" aria-label="关闭">✕</button></div>
      <div class="modal-body" id="modalBody"></div>
      <div class="modal-foot" id="modalFoot"></div></div>`;
    document.body.appendChild(ov);
    ov.onclick = (e) => { if (e.target === ov) closeModal(); };
    $('#modalClose').onclick = closeModal;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('show')) closeModal(); });
  }
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalFoot').innerHTML = '';
  ov.classList.add('show');
  return { body: $('#modalBody'), foot: $('#modalFoot') };
}
function closeModal() { const ov = $('#modalOverlay'); if (ov) ov.classList.remove('show'); }

// 册封管理员：勾选权限的弹窗，返回 Promise<perms|null>
function openPermsModal(displayName) {
  return new Promise((resolve) => {
    const body = `<p class="muted" style="margin:0 0 8px">为 <b>${esc(displayName)}</b> 设置管理员权限（可多选）：</p>
      <div class="ff-grid">${ALL_PERMS.map((p) => `<label class="ff-item ${p === 'view_code' ? 'ff-view' : p === 'edit_code' ? 'ff-edit' : ''}"><input type="checkbox" data-perm="${p}" checked> <span>${PERM_LABELS[p] || p}</span></label>`).join('')}</div>`;
    const m = openModal('册封管理员', body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="promCancel">取消</button><button class="btn btn-sm btn-primary" id="promSave">确认册封</button>`;
    m.foot.querySelector('#promCancel').onclick = () => { closeModal(); resolve(null); };
    m.foot.querySelector('#promSave').onclick = () => {
      const perms = {}; m.body.querySelectorAll('[data-perm]').forEach((c) => { perms[c.dataset.perm] = c.checked; });
      closeModal(); resolve(perms);
    };
  });
}

// 各竞赛平台品牌色 + 主页 URL 模板（链接指向平台个人页，新标签打开）
const PLATFORM_META = {
  luogu:      { name: '洛谷', color: '#1a7feb', url: (a) => `https://www.luogu.com.cn/user/${esc(String(a.platformUid || ''))}` },
  codeforces: { name: 'Codeforces', color: '#3f8cff', url: (a) => `https://codeforces.com/profile/${esc(String(a.platformUsername || ''))}` },
  atcoder:    { name: 'AtCoder', color: '#2b2b2b', url: (a) => `https://atcoder.jp/users/${esc(String(a.platformUsername || ''))}` },
  github:     { name: 'GitHub', color: '#24292f', url: (a) => `https://github.com/${esc(String(a.platformUsername || ''))}` },
  google:     { name: 'Google', color: '#ea4335', url: () => '' },
  clist:      { name: 'Clist', color: '#7c3aed', url: (a) => `https://clist.by/user/${esc(String(a.platformUsername || ''))}/` }
};

/** 关联账号 → 可点击品牌卡片网格；self=true 且无绑定时给空态提示 */
function linkedAccountChips(list, self) {
  if (!list || !list.length) {
    if (self) return `<div class="linked-empty">未关联竞赛账号</div>`;
    return '';
  }
  const cards = list.map((a) => {
    const meta = PLATFORM_META[a.platform] || { name: a.platform, color: 'var(--primary)', url: () => '' };
    const handle = a.platformUsername || a.platformUid || '';
    const inner = `<span class="lc-name" style="color:${meta.color}">${esc(meta.name)}</span><span class="lc-handle">@${esc(String(handle))}</span>`;
    const href = meta.url(a);
    return href
      ? `<a class="linked-card" href="${href}" target="_blank" rel="noopener" style="--lc:${meta.color}">${inner}</a>`
      : `<span class="linked-card" style="--lc:${meta.color}">${inner}</span>`;
  }).join('');
  return `<div class="linked-cards">${cards}</div>`;
}

/** v4.0: 功能开关标签展示 */
function featureFlagBadges(flags) {
  if (!flags) return '';
  return Object.entries(flags).map(([k, v]) => {
    const label = FEATURE_LABELS[k] || k;
    return v ? `<span class="badge" style="background:var(--primary-soft);color:var(--primary);border-color:color-mix(in srgb,var(--primary) 30%,var(--border))">${label}</span>` : `<span class="badge" style="opacity:.5;text-decoration:line-through">${label}</span>`;
  }).join(' ');
}

// 信任等级徽章（Discourse 风：L0–L3）
function trustBadge(tl) {
  const labels = ['新手上路', '常驻用户', '活跃用户', '核心用户'];
  const t = Math.max(0, Math.min(3, tl || 0));
  return `<span class="badge badge-trust tl-${t}" title="信任等级 L${t}">🛡 ${labels[t]} · L${t}</span>`;
}
// 成就徽章（从现有数据派生，无需额外存储）
function userBadges(u) {
  if (!u) return '';
  const b = [];
  if (u.cpoauth_bound) b.push('<span class="badge badge-ach">🔗 已连 cpoauth</span>');
  if (u.has_password && u.cpoauth_bound) b.push('<span class="badge badge-ach">🔒 双保险登录</span>');
  else if (u.has_password) b.push('<span class="badge badge-ach">🔑 密码登录</span>');
  if (u.is_vip) b.push('<span class="badge badge-vip">⭐ VIP</span>');
  const clips = u.clip_count || 0;
  if (clips >= 10) b.push('<span class="badge badge-ach">📋 剪贴板达人</span>');
  if ((u.invite_count || 0) >= 1) b.push('<span class="badge badge-ach">🎁 邀请达人</span>');
  if (u.role === 'admin' || u.role === 'developer') b.push('<span class="badge badge-ach">🛡 管理员</span>');
  return b.length ? `<div class="badge-row badges-row">${b.join('')}</div>` : '';
}
// 是否应展示竞赛名片：已绑 cpoauth 且有关联的竞赛账号（避免空占位卡满天飞）
function hasCpCard(u) {
  return !!(u && u.cpoauth_bound && Array.isArray(u.linked_accounts) && u.linked_accounts.length);
}
// 战绩概览：cpoauth 竞赛名片（公开 SVG，无需 token；随站点主题切换）
function cpCardHtml(username) {
  if (!username) return '';
  const dark = document.documentElement.dataset.theme === 'dark';
  const u = encodeURIComponent(username);
  return `<img class="cp-card-img" src="https://www.cpoauth.com/api/users/${u}/card.svg?theme=${dark ? 'dark' : 'light'}&lang=zh" alt="竞赛战绩名片" loading="lazy" onerror="this.style.display='none'">`;
}

async function renderUser(uid) {
  showView('user'); $('#profile').innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div></div>';
  const { ok, data } = await api('/api/users/' + encodeURIComponent(uid));
  if (!ok || !data?.user) { $('#profile').innerHTML = emptyHTML('me', '找不到这个用户', ''); $('#userClips').innerHTML = ''; return; }
  const u = data.user; const self = data.is_self; const adminView = data.is_admin_viewer;
  const linked = u.linked_accounts || [];
  const sigHtml = u.signature ? `<p class="user-signature">「${esc(u.signature)}」</p>` : '';
  const bioHtml = u.bio ? `<p class="bio">${esc(u.bio)}</p>` : '';

  // v4.0: VIP + 功能开关展示
  const vipBadge = u.is_vip ? ' <span class="badge badge-vip">⭐ VIP</span>' : '';
  const flagsHtml = self || adminView ? `<div class="feature-flags-row">${featureFlagBadges(u.feature_flags)}</div>` : '';

  const badgesHtml = userBadges(u);

  $('#profile').innerHTML = `<div class="profile-card">
    <div class="profile-top">
      ${avatarHtml(u.avatar, u.display_name)}
      <div class="profile-info">
        <h1 class="profile-name">${esc(u.display_name)} ${roleBadge(u.role, { is_vip: u.is_vip })}${vipBadge} ${trustBadge(u.trust_level || 0)}</h1>
        ${sigHtml}
        <p class="muted">@${esc(u.username)} · 加入于 ${esc((u.created_at || '').slice(0, 10))}</p>
        ${bioHtml}
        ${badgesHtml}
      </div>
      ${self ? `<button class="icon-btn profile-gear" id="userSettingsBtn" title="设置" aria-label="设置">⚙️</button>` : ''}
    </div>
    <div class="profile-stats"><span>📋 ${u.clip_count} 个剪贴板</span>${self ? '<span class="badge">这是你</span>' : ''}
      ${u.invite_code ? `<span>🎁 邀请码：<code class="card-id">${esc(u.invite_code)}</code></span>` : ''}
    </div>
    <div class="me-section">
      <h3 class="me-section-title">🏆 战绩概览</h3>
      <div id="userCpCard">${hasCpCard(u) ? cpCardHtml(u.username) : '<p class="muted">该用户暂未关联竞赛账号，无战绩展示。</p>'}</div>
    </div>
    ${linkedAccountChips(linked, self)}
    ${linked.length || self ? `<div class="profile-actions">${self ? '<a class="btn btn-sm" href="https://www.cpoauth.com/profile" target="_blank" rel="noopener">🔗 关联账号管理（cpoauth）</a>' : ''}</div>` : ''}
    ${self ? `<div class="profile-wechat"><h4>扫一扫，添加我为好友</h4><img src="/wechat-qr.png" alt="WeChat QR" onerror="this.style.display='none'"></div>` : ''}
    ${self ? `<div class="invite-section"><details><summary>🎁 邀请好友</summary><div id="inviteInfo" class="invite-info">加载中…</div></details></div>` : ''}
      ${adminView && !self && u.role !== 'developer' ? `<div class="admin-user-actions">
          <b class="muted">管理操作：</b>
          ${u.role === 'admin' ? `<button class="btn btn-sm" data-role-act="user" data-uid="${u.id}">撤下管理</button>` : `<button class="btn btn-sm btn-primary" data-role-act="admin" data-uid="${u.id}">册封管理</button>`}
          <button class="btn btn-sm btn-warn" data-limit-uid="${u.id}" title="设置剪贴板数量限制">⚖️ 限制</button>
          <button class="btn btn-sm" style="background:rgba(255,215,0,.12);color:#b8860b;border-color:rgba(255,215,0,.3)" data-vip-uid="${u.id}" title="设置 VIP">⭐ VIP</button>
          <button class="btn btn-sm" data-feature-uid="${u.id}" title="功能开关">⚙️ 功能</button>
          <button class="btn btn-sm btn-danger" data-del-user="${u.id}">删除账号</button>
        </div>` : ''}
    </div></div>`;

  if (self) {
    const userSettingsBtn = $('#userSettingsBtn'); if (userSettingsBtn) userSettingsBtn.onclick = openSettingsModal;
    loadInviteInfo();
  }

  // 管理员操作
  $$('#profile [data-role-act]').forEach((b) => {
    b.onclick = async () => {
      const role = b.dataset.roleAct;
      if (role === 'admin') { const perms = await openPermsModal(u.display_name); if (!perms) return; const r = await api('/api/admin/users/' + b.dataset.uid, { method: 'PATCH', body: JSON.stringify({ role, admin_permissions: perms }) }); if (r.ok) { toast('已册封'); renderUser(uid); } else toast('失败：' + (r.data?.message || r.status), 'err'); }
      else { if (!confirm(role === 'admin' ? '确认册封？' : '确认撤下？')) return; const r = await api('/api/admin/users/' + b.dataset.uid, { method: 'PATCH', body: JSON.stringify({ role }) }); if (r.ok) { toast('已更新'); renderUser(uid); } else toast('失败：' + (r.data?.error || r.status), 'err'); }
    };
  });

  const limitBtn = $('#profile [data-limit-uid]');
  if (limitBtn) limitBtn.onclick = () => { const uid = limitBtn.dataset.limitUid; const currentLimit = data.user.clip_limit || ''; const currentPeriod = data.user.limit_period || 'forever'; const limitVal = prompt(`设置该用户的剪贴板数量限制\n当前：${currentLimit ? currentLimit + ' 个/' + currentPeriod : '不限量'}\n\n输入最大数量（数字），留空或 0 = 不限量：`, currentLimit || ''); if (limitVal === null) return; const num = parseInt(limitVal) || 0; if (num > 0) { const period = prompt('限制周期？\n输入：month / week / year / forever', currentPeriod || 'month'); if (!period) return; if (!['month','week','year','forever'].includes(period)) { alert('周期必须是 month/week/year/forever'); return; } api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ clip_limit: num, limit_period: period }) }).then((r) => { if (r.ok) { toast('限制已设置'); renderUser(uid); } else toast('失败：' + (r.data?.error || r.status), 'err'); }); } else { api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ clip_limit: null, limit_period: null }) }).then((r) => { if (r.ok) { toast('已取消限制'); renderUser(uid); } else toast('失败', 'err'); }); } };

  // v4.0: VIP 设置
  const vipBtn = $('#profile [data-vip-uid]');
  if (vipBtn) vipBtn.onclick = () => { const uid = vipBtn.dataset.vipUid; const val = confirm('确定为该用户开通 VIP？\n\n取消 VIP 选择「取消」。'); api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ is_vip: val ? 1 : 0 }) }).then((r) => { if (r.ok) { toast(val ? '已开通 VIP' : '已取消 VIP'); renderUser(uid); } else toast('失败', 'err'); }); };

  // v4.0: 功能开关设置
  const featBtn = $('#profile [data-feature-uid]');
  if (featBtn) featBtn.onclick = () => { const uid = featBtn.dataset.featureUid; const current = data.user.feature_flags || {}; const input = prompt(`功能开关（每行：功能名 0/1，1=开启）\n\n${Object.entries(FEATURE_LABELS).map(([k,l])=>`${k} [${l}] ${current[k]?1:0}`).join('\n')}\n\n当前值如上，直接改数字即可：`, Object.entries(FEATURE_LABELS).map(([k]) => `${k}:${current[k]?1:0}`).join('\n')); if (input === null) return; const ff = {}; for (const line of input.split('\n')) { const m = line.trim().match(/^(\w+)\s*[=:]\s*([01])$/); if (m && FEATURE_LABELS[m[1]]) ff[m[1]] = m[2] === '1'; } api('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ feature_flags: ff }) }).then((r) => { if (r.ok) { toast('功能开关已更新'); renderUser(uid); } else toast('失败', 'err'); }); };

  const delBtn = $('#profile [data-del-user]');
  if (delBtn) delBtn.onclick = async () => { if (!confirm('⚠️ 确认删除？不可恢复。')) return; const r = await api('/api/admin/users/' + delBtn.dataset.delUser, { method: 'DELETE' }); if (r.ok) { toast('账号已删除'); go('/'); } else toast('失败：' + (r.data?.message || r.status), 'err'); };

  $('#userClipsTitle').textContent = (self ? '你' : esc(u.display_name)) + ' 的剪贴板';
  $('#userClips').innerHTML = data.clips.length ? data.clips.map((c) => clipCard(Object.assign({ owner_type: 'user', owner_id: u.id }, c))).join('') : emptyHTML('me', adminView ? '该用户还没有剪贴板' : 'Ta 还没有公开的剪贴板', '');
}

// ==================== v4.0: 邀请信息加载 ====================
async function loadInviteInfo() {
  const box = $('#inviteInfo'); if (!box) return;
  const { data } = await api('/api/invite/me');
  if (!data) { box.innerHTML = '<p class="muted">加载失败</p>'; return; }

  box.innerHTML = `
    <div class="invite-card">
      <p><b>你的邀请码：</b><code class="card-id">${esc(data.invite_code)}</code>
        <button class="btn btn-sm btn-ghost" id="copyInviteCodeBtn">复制</button></p>
      <p><b>邀请链接：</b><input class="input input-sm" id="inviteLinkInput" value="${esc(data.invite_link)}" readonly>
        <button class="btn btn-sm btn-primary" id="copyInviteLinkBtn">复制链接</button></p>
      <div class="invite-stats">
        <span>📤 已邀请 <b>${data.invite_count}</b> 人</span>
        <span>📥 被邀请 <b>${data.invited_count}</b> 人首次注册</span>
      </div>
      <div class="invite-rewards">
        <h4>🎁 邀请奖励</h4>
        <ul>
          <li>邀请 <b>1</b> 人 → 开放所有高级功能</li>
          <li>邀请 <b>3</b> 人 → 开通 <b>VIP</b></li>
          <li>邀请 <b>5</b> 人 → 不限字数 + 置顶权限</li>
          <li>邀请 <b>10</b> 人 → 开发者大礼包 🎁</li>
        </ul>
      </div>
      ${data.vip_contact ? `<div class="vip-contact">💡 ${data.vip_contact}</div>` : ''}
    </div>`;

  $('#copyInviteCodeBtn').onclick = () => copy(data.invite_code, '邀请码已复制');
  $('#copyInviteLinkBtn').onclick = () => { copy(data.invite_link, '邀请链接已复制'); $('#inviteLinkInput').select(); };
}

/** 邀请落地页（/invite/:code） */
async function renderInviteLanding(code) {
  showView('home'); // 复用首页布局
  const { data } = await api(`/api/invite/${encodeURIComponent(code)}`);
  const hero = $('.hero');
  if (!hero) return;

  if (!data?.valid) {
    hero.innerHTML = `<h1>❌ 邀请无效</h1><p class="hero-sub">此邀请码不存在或已被使用。</p><a class="btn btn-primary" href="/" data-link>返回首页</a>`;
    return;
  }

  hero.innerHTML = `
    <h1>🎁 你被 ${esc(data.inviter?.name || '一位用户')} 邀请加入 mdqp</h1>
    <p class="hero-sub">mdqp 是一个 Markdown 云剪贴板——粘上就走，拿链接就分享。<br>注册后你和邀请人都能获得奖励！</p>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
      <button class="btn btn-primary" id="inviteLoginBtn">🔑 注册 / 登录（接受邀请）</button>
      <a class="btn btn-ghost" href="/" data-link>先看看再说</a>
    </div>
    <div class="hero-stats" style="margin-top:24px">
      <span>📋 免登录可用</span><span>🔐 密码保护</span><span>🎁 邀请奖励</span>
    </div>`;

  // 清空列表区域
  $('#clipList').innerHTML = ''; $('#pager').innerHTML = '';
  // 接受邀请→打开注册弹窗（兼容 cpoauth 不可用）
  $('#inviteLoginBtn').onclick = () => openAuthModal('register');
  // 尝试自动绑定邀请（如果已登录）
  if (state.me?.type === 'user') bindInvite(code);
}

async function bindInvite(code) {
  const r = await api('/api/invite/bind', { method: 'POST', body: JSON.stringify({ code }) });
  if (r.ok) {
    const granted = r.data?.granted || [];
    if (granted.length) toast(`🎉 邀请绑定成功！获得：${granted.map(g => g.desc).join('、')}`);
    else toast('✅ 邀请绑定成功！');
  } else if (r.data?.error === 'cannot_invite_self') { toast('不能邀请自己哦'); }
  else if (r.data?.error === 'invalid_or_used') { toast('邀请码无效或已使用'); }
}

// ==================== 邀请中心（营销风格独立页） ====================
async function renderInvitePage() {
  showView('invite'); const box = $('#invitePageContent');
  if (state.me?.type !== 'user') { box.innerHTML = `<div class="marketing-page"><div class="mkt-hero"><h1>🎁 <span class="gold">邀请好友</span>，共赢奖励</h1><p class="sub">登录后即可获取你的专属邀请码和链接，分享给朋友，双方都能获得丰厚奖励！</p><div class="cta-row"><a class="btn btn-primary" href="/api/auth/login">🔑 立即登录</a></div></div></div>`; return; }

  box.innerHTML = '<div class="marketing-page"><div class="skeleton-card" style="height:200px"></div></div>';
  const { data } = await api('/api/invite/me');
  if (!data) { box.innerHTML = '<p class="muted">加载失败</p>'; return; }

  const rewards = data.rewards?.inviter || [];
  const tiers = [
    { num: '1', reward: '开放所有高级功能', cls: '' },
    { num: '3', reward: '开通 ⭐ VIP（永久）', cls: 'tier-gold' },
    { num: '5', reward: '不限字数 + 剪贴板置顶权限', cls: '' },
    { num: '10', reward: '开发者大礼包 🎁（加站长微信细谈）', cls: 'tier-diamond' }
  ];

  box.innerHTML = `
    <div class="marketing-page">
      <!-- Hero -->
      <div class="mkt-hero">
        <h1>🎁 <span class="gold">邀请好友</span>，共赢奖励</h1>
        <p class="sub">每邀请一位朋友注册 mdqp，你和朋友都能获得奖励。<br>邀请越多，福利越丰厚——甚至可以直接成为 VIP！</p>
        <div class="cta-row">
          <a class="btn btn-ghost" href="/me" data-link>← 返回个人中心</a>
          <a class="btn btn-primary" href="/vip" data-link>了解 VIP 特权 →</a>
        </div>
      </div>

      <!-- 邀请卡片 -->
      <div class="mkt-section invite-card">
        <h2>📨 你的专属邀请</h2>
        <p>分享以下链接或邀请码给你的朋友，他们通过链接<strong>首次注册/登录</strong>后，你们双方都会获得奖励。</p>
        <div class="invite-code-big">${esc(data.invite_code || '------')}</div>
        <input class="input invite-link-input" id="invitePageLink" value="${esc(data.invite_link || '')}" readonly>
        <div class="invite-btn-row">
          <button class="btn btn-primary btn-sm" id="invCopyLink">📋 复制链接</button>
          <button class="btn btn-sm" id="invCopyCode">🔤 复制邀请码</button>
        </div>
      </div>

      <!-- 奖励阶梯 -->
      <div class="mkt-section">
        <h2>🏆 邀请奖励阶梯</h2>
        <p>累计邀请人数达到以下目标，自动发放对应奖励（无需手动领取）。</p>
        <table class="tier-table">
          <thead><tr><th>邀请人数</th><th>获得奖励</th></tr></thead>
          <tbody>${tiers.map(t => `<tr class="${t.cls}"><td><span class="tier-num ${t.cls ? t.cls : ''}">${t.num}</span></td><td class="tier-reward">${t.reward}</td></tr>`).join('')}</tbody>
        </table>
        <p style="margin-top:14px;font-size:13px;color:var(--muted)">
          已邀请：<b>${data.invited_count || 0}</b> 人 · 当前累计：<b>${data.invite_count || 0}</b> 人
          ${data.is_vip ? ' · ✅ 你已是 VIP' : ''}
        </p>
      </div>

      <!-- 被邀请者奖励 -->
      <div class="mkt-section">
        <h2>🎁 被邀请者也能获得奖励</h2>
        <p>通过邀请链接注册的朋友，将自动获得以下特权：</p>
        <ul style="margin:10px 0 0 20px;line-height:2;color:var(--text);font-size:14px">
          <li>✅ <b>自定义短链</b> — 用好记的短链代替随机 ID</li>
          <li>✅ <b>解锁更多高级功能</b>（由管理员配置）</li>
        </ul>
      </div>

      <!-- 微信联系 -->
      ${data.vip_contact ? `<div class="wechat-contact"><h3>💬 想了解更多？加站长微信</h3><p>${esc(data.vip_contact)}</p><div class="wechat-qr"><img src="/wechat-qr.png" alt="站长微信二维码" onerror="this.style.display='none'"></div></div>` : ''}
    </div>`;

  // 绑定复制按钮
  const copyLinkBtn = $('#invCopyLink');
  if (copyLinkBtn) copyLinkBtn.onclick = () => { copy(data.invite_link, '✅ 邀请链接已复制'); $('#invitePageLink').select(); };
  const copyCodeBtn = $('#invCopyCode');
  if (copyCodeBtn) copyCodeBtn.onclick = () => copy(data.invite_code, '✅ 邀请码已复制');
}

// ==================== VIP 页面（营销风格） ====================
async function renderVipPage() {
  showView('vip'); const box = $('#vipPageContent');
  const isVipUser = state.me?.is_vip;
  const isDev = state.me?.role === 'developer';
  const isAdmin = state.me?.role === 'admin' || isDev;

  box.innerHTML = `
    <div class="marketing-page">
      <div class="mkt-hero">
        <h1>⭐ <span class="gold">VIP</span> · 解锁全部潜力</h1>
        <p class="sub">成为 mdqp VIP，享受专属标识、优先支持与更多特权。<br>让你的剪贴板体验更上一层楼。</p>
        <div class="cta-row">
          <a class="btn btn-ghost" href="/" data-link>← 返回首页</a>
          <a class="btn btn-primary" href="/invite" data-link>免费邀请赚 VIP →</a>
        </div>
      </div>

      <!-- VIP 特权展示 -->
      <div class="mkt-section">
        <h2>💎 VIP 专属特权</h2>
        <div class="vip-grid">
          <div class="vip-feature-item"><div class="vip-feature-icon">⭐</div><h3>金色标识</h3><p>个人名片上闪耀的 VIP 金色徽章，彰显身份</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🚀</div><h3>无限可能</h3><p>不受普通用户的功能限制，自由使用全部能力</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🎯</div><h3>优先支持</h3><p>VIP 用户的问题和建议会被优先处理</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🎁</div><h3>未来新功能</h3><p>VIP 将自动解锁后续版本新增的高级特性</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">🏷️</div><h3>置顶权限</h3><p>邀请满 5 人后获管理员授予的不限字数+置顶</p></div>
          <div class="vip-feature-item"><div class="vip-feature-icon">👑</div><h3>社区认可</h3><p>在用户列表中突出显示，更容易被他人发现</p></div>
        </div>
      </div>

      <!-- 功能对比 -->
      <div class="mkt-section">
        <h2>📊 功能对比</h2>
        <table class="compare-table">
          <thead><tr><th>功能</th><th>普通用户</th><th class="compare-highlight">VIP</th></tr></thead>
          <tbody>
            <tr><td>每日创建上限</td><td>5 个</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>每月创建上限</td><td>50 个</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>字数限制</td><td>1500 字（L2 5000）</td><td class="compare-highlight"><b>无限制</b></td></tr>
            <tr><td>自定义短链</td><td>${isAdmin ? '<span class="compare-check">✅</span>' : '<span class="compare-cross">需邀请</span>'}</td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>密码保护</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>定时过期</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>评论功能</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>@提及</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>登录门禁</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>读者数限制</td><td><span class="compare-check">✅</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>⭐ 金色 VIP 标识</td><td><span class="compare-cross">—</span></td><td class="compare-highlight"><span class="compare-check">✅</span></td></tr>
            <tr><td>置顶权限</td><td><span class="compare-cross">—</span></td><td class="compare-highlight"><span class="compare-check">✅ 邀请 5 人</span></td></tr>
          </tbody>
        </table>
      </div>

      <!-- 如何获得 VIP -->
      <div class="mkt-section">
        <h2>🎯 如何获得 VIP？</h2>
        <ol style="margin:10px 0 0 22px;line-height:2.1;font-size:14px;color:var(--text)">
          <li><b>邀请 3 位朋友</b>注册 → 自动开通永久 VIP（推荐！）</li>
          <li><b>联系站长</b> → 微信扫码添加好友，说明来意即可开通</li>
        </ol>
      </div>

      <!-- 微信联系卡 -->
      <div class="wechat-contact">
        <h3>💬 扫码加站长微信，开通 VIP 或了解详情</h3>
        <p>备注 "mdqp VIP" 可优先通过</p>
        <div class="wechat-qr"><img src="/wechat-qr.png" alt="站长微信二维码" onerror="this.parentElement.innerHTML='<p style=\'color:rgba(255,255,255,.7)\'>二维码加载中…</p>'"></div>
      </div>
    </div>`;
}

// ==================== 我的（含配额显示） ====================
async function renderMe() {
  showView('me'); await loadMe(); const me = state.me;
  if (me.type === 'user') {
    const linked = me.linked_accounts || []; const sigHtml = me.signature ? `<p class="user-signature">「${esc(me.signature)}」</p>` : ''; const bioHtml = me.bio ? `<p class="bio">${esc(me.bio)}</p>` : '';
    const vipBadge = me.is_vip ? ' <span class="badge badge-vip">⭐ VIP</span>' : '';
    const badgesHtml = userBadges(Object.assign({ clip_count: (me.clips || []).length, cpoauth_bound: me.cpoauth_bound, has_password: me.has_password, is_vip: me.is_vip, invite_count: me.invite_count, role: me.role }, me));

    // v4.6: 配额显示（按权益分级，含「不限」）
    const quota = me.quota || {};
    const qFmt = (label, lim) => {
        if (lim === -1) return `<span>${label} <b>${quota.daily_used || 0}</b><span class="muted"> / 不限</span></span>`;
        return `<span>${label} <b>${quota.daily_used || 0}/${lim}</b></span>`;
      };
    const quotaHtml = `<div class="quota-bar">
      ${qFmt('今日', quota.daily_limit)}
      ${quota.monthly_limit === -1 ? `<span>本月 <b>${quota.monthly_used || 0}</b><span class="muted"> / 不限</span></span>` : `<span>本月 <b>${quota.monthly_used || 0}/${quota.monthly_limit}</b></span>`}
    </div>`;

    // v4.6: 权益矩阵小卡片（嵌在信任等级下方）
    const benefitsHtml = meBenefits(me);

    $('#meHead').innerHTML = `<div class="profile-card">
      <div class="profile-top">
        ${avatarHtml(me.avatar, me.name)}
        <div class="profile-info">
          <h1 class="profile-name">${esc(me.name)} ${roleBadge(me.role, { is_vip: me.is_vip })}${vipBadge} ${trustBadge(me.trust_level || 0)}</h1>
          ${sigHtml}
          <p class="muted">已登录 · 剪贴板有配额限制${me.role === 'developer' ? ' · 你是本站开发者' : me.role === 'admin' ? ' · 你是管理员' : ''}</p>
          ${bioHtml}
          ${badgesHtml}
        </div>
        <button class="icon-btn profile-gear" id="meSettingsBtn" title="设置" aria-label="设置">⚙️</button>
      </div>
      ${quotaHtml}
      ${benefitsHtml}
      <div class="me-section">
        <h3 class="me-section-title">🛡 信任等级</h3>
        <div id="meTrustProgress" class="sec-tl-progress"></div>
      </div>
      <div class="me-section">
        <h3 class="me-section-title">🏆 战绩概览</h3>
        <div id="meCpCard">${hasCpCard(me) ? cpCardHtml(me.username) : '<p class="muted">绑定 cpoauth 并关联竞赛账号后，这里会展示你的竞赛战绩名片。</p>'}</div>
        <div id="meCpSummary" class="cp-summary"></div>
      </div>
      ${linkedAccountChips(linked, true)}
      <div class="profile-stats">
        <a class="btn btn-sm" href="/u/${esc(me.userId)}" data-link>查看公开主页</a>
        <a class="btn btn-sm" href="/invite" data-link>🎁 邀请好友</a>
        <a class="btn btn-sm" href="/vip" data-link>⭐ VIP</a>
        <a class="btn btn-sm btn-primary" href="/new" data-link>＋ 新建</a>
      </div>
      <div class="profile-wechat"><h4>扫一扫，添加我为好友</h4><img src="/wechat-qr.png" alt="WeChat QR" onerror="this.style.display='none'"></div>
    </div></div>`;

    // 设置弹窗入口
    const meSettingsBtn = $('#meSettingsBtn'); if (meSettingsBtn) meSettingsBtn.onclick = openSettingsModal;
    // 信任等级进度（v4.5.2 维持制）
    renderTrustProgress($('#meTrustProgress'), me.trust_progress);
    // 战绩概览：详细战绩（cp:summary）暂无法使用，仅保留竞赛名片（card.svg）
    if (me.cpoauth_bound) {
      api('/api/me/cp-summary').then(({ data }) => {
        const box = $('#meCpSummary'); if (!box) return;
        if (data && data.available && data.data) box.innerHTML = renderCpSummary(data.data);
        else box.innerHTML = '<p class="muted cp-summary-hint">⚠️ 详细战绩（cp:summary）暂无法使用，等待更新。</p>';
      }).catch(() => {});
    }

    // v4.6: 我的剪贴板 2.0 — 搜索/排序/置顶/标签筛选（私有板也能搜到）
    initMyClipsTools();
    loadMyClips();
  } else {
    const left = Math.max(0, (me.limit || 5) - (me.count || 0));
    const period = me.period === 'weekly' ? '本周' : '';
    $('#meHead').innerHTML = `<div class="notice notice-warn">
      <b>你现在是游客模式</b>
      <p>已创建 ${me.count || 0} / ${me.limit || 5} 个（${period}），还能建 ${left} 个。游客剪贴板<b>任何人都能编辑或删除</b>。</p>
      <p><button class="btn btn-sm btn-primary" id="meGuestLoginBtn">🔑 登录 / 注册</button> 后日限 5 / 月限 50，且仅你可改自己的内容。</p></div>`;
    // 走统一弹窗而非直跳 cpoauth：第三方登录宕机时仍有密码入口
    const guestLogin = $('#meGuestLoginBtn'); if (guestLogin) guestLogin.onclick = () => openAuthModal('login');
    // 游客模式：不显示 2.0 工具条，按老逻辑渲染全部剪贴板
    const box = $('#meClipsTools'); if (box) box.classList.add('hidden');
    const clips = me.clips || [];
    $('#meClips').innerHTML = clips.length ? clips.map((c) => clipCard(Object.assign({ owner_type: me.type, owner_id: me.guestId, owner_name: '游客' }, c))).join('') : emptyHTML('me', '还没有剪贴板', '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 新建一个</a>');
  }
}

// v4.6: 「我的」权益矩阵展示
function meBenefits(me) {
  const list = me.benefits || [];
  if (!list.length) return '';
  const unlocks = me.next_level_unlock || [];
  const unlocksHtml = unlocks.length ? `<div class="me-unlocks muted">${esc(unlocks.join(' · '))}</div>` : '';
  const rows = list.map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(String(b.value))}</td></tr>`).join('');
  return `<div class="me-section">
    <h3 class="me-section-title">🎁 当前权益（L${me.trust_level || 0}${me.is_vip ? ' + VIP' : ''}）</h3>
    <table class="me-benefits"><tbody>${rows}</tbody></table>
    ${unlocksHtml}
  </div>`;
}

// v4.6: 我的剪贴板 2.0 — 工具条初始化（搜索 / 排序 / 置顶筛选 / 标签云）
function initMyClipsTools() {
  const tools = $('#meClipsTools'); if (!tools) return;
  tools.classList.remove('hidden');
  let qTimer = null;
  const qInput = $('#myClipsQ'); if (qInput && !qInput.dataset.bound) {
    qInput.dataset.bound = '1';
    qInput.oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => loadMyClips(), 250); };
  }
  const sortSel = $('#myClipsSort'); if (sortSel && !sortSel.dataset.bound) {
    sortSel.dataset.bound = '1';
    sortSel.onchange = () => loadMyClips();
  }
  const pinChk = $('#myClipsPinned'); if (pinChk && !pinChk.dataset.bound) {
    pinChk.dataset.bound = '1';
    pinChk.onchange = () => loadMyClips();
  }
  // 标签云点击筛选（由 clipCard 的 data-mytag 触发）
  window.__myTagFilter = (tag) => {
    state._myTag = tag;
    loadMyClips();
  };
  // 置顶按钮（PATCH /api/clips/:id/meta）
  window.__togglePin = async (clipId, nextState) => {
    try {
      const r = await api(`/api/clips/${encodeURIComponent(clipId)}/meta`, { method: 'PATCH', body: JSON.stringify({ pinned: nextState }) });
      if (!r.ok) return toast(r.data?.message || '操作失败', 'err');
      toast(nextState ? '已置顶' : '已取消置顶');
      // 在主页「我的」范围点置顶 → 刷主页列表；在 /me 页 → 刷我的列表
      if (state._view === 'home') loadList(); else loadMyClips();
    } catch { toast('网络错误，请重试', 'err'); }
  };
}

// v4.6: 我的剪贴板 2.0 — 拉取并渲染
async function loadMyClips() {
  const box = $('#meClips'); if (!box) return;
  const me = state.me || {};
  const params = new URLSearchParams();
  const q = $('#myClipsQ')?.value?.trim(); if (q) params.set('q', q);
  const sort = $('#myClipsSort')?.value || 'updated'; params.set('sort', sort);
  if ($('#myClipsPinned')?.checked) params.set('pinned', '1');
  if (state._myTag) params.set('tag', state._myTag);
  params.set('limit', '200');
  box.innerHTML = '<div class="skeleton-card"><div class="sk-line sk-title"></div><div class="sk-line sk-text"></div><div class="sk-line sk-text-short"></div></div>';
  let data;
  try {
    const r = await api('/api/me/clips?' + params.toString());
    if (!r.ok || !r.data) throw new Error(r.data?.message || '加载失败');
    data = r.data;
  } catch (e) { box.innerHTML = emptyHTML('me', '加载失败：' + esc(e.message), '<button class="btn btn-sm" onclick="loadMyClips()">重试</button>'); return; }
  const clips = (data.clips || []).map((c) => Object.assign({ __canPin: true, owner_type: 'user', owner_id: me.userId, owner_name: me.name }, c));
  if (!clips.length) {
    const empty = state._myTag ? `没有标签为「${esc(state._myTag)}」的剪贴板` : (q ? `没有匹配「${esc(q)}」的剪贴板` : '还没有剪贴板');
    const act = (q || state._myTag) ? '<button class="btn btn-sm" onclick="document.getElementById(\'myClipsQ\').value=\'\';state._myTag=null;loadMyClips()">清除筛选</button>' : '<a class="btn btn-primary btn-sm" href="/new" data-link>＋ 新建一个</a>';
    box.innerHTML = emptyHTML('me', empty, act);
  } else {
    box.innerHTML = clips.map(clipCard).join('');
  }
  // 元信息（总数 / 已匹配 / 当前标签）
  const meta = $('#myClipsMeta');
  if (meta) {
    const parts = [`共 ${data.total || clips.length} 条`, data.matched != null && data.matched !== data.total ? `（匹配 ${data.matched}）` : ''];
    if (state._myTag) parts.push(`<span>标签：<b>#${esc(state._myTag)}</b> <button class="btn-link" onclick="state._myTag=null;loadMyClips()">清除</button></span>`);
    meta.innerHTML = parts.filter(Boolean).join(' · ');
  }
  // 标签云
  const cloud = $('#myClipsTagCloud');
  if (cloud) {
    const tags = data.tags || [];
    if (tags.length) {
      cloud.classList.remove('hidden');
      cloud.innerHTML = tags.map((t) => `<a class="tag-chip ${state._myTag === t.name ? 'on' : ''}" href="#" onclick="event.preventDefault();window.__myTagFilter('${esc(t.name)}')">#${esc(t.name)} <span class="muted">${t.count}</span></a>`).join('');
    } else cloud.classList.add('hidden');
  }
}

// ==================== 站点页面 ====================
async function renderPage(slug) {
  if (slug === 'changelog') {
    showView('page'); $('#pageTitle').textContent = '📝 更新日志'; $('#pageMeta').textContent = 'mdqp 主要版本变动记录 · 随代码发布自动更新';
    const el = $('#pageContent'); el.className = 'markdown-body changelog'; renderMd(el, CHANGELOG_MD); $('#pageTools').innerHTML = ''; return;
  }
  showView('page'); $('#pageContent').className = 'markdown-body';
  const { ok, data } = await api('/api/pages/' + slug);
  if (!ok || !data?.page) { $('#pageTitle').textContent = slug === 'help' ? '使用帮助' : '关于'; $('#pageMeta').textContent = ''; $('#pageContent').innerHTML = emptyHTML('clips', '这个页面还不存在', ''); $('#pageTools').innerHTML = ''; return; }
  const p = data.page; $('#pageTitle').textContent = p.title || slug; $('#pageMeta').textContent = p.updated_at ? `更新于 ${esc(timeAgo(p.updated_at))}${p.updated_by ? ' · 由 ' + esc(p.updated_by) + ' 编辑' : ''}` : '';
  renderMd($('#pageContent'), p.content); $('#pageTools').innerHTML = isAdmin() ? `<a class="btn btn-sm" href="/edit-page/${esc(slug)}" data-link>✏️ 编辑此页</a><button class="btn btn-sm" id="pageOutlineBtn">📑 目录</button>` : '';
  const ob = $('#pageOutlineBtn'); if (ob) setupToc(ob, $('#pageOutline'), $('#pageContent'));
}

async function renderPageEditor(slug) {
  showView('edit'); await loadMe(); if (!isAdmin()) { toast('只有管理员能编辑站点页面', 'err'); return go('/' + slug, true); }
  state.editing = null; state.editingPage = slug; $('#guestNotice').classList.add('hidden'); $('#editorIdentity').textContent = '正在编辑站点页面 /' + slug; $('#edCollabWrap').classList.add('hidden'); $('#advBox').classList.add('hidden');
  const { ok, data } = await api('/api/pages/' + slug);
  if (ok && data?.page) { $('#edTitle').value = data.page.title || ''; $('#edContent').value = data.page.content || ''; }
  else { $('#edTitle').value = slug === 'help' ? '使用帮助' : '关于'; $('#edContent').value = ''; }
  $('#saveBtn').textContent = '💾 保存页面'; $('#saveBtn').disabled = false; updatePreview(); $('#edContent').oninput = updatePreview; $('#saveBtn').onclick = savePage; bindToolbar(); setupToc($('#tocToggle'), $('#edToc'), $('#edPreview'));
}
async function savePage() { const content = $('#edContent').value; if (!content.trim()) return toast('内容不能为空', 'err'); $('#saveBtn').disabled = true; $('#saveBtn').textContent = '保存中…'; try { const r = await api('/api/pages/' + encodeURIComponent(state.editingPage), { method: 'PUT', body: JSON.stringify({ title: $('#edTitle').value.trim(), content }) }); $('#saveBtn').disabled = false; $('#saveBtn').textContent = '💾 保存页面'; if (r.ok) { toast('页面已保存'); go('/' + state.editingPage); } else toast(r.data?.message || '保存失败：' + (r.data?.error || r.status), 'err'); } catch (e) { $('#saveBtn').disabled = false; $('#saveBtn').textContent = '💾 保存页面'; toast('网络错误，请检查连接后重试', 'err'); } }

// ==================== 管理后台（v4.0 扩展 tab） ====================
async function renderAdmin() {
  showView('admin'); await loadMe(); if (!isAdmin()) { $('#adminBox').innerHTML = emptyHTML('admin', '🚫 无权访问', `<p class="muted" style="margin:0">管理后台仅对站点管理员开放</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`); return; }
  $('#adminBox').innerHTML = `<h1 class="clip-title">🛡 管理后台</h1><p class="muted">${state.me.role === 'developer' ? '你是本站开发者，拥有一切权限。' : '你是管理员：可管理用户与所有剪贴板、编辑站点页面、发布公告、管理邀请/VIP/评论。'}</p>
    <div class="admin-tabs">
      <button class="btn btn-sm ${state.adminTab === 'users' ? 'btn-primary' : ''}" data-tab="users">👥 用户</button>
      <button class="btn btn-sm ${state.adminTab === 'clips' ? 'btn-primary' : ''}" data-tab="clips">📋 全部剪贴板</button>
      <button class="btn btn-sm ${state.adminTab === 'pages' ? 'btn-primary' : ''}" data-tab="pages">📄 站点页面</button>
      <button class="btn btn-sm ${state.adminTab === 'announcements' ? 'btn-primary' : ''}" data-tab="announcements">📢 公告</button>
      <button class="btn btn-sm ${state.adminTab === 'invites' ? 'btn-primary' : ''}" data-tab="invites">🎁 邀请</button>
      <button class="btn btn-sm ${state.adminTab === 'stats' ? 'btn-primary' : ''}" data-tab="stats">📊 数据看板</button>
      <button class="btn btn-sm ${state.adminTab === 'settings' ? 'btn-primary' : ''}" data-tab="settings">⚙️ 设置</button>
    </div><div id="adminBody"></div>`;
  $$('#adminBox [data-tab]').forEach((b) => { b.onclick = () => { state.adminTab = b.dataset.tab; renderAdmin(); }; });
  if (state.adminTab === 'users') return loadAdminUsers();
  if (state.adminTab === 'clips') return loadAdminClips();
  if (state.adminTab === 'pages') return loadAdminPages();
  if (state.adminTab === 'announcements') return loadAdminAnnouncements();
  if (state.adminTab === 'invites') return loadAdminInvites();
  if (state.adminTab === 'stats') return loadAdminStats();
  if (state.adminTab === 'settings') return loadAdminSettings();
}

// M3 埋点看板：读取 events 聚合数据（仅管理员可见）
async function loadAdminStats() {
  const box = $('#adminBody');
  box.innerHTML = '加载中…';
  const days = state.statsDays || 7;
  const [{ data }, srcRes] = await Promise.all([
    api('/api/admin/events/summary?days=' + days),
    api('/api/admin/users/source-stats')
  ]);
  if (!data?.ok) {
    return (box.innerHTML = emptyHTML('admin', '加载失败（需要管理员权限）', '<p class="muted" style="margin:0">若刚建表，暂无数据也属正常。</p>'));
  }

  const dayBtns = [1, 7, 30, 90]
    .map((d) => `<button class="btn btn-sm ${days === d ? 'btn-primary' : ''}" data-days="${d}">${d} 天</button>`)
    .join(' ');

  const typeRows = (data.by_type || [])
    .map((r) => `<tr><td><span class="badge badge-role" style="font-size:11px">${esc(r.app)}</span></td><td><code>${esc(r.type)}</code></td><td><b>${r.cnt}</b></td></tr>`)
    .join('');

  const dayRows = (data.by_day || [])
    .slice(-14)
    .map((r) => `<tr><td>${esc(r.d)}</td><td>${r.cnt}</td><td>${r.uv}</td></tr>`)
    .join('');

  // v4.10: 用户来源分布
  const dist = (srcRes?.data?.distribution || []);
  const total = srcRes?.data?.total || 0;
  const srcRows = dist.length
    ? dist.map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        const label = r.source === 'unset' ? '未填写' : (SOURCE_LABEL[r.source] || r.source);
        return `<tr><td>${esc(label)}</td><td><b>${r.count}</b></td><td class="muted">${pct}%</td></tr>`;
      }).join('')
    : '<tr><td colspan="3" class="muted">暂无数据</td></tr>';

  box.innerHTML = `<div class="list-head"><h2>📊 数据看板</h2><div>${dayBtns}</div></div>
    <p class="muted">近 ${days} 天：总事件 <b>${data.total}</b> · 活跃用户（去重）<b>${data.dau}</b></p>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>来源</th><th>事件</th><th>次数</th></tr></thead><tbody>${
      typeRows || '<tr><td colspan="3" class="muted">暂无数据</td></tr>'
    }</tbody></table></div>
    <div class="list-head"><h2>👥 用户来源分布（共 ${total} 人）</h2></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>来源渠道</th><th>人数</th><th>占比</th></tr></thead><tbody>${srcRows}</tbody></table></div>
    <div class="list-head"><h2>📈 每日趋势（最近 14 天）</h2></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>日期</th><th>事件数</th><th>活跃用户</th></tr></thead><tbody>${
      dayRows || '<tr><td colspan="3" class="muted">暂无数据</td></tr>'
    }</tbody></table></div>`;

  $$('#adminBody [data-days]').forEach((b) => {
    b.onclick = () => { state.statsDays = parseInt(b.dataset.days, 10); loadAdminStats(); };
  });
}

// M3 埋点上报（旁路：失败静默，绝不弹出错误影响用户）
function track(type, ref, meta) {
  try {
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'mdqp', type, ref: ref || '', meta: meta || '' })
    }).catch(() => {});
  } catch (e) { /* 静默 */ }
}

// v4.10: DAU 埋点。每会话只上报一次 page.view（服务端再按 uid 5 分钟去重）
function trackPageView() {
  try {
    if (sessionStorage.getItem('mdqp_pv')) return;
    sessionStorage.setItem('mdqp_pv', '1');
    let ref = '';
    try { if (document.referrer) ref = new URL(document.referrer).hostname; } catch (_) {}
    track('page.view', location.pathname + location.search, ref);
  } catch (e) { /* 静默 */ }
}

// v4.10: 用户来源渠道选项（与后端 SRC_OK 白名单保持一致）
const SOURCE_OPTIONS = [
  { code: 'offline',      label: '🤝 线下分享（同学/朋友推荐）' },
  { code: 'social',       label: '💬 社交平台分享（QQ/微信/贴吧/小红书等）' },
  { code: 'oj',           label: '🏆 OJ 分享（洛谷/Codeforces 等讨论区）' },
  { code: 'other_share',  label: '🔗 其他分享' },
  { code: 'random',       label: '🎲 随便点到的' },
  { code: 'ad',           label: '📢 看到广告' },
  { code: 'search',       label: '🔍 搜索引擎搜到' },
  { code: 'unknown',      label: '🙈 不方便说' }
];
const SOURCE_LABEL = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.code, o.label.replace(/^[^一-龥]+ /, '')]));
const SRC_SEEN_KEY = 'mdqp_src_ask_session';
const SRC_DEFER_KEY = 'mdqp_src_ask_defer';

// 首次登录后询问来源；已填写(source_set_at 非空)不再问；本会话关闭过不再问；累计关闭≥3次彻底不再问
function maybeAskSource() {
  try {
    const me = state.me;
    if (!me || me.type !== 'user') return;
    if (me.source_set_at) return;                       // 已填，不再提醒
    if (sessionStorage.getItem(SRC_SEEN_KEY)) return;   // 本会话已问过
    const defer = parseInt(localStorage.getItem(SRC_DEFER_KEY) || '0', 10);
    if (defer >= 3) return;                             // 反复跳过，放过用户
    showSourceModal();
  } catch (e) { /* 静默 */ }
}

function showSourceModal() {
  const needDetail = (code) => code === 'other_share' || code === 'social' || code === 'oj';
  const body = `<p class="muted" style="margin:0 0 10px">你是怎么知道 mdqp 的？答案仅用于改进产品（可随时在设置里修改）。</p>
    <div class="ff-grid" id="srcGrid">${SOURCE_OPTIONS.map((o) => `<button class="btn btn-sm src-opt" data-code="${o.code}">${o.label}</button>`).join('')}</div>
    <div id="srcDetailWrap" style="display:none;margin-top:10px">
      <input id="srcDetail" class="input input-sm" maxlength="100" placeholder="补充说明（可选，如具体平台/活动名称）">
    </div>`;
  const m = openModal('👋 欢迎使用 mdqp', body);
  const grid = m.body.querySelector('#srcGrid');
  const detailWrap = m.body.querySelector('#srcDetailWrap');
  const detailInput = m.body.querySelector('#srcDetail');
  let submitted = false;
  // 关闭（ESC / 点遮罩）且未提交 → 本会话不再问 + 累计 defer+1（≥3 后彻底不再问）
  const ov = $('#modalOverlay');
  const obs = new MutationObserver(() => {
    if (!ov.classList.contains('show')) {
      obs.disconnect();
      if (submitted) return;
      sessionStorage.setItem(SRC_SEEN_KEY, '1');
      const d = parseInt(localStorage.getItem(SRC_DEFER_KEY) || '0', 10) + 1;
      localStorage.setItem(SRC_DEFER_KEY, String(d));
    }
  });
  obs.observe(ov, { attributes: true, attributeFilter: ['class'] });

  // 预选当前已填来源（修改场景：不用从头选）
  const cur = state.me && state.me.source;
  if (cur && SOURCE_OPTIONS.some((o) => o.code === cur)) {
    const cb = grid.querySelector(`.src-opt[data-code="${cur}"]`);
    if (cb) cb.classList.add('btn-primary');
    if (needDetail(cur) && (state.me.source_detail || '')) {
      detailWrap.style.display = '';
      detailWrap.dataset.open = cur;
      detailInput.value = state.me.source_detail || '';
    }
  }

  grid.onclick = (e) => {
    const btn = e.target.closest('.src-opt'); if (!btn) return;
    const code = btn.dataset.code;
    if (needDetail(code)) {
      detailWrap.style.display = '';
      detailWrap.dataset.code = code;
      detailInput.focus();
      // 再次点击同一按钮（已展开）即提交
      if (detailWrap.dataset.open === code) { submit(code); }
      else { detailWrap.dataset.open = code; grid.querySelectorAll('.src-opt').forEach((b) => b.classList.toggle('btn-primary', b === btn)); }
    } else { submit(code); }
  };
  function submit(code) {
    submitted = true;
    const detail = (needDetail(code) ? (detailInput.value || '').trim() : '');
    api('/api/me', { method: 'PATCH', body: JSON.stringify({ source: code, source_detail: detail }) })
      .then(() => { if (state.me) { state.me.source = code; state.me.source_detail = detail; state.me.source_set_at = new Date().toISOString().slice(0, 19).replace('T', ' '); } })
      .catch(() => {});
    closeModal();
  }
}

const ADMIN_FULL_PERMS = ALL_PERMS.reduce((o, p) => (o[p] = true, o), {});

async function loadAdminUsers() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const f = {
    source: ($('#aufSource')?.value || '').trim(),
    activeDays: ($('#aufActive')?.value || '').trim(),
    minClips: ($('#aufMinClips')?.value || '').trim(),
    banned: ($('#aufBanned')?.value || '').trim(),
    sort: ($('#aufSort')?.value || 'id').trim(),
    order: ($('#aufOrder')?.value || 'asc').trim(),
    q: ($('#adminUserSearch')?.value || '').trim()
  };
  const qs = new URLSearchParams();
  if (f.source) qs.set('source', f.source);
  if (f.activeDays) qs.set('activeDays', f.activeDays);
  if (f.minClips) qs.set('minClips', f.minClips);
  if (f.banned) qs.set('banned', f.banned);
  if (f.sort) qs.set('sort', f.sort);
  if (f.order) qs.set('order', f.order);
  if (f.q) qs.set('q', f.q);
  const { data } = await api('/api/admin/users?' + qs.toString());
  if (!data?.users) return (box.innerHTML = emptyHTML('admin', '加载失败（需要管理员权限）', ''));
  const users = data.users;
  const srcOpts = `<option value="">来源:全部</option><option value="unset">未填写</option>${SOURCE_OPTIONS.map((o) => `<option value="${o.code}">${esc(o.label)}</option>`).join('')}`;
  const rows = users.map((u) => {
    const lvl = u.role === 'admin' ? Math.max(1, Math.min(5, Object.values(u.admin_permissions || {}).filter(Boolean).length)) : 0;
    const roleHtml = u.role === 'developer' ? roleBadge('developer') : u.role === 'admin' ? roleBadge('admin', { permLevel: lvl }) : '';
    const vipHtml = u.is_vip ? roleBadge('user', { is_vip: true }) : '';
    const banHtml = u.banned ? `<span class="badge" style="background:rgba(220,38,38,.15);color:#e0524f;border:1px solid rgba(220,38,38,.4)">🚫 封禁${u.ban_until ? ' 至 ' + esc((u.ban_until || '').slice(0, 10)) : '（永久）'}</span>` : '';
    const ff = u.feature_flags || {};
    const ffOn = Object.keys(FEATURE_LABELS).filter((k) => ff[k]).map((k) => FEATURE_LABELS[k]);
    return `<tr>
      <td><a href="/u/${u.id}" data-link>${avatarHtml(u.avatar, u.display_name)} <b>${esc(u.display_name)}</b></a><div class="muted" style="font-size:12px">@${esc(u.username)} · #${u.id}</div><div class="muted" style="font-size:12px">📅 ${esc((u.created_at || '').slice(0, 10))}</div></td>
      <td>${roleHtml} ${vipHtml} ${banHtml}</td>
      <td>${u.clip_count}</td>
      <td>${u.invite_count}</td>
      <td class="muted" style="font-size:12px;max-width:170px">${ffOn.length ? ffOn.join('、') : '—'}</td>
      <td class="muted" style="font-size:12px">${u.source ? (SOURCE_LABEL[u.source] || esc(u.source)) : '<span class="muted">未填</span>'}${u.source_detail ? `<div style="font-size:11px;opacity:.7">${esc(u.source_detail)}</div>` : ''}</td>
      <td class="admin-actions">
        <button class="btn btn-sm" data-vip="${u.id}">⭐ VIP</button>
        <button class="btn btn-sm" data-ff="${u.id}">功能</button>
        ${u.role === 'developer' ? '<span class="muted">开发者</span>' : `<button class="btn btn-sm" data-role="${u.id}">${u.role === 'admin' ? '撤管' : '升管'}</button>`}
        ${u.banned ? `<button class="btn btn-sm" data-unban="${u.id}">解封</button>` : `<button class="btn btn-sm btn-danger" data-ban="${u.id}">封禁</button>`}
        <button class="btn btn-sm btn-danger" data-deluser="${u.id}">删除</button>
      </td>
    </tr>`;
  }).join('');
  box.innerHTML = `<div class="list-head"><h2>👥 用户管理（${users.length} 人 · 共 ${data.total}）</h2></div>
    <div class="admin-filter-bar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
      <select id="aufSource" class="input input-sm">${srcOpts}</select>
      <input id="aufActive" class="input input-sm" type="number" min="0" placeholder="最近活跃天数" style="width:110px">
      <input id="aufMinClips" class="input input-sm" type="number" min="0" placeholder="最少片段数" style="width:100px">
      <select id="aufBanned" class="input input-sm"><option value="">封禁:全部</option><option value="1">已封禁</option><option value="0">未封禁</option></select>
      <select id="aufSort" class="input input-sm"><option value="id">排序:ID</option><option value="created_at">注册时间</option><option value="last_login">最近登录</option><option value="clip_count">片段数</option><option value="username">用户名</option></select>
      <select id="aufOrder" class="input input-sm"><option value="asc">升序</option><option value="desc">降序</option></select>
      <button id="aufApply" class="btn btn-sm btn-primary">筛选</button>
      <input id="adminUserSearch" class="input input-sm admin-search" placeholder="🔍 搜索用户名 / @账号 / ID" style="flex:1;min-width:160px">
    </div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色 / VIP / 封禁</th><th>剪贴板</th><th>邀请</th><th>功能开关</th><th>来源</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  // 回填筛选值
  $('#aufSource').value = f.source; $('#aufActive').value = f.activeDays; $('#aufMinClips').value = f.minClips;
  $('#aufBanned').value = f.banned; $('#aufSort').value = f.sort; $('#aufOrder').value = f.order;

  $('#aufApply').onclick = loadAdminUsers;
  const search = $('#adminUserSearch');
  if (search) search.oninput = (e) => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll('tbody tr').forEach((tr) => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };

  $$('#adminBody [data-vip]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => String(x.id) === b.dataset.vip);
    if (u) openVipModal(u);
  });
  $$('#adminBody [data-ff]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => String(x.id) === b.dataset.ff);
    const cur = u.feature_flags || {};
    const body = `<div class="ff-grid">${Object.entries(FEATURE_LABELS).map(([k, l]) => `<label class="ff-item"><input type="checkbox" data-ffk="${k}" ${cur[k] ? 'checked' : ''}> <span>${l}</span></label>`).join('')}</div>`;
    const m = openModal('功能开关 · ' + u.display_name, body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="ffCancel">取消</button><button class="btn btn-sm btn-primary" id="ffSave">保存</button>`;
    m.foot.querySelector('#ffCancel').onclick = closeModal;
    m.foot.querySelector('#ffSave').onclick = async () => {
      const ff = {}; m.body.querySelectorAll('[data-ffk]').forEach((c) => { ff[c.dataset.ffk] = c.checked; });
      const r = await api('/api/admin/users/' + b.dataset.ff, { method: 'PATCH', body: JSON.stringify({ feature_flags: ff }) });
      if (r.ok) { toast('已更新'); closeModal(); loadAdminUsers(); } else toast('失败', 'err');
    };
  });
  $$('#adminBody [data-role]').forEach((b) => b.onclick = async () => {
    const u = users.find((x) => String(x.id) === b.dataset.role);
    if (u.role === 'admin') {
      if (!confirm('确认撤下该用户的管理员身份？')) return;
      const r = await api('/api/admin/users/' + b.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) });
      if (r.ok) loadAdminUsers(); else toast('失败', 'err');
      return;
    }
    const perms = await openPermsModal(u.display_name);
    if (!perms) return;
    const r = await api('/api/admin/users/' + b.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: 'admin', admin_permissions: perms }) });
    if (r.ok) { toast('已册封'); loadAdminUsers(); } else toast('失败', 'err');
  });
  $$('#adminBody [data-ban]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => String(x.id) === b.dataset.ban);
    if (u) openBanModal(u);
  });
  $$('#adminBody [data-unban]').forEach((b) => b.onclick = async () => {
    if (!confirm('确认解封该用户？')) return;
    const r = await api('/api/admin/users/' + b.dataset.unban, { method: 'PATCH', body: JSON.stringify({ banned: false }) });
    if (r.ok) { toast('已解封'); loadAdminUsers(); } else toast('失败：' + (r.data?.message || r.status), 'err');
  });
  $$('#adminBody [data-deluser]').forEach((b) => b.onclick = async () => {
    if (!confirm('删除该用户及其全部剪贴板？不可恢复')) return;
    const r = await api('/api/admin/users/' + b.dataset.deluser, { method: 'DELETE' });
    if (r.ok) { toast('已删除'); loadAdminUsers(); } else toast('失败：' + (r.data?.message || r.status), 'err');
  });
}

/** VIP 设置弹窗（v4.13：时长可设置，0/空=永久） */
function openVipModal(u) {
  const cur = u.is_vip ? 1 : 0;
  const until = u.vip_until || '';
  const body = `<div class="form-row" style="display:flex;gap:14px;margin-bottom:8px">
    <label><input type="radio" name="vipAct" value="set" ${cur ? 'checked' : ''}> 开通 / 续期 VIP</label>
    <label><input type="radio" name="vipAct" value="unset" ${cur ? '' : 'checked'}> 取消 VIP</label>
  </div>
  <div class="form-row" style="margin-bottom:8px">时长（天，留空=永久）：<input id="vipDur" class="input input-sm" type="number" min="1" placeholder="例如 365（1 年）" style="width:140px"></div>
  <p class="muted" style="font-size:12px">当前：${cur ? (until ? 'VIP 至 ' + esc(until.slice(0, 10)) : '永久 VIP') : '非 VIP'}</p>`;
  const m = openModal('VIP 设置 · ' + (u.display_name || u.username), body);
  m.foot.innerHTML = `<button class="btn btn-sm" id="vipCancel">取消</button><button class="btn btn-sm btn-primary" id="vipSave">保存</button>`;
  m.foot.querySelector('#vipCancel').onclick = closeModal;
  m.foot.querySelector('#vipSave').onclick = async () => {
    const act = m.body.querySelector('input[name=vipAct]:checked')?.value;
    const dur = m.body.querySelector('#vipDur').value.trim();
    const payload = { is_vip: act === 'set' ? 1 : 0 };
    if (payload.is_vip && dur) payload.vip_duration = parseInt(dur) || 0;
    const r = await api('/api/admin/users/' + u.id, { method: 'PATCH', body: JSON.stringify(payload) });
    if (r.ok) { toast(payload.is_vip ? 'VIP 已设置' : '已取消 VIP'); closeModal(); loadAdminUsers(); }
    else toast('失败：' + (r.data?.message || r.status), 'err');
  };
}

/** 封禁弹窗（v4.13：原因 + 时长可设置，空=永久） */
function openBanModal(u) {
  const body = `<div class="form-row" style="margin-bottom:8px">封禁原因：<textarea id="banReason" class="input bio-input" style="min-height:80px" placeholder="例如：发布违规/低俗内容"></textarea></div>
  <div class="form-row">封禁时长（天，留空=永久封禁）：<input id="banDur" class="input input-sm" type="number" min="1" placeholder="例如 7" style="width:130px"></div>`;
  const m = openModal('封禁用户 · ' + (u.display_name || u.username), body);
  m.foot.innerHTML = `<button class="btn btn-sm" id="banCancel">取消</button><button class="btn btn-sm btn-danger" id="banSave">确认封禁</button>`;
  m.foot.querySelector('#banCancel').onclick = closeModal;
  m.foot.querySelector('#banSave').onclick = async () => {
    const reason = m.body.querySelector('#banReason').value.trim();
    const dur = m.body.querySelector('#banDur').value.trim();
    const payload = { banned: true, ban_reason: reason || '违反社区规范' };
    if (dur) payload.ban_duration = parseInt(dur) || 0;
    const r = await api('/api/admin/users/' + u.id, { method: 'PATCH', body: JSON.stringify(payload) });
    if (r.ok) { toast('已封禁'); closeModal(); loadAdminUsers(); }
    else toast('失败：' + (r.data?.message || r.status), 'err');
  };
}

/** 举报内容弹窗（v4.13） */
function openReportModal(clipId) {
  const REASONS = [
    { code: 'spam', label: '恶意 / 垃圾信息' },
    { code: 'porn', label: '低俗 / 色情内容' },
    { code: 'sensitive', label: '擦边内容' },
    { code: 'illegal', label: '违法违规内容' },
    { code: 'other', label: '其他' }
  ];
  const body = `<div class="form-row" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">${
    REASONS.map((r, i) => `<label style="display:flex;gap:8px;align-items:center"><input type="radio" name="repReason" value="${r.code}" ${i === 0 ? 'checked' : ''}> ${r.label}</label>`).join('')
  }</div>
  <div class="form-row">补充说明（选填）：<textarea id="repDetail" class="input bio-input" style="min-height:70px" placeholder="可描述具体问题所在"></textarea></div>`;
  const m = openModal('举报内容 · /c/' + clipId, body);
  m.foot.innerHTML = `<button class="btn btn-sm" id="repCancel">取消</button><button class="btn btn-sm btn-danger" id="repSave">提交举报</button>`;
  m.foot.querySelector('#repCancel').onclick = closeModal;
  m.foot.querySelector('#repSave').onclick = async () => {
    const reason = m.body.querySelector('input[name=repReason]:checked')?.value;
    const detail = m.body.querySelector('#repDetail').value.trim();
    const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify({ category: 'report', clip_id: clipId, reason, detail, title: '内容举报' }) });
    if (r.ok) {
      closeModal();
      if (r.data?.already) { toast('你已举报过该内容'); return; }
      // v4.14.2：不再强制跳转到公开工单页（避免暴露举报关系），停留原片段页，进度可在「工单」查看
      toast('举报已提交，感谢反馈' + (r.data?.code ? '（可在「工单」中查看进度）' : ''));
    }
    else toast('提交失败：' + (r.data?.message || r.status), 'err');
  };
}

async function loadAdminClips() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/admin/clips');
  if (!data?.clips) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  const rows = data.clips.map((c) => `<tr>
    <td><a href="/c/${esc(c.clip_id)}" data-link>${esc(c.title)}</a></td>
    <td>${c.owner_type === 'user' ? `<a href="/u/${esc(c.owner_id)}" data-link>${esc(c.owner_name || c.owner_id)}</a>` : esc(c.owner_name || '游客')}</td>
    <td>${c.is_public ? '✅' : '🙈'}</td>
    <td>${c.login_required ? '🔒' : '—'}</td>
    <td>${c.max_readers ? c.max_readers : '—'}</td>
    <td class="admin-actions"><a class="btn btn-sm" href="/c/${esc(c.clip_id)}" data-link>查看</a><button class="btn btn-sm btn-danger" data-delclip="${esc(c.clip_id)}">删除</button></td>
  </tr>`).join('');
  box.innerHTML = `<div class="list-head"><h2>📋 剪贴板管理（${data.clips.length} 条）</h2>
    <input id="adminClipSearch" class="input input-sm admin-search" placeholder="🔍 搜索标题 / 作者"></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>标题</th><th>作者</th><th>公开</th><th>登录可见</th><th>读者上限</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const cs = $('#adminClipSearch');
  if (cs) cs.oninput = (e) => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll('tbody tr').forEach((tr) => { tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  $$('#adminBody [data-delclip]').forEach((b) => b.onclick = async () => {
    if (!confirm('删除该剪贴板？')) return;
    const r = await api('/api/clips/' + b.dataset.delclip, { method: 'DELETE' });
    if (r.ok) { toast('已删除'); loadAdminClips(); } else toast('失败', 'err');
  });
}

async function loadAdminPages() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const slugs = ['help', 'about'];
  const pages = await Promise.all(slugs.map(async (s) => { const { data } = await api('/api/pages/' + s); return data?.page || { slug: s, title: s }; }));
  box.innerHTML = `<div class="list-head"><h2>📄 站点页面</h2><p class="muted">编辑帮助 / 关于页（Markdown）</p></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>页面</th><th>标题</th><th>操作</th></tr></thead><tbody>${
    pages.map((p) => `<tr><td><code class="card-id">${esc(p.slug)}</code></td><td>${esc(p.title || '')}</td><td><a class="btn btn-sm" href="/edit-page/${esc(p.slug)}" data-link>编辑</a></td></tr>`).join('')
  }</tbody></table></div>`;
}

// v4.0: 公告管理
async function loadAdminAnnouncements() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/announcements');
  if (!data?.announcements) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  box.innerHTML = `<div class="list-head"><h2>📢 公告管理</h2><button class="btn btn-sm btn-primary" id="addAnnounceBtn">＋ 新增公告</button></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>内容预览</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${
    data.announcements.map((a) => `<tr><td>${esc(a.content.slice(0, 80))}${a.content.length > 80 ? '…' : ''}</td><td>${a.is_active ? '✅ 活跃' : '❌ 停用'}</td><td class="muted">${esc((a.updated_at || a.created_at || '').slice(0, 16))}</td><td><button class="btn btn-sm btn-danger" data-del-announce="${a.id}">删除</button></td></tr>`).join('')
  }</tbody></table></div>`;
  $$('#adminBody [data-del-announce]').forEach((b) => { b.onclick = async () => { if (!confirm('删除公告？')) return; const r = await api(`/api/announcements/${b.dataset.delAnnounce}`, { method: 'DELETE' }); if (r.ok) { toast('已删除'); loadAdminAnnouncements(); } else toast(r.data?.message || '删除失败', 'err'); }; });
  $('#addAnnounceBtn').onclick = () => {
    const body = `<textarea id="annContent" class="input bio-input" style="min-height:120px" placeholder="输入公告内容（支持 Markdown）"></textarea>
      <div class="ann-preview"><b>预览：</b><div id="annPrev" class="markdown-body"></div></div>`;
    const m = openModal('发布新公告', body);
    const ta = m.body.querySelector('#annContent');
    const prev = m.body.querySelector('#annPrev');
    ta.oninput = () => renderMd(prev, ta.value);
    m.foot.innerHTML = `<button class="btn btn-sm" id="annCancel">取消</button><button class="btn btn-sm btn-primary" id="annSave">发布</button>`;
    m.foot.querySelector('#annCancel').onclick = closeModal;
    m.foot.querySelector('#annSave').onclick = async () => {
      const content = ta.value.trim(); if (!content) return toast('内容不能为空', 'err');
      const r = await api('/api/announcements', { method: 'PUT', body: JSON.stringify({ content }) });
      if (r.ok) { toast('公告已发布'); closeModal(); loadAdminAnnouncements(); } else toast(r.data?.message || '发布失败', 'err');
    };
  };
}

// v4.0: 邀请管理
async function loadAdminInvites() {
  const box = $('#adminBody'); box.innerHTML = '<div class="skeleton-row"></div>';
  const { data } = await api('/api/admin/users');
  if (!data?.users) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  const inviteRows = data.users.filter((u) => u.invite_count > 0 || u.inviter_id);
  box.innerHTML = `<div class="list-head"><h2>🎁 邀请记录</h2><p class="muted">以下用户有邀请活动（共 ${inviteRows.length} 人）</p></div>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>邀请码</th><th>邀请人数</th><th>被谁邀请</th><th>VIP</th></tr></thead><tbody>${
    inviteRows.map((u) => `<tr><td><a href="/u/${u.id}" data-link>${avatarHtml(u.avatar, u.display_name)} ${esc(u.display_name)}</a></td><td><code class="card-id">${esc(u.invite_code)}</code></td><td><b>${u.invite_count}</b></td><td>${u.inviter_id ? `<a href="/u/${u.inviter_id}" data-link">ID:${u.inviter_id}</a>` : '—'}</td><td>${u.is_vip ? '⭐ VIP' : '—'}</td></tr>`).join('')
  }</tbody></table></div>`;
}

// v4.0: 站点设置
async function loadAdminSettings() {
  const box = $('#adminBody'); box.innerHTML = '加载中…';
  const { data } = await api('/api/admin/settings');
  if (!data?.settings) return (box.innerHTML = emptyHTML('admin', '加载失败', ''));
  box.innerHTML = `<div class="list-head"><h2>⚙️ 站点设置</h2></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>键</th><th>值</th><th>操作</th></tr></thead><tbody>${
    data.settings.map((s) => `<tr><td><code class="card-id">${esc(s.key)}</code></td><td style="max-width:400px;word-break:break-all">${esc(String(s.value).slice(0, 120))}${String(s.value).length > 120 ? '…' : ''}</td><td><button class="btn btn-sm" data-set-key="${esc(s.key)}">修改</button></td></tr>`).join('')
  }</tbody></table></div>`;
  $$('#adminBody [data-set-key]').forEach((b) => { b.onclick = () => {
    const key = b.dataset.setKey;
    const row = data.settings.find((s) => s.key === key);
    const cur = row ? String(row.value) : '';
    const body = `<p class="muted" style="margin:0 0 8px">键：<code class="card-id">${esc(key)}</code></p><textarea id="setVal" class="input bio-input" style="min-height:120px">${esc(cur)}</textarea>`;
    const m = openModal('修改站点设置', body);
    m.foot.innerHTML = `<button class="btn btn-sm" id="setCancel">取消</button><button class="btn btn-sm btn-primary" id="setSave">保存</button>`;
    m.foot.querySelector('#setCancel').onclick = closeModal;
    m.foot.querySelector('#setSave').onclick = async () => {
      const r = await api('/api/admin/settings/' + encodeURIComponent(key), { method: 'PUT', body: JSON.stringify({ value: m.body.querySelector('#setVal').value }) });
      if (r.ok) { toast('已更新'); closeModal(); loadAdminSettings(); } else toast('失败', 'err');
    };
  }; });
}

// ========== 编辑器（v4.0 增强：等效字数 + 短链修改 + 登录可见选项） ==========
async function renderEditor(clipId) {
  showView('edit'); await loadMe(); const me = state.me; state.editing = null; state.editingPage = null; $('#advBox').classList.remove('hidden');
  const notice = $('#guestNotice');
  if (me.type === 'user') { notice.classList.add('hidden'); $('#editorIdentity').textContent = '以 ' + me.name + ' 身份发布'; $('#edCollabWrap').classList.remove('hidden'); }
  else { const left = Math.max(0, (me.limit || 5) - (me.count || 0)); notice.classList.remove('hidden'); notice.className = 'notice notice-warn'; notice.innerHTML = `<b>⚠️ 游客模式（还能建 ${left} 个）</b><p>游客创建的剪贴板会被标记为<b>「任何人可编辑/删除」</b>。<a href="/api/auth/login">登录</a> 后额度更多且仅你可改。</p>`; $('#editorIdentity').textContent = '以游客身份发布'; $('#edCollabWrap').classList.add('hidden'); if (!clipId && left <= 0) { notice.innerHTML = `<b>🚫 游客配额已用完</b><p>请删掉一些旧剪贴板，或 <a href="/api/auth/login">登录</a>。</p>`; $('#saveBtn').disabled = true; } else { $('#saveBtn').disabled = false; } }

  if (clipId) {
    const { ok, data } = await api('/api/clips/' + encodeURIComponent(clipId));
    if (!ok || !data) return showView('404');
    if (!data.can_edit) { toast('没有编辑权限', 'err'); return go('/c/' + clipId, true); }
    state.editing = data; $('#edTitle').value = data.title || ''; $('#edContent').value = data.content || ''; $('#edPublic').checked = !!data.is_public; $('#edCollab').checked = !!data.editable_by_anyone; $('#edMaxViews').value = data.max_views || 0; $('#edSlug').value = data.clip_id; $('#edPassword').placeholder = data.has_password ? '（已设密码，留空=保持不变）' : '留空 = 不加密'; $('#saveBtn').textContent = '💾 保存修改';
    // v4.0: 短链修改（如果有权限）
    const canEditSlug = me.feature_flags?.custom_slug || isAdmin();
    if (canEditSlug) { $('#edSlug').disabled = false; $('#edSlug').title = '可修改短链（保存后旧链接自动跳转新链接）'; }
    // v4.0: 预填登录门禁 / 读者上限
    $('#edLoginRequired').checked = !!data.login_required;
    $('#edMaxReaders').value = data.max_readers || 0;
    // v4.6: 标签回填
    if ($('#edTags')) $('#edTags').value = (data.tags || []).join(',');
  } else { $('#edTitle').value = ''; $('#edContent').value = ''; $('#edPublic').checked = true; $('#edCollab').checked = false; $('#edMaxViews').value = 0; $('#edPassword').value = ''; $('#edSlug').value = ''; $('#edSlug').disabled = !(me.feature_flags?.custom_slug || isAdmin()); $('#edExpiry').value = 'never'; $('#saveBtn').textContent = '🚀 发布'; if ($('#edTags')) $('#edTags').value = ''; }

  const ed = $('#edContent');
  updatePreview(); autoGrow(ed);
  ed.oninput = () => { updatePreview(); autoGrow(ed); };
  $('#saveBtn').onclick = saveClip; bindToolbar(); attachMention(ed); setupEditorShortcuts(ed); setupScrollSync(); setupToc($('#tocToggle'), $('#edToc'), $('#edPreview'));
  // v4.6: 草稿自动保存
  setupDraft(clipId || null);
}

// ==================== 草稿自动保存（v4.6） ====================
// 写一半关标签页 / 断网 / 发布失败都不丢内容：500ms 防抖写 localStorage，
// 重新进入编辑器时检测到草稿与当前内容不同则提示恢复。
let draftTimer = null;
function draftKey(clipId) { return clipId ? 'mdqp_draft_' + clipId : 'mdqp_draft_new'; }
function readDraft(clipId) { try { return JSON.parse(localStorage.getItem(draftKey(clipId)) || 'null'); } catch { return null; } }
function writeDraft(clipId) {
  try {
    const title = $('#edTitle')?.value || '', content = $('#edContent')?.value || '';
    if (!title && !content.trim()) { localStorage.removeItem(draftKey(clipId)); return; }
    localStorage.setItem(draftKey(clipId), JSON.stringify({ title, content, at: Date.now() }));
  } catch { /* 存储满 / 隐私模式：静默失败 */ }
}
function clearDraft(clipId) { try { localStorage.removeItem(draftKey(clipId)); } catch {} }
function setupDraft(clipId) {
  const bar = $('#draftBar'); if (!bar) return;
  const saved = readDraft(clipId);
  const curTitle = $('#edTitle').value, curContent = $('#edContent').value;
  const differs = saved && (saved.title !== curTitle || (saved.content || '') !== curContent);
  if (differs && (saved.title || (saved.content || '').trim())) {
    const when = saved.at ? new Date(saved.at).toLocaleString() : '之前';
    bar.classList.remove('hidden');
    bar.innerHTML = `<b>📋 发现未保存的草稿</b>（${esc(when)} 自动保存） <button class="btn btn-sm btn-primary" id="draftRestore">恢复草稿</button> <button class="btn btn-sm btn-ghost" id="draftDiscard">放弃</button>`;
    $('#draftRestore').onclick = () => { $('#edTitle').value = saved.title || ''; $('#edContent').value = saved.content || ''; updatePreview(); autoGrow($('#edContent')); bar.classList.add('hidden'); toast('草稿已恢复'); };
    $('#draftDiscard').onclick = () => { clearDraft(clipId); bar.classList.add('hidden'); };
  } else { bar.classList.add('hidden'); }
  const onEdit = () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => writeDraft(clipId), 500); };
  $('#edContent').addEventListener('input', onEdit);
  $('#edTitle').addEventListener('input', onEdit);
  $('#edTags')?.addEventListener('input', onEdit);
}

function updatePreview() {
  const v = $('#edContent').value;
  const pv = $('#edPreview');
  const pst = pv.scrollTop;          // 保存预览滚动位置
  const visible = pv.offsetParent !== null;
  if (visible) __scrollSyncSuppress = true; // 重建期间屏蔽同步，避免把编辑器滚动位置拽走
  if (v.trim()) renderMd(pv, v); else pv.innerHTML = '<p class="muted">预览区：左侧输入 Markdown，这里实时渲染。</p>';
  if (visible) {
    pv.scrollTop = pst;              // 还原预览滚动位置（长内容编辑不再被归零）
    requestAnimationFrame(() => requestAnimationFrame(() => { __scrollSyncSuppress = false; }));
  }
  // v4.6: 等效字数统计（上限按信任等级分级）
  const cc = countChars(v); const limit = state.me?.char_limit || 1500;
  if (state.me?.unlimited_char || isVip() || isAdmin()) { $('#charCount').textContent = `${cc} 等效字 · 不限`; $('#charCount').style.color = 'var(--primary)'; }
  else { $('#charCount').textContent = `${cc}/${limit} 等效字`; $('#charCount').style.color = cc > limit ? 'var(--danger)' : ''; }
  if (!$('#edToc').classList.contains('hidden')) $('#edToc').innerHTML = buildOutline(pv);
}

const MD_WRAPS = {
  h1: ['\n# ', '', '一级标题'], h2: ['\n## ', '', '二级标题'], h3: ['\n### ', '', '三级标题'],
  bold: ['**', '**', '加粗'], italic: ['*', '*', '斜体'], strike: ['~~', '~~', '删除线'],
  link: ['[', '](https://)', '链接文字'], image: ['![', '](https://)', '图片描述'],
  code: ['\n```\n', '\n```\n', '代码'], quote: ['\n> ', '', '引用'],
  list: ['\n- ', '', '列表项'], table: ['\n| 列1 | 列2 |\n|---|---|\n| ', ' |  |\n', '内容'], hr: ['\n\n---\n\n', '', '']
};

/** 通用 Markdown 编辑器绑定：textarea + 预览区 + 工具栏（可指定元素，支持多实例复用） */
function bindMdEditor(ta, pv, toolbar, countEl) {
  const update = () => {
    const v = ta.value;
    if (v.trim()) renderMd(pv, v); else pv.innerHTML = '<p class="muted">预览区：左侧输入 Markdown，这里实时渲染。</p>';
    if (countEl) countEl.textContent = countChars(v) + ' 字';
  };
  ta.oninput = update;
  if (toolbar) toolbar.querySelectorAll('button[data-md]').forEach((b) => {
    b.onclick = () => {
      const [pre, post, ph] = MD_WRAPS[b.dataset.md] || ['', '', ''];
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
      ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e);
      ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length; update();
    };
  });
  update();
}

function bindToolbar() {
  $('#previewToggle').onclick = () => { const s = $('#editorSplit'); s.classList.toggle('no-preview'); $('#previewToggle').classList.toggle('off', s.classList.contains('no-preview')); };
  const wraps = MD_WRAPS;
  $$('.editor-toolbar button[data-md]').forEach((b) => { b.onclick = () => { const ta = $('#edContent'); const [pre, post, ph] = wraps[b.dataset.md]; const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph; ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e); ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length; updatePreview(); }; });
  const fixerBtn = $('#fixerBtn'); if (fixerBtn) fixerBtn.onclick = () => openFixer($('#edContent')?.value || '');
}

/** 编辑器增强：自动撑高 / 快捷键 / 滚动同步 */
function autoGrow(ta) { if (!ta) return; const st = ta.scrollTop; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 720) + 'px'; if (ta.scrollTop !== st) ta.scrollTop = st; }

function wrapSelection(ta, pre, post, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || ph;
  ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e);
  ta.focus(); ta.selectionStart = s + pre.length; ta.selectionEnd = s + pre.length + sel.length;
}
function indentSelection(ta, dir) {
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  const lineStart = val.lastIndexOf('\n', s - 1) + 1;
  if (dir > 0) { ta.value = val.slice(0, lineStart) + '  ' + val.slice(lineStart); ta.selectionStart = s + 2; ta.selectionEnd = e + 2; }
  else if (val.slice(lineStart, lineStart + 2) === '  ') { ta.value = val.slice(0, lineStart) + val.slice(lineStart + 2); ta.selectionStart = Math.max(lineStart, s - 2); ta.selectionEnd = Math.max(lineStart, e - 2); }
}
function setupEditorShortcuts(ta) {
  if (!ta || ta._shortcuts) return; ta._shortcuts = true;
  ta.addEventListener('keydown', (e) => {
    if (mentionState.open) return; // @提及打开时，方向键/回车交给提及选择
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); wrapSelection(ta, '**', '**', '加粗'); updatePreview(); }
    else if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); wrapSelection(ta, '*', '*', '斜体'); updatePreview(); }
    else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveClip(); }
    else if (e.key === 'Tab') { e.preventDefault(); indentSelection(ta, e.shiftKey ? -1 : 1); updatePreview(); }
  });
}
let __scrollSyncSuppress = false; // 程序化滚动（同步/预览重建）期间屏蔽同步，避免把编辑器滚动位置拽走
function setupScrollSync() {
  const ed = $('#edContent'), pv = $('#edPreview'); if (!ed || !pv) return;
  function syncTo(dst, val) {
    __scrollSyncSuppress = true;
    dst.scrollTop = val;
    // 等浏览器派发完本次 scroll 事件后再解除屏蔽，避免回环
    requestAnimationFrame(() => requestAnimationFrame(() => { __scrollSyncSuppress = false; }));
  }
  ed.addEventListener('scroll', () => {
    if (__scrollSyncSuppress) return;
    if (pv.offsetParent === null) return; // 预览隐藏（no-preview）时不参与同步
    const r = ed.scrollHeight - ed.clientHeight;
    if (r > 0) syncTo(pv, pv.scrollHeight * (ed.scrollTop / r));
  });
  pv.addEventListener('scroll', () => {
    if (__scrollSyncSuppress) return;
    const r = pv.scrollHeight - pv.clientHeight;
    if (r > 0) syncTo(ed, ed.scrollHeight * (pv.scrollTop / r));
  });
}

async function saveClip() {
  const content = $('#edContent').value; if (!content.trim()) return toast('内容不能为空', 'err');
  // 保存前预检字数，避免白跑一次请求（与后端分级上限一致）
  const lim = state.me?.char_limit || 1500;
  if (!state.me?.unlimited_char && !isAdmin() && !isVip()) {
    const cc = countChars(content);
    if (cc > lim) { toast(`内容 ${cc} 等效字，超出当前上限 ${lim}（提升信任等级可解锁更高额度）`, 'err'); return; }
  }
  const body = { title: $('#edTitle').value.trim(), content, is_public: $('#edPublic').checked, expires_in: $('#edExpiry').value, max_views: parseInt($('#edMaxViews').value) || 0 };
  // v4.6: 标签
  const tagsRaw = $('#edTags')?.value || '';
  const tags = tagsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (tags.length) body.tags = tags;
  const pwd = $('#edPassword').value;
  if (state.editing) { if (pwd) body.password = pwd; if (state.me.type === 'user') body.editable_by_anyone = $('#edCollab').checked;
    // v4.0: 短链修改
    const newSlug = $('#edSlug').value.trim().toLowerCase();
    if (newSlug && newSlug !== state.editing.clip_id) body.new_slug = newSlug;
    // v4.0: 登录可见 & 读者限制
    body.login_required = $('#edLoginRequired')?.checked || false;
    body.max_readers = parseInt($('#edMaxReaders')?.value) || 0;
  } else { if (pwd) body.password = pwd; const slug = $('#edSlug').value.trim().toLowerCase(); if (slug) body.custom_id = slug; if (state.me.type === 'user') body.editable_by_anyone = $('#edCollab').checked; body.login_required = $('#edLoginRequired')?.checked || false; body.max_readers = parseInt($('#edMaxReaders')?.value) || 0; }

  $('#saveBtn').disabled = true; $('#saveBtn').textContent = '提交中…';
  const path = state.editing ? '/api/clips/' + encodeURIComponent(state.editing.clip_id) : '/api/clips';
  try {
    const r = await api(path, { method: state.editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
    $('#saveBtn').disabled = false; $('#saveBtn').textContent = state.editing ? '💾 保存修改' : '🚀 发布';
    if (r.ok) { clearDraft(state.editing ? state.editing.clip_id : null); toast(state.editing ? '已保存' : '发布成功！'); go('/c/' + (r.data.clip_id || state.editing.clip_id)); }
    else { toast(r.data?.message || '失败：' + (r.data?.error || '状态码 ' + r.status), 'err'); }
  } catch (e) {
    $('#saveBtn').disabled = false; $('#saveBtn').textContent = state.editing ? '💾 保存修改' : '🚀 发布';
    toast('网络错误，请检查连接后重试', 'err');
  }
}

// ==================== 报错自动捕获与一键反馈（v4.5.2） ====================
// 目标：出错时直接在页面上弹出可读的技术详情（不用 F12），
// 并且只有用户点「反馈给站长」同意后，才把信息带去 /feedback 预填。
const ERR_LOG = [];
let lastErrShown = { key: '', at: 0 };
let lastErr = null;      // 最近一次捕获到的错误（命令面板手动上报用）
let pendingBug = null;   // 待预填到反馈表单的内容

const ERR_KIND_LABEL = {
  js: '页面脚本错误',
  promise: '未处理的异步异常',
  resource: '资源加载失败',
  api: '接口请求失败',
  manual: '手动上报'
};

function pushErrLog(level, text) {
  try {
    ERR_LOG.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${level} ${text}`);
    if (ERR_LOG.length > 80) ERR_LOG.shift();
  } catch (e) { /* 日志收集失败不影响主流程 */ }
}

/** 采集运行环境（浏览器 / 系统 / 屏幕 / 页面 / 版本） */
function collectEnv() {
  try {
    const n = navigator, s = screen;
    return [
      'UA：' + (n.userAgent || '未知'),
      '平台：' + (n.platform || '未知') + '｜语言：' + (n.language || '未知'),
      '屏幕：' + s.width + '×' + s.height + '｜DPR：' + (window.devicePixelRatio || 1) + '｜触屏：' + ('ontouchstart' in window ? '是' : '否'),
      '页面：' + location.pathname + location.search,
      '版本：' + (window.__MDQP_VERSION || '未知'),
      '网络：' + (n.onLine ? '在线' : '离线'),
      '时间：' + new Date().toLocaleString('zh-CN')
    ].join('\n');
  } catch (e) { return '环境采集失败：' + (e && e.message); }
}

/** 组装完整的技术详情（弹窗展示 + 反馈预填共用） */
function buildReportText(err) {
  const parts = [
    '【错误类型】' + (err.kindLabel || '未知'),
    '【发生时间】' + (err.time || ''),
    '【发生页面】' + (err.url || ''),
    '【错误信息】' + (err.message || '')
  ];
  if (err.extra) parts.push('【附加信息】' + err.extra);
  if (err.stack) parts.push('\n【调用堆栈】\n' + err.stack);
  parts.push('\n【运行环境】\n' + (err.env || collectEnv()));
  if (ERR_LOG.length) parts.push('\n【最近控制台日志（' + ERR_LOG.length + ' 条）】\n' + ERR_LOG.join('\n'));
  return parts.join('\n');
}

function closeErrModal() {
  const m = $('#errModal'); if (!m) return;
  m.classList.remove('show'); m.classList.add('hidden');
}

function showErrModal(err) {
  const m = $('#errModal'); if (!m) return;
  const full = buildReportText(err);
  const msgEl = $('#errMsg'), metaEl = $('#errMeta'), detEl = $('#errDetail'), wrapEl = $('#errDetailWrap');
  if (msgEl) msgEl.textContent = err.title || err.message || '发生未知错误';
  if (metaEl) metaEl.textContent = [err.kindLabel, err.time, err.url].filter(Boolean).join('　·　');
  if (detEl) detEl.textContent = full;
  if (wrapEl) wrapEl.open = false;
  m._err = err; m._full = full;
  m.classList.remove('hidden'); m.classList.add('show');
}

/** 统一上报入口。silent=true 只记日志不弹窗 */
function reportError(info) {
  const err = {
    kind: info.kind || 'js',
    kindLabel: ERR_KIND_LABEL[info.kind] || '未知错误',
    title: info.title || '',
    message: String(info.message || '未知错误').slice(0, 500),
    stack: String(info.stack || '').slice(0, 3000),
    extra: String(info.extra || '').slice(0, 500),
    url: info.url || (location.pathname + location.search),
    time: new Date().toLocaleString('zh-CN')
  };
  lastErr = err;
  pushErrLog('ERROR', err.kindLabel + '｜' + err.message + (err.extra ? '｜' + err.extra : ''));
  if (info.silent) return;
  // 30 秒内同样的错误只弹一次，避免刷屏
  const key = err.kind + '|' + err.message;
  const now = Date.now();
  if (lastErrShown.key === key && now - lastErrShown.at < 30000) return;
  lastErrShown = { key, at: now };
  showErrModal(err);
}

/** 组装 Bug 工单的结构化格式（保留 v4.14.0 之前的报错反馈排版：错误类型/页面/环境/控制台/操作/期望） */
function bugReportContent(err) {
  const e = err || lastErr || { kind: 'manual', kindLabel: '手动上报', message: '（无自动捕获到的报错，请手动描述）', time: new Date().toLocaleString('zh-CN'), url: location.pathname + location.search };
  const full = buildReportText(e);
  return `【自动上报】${e.kindLabel || '问题反馈'}
错误：${e.message || '（未捕获到具体错误）'}
页面：${e.url || location.pathname}
环境：${collectEnv()}
控制台：${full}

我当时的操作：（请补充）
期望结果：（请补充）`;
}

/** 把当前错误打包成反馈草稿，跳转工单写入页（等于用户同意后再提交） */
function goReportError(err) {
  pendingBug = { category: 'bug', content: bugReportContent(err || lastErr) };
  closeErrModal();
  go('/tickets/new');
}

function installErrorReporter() {
  const m = $('#errModal'); if (!m) return;
  const closeBtn = $('#errClose'), dismissBtn = $('#errDismiss'), copyBtn = $('#errCopy'), reportBtn = $('#errReport');
  if (closeBtn) closeBtn.onclick = closeErrModal;
  if (dismissBtn) dismissBtn.onclick = closeErrModal;
  m.onclick = (e) => { if (e.target === m) closeErrModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.classList.contains('show')) closeErrModal(); });
  if (copyBtn) copyBtn.onclick = async () => {
    const text = m._full || '';
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制报错详情', 'ok');
    } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制报错详情', 'ok'); } catch (e2) { toast('复制失败，请手动选择文本', 'err'); }
      ta.remove();
    }
  };
  if (reportBtn) reportBtn.onclick = () => goReportError(m._err || null);

  // ① 未捕获的 JS 运行时错误
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t !== window && t.tagName) {
      // 资源加载失败：脚本/样式会真影响功能，弹窗；图片只静默记录（二维码、名片图挂了不该打扰）
      const src = t.src || t.href || t.tagName;
      const critical = t.tagName === 'SCRIPT' || t.tagName === 'LINK';
      reportError({ kind: 'resource', message: '资源加载失败：' + src, extra: t.tagName, silent: !critical });
      return;
    }
    reportError({
      kind: 'js',
      message: e.message || '脚本执行错误',
      stack: (e.error && e.error.stack) || '',
      extra: e.filename ? e.filename + ':' + e.lineno + ':' + e.colno : ''
    });
  }, true);

  // ② 未处理的 Promise 异常
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportError({
      kind: 'promise',
      message: (r && (r.message || String(r))) || '未处理的 Promise 异常',
      stack: (r && r.stack) || ''
    });
  });

  // ③ 控制台环形缓冲：反馈时自动附带最近日志，用户不用再开 F12 复制
  ['error', 'warn'].forEach((lv) => {
    const orig = console[lv] ? console[lv].bind(console) : null;
    console[lv] = function (...args) {
      try {
        pushErrLog(lv.toUpperCase(), args.map((a) => {
          if (a && a.stack) return a.stack;
          if (a instanceof Error) return a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e2) { return String(a); } }
          return String(a);
        }).join(' ').slice(0, 800));
      } catch (e3) { /* 忽略 */ }
      if (orig) orig(...args);
    };
  });

  // ④ 版本号（反馈环境信息用）
  fetch('/api/health').then((r) => r.json()).then((d) => {
    if (d && d.version) {
      window.__MDQP_VERSION = d.version;
      try {
        const seen = localStorage.getItem('mdqp_last_seen_version');
        if (seen !== d.version) maybeShowVersionToast(seen, d.version); // 首次访问（seen 为空）也弹
        localStorage.setItem('mdqp_last_seen_version', d.version);
      } catch (_) {}
    }
  }).catch(() => {});
}

// ==================== 官方反馈贴 ====================
async function renderTickets() {
  showView('tickets');
  const box = $('#ticketBox'); if (!box) return;
  box.innerHTML = `
    <div class="tk-head">
      <div>
        <h1 class="clip-title">🎫 工单中心</h1>
        <p class="muted">遇到问题、有好点子、发现违规内容？提交工单，所有人都能看到处理进度，管理员会逐一处理。</p>
      </div>
      <button class="btn btn-primary" id="newTicketBtn">＋ 发起工单</button>
    </div>
    <div class="tk-filters">
      <select class="input-sm" id="tkStatus">
        <option value="">全部状态</option>
        <option value="open">待处理</option>
        <option value="reviewing">处理中</option>
        <option value="resolved">已解决</option>
        <option value="rejected">已驳回</option>
      </select>
      <select class="input-sm" id="tkCat">
        <option value="">全部分类</option>
        <option value="bug">程序缺陷</option>
        <option value="suggestion">功能建议</option>
        <option value="report">内容举报</option>
        <option value="other">其他</option>
      </select>
      ${state.me?.type === 'user' ? '<label class="tk-mine"><input type="checkbox" id="tkMine"> 只看我的</label>' : ''}
      <span class="muted" id="tkCount"></span>
    </div>
    <div id="tkList" class="tk-list"><div class="loading">加载中…</div></div>`;
  $('#newTicketBtn').onclick = () => go('/tickets/new');
  const reload = () => loadTicketList();
  $('#tkStatus').onchange = reload;
  $('#tkCat').onchange = reload;
  const mine = $('#tkMine'); if (mine) mine.onchange = reload;
  if (pendingBug) { go('/tickets/new'); return; }   // pendingBug 为全局，renderNewTicket 会消费
  await loadTicketList();
}

async function loadTicketList() {
  const el = $('#tkList'); if (!el) return;
  const st = $('#tkStatus')?.value || '';
  const cat = $('#tkCat')?.value || '';
  const mine = $('#tkMine')?.checked ? '1' : '';
  const q = new URLSearchParams();
  if (st) q.set('status', st); if (cat) q.set('category', cat); if (mine) q.set('mine', '1');
  const { ok, data } = await api('/api/tickets?' + q.toString());
  if (!ok || !data?.tickets) { el.innerHTML = '<div class="empty">加载失败</div>'; return; }
  const list = data.tickets;
  const cnt = $('#tkCount'); if (cnt) cnt.textContent = '共 ' + (data.total || 0) + ' 条';
  if (!list.length) { el.innerHTML = '<div class="empty">🎉 暂时没有工单，点右上角发起一个吧</div>'; return; }
  el.innerHTML = list.map((t) => `
    <a class="tk-card" href="/tickets/${esc(t.code)}" data-link>
      <div class="tk-card-row tk-card-top">
        <span class="tk-title">${esc(t.title || '未命名工单')}</span>
        ${t.reply_count ? `<span class="badge tk-replies">💬 ${t.reply_count}</span>` : ''}
      </div>
      <div class="tk-card-row tk-card-meta">
        <span class="badge badge-collab">${esc(t.category_label)}</span>
        <span class="badge fb-status fb-status-${t.status}">${esc(t.status_label)}</span>
        <span class="muted">#${esc(t.code)}</span>
        <span class="muted">${esc(t.author_name || '匿名')}</span>
        <span class="muted">${esc(timeAgo(t.created_at))}</span>
      </div>
    </a>`).join('');
}


async function renderTicketDetail(code) {
  showView('tickets');
  const box = $('#ticketBox'); if (!box) return;
  box.innerHTML = `<div class="tk-detail"><div class="loading">加载中…</div></div>`;
  const { ok, data } = await api('/api/tickets/' + encodeURIComponent(code));
  if (!ok || !data?.ticket) {
    box.innerHTML = `<div class="crumb"><a href="/tickets" data-link>← 工单中心</a></div><div class="empty">${esc(data?.error === 'forbidden' ? '该工单不可见' : '工单不存在')}</div>`;
    return;
  }
  const t = data.ticket, replies = data.replies || [], clip = data.clip;
  const canReply = data.can_reply, canManage = data.can_manage;
  box.innerHTML = `
    <div class="tk-detail">
      <div class="crumb"><a href="/tickets" data-link>← 工单中心</a></div>
      <div class="tk-banner">
        <div class="tk-banner-top">
          <h1 class="tk-detail-title">${esc(t.title || '未命名工单')}</h1>
          <span class="badge fb-status fb-status-${t.status}">${esc(t.status_label)}</span>
        </div>
        <div class="tk-banner-meta">
          <span class="badge badge-collab">${esc(t.category_label)}</span>
          <span class="muted">#${esc(t.code)}</span>
          <span class="muted">创建者：${esc(t.author_name || '匿名')}</span>
          ${t.assignee_name ? `<span class="muted">责任人：${esc(t.assignee_name)}</span>` : ''}
          <span class="muted">创建于 ${esc((t.created_at || '').slice(0, 16))}</span>
          ${t.resolved_at ? `<span class="muted">处理于 ${esc((t.resolved_at || '').slice(0, 16))}</span>` : ''}
        </div>
        ${clip ? `<div class="tk-clip">关联内容：<a href="/c/${esc(clip.clip_id)}" data-link>${esc(clip.title || clip.clip_id)}</a> ${clip.exists ? '' : '<span class="muted">（内容已删除）</span>'}</div>` : ''}
      </div>
      <div class="tk-section"><h3 class="tk-h3">工单描述</h3><div class="tk-desc">${esc(t.content)}</div></div>
      ${t.admin_note ? `<div class="tk-note"><b>处理说明：</b>${esc(t.admin_note)}</div>` : ''}
      <div class="tk-section"><h3 class="tk-h3">处理记录（${replies.length}）</h3>
        <div class="tk-replies">${replies.length ? replies.map((r) => `
          <div class="tk-reply ${r.is_staff ? 'tk-reply-staff' : ''}">
            <div class="tk-reply-head">
              <span class="tk-reply-author">${esc(r.author_name || '匿名')}</span>
              ${r.is_staff ? '<span class="badge tk-staff">官方</span>' : ''}
              <span class="muted tk-reply-time">${esc(timeAgo(r.created_at))}</span>
            </div>
            <div class="tk-reply-content">${esc(r.content)}</div>
          </div>`).join('') : '<div class="muted">暂无回复</div>'}
        </div>
      </div>
      ${canReply ? `
      <div class="tk-reply-editor">
        <textarea id="tkReply" class="input" rows="3" placeholder="${canManage ? '以管理员身份回复（将标记为官方回复）…' : '补充信息或追问…'}" maxlength="3000"></textarea>
        <div class="tk-reply-foot"><button class="btn btn-primary btn-sm" id="tkReplyBtn">回复</button></div>
      </div>` : '<p class="muted">登录后即可参与工单讨论。</p>'}
      ${canManage ? `
      <div class="tk-admin">
        <h3 class="tk-h3">管理员处理</h3>
        <div class="tk-admin-row">
          <label>状态
            <select id="tkStatusSel" class="input-sm">
              <option value="open" ${t.status === 'open' ? 'selected' : ''}>待处理</option>
              <option value="reviewing" ${t.status === 'reviewing' ? 'selected' : ''}>处理中</option>
              <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>已解决</option>
              <option value="rejected" ${t.status === 'rejected' ? 'selected' : ''}>已驳回</option>
            </select>
          </label>
          <label>处理说明
            <input id="tkNote" class="input-sm" placeholder="处理结论 / 反馈文字" value="${esc(t.admin_note || '')}">
          </label>
          <button class="btn btn-sm btn-primary" id="tkSaveBtn">保存</button>
        </div>
        ${clip && clip.exists ? `<button class="btn btn-sm btn-danger" id="tkDelClipBtn">删除关联内容（连带评论/读者/其它举报）</button>` : ''}
        <button class="btn btn-sm btn-ghost" id="tkDelBtn">删除工单</button>
      </div>` : ''}
    </div>`;
  const rb = $('#tkReplyBtn'); if (rb) rb.onclick = async () => {
    const v = $('#tkReply').value.trim(); if (!v) return toast('回复不能为空');
    rb.disabled = true;
    const r = await api('/api/tickets/' + encodeURIComponent(code) + '/reply', { method: 'POST', body: JSON.stringify({ content: v }) });
    rb.disabled = false;
    if (r.ok) { toast('已回复', 'ok'); renderTicketDetail(code); } else toast(r.data?.message || '回复失败', 'err');
  };
  const sb = $('#tkSaveBtn'); if (sb) sb.onclick = async () => {
    const r = await api('/api/tickets/' + encodeURIComponent(code), { method: 'PATCH', body: JSON.stringify({ status: $('#tkStatusSel').value, admin_note: $('#tkNote').value }) });
    if (r.ok) { toast('已更新', 'ok'); renderTicketDetail(code); } else toast('更新失败', 'err');
  };
  const dcb = $('#tkDelClipBtn'); if (dcb) dcb.onclick = async () => {
    if (!confirm('确认删除关联内容？将一并删除其评论、读者记录及其它举报，不可恢复。')) return;
    const r = await api('/api/tickets/' + encodeURIComponent(code), { method: 'PATCH', body: JSON.stringify({ action: 'delete_clip' }) });
    if (r.ok) { toast('已删除内容', 'ok'); renderTicketDetail(code); } else toast('删除失败', 'err');
  };
  const db = $('#tkDelBtn'); if (db) db.onclick = async () => {
    if (!confirm('确认删除这条工单？不可恢复。')) return;
    const r = await api('/api/tickets/' + encodeURIComponent(code), { method: 'DELETE' });
    if (r.ok) { toast('已删除', 'ok'); go('/tickets'); } else toast('删除失败', 'err');
  };
}

async function renderNewTicket() {
  showView('tickets');
  const box = $('#ticketBox'); if (!box) return;
  const pf = pendingBug || {}; pendingBug = null;
  const preCat = ['bug', 'suggestion', 'other'].includes(pf.category) ? pf.category : 'bug';
  box.innerHTML = `
    <div class="tk-detail">
      <div class="crumb"><a href="/tickets" data-link>← 工单中心</a></div>
      <h1 class="clip-title">🎫 发起工单</h1>
      <p class="muted">描述你遇到的问题、建议或遇到的情况。所有工单公开可见，管理员会逐一处理。支持 Markdown 格式。</p>
      <div class="tk-form-row"><label>分类
        <select id="ntCat" class="input-sm">
          <option value="bug">程序缺陷</option>
          <option value="suggestion">功能建议</option>
          <option value="other">其他</option>
        </select></label>
        <span class="muted" id="ntCatHint"></span>
      </div>
      <div class="tk-form-row"><label>标题（选填）
        <input id="ntTitle" class="input" placeholder="一句话概括" maxlength="100">
      </label></div>
      <div class="tk-form-row">
        <div class="tk-editor-toolbar editor-toolbar">
          <button data-md="h1" title="一级标题">H1</button>
          <button data-md="h2" title="二级标题">H2</button>
          <button data-md="h3" title="三级标题">H3</button>
          <button data-md="bold" title="加粗"><b>B</b></button>
          <button data-md="italic" title="斜体"><i>I</i></button>
          <button data-md="code" title="代码块">‹›</button>
          <button data-md="quote" title="引用">❝</button>
          <button data-md="list" title="列表">•</button>
          <button id="ntPreviewToggle" class="tb-toggle">👁 实时预览</button>
          <span class="tb-count muted" id="ntCharCount">0 字</span>
        </div>
        <div class="tk-editor-split editor-split" id="ntSplit">
          <textarea id="tkContent" class="editor-area" rows="16" placeholder="用 Markdown 描述你的问题或建议…"></textarea>
          <div id="tkPreview" class="markdown-body preview-pane"></div>
        </div>
      </div>
      <div class="tk-new-foot">
        <button class="btn btn-sm" id="ntCancel">取消</button>
        <button class="btn btn-sm btn-primary" id="ntSave">提交工单</button>
      </div>
    </div>`;
  const ta = $('#tkContent'), pv = $('#tkPreview'), cat = $('#ntCat'), split = $('#ntSplit'), toolbar = box.querySelector('.tk-editor-toolbar');
  if (pf.title) $('#ntTitle').value = pf.title;
  ta.value = pf.content || '';
  if (preCat === 'bug' && !ta.value.trim()) ta.value = bugReportContent(null);
  cat.value = preCat;
  const hint = { bug: '🐞 已自动附带环境信息，补充「我当时的操作 / 期望结果」即可', suggestion: '💡 说说你的想法或改进建议', other: '💬 其它问题或咨询' };
  $('#ntCatHint').textContent = hint[preCat] || '';
  cat.onchange = () => {
    const c = cat.value;
    $('#ntCatHint').textContent = hint[c] || '';
    if (c === 'bug' && !ta.value.trim()) { ta.value = bugReportContent(null); ta.dispatchEvent(new Event('input')); }
  };
  $('#ntPreviewToggle').onclick = () => { split.classList.toggle('no-preview'); $('#ntPreviewToggle').classList.toggle('off', split.classList.contains('no-preview')); };
  bindMdEditor(ta, pv, toolbar, $('#ntCharCount'));
  $('#ntCancel').onclick = () => go('/tickets');
  $('#ntSave').onclick = async () => {
    const category = cat.value, title = $('#ntTitle').value.trim(), content = ta.value.trim();
    if (!content) return toast('请填写详细描述', 'err');
    const btn = $('#ntSave'); btn.disabled = true; btn.textContent = '提交中…';
    const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify({ category, title, content }) });
    btn.disabled = false; btn.textContent = '提交工单';
    if (r.ok) { toast('工单已提交', 'ok'); go('/tickets/' + r.data.code); }
    else toast(r.data?.message || r.data?.error || '提交失败', 'err');
  };
}



// ==================== 查看代码 / 在线编辑 / 审批部署 ====================
function diffLines(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: 'eq', x: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', x: A[i] }); i++; }
    else { out.push({ t: 'add', x: B[j] }); j++; }
  }
  while (i < n) { out.push({ t: 'del', x: A[i++] }); }
  while (j < m) { out.push({ t: 'add', x: B[j++] }); }
  return out;
}

async function renderAdminCode() {
  showView('admin-code');
  await loadMe();
  if (!isAdmin()) { $('#adminCodeBox').innerHTML = emptyHTML('code', '🚫 无权访问', `<p class="muted" style="margin:0">查看代码仅对站点管理员开放</p><a class="btn btn-primary btn-sm" href="/" data-link>回首页</a>`); return; }
  const isDev = state.me.role === 'developer';
  const canEdit = isDev || !!(state.me.admin_permissions && state.me.admin_permissions.edit_code);
  const modeTag = isDev ? '<span class="badge badge-code-edit">🛠 可编辑 · 直部署</span>'
    : canEdit ? '<span class="badge badge-code-edit">✏️ 可编辑 · 提交审批</span>'
    : '<span class="badge badge-code-ro">👁 只读查看</span>';
  const modeDesc = isDev ? '你是开发者，可直接编辑并<span class="gold">即刻部署</span>。'
    : canEdit ? '你被授予「编辑并提交代码」权限：改动会提交给开发者审批，通过后会自动部署。'
    : '你当前仅有<b>查看源码</b>权限，只能浏览，不能编辑。如需编辑，请让开发者在「用户 → 权限设置」中为你勾选 <b>编辑并提交代码</b>。';
  const box = $('#adminCodeBox');
  box.innerHTML = `
    <h1 class="clip-title">💻 查看代码 ${modeTag}</h1>
    <p class="muted">浏览 <b>yanzien/mdqp</b> 全部源码（实时来自 GitHub）。${modeDesc}</p>
    <div class="code-tabs">
      <button class="code-tab active" data-tab="browse">📂 代码浏览</button>
      <button class="code-tab" data-tab="review">📝 审批队列</button>
    </div>
    <div id="codeBrowse" class="code-layout">
      <div class="code-list-pane">
        <input id="codeSearch" class="input" placeholder="🔍 搜索文件…" style="margin-bottom:8px">
        <div id="codeFileList" class="code-filelist"><div class="muted">加载中…</div></div>
      </div>
      <div class="code-main-pane">
        <div id="codeToolbar" class="code-toolbar hidden"></div>
        <div id="codeView" class="code-view"><div class="muted" style="padding:24px">← 从左侧选择一个文件查看</div></div>
      </div>
    </div>
    <div id="codeReview" class="code-review hidden"></div>
  `;
  $$('#adminCodeBox .code-tab').forEach((b) => b.onclick = () => {
    $$('#adminCodeBox .code-tab').forEach((x) => x.classList.toggle('active', x === b));
    const tab = b.dataset.tab;
    $('#codeBrowse').classList.toggle('hidden', tab !== 'browse');
    $('#codeReview').classList.toggle('hidden', tab !== 'review');
    if (tab === 'review') loadCodeReview();
  });
  const search = $('#codeSearch');
  search.oninput = () => renderFileList(search.value.trim().toLowerCase());
  await loadCodeTree();
}

async function loadCodeTree() {
  const list = $('#codeFileList'); list.innerHTML = '<div class="muted">加载文件树…</div>';
  const { ok, data } = await api('/api/admin/code/tree');
  if (!ok) {
    if (data?.error === 'forbidden') list.innerHTML = '<div class="code-noperm">🚫 你没有被授予「查看代码」权限。<br>请让开发者在「管理后台 → 用户 → 权限设置」中为你勾选 <b>查看源码/编辑代码</b>。</div>';
    else list.innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '未知错误') + '</div>';
    return;
  }
  state.codeFiles = (data.files || []).slice().sort((a, b) => a.path.localeCompare(b.path));
  renderFileList('');
}

function renderFileList(filter) {
  const list = $('#codeFileList'); if (!list || !state.codeFiles) return;
  const items = state.codeFiles.filter((f) => !filter || f.path.toLowerCase().includes(filter));
  if (!items.length) { list.innerHTML = '<div class="muted">无匹配文件</div>'; return; }
  list.innerHTML = items.map((f) => `<div class="code-file ${state.codeCur && state.codeCur.path === f.path ? 'active' : ''}" data-path="${esc(f.path)}" title="${esc(f.path)}"><span class="cf-name">${esc(f.path)}</span><span class="cf-size">${f.size > 9999 ? (f.size / 1024).toFixed(0) + 'K' : f.path.split('/').pop()}</span></div>`).join('');
  $$('#codeFileList .code-file').forEach((el) => el.onclick = () => loadCodeFile(el.dataset.path));
}

async function loadCodeFile(path) {
  const { ok, data } = await api('/api/admin/code/file?path=' + encodeURIComponent(path));
  if (!ok) { $('#codeView').innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '') + '</div>'; return; }
  state.codeCur = { path, content: data.content, sha: data.sha };
  state.codeEditing = false;
  renderFileList(($('#codeSearch').value || '').trim().toLowerCase());
  renderCodeViewer();
}

function renderCodeViewer() {
  const cur = state.codeCur; if (!cur) return;
  const isDev = state.me.role === 'developer';
  const canEdit = isDev || !!(state.me.admin_permissions && state.me.admin_permissions.edit_code);
  const tb = $('#codeToolbar');
  tb.classList.remove('hidden');
  tb.innerHTML = `
    <span class="code-path">${esc(cur.path)}</span>
    <span class="muted">${cur.content.length} 字符</span>
    ${!canEdit && !state.codeEditing ? '<span class="badge badge-code-ro code-ro-tag">👁 只读</span>' : ''}
    <span class="code-actions">
      ${state.codeEditing ? '' : (canEdit ? '<button class="btn btn-sm" id="codeEditBtn">✏️ 编辑</button>' : '')}
      ${state.codeEditing ? '<button class="btn btn-sm" id="codePreviewBtn">👁 本地预览</button><button class="btn btn-sm btn-primary" id="codeSaveBtn">' + (isDev ? '🚀 直接部署' : '📨 提交审批') + '</button><button class="btn btn-sm btn-ghost" id="codeCancelBtn">取消</button>' : ''}
    </span>`;
  const view = $('#codeView');
  if (state.codeEditing) {
    view.innerHTML = `<textarea id="codeEditor" class="code-editor" spellcheck="false">${esc(cur.content)}</textarea><div id="codePreviewBox" class="code-preview hidden"></div>`;
    $('#codeEditBtn') && ($('#codeEditBtn').onclick = () => { state.codeEditing = true; renderCodeViewer(); });
    $('#codeCancelBtn').onclick = () => { state.codeEditing = false; renderCodeViewer(); };
    $('#codePreviewBtn').onclick = () => {
      const pb = $('#codePreviewBox'); pb.classList.toggle('hidden');
      if (!pb.classList.contains('hidden')) {
        const txt = $('#codeEditor').value;
        if (cur.path.endsWith('.md')) renderMd(pb, txt);
        else pb.innerHTML = '<pre class="code-pre">' + esc(txt) + '</pre>';
      }
    };
    $('#codeSaveBtn').onclick = applyOrSubmit;
  } else {
    const lang = (cur.path.split('.').pop() || '').toLowerCase();
    const pre = `<pre class="code-pre"><code class="language-${lang}" id="codeCode">${esc(cur.content)}</code></pre>`;
    view.innerHTML = pre;
    if (window.hljs) { try { window.hljs.highlightElement($('#codeCode')); } catch {} }
    $('#codeEditBtn').onclick = () => { state.codeEditing = true; renderCodeViewer(); };
  }
}

async function applyOrSubmit() {
  const cur = state.codeCur; if (!cur) return;
  const content = $('#codeEditor').value;
  const btn = $('#codeSaveBtn'); btn.disabled = true;
  const isDev = state.me.role === 'developer';
  const endpoint = isDev ? '/api/admin/code/apply' : '/api/admin/code/submit';
  const body = isDev ? { path: cur.path, content, sha: cur.sha, message: 'edit: ' + cur.path } : { path: cur.path, content, sha: cur.sha };
  const { ok, data } = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
  btn.disabled = false;
  if (ok) {
    if (isDev) toast('已写入 GitHub，Actions 正在自动部署…', 'ok');
    else toast(data?.overwritten ? '已覆盖之前的待审改动' : '已提交审批，等待开发者审核', 'ok');
    state.codeEditing = false; cur.content = content; renderCodeViewer();
  } else toast('失败：' + (data?.message || data?.error || '未知错误'), 'err');
}

async function loadCodeReview() {
  const box = $('#codeReview'); box.innerHTML = '<div class="muted">加载审批队列…</div>';
  const { ok, data } = await api('/api/admin/code/requests');
  if (!ok) { box.innerHTML = '<div class="muted">加载失败：' + esc(data?.message || data?.error || '') + '</div>'; return; }
  const list = data.requests || [];
  if (!list.length) { box.innerHTML = '<div class="muted">📭 暂无待审批的代码改动。</div>'; return; }
  const label = { pending: '待审批', approved: '已通过·已部署', rejected: '已驳回' };
  box.innerHTML = '<h2 class="clip-title" style="font-size:1.2em">📝 审批队列（' + list.length + '）</h2>' + list.map((r) => `
    <div class="ccr-item" data-id="${r.id}">
      <div class="ccr-head">
        <span class="badge ${r.status === 'pending' ? 'badge-collab' : r.status === 'approved' ? 'badge-lock' : 'badge-ghost'}">${label[r.status] || r.status}</span>
        <b>${esc(r.file_path)}</b>
        <span class="muted">${esc(r.author_name || '匿名')} · ${esc(timeAgo(r.updated_at))}</span>
      </div>
      ${r.admin_note ? `<div class="muted">处理备注：${esc(r.admin_note)}</div>` : ''}
      <div class="ccr-actions"><button class="btn btn-sm" data-diff="${r.id}">🔍 查看改动</button></div>
    </div>`).join('');
  $$('#codeReview [data-diff]').forEach((b) => b.onclick = () => openDiffModal(b.dataset.diff));
}

async function openDiffModal(id) {
  const { ok, data } = await api('/api/admin/code/diff?id=' + id);
  let current = '', proposed = '';
  if (ok) { current = data.current || ''; proposed = data.proposed || ''; }
  const diff = diffLines(current, proposed);
  const diffHtml = diff.map((d) => `<div class="diff-line diff-${d.t}">${d.t === 'del' ? '-' : d.t === 'add' ? '+' : ' '} ${esc(d.x)}</div>`).join('');
  const isDev = state.me.role === 'developer';
  const m = openModal('🔍 改动对比 #' + id, `
    <div class="diff-box">${diffHtml || '<div class="muted">无差异</div>'}</div>
    <label class="fb-label" style="margin-top:12px">最终内容（开发者可在此修改后通过，即「酌情采纳」）<span class="muted">提交审批的内容如下，可直接编辑</span>
      <textarea id="diffFinal" class="code-editor" style="min-height:160px" spellcheck="false">${esc(proposed)}</textarea>
    </label>
  `);
  if (isDev) {
    m.foot.innerHTML = `
      <button class="btn btn-ghost" id="diffReject">🚫 不允许（驳回）</button>
      <button class="btn btn-primary" id="diffApprove">✅ 通过并部署</button>`;
    $('#diffApprove').onclick = async () => {
      const finalContent = $('#diffFinal').value;
      const { ok: ok2, data: d2 } = await api('/api/admin/code/request/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'approved', final_content: finalContent, admin_note: '' }) });
      if (ok2) { toast('已应用并触发部署', 'ok'); closeModal(); loadCodeReview(); }
      else toast('失败：' + (d2?.message || d2?.error || ''), 'err');
    };
    $('#diffReject').onclick = async () => {
      const note = prompt('驳回原因（选填，将反馈给提交者）：', '') || '';
      const { ok: ok2, data: d2 } = await api('/api/admin/code/request/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', admin_note: note }) });
      if (ok2) { toast('已驳回', 'ok'); closeModal(); loadCodeReview(); }
      else toast('失败：' + (d2?.message || d2?.error || ''), 'err');
    };
  } else {
    m.foot.innerHTML = '<span class="muted">只有开发者可以审批并部署。</span>';
  }
}

// ==================== 命令面板 (⌘K) ====================
const cmdkState = { open: false, index: 0, items: [] };
function buildCmds() {
  const me = state.me; const cmds = [
    { icon: '🏠', label: '首页', hint: 'Home', run: () => go('/') },
    { icon: '＋', label: '新建剪贴板', hint: 'New', run: () => go('/new') },
    { icon: '👤', label: '我的', hint: 'Me', run: () => go('/me') },
    { icon: '❓', label: '帮助', hint: 'Help', run: () => go('/help') },
    { icon: '💬', label: '工单', hint: 'Tickets', run: () => go('/tickets') },
    { icon: '🐞', label: '上报最近一次报错', hint: 'Bug', run: () => goReportError(lastErr) },
    { icon: 'ℹ️', label: '关于', hint: 'About', run: () => go('/about') },
    { icon: '📝', label: '更新日志', hint: 'Log', run: () => go('/changelog') },
    { icon: '🌙', label: '切换主题', hint: 'Theme', run: () => $('#themeBtn').click() },
    { icon: '🎁', label: '邀请中心', hint: 'Invite', run: () => go('/invite') },
    { icon: '⭐', label: 'VIP 页面', hint: 'VIP', run: () => go('/vip') }
  ];
  if (me && me.type === 'user') { if (isAdmin()) cmds.splice(3, 0, { icon: '🛡', label: '管理后台', hint: 'Admin', run: () => go('/admin') }); cmds.push({ icon: '🚪', label: '退出登录', hint: 'Logout', run: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; } }); }
  else cmds.push({ icon: '🔑', label: '登录', hint: 'Login', run: () => { openAuthModal('login'); } });
  return cmds;
}
function highlight(text, q) { const t = String(text || ''); if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return esc(t); return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); }
function openCmdk() { if (cmdkState.open) return; cmdkState.open = true; $('#cmdk').classList.add('open'); const inp = $('#cmdkInput'); inp.value = ''; renderCmdk(''); inp.focus(); }
function closeCmdk() { cmdkState.open = false; $('#cmdk').classList.remove('open'); }
function renderCmdk(q) { const all = buildCmds(); const ql = q.trim().toLowerCase(); let items; if (ql) { items = all.filter((c) => (c.label + ' ' + c.hint).toLowerCase().includes(ql)); if (q.trim().length >= 3 && !items.length) items = [{ icon: '📎', label: '前往剪贴板「' + q.trim() + '」', hint: 'Jump', run: () => go('/c/' + encodeURIComponent(q.trim())) }]; } else { items = all; } cmdkState.items = items; cmdkState.index = 0; const list = $('#cmdkList'); if (!items.length) { list.innerHTML = '<div class="cmdk-empty">没有匹配的命令</div>'; return; } list.innerHTML = items.map((c, i) => `<button class="cmdk-item ${i === 0 ? 'active' : ''}" data-i="${i}"><span class="cmdk-ico">${c.icon}</span><span class="cmdk-label">${highlight(c.label, q.trim())}</span><span class="cmdk-kbd">${esc(c.hint)}</span></button>`).join(''); $$('#cmdk-list .cmdk-item').forEach((el) => { el.onmouseenter = () => setCmdkIndex(+el.dataset.i); el.onclick = () => execCmdk(+el.dataset.i); }); }
function setCmdkIndex(i) { const n = cmdkState.items.length; if (!n) return; cmdkState.index = (i + n) % n; $$('#cmdk-list .cmdk-item').forEach((el, idx) => el.classList.toggle('active', idx === cmdkState.index)); const active = $('#cmdk-list .cmdk-item.active'); if (active) active.scrollIntoView({ block: 'nearest' }); }
function execCmdk(i) { const item = cmdkState.items[i]; if (!item) return; closeCmdk(); item.run(); }
function setupCmdk() { $('#cmdkTrigger').onclick = openCmdk; $('#cmdkBackdrop').onclick = closeCmdk; $('#cmdkInput').oninput = (e) => renderCmdk(e.target.value); $('#cmdkInput').onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setCmdkIndex(cmdkState.index + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdkIndex(cmdkState.index - 1); } else if (e.key === 'Enter') { e.preventDefault(); execCmdk(cmdkState.index); } else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); } }; document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkState.open ? closeCmdk() : openCmdk(); } else if (e.key === 'Escape' && cmdkState.open && e.target !== $('#cmdkInput')) closeCmdk(); }); }

// ==================== Markdown / LaTeX / KaTeX 自动修复 ====================
function countOcc(s, sub) { let c = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { c++; i += sub.length; } return c; }

/** 尽量自动修复结构问题：未闭合代码块 / 数学定界符 / 加粗 / 删除线，清理行尾空白，并用 katex 校验公式 */
function autoFixMd(text) {
  const changes = [];
  let t = String(text || '');

  // 1) 代码块围栏 ``` 配对
  if (countOcc(t, '```') % 2 !== 0) { t += '\n```'; changes.push('检测到未闭合的代码块（``` 数量为奇数），已在末尾补上 ```'); }

  // 2) 保护 $$...$$ 块，处理剩余单 $
  const blocks = [];
  let i = 0;
  while ((i = t.indexOf('$$', i)) !== -1) {
    const j = t.indexOf('$$', i + 2);
    if (j === -1) break;
    blocks.push(t.slice(i, j + 2));
    const ph = ' MATHB' + (blocks.length - 1) + ' ';
    t = t.slice(0, i) + ph + t.slice(j + 2);
    i += ph.length;
  }
  if (countOcc(t, '$') % 2 !== 0) {
    const idx = t.lastIndexOf('$');
    if (idx >= 0) { t = t.slice(0, idx) + '\\$' + t.slice(idx + 1); changes.push('检测到奇数个行内 $（可能被误判为数学），已将最后一个转义为 \\$'); }
  }
  blocks.forEach((b, k) => { t = t.replace(' MATHB' + k + ' ', b); });

  // 3) 加粗 ** 配对
  if (countOcc(t, '**') % 2 !== 0) { t += '**'; changes.push('检测到未闭合的 **（加粗），已在末尾补上 **'); }
  // 4) 删除线 ~~ 配对
  if (countOcc(t, '~~') % 2 !== 0) { t += '~~'; changes.push('检测到未闭合的 ~~（删除线），已在末尾补上 ~~'); }

  // 5) 行尾空白清理 + 结尾换行
  const before = t;
  const newLines = t.split('\n').map((l) => { let x = l; while (x.endsWith(' ') || x.endsWith('\t')) x = x.slice(0, -1); return x; });
  t = newLines.join('\n');
  while (t.endsWith('\n')) t = t.slice(0, -1);
  t += '\n';
  if (t !== before) changes.push('已清理行尾多余空白并确保以换行结尾');

  // 6) 公式语法校验（katex）
  if (window.katex) {
    const snips = [];
    blocks.forEach((b) => snips.push(b.slice(2, -2)));
    let p = 0;
    while ((p = t.indexOf('$', p)) !== -1) {
      const q = t.indexOf('$', p + 1);
      if (q === -1) break;
      snips.push(t.slice(p + 1, q));
      p = q + 1;
    }
    for (const s of snips) {
      if (!s.trim()) continue;
      try { window.katex.renderToString(s, { throwOnError: true, displayMode: false }); }
      catch (e) { changes.push('⚠️ 公式可能语法有误：' + s.slice(0, 50) + '…（' + (e.message || '未知错误') + '）'); }
    }
  }

  if (!changes.length) changes.push('未发现明显可修复的结构问题，内容结构看起来正常。');
  return { text: t, changes };
}

function openFixer(prefill = '') {
  const modal = $('#fixerModal'); if (!modal) return;
  $('#fixerInput').value = prefill || '';
  $('#fixerOutput').value = '';
  $('#fixerChanges').classList.add('hidden'); $('#fixerChanges').innerHTML = '';
  modal.classList.remove('hidden');
  $('#fixerInput').focus();
}
function closeFixer() { $('#fixerModal')?.classList.add('hidden'); }

(function setupFixer() {
  const run = $('#fixerRun'); if (!run) return;
  const close = $('#fixerClose'), bd = $('#fixerBackdrop'), toEd = $('#fixerToEditor'), copy = $('#fixerCopy');
  run.onclick = () => {
    const { text, changes } = autoFixMd($('#fixerInput').value);
    $('#fixerOutput').value = text;
    const box = $('#fixerChanges'); box.classList.remove('hidden');
    box.innerHTML = '<b>修复记录：</b><ul>' + changes.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    toast('已尝试自动修复，请检查下方结果', 'ok');
  };
  close.onclick = closeFixer; if (bd) bd.onclick = closeFixer;
  toEd.onclick = () => {
    const out = $('#fixerOutput').value; const ta = $('#edContent');
    if (ta && out) { ta.value = out; ta.dispatchEvent(new Event('input')); toast('已填入编辑器', 'ok'); }
    else toast('没有可填入的修复结果', 'err');
  };
  copy.onclick = async () => {
    const out = $('#fixerOutput').value; if (!out) return;
    try { await navigator.clipboard.writeText(out); toast('已复制修复结果', 'ok'); } catch { toast('复制失败，请手动选择', 'err'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#fixerModal')?.classList.contains('hidden')) closeFixer(); });
})();

// ============ 登录 / 注册弹窗（cpoauth 兜底：账号密码） ============
let authMode = 'login';
let authMethods = { cpoauth: true, password: true };

async function loadAuthMethods() {
  try { const { data } = await api('/api/auth/methods', { silent: true }); if (data) authMethods = data; } catch {}
}

/** 按 cpoauth 可用状态切换「第三方登录按钮 / 降级横幅」
 *  - 可用：按钮正常、横幅隐藏
 *  - 不可用：按钮置灰 + tooltip（不隐藏，避免用户以为功能消失），并按登录态给出三步自救指引 */
function applyCpoauthState(ok) {
  const cpoBtn = $('#authCpoauthBtn');
  const banner = $('#authBanner');
  const me = state.me || {};
  if (ok) {
    if (cpoBtn) { cpoBtn.classList.remove('is-disabled'); cpoBtn.removeAttribute('aria-disabled'); cpoBtn.removeAttribute('title'); cpoBtn.onclick = null; }
    if (banner) banner.classList.add('hidden');
    return;
  }
  // cpoauth 不可用：按钮置灰 + tooltip，点击拦截并提示
  if (cpoBtn) {
    cpoBtn.classList.add('is-disabled');
    cpoBtn.setAttribute('aria-disabled', 'true');
    cpoBtn.title = 'cpoauth 暂时不可用，请使用账号密码登录';
    cpoBtn.onclick = (e) => { e.preventDefault(); toast('第三方登录（cpoauth）暂时不可用，请使用账号密码'); };
  }
  if (!banner) return;
  banner.classList.remove('hidden');
  // 已登录但没设密码 → 引导立即设置密码（避免下次彻底进不来）
  if (me.type === 'user' && me.has_password === false) {
    banner.innerHTML = `⚠️ 第三方登录（cpoauth）暂时不可用。建议你 <b>立即设置登录密码</b>，避免下次无法进入。 <button type="button" class="banner-link" id="authBannerSetPw">立即设置</button>`;
    const sp = $('#authBannerSetPw'); if (sp) sp.onclick = () => openSetPwModal();
  } else {
    // 未登录 / 已设密码：提示走密码，给无法自救者的兜底入口
    banner.innerHTML = `⚠️ 第三方登录（cpoauth）暂时不可用，请使用账号密码登录或注册。若你 <b>还没设密码且无法登录</b>，可查看 <a class="banner-link" href="/c/loginhelp" target="_blank" rel="noopener">登录帮助</a> 或联系站长。`;
  }
}

// O1-1：oiwb 跨站账号互通目标站（oiwb 部署到 Pages 后启用；改这里即可切换地址）
const OIWB_BASE = 'https://oiwb.pages.dev';

// O1-1：已登录用户点「去 oiwb」→ 后台签 5 分钟一次性短票 → 跳 oiwb 自动登录
async function goOiwb() {
  if (!state.me || state.me.type !== 'user') { openAuthModal('login'); toast('登录后可直接跳 oiwb 并自动登录', 'info'); return; }
  toast('正在签发登录凭证…', 'info');
  const { ok, data } = await api('/api/auth/ticket', { method: 'POST' });
  if (!ok || !data || !data.ticket) { toast('签发失败，请稍后重试', 'err'); return; }
  location.href = OIWB_BASE + '?ticket=' + encodeURIComponent(data.ticket);
}

// O1-1 反向闭环：从 oiwb 带 back=oiwb 跳来 → 登录后一键回 oiwb 自动登录
function handleOiwbBack() {
  if (!state.me || state.me.type !== 'user') {
    openAuthModal('login');
    toast('登录 mdqp 后自动回 oiwb', 'info');
  } else {
    showOiwbBackBanner();
  }
}
function showOiwbBackBanner() {
  let b = document.getElementById('oiwbBackBanner');
  if (b) return;
  b = document.createElement('div');
  b.id = 'oiwbBackBanner';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:12px;padding:9px 16px;background:#1f4e79;color:#fff;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.25)';
  b.innerHTML = '<span>已登录 mdqp · 点此一键回 oiwb 并自动登录</span><button id="oiwbBackBtn" style="background:#fff;color:#1f4e79;border:none;border-radius:6px;padding:6px 14px;font-weight:600;cursor:pointer;">↩ 回 oiwb</button>';
  document.body.appendChild(b);
  const btn = document.getElementById('oiwbBackBtn');
  if (btn) btn.onclick = goOiwb;
}

function openAuthModal(mode = 'login') {
  authMode = mode || 'login';
  const modal = $('#authModal'); if (!modal) return;
  applyCpoauthState(authMethods.cpoauth !== false); // 先按已知配置乐观渲染，避免弹窗闪烁
  setAuthMode(authMode);
  modal.classList.remove('hidden'); modal.classList.add('show');
  setTimeout(() => $('#authUsername')?.focus(), 50);
  // 打开后再做一次真实连通性探测：cpoauth 宕机时自动隐藏按钮并提示走密码登录（v4.7.5 静默，失败不弹大窗）
  api('/api/auth/cpoauth-status', { silent: true })
    .then(({ data }) => { if (data && typeof data.ok === 'boolean') applyCpoauthState(data.ok); })
    .catch(() => {});
}
function closeAuthModal() {
  const modal = $('#authModal'); if (!modal) return;
  modal.classList.remove('show'); modal.classList.add('hidden');
  $('#authError')?.classList.add('hidden');
}
function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  $('#authTabLogin')?.classList.toggle('active', login);
  $('#authTabRegister')?.classList.toggle('active', !login);
  const t = $('#authTitle'); if (t) t.textContent = login ? '🔐 登录 mdqp' : '📝 注册 mdqp';
  const s = $('#authSubmit'); if (s) s.textContent = login ? '登录' : '注册并登录';
  const p = $('#authPassword'); if (p) p.setAttribute('autocomplete', login ? 'current-password' : 'new-password');
}
async function submitAuth(e) {
  e.preventDefault();
  const username = ($('#authUsername').value || '').trim();
  const password = ($('#authPassword').value || '');
  const errBox = $('#authError'); if (errBox) errBox.classList.add('hidden');
  if (!username || !password) { if (errBox) { errBox.textContent = '请输入用户名和密码'; errBox.classList.remove('hidden'); } return; }
  // 注册时携带 URL 中的邀请码
  const invite = new URLSearchParams(location.search).get('invite_code') || '';
  if (authMode === 'register') {
    const r = await api('/api/auth/password/register', { method: 'POST', body: JSON.stringify({ username, password, invite_code: invite }) });
    if (r.ok) { toast('注册成功，已登录'); location.reload(); }
    else if (errBox) { errBox.textContent = r.data?.message || r.data?.error || '注册失败'; errBox.classList.remove('hidden'); }
  } else {
    const r = await api('/api/auth/password/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (r.ok) { toast('登录成功'); location.reload(); }
    else if (errBox) { errBox.textContent = r.data?.message || r.data?.error || '登录失败'; errBox.classList.remove('hidden'); }
  }
}
function setupAuthModal() {
  const modal = $('#authModal'); if (!modal) return;
  $('#authClose').onclick = closeAuthModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
  $('#authTabLogin').onclick = () => setAuthMode('login');
  $('#authTabRegister').onclick = () => setAuthMode('register');
  $('#authForm').onsubmit = submitAuth;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeAuthModal(); });
}

// ============ 设置登录密码（统一弹窗） ============
function openSetPwModal() {
  const modal = $('#setPwModal'); if (!modal) return;
  const uname = (state.me && state.me.username) || '';
  const nameInput = $('#setPwUsername'); if (nameInput) nameInput.value = uname;
  const desc = $('#setPwDesc');
  if (desc) {
    desc.innerHTML = uname
      ? `设置后，即使第三方登录（cpoauth）不可用，你也能用 <b>${esc(uname)}</b> + 这个密码登录。`
      : '设置后，即使第三方登录（cpoauth）不可用，你也能用<b>用户名 + 密码</b>登录。';
  }
  const err = $('#setPwError'); if (err) { err.classList.add('hidden'); err.textContent = ''; }
  const suc = $('#setPwSuccess'); if (suc) { suc.textContent = ''; suc.style.color = ''; }
  modal.classList.remove('hidden'); modal.classList.add('show');
  setTimeout(() => $('#setPwInput')?.focus(), 50);
}

function closeSetPwModal() {
  const modal = $('#setPwModal'); if (!modal) return;
  modal.classList.remove('show'); modal.classList.add('hidden');
  const f = $('#setPwForm'); if (f) f.reset();
  const err = $('#setPwError'); if (err) { err.classList.add('hidden'); err.textContent = ''; }
  const suc = $('#setPwSuccess'); if (suc) { suc.textContent = ''; suc.style.color = ''; }
}

async function submitSetPassword(e) {
  e.preventDefault();
  const pw = ($('#setPwInput')?.value) || '';
  const pw2 = ($('#setPwInput2')?.value) || '';
  const err = $('#setPwError'); const suc = $('#setPwSuccess');
  const fail = (t) => { if (err) { err.textContent = t; err.classList.remove('hidden'); } if (suc) suc.textContent = ''; };
  if (pw.length < 6) return fail('密码至少 6 位');
  if (pw.length > 128) return fail('密码最多 128 位');
  if (pw !== pw2) return fail('两次输入的密码不一致');

  const btn = $('#setPwSubmit');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  const r = await api('/api/auth/password/set', { method: 'POST', body: JSON.stringify({ password: pw }) });
  if (btn) { btn.disabled = false; btn.textContent = '保存密码'; }
  if (!r.ok) return fail('保存失败：' + (r.data?.message || r.data?.error || r.status));

  // 本地状态立刻同步，避免要刷新页面才看到"已设置"
  if (state.me) state.me.has_password = true;
  hidePwGuide();
  if (err) { err.classList.add('hidden'); err.textContent = ''; }
  if (suc) { suc.textContent = '✅ 密码已保存'; suc.style.color = 'var(--primary)'; }
  toast('密码已设置，cpoauth 宕机时也能登录');
  setTimeout(() => { closeSetPwModal(); render(); }, 900);
}

function setupSetPwModal() {
  const modal = $('#setPwModal'); if (!modal) return;
  $('#setPwClose').onclick = closeSetPwModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSetPwModal(); });
  $('#setPwForm').onsubmit = submitSetPassword;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeSetPwModal(); });
}

// ============ 刷新引导（统一：未绑 cpoauth → 建议绑定；已绑未设密码 → 建议设密码） ============
const RG_SNOOZE_KEY = 'mdqp_guide_snooze_until';
const RG_NEVER_KEY = 'mdqp_guide_never';
const RG_SNOOZE_MS = 24 * 3600000; // "稍后"后 1 天不再打扰
const CPOAUTH_OK_KEY = 'mdqp_cpoauth_ok';
const CPOAUTH_OK_TTL = 10 * 60000; // 状态探测结果缓存 10 分钟，避免每次刷新都打 cpoauth

/** 带本地缓存的 cpoauth 可用状态探测（防重复请求浪费） */
async function getCpoauthStatus() {
  try {
    const raw = localStorage.getItem(CPOAUTH_OK_KEY);
    if (raw) { const o = JSON.parse(raw); if (Date.now() - o.t < CPOAUTH_OK_TTL) return o.ok; }
  } catch {}
  try {
    const { data } = await api('/api/auth/cpoauth-status', { silent: true });
    const ok = !!(data && data.ok);
    try { localStorage.setItem(CPOAUTH_OK_KEY, JSON.stringify({ ok, t: Date.now() })); } catch {}
    return ok;
  } catch { return null; }
}

function hideRefreshGuide() { const m = $('#refreshGuideModal'); if (m) { m.classList.remove('show'); m.classList.add('hidden'); } }
// 兼容旧调用（设密码成功后关闭引导）
function hidePwGuide() { hideRefreshGuide(); }

function checkRefreshGuide() {
  const me = state.me || {};
  if (me.type !== 'user') return;
  if (localStorage.getItem(RG_NEVER_KEY) === '1' || me.no_cpoauth_nudge) return; // 已选"不再提示"
  const snooze = Number(localStorage.getItem(RG_SNOOZE_KEY) || 0);
  if (snooze && Date.now() < snooze) return; // 稍后中
  const needBind = !me.cpoauth_bound;
  const needPw = me.cpoauth_bound && me.has_password === false;
  if (!needBind && !needPw) return;
  if (needBind) {
    // 仅当 cpoauth 确实可用才提示绑定（宕机走 P0-3 自救，不叠加打扰）
    getCpoauthStatus().then((ok) => { if (ok === true) showRefreshGuide('bind'); });
  } else {
    showRefreshGuide('pw');
  }
}

function showRefreshGuide(kind) {
  const m = $('#refreshGuideModal'); if (!m) return;
  const title = $('#rgTitle'), icon = $('#rgIcon'), text = $('#rgText'), primary = $('#rgPrimary'), secondary = $('#rgSecondary');
  if (kind === 'bind') {
    title.textContent = '绑定 cpoauth，解锁战绩同步';
    icon.textContent = '🔑';
    text.innerHTML = '绑定后可用竞赛账号一键登录，并自动同步你的 <b>洛谷 / Codeforces / AtCoder</b> 等战绩。';
    primary.textContent = '立即绑定';
    primary.onclick = () => { location.href = '/api/auth/login'; };
    secondary.classList.remove('hidden'); secondary.href = '/c/loginhelp?from=mdqp';
  } else {
    title.textContent = '设置登录密码';
    icon.textContent = '🛡️';
    text.innerHTML = '你已绑定 cpoauth，但<b>还没设密码</b>。cpoauth 一旦宕机，密码是你唯一的备用入口。';
    primary.textContent = '设置密码';
    primary.onclick = () => { hideRefreshGuide(); openSetPwModal(); };
    secondary.classList.add('hidden');
  }
  m.classList.remove('hidden'); m.classList.add('show');
}

function setupRefreshGuide() {
  const m = $('#refreshGuideModal'); if (!m) return;
  $('#rgClose').onclick = () => { localStorage.setItem(RG_SNOOZE_KEY, String(Date.now() + RG_SNOOZE_MS)); hideRefreshGuide(); };
  m.addEventListener('click', (e) => { if (e.target === m) { localStorage.setItem(RG_SNOOZE_KEY, String(Date.now() + RG_SNOOZE_MS)); hideRefreshGuide(); } });
  $('#rgLater').onclick = () => { localStorage.setItem(RG_SNOOZE_KEY, String(Date.now() + RG_SNOOZE_MS)); hideRefreshGuide(); };
  $('#rgNever').onclick = async () => {
    localStorage.setItem(RG_NEVER_KEY, '1');
    try { await api('/api/me', { method: 'PATCH', body: JSON.stringify({ no_cpoauth_nudge: true }) }); } catch {}
    if (state.me) state.me.no_cpoauth_nudge = true;
    hideRefreshGuide();
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) hideRefreshGuide(); });
}

// ============ 设置弹窗（通用 / 账号与安全） ============
function openSettingsModal() {
  const me = state.me; if (!me || me.type !== 'user') return;
  const m = $('#settingsModal'); if (!m) return;
  // 通用
  $('#setSig').value = me.signature || '';
  $('#setBio').value = me.bio || '';
  $('#setTheme').value = localStorage.getItem('mdqp_theme') || 'auto';
  // 账号与安全
  $('#secPwText').textContent = me.has_password ? '已设置' : '未设置（cpoauth 宕机时无法进入）';
  $('#secCpText').textContent = me.cpoauth_bound ? '已绑定' : '未绑定';
  $('#secEmailText').textContent = me.email ? (me.email_verified ? me.email + '（已验证）' : me.email + '（未验证）') : '未提供';
  $('#secTlText').textContent = 'L' + (me.trust_level || 0) + ' · ' + ['新手上路', '常驻用户', '活跃用户', '核心用户'][me.trust_level || 0];
  const curSrc = me.source ? (SOURCE_LABEL[me.source] || me.source) : '未填写';
  $('#secSourceText').textContent = curSrc + (me.source_detail ? '（' + me.source_detail + '）' : '');
  renderTrustProgress($('#secTlProgress'), me.trust_progress);
  $('#secSetPw').textContent = me.has_password ? '修改' : '设置';
  $('#secBind').textContent = me.cpoauth_bound ? '管理' : '去绑定';
  $('#secBind').onclick = () => {
    if (me.cpoauth_bound) { window.open('https://www.cpoauth.com/profile', '_blank', 'noopener'); return; }
    m.classList.remove('show'); m.classList.add('hidden');
    location.href = '/api/auth/login?link=1';
  };
  m.classList.remove('hidden'); m.classList.add('show');
  showSettingsTab('general');
  setTimeout(() => $('#setSig')?.focus(), 50);
}
/** 信任等级进度（v4.5.2 维持制：不达标会自动回落） */
function renderTrustProgress(el, tp) {
  if (!el) return;
  if (!tp) { el.innerHTML = '<span class="muted">刷新后可见进度</span>'; return; }
  const stat = `近 14 天新建 ${tp.clips_14d} 个 · 近 5 天新建 ${tp.clips_5d} 个 · 已邀请 ${tp.invite_count} 人`;
  if (!tp.missing || !tp.missing.length) {
    el.innerHTML = `<div class="tl-ok">已达最高等级 L3 核心用户 🎉</div><div class="tl-next">${esc(stat)}</div>`;
    return;
  }
  el.innerHTML = `<div>${esc(stat)}</div><div class="tl-next">升到 L${tp.level + 1}（${esc(tp.next_rule || '')}）还需：<ul>${tp.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    + '<div class="tl-next">等级为维持制：不达标会自动回落（不会发降级通知）。</div>';
}

function showSettingsTab(which) {
  const general = which === 'general';
  $('#setTabGeneral').classList.toggle('active', general);
  $('#setTabSecurity').classList.toggle('active', !general);
  $('#setPaneGeneral').classList.toggle('hidden', !general);
  $('#setPaneSecurity').classList.toggle('hidden', general);
}
function setupSettingsModal() {
  const m = $('#settingsModal'); if (!m) return;
  $('#settingsClose').onclick = closeSettingsModal;
  m.addEventListener('click', (e) => { if (e.target === m) closeSettingsModal(); });
  $('#setTabGeneral').onclick = () => showSettingsTab('general');
  $('#setTabSecurity').onclick = () => showSettingsTab('security');
  $('#setSaveGeneral').onclick = async () => {
    const sig = $('#setSig').value, bio = $('#setBio').value, theme = $('#setTheme').value;
    localStorage.setItem('mdqp_theme', theme); applyTheme(theme);
    const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ signature: sig, bio }) });
    if (r.ok) { toast('已保存'); if (state.me) { state.me.signature = sig; state.me.bio = bio; } renderMe(); }
    else toast('保存失败：' + (r.data?.error || r.status), 'err');
  };
  $('#secSetPw').onclick = () => { closeSettingsModal(); openSetPwModal(); };
  $('#secSourceEdit').onclick = () => { closeSettingsModal(); showSourceModal(); };
  $('#secLogout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) closeSettingsModal(); });
}
function closeSettingsModal() { const m = $('#settingsModal'); if (m) { m.classList.remove('show'); m.classList.add('hidden'); } }

// 战绩概览：best-effort 渲染 cp:summary 数据结构（兼容多种返回形态）
function renderCpSummary(data) {
  if (!data) return '<p class="muted">暂无可展示的战绩数据（可能未绑定 Clist.by）。</p>';
  let arr = Array.isArray(data.platforms) ? data.platforms
    : Array.isArray(data) ? data : null;
  if (!arr) {
    const known = ['luogu', 'codeforces', 'atcoder', 'clist'];
    arr = known.filter((p) => data[p]).map((p) => Object.assign({ platform: p }, data[p]));
  }
  if (!arr || !arr.length) return '<p class="muted">暂无可展示的战绩数据（可能未绑定 Clist.by）。</p>';
  return `<div class="cp-summary-grid">${arr.map((p) => {
    const meta = PLATFORM_META[p.platform] || { name: p.platform, color: 'var(--primary)' };
    return `<div class="cp-stat" style="--lc:${meta.color}">
      <span class="cp-stat-name">${esc(meta.name)}</span>
      <span class="cp-stat-rating">${p.rating != null ? esc(String(p.rating)) : '—'}</span>
      <span class="cp-stat-sub">最高 ${p.max_rating != null ? esc(String(p.max_rating)) : '—'} · ${p.contests != null ? esc(String(p.contests)) : '?'} 场</span>
    </div>`;
  }).join('')}</div>`;
}

// ==================== 通知系统 ====================
let notifCat = '';
const NOTIF_CATS = {
  trust: { label: '信用', cls: 'notif-cat-trust' },
  clip_expiry: { label: '到期', cls: 'notif-cat-expiry' },
  clip_visited: { label: '访问', cls: 'notif-cat-visited' },
  admin: { label: '管理', cls: 'notif-cat-admin' },
  ticket: { label: '工单', cls: 'notif-cat-ticket' },
  comment: { label: '评论', cls: 'notif-cat-comment' }
};
function notifCatTag(cat) {
  const m = NOTIF_CATS[cat] || { label: cat || '其它', cls: '' };
  return `<span class="notif-tag ${m.cls}">${esc(m.label)}</span>`;
}

async function refreshNotifBadge() {
  const bell = $('#notifBell'); if (!bell) return;
  if (!state.me || state.me.type !== 'user') { bell.classList.add('hidden'); return; }
  bell.classList.remove('hidden');
  const { data } = await api('/api/notifications');
  if (!data) return;
  const badge = $('#notifBadge'); const n = data.unread || 0;
  if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

async function loadNotifList() {
  const list = $('#notifList'); if (!list) return;
  const { data } = await api('/api/notifications' + (notifCat ? '?category=' + encodeURIComponent(notifCat) : ''));
  if (!data) {
    list.innerHTML = '<div class="notif-empty" id="notifRetry" style="cursor:pointer">加载失败，点击重试</div>';
    const rt = $('#notifRetry'); if (rt) rt.onclick = () => loadNotifList();
    return;
  }
  const ns = data.notifications || [];
  if (!ns.length) { list.innerHTML = '<div class="notif-empty">暂无通知</div>'; return; }
  list.innerHTML = ns.map((n) => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
      <div class="notif-item-top">${notifCatTag(n.category)}<span class="notif-time">${timeAgo(n.created_at)}</span></div>
      <div class="notif-item-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-item-body">${esc(n.body)}</div>` : ''}
    </div>`).join('');
  list.querySelectorAll('.notif-item').forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id, link = el.dataset.link;
      if (el.classList.contains('unread')) {
        await api('/api/notifications/' + id + '/read', { method: 'POST' });
        el.classList.remove('unread');
      }
      if (link) { closeNotifPanel(); go(link); }
      refreshNotifBadge();
    };
  });
}

function toggleNotifPanel() {
  const panel = $('#notifPanel'); if (!panel) return;
  if (panel.classList.contains('hidden')) { panel.classList.remove('hidden'); loadNotifList(); }
  else panel.classList.add('hidden');
}
function closeNotifPanel() { const p = $('#notifPanel'); if (p) p.classList.add('hidden'); }

function setupNotifBell() {
  const bell = $('#notifBell'); if (!bell) return;
  bell.onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
  const panel = $('#notifPanel');
  document.addEventListener('click', (e) => {
    if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== bell && !bell.contains(e.target)) closeNotifPanel();
  });
  const readAll = $('#notifReadAll');
  if (readAll) readAll.onclick = async (e) => { e.stopPropagation(); await api('/api/notifications/read-all', { method: 'POST' }); loadNotifList(); refreshNotifBadge(); };
  const filters = $('#notifFilters');
  if (filters) filters.querySelectorAll('.notif-filter').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      filters.querySelectorAll('.notif-filter').forEach((x) => x.classList.remove('active'));
      b.classList.add('active'); notifCat = b.dataset.cat || ''; loadNotifList();
    };
  });
}

// ==================== 启动 ====================
document.addEventListener('click', (e) => { const a = e.target.closest('a[data-link]'); if (a && a.getAttribute('href')?.startsWith('/')) { e.preventDefault(); go(a.getAttribute('href')); } });
window.addEventListener('popstate', render);

(async function init() {
  // 低版本浏览器：已弹出引导弹窗，跳过 SPA 初始化（避免现代语法报错白屏）
  if (window.__MDQP_LEGACY) return;
  initTheme(); const mt = $('#menuToggle'); if (mt) mt.onclick = () => document.body.classList.toggle('nav-open');
  const ov = $('#navOverlay'); if (ov) ov.onclick = closeNav; setupCmdk();
  setupAuthModal(); loadAuthMethods();
  setupSetPwModal(); setupRefreshGuide(); setupSettingsModal(); setupNotifBell();
  const navOiwb = $('#navOiwb'); if (navOiwb) navOiwb.onclick = (e) => { e.preventDefault(); goOiwb(); };
  installErrorReporter(); // v4.5.2：报错自动捕获 + 一键反馈
  // 侧边栏折叠（仅桌面生效，状态持久化）
  // 侧边栏（v4.7.5 反馈 #6②）：钉住=常驻展开；未钉住=折叠，鼠标靠近左缘自动展开、移开收起
  const SIDEBAR_PIN_KEY = 'mdqp_sidebar_pinned';
  let sbPinned = true;
  try { sbPinned = localStorage.getItem(SIDEBAR_PIN_KEY) !== '0'; } catch (_) {}
  const applySidebar = () => {
    document.body.classList.toggle('sidebar-collapsed', !sbPinned);
    if (!sbPinned) document.body.classList.remove('sidebar-peek');
    const st2 = $('#sidebarToggle');
    if (st2) {
      st2.title = sbPinned ? '已钉住：点击改为悬浮（靠近左侧自动展开）' : '已悬浮：点击钉住侧边栏';
      st2.setAttribute('aria-label', st2.title);
      const lbl = st2.querySelector('.nav-label');
      if (lbl) lbl.textContent = sbPinned ? '已钉住 · 点击改悬浮' : '已悬浮 · 点击钉住';
    }
  };
  applySidebar();
  const st = $('#sidebarToggle');
  if (st) {
    st.onclick = () => {
      sbPinned = !sbPinned;
      try { localStorage.setItem(SIDEBAR_PIN_KEY, sbPinned ? '1' : '0'); } catch (_) {}
      applySidebar();
    };
  }
  // 悬浮模式：未钉住时，鼠标移入侧边栏（含折叠态的窄条）即展开，移出即收起。
  // 用 mouseenter/mouseleave（不冒泡、子元素不触发抖动）替代 mousemove+clientX 阈值，消除边界抖动。
  const sbEl = document.querySelector('.sidebar');
  if (sbEl) {
    const peekOn = () => { if (sbPinned || window.innerWidth < 861) return; document.body.classList.add('sidebar-peek'); };
    const peekOff = () => { if (sbPinned || window.innerWidth < 861) return; document.body.classList.remove('sidebar-peek'); };
    sbEl.addEventListener('mouseenter', peekOn);
    sbEl.addEventListener('mouseleave', peekOff);
  }
  const sp = new URLSearchParams(location.search);
  if (sp.get('logged_in')) { toast('登录成功'); history.replaceState({}, '', location.pathname); }
  if (sp.get('error')) { const m = { state_mismatch: '登录校验失败，请重试', token_failed: '换取令牌失败，检查 cpoauth 回调地址配置', userinfo_failed: '获取用户信息失败', oauth_not_configured: '尚未配置 cpoauth 凭据', pkce_missing: '会话丢失，请重新登录' }; toast(m[sp.get('error')] || '登录失败：' + sp.get('error'), 'err'); history.replaceState({}, '', location.pathname); }
  // v4.0: 如果有邀请码参数且已登录，尝试绑定
  const inviteCode = sp.get('invite_code');
  if (inviteCode && sp.get('logged_in')) { setTimeout(() => bindInvite(inviteCode), 1500); }
  await loadMe(); render();
  // v4.10: 补 DAU 埋点（page.view）。同会话只报一次，真实去重在服务端再做 5 分钟节流
  trackPageView();
  // v4.10: 首次登录后询问用户来源渠道（已填写/已跳过则不再问）
  maybeAskSource();
  window.__MDQP_BOOTED = 1; // 兜底横幅的看门狗依据：初始化跑完就不再提示
  // O1-1 反向闭环：oiwb 带 back=oiwb 跳来 → 未登录弹登录框，已登录显示一键回 oiwb
  const backParam = new URLSearchParams(location.search).get('back');
  if (backParam === 'oiwb') handleOiwbBack();
})();
