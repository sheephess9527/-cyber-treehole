// Routing tests: unknown paths must 404, never throw (Cloudflare error 1101).
// Run: node tests/routing.test.mjs
import worker from "../worker.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`); cond ? pass++ : fail++; };
const get = (path, env) => worker.fetch(new Request(`http://localhost${path}`), env);

// 1. No ASSETS binding at all (the production bug): must not throw.
for (const p of ["/users/login", "/reset-password", "/favicon.ico", "/x/y/z"]) {
  let r, err;
  try { r = await get(p, {}); } catch (e) { err = e; }
  check(`missing ASSETS: ${p} does not throw`, !err, err && String(err));
  check(`missing ASSETS: ${p} → 404`, r && r.status === 404, r && String(r.status));
}

// 2. With ASSETS binding: response is passed through (404 page from assets).
const env = { ASSETS: { fetch: async (req) => new URL(req.url).pathname === "/"
  ? new Response("home", { status: 200 }) : new Response("404 page", { status: 404 }) } };
check("ASSETS: / → 200", (await get("/", env)).status === 200);
check("ASSETS: /users/login → 404", (await get("/users/login", env)).status === 404);
check("ASSETS: security headers kept", (await get("/", env)).headers.get("x-content-type-options") === "nosniff");

// 3. ASSETS.fetch throwing is contained.
const bad = { ASSETS: { fetch: async () => { throw new Error("boom"); } } };
check("ASSETS throws → 404", (await get("/anything", bad)).status === 404);

// 4. Unknown /api/* → JSON 404 (not the HTML page).
const r = await get("/api/nonexistent", env);
check("/api/nonexistent → 404 JSON", r.status === 404 && (r.headers.get("content-type") || "").includes("application/json"));

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
