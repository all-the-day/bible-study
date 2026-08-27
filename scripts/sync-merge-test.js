/* sync-merge-test.js — sync.js flushPending 合并语义单元测试（node 直跑，无浏览器）
 * 覆盖场景：
 *  1. 旧快照 pending + 服务器有本机没有的新标注 → flush 后服务器不丢新标注（修复的原始 bug）
 *  2. 服务器拉取失败 → 本轮不推，pending 保留，服务器不变
 *  3. 服务器 key 不存在 → 直接推本地
 *  4. 笔记对象（dict）合并：本机赢同 key，保留远端独有 key
 *  5. 同 id 冲突：本机赢
 */
"use strict";
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "..", "sync.js"), "utf8");

function makeSync(remoteState, { fetchFail = false } = {}) {
  const store = {
    "bible-study.account": JSON.stringify({ uid: "u1", token: "tok1" }),
    "bible-study.pending": JSON.stringify(["bible-study.annotations"]),
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const fetch = async (url, opts) => {
    const m = url.match(/\/api\/kv\/(.+)$/);
    const key = decodeURIComponent(m[1]);
    if (opts.method === "GET") {
      if (fetchFail) throw new Error("network down");
      return { ok: true, json: async () => ({ value: key in remoteState ? remoteState[key] : null }) };
    }
    if (opts.method === "PUT") {
      remoteState[key] = JSON.parse(opts.body);
      return { ok: true, json: async () => ({}) };
    }
    throw new Error("unexpected " + opts.method);
  };
  const fn = new Function("window", "localStorage", "fetch", code + "\n;return window.BibleStudySync;");
  const Sync = fn({ BIBLE_OFFLINE: false }, localStorage, fetch);
  return { Sync, store, localStorage };
}

let failed = 0;
function assert(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failed++;
}
function byId(arr) { return [...arr].sort((a, b) => a.id.localeCompare(b.id)); }

(async () => {
  // 场景 1：旧快照 pending + 服务器有新标注（原始 bug 重现）
  {
    const remote = { "u1:bible-study:annotations": [
      { id: "a", text: "本机也有的旧标注" },
      { id: "c", type: "morning", text: "其他设备下午新加的听抄划线" },
    ] };
    const { Sync, store } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([
      { id: "a", text: "本机也有的旧标注" },
      { id: "b", text: "本机独有的标注" },
    ]);
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    const server = remote["u1:bible-study:annotations"];
    assert("场景1 服务器保留其他设备新标注(c)", byId(server).some((x) => x.id === "c"));
    assert("场景1 服务器含本机独有标注(b)", byId(server).some((x) => x.id === "b"));
    assert("场景1 服务器条数=3", server.length === 3);
    assert("场景1 pending 已清除", !JSON.parse(store["bible-study.pending"]).includes("bible-study.annotations"));
    assert("场景1 本地写回合并结果", JSON.parse(store["bible-study.annotations"]).length === 3);
  }

  // 场景 2：服务器拉取失败 → 本轮不推
  {
    const remote = { "u1:bible-study:annotations": [{ id: "z", text: "服务器新数据" }] };
    const { Sync, store } = makeSync(remote, { fetchFail: true });
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地" }]);
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    assert("场景2 服务器未被覆盖", remote["u1:bible-study:annotations"].length === 1 && remote["u1:bible-study:annotations"][0].id === "z");
    assert("场景2 pending 保留", JSON.parse(store["bible-study.pending"]).includes("bible-study.annotations"));
  }

  // 场景 3：服务器 key 不存在 → 直接推本地
  {
    const remote = {};
    const { Sync, store } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地" }]);
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    assert("场景3 本地推上服务器", remote["u1:bible-study:annotations"].length === 1);
  }

  // 场景 4：dict 合并
  {
    const remote = { "u1:bible-study:chapterNotes": { 创24: "远端笔记", 创25: "远端独有" } };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = JSON.stringify(["bible-study.chapterNotes"]);
    store["bible-study.chapterNotes"] = JSON.stringify({ 创24: "本机改过的笔记" });
    await Sync.flushPending(() => JSON.parse(store["bible-study.chapterNotes"]));
    const merged = remote["u1:bible-study:chapterNotes"];
    assert("场景4 同 key 本机赢", merged["创24"] === "本机改过的笔记");
    assert("场景4 远端独有 key 保留", merged["创25"] === "远端独有");
  }

  // 场景 5：同 id 冲突本机赢
  {
    const remote = { "u1:bible-study:annotations": [{ id: "a", note: "远端编辑" }] };
    const { Sync, store } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", note: "本机编辑" }]);
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    assert("场景5 同 id 本机赢", remote["u1:bible-study:annotations"][0].note === "本机编辑");
  }

  console.log(failed === 0 ? "\n全部通过" : "\n有 " + failed + " 项失败");
  process.exit(failed === 0 ? 0 : 1);
})();
