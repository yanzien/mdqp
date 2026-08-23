# mdqp — Markdown Quickly Paste

> **Markdown 快速剪贴板** — 用 cpoauth 登录，快速新建、编辑、分享 Markdown 剪贴板。

## 功能

- **cpoauth OAuth 登录**（推荐）— 用算法竞赛统一身份一键登录，安全无密码
- **手动注册/登录**（⚠️ 不安全，仅供测试）
- **Markdown 剪贴板 CRUD** — 新建、编辑、预览（实时渲染）、删除
- **公开/私有** — 剪贴板可设为公开（他人可见）或私有
- **搜索与筛选** — 按标题/内容搜索，按归属筛选
- **数据存储于 GitHub 仓库** — 通过 GitHub Contents API 读写

## 使用方法

1. 打开 https://yanzien.github.io/mdqp/
2. 首次使用：点击「连接设置」，填写 GitHub 用户名、仓库名、PAT
3. 点击「用 CP OAuth 登录」（推荐）或手动注册
4. 登录后即可创建和管理剪贴板

## 技术栈

- 纯前端（HTML + CSS + JS），无需后端服务器
- [CP OAuth](https://www.cpoauth.com) — OAuth 2.0 + PKCE 身份认证
- GitHub Contents API — 数据存储
- [marked.js](https://marked.js.org/) — Markdown 渲染

## 项目结构

```
├── index.html       # 主页面（SPA）
├── callback.html    # cpoauth OAuth 回调处理
├── style.css        # 样式
├── app.js           # 核心逻辑
├── README.md        # 本文件
└── data/
    └── clips.json   # 剪贴板数据（自动生成）
```

## 安全说明

- ⚠️ **手动注册不安全**：用户名和密码哈希直接存储在公开仓库中
- ✅ **cpoauth 登录推荐**：使用标准 OAuth 2.0 流程，密码不经过本站
- 🔑 **PAT 安全**：Personal Access Token 存储在浏览器 localStorage 中，不会写死在代码里

## License

MIT
