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

## 装到 iPhone 主屏（PWA）

本站支持「添加到主屏幕」，装好后像 App 一样全屏运行，作者密钥保存在本机、点开即已登录。

- iPhone：用 **Safari** 打开网站 → 底部分享按钮 → **添加到主屏幕**。
- 相关文件：`manifest.webmanifest`、`sw.js`（Service Worker）、`icon-192.png` / `icon-512.png` / `apple-touch-icon.png`，均作为静态资源随站点提供。
- 缓存策略：`/api/*` 永不缓存（发帖/读取始终实时）；页面走网络优先（在线即取最新部署）；图标等静态资源走 stale-while-revalidate。改版后想强制刷新缓存，把 `sw.js` 里的 `VERSION` 加一即可。

## 作者密钥（谁能发布）

呢喃墙与光影回响改为**仅作者可发布**，信箱留言仍对所有访客开放。校验在后端完成，密钥保存在环境变量里，绝不写进代码或下发给浏览器。

在 Pages / Workers 项目里添加一个 Secret：

```text
变量名 / Variable name: AUTHOR_KEY
值 / Value:            你自定义的一长串密码
```

- 配置后：访问者只能浏览呢喃与回响、可以投信箱；作者需在页面「留白与信箱」里点 `[ 作者登录 ]` 输入这串密钥（只存在本机浏览器），之后即可发布呢喃与回响。
- 未配置 `AUTHOR_KEY` 时：呢喃与回响的发布会被拒绝（503），信箱仍可投递——属于「宁可锁住也不误开放」的安全兜底。
- 想换设备发布，在新设备上重新「作者登录」即可；公共设备请用 `[ 退出作者 ]` 清除。

## 数据公开规则

- 呢喃墙内容：公开展示给所有访问者。
- 信箱留言正文：公开展示给所有访问者。
- 信箱联系方式：只写入 D1，不在网页上公开展示。
- 作者回复：作者登录后可对每条留言回复（受 AUTHOR_KEY 校验），回复公开展示在该留言下方，访客可见。
- 光影与回响的自定义照片：仍保存在当前浏览器。后续如果要跨设备公开照片，需要接 Cloudflare R2。
