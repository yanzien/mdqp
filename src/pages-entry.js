// mdqp on Cloudflare Pages — catch-all 路由入口
// 构建时会被复制为 pages-build/functions/[[path]].js
//
// Hono app 自身已注册 `app.all('*')`：
//   1) /api/* 等接口路由先匹配；
//   2) 其余请求由 SPA 回退逻辑用 env.ASSETS 伺服静态资源（style.css/app.js/图片/验证 txt），
//      找不到文件再回退 index.html。
// 因此这里只需把整个请求交给 Hono，无需自行实现 SPA 回退，避免静态资源被误判。
import app from './_lib/app.js';

export async function onRequest(context) {
  const { request, env } = context;
  // Hono.fetch(request, env, executionCtx)：env 含 ASSETS 绑定、db(D1)、CPOAUTH_* 等 Secret
  return app.fetch(request, env, context);
}
