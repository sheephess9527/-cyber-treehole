import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script id="treehole-app">([\s\S]*?)<\/script>/)[1];

function openPage({ hash = "", cached = false } = {}) {
  const location = new URL("https://treehole.example/" + hash);
  const renders = [];
  const events = new Map();
  const cache = new Map();
  const pendingWhispers = Promise.withResolvers();
  if (cached) cache.set("treehole.cache.whispers", JSON.stringify([{ text: "Cached whisper" }]));
  const response = (posts) => ({ ok: true, json: async () => ({ posts }) });

  runInNewContext(script, {
    location,
    root: { set innerHTML(value) { renders.push(value); } },
    document: { getElementById: () => null },
    navigator: {},
    window: { addEventListener: (event, callback) => events.set(event, callback) },
    localStorage: { getItem: (key) => cache.get(key), setItem: (key, value) => cache.set(key, value) },
    fetch: (path) => path.endsWith("kind=whisper") ? pendingWhispers.promise : Promise.resolve(response([])),
  });

  return {
    renders,
    navigate(hash) {
      location.hash = hash;
      events.get("hashchange")();
    },
    async finishWhisperPrefetch() {
      pendingWhispers.resolve(response([{ id: 1, content: "Fresh whisper", created_at: "2026-01-01T00:00:00Z" }]));
      await setImmediate();
      assert.equal(JSON.parse(cache.get("treehole.cache.whispers"))[0].text, "Fresh whisper");
    },
  };
}

for (const cached of [false, true]) {
  test(`${cached ? "Cached" : "Uncached"} prefetch stays on the entrance`, async () => {
    const page = openPage({ cached });
    await page.finishWhisperPrefetch();
    assert.equal(page.renders.length, 1);
    assert.match(page.renders[0], /class="entrance stage"/);
    page.navigate("whispers");
    assert.match(page.renders.at(-1), /Fresh whisper/);
  });
}

test("Returning from the whisper wall keeps the entrance after prefetch finishes", async () => {
  const page = openPage({ hash: "#whispers" });
  assert.match(page.renders.at(-1), /class="timeline"/);
  page.navigate("");
  await page.finishWhisperPrefetch();
  assert.match(page.renders.at(-1), /class="entrance stage"/);
});
