/* sync2-test.js — 条目级同步（v2 协议）客户端单元测试（node 直跑，无浏览器）
 * mock 一份与 server.py 同契约的服务端语义（op_id 幂等/base 裁决/import/force/rev），
 * 验证 sync.js v2 客户端的：播种、outbox 推送、增量拉取游标、冲突自动裁决与备份、
 * 拉取跳过在途条目、删除墓碑、强制覆盖、状态记录。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "sync.js"), "utf8");

/* 内存版服务端：与 server.py v2 同契约 */
function makeServer() {
  const rows = {};     // 'uid|kind|item_id' -> row
  const revs = {};     // 'uid|kind' -> rev
  return {
    rows, revs,
    failOps: false, failGet: false,
    processOps(uid, kind, ops) {
      const results = [];
      const key = uid + "|" + kind;
      for (const op of ops) {
        const rk = key + "|" + op.item_id;
        const cur = rows[rk];
        if (cur && cur.last_op_id === op.op_id) {
          results.push({ op_id: op.op_id, item_id: op.item_id, status: "duplicate", server_rev: cur.server_rev });
          continue;
        }
        const curRev = cur ? cur.server_rev : 0;
        if (op.import && cur) {
          results.push({ op_id: op.op_id, item_id: op.item_id, status: "exists", server_rev: curRev });
          continue;
        }
        if (!op.import && !op.force && op.base_server_rev !== curRev) {
          results.push({ op_id: op.op_id, item_id: op.item_id, status: "conflict", server_rev: curRev,
            current: cur ? { item_id: op.item_id, payload: JSON.parse(cur.payload), deleted: !!cur.deleted,
              client_updated_at: cur.client_updated_at, server_rev: cur.server_rev, device_id: cur.device_id } : null });
          continue;
        }
        const rev = (revs[key] || 0) + 1;
        revs[key] = rev;
        rows[rk] = {
          payload: op.op === "upsert" ? JSON.stringify(op.item) : (cur ? cur.payload : null),
          client_updated_at: op.client_updated_at ?? (cur ? cur.client_updated_at : null),
          server_rev: rev, deleted: op.op === "del" ? 1 : 0,
          last_op_id: op.op_id, device_id: op.device_id,
        };
        results.push({ op_id: op.op_id, item_id: op.item_id,
          status: op.import ? "imported" : "accepted", server_rev: rev });
      }
      return { ok: true, results, rev: revs[key] || 0 };
    },
    changes(uid, kind, since) {
      const items = [];
      Object.keys(rows).forEach((rk) => {
        if (!rk.startsWith(uid + "|" + kind + "|")) return;
        const r = rows[rk];
        if (r.server_rev > since) items.push({ item_id: rk.split("|")[2], payload: r.payload ? JSON.parse(r.payload) : null,
          client_updated_at: r.client_updated_at, server_rev: r.server_rev, deleted: !!r.deleted });
      });
      return { ok: true, from_rev: since, to_rev: revs[uid + "|" + kind] || 0, items };
    },
  };
}

function makeSync2(server, opts = {}) {
  const store = {
    "bible-study.account": JSON.stringify({ uid: "u1", token: "tok1" }),
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const fetch = async (url, o) => {
    const m = url.match(/\/api\/sync\/([a-zA-Z]+)\/(ops|changes)(\?since=(\d+))?$/);
    if (!m) throw new Error("unexpected " + url);
    if (m[2] === "ops") {
      if (server.failOps) throw new Error("http 500");
      return { ok: true, json: async () => server.processOps("u1", m[1], JSON.parse(o.body).ops) };
    }
    if (server.failGet) throw new Error("http 500");
    return { ok: true, json: async () => server.changes("u1", m[1], parseInt(m[4] || "0", 10)) };
  };
  const fn = new Function("window", "localStorage", "fetch", source + "\n;return window.BibleStudySync;");
  const Sync = fn({ BIBLE_OFFLINE: false }, localStorage, fetch);
  return { Sync, store, localStorage };
}

let failed = 0;
function assert(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failed++;
}
function ann(id, text, extra) {
  return Object.assign({ id, type: "verse", text: text || "内容" + id, book: 1, chapter: 1, verse: 1 }, extra || {});
}

(async () => {
  /* 场景 1：首次运行播种 + 首次全量拉取 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a"), ann("b")]);
    await Sync.pullAll(["bible-study.annotations"]);
    const imported = Object.keys(server.rows).length;
    assert("场景1 播种：2 条全部上服务端", imported === 2);
    assert("场景1 游标推进", (JSON.parse(store["bible-study.sync:v2:last_pulled_rev"]).annotations || 0) > 0);
    assert("场景1 itemrev 记录服务端 rev", (JSON.parse(store["bible-study.sync:v2:itemrev"])["annotations:a"] || 0) > 0);
  }

  /* 场景 2：编辑 → outbox → flush accepted → outbox 清空 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 本地编辑：加 note（写回 localStorage，模拟 app.js save() 落盘）
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "新笔记";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    assert("场景2 编辑后 outbox 有 1 条 op", JSON.parse(store["bible-study.sync:v2:outbox"] || "[]").length === 1);
    await Sync.flushPending();
    assert("场景2 flush 后 outbox 清空", JSON.parse(store["bible-study.sync:v2:outbox"] || "[]").length === 0);
    const row = server.rows["u1|annotations|a"];
    assert("场景2 服务端收到带 note 的新版本", JSON.parse(row.payload).note === "新笔记");
  }

  /* 场景 3：其他设备写入 → push 不推进游标 → flush 后补拉带回 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 其他设备直接在服务端写（rev 前进）
    server.processOps("u1", "annotations", [
      { op_id: "other-1", op: "upsert", item_id: "b", base_server_rev: 0, client_updated_at: 5, device_id: "dev-B", item: ann("b") },
    ]);
    const cursorBefore = JSON.parse(store["bible-study.sync:v2:last_pulled_rev"]).annotations;
    // 本地编辑 a → flush（写回 store 模拟 save() 落盘）
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "本地编辑";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    await Sync.flushPending();
    const cursorAfter = JSON.parse(store["bible-study.sync:v2:last_pulled_rev"]).annotations;
    assert("场景3 flush 补拉：游标前进（带上其他设备条目）", cursorAfter > cursorBefore);
    const local = Sync.stripDeleted(JSON.parse(store["bible-study.annotations"]));
    assert("场景3 其他设备的条目 b 已回本地", local.some((x) => x.id === "b"));
  }

  /* 场景 4：冲突（服务端更新）→ 服务端胜 + 败者备份 + 本地被覆盖 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 其他设备改 a（rev 前进，时间戳更晚）
    server.processOps("u1", "annotations", [
      { op_id: "other-1", op: "upsert", item_id: "a", base_server_rev: 1, client_updated_at: Date.now() + 60000, device_id: "dev-B", item: ann("a", "服务端新文本") },
    ]);
    // 本地基于旧 base 编辑（时间戳更早），写回 store 模拟 save() 落盘
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "本地旧编辑";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    await Sync.flushPending();
    const local = Sync.stripDeleted(JSON.parse(store["bible-study.annotations"])).find((x) => x.id === "a");
    assert("场景4 服务端胜：本地被服务端版本覆盖", local.text === "服务端新文本");
    const conflicts = JSON.parse(store["bible-study.sync:v2:conflicts"] || "[]");
    assert("场景4 冲突已备份（败者=本地旧编辑）", conflicts.length === 1 && conflicts[0].loser && conflicts[0].loser.note === "本地旧编辑");
    assert("场景4 outbox 清空", JSON.parse(store["bible-study.sync:v2:outbox"] || "[]").length === 0);
  }

  /* 场景 5：冲突（本地更新）→ 本地胜：换 base 重推成功，服务端版本入备份 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 其他设备以更早的时间戳改 a
    server.processOps("u1", "annotations", [
      { op_id: "other-1", op: "upsert", item_id: "a", base_server_rev: 1, client_updated_at: Date.now() - 60000, device_id: "dev-B", item: ann("a", "服务端旧文本") },
    ]);
    // 本地编辑（现在时间 → 比 1 晚），写回 store
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "本地新编辑";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    await Sync.flushPending();
    assert("场景5 本地胜：服务端最终为本地内容", JSON.parse(server.rows["u1|annotations|a"].payload).note === "本地新编辑");
    const conflicts = JSON.parse(store["bible-study.sync:v2:conflicts"] || "[]");
    assert("场景5 冲突备份（败者=服务端旧文本）", conflicts.some((c) => c.winner === "服务端旧文本" || (c.loser && c.loser.text === "服务端旧文本") || c.winnerDevice === "dev-B"));
  }

  /* 场景 6：pull 跳过 outbox 在途条目（未 flush 前拉取不覆盖本地编辑） */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 其他设备改 a
    server.processOps("u1", "annotations", [
      { op_id: "other-1", op: "upsert", item_id: "a", base_server_rev: 1, client_updated_at: 9000, device_id: "dev-B", item: ann("a", "服务端版本") },
    ]);
    // 本地编辑 a 但不 flush（写回 store）
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "在途编辑";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    await Sync.pullAll(["bible-study.annotations"]);
    const local = Sync.stripDeleted(JSON.parse(store["bible-study.annotations"])).find((x) => x.id === "a");
    assert("场景6 在途编辑不被拉取覆盖", local.note === "在途编辑");
  }

  /* 场景 7：删除 → del op → 服务端墓碑 → 再拉取本地墓碑保持 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a"), ann("b")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 本地删除 a（saveWithTombstones：live 去掉 a，deletedIds=[a]）
    await Sync.saveWithTombstones("bible-study.annotations", [ann("b")], ["a"], true);
    await Sync.flushPending();
    assert("场景7 服务端 a 变墓碑", server.rows["u1|annotations|a"].deleted === 1);
    // 另一来源全量拉取（模拟另一设备视角的本地重建）
    await Sync.forcePullAll(["bible-study.annotations"]);
    const local = JSON.parse(store["bible-study.annotations"]);
    const a = local.find((x) => x.id === "a");
    assert("场景7 强拉后 a 保持墓碑形态", a && a._del === 1);
    assert("场景7 stripDeleted 过滤墓碑", Sync.stripDeleted(local).every((x) => x.id !== "a"));
  }

  /* 场景 8：笔记 dict（chapterNotes）播种/编辑/删除 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.chapterNotes"] = JSON.stringify({ "1:24": "章笔记甲" });
    await Sync.pullAll(["bible-study.chapterNotes"]);
    assert("场景8 播种 dict", server.rows["u1|chapterNotes|1:24"] && JSON.parse(server.rows["u1|chapterNotes|1:24"].payload) === "章笔记甲");
    await Sync.saveWithTombstones("bible-study.chapterNotes", { "1:24": "章笔记乙" }, [], true);
    await Sync.flushPending();
    assert("场景8 编辑推送", JSON.parse(server.rows["u1|chapterNotes|1:24"].payload) === "章笔记乙");
    await Sync.saveWithTombstones("bible-study.chapterNotes", {}, ["1:24"], true);
    await Sync.flushPending();
    assert("场景8 删除推送（墓碑）", server.rows["u1|chapterNotes|1:24"].deleted === 1);
  }

  /* 场景 9：强制覆盖 */
  {
    const server = makeServer();
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a", "本机为准")]);
    await Sync.pullAll(["bible-study.annotations"]);
    // 其他设备写了 b 并改了 a（rev 前进）
    server.processOps("u1", "annotations", [
      { op_id: "other-1", op: "upsert", item_id: "b", base_server_rev: 0, client_updated_at: 5, device_id: "dev-B", item: ann("b", "只有服务端有") },
      { op_id: "other-2", op: "upsert", item_id: "a", base_server_rev: 1, client_updated_at: 9, device_id: "dev-B", item: ann("a", "服务端版本") },
    ]);
    await Sync.forcePushAll({ "bible-study.annotations": () => JSON.parse(store["bible-study.annotations"]) });
    assert("场景9 force：a 被本机版本覆盖", JSON.parse(server.rows["u1|annotations|a"].payload).text === "本机为准");
    assert("场景9 force：服务端独有条目 b 被清", !server.rows["u1|annotations|b"] || server.rows["u1|annotations|b"].deleted === 1);
  }

  /* 场景 10：失败可见性 */
  {
    const server = makeServer();
    server.failOps = true;
    const { Sync, store } = makeSync2(server);
    store["bible-study.annotations"] = JSON.stringify([ann("a")]);
    await Sync.pullAll(["bible-study.annotations"]);
    const arr = JSON.parse(store["bible-study.annotations"]);
    arr[0].note = "x";
    store["bible-study.annotations"] = JSON.stringify(arr);
    await Sync.schedulePush("bible-study.annotations");
    await Sync.flushPending();   // failOps=true → 推送失败
    const st = JSON.parse(store["bible-study.sync:v2:status"]);
    assert("场景10 推送失败记录 lastError", !!st.lastError);
    server.failOps = false;
    await Sync.flushPending();   // 恢复后重推成功
    const st2 = JSON.parse(store["bible-study.sync:v2:status"]);
    assert("场景10 成功后记录 lastSuccess 且错误清除", !!st2.lastSuccess && !st2.lastError);
  }

  console.log(failed === 0 ? "\n全部通过" : "\n有 " + failed + " 项失败");
  process.exit(failed === 0 ? 0 : 1);
})();
