// One-time migration tests for worker.js (/api/migrate): moves old inline
// base64 echo photos into R2, idempotently, one row at a time.
// Run: node tests/migrate.test.mjs   (Node 22+, uses the built-in node:sqlite)
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
const uploadedKeys = [];
const PHOTOS = {
  store: new Map(),
  async put(key, body, opts) {
    let bytes;
    if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
    else bytes = Buffer.from(await new Response(body).arrayBuffer());
    this.store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
    uploadedKeys.push(key);
    return { key };
  },
};

const env = {
  DB: makeDB(),
  AUTHOR_KEY: KEY,
  PHOTOS,
  ASSETS: { fetch: async () => new Response("home", { status: 200 }) },
};

const BASE = "http://localhost";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`); cond ? pass++ : fail++; };

const sampleBytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
const dataUrl = `data:image/jpeg;base64,${sampleBytes.toString("base64")}`;

const postR = (body) => worker.fetch(new Request(`${BASE}/api/posts`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4", "x-author-key": KEY },
  body: JSON.stringify(body),
}), env);

await postR({ kind: "echo", content: JSON.stringify({ title: "旧A", body: "aa", image: dataUrl, thumb: "data:image/jpeg;base64,TINY" }) });
await postR({ kind: "echo", content: JSON.stringify({ title: "旧B", body: "bb", image: dataUrl, thumb: "data:image/jpeg;base64,TINY" }) });
await postR({ kind: "echo", content: JSON.stringify({ title: "新C", body: "cc", image: "https://pub-xxx.r2.dev/photos/already.jpeg", thumb: "data:image/jpeg;base64,TINY" }) });
await postR({ kind: "whisper", content: "hello" });

{
  const r = await worker.fetch(new Request(`${BASE}/api/migrate`, { method: "POST", headers: { "x-author-key": "wrong" } }), env);
  check("错误密钥被拒 401", r.status === 401, `status=${r.status}`);
}

{
  const r = await worker.fetch(new Request(`${BASE}/api/migrate`, { method: "POST", headers: { "x-author-key": KEY } }), env);
  const j = await r.json();
  check("迁移请求返回 200", r.status === 200, `status=${r.status}`);
  check("迁移了 2 篇", j.migrated === 2, `migrated=${j.migrated}`);
  check("跳过 1 篇(已是 R2 URL)", j.skipped === 1, `skipped=${j.skipped}`);
  check("无错误", j.errors === 0, `errors=${j.errors}`);
  check("总计 3 篇 echo", j.total === 3, `total=${j.total}`);
}

{
  const listRes = await worker.fetch(new Request(`${BASE}/api/posts?kind=echo&limit=10`), env);
  const { posts } = await listRes.json();
  const parsed = posts.map((p) => JSON.parse(p.content));
  check("迁移后无 base64 大图", parsed.filter((p) => p.image && p.image.startsWith("data:")).length === 0);
  // After migration the list strips nothing (all R2 URLs), so image is kept.
  check("迁移后 image 均为 R2 URL", parsed.filter((p) => p.image && p.image.startsWith("https://")).length === 3);
  check("缩略图未被修改", parsed.every((p) => p.thumb === "data:image/jpeg;base64,TINY"));
}

{
  const r = await worker.fetch(new Request(`${BASE}/api/migrate`, { method: "POST", headers: { "x-author-key": KEY } }), env);
  const j = await r.json();
  check("重复迁移幂等: migrated=0", j.migrated === 0, `migrated=${j.migrated}`);
  check("重复迁移: skipped=3", j.skipped === 3, `skipped=${j.skipped}`);
}

{
  const r = await worker.fetch(new Request(`${BASE}/api/migrate`), env);
  check("GET /api/migrate 返回 405", r.status === 405, `status=${r.status}`);
}

{
  check("R2 桶中存有 2 个对象", uploadedKeys.length === 2, `count=${uploadedKeys.length}`);
  for (const key of uploadedKeys) {
    const stored = PHOTOS.store.get(key);
    check(`字节一致 ${key.split("/").pop()}`, !!stored && Buffer.compare(stored.bytes, sampleBytes) === 0);
  }
}

console.log(`\n=== 迁移流程: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
