# 🕳️ Cyber Treehole（赛博自留地 / 网络树洞）

一个轻量、隐私友好的个人精神自留地。纯 HTML 单页 + Cloudflare Workers + D1 + R2，零构建、可免费部署。

A modern, secure, and lightweight personal sanctuary built on serverless edge infrastructure.

> 接手开发（换 AI / 换账号 / 新同学）请先读 **[`CLAUDE.md`](./CLAUDE.md)** —— 完整的架构、约定、数据模型、API、排错与安全规则都在那里。
> 部署细节见 **[`DEPLOY.md`](./DEPLOY.md)**。

## 技术栈 / Tech Stack

- **前端**：纯 HTML / CSS / JavaScript 单页，响应式，支持 PWA
- **边缘计算**：Cloudflare Workers（`worker.js`，同时托管静态资源）
- **数据库**：Cloudflare D1（SQLite，绑定 `DB`）
- **图片存储**：Cloudflare R2（光影回响照片，绑定 `PHOTOS`）
- **鉴权**：`AUTHOR_KEY` 环境密钥（仅存于 Cloudflare，绝不入库/入代码）

## 功能 / Features

- 仪式感入口页
- 呢喃墙（作者发布，公开浏览）
- 光影与回响（图文记录，照片存 R2；删除回响时同步删除 R2 原图）
- 信箱留言（访客可投递，作者可内联回复）
- JSON 导出 / 导入备份
- 旧版 base64 图片一键迁移到 R2

## 项目结构

```text
├── index.html            # 前端单页（视图 / 状态 / 样式 / 脚本都在这里）
├── worker.js             # Workers 入口（API + 静态资源），生产实际运行
├── functions/api/        # Pages Functions 备用 API 路由（当前未启用，需与 worker.js 同步）
├── schema.sql            # D1 表结构参考（含 reply 字段；worker 也会自动建表）
├── sw.js                 # Service Worker（PWA）
├── manifest.webmanifest  # PWA 清单
├── wrangler.jsonc        # Wrangler 配置（入口、静态资源、D1/R2 绑定）
├── tests/                # 纯 Node 测试（node:sqlite，无需安装依赖）
├── robots.txt / sitemap.xml   # SEO
├── DEPLOY.md             # 中文部署说明
└── CLAUDE.md             # 给 AI / 新开发者的接手指南
```

## 快速开始

详细步骤见 [DEPLOY.md](./DEPLOY.md)。

1. Fork 或 clone 本仓库
2. 在 Cloudflare 创建 D1 数据库并绑定 `DB`
3. 创建 R2 桶 `treehole-photos` 并绑定 `PHOTOS`
4. 设置 Secret `AUTHOR_KEY`（作者发布密钥）
5. 推到 `main` 分支即自动部署（Cloudflare Git 集成）

## 本地验证（改完务必跑）

需要 Node 22+（用到内置 `node:sqlite`），无需 `npm install`：

```bash
node tests/core.test.mjs      # 发帖 / 鉴权 / 限流 / 隐私 / 回响剥离大图
node tests/r2.test.mjs        # R2 照片上传 + 回响流程 + 删除清理
node tests/migrate.test.mjs   # 一次性迁移接口的幂等性
```

三个都应输出 `N 通过 / 0 失败`。测试直接 import `worker.js`，对 D1/R2 做内存模拟。

## 数据说明

| 类型 | 谁可发布 | 谁可见 |
|------|----------|--------|
| whisper（呢喃） | 作者 | 所有人 |
| echo（回响） | 作者 | 所有人 |
| letter（信箱） | 所有人 | 正文与回复公开；联系方式仅作者后台可见 |

## ⚠️ 安全须知

- `AUTHOR_KEY` 是服务端密钥，**只能**存在于 Cloudflare 环境变量里，绝不可写进任何文件、提交、注释或日志。
- 所有用户内容渲染前都经 `safe()` 转义；信箱联系方式只写库、任何接口都不返回。
- 详见 [`CLAUDE.md`](./CLAUDE.md) 的「安全规则」一节。

## License

Personal project — use and adapt freely for your own treehole.
