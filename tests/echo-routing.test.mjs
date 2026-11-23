import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script id="treehole-app">([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const extract = (name) => script.match(new RegExp(`      function ${name}\\([^]*?\\n      }`))[0];
let local = [{ title: "old local", personal: true }];
let writes = 0;
const context = vm.createContext({
  TABS: ["whispers", "echoes", "about"],
  sharedEchoes: [{ id: 50 }, { id: 48 }],
  defaultEchoes: [{ defaultKey: "d0" }],
  storage: { echoes: "local" },
  read: () => JSON.parse(JSON.stringify(local)),
  write: (_, value) => { writes++; local = value; },
  crypto: { randomUUID: () => "test-uuid" },
  go: () => {},
});
for (const name of ["echoKey", "resolveEchoRoute", "parseHash", "allEchoes", "removeEcho"]) vm.runInContext(extract(name), context);
const { echoKey, resolveEchoRoute: resolve, parseHash, allEchoes, removeEcho } = context;
let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };
check("entrance parses as null", parseHash("") === null);
for (const tab of ["whispers", "echoes", "about"]) check(`parse ${tab}`, parseHash("#" + tab).tab === tab);
check("stable hash stays a string", parseHash("#echoes/p50").echo === "p50");
check("legacy zero is preserved", parseHash("#echoes/0").echo === "0");
check("unknown tab is rejected", parseHash("#missing") === null);
let items = allEchoes();
check("cloud, local and built-in keys", items.map(echoKey).join(",") === "p50,p48,ltest-uuid,d0");
check("old local data is migrated without losing fields", local[0].localId === "test-uuid" && local[0].title === "old local");
allEchoes();
check("local ID is persisted only once", writes === 1);
check("local links survive prepending", resolve("ltest-uuid", [{ id: 99 }, ...allEchoes()], false).item.title === "old local");
check("cloud key survives prepending", resolve("p50", [{ id: 99 }, ...items], false).item.id === 50);
check("built-in key resolves", resolve("d0", items, false).item.defaultKey === "d0");
check("gallery needs no redirect", !resolve(null, items, false).replace);
check("legacy index becomes stable key", resolve("0", items, false).key === "p50" && resolve("0", items, false).replace);
check("legacy local index becomes stable key", resolve("2", items, false).key === "ltest-uuid");
check("legacy indices wait for cloud ordering", !resolve("0", [local[0]], true).item && !resolve("0", [local[0]], true).replace);
check("cached matching key renders while refreshing", resolve("p50", items, true).item.id === 50);
for (const key of ["p999", "999", "-1", "nope", "p<script>"]) {
  check(`unknown ${key} waits while loading`, !resolve(key, [], true).replace);
  check(`unknown ${key} falls back after loading and detail lookup`, resolve(key, items, false, { pending: false, item: null }).key === null);
}
check("cold deep link resolves after data arrives", resolve("p50", [], true).key === "p50" && resolve("p50", items, false).item.id === 50);
check("missing cloud post requests a detail lookup", resolve("p50", [], false).fetch);
check("pending detail keeps the route", resolve("p50", [], false, { pending: true, item: null }).key === "p50");
check("archived detail resolves outside grid", resolve("p50", [], false, { pending: false, item: { id: 50 } }).item.id === 50);
for (const scenario of ["echo", "404", "letter", "network"]) {
  let requests = 0, renders = 0;
  const details = new Map();
  const detailContext = vm.createContext({
    echoDetails: details, API_POSTS: "/api/posts", tab: "echoes", activeEcho: "p50",
    fetch: async () => {
      requests++;
      if (scenario === "network") throw new Error("offline");
      return { ok: scenario !== "404", json: async () => ({ post: { id: 50, kind: scenario, content: "{}" } }) };
    },
    parseEchoItems: (items) => items, toDisplayTime: () => "", renderEchoes: () => renders++,
  });
  vm.runInContext(extract("loadEchoDetail"), detailContext);
  const pending = detailContext.loadEchoDetail("p50");
  check(`${scenario}: detail pending`, pending.pending);
  detailContext.loadEchoDetail("p50");
  await new Promise((resolve) => setImmediate(resolve));
  detailContext.loadEchoDetail("p50");
  check(`${scenario}: one request and completion render`, requests === 1 && renders === 1 && !pending.pending);
  check(`${scenario}: only echoes are retained`, !!pending.item === (scenario === "echo"));
}
removeEcho("ltest-uuid");
check("local removal uses key", local.length === 0);
for (const scenario of [
  { name: "unchanged gallery", changed: false, pending: false, renders: 0 },
  { name: "changed gallery", changed: true, pending: false, renders: 1 },
  { name: "unchanged unresolved route", changed: false, pending: true, renders: 1 },
  { name: "failed unresolved route", changed: false, pending: true, error: true, renders: 2 },
  { name: "empty cached gallery", changed: false, pending: true, empty: true, renders: 1 },
  { name: "failed empty cached gallery", changed: false, pending: true, empty: true, error: true, renders: 2 },
]) {
  let renders = 0;
  const cached = scenario.empty ? [] : [{ id: 50 }];
  const refresh = vm.createContext({
    loadingEchoes: false, echoRenderDependsOnLoading: scenario.pending, tab: "echoes",
    sharedEchoes: cached, echoesError: false,
    fetchShared: () => scenario.error ? Promise.reject(new Error("offline")) : Promise.resolve(scenario.changed ? [{ id: 48 }] : cached),
    parseEchoItems: (items) => items, writeEchoCache: () => {},
    renderEchoes: () => { renders++; },
  });
  vm.runInContext(extract("revalidateEchoes"), refresh);
  refresh.revalidateEchoes();
  await new Promise((resolve) => setImmediate(resolve));
  check(`${scenario.name}: only necessary renders`, renders === scenario.renders && !refresh.loadingEchoes);
}
console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
