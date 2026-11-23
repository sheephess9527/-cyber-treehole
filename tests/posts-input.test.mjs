import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";
import { onRequestGet, onRequestPost, onRequestPut } from "../functions/api/posts.js";

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

let pass = 0, fail = 0, ip = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };
const KEY = "secret-key-123";
const handlers = { GET: onRequestGet, POST: onRequestPost, PUT: onRequestPut };

for (const backend of ["Worker", "Pages"]) {
  const env = { DB: makeDB(), AUTHOR_KEY: KEY };
  const send = (method, query = "", body) => {
    const request = new Request(`http://localhost/api/posts${query}`, {
      method,
      headers: { "Content-Type": "application/json", "x-author-key": KEY, "CF-Connecting-IP": `input-${++ip}` },
      ...(body === undefined ? {} : { body }),
    });
    return backend === "Worker" ? worker.fetch(request, env) : handlers[method]({ request, env });
  };
  const bad = async (method, query, body, label) => {
    const response = await send(method, query, body);
    const data = await response.json();
    check(`${backend}: ${label} → 400 JSON error`, response.status === 400 && response.headers.get("content-type").includes("application/json") && typeof data.error === "string" && data.error.length > 0);
  };

  for (const kind of ["echo", "whisper", "letter"]) {
    for (const limit of ["1.5", "abc", "-1", "0", "", " ", "NaN", "Infinity", "-Infinity"]) {
      await bad("GET", `?kind=${kind}&limit=${encodeURIComponent(limit)}`, undefined, `${kind} limit=${JSON.stringify(limit)}`);
    }
    const empty = await (await send("GET", `?kind=${kind}`)).json();
    check(`${backend}: ${kind} empty list`, Array.isArray(empty.posts) && empty.posts.length === 0);
  }

  const created = await send("POST", "", JSON.stringify({ kind: "letter", content: "hello" }));
  const { post } = await created.json();
  check(`${backend}: valid POST → 201`, created.status === 201 && post.content === "hello");
  for (const method of ["POST", "PUT"]) {
    const query = method === "PUT" ? `?id=${post.id}` : "";
    for (const body of ["null", "[]", "[1]", "42", '"hello"', "true", "{", ""]) {
      await bad(method, query, body, `${method} body=${JSON.stringify(body)}`);
    }
    if (method === "POST") {
      await bad(method, query, "{}", "empty post object");
      for (const field of ["kind", "content", "contact"]) {
        await bad(method, query, JSON.stringify({ kind: "letter", content: "hello", [field]: { toString: null } }), `invalid ${field} conversion`);
      }
    } else {
      await bad(method, query, '{"reply":{"toString":null}}', "invalid reply conversion");
      const reply = await send(method, query, '{"reply":"thanks"}');
      check(`${backend}: valid reply → 200`, reply.status === 200 && (await reply.json()).reply === "thanks");
      const cleared = await send(method, query, "{}");
      check(`${backend}: empty reply object still clears reply`, cleared.status === 200 && (await cleared.json()).reply === "");
    }
  }

  for (const limit of [undefined, "1", "100", "101"]) {
    const response = await send("GET", `?kind=letter${limit === undefined ? "" : `&limit=${limit}`}`);
    const data = await response.json();
    check(`${backend}: valid limit=${limit} → 200`, response.status === 200 && data.posts.length === 1 && data.posts[0].content === "hello");
  }
}

console.log(`\n=== 发帖输入校验: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
