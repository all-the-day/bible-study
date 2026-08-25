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

  function getRemote(localKey, timeoutMs = 5000) {
    if (OFFLINE) return Promise.resolve(null);
    if (isPending(localKey)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      http("/api/kv/" + encodeURIComponent(remoteKey(localKey)), "GET")
        .then((data) => {
          clearTimeout(timer);
          resolve(data.value !== undefined ? data.value : null);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });
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

  /** 启动时重试所有 pending 的本地改动 */
  async function flushPending(getterByKey) {
    for (const localKey of getPending()) {
      const value = getterByKey(localKey);
      if (value !== undefined) await putRemote(localKey, value);
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
