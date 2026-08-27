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
  function markPending(localKey) {
    const list = getPending();
    if (!list.includes(localKey)) list.push(localKey);
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

  /* 合并「服务器当前值」与「本地待推值」：数组按 id 并集（同 id 本机赢），对象按键浅合并（本机赢）。
     防止旧快照整体 PUT 覆盖其他设备推上去的新数据（last-write-wins 数据丢失） */
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

  /** 启动时重试所有 pending 的本地改动（推送前先拉取服务器当前值合并，防止旧快照覆盖新数据） */
  async function flushPending(getterByKey) {
    for (const localKey of getPending()) {
      const local = getterByKey(localKey);
      if (local === undefined) continue;
      const remote = await fetchRemote(localKey);
      if (remote === undefined) continue; // 拉不到服务器当前值就本轮不推，保留 pending 下轮再试
      const merged = mergeRemoteLocal(remote, local);
      const ok = await putRemote(localKey, merged);
      if (ok) {
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
      if (v !== null) {
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
    pullAll,
    flushPending,
    onStatus,
    hasPending,
    isSynced: () => synced,
    isRemoteOk: () => remoteOk,
  };
})();
