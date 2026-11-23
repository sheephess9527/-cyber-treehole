import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };

for (const file of ["index.html", "404.html"]) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const script = html.match(/<script id="pages-redirect">([\s\S]*?)<\/script>/)[1];
  const redirect = (url) => {
    const parsed = new URL(url);
    let target;
    runInNewContext(script, { location: {
      hostname: parsed.hostname, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash,
      replace(value) { target = value; },
    } });
    return target;
  };
  const cases = [
    ["/-cyber-treehole", "/"],
    ["/-cyber-treehole/", "/"],
    ["/-cyber-treehole/?q=hello%20world#echoes/2", "/?q=hello%20world#echoes/2"],
    ["/-cyber-treehole/foo/bar?x=1&x=2#about", "/foo/bar?x=1&x=2#about"],
    ["/-cyber-treehole/%E4%BD%A0?next=%2F#whispers", "/%E4%BD%A0?next=%2F#whispers"],
    ["/-cyber-treehole-other/foo", "/-cyber-treehole-other/foo"],
    ["/other/-cyber-treehole/foo", "/other/-cyber-treehole/foo"],
    ["/-cyber-treehole//example.com/path", "//example.com/path"],
  ];
  for (const [path, expected] of cases) {
    check(`${file}: ${path}`, redirect(`https://sheephess9527.github.io${path}`) === `https://www.zhengjianyong.de${expected}`);
  }
  for (const host of ["www.zhengjianyong.de", "cyber-treehole.example.workers.dev", "localhost:8765", "127.0.0.1:8765", "github.io.example.com"]) {
    check(`${file}: ${host} does not redirect`, redirect(`http://${host}/-cyber-treehole/foo?q=1#echoes`) === undefined);
  }
  check(`${file}: noscript canonical link`, /<noscript>[\s\S]*?<a href="https:\/\/www\.zhengjianyong\.de\/">[\s\S]*?<\/noscript>/.test(html));
}

console.log(`\n=== Pages 镜像跳转: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
