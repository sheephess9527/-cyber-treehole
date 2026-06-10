# 赛博自留地上线说明

## 最简单的上传方式

当前版本包含静态页面和 Cloudflare Pages Function：

```text
index.html
functions/api/posts.js
schema.sql
```

它不依赖 React、Tailwind CDN、外部图片文件或构建命令。上传到 GitHub 后，用 Cloudflare Pages 指向这个目录即可。

## Cloudflare Pages 推荐设置

- Framework preset: `None`
- Build command: 留空
- Build output directory: `/` 或你的仓库中放置 `index.html` 的目录

如果你把整个 `outputs` 目录作为仓库根目录上传，就直接使用 `/`。

## 当前已实现

- 仪式感入口页
- 内嵌图片，不依赖外部图片路径
- 呢喃墙云端公开记录
- 光影与回响图文记录，可以上传本地照片
- 沉浸式图文阅读
- 信箱留言云端公开展示
- JSON 导出 / 导入备份

## Cloudflare D1 设置

需要创建一个 D1 数据库，并绑定到 Pages 项目。

推荐数据库名：

```text
treehole-db
```

Pages 项目里添加 D1 绑定：

```text
Variable name / 绑定变量名: DB
Database: treehole-db
```

`functions/api/posts.js` 会在第一次读写时自动创建表。也可以手动执行 `schema.sql`。

## 数据公开规则

- 呢喃墙内容：公开展示给所有访问者。
- 信箱留言正文：公开展示给所有访问者。
- 信箱联系方式：只写入 D1，不在网页上公开展示。
- 光影与回响的自定义照片：仍保存在当前浏览器。后续如果要跨设备公开照片，需要接 Cloudflare R2。
