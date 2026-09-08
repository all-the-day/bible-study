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
 * 16. 删除标注 → 存储留墓碑 + 推送后服务器该条变墓碑（原文不复活）
 * 17. 删除 → 刷新（pullAll 覆盖本地 + stripDeleted）→ 已删条目不复活
 * 18. 连续删两条 → 两次的墓碑都在（后一次落盘不覆盖前一次）
 * 19. 笔记 dict 删除 → key 变墓碑；同 key 重新写入 → 本端新值赢，墓碑被覆盖
 * 20. 墓碑优先：远端已删（墓碑）+ 本端还有旧副本 → 推送后不复活
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

  // 场景 16：删除标注 → 落盘留墓碑 + 推送后服务器该条变墓碑（原文不复活）
  {
    const remote = {
      "u1:bible-study:annotations": [
        { id: "a", text: "本机要删的" },
        { id: "b", text: "保留" },
      ],
    };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = "[]";
    store["bible-study.annotations"] = JSON.stringify([
      { id: "a", text: "本机要删的" }, { id: "b", text: "保留" },
    ]);
    await Sync.saveWithTombstones("bible-study.annotations", [{ id: "b", text: "保留" }], ["a"], true);
    const disk = JSON.parse(store["bible-study.annotations"]);
    const server = remote["u1:bible-study:annotations"];
    assert("场景16 落盘留墓碑", disk.some((x) => x.id === "a" && x._del === 1));
    assert("场景16 落盘不含已删正文", !disk.some((x) => x.id === "a" && !x._del));
    assert("场景16 服务器该条变墓碑（原文不在）", !server.some((x) => x.id === "a" && x.text));
    assert("场景16 服务器保留未删条目", server.some((x) => x.id === "b" && x.text === "保留"));
    assert("场景16 stripDeleted 后内存态无已删条目", !Sync.stripDeleted(disk).some((x) => x.id === "a"));
  }

  // 场景 17：删除 → 刷新（pullAll 服务器为主覆盖本地 + stripDeleted）→ 已删条目不复活
  {
    const remote = {
      "u1:bible-study:annotations": [{ id: "a", text: "待删" }, { id: "b", text: "留" }],
    };
    // 设备 A：删除并推送
    const A = makeSync(remote);
    A.store["bible-study.pending"] = "[]";
    A.store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "待删" }, { id: "b", text: "留" }]);
    await A.Sync.saveWithTombstones("bible-study.annotations", [{ id: "b", text: "留" }], ["a"], true);
    // 刷新：新实例启动 → pullAll 覆盖本地 → 内存态（这是原来「删了又回来」的复现路径）
    const B = makeSync(remote);
    B.store["bible-study.pending"] = "[]";
    B.store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "待删" }, { id: "b", text: "留" }]);
    await B.Sync.pullAll(["bible-study.annotations"]);
    const reloaded = B.Sync.stripDeleted(JSON.parse(B.store["bible-study.annotations"]));
    assert("场景17 刷新后已删条目不复活", !reloaded.some((x) => x.id === "a"));
    assert("场景17 刷新后未删条目仍在", reloaded.some((x) => x.id === "b"));
  }

  // 场景 18：连续删两条 → 两次的墓碑都在（后一次落盘不得覆盖前一次）
  {
    const remote = {};
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = "[]";
    const all = [{ id: "a", text: "a" }, { id: "b", text: "b" }, { id: "c", text: "c" }];
    store["bible-study.annotations"] = JSON.stringify(all);
    await Sync.saveWithTombstones("bible-study.annotations", all.filter((x) => x.id !== "a"), ["a"], true);
    const disk1 = JSON.parse(store["bible-study.annotations"]);
    await Sync.saveWithTombstones("bible-study.annotations", disk1.filter((x) => !x._del && x.id !== "b"), ["b"], true);
    const disk2 = JSON.parse(store["bible-study.annotations"]);
    const stubs = disk2.filter((x) => x._del).map((x) => x.id).sort().join(",");
    assert("场景18 两次删除的墓碑都在", stubs === "a,b");
    assert("场景18 服务器墓碑都在", remote["u1:bible-study:annotations"].filter((x) => x._del).length === 2);
    assert("场景18 未删条目仍在服务器", remote["u1:bible-study:annotations"].some((x) => x.id === "c" && x.text === "c"));
  }

  // 场景 19：笔记 dict 删除 → key 变墓碑；同 key 重新写入 → 本端新值赢，墓碑被覆盖
  {
    const remote = { "u1:bible-study:chapterNotes": { "1:24": "旧笔记" } };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = JSON.stringify(["bible-study.chapterNotes"]);
    store["bible-study.chapterNotes"] = JSON.stringify({ "1:24": "旧笔记" });
    await Sync.saveWithTombstones("bible-study.chapterNotes", {}, ["1:24"], true);
    const disk = JSON.parse(store["bible-study.chapterNotes"]);
    assert("场景19 笔记 key 变墓碑", !!(disk["1:24"] && disk["1:24"]._del === 1));
    assert("场景19 stripDeleted 后 key 消失", !("1:24" in Sync.stripDeleted(disk)));
    assert("场景19 服务器 key 变墓碑", remote["u1:bible-study:chapterNotes"]["1:24"]._del === 1);
    await Sync.saveWithTombstones("bible-study.chapterNotes", { "1:24": "重新写的笔记" }, [], true);
    assert("场景19 重新写入覆盖墓碑", remote["u1:bible-study:chapterNotes"]["1:24"] === "重新写的笔记");
  }

  // 场景 20：墓碑优先——远端已删（墓碑）+ 本端离线期间还留着旧副本 → 推送后不复活
  {
    const remote = {
      "u1:bible-study:annotations": [
        { id: "a", _del: 1, _t: 111 },
        { id: "b", text: "正常" },
      ],
    };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = JSON.stringify(["bible-study.annotations"]);
    store["bible-study.annotations"] = JSON.stringify([{ id: "a", text: "本端旧副本" }, { id: "b", text: "正常" }]);
    await Sync.flushPending(() => JSON.parse(store["bible-study.annotations"]));
    const server = remote["u1:bible-study:annotations"];
    assert("场景20 墓碑优先：本端旧副本不复活", !server.some((x) => x.id === "a" && x.text));
    assert("场景20 墓碑仍在服务器", server.some((x) => x.id === "a" && x._del === 1));
  }

  // 场景 21：forcePushAll——以本机为准覆盖服务器（跳过合并），本机缺的 key 跳过不推
  {
    const remote = {
      "u1:bible-study:annotations": [
        { id: "a", text: "本机没有的服务器新标注" },
        { id: "b", text: "共用" },
      ],
      "u1:bible-study:chapterNotes": { "1:1": "服务器独有笔记" },
    };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = JSON.stringify(["bible-study.annotations"]);
    store["bible-study.annotations"] = JSON.stringify([{ id: "b", text: "本机版" }, { id: "c", text: "本机独有" }]);
    // 注意：本机没有 chapterNotes 键（getter 返回 undefined）→ 跳过，不得清空服务器
    const r = await Sync.forcePushAll({
      "bible-study.annotations": () => JSON.parse(store["bible-study.annotations"]),
      "bible-study.chapterNotes": () => undefined,
    });
    const server = remote["u1:bible-study:annotations"];
    assert("场景21 服务器被本机快照覆盖（无合并并集）", server.length === 2 && !server.some((x) => x.id === "a"));
    assert("场景21 本机缺的 key 跳过：服务器笔记保留", remote["u1:bible-study:chapterNotes"]["1:1"] === "服务器独有笔记");
    assert("场景21 返回 pushed=1", r.pushed === 1 && r.failed === 0);
    assert("场景21 推送成功清 pending", !JSON.parse(store["bible-study.pending"]).includes("bible-study.annotations"));
  }

  // 场景 22：forcePullAll——pending key 也强制覆盖本机；key 不存在/失败跳过；成功清 pending
  {
    const remote = {
      "u1:bible-study:annotations": [{ id: "a", text: "云端权威" }],
      "u1:bible-study:chapterNotes": { "2:2": "云端笔记" },
    };
    const { Sync, store } = makeSync({ ...remote, "u1:bible-study:lrNotes": null }, { failGetKeys: ["u1:bible-study:bookNotes"] });
    store["bible-study.pending"] = JSON.stringify(["bible-study.annotations", "bible-study.chapterNotes"]);
    store["bible-study.annotations"] = JSON.stringify([{ id: "b", text: "本机未推送的旧改动" }]);
    store["bible-study.morningNotes"] = JSON.stringify({ "m1": "本机独有" });
    const r = await Sync.forcePullAll(["bible-study.annotations", "bible-study.chapterNotes", "bible-study.lrNotes", "bible-study.bookNotes", "bible-study.morningNotes"]);
    assert("场景22 pending key 被云端覆盖", JSON.parse(store["bible-study.annotations"])[0].text === "云端权威");
    assert("场景22 拉取成功清 pending", JSON.parse(store["bible-study.pending"]).length === 0);
    assert("场景22 服务器无 key 不动本地（morningNotes 保留）", JSON.parse(store["bible-study.morningNotes"]).m1 === "本机独有");
    assert("场景22 拉取失败不动本地（bookNotes 缺席）", store["bible-study.bookNotes"] === undefined);
    assert("场景22 返回 pulled=2 failed=1", r.pulled === 2 && r.failed === 1);
  }

  // 场景 23：peekRemote——pending key 也能读到服务器真实值（诊断对比用，只读）
  {
    const remote = { "u1:bible-study:annotations": [{ id: "a", text: "服务器真相" }] };
    const { Sync, store } = makeSync(remote);
    store["bible-study.pending"] = JSON.stringify(["bible-study.annotations"]);
    const peeked = await Sync.peekRemote("bible-study.annotations");
    const blocked = await Sync.getRemote("bible-study.annotations");
    assert("场景23 peekRemote 透过 pending 读到服务器值", Array.isArray(peeked) && peeked[0].text === "服务器真相");
    assert("场景23 getRemote 对 pending 仍返回 null（写路径保护不变）", blocked === null);
  }

  console.log(failed === 0 ? "\n全部通过" : "\n有 " + failed + " 项失败");
  process.exit(failed === 0 ? 0 : 1);
})();
