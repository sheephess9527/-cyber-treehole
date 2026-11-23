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

- 仪式感入口页：后台预加载不切换页面，点击「步入树洞」后才打开呢喃墙
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
node tests/routing.test.mjs   # Worker 路由与 404
node --test tests/entrance.test.mjs  # 入口页与后台预加载
```

Worker 测试应输出 `N 通过 / 0 失败`，对 D1/R2 做内存模拟。入口页测试在 Node 中执行页面脚本并模拟云端响应。

## 数据说明

信箱正文最多 2000 字符，联系方式最多 500 字符（与服务端一致，表情等字符按 JavaScript 字符串长度计数）。表单显示长度提示（不用 maxlength，避免粘贴长文被静默截断），投递前检查长度，超长时提示缩短，不发送。服务端返回 4xx 时显示拒绝原因，保留输入供修改，不再显示“已保存在本机”；只有网络故障或服务端 5xx 等云端不可用情况才沿用本机保存。

信箱前端回归测试：`node tests/mailbox.test.mjs`（长度边界、空白输入、4xx 拒绝与离线回退）。

| 类型 | 谁可发布 | 谁可见 |
|------|----------|--------|
| whisper（呢喃） | 作者 | 所有人 |
| echo（回响） | 作者 | 所有人 |
| letter（信箱） | 所有人 | 正文与回复公开；联系方式仅作者后台可见 |

## ⚠️ 安全须知

- `AUTHOR_KEY` 是服务端密钥，**只能**存在于 Cloudflare 环境变量里，绝不可写进任何文件、提交、注释或日志。
- 所有用户内容渲染前都经 `safe()` 转义；信箱联系方式只写库、任何接口都不返回。
- 详见 [`CLAUDE.md`](./CLAUDE.md) 的「安全规则」一节。

## 更新记录

- 静态资源通过根目录 `_headers` 添加 nosniff、Referrer-Policy、Permissions-Policy、禁止嵌入和 CSP；Worker 生成的 API 响应不变。CSP 为现有内联脚本/样式保留 `'unsafe-inline'`，允许本站、data/blob 图片、R2 图片及 Cloudflare Web Analytics，其他来源默认拒绝。未改变缓存策略。
- 头部回归测试：`node tests/headers.test.mjs`。`_headers` 由 Cloudflare 解析，不作为静态文件公开；详见 [Workers 静态资源头部文档](https://developers.cloudflare.com/workers/static-assets/headers/)。

- `/api/posts`（Worker 与 Pages 备用路由）：列表 `limit` 必须为正整数，省略时仍默认 100，超过 100 仍按 100 查询；非法值返回带错误信息的 400 JSON。POST / PUT 的无效 JSON、`null`、数组、数字等非对象请求体，以及无法转换为文本的字段，均返回 400，不再抛出未处理异常。鉴权和限流规则不变。
- 回归测试：`node tests/posts-input.test.mjs`（覆盖 Worker 与 Pages 的输入校验）。
- GitHub Pages 镜像（`*.github.io`）在首页和深路径 404 页自动跳转至 `https://www.zhengjianyong.de`，仅移除路径开头完整的 `/-cyber-treehole` 前缀，保留其余路径、查询参数与 hash；禁用 JavaScript 时提供正式站链接。正式域名、Workers 预览和 localhost 不跳转。
- `sw.js` 不拦截页面导航，本次未修改静态缓存策略；Worker 当前使用 `404-page`（非 SPA）回退，原有 404 页面保留，仅对 GitHub Pages 域名执行跳转。
- 镜像跳转回归测试：`node tests/pages-redirect.test.mjs`。

## License

Personal project — use and adapt freely for your own treehole.
