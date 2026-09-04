/* ============================================================
 * sync.js — 标注/笔记云同步（通用 KV 存储 API 客户端）
 * 服务器为主 + localStorage 缓存：离线可读、联网同步
 * 复用 duoban.xyz 的通用 KV API（与 bible-reader 同一服务）
 * ============================================================ */
(function () {
  "use strict";

  const API_BASE = "https://duoban.xyz/bible-api";

  const OFFLINE = window.BIBLE_OFFLINE === true;

  // 账号（localStorage 'bible-study.account'，app.js 授权码兑换后写入）：
  // {uid: 'u1', token: '...'}；无账号时同步不启用（app.js 门控），此处只负责带上凭据
  function account() {
    try {
      return JSON.parse(localStorage.getItem("bible-study.account")) || null;
    } catch (e) {
      return null;
    }
  }

  /* 本地 key → 服务器 key 映射 */
  const KEY_MAP = {
    "bible-study.annotations": "bible-study:annotations",
    "bible-study.chapterNotes": "bible-study:chapterNotes",
    "bible-study.lrNotes": "bible-study:lrNotes",
    "bible-study.bookNotes": "bible-study:bookNotes",
    "bible-study.morningNotes": "bible-study:morningNotes",
  };

  /* pending 标记：push 失败时记录，防止 pull 覆盖本地离线新增 */
  const PENDING_KEY = "bible-study.pending";

  function getPending() {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }
  function setPending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) {}
  }
  /* 修订号：每次标 pending 自增，用于识别「推送/flush 进行中又发生了新写」——
     此时成功后的 clearPending/写回会丢新值，必须保留 pending 等下轮重推 */
  const pendingRev = {};
  function markPending(localKey) {
    const list = getPending();
    if (!list.includes(localKey)) list.push(localKey);
    pendingRev[localKey] = (pendingRev[localKey] || 0) + 1;
    setPending(list);
  }
  function clearPending(localKey) {
    setPending(getPending().filter((k) => k !== localKey));
  }
  function isPending(localKey) {
    return getPending().includes(localKey);
  }

  /* 同步状态（供 UI 显示） */
  let synced = false;
  let remoteOk = true;
  const listeners = [];
  function notify() { listeners.forEach((f) => f({ synced, remoteOk })); }
  function onStatus(fn) { listeners.push(fn); }

  function remoteKey(localKey) {
    const acct = account();
    const uid = acct && acct.uid ? acct.uid : "u1";
    return uid + ":" + (KEY_MAP[localKey] || localKey);
  }

  function http(path, method, body) {
    const headers = body !== undefined ? { "Content-Type": "application/json" } : {};
    const acct = account();
    if (acct && acct.token) headers["Authorization"] = "Bearer " + acct.token;
    return fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((res) => {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    });
  }

  /* 拉取远端值：key 不存在 → null；请求失败/超时 → undefined（与 null 区分，防止盲推覆盖） */
  function fetchRemote(localKey, timeoutMs = 5000) {
    if (OFFLINE) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      http("/api/kv/" + encodeURIComponent(remoteKey(localKey)), "GET")
        .then((data) => {
          clearTimeout(timer);
          resolve(data.value !== undefined ? data.value : null);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(undefined);
        });
    });
  }

  function getRemote(localKey, timeoutMs = 5000) {
    if (OFFLINE) return Promise.resolve(null);
    if (isPending(localKey)) return Promise.resolve(null);
    return fetchRemote(localKey, timeoutMs);
  }

  function putRemote(localKey, value, timeoutMs = 5000) {
    if (OFFLINE) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        remoteOk = false;
        markPending(localKey);
        notify();
        resolve(false);
      }, timeoutMs);
      http("/api/kv/" + encodeURIComponent(remoteKey(localKey)), "PUT", value)
        .then(() => {
          clearTimeout(timer);
          remoteOk = true;
          clearPending(localKey);
          notify();
          resolve(true);
        })
        .catch(() => {
          clearTimeout(timer);
          remoteOk = false;
          markPending(localKey);
          notify();
          resolve(false);
        });
    });
  }

  /* ── 删除墓碑（tombstone）────────────────────────────────────────────────
     并集合并语义下，「本地删掉一条」在合并时无法与「本地从来没有这条」区分，
     推送后服务器旧记录仍在，下次 pullAll（服务器为主）会把已删条目复活。
     因此删除时不真抹掉，而是在存储里留下墓碑桩 {_del:1,_t}，随同步推到云端：
       - 数组（annotations）：{id, _del:1, _t} 留在数组里，占着原 id
       - 对象（笔记 dict）：store[key] = {_del:1,_t}，占着原 key
     内存态经 stripDeleted 过滤，UI 无需感知墓碑。
     墓碑与它标记的数据在同一个 KV 值里 → 一次 PUT 原子生效，不存在跨键竞态。 */
  const DEL = "_del";

  function isDeleted(v) {
    return !!(v && typeof v === "object" && v[DEL]);
  }

  /** 剔除墓碑桩，得到干净的内存态（数组滤元素 / 对象删 key），其他类型原样返回 */
  function stripDeleted(value) {
    if (Array.isArray(value)) return value.filter((x) => !isDeleted(x));
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value)) if (!isDeleted(value[k])) out[k] = value[k];
      return out;
    }
    return value;
  }

  /** 删除落盘 + 推云：live 为内存态（已剔除墓碑），deletedIds 为本次删除的标识
      （数组传 id、对象传 key）。必须把 localStorage 里「既有的墓碑」合进来，
      否则连续删两条时后一次落盘会丢掉前一次的墓碑。
      push 显式传入：未启用同步（无账号）时只落盘不推——否则会以默认 u1 命名空间写到别人的数据里 */
  function saveWithTombstones(localKey, live, deletedIds, push) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(localKey)); } catch (e) { raw = null; }
    let out;
    if (Array.isArray(live)) {
      out = live.slice();
      const ids = new Set(out.map((x) => x && x.id));
      for (const item of Array.isArray(raw) ? raw : []) {
        if (isDeleted(item) && !ids.has(item.id)) out.push(item);
      }
      for (const id of deletedIds) out.push({ id: id, [DEL]: 1, _t: Date.now() });
    } else {
      out = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const k of Object.keys(raw)) if (isDeleted(raw[k])) out[k] = raw[k];
      }
      Object.assign(out, live);
      for (const k of deletedIds) out[k] = { [DEL]: 1, _t: Date.now() };
    }
    try { localStorage.setItem(localKey, JSON.stringify(out)); } catch (e) {}
    if (push === false) return Promise.resolve(false);
    return schedulePush(localKey);
  }

  /* 合并「服务器当前值」与「本地待推值」：数组按 id 并集（同 id 本机赢），对象按键浅合并（本机赢）。
     防止旧快照整体 PUT 覆盖其他设备推上去的新数据（last-write-wins 数据丢失）。
     墓碑优先规则（两条不同，理由见注释）：
       - 数组：同 id 一端是墓碑 → 墓碑赢。标注 id 是 uuid 永不复用，
         删除必须压过其他设备上的旧副本（否则 A 删了、B 的旧副本一推就复活）。
       - 对象：远端是墓碑而本端有真值 → 本端真值赢，支持「删了又在同 key 重新写」；
         启动时 pullAll 先于 flushPending，上线设备总是先学到删除再推送，
         所以这不会让离线期间的旧笔记复活。 */
  function mergeRemoteLocal(remote, local) {
    if (Array.isArray(local)) {
      if (!Array.isArray(remote)) return local;
      const merged = remote.slice();
      for (const item of local) {
        const id = item && item.id;
        if (id === undefined) {
          merged.push(item);
          continue;
        }
        const idx = merged.findIndex((x) => x && x.id === id);
        if (idx === -1) merged.push(item);
        else if (isDeleted(merged[idx]) && !isDeleted(item)) continue; // 墓碑优先：远端已删则不复活
        else merged[idx] = item;
      }
      return merged;
    }
    if (local && typeof local === "object") {
      const base = remote && typeof remote === "object" && !Array.isArray(remote) ? remote : {};
      return Object.assign({}, base, local);
    }
    return local;
  }

  /* 运行时直推（save() 防抖后调用）：推送前先拉服务器当前值合并（与 flushPending 同语义），
     并按 key 串行化——同 key 的推送不会并发在途，消除「先发的旧快照后到覆盖新数据」与
     pending 清除竞态（旧推送成功清掉新推送失败标的 pending） */
  const inflight = {};
  function putRemoteMerged(localKey) {
    const run = async () => {
      const rev = pendingRev[localKey] || 0;
      let local = null;
      try { local = JSON.parse(localStorage.getItem(localKey)); } catch (e) { local = null; }
      if (local === null || local === undefined) return false; // 无本地值不推（防 undefined 盲推）
      const remote = await fetchRemote(localKey);
      if (remote === undefined) {
        // 拉不到服务器当前值：不盲推（可能覆盖其他设备新数据），标 pending 交给下次启动 flush 重试
        markPending(localKey);
        notify();
        return false;
      }
      const ok = await putRemote(localKey, mergeRemoteLocal(remote, local));
      // 推送期间（GET/PUT 在途）又有新写：putRemote 的 clearPending 会误清新写的 pending，恢复它
      if (ok && rev !== (pendingRev[localKey] || 0)) markPending(localKey);
      return ok;
    };
    const p = (inflight[localKey] || Promise.resolve()).then(run, run);
    inflight[localKey] = p.catch(() => {});
    return p;
  }

  /* 防抖推送入口（app.js save() 每次本地写调用）：
     落笔即标 pending（本地有未确认推送的改动），推送成功由 putRemote 清除。
     页面在防抖窗口内关闭 → pending 已在，下次启动 flushPending 重推，不丢数据 */
  const pushTimers = {};
  const pushResolvers = {};
  function schedulePush(localKey, delay = 800) {
    markPending(localKey);
    notify(); // 状态行立即转「有改动待同步」
    clearTimeout(pushTimers[localKey]);
    if (pushResolvers[localKey]) pushResolvers[localKey](); // 被合并的旧调度立即解决（其推送由本次调度承担）
    return new Promise((resolve) => {
      pushResolvers[localKey] = resolve;
      pushTimers[localKey] = setTimeout(() => {
        delete pushTimers[localKey];
        delete pushResolvers[localKey];
        resolve(putRemoteMerged(localKey));
      }, delay);
    });
  }

  /** 启动时重试所有 pending 的本地改动（推送前先拉取服务器当前值合并，防止旧快照覆盖其他数据） */
  async function flushPending(getterByKey) {
    for (const localKey of getPending()) {
      const local = getterByKey(localKey);
      if (local === undefined) continue;
      const rev = pendingRev[localKey] || 0;
      const remote = await fetchRemote(localKey);
      if (remote === undefined) continue; // 拉不到服务器当前值就本轮不推，保留 pending 下轮再试
      const merged = mergeRemoteLocal(remote, local);
      const ok = await putRemote(localKey, merged);
      if (ok) {
        if (rev !== (pendingRev[localKey] || 0)) {
          // flush 期间又有新写：不写回 merged（会覆盖更新的本地值），恢复 pending 下轮重推
          markPending(localKey);
          continue;
        }
        try { localStorage.setItem(localKey, JSON.stringify(merged)); } catch (e) {}
      }
    }
  }

  /** 启动同步：服务器为主，成功后覆盖本地；失败保持本地 */
  async function pullAll(localKeys) {
    const results = await Promise.all(localKeys.map((k) => getRemote(k)));
    let anyRemote = false;
    localKeys.forEach((k, i) => {
      const v = results[i];
      // v 可能是 null（key 不存在）或 undefined（请求失败/超时）：都不得写入本地，
      // 否则 JSON.stringify(undefined) 会把本地键写成字符串 "undefined"，清空数据后盲推覆盖云端
      if (v != null) {
        try {
          localStorage.setItem(k, JSON.stringify(v));
          anyRemote = true;
        } catch (e) {}
      }
    });
    synced = true;
    remoteOk = anyRemote;
    notify();
    return anyRemote;
  }

  function hasPending() {
    return getPending().length > 0;
  }

  window.BibleStudySync = {
    getRemote,
    putRemote,
    putRemoteMerged,
    schedulePush,
    pullAll,
    flushPending,
    onStatus,
    hasPending,
    stripDeleted,
    saveWithTombstones,
    isSynced: () => synced,
    isRemoteOk: () => remoteOk,
  };
})();
