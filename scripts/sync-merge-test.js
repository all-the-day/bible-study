/* sync-merge-test.js — sync.js flushPending 合并语义单元测试（node 直跑，无浏览器）
 * 覆盖场景：
 *  1. 旧快照 pending + 服务器有本机没有的新标注 → flush 后服务器不丢新标注（修复的原始 bug）
 *  2. 服务器拉取失败 → 本轮不推，pending 保留，服务器不变
 *  3. 服务器 key 不存在 → 直接推本地
 *  4. 笔记对象（dict）合并：本机赢同 key，保留远端独有 key
 *  5. 同 id 冲突：本机赢
 *  6. pullAll 部分拉取失败 → 失败 key 本地数据原样保留（不得写成 "undefined" 清空本地）
 *  7. pullAll 全部失败 → 本地全部保留，返回 false
 *  8. pullAll 成功 → 服务器值覆盖本地；key 不存在（null）→ 本地保留
 *  9. schedulePush 直推合并：防抖窗口内两次写只推一次、推最新值、不丢其他设备数据
 * 10. （并入场景9）
 * 11. 防抖窗口内关页面 → 落笔即标 pending，下次启动 flush 重推
 * 12. 直推时服务器 GET 失败 → 不盲推，pending 保留
 * 13. 同 key 推送串行化 → 不并发在途，两次改动都上服务器
 * 14. flush 进行中的新写 → 不被 merged 写回覆盖 + pending 恢复（修订号守卫）
 * 15. 直推在途时新写 → 推送成功不误清新写的 pending（修订号守卫）
 */
"use strict";
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "..", "sync.js"), "utf8");

function makeSync(remoteState, { fetchFail = false, failGetKeys = [], slowGetKeys = [] } = {}) {
  const store = {
    "bible-study.account": JSON.stringify({ uid: "u1", token: "tok1" }),
    "bible-study.pending": JSON.stringify(["bible-study.annotations"]),
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const counts = { put: 0, get: 0 };
  const fetch = async (url, opts) => {
    const m = url.match(/\/api\/kv\/(.+)$/);
    const key = decodeURIComponent(m[1]);
    if (opts.method === "GET") {
      counts.get++;
      if (fetchFail || failGetKeys.includes(key)) throw new Error("network down");
      if (slowGetKeys.includes(key)) await new Promise((r) => setTimeout(r, 30));
      return { ok: true, json: async () => ({ value: key in remoteState ? remoteState[key] : null }) };
    }
    if (opts.method === "PUT") {
      counts.put++;
      remoteState[key] = JSON.parse(opts.body);
      return { ok: true, json: async () => ({}) };
    }
    throw new Error("unexpected " + opts.method);
  };
  const fn = new Function("window", "localStorage", "fetch", code + "\n;return window.BibleStudySync;");
  const Sync = fn({ BIBLE_OFFLINE: false }, localStorage, fetch);
  return { Sync, store, localStorage, counts };
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

  // 场景 6：pullAll 部分拉取失败 → 失败 key 本地原样保留（原始 bug：v !== null 未排除 undefined，
  // JSON.stringify(undefined) 把本地键写成字符串 "undefined"，清空本地后盲推覆盖云端）
  {
    const remote = { "u1:bible-study:chapterNotes": { 创24: "远端笔记" } };
    const { Sync, store } = makeSync(remote, { failGetKeys: ["u1:bible-study:annotations"] });
    store["bible-study.pending"] = "[]";
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地标注" }]);
    store["bible-study.chapterNotes"] = JSON.stringify({ 创25: "本地笔记" });
    const ok = await Sync.pullAll(["bible-study.annotations", "bible-study.chapterNotes"]);
    assert("场景6 拉取失败的 key 本地原样保留", JSON.parse(store["bible-study.annotations"])[0].id === "a");
    assert("场景6 拉取成功的 key 被服务器覆盖", JSON.parse(store["bible-study.chapterNotes"])["创24"] === "远端笔记");
    assert("场景6 部分成功返回 true", ok === true);
  }

  // 场景 7：pullAll 全部失败 → 本地全部保留，返回 false
  {
    const remote = {};
    const { Sync, store } = makeSync(remote, { fetchFail: true });
    store["bible-study.pending"] = "[]";
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地" }]);
    const ok = await Sync.pullAll(["bible-study.annotations"]);
    assert("场景7 网络全挂时本地保留", JSON.parse(store["bible-study.annotations"])[0].id === "a");
    assert("场景7 全部失败返回 false", ok === false);
  }

  // 场景 8：pullAll 成功覆盖本地；key 不存在（null）→ 本地保留
  {
    const remote = { "u1:bible-study:annotations": [{ id: "r", text: "服务器值" }] };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = "[]";
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地旧值" }]);
    store["bible-study.chapterNotes"] = JSON.stringify({ 创1: "服务器没有这个 key" });
    await Sync.pullAll(["bible-study.annotations", "bible-study.chapterNotes"]);
    assert("场景8 服务器值覆盖本地", JSON.parse(store["bible-study.annotations"])[0].id === "r");
    assert("场景8 服务器不存在的 key 本地保留", JSON.parse(store["bible-study.chapterNotes"])["创1"] === "服务器没有这个 key");
  }

  // 场景 9-10：schedulePush 直推路径——防抖合并 + 推送前合并（不丢其他设备数据）
  {
    const remote = { "u1:bible-study:annotations": [{ id: "x", text: "其他设备的标注" }] };
    const { Sync, store, counts } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地1" }]);
    const p1 = Sync.schedulePush("bible-study.annotations", 20);
    // 防抖窗口内的第二次写：旧调度被合并，推送最终值
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地1" }, { id: "b", text: "本地2" }]);
    const p2 = Sync.schedulePush("bible-study.annotations", 20);
    await Promise.all([p1, p2]);
    const server = remote["u1:bible-study:annotations"];
    assert("场景9 直推合并不丢其他设备数据(x)", server.some((x) => x.id === "x"));
    assert("场景9 推送的是防抖后的最新本地值(b)", server.some((x) => x.id === "b"));
    assert("场景10 防抖窗口内两次写只推一次", counts.put === 1);
    assert("场景10 推送成功后 pending 清除", !Sync.hasPending());
  }

  // 场景 11：防抖窗口关闭前页面退出 → pending 已标（下次启动 flush 重推，不丢数据）
  {
    const remote = {};
    const { Sync, store } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地" }]);
    Sync.schedulePush("bible-study.annotations", 60000); // 不 await：模拟防抖窗口内直接关页面
    assert("场景11 落笔即标 pending", Sync.hasPending());
    // 恢复：直接调 flushPending 模拟下次启动重推
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    assert("场景11 flush 重推成功", remote["u1:bible-study:annotations"].length === 1);
  }

  // 场景 12：直推时服务器 GET 失败 → 不盲推，pending 保留
  {
    const remote = { "u1:bible-study:annotations": [{ id: "z", text: "服务器新数据" }] };
    const { Sync, store, counts } = makeSync(remote, { failGetKeys: ["u1:bible-study:annotations"] });
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地" }]);
    await Sync.schedulePush("bible-study.annotations", 20);
    assert("场景12 GET 失败不盲推", counts.put === 0);
    assert("场景12 服务器未被覆盖", remote["u1:bible-study:annotations"][0].id === "z");
    assert("场景12 pending 保留", Sync.hasPending());
  }

  // 场景 13：同 key 串行化——两次错开的推送不并发在途，后推送读最新本地值
  {
    const remote = {};
    const { Sync, store } = makeSync(remote);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "第1版" }]);
    const p1 = Sync.schedulePush("bible-study.annotations", 20);
    await new Promise((r) => setTimeout(r, 40)); // 等第一次推送进入在途（GET 待响应）
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "第1版" }, { id: "b", text: "第2版" }]);
    const p2 = Sync.schedulePush("bible-study.annotations", 20);
    await Promise.all([p1, p2]);
    const server = remote["u1:bible-study:annotations"];
    assert("场景13 串行推送最终包含两次改动", server.some((x) => x.id === "a") && server.some((x) => x.id === "b"));
  }

  // 场景 14：flush 进行中的新写 → 不被 merged 写回覆盖 + pending 恢复（修订号守卫）
  {
    const remote = { "u1:bible-study:annotations": [{ id: "r", text: "服务器值" }] };
    const { Sync, store } = makeSync(remote, { slowGetKeys: ["u1:bible-study:annotations"] });
    store["bible-study.pending"] = JSON.stringify(["bible-study.annotations"]);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地旧值" }]);
    const flushP = Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    // flush 在途（GET 慢）：用户新写（等价 schedulePush 落笔即标 pending），防抖窗口内关页面
    await new Promise((r) => setTimeout(r, 10));
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本地旧值" }, { id: "new", text: "flush期间新写" }]);
    Sync.schedulePush("bible-study.annotations", 60000);
    await flushP;
    assert("场景14 flush 期间新写不被 merged 覆盖", JSON.parse(store["bible-study.annotations"]).some((x) => x.id === "new"));
    assert("场景14 pending 恢复（下轮重推）", Sync.hasPending());
  }

  // 场景 15：直推在途时新写 → 推送成功不得误清新写的 pending（修订号守卫）
  {
    const remote = {};
    const { Sync, store } = makeSync(remote, { slowGetKeys: ["u1:bible-study:annotations"] });
    store["bible-study.pending"] = "[]";
    store["bible-study.annotations"] = JSON.stringify([{ id: "a" }]);
    const p1 = Sync.schedulePush("bible-study.annotations", 5);
    await new Promise((r) => setTimeout(r, 15)); // push1 在途（GET 慢）：新写 + 重新调度
    store["bible-study.annotations"] = JSON.stringify([{ id: "a" }, { id: "b" }]);
    const p2 = Sync.schedulePush("bible-study.annotations", 10);
    await p1;
    assert("场景15 push1 成功后新写的 pending 未被误清", Sync.hasPending());
    await p2;
    assert("场景15 push2 推送最新值", remote["u1:bible-study:annotations"].some((x) => x.id === "b"));
    assert("场景15 全部推送完成 pending 清空", !Sync.hasPending());
  }

  console.log(failed === 0 ? "\n全部通过" : "\n有 " + failed + " 项失败");
  process.exit(failed === 0 ? 0 : 1);
})();
