# mdqptest 测试站（独立数据库 · 口令门）

主站的**完整克隆**，用于上线前测试。数据与主站**完全隔离**，互不影响。

## 线上地址
**https://mdqptest.pages.dev** · 口令 `mdqptest123456` · 站长账号 `yanzien`（密码同为 `mdqptest123456`）

| | 主站 | 测试站 |
|---|---|---|
| 域名 | mdqp.pages.dev | **mdqptest.pages.dev** |
| Pages 项目 | mdqp | **mdqptest** |
| D1 | mdqp-db (`e334728b…`) | **mdqp-test-db** (`189ff018-…`) |
| KV | SITE_KV (`467c52a6…`) | **SITE_KV_TEST** (`3734c278…`) |
| 访问 | 公开 | **需口令** |
| 版本 | 4.29.1 | 4.29.1（代码同源） |

## 口令门安全设计
- 口令**不明文存于源码**，只存 `SHA-256('mdqptest123456')`。
- 口令页由 worker 内联返回（`mdqptest/gate.js`），不依赖静态资源，所以未进门也能看到门页。
- 校验通过 → 签发 **HMAC-SHA256 签名令牌**（7 天有效）→ 存 localStorage → 之后每个请求带 `X-Gate-Token`。
- 令牌签名密钥绑定口令哈希，无法伪造/反推口令。伪造令牌已验证返回 401。
- 已验证：未带令牌 `/` → 401 门页；正确口令 → 200 + token；错误口令 → 401；带令牌 → 应用正常。

## ⚠️ schema 生成（重要）

`mdqptest/schema.sql` **不要手改**，由脚本生成：

```bash
node scripts/gen-test-schema.mjs
```

原因：`database_init.sql` 的 `CREATE TABLE` 里已含 `password_hash` 等列，而历史
`migrate_*.sql` 里还有对同一列的 `ALTER ADD COLUMN`。主站是分批迁移的、从不重放全量，
所以没暴露问题；但**全新库一次性建表会直接报 `duplicate column name`**。
脚本会先建「表 → 已定义列」索引，再自动剔除重复的 `ALTER`（当前剔除 23 条、保留 27 条）。

## 重建测试库（从零）
```bash
NODE="C:/Users/xinyu6290/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
cd "C:/Users/xinyu6290/WorkBuddy/2026-08-13-20-39-22/mdqp"

$NODE scripts/gen-test-schema.mjs
$NODE node_modules/wrangler/bin/wrangler.js d1 execute mdqp-test-db --remote --file=mdqptest/schema.sql
$NODE node_modules/wrangler/bin/wrangler.js d1 execute mdqp-test-db --remote --file=mdqptest/seed.sql
$NODE scripts/build-test-pages.mjs
$NODE node_modules/wrangler/bin/wrangler.js pages deploy pages-build-test --project-name mdqptest --commit-dirty=true --skip-caching
```

⚠️ 首次还需 `wrangler pages project create mdqptest --production-branch main`（已创建过）。

## 注意
- 测试站**可以正常注册账号**，但受 v4.29 注册节流与敏感词拦截约束（同设备 1h 一个）。
- 每次改主站代码后，要重新跑 `build-test-pages.mjs` + deploy 测试站才能同步。
- 测试站会**独立消耗一份 D1 免费读配额**，别在上面压测。
- 登录走密码即可；`CPOAUTH_CLIENT_ID/SECRET` 未配置，不影响密码注册登录。