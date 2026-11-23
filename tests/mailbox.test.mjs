import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const createShared = html.slice(html.indexOf("      async function createShared("), html.indexOf("      async function deleteShared("));
const submit = html.slice(html.indexOf('        document.getElementById("mailForm").onsubmit ='), html.indexOf('        document.getElementById("backupInput").onchange'));
let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };

async function send(message, contact = "", response = { status: 200, body: { post: { id: 1, content: message } } }) {
  const elements = { mailForm: {}, mailMessage: { value: message }, mailContact: { value: contact }, mailStatus: { textContent: "" } };
  const calls = { fetch: 0, writes: [], timers: [], cleared: 0, cached: 0, backups: 0 };
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    cloudEnabled: true, API_POSTS: "/api/posts", getAuthorKey: () => "",
    fetch: async (_url, options) => {
      calls.fetch++;
      calls.payload = JSON.parse(options.body);
      if (response instanceof Error) throw response;
      return { ok: response.status < 400, status: response.status, json: async () => {
        if (response.body === undefined) throw new SyntaxError("not JSON");
        return response.body;
      } };
    },
    toDisplayTime: () => "now", stamp: () => "now", sharedLetters: [], localLetters: [],
    storage: { letters: "letters" }, write: (_key, value) => calls.writes.push(value),
    cacheShared: () => calls.cached++, clearDraft: () => calls.cleared++, autoBackup: () => calls.backups++,
    renderAbout: () => {}, setTimeout: (_callback, delay) => calls.timers.push(delay)
  });
  vm.runInContext(createShared + submit, context);
  await elements.mailForm.onsubmit({ preventDefault() {} });
  return { ...calls, status: elements.mailStatus.textContent, message: elements.mailMessage.value, contact: elements.mailContact.value };
}

check("正文表单限制及可见提示", /id="mailMessage"[^>]*maxlength="2000"/.test(html) && html.includes("正文最多 2000 字符"));
check("联系方式表单限制及可见提示", /id="mailContact"[^>]*maxlength="500"/.test(html) && html.includes("联系方式最多 500 字符"));
for (const [name, message, contact, limit] of [
  ["正文", "字".repeat(2001), "", "2000"],
  ["联系方式", "你好", "a".repeat(501), "500"],
  ["表情按服务端 UTF-16 长度计数", "😀".repeat(1001), "", "2000"]
]) {
  const r = await send(message, contact);
  check(`${name}超限不发送、不存本机、保留输入`, !r.fetch && !r.writes.length && !r.timers.length && !r.cleared && r.status.includes(limit) && r.message === message && r.contact === contact);
}
const empty = await send("  ", " ");
check("空白表单不发送", !empty.fetch && !empty.writes.length && !empty.status);
const boundary = await send("字".repeat(2000), "a".repeat(500));
check("恰好达到两项上限正常投递", boundary.fetch === 1 && !boundary.writes.length && boundary.cleared === 1 && boundary.cached === 1 && boundary.backups === 1 && boundary.status === "已放进树洞。");
const contactOnly = await send("  ", " contact ");
check("仅联系方式仍可投递并去除首尾空白", contactOnly.payload.content === "（无正文）" && contactOnly.payload.contact === "contact");
for (const status of [400, 401, 403, 404, 413, 422, 429]) {
  const r = await send("保留正文", "保留联系", { status, body: { error: "服务端拒绝原因" } });
  check(`${status} 显示服务端拒绝原因且不存本机、不清草稿、不重绘`, r.status.includes("尚未发送：服务端拒绝原因") && !r.writes.length && !r.cleared && !r.timers.length && r.message === "保留正文" && r.contact === "保留联系");
}
for (const body of [{}, undefined]) {
  const r = await send("你好", "", { status: 400, body });
  check("4xx 无错误信息或非 JSON 仍显示拒绝、不存本机", r.status.includes("投递被拒绝，尚未发送") && !r.writes.length && !r.timers.length);
}
for (const response of [{ status: 500, body: {} }, { status: 503 }, new TypeError("Failed to fetch")]) {
  const r = await send("你好", "联系", response);
  check("5xx 或网络失败仍保存本机", r.writes.length === 1 && r.writes[0][0].message === "你好" && r.status === "云端暂不可用，已保存在本机。" && r.timers[0] === 900);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
