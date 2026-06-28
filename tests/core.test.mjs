// Core backend tests for worker.js — posting, reading, auth, rate limiting,
// privacy, and the echo base64-stripping list query.
// Run: node tests/core.test.mjs   (Node 22+, uses the built-in node:sqlite)
import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";

// Minimal D1 shim over node:sqlite so worker.js runs unmodified.
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
const env = {
  DB: makeDB(),
  AUTHOR_KEY: KEY,
  PHOTOS: undefined,
  ASSETS: { fetch: async () => new Response("home", { status: 200 }) },
};

const BASE = "http://localhost";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`); cond ? pass++ : fail++; };

const post = (body, headers = {}) => worker.fetch(new Request(`${BASE}/api/posts`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5", ...headers },
  body: JSON.stringify(body),
}), env);
const authPost = (body, ip = "203.0.113.5") => post(body, { "x-author-key": KEY, "CF-Connecting-IP": ip });
const get = (qs) => worker.fetch(new Request(`${BASE}/api/posts${qs}`), env);

// 1) Static asset passthrough
{
  const r = await worker.fetch(new Request(`${BASE}/`), env);
  check("首页静态资源返回 200", r.status === 200, `status=${r.status}`);
}

// 2) Whisper requires author; visitor is rejected
{
  const r = await post({ kind: "whisper", content: "未授权呢喃" });
  check("访客发呢喃被拒 401", r.status === 401, `status=${r.status}`);
}

// 3) Author can post a whisper and read it back
{
  const r = await authPost({ kind: "whisper", content: "授权呢喃" });
  check("作者发呢喃 201", r.status === 201, `status=${r.status}`);
  const list = await (await get("?kind=whisper")).json();
  check("呢喃可被读回", list.posts.some((p) => p.content === "授权呢喃"));
}

// 4) Letter is open to visitors, but contact never leaks via GET
{
  const r = await post({ kind: "letter", content: "访客留言", contact: "secret@example.com" });
  check("访客投信 201", r.status === 201, `status=${r.status}`);
  const list = await (await get("?kind=letter")).json();
  const fields = Object.keys(list.posts[0] || {});
  check("信箱联系方式不通过 GET 泄露", !fields.includes("contact"), `字段: ${fields.join(",")}`);
}

// 5) Echo list strips inline base64 image at the DB layer, keeps thumb + R2 URL
{
  const big = "data:image/jpeg;base64," + "A".repeat(60000);
  await authPost({ kind: "echo", content: JSON.stringify({ title: "旧", body: "x", image: big, thumb: "data:image/jpeg;base64,TINY" }) });
  await authPost({ kind: "echo", content: JSON.stringify({ title: "新", body: "y", image: "https://pub-xxx.r2.dev/photos/a.jpeg", thumb: "data:image/jpeg;base64,TINY" }) });
  const list = await (await get("?kind=echo")).json();
  const parsed = list.posts.map((p) => JSON.parse(p.content));
  check("回响列表剥离 base64 大图", parsed.every((p) => !(p.image && p.image.startsWith("data:"))));
  check("回响列表保留 R2 URL", parsed.some((p) => p.image === "https://pub-xxx.r2.dev/photos/a.jpeg"));
  check("回响列表保留缩略图", parsed.every((p) => p.thumb === "data:image/jpeg;base64,TINY"));
}

// 6) by-id detail returns the full content (base64 intact) for old echoes
{
  const list = await (await get("?kind=echo")).json();
  const oldEcho = list.posts.find((p) => JSON.parse(p.content).title === "旧");
  const detail = await (await get(`?id=${oldEcho.id}`)).json();
  check("详情接口返回原图(base64 未剥离)", JSON.parse(detail.post.content).image.startsWith("data:"));
}

// 7) Validation: oversized whisper, invalid kind
{
  const tooLong = await authPost({ kind: "whisper", content: "x".repeat(2001) }, "203.0.113.71");
  check("超长呢喃被拒 400", tooLong.status === 400, `status=${tooLong.status}`);
  const badKind = await authPost({ kind: "nope", content: "x" }, "203.0.113.72");
  check("非法 kind 被拒 400", badKind.status === 400, `status=${badKind.status}`);
}

// 8) Rate limit: 5 letters pass from one IP, 6th is 429
{
  const ip = "198.51.100.42";
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await post({ kind: "letter", content: `l${i}` }, { "CF-Connecting-IP": ip })).status);
  check("同一 IP 限流: 前5条通过, 第6条 429", codes.slice(0, 5).every((c) => c === 201) && codes[5] === 429, codes.join(","));
}

// 9) Author check endpoint: correct/wrong key, no leak
{
  const okR = await (await worker.fetch(new Request(`${BASE}/api/posts?check=author`, { headers: { "x-author-key": KEY } }), env)).json();
  check("作者校验: 正确密钥 ok:true", okR.ok === true && okR.configured === true);
  const badR = await (await worker.fetch(new Request(`${BASE}/api/posts?check=author`, { headers: { "x-author-key": "wrong" } }), env)).json();
  check("作者校验: 错误密钥 ok:false", badR.ok === false);
  check("作者校验: 不泄露密钥本身", !JSON.stringify(badR).includes(KEY));
}

// 10) Key with stray whitespace (mobile paste) still matches
{
  const r = await authPost({ kind: "whisper", content: "空白容忍" }, "203.0.113.9");
  check("尾部空白密钥被容忍", r.status === 201, `status=${r.status}`);
  const r2 = await post({ kind: "whisper", content: "空白容忍2" }, { "x-author-key": `  ${KEY}\n`, "CF-Connecting-IP": "203.0.113.10" });
  check("含首尾空白的密钥仍匹配", r2.status === 201, `status=${r2.status}`);
}

// 11) Delete and reply are author-gated
{
  const created = await (await authPost({ kind: "letter", content: "待回复" }, "203.0.113.11")).json();
  const id = created.post.id;
  const unauthDel = await worker.fetch(new Request(`${BASE}/api/posts?id=${id}`, { method: "DELETE" }), env);
  check("未授权删除被拒 401", unauthDel.status === 401, `status=${unauthDel.status}`);
  const reply = await worker.fetch(new Request(`${BASE}/api/posts?id=${id}`, { method: "PUT", headers: { "Content-Type": "application/json", "x-author-key": KEY }, body: JSON.stringify({ reply: "树洞回复" }) }), env);
  check("作者回复留言 200", reply.status === 200, `status=${reply.status}`);
  const back = await (await get(`?id=${id}`)).json();
  check("回复可被读回", back.post.reply === "树洞回复");
}

console.log(`\n=== 核心后端: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
