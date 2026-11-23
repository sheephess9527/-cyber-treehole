import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";
import { onRequestGet } from "../functions/api/posts.js";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };

for (const implementation of ["worker", "pages"]) {
  const sqlite = new DatabaseSync(":memory:");
  const DB = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      all() { return { results: stmt.all(...args) }; },
      run() { return stmt.run(...args); },
      first() { return stmt.get(...args) ?? null; },
    };
    return api;
  } };
  const get = (query) => {
    const request = new Request(`https://example.com/api/posts?${query}`);
    return implementation === "worker" ? worker.fetch(request, { DB }) : onRequestGet({ request, env: { DB } });
  };
  await get("kind=echo");
  const insert = (kind, content) => Number(sqlite.prepare(
    "INSERT INTO public_posts (kind, content, created_at, contact) VALUES (?, ?, ?, ?)"
  ).run(kind, content, new Date().toISOString(), "private-contact").lastInsertRowid);
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
  const id = insert("echo", JSON.stringify({ title: "photo", image: "data:image/jpeg;base64," + "A".repeat(60000), thumb: "data:image/jpeg;base64," + bytes.toString("base64") }));
  insert("echo", JSON.stringify({ thumb: "https://example.com/thumb.jpg", image: "https://example.com/full.jpg" }));
  const listText = await (await get("kind=echo")).text();
  const posts = JSON.parse(listText).posts;
  check(`${implementation}: list has no base64 and stays small`, !listText.includes("data:") && listText.length < 1000);
  check(`${implementation}: inline thumb becomes URL`, JSON.parse(posts.find(p => p.id === id).content).thumb === `/api/posts?thumb=${id}`);
  check(`${implementation}: HTTP thumb passes through`, posts.some(p => JSON.parse(p.content).thumb === "https://example.com/thumb.jpg"));
  const response = await get(`thumb=${id}`);
  check(`${implementation}: thumb bytes and MIME`, response.status === 200 && response.headers.get("content-type") === "image/jpeg" && Buffer.from(await response.arrayBuffer()).equals(bytes));
  check(`${implementation}: one-hour browser cache`, response.headers.get("cache-control") === "public, max-age=3600" && response.headers.get("x-content-type-options") === "nosniff");
  const detail = await (await get(`id=${id}`)).json();
  check(`${implementation}: detail unchanged`, JSON.parse(detail.post.content).thumb.startsWith("data:"));
  const invalid = [
    ["missing", 99999],
    ["non-echo", insert("letter", JSON.stringify({ thumb: "data:image/jpeg;base64,YQ==" }))],
    ["no-thumb", insert("echo", "{}")],
    ["corrupt-json", insert("echo", "{")],
    ["corrupt-base64", insert("echo", JSON.stringify({ thumb: "data:image/jpeg;base64,***" }))],
    ["invalid-base64-length", insert("echo", JSON.stringify({ thumb: "data:image/jpeg;base64,A" }))],
    ["empty", insert("echo", JSON.stringify({ thumb: "" }))],
    ["unsafe-MIME", insert("echo", JSON.stringify({ thumb: "data:text/html;base64,YQ==" }))],
    ["invalid-id", "bad"],
  ];
  for (const [name, value] of invalid) {
    const r = await get(`thumb=${value}`);
    check(`${implementation}: ${name} returns private 404`, r.status === 404 && await r.text() === "Not found");
  }
  sqlite.close();
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
