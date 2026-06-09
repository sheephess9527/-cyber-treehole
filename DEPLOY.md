# 赛博自留地上线说明

## 最简单的上传方式

当前版本已经是单文件自包含站点：

```text
index.html
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
- 呢喃墙本地记录
- 光影与回响图文记录，可以上传本地照片
- 沉浸式图文阅读
- 匿名信箱本地投递记录
- JSON 导出 / 导入备份

## 重要说明

现在的数据保存在访客当前浏览器的 `localStorage` 中。

也就是说：

- 你自己记录的内容会留在你当前浏览器里。
- 上传到网上后，其他访客看不到你的本地记录。
- 访客投递也只保存在访客自己的浏览器里，除非你接后端。

## 需要真正收信时

代码里已预留：

```js
const MAILBOX_ENDPOINT = "";
```

以后可以接 Cloudflare Worker、Formspree、Supabase Edge Function 等接口。填入接口地址后，信箱会把投递内容发送到后端。
