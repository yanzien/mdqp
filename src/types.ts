/**
 * Cloudflare Worker bindings 类型定义
 */

interface Env {
  // D1 数据库
  db: D1Database;

  // cpoauth OAuth 凭据（通过 wrangler secret put 设置）
  CPOAUTH_CLIENT_ID: string;
  CPOAUTH_CLIENT_SECRET: string;
}

export type Bindings = Env;
