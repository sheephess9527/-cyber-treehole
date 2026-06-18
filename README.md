# 🕳️ Cyber Treehole（赛博自留地 / 网络树洞）

一个轻量、隐私友好的个人精神自留地。纯 HTML 单页 + Cloudflare Workers + D1 + R2，零构建、可免费部署。

A modern, secure, and lightweight personal sanctuary built on serverless edge infrastructure.

## 技术栈 / Tech Stack

- **前端**：纯 HTML / CSS / JavaScript 单页，响应式，支持 PWA
- **边缘计算**：Cloudflare Workers（`worker.js`）
- **数据库**：Cloudflare D1（SQLite）
- **图片存储**：Cloudflare R2（光影回响照片）

## 功能 / Features

- 仪式感入口页
- 呢喃墙（作者发布，公开浏览）
- 光影与回响（图文记录，照片存 R2）
- 信箱留言（访客可投递，作者可回复）
- JSON 导出 / 导入备份
- 旧版 base64 图片一键迁移到 R2

## 项目结构

```text
├── index.html            # 前端单页
├── worker.js             # Workers 入口（API + 静态资源）
├── functions/api/        # Pages Functions 备用 API 路由
├── schema.sql            # D1 表结构（含 reply 字段）
├── sw.js                 # Service Worker（PWA）
├── manifest.webmanifest  # PWA 清单
├── wrangler.jsonc        # Wrangler 配置
├── DEPLOY.md             # 中文部署说明
└── robots.txt / sitemap.xml
```

## 快速开始

详细步骤见 [DEPLOY.md](./DEPLOY.md)。

1. Fork 或 clone 本仓库
2. 在 Cloudflare 创建 D1 数据库并绑定 `DB`
3. 创建 R2 桶 `treehole-photos` 并绑定 `PHOTOS`
4. 设置 Secret `AUTHOR_KEY`（作者发布密钥）
5. 用 Wrangler 或 Cloudflare Pages 部署

## 数据说明

| 类型 | 谁可发布 | 谁可见 |
|------|----------|--------|
| whisper（呢喃） | 作者 | 所有人 |
| echo（回响） | 作者 | 所有人 |
| letter（信箱） | 所有人 | 正文与回复公开；联系方式仅作者后台可见 |

## License

Personal project — use and adapt freely for your own treehole.