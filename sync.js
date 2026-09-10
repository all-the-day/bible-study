/* ============================================================
 * sync.js v2 — 条目级同步客户端（2026-09 重写）
 * ============================================================
 * 协议：条目级 ops + 服务端逐条裁决，取代 v1 的「整包 GET-合并-PUT」。
 *   推：本地改动 diff 成 outbox ops（含完整 payload/base_server_rev/op_id），
 *       批量 POST /api/sync/{kind}/ops → 服务端逐条：
 *         op_id 重复          → duplicate（幂等，返回已存 rev）
 *         base_server_rev 匹配 → accepted（分配新 rev）
 *         不匹配               → conflict（附服务端当前版本）
 *         import=true          → 条目不存在才写入（首运行播种）
 *         force=true           → 跳过 base 检查（强制覆盖按钮）
 *   拉：GET /api/sync/{kind}/changes?since=rev → {from_rev,to_rev,items[]}
 *       全量应用成功后才推进 last_pulled_rev（push 永远不推进拉取游标）
 *   冲突：自动按 (client_updated_at, device_id) 裁决，败者全文存入
 *         本地冲突备份（sync:v2:conflicts），绝不静默消失
 *
 * 对 app.js 保持 v1 调用面：save→schedulePush / saveDeleted→saveWithTombstones /
 * pullAll / flushPending / stripDeleted / getPending / forcePushAll / forcePullAll。
 * 本地 localStorage 数据格式不变（数组含墓碑桩，load() 侧 stripDeleted 过滤）。
 * ============================================================ */
(function () {
  "use strict";

  var API_BASE = "https://duoban.xyz/bible-api";
  var OFFLINE = typeof window !== "undefined" && window.BIBLE_OFFLINE === true;

  // ---- v2 本地状态键（独立命名空间，与 v1 遗留数据隔离） ----
  var LS_OUTBOX = "bible-study.sync:v2:outbox";
  var LS_LAST_PULL = "bible-study.sync:v2:last_pulled_rev";
  var LS_ITEMREV = "bible-study.sync:v2:itemrev";
  var LS_DEVICE = "bible-study.sync:v2:device_id";
  var LS_CONFLICTS = "bible-study.sync:v2:conflicts";
  var LS_STATUS = "bible-study.sync:v2:status";
  var LS_LASTLOCAL = "bible-study.sync:v2:lastlocal";

  var SYNC_KINDS = ["annotations", "chapterNotes", "lrNotes", "bookNotes", "morningNotes"];
  var KIND_IS_ARRAY = { annotations: true, chapterNotes: false, lrNotes: false, bookNotes: false, morningNotes: false };
  var KEY_MAP = {
    "bible-study.annotations": "annotations",
    "bible-study.chapterNotes": "chapterNotes",
    "bible-study.lrNotes": "lrNotes",
    "bible-study.bookNotes": "bookNotes",
    "bible-study.morningNotes": "morningNotes",
  };
  var KIND_TO_KEY = {};
  Object.keys(KEY_MAP).forEach(function (k) { KIND_TO_KEY[KEY_MAP[k]] = k; });

  var synced = false;
  var remoteOk = false;
  var listeners = [];
  var flushTimer = null;
  var flushing = null;

  // ---------- 基础工具 ----------
  function jget(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function jset(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function readRaw(localKey) {
    try {
      var v = localStorage.getItem(localKey);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function getRaw(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : undefined; }
    catch (e) { return undefined; }
  }
  function isDel(v) { return !!(v && typeof v === "object" && v._del); }
  function stripDeleted(value) {
    if (Array.isArray(value)) return value.filter(function (x) { return !isDel(x); });
    if (value && typeof value === "object") {
      var out = {};
      for (var k in value) if (!isDel(value[k])) out[k] = value[k];
      return out;
    }
    return value;
  }
  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function deviceId() {
    var id = localStorage.getItem(LS_DEVICE);
    if (!id) {
      id = uuid();
      try { localStorage.setItem(LS_DEVICE, id); } catch (e) {}
    }
    return id;
  }
  function account() {
    try { return JSON.parse(localStorage.getItem("bible-study.account")); }
    catch (e) { return null; }
  }
  function syncActive() { return !!account(); }

  // ---------- 状态与通知 ----------
  function getStatus() { return jget(LS_STATUS, {}); }
  function setStatus(patch) {
    var s = getStatus();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    jset(LS_STATUS, s);
  }
  function clearError() {
    var s = getStatus();
    if (s.lastError !== undefined) { delete s.lastError; delete s.errorAt; jset(LS_STATUS, s); }
  }
  function notify() { listeners.forEach(function (f) { f({ synced: synced, remoteOk: remoteOk }); }); }
  function onStatus(fn) { listeners.push(fn); }

  function getPending() { return jget(LS_OUTBOX, []); }
  function hasPending() { return getPending().length > 0; }
  function getConflicts() { return jget(LS_CONFLICTS, []); }

  // ---------- outbox / 游标 / 条目版本 ----------
  function getOutbox() { return jget(LS_OUTBOX, []); }
  function setOutbox(ob) { jset(LS_OUTBOX, ob); }
  function removeOutbox(opId) {
    setOutbox(getOutbox().filter(function (o) { return o.op_id !== opId; }));
  }
  function getLastPull() { return jget(LS_LAST_PULL, {}); }
  function getItemrev() { return jget(LS_ITEMREV, {}); }
  function setItemrev(map) { jset(LS_ITEMREV, map); }
  function setItemRev(kind, itemId, rev) {
    var m = getItemrev();
    m[kind + ":" + itemId] = rev;
    setItemrev(m);
  }
  function getLastLocal() { return jget(LS_LASTLOCAL, {}); }

  function http(path, method, body) {
    var headers = body !== undefined ? { "Content-Type": "application/json" } : {};
    var acct = account();
    if (acct && acct.token) headers["Authorization"] = "Bearer " + acct.token;
    // 超时保护：连接黑洞（弱网/服务端半死）时 fetch 会永久挂起，
    // 导致 flushing 永不清空、同步静默卡死且不产生 lastError
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timedOut = false;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, 20000) : null;
    return fetch(API_BASE + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    }).catch(function (e) {
      if (timedOut) throw new Error("请求超时");
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // ---------- 本地改动 → outbox ops ----------
  function mkUpsert(kind, itemId, item, ts, base, devId) {
    return { op_id: uuid(), kind: kind, op: "upsert", item_id: itemId,
             item: item, client_updated_at: ts, base_server_rev: base || 0, device_id: devId };
  }
  function mkDel(kind, itemId, ts, base, devId) {
    return { op_id: uuid(), kind: kind, op: "del", item_id: itemId,
             client_updated_at: ts, base_server_rev: base || 0, device_id: devId };
  }

  /* diff 旧快照 vs 新原始值，生成 ops。
     数组（annotations）：按 id 比较；新值是墓碑 → del；内容变/新增 → upsert；旧有新无 → del。
     dict（笔记）：按 key 比较，同理（payload = 笔记文本）。 */
  function diffKeyToOps(kind, oldRaw, newRaw) {
    var ops = [];
    var now = Date.now();
    var dev = deviceId();
    var itemrev = getItemrev();
    var baseOf = function (id) { return itemrev[kind + ":" + id] || 0; };
    var oldMap = {}, newMap = {};
    if (KIND_IS_ARRAY[kind]) {
      (Array.isArray(oldRaw) ? oldRaw : []).forEach(function (x) { if (x && x.id !== undefined) oldMap[x.id] = x; });
      (Array.isArray(newRaw) ? newRaw : []).forEach(function (x) { if (x && x.id !== undefined) newMap[x.id] = x; });
    } else {
      oldRaw = (oldRaw && typeof oldRaw === "object" && !Array.isArray(oldRaw)) ? oldRaw : {};
      newRaw = (newRaw && typeof newRaw === "object" && !Array.isArray(newRaw)) ? newRaw : {};
      Object.keys(oldRaw).forEach(function (k) { oldMap[k] = oldRaw[k]; });
      Object.keys(newRaw).forEach(function (k) { newMap[k] = newRaw[k]; });
    }
    Object.keys(newMap).forEach(function (id) {
      var nv = newMap[id], ov = oldMap[id];
      var nd = isDel(nv), od = isDel(ov);
      if (nd && od) return;                                   // 两侧皆墓碑：无变化
      if (nd && !od) { ops.push(mkDel(kind, id, nv._t || now, baseOf(id), dev)); return; }
      if (JSON.stringify(nv) === JSON.stringify(ov)) return;  // 内容未变
      ops.push(mkUpsert(kind, id, nv, now, baseOf(id), dev));
    });
    Object.keys(oldMap).forEach(function (id) {
      if (id in newMap) return;
      if (isDel(oldMap[id])) return;
      ops.push(mkDel(kind, id, now, baseOf(id), dev));        // 旧有新无 = 删除
    });
    return ops;
  }

  /* app.js save() 落盘后调用：diff 出 ops 入 outbox（同条目未确认 op 替换为最新意图） */
  function schedulePush(localKey) {
    var kind = KEY_MAP[localKey];
    if (!kind) return Promise.resolve(false);
    var newRaw = readRaw(localKey);
    var lastLocal = getLastLocal();
    var oldRaw = lastLocal[localKey] !== undefined ? lastLocal[localKey] : null;
    var ops = diffKeyToOps(kind, oldRaw, newRaw);
    if (ops.length) {
      var ob = getOutbox();
      ops.forEach(function (op) {
        for (var i = 0; i < ob.length; i++) {
          if (ob[i].kind === kind && ob[i].item_id === op.item_id) {
            op.base_server_rev = ob[i].base_server_rev;   // base 链条保持不变
            ob[i] = op;
            break;
          }
        }
        if (i >= ob.length) ob.push(op);
      });
      setOutbox(ob);
    }
    lastLocal[localKey] = newRaw;
    jset(LS_LASTLOCAL, lastLocal);
    notify();
    if (ops.length) scheduleFlush();
    return Promise.resolve(true);
  }

  /* app.js saveDeleted() 落盘后调用：存储写入（含墓碑合并）后走同一 diff 通道 */
  function saveWithTombstones(localKey, live, deletedIds, push) {
    var raw = readRaw(localKey);
    var out;
    if (Array.isArray(live)) {
      out = live.slice();
      var ids = {};
      out.forEach(function (x) { if (x && x.id !== undefined) ids[x.id] = 1; });
      (Array.isArray(raw) ? raw : []).forEach(function (item) {
        if (isDel(item) && !ids[item.id]) out.push(item);
      });
      (deletedIds || []).forEach(function (id) {
        out.push({ id: id, _del: 1, _t: Date.now() });
      });
    } else {
      out = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        Object.keys(raw).forEach(function (k) { if (isDel(raw[k])) out[k] = raw[k]; });
      }
      Object.assign(out, live);
      (deletedIds || []).forEach(function (k) { out[k] = { _del: 1, _t: Date.now() }; });
    }
    try { localStorage.setItem(localKey, JSON.stringify(out)); } catch (e) {}
    if (push === false) return Promise.resolve(false);
    return schedulePush(localKey);
  }

  // ---------- 应用服务端条目到本地 ----------
  /* 返回是否应用成功：存储写入失败（如配额）返回 false，供 pullKind 决定是否推进游标 */
  function applyServerItem(kind, it) {
    var localKey = KIND_TO_KEY[kind];
    if (!localKey) return true;
    var raw = readRaw(localKey);
    if (KIND_IS_ARRAY[kind]) {
      var arr = Array.isArray(raw) ? raw : [];
      var idx = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === it.item_id) { idx = i; break; }
      }
      if (it.deleted) {
        var stub = { id: it.item_id, _del: 1, _t: it.server_updated_at || Date.now() };
        if (idx >= 0) arr[idx] = stub; else arr.push(stub);
      } else if (idx >= 0) {
        arr[idx] = it.payload;
      } else {
        arr.push(it.payload);
      }
      try { localStorage.setItem(localKey, JSON.stringify(arr)); } catch (e) { return false; }
    } else {
      var obj = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
      if (it.deleted) obj[it.item_id] = { _del: 1, _t: it.server_updated_at || Date.now() };
      else obj[it.item_id] = it.payload;
      try { localStorage.setItem(localKey, JSON.stringify(obj)); } catch (e) { return false; }
    }
    var lastLocal = getLastLocal();
    lastLocal[localKey] = readRaw(localKey);   // 快照同步，防后续 diff 误判
    jset(LS_LASTLOCAL, lastLocal);
    return true;
  }

  // ---------- 冲突裁决 ----------
  /* 备份一场冲突的双方全文（localWins 时本地是胜者，标签需相应翻转）。
     注意：sync2-test 场景 4/5 的断言依赖 winner/loser 语义，改动需同步测试 */
  function recordConflict(kind, op, current, localWins) {
    var localPayload = op.op === "upsert" ? op.item : null;
    var localDeleted = op.op === "del";
    var serverPayload = current.payload;
    var serverDeleted = !!current.deleted;
    var list = getConflicts();
    list.push({
      at: Date.now(), kind: kind, item_id: op.item_id,
      loser: localWins ? serverPayload : localPayload,
      loserDeleted: localWins ? serverDeleted : localDeleted,
      winner: localWins ? localPayload : serverPayload,
      winnerDeleted: localWins ? localDeleted : serverDeleted,
      winnerDevice: localWins ? (op.device_id || "") : current.device_id,
    });
    if (list.length > 100) list = list.slice(-100);   // 上限 100 条，够回溯用
    jset(LS_CONFLICTS, list);
  }

  /* 自动裁决：本地晚→以服务端当前 rev 为 base 重推；服务端晚→应用服务端版本+备份败者 */
  function resolveConflict(kind, op, current) {
    var localTs = op.client_updated_at || 0;
    var serverTs = current.client_updated_at || 0;
    var localDev = op.device_id || "";
    var serverDev = current.device_id || "";
    var localWins = localTs > serverTs ||
      (localTs === serverTs && localDev > serverDev);
    if (localWins) {
      removeOutbox(op.op_id);                  // 旧 op 出队，换新 op_id/base 重新排队
      op.base_server_rev = current.server_rev;
      op.op_id = uuid();
      recordConflict(kind, op, current, true);   // 本地胜：备份被覆盖的服务端版本（loser=服务端）
      var ob = getOutbox();
      ob.push(op);
      setOutbox(ob);
      setItemRev(kind, op.item_id, current.server_rev);
    } else {
      recordConflict(kind, op, current, false);  // 服务端胜：备份本地编辑（loser=本地）
      applyServerItem(kind, {
        item_id: op.item_id, payload: current.payload, deleted: current.deleted,
        server_updated_at: Date.now(),
      });
      setItemRev(kind, op.item_id, current.server_rev);
      removeOutbox(op.op_id);
    }
  }

  // ---------- 推送（flush outbox） ----------
  function applyResults(kind, sentOps, results) {
    var byOpId = {};
    sentOps.forEach(function (o) { byOpId[o.op_id] = o; });
    var requeue = false;
    (results || []).forEach(function (r) {
      var op = byOpId[r.op_id];
      if (!op) return;
      if (r.status === "accepted" || r.status === "imported" || r.status === "duplicate" || r.status === "exists") {
        if (r.server_rev !== undefined) setItemRev(kind, op.item_id, r.server_rev);
        removeOutbox(op.op_id);
      } else if (r.status === "conflict") {
        resolveConflict(kind, op, r.current || {});
        if (getOutbox().some(function (o) { return o.op_id === op.op_id; })) requeue = true;
      } else {
        removeOutbox(op.op_id);   // bad_op：丢弃（协议错误，静默保留会永久卡住）
      }
    });
    return requeue;
  }

  function flushOutbox() {
    if (!syncActive() || OFFLINE) return Promise.resolve({ ok: false, accepted: 0 });
    var ob = getOutbox();
    if (!ob.length) { setStatus({ lastSuccess: Date.now() }); clearError(); return Promise.resolve({ ok: true, accepted: 0 }); }
    var anyFail = false;
    var totalAccepted = 0;
    /* 冲突「本地胜」会把换 base 的 op 重新排回 outbox：循环处理直到清空或无进展（上限 3 轮防打环） */
    var rounds = 0;
    var runRound = function () {
      rounds++;
      var current = getOutbox();
      if (!current.length) return Promise.resolve();
      var byKind = {};
      current.forEach(function (o) { (byKind[o.kind] = byKind[o.kind] || []).push(o); });
      var seq = Promise.resolve();
      var progress = false;   // 任何非 bad_op 的结果都算进展（conflict=base 已刷新，下轮接受）
      Object.keys(byKind).forEach(function (kind) {
        seq = seq.then(function () {
          return http("/api/sync/" + kind + "/ops", "POST", { ops: byKind[kind] })
            .then(function (resp) {
              (resp.results || []).forEach(function (r) {
                if (r.status !== "bad_op") progress = true;   // conflict 也算：base 已刷新，下轮接受
              });
              applyResults(kind, byKind[kind], resp.results || []);
            }, function (e) {
              anyFail = true;
              setStatus({ lastError: (e && e.message) || "推送失败", errorAt: Date.now() });
            });
        });
      });
      return seq.then(function () {
        totalAccepted += progress ? 1 : 0;
        if (getOutbox().length && progress && rounds < 3) return runRound();
      });
    };
    return runRound().then(function () {
      if (anyFail) { notify(); return { ok: false, accepted: totalAccepted }; }
      setStatus({ lastSuccess: Date.now() });
      clearError();
      notify();
      return { ok: true, accepted: totalAccepted };
    });
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      // 追踪器守卫：旧 flush 完成时若已链上新 flush（flushing 已被替换）不得清空，
      // 否则后续 timer 会与在途 flush 并发（重复 POST；服务端幂等但浪费）
      var p = flushing ? flushing.then(function () { return flushOutbox(); }) : flushOutbox();
      flushing = p;
      var settle = function () { if (flushing === p) flushing = null; };
      p.then(settle, settle);
    }, 800);
  }

  /* flushPending：app.js 同步循环调用。本轮有接受 op（服务端 rev 前进）
     则补拉一次，把其他设备并发推入的变化带回来 */
  function flushPending() {
    if (!syncActive() || OFFLINE) return Promise.resolve(false);
    return flushOutbox().then(function (r) {
      if (r.ok && r.accepted > 0) return pullAll(SYNC_KINDS.map(function (k) { return KIND_TO_KEY[k]; })).then(function () { return r.ok; });
      return r.ok;
    });
  }

  // ---------- 拉取 ----------
  function pullKind(kind, since) {
    return http("/api/sync/" + kind + "/changes?since=" + since).then(function (d) {
      var ob = getOutbox();
      var items = d.items || [];
      var failed = 0;
      items.forEach(function (it) {
        var pending = ob.some(function (o) { return o.kind === kind && o.item_id === it.item_id; });
        if (pending) return;                       // 本地有未确认编辑：不覆盖，交由 push conflict 流程
        if (applyServerItem(kind, it)) setItemRev(kind, it.item_id, it.server_rev);
        else failed++;
      });
      if (failed) {
        // 应用失败（如存储配额）不推进游标：下次拉取重试本批（已成功条目重复应用幂等）
        throw new Error("本地存储写入失败 " + failed + " 条，本批稍后重试");
      }
      var lp = getLastPull();
      lp[kind] = d.to_rev;                         // 全量应用完毕才推进拉取游标
      jset(LS_LAST_PULL, lp);
      return items.length;
    });
  }

  /* 首次运行播种：把本地全部条目以 import-if-absent 推上服务端（不覆盖已有），
     随后从 0 全量拉取对齐（exists/imported 结果都会带上 server_rev） */
  function seedKind(kind) {
    var localKey = KIND_TO_KEY[kind];
    var raw = readRaw(localKey);
    var dev = deviceId();
    var now = Date.now();
    var itemrev = getItemrev();
    var ops = [];
    if (KIND_IS_ARRAY[kind]) {
      (Array.isArray(raw) ? raw : []).forEach(function (x) {
        if (!x || x.id === undefined) return;
        var base = { op_id: uuid(), kind: kind, item_id: x.id, import: true,
                     client_updated_at: x.createdAt || x._t || now, device_id: dev };
        if (isDel(x)) { base.op = "del"; base.client_updated_at = x._t || now; }
        else { base.op = "upsert"; base.item = x; }
        ops.push(base);
      });
    } else {
      raw = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
      Object.keys(raw).forEach(function (k) {
        var v = raw[k];
        var base = { op_id: uuid(), kind: kind, item_id: k, import: true, device_id: dev,
                     client_updated_at: (v && v._t) || now };
        if (isDel(v)) base.op = "del";
        else { base.op = "upsert"; base.item = v; }
        ops.push(base);
      });
    }
    var seq = Promise.resolve();
    for (var i = 0; i < ops.length; i += 200) {
      (function (batch) {
        seq = seq.then(function () {
          return http("/api/sync/" + kind + "/ops", "POST", { ops: batch }).then(function (resp) {
            (resp.results || []).forEach(function (r) {
              if (r.server_rev !== undefined) {
                itemrev[kind + ":" + r.item_id] = r.server_rev;
              }
            });
          });
        });
      })(ops.slice(i, i + 200));
    }
    return seq.then(function () { setItemrev(itemrev); return ops.length; });
  }

  /* pullAll：app.js 同步循环入口。未播种过的 kind 先播种，再增量拉 */
  function pullAll(localKeys) {
    if (!syncActive() || OFFLINE) return Promise.resolve(false);
    var kinds = [];
    (localKeys || SYNC_KINDS.map(function (k) { return KIND_TO_KEY[k]; })).forEach(function (k) {
      var kind = KEY_MAP[k];
      if (kind && kinds.indexOf(kind) === -1) kinds.push(kind);
    });
    var lp = getLastPull();
    var seq = Promise.resolve();
    kinds.forEach(function (kind) {
      seq = seq.then(function () {
        if (lp[kind] === undefined) {
          return seedKind(kind).then(function () { return pullKind(kind, 0); });
        }
        return pullKind(kind, lp[kind]);
      });
    });
    return seq.then(function () {
      synced = true;
      remoteOk = true;
      setStatus({ lastSuccess: Date.now() });
      clearError();
      notify();
      return true;
    }).catch(function (e) {
      remoteOk = false;
      setStatus({ lastError: (e && e.message) || "拉取失败", errorAt: Date.now() });
      notify();
      return false;
    });
  }

  // ---------- 强制覆盖（设置弹窗按钮） ----------
  /* 以本机为准：本地全部条目 force upsert + 服务端有而本地无的条目 force del。
     服务端清单先全量拉取（since=0 仅用于比对，不推进游标、不写本地） */
  function forcePushAll(getterByKey) {
    if (!syncActive()) return Promise.resolve({ pushed: 0, failed: 0 });
    var dev = deviceId();
    var now = Date.now();
    var allOps = [];
    var localIds = {};
    Object.keys(getterByKey).forEach(function (localKey) {
      var kind = KEY_MAP[localKey];
      if (!kind) return;
      var raw = getterByKey[localKey]();
      if (KIND_IS_ARRAY[kind]) {
        (Array.isArray(raw) ? raw : []).forEach(function (x) {
          if (!x || x.id === undefined) return;
          localIds[kind + ":" + x.id] = 1;
          if (isDel(x)) allOps.push({ op_id: uuid(), kind: kind, op: "del", item_id: x.id,
            client_updated_at: x._t || now, base_server_rev: 0, force: true, device_id: dev });
          else {
            var up = mkUpsert(kind, x.id, x, now, 0, dev);
            up.force = true;
            allOps.push(up);
          }
        });
      } else {
        raw = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
        Object.keys(raw).forEach(function (k) {
          localIds[kind + ":" + k] = 1;
          if (isDel(raw[k])) allOps.push({ op_id: uuid(), kind: kind, op: "del", item_id: k,
            client_updated_at: raw[k]._t || now, base_server_rev: 0, force: true, device_id: dev });
          else {
            var up = mkUpsert(kind, k, raw[k], now, 0, dev);
            up.force = true;
            allOps.push(up);
          }
        });
      }
    });
    // 服务端有而本地无 → force del（本机为准的完整语义）
    var kindsSet = {};
    Object.keys(getterByKey).forEach(function (k) { var kind = KEY_MAP[k]; if (kind) kindsSet[kind] = 1; });
    var serverList = Promise.all(Object.keys(kindsSet).map(function (kind) {
      return http("/api/sync/" + kind + "/changes?since=0").then(function (d) {
        (d.items || []).forEach(function (it) {
          if (!localIds[kind + ":" + it.item_id] && !it.deleted) {
            allOps.push({ op_id: uuid(), kind: kind, op: "del", item_id: it.item_id,
              client_updated_at: now, base_server_rev: it.server_rev, force: true, device_id: dev });
          }
        });
      }).catch(function () {});   // 清单拉不到就只推本地条目
    }));
    return serverList.then(function () {
      var pushed = 0, failed = 0;
      var seq = Promise.resolve();
      for (var i = 0; i < allOps.length; i += 200) {
        (function (batch) {
          seq = seq.then(function () {
            var byKind = {};
            batch.forEach(function (op) { (byKind[op.kind] = byKind[op.kind] || []).push(op); });
            return Promise.all(Object.keys(byKind).map(function (kind) {
              return http("/api/sync/" + kind + "/ops", "POST", { ops: byKind[kind] }).then(function (resp) {
                applyResults(kind, byKind[kind], resp.results || []);
                return (resp.results || []).filter(function (r) { return r.status === "accepted"; }).length;
              }, function () {
                failed += byKind[kind].length;
                return 0;
              });
            })).then(function (counts) {
              counts.forEach(function (c) { pushed += c; });
            });
          });
        })(allOps.slice(i, i + 200));
      }
      return seq.then(function () {
        setStatus({ lastSuccess: failed ? getStatus().lastSuccess : Date.now() });
        notify();
        return { pushed: pushed, failed: failed };
      });
    });
  }

  /* 以云端为准：清空 outbox（放弃本地未确认编辑）→ 游标归零全量拉取重建。
     语义注意（2026-09-10 用户确认保持现状，勿当 bug 修）：本函数是「云端合并进本机」——
     applyServerItem 只覆盖/追加，不删除本机独有条目；与 forcePushAll 的完整覆盖
     语义刻意不对称，防误删本地数据。 */
  function forcePullAll(localKeys) {
    if (!syncActive()) return Promise.resolve({ pulled: 0, failed: 0 });
    setOutbox([]);
    var lp = getLastPull();
    var kinds = [];
    (localKeys || SYNC_KEYS()).forEach(function (k) {
      var kind = KEY_MAP[k]; if (kind) kinds.push(kind);
    });
    kinds.forEach(function (kind) { lp[kind] = 0; });
    jset(LS_LAST_PULL, lp);
    var pulled = 0, failed = 0;
    var seq = Promise.resolve();
    kinds.forEach(function (kind) {
      seq = seq.then(function () {
        return pullKind(kind, 0).then(function (n) { pulled += n; }, function () { failed++; });
      });
    });
    return seq.then(function () {
      synced = true;
      setStatus({ lastSuccess: Date.now() });
      notify();
      return { pulled: pulled, failed: failed };
    });
  }

  function SYNC_KEYS() {
    return Object.keys(KEY_MAP);
  }

  /* 服务端统计（数据对比用）：每 kind 拉 changes?since=0 计数（live/墓碑/按模块含笔记数） */
  function getServerStats() {
    if (!syncActive() || OFFLINE) return Promise.resolve(null);
    var out = {};
    var seq = Promise.resolve();
    SYNC_KINDS.forEach(function (kind) {
      seq = seq.then(function () {
        return http("/api/sync/" + kind + "/changes?since=0").then(function (d) {
          var stats = { total: (d.items || []).length, live: 0, tombstones: 0, types: null };
          (d.items || []).forEach(function (it) {
            if (it.deleted) { stats.tombstones++; return; }
            stats.live++;
            if (kind === "annotations") {
              if (!stats.types) stats.types = { verse: [0, 0], lr: [0, 0], book: [0, 0], morning: [0, 0] };
              var p = it.payload || {};
              var t = stats.types[p.type];
              if (t) { t[0]++; if (p.note) t[1]++; }
            }
          });
          out[kind] = stats;
        }).catch(function () { out[kind] = null; });
      });
    });
    return seq.then(function () { return out; });
  }

  window.BibleStudySync = {
    schedulePush: schedulePush,
    saveWithTombstones: saveWithTombstones,
    pullAll: pullAll,
    flushPending: flushPending,
    forcePushAll: forcePushAll,
    forcePullAll: forcePullAll,
    getPending: getPending,
    hasPending: hasPending,
    getConflicts: getConflicts,
    getStatus: getStatus,
    getServerStats: getServerStats,
    stripDeleted: stripDeleted,
    onStatus: onStatus,
    isSynced: function () { return synced; },
    isRemoteOk: function () { return remoteOk; },
  };
})();
