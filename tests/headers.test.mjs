import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };
const content = readFileSync(new URL("../_headers", import.meta.url), "utf8");
const lines = content.trimEnd().split("\n");
check("headers cover all static paths", lines.shift() === "/*");
const headers = new Map(lines.map((line) => {
  const split = line.indexOf(":");
  return [line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim()];
}));
for (const [name, value] of Object.entries({
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), camera=(), microphone=()",
  "x-frame-options": "DENY",
})) check(name, headers.get(name) === value);
check("valid indented headers within Cloudflare line limits", lines.every((line) => /^  [\w-]+: .+$/.test(line) && line.length <= 2000));
const csp = new Map(headers.get("content-security-policy").split(";").map((directive) => {
  const [name, ...sources] = directive.trim().split(/\s+/);
  return [name, sources.join(" ")];
}));
for (const [name, sources] of Object.entries({
  "default-src": "'self'",
  "script-src": "'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob: https://pub-f42708c63abc452a9ea946efd7103d9a.r2.dev",
  "connect-src": "'self' https://cloudflareinsights.com",
  "font-src": "'self'", "manifest-src": "'self'", "worker-src": "'self'",
  "base-uri": "'self'", "form-action": "'self'", "object-src": "'none'", "frame-ancestors": "'none'",
})) check(`CSP ${name}`, csp.get(name) === sources);
const ignored = readFileSync(new URL("../.assetsignore", import.meta.url), "utf8").split("\n");
check("_headers remains in asset upload", !ignored.includes("_headers"));
console.log(`\n=== 静态安全头部: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
