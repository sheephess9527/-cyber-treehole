// R2 photo-upload + echo-flow tests for worker.js.
// Run: node tests/r2.test.mjs   (Node 22+, uses the built-in node:sqlite)
import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";

function makeDB() {
  const db = new DatabaseSync(":memory:");
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        all() { return { results: stmt.all(...args) }; },
        run() { const r = stmt.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
        first() { return stmt.get(...args) ?? null; },
      };
      return api;
    },
  };
}

const KEY = "secret-key-123";
// Mock R2 bucket that records what was stored.
const PHOTOS = {
  store: new Map(),
  async put(key, body, opts) {
    let bytes;
    if (body instanceof ReadableStream) {
      const chunks = [];
      const reader = body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } else if (body instanceof ArrayBuffer) {
      bytes = Buffer.from(body);
    } else {
      bytes = Buffer.from(await new Response(body).arrayBuffer());
    }
    this.store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
    return { key };
  },
  async delete(key) { this.store.delete(key); },
};

const env = {
  DB: makeDB(),
  AUTHOR_KEY: KEY,
  PHOTOS,
  ASSETS: { fetch: async () => new Response("home", { status: 200 }) },
};
const envNoR2 = { ...env, PHOTOS: undefined };

const BASE = "http://localhost";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`); cond ? pass++ : fail++; };

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const uploadPhoto = (headers = {}) =>
  worker.fetch(new Request(`${BASE}/api/photos`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "x-author-key": KEY, ...headers },
    body: jpegBytes,
  }), env);

let uploadedUrl = "";

{
  const r = await uploadPhoto();
  const j = await r.json();
  uploadedUrl = j.url || "";
  check("照片上传返回 201", r.status === 201, `status=${r.status}`);
  check("返回公开 R2 URL", /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/photos\/echo-/.test(uploadedUrl), uploadedUrl);
  check("URL 后缀为 .jpeg", uploadedUrl.endsWith(".jpeg"));
}

{
  const key = uploadedUrl.split(".r2.dev/")[1];
  const stored = PHOTOS.store.get(key);
  check("字节已写入 R2 桶且内容一致", !!stored && Buffer.compare(stored.bytes, jpegBytes) === 0, `存了 ${stored?.bytes?.length} 字节`);
  check("R2 对象记录了 content-type", stored?.contentType === "image/jpeg");
}

{
  const r = await uploadPhoto({ "x-author-key": "nope" });
  check("错误密钥上传被拒 401", r.status === 401, `status=${r.status}`);
}

{
  const r = await worker.fetch(new Request(`${BASE}/api/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg", "x-author-key": KEY }, body: jpegBytes }), envNoR2);
  check("未配置 PHOTOS 绑定时返回 500", r.status === 500, `status=${r.status}`);
}

const postEcho = (body) => worker.fetch(new Request(`${BASE}/api/posts`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.77", "x-author-key": KEY }, body: JSON.stringify(body) }), env);
const getEchoes = () => worker.fetch(new Request(`${BASE}/api/posts?kind=echo`), env);
{
  const content = JSON.stringify({ title: "光", body: "回响", image: uploadedUrl, thumb: "data:image/jpeg;base64,TINY" });
  const r = await postEcho({ kind: "echo", content });
  check("发布带 R2 URL 的回响 201", r.status === 201, `content 长度=${content.length}`);
  const list = await (await getEchoes()).json();
  const parsed = JSON.parse(list.posts[0].content);
  check("列表保留 R2 图片 URL(不被剥离)", parsed.image === uploadedUrl, `image=${parsed.image?.slice(0, 50)}`);
  check("列表也保留缩略图与标题", parsed.thumb === "data:image/jpeg;base64,TINY" && parsed.title === "光");
}

{
  const oldContent = JSON.stringify({ title: "旧", body: "x", image: "data:image/jpeg;base64," + "A".repeat(40000), thumb: "data:image/jpeg;base64,OLD" });
  await postEcho({ kind: "echo", content: oldContent });
  const list = await (await getEchoes()).json();
  const newest = JSON.parse(list.posts[0].content);
  check("旧 base64 回响在列表中被剥离大图", !("image" in newest) && newest.thumb === "data:image/jpeg;base64,OLD" && newest.title === "旧");
}

{
  const sample = Buffer.from([10, 20, 30, 40, 250, 0, 99]);
  const dataUrl = "data:image/jpeg;base64," + sample.toString("base64");
  const b64 = dataUrl.split(",")[1];
  const bytes = Buffer.from(atob(b64), "binary");
  check("dataUrl→bytes 解码与原图一致", Buffer.compare(bytes, sample) === 0);
}

// Deleting an echo also removes its photo from R2.
{
  const r = await uploadPhoto();
  const url = (await r.json()).url;
  const key = url.split(".r2.dev/")[1];
  const created = await (await postEcho({ kind: "echo", content: JSON.stringify({ title: "待删", body: "x", image: url, thumb: "data:image/jpeg;base64,T" }) })).json();
  check("删除前 R2 存有该照片", PHOTOS.store.has(key));
  const del = await worker.fetch(new Request(`${BASE}/api/posts?id=${created.post.id}`, { method: "DELETE", headers: { "x-author-key": KEY } }), env);
  check("删除回响返回 200", del.status === 200, `status=${del.status}`);
  check("删除回响后 R2 照片被清理", !PHOTOS.store.has(key));
}

console.log(`\n=== R2 流程: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
