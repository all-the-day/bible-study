'use strict';

/* ============ 配置：5 色语义（沿用 bible-reader） ============ */
const COLORS = [
  { id: 'c1', name: '黄', hex: '#FFEB3B', desc: '重要的句子' },
  { id: 'c2', name: '绿', hex: '#4CAF50', desc: '「耶和华我的神」等' },
  { id: 'c3', name: '紫', hex: '#9C27B0', desc: '「我是耶和华」' },
  { id: 'c4', name: '蓝', hex: '#2196F3', desc: '神所喜愛、讚賞的' },
  { id: 'c5', name: '红', hex: '#F44336', desc: '神所恨惡、審判、禁止的' },
];

/* ============ 状态 ============ */
const LS_ANNOTATIONS = 'bible-study.annotations';
const LS_CHAPTER_NOTES = 'bible-study.chapterNotes';
const LS_LAST = 'bible-study.last';
const LS_HIDE_MARKS = 'bible-study.hideMarks';
const LS_NAV_COLLAPSED = 'bible-study.navCollapsed';
const LS_VIEW_MODE = 'bible-study.viewMode';
const LS_STUDY_WIDTH = 'bible-study.studyWidth';
const LS_LR_MAP = 'bible-study.lrMap';
const LS_ACCOUNT = 'bible-study.account';
const LS_LR_LAST = 'bible-study.lrLast';    // {book, articleId} 生命读经阅读器上次位置
const LS_LR_NOTES = 'bible-study.lrNotes';  // {"bookIndex:articleId": text} 篇级笔记
const LS_BOOK_LAST = 'bible-study.bookLast';   // {volume, book, chapter} 书报阅读器上次位置
const LS_BOOK_NOTES = 'bible-study.bookNotes'; // {"volume:book:chapter": text} 章级笔记
const LS_MORNING_LAST = 'bible-study.morningLast';   // {period, chapterId} 晨兴阅读器上次位置
const LS_MORNING_NOTES = 'bible-study.morningNotes'; // {"period:chapterId": text}
const LS_NOTES_PREFS = 'bible-study.notesPrefs';     // {source, color, sort} 笔记管理模块偏好

// 反馈提交地址（bible-kv 服务器，Caddy /bible-api/ 反代）
const FEEDBACK_API = 'https://duoban.xyz/bible-api';

const state = {
  books: [],            // [{index, name, acronym, chapters}]
  bookIndexByIdx: {},   // acronym+index -> book
  currentBook: null,
  currentChapter: null,
  bibleText: null,      // {key: markedText}
  bibleNotes: null,     // {key: {seq: note}}
  bibleXrefs: null,     // {key: {letter: rawString}}
  outlines: null,       // {key: {theme: [{level,text}], items: [{level,text,section,flag}]}}
  lifereading: null,    // {articles: [...]} 当前书卷
  lrMap: load(LS_LR_MAP, {}),  // {key: [articleId]} 手动指定某章的生命读经篇目（覆盖自动匹配）
  annotations: load(LS_ANNOTATIONS, []),
  chapterNotes: load(LS_CHAPTER_NOTES, {}),
  hideMarks: load(LS_HIDE_MARKS, false),
  navCollapsed: load(LS_NAV_COLLAPSED, false),
  viewMode: load(LS_VIEW_MODE, 'default'),
  studyWidth: load(LS_STUDY_WIDTH, 480),
  studyFull: false,
  activeTab: 'notes',
  account: load(LS_ACCOUNT, null),  // {uid, token}；null = 未启用云同步（纯本地）
  // 首页 + 合集（2026-08 阶段 1）：screen 是唯一视图正交开关
  screen: 'home',        // 'home' | 'work' —— 首页全屏层 / 工作区
  activeModule: 'bible', // 当前阅读器模块：'bible' | 'lifereading' | 'books' | 'morning' | 'notes'
  lrVolumes: {},         // { bookIndex: {name,acronym,articles} } 生命读经卷懒加载缓存
  lrBookIndex: null,     // 生命读经阅读器当前卷（null=未进入过）
  lrArticleId: null,     // 生命读经阅读器当前篇
  lrSideTab: 'outline',  // 生命读经右栏 tab：'outline' | 'notes'
  lrNotes: load(LS_LR_NOTES, {}),
  // 书报阅读器（倪柝声文集等，多系列）
  bookMeta: null,        // data/books/{series}.json 元数据（懒加载）
  bookVolumes: {},       // {series: {volume: {volume, books}}} 按系列+辑内容缓存（懒加载）
  bookSeriesIndex: null, // data/books/index.json 系列清单（懒加载）
  bookSeries: 'ni',      // 当前系列（左栏系列条切换）
  bookVolume: null,      // 当前辑（1-3）
  bookBook: null,        // 当前书（辑内序号 0 基）
  bookChapter: null,     // 当前章（书内序号 0 基）
  bookSideTab: 'toc',    // 书报右栏 tab：'toc' | 'notes'
  bookNotes: load(LS_BOOK_NOTES, {}),
  // 晨兴阅读器
  morningIndex: null,        // data/morning/index.json（懒加载）
  morningData: {},           // {periodId: {title, chapters}} 期内容缓存（懒加载）
  morningPeriod: null,       // 当前期（如 '2026-04'）
  morningChapterId: null,    // 当前篇（篇 number，1 基）
  morningNotes: load(LS_MORNING_NOTES, {}),
  // 笔记管理模块（三列：分类树 / 条目列表 / 编辑面板）
  notesPrefs: load(LS_NOTES_PREFS, {}),  // 持久化：{source, color, sort}
  notesSource: 'all',    // 来源过滤：'all' | 'verse' | 'lr' | 'book' | 'morning'
  notesColor: 'all',     // 颜色过滤：'all' | c1..c5
  notesSort: 'book',     // 排序：'book' 书卷序 | 'time' createdAt 倒序
  notesQuery: '',        // 搜索关键词（匹配划文本/笔记文字/大段笔记内容）
  notesSelectMode: false,
  notesSelected: new Set(),   // 多选模式选中的标注 id
  notesCollapsed: new Set(),  // 分类树折叠节点
  lrArtFilter: '',       // 生命读经左栏篇目搜索（空=当前卷列表，非空=全卷检索）
  bkBookFilter: '',      // 书报左栏书/章搜索（空=当前辑列表，非空=全辑检索）
  mrFilter: '',          // 听抄左栏篇搜索（空=当前期列表，非空=全期检索）
  lrTitleIndex: null,    // 生命读经全卷篇目标题索引缓存（data/lr-titles.json）
  notesGroup: null,           // 左栏树选中的叶子分组（过滤主区）
  notesSelectedItem: null,    // 右栏编辑目标：{kind:'ann',id} | {kind:'note',dict,key}
};

/* 合集注册表（数据驱动）：首页块列表，点击 = 直接进入对应阅读器模块。
   晨兴/书报数据导出后各加一行即可上块，UI 零改动 */
const COLLECTIONS = [
  { id: 'bible', title: '读经', icon: '📖', entry: () => enterModule('bible') },
  { id: 'lifereading', title: '生命读经', icon: '📗', entry: () => enterModule('lifereading') },
  { id: 'notes', title: '我的笔记', icon: '📝', entry: () => enterModule('notes') },
  { id: 'morning', title: '听抄', icon: '🌅', entry: () => enterModule('morning') },
  { id: 'books', title: '书报', icon: '📚', entry: () => enterModule('books') },
];

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
// 云同步客户端（sync.js 加载失败时静默降级为纯本地）
const Sync = window.BibleStudySync || null;
// 运行时门控：未启用同步（无 account）时即使 sync.js 存在也不参与云同步
function syncActive() { return !!(Sync && state.account); }
const SYNC_KEYS = [LS_ANNOTATIONS, LS_CHAPTER_NOTES, LS_LR_NOTES, LS_BOOK_NOTES, LS_MORNING_NOTES];

function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  if (syncActive() && SYNC_KEYS.includes(key)) {
    // 防抖推送（sync.js schedulePush）：合并 800ms 内的连续写为一次推送；
    // 推送前先拉服务器当前值合并（防旧快照覆盖其他设备），落笔即标 pending（防抖窗口内关页面不丢数据）
    Sync.schedulePush(key);
  }
}

// 启动时后台同步：服务器为主，成功后覆盖本地；再重试离线未推送的改动（先合并服务器当前值再推）
async function syncFromRemote() {
  if (!syncActive()) return;
  await Sync.pullAll(SYNC_KEYS);
  // flushPending 推送前会拉取服务器当前值合并（防旧快照覆盖新数据），成功后把合并结果写回 localStorage，
  // 因此状态重载必须放在 flush 之后，UI 与后续 save 才基于合并结果
  await Sync.flushPending((key) => {
    if (key === LS_ANNOTATIONS) return state.annotations;
    if (key === LS_CHAPTER_NOTES) return state.chapterNotes;
    if (key === LS_LR_NOTES) return state.lrNotes;
    if (key === LS_BOOK_NOTES) return state.bookNotes;
    if (key === LS_MORNING_NOTES) return state.morningNotes;
    return undefined;
  });
  state.annotations = load(LS_ANNOTATIONS, []);
  state.chapterNotes = load(LS_CHAPTER_NOTES, {});
  state.lrNotes = load(LS_LR_NOTES, {});
  state.bookNotes = load(LS_BOOK_NOTES, {});
  state.morningNotes = load(LS_MORNING_NOTES, {});
  renderChapter();
  renderStudy();
}

// 同步状态文案（设置弹窗「同步状态」行 + 冷启动 toast 共用）
function syncStatusInfo() {
  if (!syncActive()) return { text: '未启用云同步', cls: 'off' };
  if (Sync.hasPending()) return { text: '有改动待同步', cls: 'pending' };
  if (Sync.isRemoteOk()) return { text: '已同步到云端', cls: 'on' };
  return { text: '离线，改动保存在本地', cls: 'offline' };
}

function updateSyncStatus() {
  const el = $('setSyncStatusVal');
  if (!el) return;
  const info = syncStatusInfo();
  el.textContent = info.text;
  el.className = `settings-value sync-val ${info.cls}`;
}

// 冷启动同步状态提示（sessionStorage 控制：每个新会话只弹一次；未启用云同步不打扰）
function showStartupSyncToast() {
  if (typeof sessionStorage === 'undefined' || sessionStorage.getItem('bible-study.syncToastShown')) return;
  sessionStorage.setItem('bible-study.syncToastShown', '1');
  if (!syncActive()) return;
  const info = syncStatusInfo();
  showToast(info.text, info.cls);
}

/* ============ 设置菜单 ============ */
let _manifestVersion = null;

function loadAppVersion() {
  if (_manifestVersion !== null) return Promise.resolve(_manifestVersion);
  return fetchJSON('manifest.json')
    .then(m => { _manifestVersion = m.version || '1.0.0'; return _manifestVersion; })
    .catch(() => { _manifestVersion = '1.0.0'; return _manifestVersion; });
}

function openSettingsModal() {
  const enabled = syncActive();
  const uid = state.account ? state.account.uid : '';
  openPopup('设置', `
    <div class="settings-wrap">
      <div class="settings-card">
        <div class="settings-group">同步</div>
        <div class="settings-row" id="setSync">
          <span class="settings-label">云同步</span>
          <span class="settings-badge ${enabled ? 'on' : 'off'}">${enabled ? `已启用 ${escapeHtml(uid)}` : '未启用'}</span>
        </div>
        <div class="settings-row" id="setSyncStatus">
          <span class="settings-label">同步状态</span>
          <span class="settings-value sync-val" id="setSyncStatusVal">…</span>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-group">阅读</div>
        <div class="settings-row" id="setHideMarks">
          <span class="settings-label">隐藏注号</span>
          <span class="switch${state.hideMarks ? ' on' : ''}"></span>
        </div>
        <div class="settings-row" id="setViewMode">
          <span class="settings-label">视图模式</span>
          <span class="settings-value">${VIEW_MODE_LABELS[state.viewMode] || '双页'}</span>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-group">其他</div>
        <div class="settings-row" id="setUpdate">
          <span class="settings-label">检查更新</span>
          <span class="settings-value" id="setUpdateVal">${_updateInfo ? (_updateInfo.hasUpdate ? `新版本 v${_updateInfo.latest.version}` : '已是最新') : '检查更新'}</span>
        </div>
        <div class="settings-row" id="setFeedback">
          <span class="settings-label">反馈</span>
          <span class="settings-arrow">›</span>
        </div>
      </div>
      <div class="settings-footer" id="setAbout">读经 v${_manifestVersion !== null ? _manifestVersion : '…'}</div>
    </div>
  `);
  // 行点击走 document 委托（onSettingsRow），弹窗栈返回恢复 innerHTML 后监听不丢失
  updateSyncStatus();   // 填充「同步状态」行（Sync.onStatus 已绑定实时更新）
  loadAppVersion().then(v => {
    const el = $('setAbout');
    if (el) el.textContent = `读经 v${v}`;
  });
}

// 设置行点击（事件委托：doc 级监听，兼容弹窗栈返回后的 innerHTML 恢复）
function onSettingsRow(e) {
  const row = e.target.closest('.settings-row');
  if (!row) return;
  const id = row.id;
  if (id === 'setSync') {
    openSyncModal();
  } else if (id === 'setHideMarks') {
    state.hideMarks = !state.hideMarks;
    applyHideMarks();
    save(LS_HIDE_MARKS, state.hideMarks);
    const sw = row.querySelector('.switch');
    if (sw) sw.classList.toggle('on', state.hideMarks);
  } else if (id === 'setViewMode') {
    state.studyFull = false;
    const order = ['default', 'stacked', 'full'];
    const i = order.indexOf(state.viewMode);
    state.viewMode = order[(i + 1) % order.length];
    applyLayout();
    save(LS_VIEW_MODE, state.viewMode);
    const v = row.querySelector('.settings-value');
    if (v) v.textContent = VIEW_MODE_LABELS[state.viewMode] || '双页';
  } else if (id === 'setFeedback') {
    openFeedbackModal();
  } else if (id === 'setUpdate') {
    openUpdateModal();
  }
}

/* ============ 云同步设置 ============ */
function openSyncModal() {
  const enabled = syncActive();
  const uid = state.account ? state.account.uid : '';
  openPopup('云同步', `
    <div class="fb-hint">标注与笔记跨设备同步。未启用时本设备完全本地保存。</div>
    <div class="sync-row"><span>状态</span><b class="${enabled ? 'sync-st-on' : 'sync-st-off'}">${enabled ? `已启用（${escapeHtml(uid)}）` : '未启用（纯本地）'}</b></div>
    ${enabled ? `
    <div class="fb-actions">
      <span id="fbMsg" class="fb-msg"></span>
      <button class="popup-btn" id="syncDisable">停用同步</button>
    </div>`
    : `
    <div class="fb-hint">输入授权码启用本设备同步（向管理员申请）。</div>
    <input id="syncCode" class="fb-input" placeholder="8 位授权码" autocomplete="off" spellcheck="false">
    <div class="fb-actions">
      <span id="fbMsg" class="fb-msg"></span>
      <button class="popup-btn primary" id="syncEnable">启用同步</button>
    </div>`}
  `);
  const en = $('syncEnable');
  if (en) en.addEventListener('click', claimAndEnable);
  const dis = $('syncDisable');
  if (dis) dis.addEventListener('click', () => {
    state.account = null;
    localStorage.removeItem(LS_ACCOUNT);
    closePopupAll();
    updateSyncStatus();
  });
}

// 授权码兑换（RFC 8628 简化版）：POST /api/account/claim → {uid, token}
async function claimAndEnable() {
  const btn = $('syncEnable');
  const msg = $('fbMsg');
  const code = ($('syncCode').value || '').trim().toUpperCase();
  if (!code) { msg.textContent = '请输入授权码'; return; }
  btn.disabled = true;
  msg.textContent = '验证中…';
  try {
    const res = await fetch(`${FEEDBACK_API}/api/account/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = data && data.error;
      msg.textContent = err === 'used_code' ? '授权码已被使用'
        : err === 'expired_code' ? '授权码已过期，请向管理员申请新码'
        : err === 'rate_limited' ? '尝试太频繁，请稍后再试'
        : err === 'invalid_code' ? '授权码无效'
        : '启用失败，请稍后再试';
      btn.disabled = false;
      return;
    }
    const data = await res.json();
    state.account = { uid: data.account.uid, token: data.device.token };
    save(LS_ACCOUNT, state.account);
    closePopupAll();
    updateSyncStatus();
    syncFromRemote();  // 启用后立即拉取云端数据
  } catch {
    msg.textContent = '网络错误，请稍后再试';
    btn.disabled = false;
  }
}

function applyHideMarks() {
  document.body.classList.toggle('hide-marks', state.hideMarks);
  const label = state.hideMarks ? '显示注号' : '隐藏注号';
  $('hideMarksBtn').textContent = label;
  $('hideMarksBtn').classList.toggle('active', state.hideMarks);
}

const VIEW_MODE_LABELS = { default: '双页', stacked: '上下', full: '全屏' };

function applyLayout() {
  const layout = document.querySelector('.layout');
  layout.classList.toggle('nav-collapsed', state.navCollapsed);
  layout.classList.toggle('view-stacked', state.viewMode === 'stacked');
  layout.classList.toggle('view-full', state.viewMode === 'full');
  layout.classList.toggle('study-full', state.studyFull);
  layout.style.setProperty('--study-w', state.studyWidth + 'px');
  $('viewModeBtn').textContent = VIEW_MODE_LABELS[state.viewMode] || '双页';
  $('viewModeBtn').classList.toggle('active', state.viewMode !== 'default');
  $('studyFullBtn').classList.toggle('active', state.studyFull);
}

function bindResize() {
  const handle = $('resizeHandle');
  // 同时支持鼠标与触摸（APK WebView 只有 pointer 事件）
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.studyWidth;
    handle.classList.add('dragging');
    const onMove = (ev) => {
      const newW = Math.min(720, Math.max(260, startW + (startX - ev.clientX)));
      state.studyWidth = newW;
      document.querySelector('.layout').style.setProperty('--study-w', newW + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      save(LS_STUDY_WIDTH, state.studyWidth);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

/* 维护 --app-h：用真实 WebView 高度（visualViewport 优先），
   随键盘弹出 / 窗口缩放 / 旋转实时更新，替代不响应的 100vh */
function syncAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}
function bindViewport() {
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight);
  window.addEventListener('orientationchange', syncAppHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppHeight);
    window.visualViewport.addEventListener('scroll', syncAppHeight);
  }
}

const $ = (id) => document.getElementById(id);

/* ============ 数据加载 ============ */
async function fetchJSON(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`加载失败 ${url}: ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// 首屏 splash 控制：静态 HTML 已含兜底经节，JS 拉到 verses.json 后替换随机节，首页就绪后隐藏
function splashSetVerse(v) {
  const el = $('splashVerse'), ref = $('splashVerseRef');
  if (el && v && v.text) el.textContent = v.text;
  if (ref && v && v.ref) ref.textContent = v.ref;
}
function splashHide() {
  const s = $('splash');
  if (s) s.classList.add('hidden');
}

// 启动关键数据（books.json）加载失败：splash 上显示错误提示 + 重试按钮
function splashShowError(retryFn) {
  const s = $('splash');
  if (!s) return;
  const spin = s.querySelector('.splash-spinner');
  if (spin) spin.remove();
  let err = s.querySelector('.splash-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'splash-error';
    s.appendChild(err);
  }
  err.innerHTML = '';
  const label = document.createElement('div');
  label.textContent = '数据加载失败，请检查网络后重试';
  const btn = document.createElement('button');
  btn.className = 'splash-retry-btn';
  btn.textContent = '重试';
  btn.addEventListener('click', retryFn);
  err.appendChild(label);
  err.appendChild(btn);
}

// 模块数据加载指示（ensure* 未缓存时占位；渲染完成后被内容替换）
function showLoadingHint(container, text) {
  if (!container) return;
  container.innerHTML = `<div class="loading-hint"><span class="loading-spin"></span>${escapeHtml(text)}</div>`;
}
function showLoadingError(container, msg, retryFn) {
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'loading-error';
  const label = document.createElement('span');
  label.textContent = (msg || '加载失败');
  const btn = document.createElement('button');
  btn.className = 'popup-btn primary';
  btn.textContent = '重试';
  btn.addEventListener('click', retryFn);
  div.appendChild(label);
  div.appendChild(btn);
  container.innerHTML = '';
  container.appendChild(div);
}

async function init() {
  // 首屏：splash 已由 HTML 静态显示（app.js 加载前即可见），这里并行拉取经节与书卷目录
  // 关键数据加载失败：splash 显示错误+重试（不静默挂死；重试整个 init——失败发生在任何绑定之前，可安全重入）
  let booksData, versesData;
  try {
    const versesP = fetchJSON('data/verses.json').catch(() => null);
    [booksData, versesData] = await Promise.all([
      fetchJSON('data/books.json'),
      versesP,
    ]);
  } catch (e) {
    splashShowError(() => init());
    return;
  }
  if (versesData && versesData.length) splashSetVerse(versesData[Math.floor(Math.random() * versesData.length)]);
  state.books = booksData;
  state.books.forEach(b => state.bookIndexByIdx[b.acronym + b.index] = b);
  state.books.forEach(b => { REF_ALIASES[b.acronym] = b.acronym; });
  _refAliasesSorted = Object.keys(REF_ALIASES).sort((a, b) => b.length - a.length);
  renderBookList();
  applyHideMarks();
  applyLayout();
  bindViewport();
  state.activeModule = 'bible';
  applyModuleBodyClass('bible');
  renderHome();
  showHome();   // 启动先进首页（body.home 隐藏工作区，合集块可点）
  splashHide(); // 首页可交互后隐藏 splash（同步 display:none，不挡测试点击）
  // 后台预渲染工作区：DOM 就绪，点合集块秒开（LS_LAST 保留用于「继续上次」）；
  // 经文首载失败不阻塞事件绑定（verseContainer 会显示加载失败+重试）
  try {
    const last = load(LS_LAST, null);
    if (last && state.books.some(b => b.index === last.book)) {
      await selectBook(last.book, last.chapter);
    } else {
      await selectBook(1, 1);
    }
  } catch (e) { /* 后台预渲染失败仅记录，不影响启动 */ }
  bindEvents();
  // 云同步：状态指示 + 后台拉取服务器数据
  if (Sync) Sync.onStatus(updateSyncStatus);
  updateSyncStatus();
  syncFromRemote();
  // 冷启动同步状态 toast（延迟等 pullAll 出结果）
  setTimeout(showStartupSyncToast, 2500);
}

/* ============ 首页 + 合集块 ============ */
// 渲染合集块网格（COLLECTIONS 注册表数据驱动；sub 为动态副标题）
function renderHome() {
  const grid = $('homeGrid');
  if (!grid) return;
  grid.innerHTML = COLLECTIONS.map(c => `
    <div class="home-block" data-entry="${c.id}" role="button" tabindex="0">
      <div class="home-block-icon">${c.icon}</div>
      <div class="home-block-title">${c.title}</div>
    </div>`).join('');
}

// 进首页：body.home 隐藏工作区（CSS 驱动），清掉研读 overlay 残留与弹窗
function showHome() {
  state.screen = 'home';
  document.body.classList.add('home');
  document.body.classList.remove('mobile-study');
  // 清除模块残留类：body-mod-* 会隐藏顶栏按钮（如 #feedbackBtn），不清会导致回首页后顶栏与首次进入不一致
  [...document.body.classList].filter(c => c.startsWith('body-mod-')).forEach(c => document.body.classList.remove(c));
  closePopupAll();
  const hb = $('homeBtn');
  if (hb) hb.classList.add('active');
  renderHome();
  const res = $('homeSearchResults');
  if (res) res.innerHTML = '';
}

// 进工作区：移除 body.home，.layout 恢复显示。幂等，任何工作区入口调用
function enterWork() {
  state.screen = 'work';
  document.body.classList.remove('home');
  // 恢复模块类（showHome 会清除，防止 body-mod-* 残留影响首页顶栏样式）
  applyModuleBodyClass(state.activeModule);
  const hb = $('homeBtn');
  if (hb) hb.classList.remove('active');
}

/* ============ 阅读器外壳 + 模块注册表 ============ */
/* 每个合集模块 = 一套三列阅读器配置。模块切换只发生在首页（⌂ → 点合集块 → enterModule）。 */
const READER_MODULES = {
  bible: {
    id: 'bible',
    title: '读经',
    enter() { setMobileView('read'); },
    renderNav() { renderBookList(); renderChapterList(); highlightNav(); },
    renderMain() { renderChapter(); },
    renderSide() { renderStudy(); },
    renderCrumb() {
      // 模块切换后显式写回读经位置（selectBook/selectChapter 也写，幂等）
      if (!state.currentBook) return;
      $('bookName').textContent = state.currentBook.name;
      $('chapterLabel').textContent = `${state.currentChapter}章`;
      renderChapterNav();
    },
    onMenu() { toggleNavCollapsed(); },
    onCrumbClick() { openChapterPicker(); },
  },
  lifereading: {
    id: 'lifereading',
    title: '生命读经',
    // 直接进上次篇目（LS_LR_LAST），无记录则第一卷第一篇；读经专属布局态归一化
    async enter(opts) {
      const last = load(LS_LR_LAST, null) || {};
      state.lrBookIndex = (opts && opts.bookIndex) || last.book || 1;
      state.lrArticleId = (opts && opts.articleId) || last.articleId || null;
      const vol = await ensureLrVolume(state.lrBookIndex);
      if (!vol) { showToast('该卷生命读经数据缺失'); return; }
      if (!vol.articles.some(a => a.id === state.lrArticleId)) state.lrArticleId = (vol.articles[0] || {}).id;
      state.studyFull = false;
      state.viewMode = 'default';
      applyLayout();
    },
    async renderNav() {
      const vol = await ensureLrVolume(state.lrBookIndex);
      await renderLrArticleList(state.lrBookIndex, vol);
    },
    async renderMain() {
      const vol = await ensureLrVolume(state.lrBookIndex);
      const art = vol && vol.articles.find(a => a.id === state.lrArticleId);
      if (!art) return;
      // 渲染前自愈该篇标注（坐标系 = 源 content 全文）
      const anns = state.annotations.filter(x => x.type === 'lr' && x.book === state.lrBookIndex && x.articleId === art.id);
      if (healAnnotations(anns, art.content || '')) save(LS_ANNOTATIONS, state.annotations);
      const main = $('lrMain');
      main.innerHTML = '';
      main.appendChild(renderLrArticle(art, state.lrBookIndex));
    },
    renderSide() { renderLrSide(); },
    renderCrumb() {
      const vol = state.lrVolumes[state.lrBookIndex];
      const art = vol && vol.articles.find(a => a.id === state.lrArticleId);
      $('bookName').textContent = (vol && vol.name) || '';
      $('chapterLabel').textContent = art ? `第${art.id}篇 ${art.title}` : '';
    },
    onMenu() { toggleNavCollapsed(); },
    onCrumbClick() { openLrArticleList(state.lrBookIndex); },
    // 切走前解绑 #textCol 滚动高亮监听（防读经模块残留无效 listener）
    onLeave() {
      if (_lrSpy) { $('textCol').removeEventListener('scroll', _lrSpy); _lrSpy = null; }
    },
  },
  books: {
    id: 'books',
    title: '书报',
    async enter(opts) {
      await ensureBookSeriesIndex();
      const last = load(LS_BOOK_LAST, null) || {};
      if (opts && opts.series) state.bookSeries = opts.series;
      else if (last.series) state.bookSeries = last.series;
      else state.bookSeries = (state.bookSeriesIndex.series[0] || {}).id || 'ni';
      state.bookVolume = (opts && opts.volume) || last.volume || 1;
      state.bookBook = (opts && opts.book) || last.book || 0;
      state.bookChapter = (opts && opts.chapter) || last.chapter || 0;
      await ensureBookMeta();
      const vol = await ensureBookVolume(state.bookVolume);
      if (!vol) { showToast('该辑数据缺失'); return; }
      const metaVol = state.bookMeta && state.bookMeta.volumes[state.bookVolume - 1];
      if (metaVol && state.bookBook >= metaVol.books.length) { state.bookBook = 0; state.bookChapter = 0; }
      const book = vol.books[state.bookBook];
      if (book && state.bookChapter >= book.chapters.length) state.bookChapter = 0;
      state.studyFull = false;
      state.viewMode = 'default';
      applyLayout();
    },
    async renderNav() {
      await ensureBookMeta();
      renderBookNavBooks();
    },
    async renderMain() { await renderBookMain(); },
    renderSide() { renderBookSide(); },
    renderCrumb() {
      const metaVol = state.bookMeta && state.bookMeta.volumes[state.bookVolume - 1];
      const book = metaVol && metaVol.books[state.bookBook];
      $('bookName').textContent = (state.bookMeta && state.bookMeta.name) || '书报';
      $('chapterLabel').textContent = book ? `${book.title} · 第${state.bookChapter + 1}章` : '';
    },
    onMenu() { toggleNavCollapsed(); },
    onCrumbClick() { openBookPicker(); },
  },
  morning: {
    id: 'morning',
    title: '听抄',
    async enter(opts) {
      await ensureMorningIndex();
      const last = load(LS_MORNING_LAST, null) || {};
      state.morningPeriod = (opts && opts.period) || last.period || (state.morningIndex.trainings[0] || {}).id || '';
      state.morningChapterId = (opts && opts.chapterId) || last.chapterId || 1;
      const data = await ensureMorningData(state.morningPeriod);
      if (!data) { showToast('该期数据缺失'); return; }
      if (!data.chapters.some(c => c.number === state.morningChapterId)) state.morningChapterId = (data.chapters[0] || {}).number || 1;
      state.studyFull = false;
      state.viewMode = 'default';
      applyLayout();
    },
    async renderNav() {
      await ensureMorningData(state.morningPeriod);
      await renderMorningChapterList();
    },
    renderMain() { renderMorningMain(); },
    renderSide() { renderMorningSide(); },
    renderCrumb() {
      const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === state.morningPeriod);
      const data = state.morningData[state.morningPeriod];
      const ch = data && data.chapters.find(c => c.number === state.morningChapterId);
      $('bookName').textContent = (t && (t.title || t.season)) || '听抄';
      $('chapterLabel').textContent = ch ? `第${ch.number}篇 ${ch.title}` : '';
    },
    onMenu() { toggleNavCollapsed(); },
    onCrumbClick() { openMorningArticleList(); },
  },
  notes: {
    id: 'notes',
    title: '笔记管理',
    // 偏好初始化 + 重置会话态；不切移动端单视图（模块正文直接显示在 text-col）
    async enter() {
      const p = state.notesPrefs || {};
      state.notesSource = p.source || 'all';
      state.notesColor = p.color || 'all';
      state.notesSort = p.sort || 'book';
      state.notesQuery = '';
      state.notesSelectMode = false;
      state.notesSelected = new Set();
      state.notesGroup = null;
      state.notesSelectedItem = null;
      state.studyFull = false;
      state.viewMode = 'default';
      applyLayout();
      // 定位文案依赖书报元数据与听抄期索引（懒加载兜底）
      await ensureBookSeriesIndex();
      if (state.bookSeries) await ensureBookMeta();
      await ensureMorningIndex();
    },
    renderNav() { renderNotesTree(); },
    renderMain() { renderNotesList(); },
    renderSide() { renderNotesPanel(); },
    renderCrumb() {
      $('bookName').textContent = '笔记管理';
      $('chapterLabel').textContent = '';
    },
    onMenu() { toggleNavCollapsed(); },
    onCrumbClick() {},
  },
};

// body-mod-{id} 类控制三列容器归属（bible 容器默认显示，其他模块容器由 CSS 切换）
function applyModuleBodyClass(id) {
  document.body.classList.remove('body-mod-bible', 'body-mod-lifereading', 'body-mod-books', 'body-mod-morning', 'body-mod-notes');
  if (id) document.body.classList.add('body-mod-' + id);
}

// 进入模块阅读器：状态初始化 + 三列渲染 + crumb（同模块再进入幂等，不重渲染）
async function enterModule(id, opts) {
  const mod = READER_MODULES[id];
  if (!mod) return;
  const firstEnter = state.activeModule !== id;
  if (firstEnter && state.activeModule && READER_MODULES[state.activeModule].onLeave) {
    READER_MODULES[state.activeModule].onLeave();
  }
  state.activeModule = id;
  applyModuleBodyClass(id);
  enterWork();
  if (firstEnter) {
    await mod.enter(opts);
    await Promise.all([mod.renderNav(), mod.renderMain(), mod.renderSide(), mod.renderCrumb()]);
  }
}

// 桌面 ☰ 折叠左栏（读经/生命读经共用）
function toggleNavCollapsed() {
  state.navCollapsed = !state.navCollapsed;
  applyLayout();
  save(LS_NAV_COLLAPSED, state.navCollapsed);
}

// 首页合集块点击委托 + 顶部搜索
// 阅读进度条（反馈 #10，晨读 app 同款）：绑定工作区唯一滚动容器 #textCol，
// 滚动时更新顶条宽度指示当前阅读进度；纯 UI 实时计算，不存储
function bindReadingProgress() {
  const bar = $('readingProgress');
  const scroller = $('textCol');
  if (!bar || !scroller) return;
  const update = () => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    bar.style.width = (max > 0 ? Math.min(100, (scroller.scrollTop / max) * 100) : 0) + '%';
  };
  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// 首页合集块点击委托 + 顶部搜索
function bindHomeEvents() {
  $('homeGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.home-block');
    if (!tile) return;
    const c = COLLECTIONS.find(x => x.id === tile.dataset.entry);
    if (c && c.entry) c.entry();
  });
  $('homeBtn').addEventListener('click', showHome);
  const input = $('homeSearch');
  const results = $('homeSearchResults');
  let timer = null;
  const render = () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    results.innerHTML = homeSearch(q).map(r => `
      <div class="home-sr-item" data-k="${r.key}">
        <span class="sr-loc">${escapeHtml(r.loc)}</span>${escapeHtml(r.text)}
      </div>`).join('');
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = results.querySelector('.home-sr-item'); if (first) first.click(); }
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.home-sr-item');
    if (!item) return;
    const r = homeSearch(input.value.trim()).find(x => x.key === item.dataset.k);
    if (r) { r.go(); results.innerHTML = ''; }
  });
}

// 顶部搜索（轻量三条过滤；不做全文搜索）
function homeSearch(q) {
  const out = [];
  // 1. 书卷 + 章（如 创24 / 创世记24）→ 进工作区选章
  const m = q.match(/^([\u4e00-\u9fa5]{1,5})(\d+)$/);
  if (m) {
    const idx = resolveBookAlias(m[1]);
    if (idx) {
      const b = state.books.find(x => x.index === idx);
      out.push({
        key: 'bible-' + idx + '-' + m[2], loc: `${b.name} ${m[2]}章`, text: '读经',
        go: () => { enterModule('bible'); selectBook(idx, parseInt(m[2], 10)); setMobileView('read'); },
      });
    }
  }
  // 2. 笔记文本（note / 选中文本快照）
  state.annotations.filter(a => (a.note || '').includes(q) || (a.text || '').includes(q)).slice(0, 20).forEach(a => {
    out.push({
      key: 'ann-' + a.id,
      loc: a.type === 'verse' ? `${bookName(a.book)} ${a.chapter}:${a.verse}` : `${bookName(a.book)} 生命读经`,
      text: (a.note || a.text || '').slice(0, 30),
      go: () => { enterModule('bible'); navigateToAnnotation(a); },
    });
  });
  // 3. 生命读经篇目标题（仅已缓存卷，阶段 1 不建全量索引）
  Object.values(state.lrVolumes).forEach(v => {
    (v.articles || []).forEach(art => {
      if (art.title.includes(q)) {
        out.push({
          key: 'lr-' + v.bookIndex + '-' + art.id,
          loc: `${v.name} · 生命读经`, text: art.title,
          go: () => openLrArticle(v.bookIndex, art),
        });
      }
    });
  });
  // 4. 书报章节标题（仅 bookMeta 已加载，按辑内容再懒加载）
  if (state.bookMeta) {
    state.bookMeta.volumes.forEach((v, vi) => {
      v.books.forEach((b, bi) => {
        (b.chapters || []).forEach((ct, ci) => {
          if (String(ct).includes(q)) {
            out.push({
              key: 'bk-' + vi + '-' + bi + '-' + ci,
              loc: `${state.bookMeta.name} · ${v.title} · ${b.title}`, text: String(ct),
              go: () => openBookChapter(vi + 1, bi, ci, state.bookSeries),
            });
          }
        });
      });
    });
  }
  // 5. 晨兴篇标题（仅已加载期）
  Object.keys(state.morningData).forEach(pid => {
    const data = state.morningData[pid];
    (data.chapters || []).forEach(ch => {
      if (ch.title.includes(q)) {
        out.push({
          key: 'mr-' + pid + '-' + ch.number,
          loc: `${(data.title || pid)} · 听抄`, text: ch.title,
          go: () => openMorningArticle(pid, ch.number),
        });
      }
    });
  });
  return out.slice(0, 25);
}

// 书卷名/缩写 → book index（复用 REF_ALIASES 全名/简称/缩写映射）
function resolveBookAlias(name) {
  for (const alias of _refAliasesSorted) {
    if (name.startsWith(alias)) {
      const acr = REF_ALIASES[alias];
      const b = state.books.find(x => x.acronym === acr);
      if (b) return b.index;
    }
  }
  return null;
}

function bookName(index) {
  const b = state.books.find(x => x.index === index);
  return b ? b.name : `第${index}卷`;
}

/* ============ 导航 ============ */
function renderBookList() {
  const list = $('bookList');
  list.innerHTML = '';
  let currentGroup = '';
  for (const b of state.books) {
    const group = b.index <= 39 ? '旧约' : '新约';
    if (group !== currentGroup) {
      const g = document.createElement('div');
      g.className = 'group-label';
      g.textContent = group;
      list.appendChild(g);
      currentGroup = group;
    }
    const item = document.createElement('div');
    item.className = 'book-item';
    item.textContent = b.name;
    item.dataset.index = b.index;
    item.addEventListener('click', () => selectBook(b.index, 1));
    list.appendChild(item);
  }
}

function renderChapterList() {
  const list = $('chapterList');
  list.innerHTML = '';
  if (!state.currentBook) return;
  for (let i = 1; i <= state.currentBook.chapters; i++) {
    const item = document.createElement('div');
    item.className = 'ch-item';
    item.textContent = i;
    item.dataset.chapter = i;
    item.addEventListener('click', () => selectChapter(i));
    list.appendChild(item);
  }
}

function highlightNav() {
  document.querySelectorAll('#bookList .book-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.index === state.currentBook.index);
  });
  document.querySelectorAll('#chapterList .ch-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.chapter === state.currentChapter);
  });
}

// 上一章/下一章（顶栏 crumb 两侧，同卷内翻页，到卷首/卷尾禁用，不跨卷）
function renderChapterNav() {
  const ch = state.currentChapter;
  const total = state.currentBook.chapters;
  const prev = $('prevChBtn');
  const next = $('nextChBtn');
  prev.disabled = ch <= 1;
  prev.onclick = () => { if (ch > 1) selectChapter(ch - 1); };
  next.disabled = ch >= total;
  next.onclick = () => { if (ch < total) selectChapter(ch + 1); };
}

async function selectBook(index, chapter) {
  state.currentBook = state.books.find(b => b.index === index);
  state.currentChapter = chapter;
  state.lifereading = null; // 重新加载新书卷生命读经
  renderChapterList();
  highlightNav();
  $('bookName').textContent = state.currentBook.name;
  $('chapterLabel').textContent = `${chapter}章`;
  save(LS_LAST, { book: index, chapter });
  await ensureBibleData();
  await selectChapter(chapter);
}

async function selectChapter(chapter) {
  state.currentChapter = chapter;
  $('chapterLabel').textContent = `${chapter}章`;
  highlightNav();
  renderChapter();
  renderChapterNav();
  renderStudy();
  updateMobileNav();
  save(LS_LAST, { book: state.currentBook.index, chapter });
  // 生命读经懒加载（结果同时缓存到 lrVolumes，供首页篇目列表/全局笔记复用）
  if (!state.lifereading) {
    const acr = state.currentBook.acronym;
    try {
      state.lifereading = await fetchJSON(`data/lifereading/${acr}.json`);
    } catch (e) { state.lifereading = { articles: [] }; }
    state.lifereading.bookIndex = state.currentBook.index;
    state.lifereading.name = state.currentBook.name;
    state.lrVolumes[state.currentBook.index] = state.lifereading;
    if (state.currentChapter === chapter) renderStudy();
  }
}

async function ensureBibleData() {
  if (state.bibleText) return;
  showLoadingHint($('verseContainer'), '经文加载中…');
  try {
    const [text, notes, xrefs, outlines] = await Promise.all([
      fetchJSON('data/bible-text.json'),
      fetchJSON('data/bible-notes.json'),
      fetchJSON('data/bible-xrefs.json'),
      fetchJSON('data/bible-outlines.json'),
    ]);
    state.bibleText = text;
    state.bibleNotes = notes;
    state.bibleXrefs = xrefs;
    state.outlines = outlines;
  } catch (e) {
    // 失败显示重试（不抛异常：init 后台预渲染失败不应中断事件绑定）；重试走完整 selectBook 链路
    showLoadingError($('verseContainer'), '经文加载失败',
      () => selectBook(state.currentBook.index, state.currentChapter));
  }
}

/* ============ 原文渲染 ============ */
function parseMarkedText(marked) {
  // '{1}[a]起初{2}神' → segments + plain
  const segments = [];
  let plain = '';
  const re = /\{(\d+)\}|\[([a-z]+)\]/g;
  let last = 0, m;
  while ((m = re.exec(marked)) !== null) {
    const text = marked.slice(last, m.index);
    if (text) { segments.push({ type: 'text', text }); plain += text; }
    if (m[1] !== undefined) segments.push({ type: 'fn', n: m[1] });
    else segments.push({ type: 'xref', letter: m[2] });
    last = re.lastIndex;
  }
  const tail = marked.slice(last);
  if (tail) { segments.push({ type: 'text', text: tail }); plain += tail; }
  return { segments, plain };
}

function colorBg(id) {
  const c = COLORS.find(x => x.id === id);
  if (!c) return 'rgba(255,235,59,.4)';
  return `rgba(${parseInt(c.hex.slice(1,3),16)},${parseInt(c.hex.slice(3,5),16)},${parseInt(c.hex.slice(5,7),16)},.4)`;
}

// 浅色背景（用于划线汇总条目整行底色，alpha 默认 8% 让文字仍是深色）
function colorBgSoft(id, alpha) {
  const a = (alpha === undefined) ? .08 : alpha;
  const c = COLORS.find(x => x.id === id);
  if (!c) return `rgba(255,235,59,${a})`;
  return `rgba(${parseInt(c.hex.slice(1,3),16)},${parseInt(c.hex.slice(3,5),16)},${parseInt(c.hex.slice(5,7),16)},${a})`;
}

/* 重渲染前保存、重渲染后恢复滚动位置，避免标注后页面/面板跳到顶部。
   传入 CSS 选择器（用 querySelector 查询，支持 #id 与 .class），重渲染后重新查询——
   因重渲染会新建 DOM 节点；恢复放在 requestAnimationFrame，确保新建节点已完成布局 */
function withScrollPreserved(selectors, fn) {
  const saved = selectors.map(s => { const el = document.querySelector(s); return el ? el.scrollTop : 0; });
  fn();
  requestAnimationFrame(() => {
    selectors.forEach((s, i) => { const el = document.querySelector(s); if (el) el.scrollTop = saved[i]; });
  });
}

function renderChapter() {
  if (!state.bibleText) return; // 数据未加载完成（syncFromRemote 与 ensureBibleData 竞态）
  const container = $('verseContainer');
  container.innerHTML = '';
  const acr = state.currentBook.acronym;
  const ch = state.currentChapter;
  const anns = state.annotations.filter(a => a.book === state.currentBook.index && a.chapter === ch && a.type === 'verse');
  // 纲目：章首 theme + 按 section/flag 锚点穿插到经文卡片之间
  const ol = (state.outlines || {})[`${acr}${ch}`] || { theme: [], items: [] };
  const appendOutline = (o) => {
    const div = document.createElement('div');
    div.className = `outline-item lv${Math.min(o.level, 6)}`;
    div.textContent = o.text;
    container.appendChild(div);
  };
  if (ol.theme && ol.theme.length) {
    const row = document.createElement('div');
    row.className = 'theme-row';
    row.textContent = ol.theme.map(t => t.text).join('　');
    container.appendChild(row);
  }
  const itemsByPos = {};
  for (const it of ol.items) {
    if (it.section === 0) { appendOutline(it); continue; } // 卷级标题（如诗篇「卷一」）放章首
    const pk = `${it.section}-${it.flag}`;
    (itemsByPos[pk] = itemsByPos[pk] || []).push(it);
  }
  // 经文卡片：连续经文聚合为卡片，纲目作为标题穿插在卡片之间（凸显纲目）
  let card = null;
  const ensureCard = () => {
    if (!card) { card = document.createElement('div'); card.className = 'scripture-card'; }
    return card;
  };
  const flushCard = () => { if (card) { container.appendChild(card); card = null; } };
  let healed = false;
  for (let v = 1; v <= 500; v++) {
    for (const half of ['', '上', '下']) {
      const flag = half === '' ? 0 : (half === '上' ? 1 : 2);
      const key = `${acr}${ch}:${v}${half}`;
      const marked = state.bibleText[key];
      if (marked === undefined) continue;
      for (const o of itemsByPos[`${v}-${flag}`] || []) { flushCard(); appendOutline(o); }
      const verseAnns = anns.filter(a => a.verse === v && a.half === half);
      if (healAnnotations(verseAnns, parseMarkedText(marked).plain)) healed = true;
      ensureCard().appendChild(renderVerse(v + half, marked, verseAnns));
    }
  }
  flushCard();
  // 自愈后偏移已修正，写回存储（含云同步）
  if (healed) save(LS_ANNOTATIONS, state.annotations);
}

function renderVerse(vn, marked, annotations) {
  const { segments, plain } = parseMarkedText(marked);
  const el = document.createElement('div');
  el.className = 'verse';
  const num = document.createElement('span');
  num.className = 'vnum';
  num.textContent = vn;
  el.appendChild(num);
  const vtext = document.createElement('span');
  vtext.className = 'vtext';
  vtext.dataset.verse = vn;
  vtext.dataset.plain = plain;
  let cursor = 0;
  for (const seg of segments) {
    if (seg.type === 'fn') {
      const sup = document.createElement('sup');
      sup.className = 'fn-ref';
      sup.textContent = seg.n;
      sup.dataset.fn = seg.n;
      vtext.appendChild(sup);
    } else if (seg.type === 'xref') {
      const sup = document.createElement('sup');
      sup.className = 'xref-ref';
      sup.textContent = seg.letter;
      sup.dataset.xref = seg.letter;
      vtext.appendChild(sup);
    } else {
      const start = cursor, end = cursor + seg.text.length;
      cursor = end;
      const overlapping = annotations.filter(a => a.start < end && a.end > start);
      if (overlapping.length === 0) {
        vtext.appendChild(document.createTextNode(seg.text));
      } else {
        renderTextWithMarks(vtext, seg.text, start, overlapping);
      }
    }
  }
  el.appendChild(vtext);
  return el;
}

function renderTextWithMarks(parent, text, baseOffset, annotations) {
  const points = new Set([0, text.length]);
  for (const a of annotations) {
    // 边界必须夹在 [0, text.length]：标注在本段之前结束时，end 偏移为负，
    // 会让 text.slice(负值) 从尾部截取错误片段并提前追加，导致段落乱序
    points.add(Math.max(Math.min(a.start - baseOffset, text.length), 0));
    points.add(Math.max(Math.min(a.end - baseOffset, text.length), 0));
  }
  const sorted = [...points].sort((x, y) => x - y);
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    if (s >= e) continue;
    const piece = text.slice(s, e);
    const covering = annotations.filter(a => a.start <= baseOffset + s && a.end >= baseOffset + e);
    if (covering.length === 0) {
      parent.appendChild(document.createTextNode(piece));
    } else {
      const sortedCov = [...covering].sort((a, b) => a.createdAt - b.createdAt);
      let node = document.createTextNode(piece);
      for (let j = sortedCov.length - 1; j >= 0; j--) {
        const mark = document.createElement('mark');
        const a = sortedCov[j];
        // 视觉：颜色→背景高亮；下划线→直线；纯笔记→透明+橙波浪线（晨读语义）
        if (a.underline) mark.className = 'ul';
        else if (a.colorId) { mark.className = a.colorId; mark.style.background = colorBg(a.colorId); }
        else mark.className = 'note';
        if (a.note) mark.classList.add('has-note');
        mark.dataset.annId = a.id;
        mark.appendChild(node);
        node = mark;
      }
      parent.appendChild(node);
    }
  }
}

/* ============ 研读列 ============ */
function renderStudy() {
  $('studyBody').innerHTML = '';
  if (state.activeTab === 'notes') renderFootnotes();
  else if (state.activeTab === 'lifereading') renderLifereading();
  else renderMyNotes();
}

function renderFootnotes() {
  const body = $('studyBody');
  const acr = state.currentBook.acronym, ch = state.currentChapter;
  const items = [];
  for (let v = 1; v < 200; v++) {
    for (const half of ['', '上', '下']) {
      const key = `${acr}${ch}:${v}${half}`;
      const notes = (state.bibleNotes || {})[key];
      if (notes) {
        Object.keys(notes).map(Number).sort((a, b) => a - b).forEach((seq) => {
          items.push({ label: `${ch}:${v}${half} 注${seq}`, text: notes[seq], chapter: ch, verse: v, half });
        });
      }
    }
  }
  if (!items.length) {
    body.innerHTML = '<div class="empty-hint">本章暂无注解</div>';
    return;
  }
  items.forEach(it => {
    const div = document.createElement('div');
    div.className = 'fn-item';
    div.title = '点击定位到经文';
    div.addEventListener('click', () => jumpToVerse(it.chapter, it.verse, it.half));
    const label = document.createElement('div');
    label.className = 'fn-label';
    label.textContent = it.label;
    const text = document.createElement('div');
    text.className = 'lr-content';
    // 注解归属本章书卷：相对引用（如「二一25，33。」）默认落到本书
    text.innerHTML = linkifyRefs(it.text, acr);
    div.appendChild(label);
    div.appendChild(text);
    body.appendChild(div);
  });
}

// 自动匹配当前章的生命读经篇目 id（按 verses 章节号）
function autoMatchLrIds(articles, ch) {
  return articles.filter(a => {
    if (!a.verses || !a.verses.length) return false;
    return a.verses.some(v => {
      const m = String(v).match(/^(\d+)/);
      return m && +m[1] === ch;
    });
  }).map(a => a.id);
}

function renderLifereading() {
  const body = $('studyBody');
  const articles = (state.lifereading && state.lifereading.articles) || [];
  const acr = state.currentBook.acronym, ch = state.currentChapter;
  const key = `${acr}${ch}`;
  const manual = state.lrMap[key];
  const ids = manual !== undefined ? manual : autoMatchLrIds(articles, ch);
  const matched = ids.map(id => articles.find(a => a.id === id)).filter(Boolean);

  body.innerHTML = '';
  // 顶部工具条：手动指定篇目入口
  if (!state.studyFull) {
    const bar = document.createElement('div');
    bar.className = 'lr-map-bar';
    const btn = document.createElement('button');
    btn.className = 'lr-map-btn';
    btn.textContent = manual !== undefined ? '指定篇目（手动）' : '指定篇目';
    btn.addEventListener('click', showLrMapPicker);
    bar.appendChild(btn);
    body.appendChild(bar);
  }

  if (!matched.length) {
    body.classList.remove('lr-full-mode');
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '本章暂无相关生命读经';
    body.appendChild(hint);
    return;
  }
  // 自愈：以源 content（含换行）为坐标系校验/修复本篇标注偏移
  let healed = false;
  for (const a of matched) {
    const lrAnns = state.annotations.filter(x =>
      x.type === 'lr' && x.book === state.currentBook.index && x.articleId === a.id);
    if (healAnnotations(lrAnns, a.content || '')) healed = true;
  }
  if (healed) save(LS_ANNOTATIONS, state.annotations);
  if (state.studyFull) {
    renderLrFullscreen(body, matched);
  } else {
    body.classList.remove('lr-full-mode');
    matched.forEach(a => body.appendChild(renderLrArticle(a)));
  }
}

// 手动指定某章的生命读经篇目（弹窗勾选）
function showLrMapPicker() {
  const articles = (state.lifereading && state.lifereading.articles) || [];
  const acr = state.currentBook.acronym, ch = state.currentChapter;
  const key = `${acr}${ch}`;
  const manual = state.lrMap[key];
  const checked = new Set(manual !== undefined ? manual : autoMatchLrIds(articles, ch));
  const rows = articles.map(a => {
    const c = checked.has(a.id) ? ' checked' : '';
    return `<label class="lr-pick-row"><input type="checkbox" value="${a.id}"${c}><span>${escapeHtml(a.title)}</span></label>`;
  }).join('');
  openPopup(`指定 ${acr}${ch} 的生命读经篇目`, `
    <div class="lr-pick-hint">勾选属于本章的篇目，保存后覆盖自动匹配；「恢复自动」清除手动指定。</div>
    <div class="lr-pick-list">${rows}</div>
    <div class="lr-pick-actions">
      <button class="popup-btn" id="lrPickReset">恢复自动</button>
      <button class="popup-btn primary" id="lrPickSave">保存</button>
    </div>
  `);
  $('lrPickSave').addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#popupBody .lr-pick-row input:checked')].map(i => +i.value);
    state.lrMap[key] = ids;
    save(LS_LR_MAP, state.lrMap);
    closePopupAll();
    renderStudy();
  });
  $('lrPickReset').addEventListener('click', () => {
    delete state.lrMap[key];
    save(LS_LR_MAP, state.lrMap);
    closePopupAll();
    renderStudy();
  });
}

// 渲染单篇生命读经（标题 + 经文引用 + 正文），返回 DOM 节点
// bookIndex：该篇所属书卷（默认当前卷；独立阅读器模块传 state.lrBookIndex）
function renderLrArticle(a, bookIndex) {
  const bi = bookIndex !== undefined ? bookIndex : state.currentBook.index;
  const div = document.createElement('div');
  div.className = 'lr-item';
  const title = document.createElement('div');
  title.className = 'lr-title';
  title.textContent = a.title;
  const verses = document.createElement('div');
  verses.className = 'lr-verses';
  verses.textContent = '经文：' + (a.verses || []).join('、');
  div.appendChild(title);
  div.appendChild(verses);
  const content = document.createElement('div');
  content.className = 'lr-content';
  content.dataset.article = a.id;
  content.dataset.book = bi;   // 模块感知标注：选区→偏移换算时定位所属卷
  const lrAnns = state.annotations.filter(x =>
    x.type === 'lr' && x.book === bi && x.articleId === a.id);
  // 相对引用默认书卷：以本篇所属卷为准（如 创的篇目里「二五11」即创25:11）
  // book index 为 1 起始（创=1），books 数组是 0 起始，须 find 按 index 匹配
  const book = (state.books && state.books.find(b => b.index === bi)) || null;
  const acr = (book && book.acronym) || null;
  renderLrContent(content, a.content || '', lrAnns, `lrh-${a.id}`, acr);
  div.appendChild(content);
  return div;
}

// 全屏研读：左侧纲目侧边栏 + 右侧正文
function renderLrFullscreen(body, matched) {
  body.classList.add('lr-full-mode');
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'lr-full-wrap';
  // 纲目侧边栏
  const outline = document.createElement('div');
  outline.className = 'lr-outline';
  matched.forEach(a => {
    const headings = extractLrHeadings(a.content || '');
    if (!headings.length) return;
    const group = document.createElement('div');
    group.className = 'lr-outline-group';
    const gTitle = document.createElement('div');
    gTitle.className = 'lr-outline-group-title';
    gTitle.textContent = a.title.replace(/^\d*第.+?篇\s*/, '');
    gTitle.title = a.title;
    group.appendChild(gTitle);
    headings.forEach((h, i) => {
      const item = document.createElement('div');
      item.className = `lr-toc-item lr-toc-l${h.level}`;
      item.textContent = h.text;
      item.dataset.target = `lrh-${a.id}-${i}`;
      item.addEventListener('click', () => {
        const el = document.getElementById(`lrh-${a.id}-${i}`);
        if (el) {
          // 点击即高亮当前项（滚动到达后由 scroll-spy 校正）
          setLrOutlineActive(outline, item.dataset.target);
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 1600);
        }
      });
      group.appendChild(item);
    });
    outline.appendChild(group);
  });
  wrap.appendChild(outline);
  // 正文
  const contentArea = document.createElement('div');
  contentArea.className = 'lr-full-content';
  matched.forEach(a => contentArea.appendChild(renderLrArticle(a)));
  wrap.appendChild(contentArea);
  body.appendChild(wrap);
  // 纲目联动：内容滚动时高亮左侧对应条目（scroll-spy）
  bindLrOutlineSpy(contentArea, outline);
}

// 纲目联动（scroll-spy）：内容滚动时，把最接近视口顶部的标题对应的纲目项置为 active
// 绑定纲目滚动高亮，返回监听函数句柄（调用方可 removeEventListener 防堆积）
function bindLrOutlineSpy(contentArea, outline) {
  const listener = () => {
    const items = outline.querySelectorAll('.lr-toc-item');
    if (!items.length) return;
    // 活跃判定线：内容区顶部往下 80px（标题滚入该区域即视为当前小节）
    const limit = contentArea.getBoundingClientRect().top + 80;
    let activeId = '';
    // 标题按文档顺序排列，最后一个越过判定线的即当前项
    for (const item of items) {
      const el = document.getElementById(item.dataset.target);
      if (el && el.getBoundingClientRect().top <= limit) activeId = item.dataset.target;
    }
    setLrOutlineActive(outline, activeId);
    // 让 active 项在左侧栏内保持可见
    const act = outline.querySelector('.lr-toc-item.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  };
  contentArea.addEventListener('scroll', listener);
  return listener;
}

// 把纲目高亮切到指定 target（清除其他 active）
function setLrOutlineActive(outline, targetId) {
  outline.querySelectorAll('.lr-toc-item').forEach(item => {
    item.classList.toggle('active', item.dataset.target === targetId);
  });
}

function renderMyNotes() {
  const body = $('studyBody');
  const key = `${state.currentBook.index}:${state.currentChapter}`;
  // 章级笔记
  const noteDiv = document.createElement('div');
  noteDiv.className = 'note-item';
  const meta = document.createElement('div');
  meta.className = 'note-meta';
  meta.textContent = `第 ${state.currentChapter} 章 笔记`;
  const ta = document.createElement('textarea');
  ta.placeholder = '写点本章的领受…';
  ta.value = state.chapterNotes[key] || '';
  ta.addEventListener('input', () => {
    state.chapterNotes[key] = ta.value;
    save(LS_CHAPTER_NOTES, state.chapterNotes);
  });
  noteDiv.appendChild(meta);
  noteDiv.appendChild(ta);
  body.appendChild(noteDiv);
  // 划线汇总跟随当前章：本章经文标注 + 当前章对应生命读经篇目的标注（与 renderLifereading 同一套篇目匹配）
  const acr = state.currentBook.acronym, ch = state.currentChapter;
  const manual = state.lrMap[`${acr}${ch}`];
  const lrIds = new Set(manual !== undefined ? manual : autoMatchLrIds((state.lifereading && state.lifereading.articles) || [], ch));
  const highlights = state.annotations.filter(a =>
    a.book === state.currentBook.index &&
    (a.type === 'verse' ? a.chapter === ch : lrIds.has(a.articleId))
  );
  body.appendChild(renderHighlights(highlights));
}

// 单条标注的分组标签（与 groupHlGlobal 一致；笔记管理模块的树/过滤/大段笔记挂组共用）
function annGroupLabel(a) {
  if (a.type === 'verse') return `${bookName(a.book)} · 第${a.chapter}章`;
  if (a.type === 'lr') return `${bookName(a.book)} · 生命读经`;
  if (a.type === 'book') {
    const metaVol = (a.series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[a.volume - 1] : null;
    const metaBook = metaVol && metaVol.books[a.book];
    return metaBook ? `${(state.bookMeta && state.bookMeta.name) || a.series} · ${metaVol.title} · ${metaBook.title}`
      : `${a.series} · 卷${a.volume} · 书${a.book + 1}`;
  }
  if (a.type === 'morning') {
    const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === a.period);
    return `${(t && (t.title || t.season)) || a.period} · 听抄`;
  }
  return '其他';
}

// 全局分组：经文按 书卷→章 两级；生命读经按书卷（label：创世记 · 第24章 / 创世记 · 生命读经）
// 供笔记管理模块使用（研读列「我的笔记」已只留本章聚合）
function groupHlGlobal(list) {
  const groups = [];
  const verseByBook = {};
  const lrByBook = {};
  const bookByKey = {};   // book 标注按 series:volume:book 分组
  const morningByPeriod = {};   // 晨兴按 period 分组
  list.forEach(a => {
    if (a.type === 'verse') {
      const m = (verseByBook[a.book] = verseByBook[a.book] || {});
      (m[a.chapter] = m[a.chapter] || []).push(a);
    } else if (a.type === 'lr') {
      (lrByBook[a.book] = lrByBook[a.book] || []).push(a);
    } else if (a.type === 'book') {
      const k = `${a.series}:${a.volume}:${a.book}`;
      (bookByKey[k] = bookByKey[k] || []).push(a);
    } else if (a.type === 'morning') {
      (morningByPeriod[a.period] = morningByPeriod[a.period] || []).push(a);
    }
  });
  const books = [...new Set([...Object.keys(verseByBook), ...Object.keys(lrByBook)])].map(Number).sort((a, b) => a - b);
  books.forEach(b => {
    Object.keys(verseByBook[b] || {}).map(Number).sort((x, y) => x - y).forEach(ch => {
      const items = verseByBook[b][ch].sort((x, y) => (x.verse - y.verse) || (x.start - y.start));
      groups.push({ label: annGroupLabel(items[0]), items });
    });
    if ((lrByBook[b] || []).length) {
      const items = lrByBook[b].sort((x, y) => (x.articleId - y.articleId) || (x.start - y.start));
      groups.push({ label: annGroupLabel(items[0]), items });
    }
  });
  // 书报分组：倪柝声文集 · 第{辑}辑 · {书名}
  Object.keys(bookByKey).sort().forEach(k => {
    const items = bookByKey[k].sort((x, y) => (x.chapter - y.chapter) || (x.start - y.start));
    groups.push({ label: annGroupLabel(items[0]), items });
  });
  // 晨兴分组：{期标题} · 第{n}篇
  Object.keys(morningByPeriod).sort().forEach(pid => {
    const items = morningByPeriod[pid].sort((x, y) => (x.chapterId - y.chapterId) || (x.start - y.start));
    groups.push({ label: annGroupLabel(items[0]), items });
  });
  return groups;
}

function groupHl(list) {
  const groups = [];
  const vs = list.filter(a => a.type === 'verse');
  const lr = list.filter(a => a.type === 'lr');
  const books = list.filter(a => a.type === 'book');
  const mornings = list.filter(a => a.type === 'morning');
  const verseByChapter = {};
  vs.forEach(a => { (verseByChapter[a.chapter] = verseByChapter[a.chapter] || []).push(a); });
  Object.keys(verseByChapter).map(Number).sort((a, b) => a - b).forEach(ch => {
    groups.push({ label: `第 ${ch} 章`, items: verseByChapter[ch].sort((x, y) => (x.verse - y.verse) || (x.start - y.start)) });
  });
  if (lr.length) {
    groups.push({ label: '生命读经', items: lr.sort((x, y) => (x.articleId - y.articleId) || (x.start - y.start)) });
  }
  // 书报：右栏已按 chapter 过滤，通常只一个 group；多卷时按 series:volume:book 分组
  if (books.length) {
    const byKey = {};
    books.forEach(a => { const k = `${a.series}:${a.volume}:${a.book}`; (byKey[k] = byKey[k] || []).push(a); });
    Object.keys(byKey).sort().forEach(k => {
      const [series, volume, book] = k.split(':');
      const metaVol = (series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[+volume - 1] : null;
      const metaBook = metaVol && metaVol.books[+book];
      const label = metaBook ? `${(state.bookMeta && state.bookMeta.name) || series} · ${metaVol.title} · ${metaBook.title}` : `${series} · 卷${volume} · 书${+book + 1}`;
      groups.push({ label, items: byKey[k].sort((x, y) => (x.chapter - y.chapter) || (x.start - y.start)) });
    });
  }
  // 听抄：右栏已按 chapter 过滤，通常只一个 group；多期时按 period:chapterId 分组
  if (mornings.length) {
    const byKey = {};
    mornings.forEach(a => { const k = `${a.period}:${a.chapterId}`; (byKey[k] = byKey[k] || []).push(a); });
    Object.keys(byKey).sort().forEach(k => {
      const [pid, cid] = k.split(':');
      const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === pid);
      const label = `${(t && (t.title || t.season)) || pid} · 第${cid}篇`;
      groups.push({ label, items: byKey[k].sort((x, y) => x.start - y.start) });
    });
  }
  return groups;
}

/* ============ 笔记管理模块（三列：分类树 / 条目列表 / 编辑面板） ============ */

const NOTES_DICTS = [
  { type: 'verse', dict: 'chapterNotes', lsKey: LS_CHAPTER_NOTES },
  { type: 'lr', dict: 'lrNotes', lsKey: LS_LR_NOTES },
  { type: 'book', dict: 'bookNotes', lsKey: LS_BOOK_NOTES },
  { type: 'morning', dict: 'morningNotes', lsKey: LS_MORNING_NOTES },
];

function saveNotesPrefs() {
  try {
    localStorage.setItem(LS_NOTES_PREFS, JSON.stringify({
      source: state.notesSource, color: state.notesColor, sort: state.notesSort,
    }));
  } catch (e) {}
}

// 大段笔记条目（只列非空）：{kind:'note', type, dict, key, text, loc}
function collectBigNotes() {
  const out = [];
  NOTES_DICTS.forEach(({ type, dict }) => {
    const store = state[dict] || {};
    Object.keys(store).forEach((key) => {
      const text = (store[key] || '').trim();
      if (!text) return;
      out.push({ kind: 'note', type, dict, key, text, loc: bigNoteLoc(type, key) });
    });
  });
  return out;
}

function bigNoteLoc(type, key) {
  const parts = key.split(':');
  if (type === 'verse') return `${bookName(+parts[0])} · 第${parts[1]}章`;
  if (type === 'lr') return `${bookName(+parts[0])} · 生命读经 第${parts[1]}篇`;
  if (type === 'book') {
    const [v, b, ch] = parts.map(Number);
    const metaVol = (state.bookMeta && state.bookMeta.volumes) ? state.bookMeta.volumes[v - 1] : null;
    const metaBook = metaVol && metaVol.books[b];
    return `${(metaBook && metaBook.title) || `书报 卷${v}书${b + 1}`} · 第${ch + 1}章`;
  }
  if (type === 'morning') {
    const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === parts[0]);
    return `${(t && (t.title || t.season)) || parts[0]} · 第${parts[1]}篇`;
  }
  return key;
}

// 大段笔记的挂组标签（与 annGroupLabel 对应，供混排挂组）
function bigNoteGroupLabel(n) {
  const parts = n.key.split(':');
  if (n.type === 'verse' || n.type === 'lr') {
    if (isNaN(+parts[0])) return '其他';  // 键格式异常容错，避免「第NaN卷」
  }
  if (n.type === 'verse') return `${bookName(+parts[0])} · 第${parts[1]}章`;
  if (n.type === 'lr') return `${bookName(+parts[0])} · 生命读经`;
  if (n.type === 'book') {
    const [v, b] = parts.map(Number);
    const metaVol = (state.bookMeta && state.bookMeta.volumes) ? state.bookMeta.volumes[v - 1] : null;
    const metaBook = metaVol && metaVol.books[b];
    return `${(state.bookMeta && state.bookMeta.name) || '书报'} · ${(metaVol && metaVol.title) || `第${v}辑`} · ${(metaBook && metaBook.title) || `书${b + 1}`}`;
  }
  if (n.type === 'morning') {
    const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === parts[0]);
    return `${(t && (t.title || t.season)) || parts[0]} · 听抄`;
  }
  return '其他';
}

function deleteBigNote(dict, key) {
  const store = state[dict];
  if (store) delete store[key];
  const entry = NOTES_DICTS.find(x => x.dict === dict);
  if (entry) save(entry.lsKey, store);
  if (state.notesSelectedItem && state.notesSelectedItem.kind === 'note' &&
      state.notesSelectedItem.dict === dict && state.notesSelectedItem.key === key) {
    state.notesSelectedItem = null;
  }
}

function selectNotesItem(item) {
  state.notesSelectedItem = item;
  renderNotesList();
  renderNotesPanel();
}

// 删除确认（复用 openPopup，不新建组件）
function confirmDialog(title, msg, onConfirm) {
  openPopup(title, `
    <div class="fb-hint">${escapeHtml(msg)}</div>
    <div class="fb-actions">
      <button class="popup-btn" id="cfCancel">取消</button>
      <button class="popup-btn danger" id="cfOk">删除</button>
    </div>
  `);
  const cancel = $('cfCancel'), ok = $('cfOk');
  if (cancel) cancel.addEventListener('click', () => closePopupAll());
  if (ok) ok.addEventListener('click', () => { closePopupAll(); onConfirm(); });
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toggleNotesCollapsed(id) {
  if (state.notesCollapsed.has(id)) state.notesCollapsed.delete(id);
  else state.notesCollapsed.add(id);
  renderNotesTree();
}

function mkTreeNode(label, count, active, collapsed, onClick) {
  const node = document.createElement('button');
  node.className = 'notes-tree-node' + (active ? ' active' : '');
  const caret = document.createElement('span');
  caret.className = 'notes-caret';
  caret.textContent = collapsed === undefined ? '' : (collapsed ? '▸' : '▾');
  const lbl = document.createElement('span');
  lbl.textContent = label;
  const cnt = document.createElement('span');
  cnt.className = 'notes-count';
  cnt.textContent = count;
  node.appendChild(caret);
  node.appendChild(lbl);
  node.appendChild(cnt);
  node.addEventListener('click', onClick);
  return node;
}

/* ---- 过滤与排序（来源 tab / 颜色 / 搜索 / 树选中分组 / 排序） ---- */
function notesFiltered() {
  // 同 renderNotesTree：只取带笔记的标注（纯划线不进笔记管理）
  let anns = state.annotations.filter(a => a.note && a.note.trim() && (state.notesSource === 'all' || a.type === state.notesSource));
  let bigNotes = collectBigNotes().filter(n => state.notesSource === 'all' || n.type === state.notesSource);
  const g = state.notesGroup;
  if (g) {
    if (g.source === 'all') {
      anns = anns.filter(a => annGroupLabel(a) === g.label);
      bigNotes = bigNotes.filter(n => bigNoteGroupLabel(n) === g.label);
    } else if (g.type === 'verse') {
      anns = anns.filter(a => a.type === 'verse' && a.book === g.book && (g.chapter === undefined || a.chapter === g.chapter));
      bigNotes = bigNotes.filter(n => n.type === 'verse' && +n.key.split(':')[0] === g.book && (g.chapter === undefined || +n.key.split(':')[1] === g.chapter));
    } else if (g.type === 'lr') {
      anns = anns.filter(a => a.type === 'lr' && a.book === g.book);
      bigNotes = bigNotes.filter(n => n.type === 'lr' && +n.key.split(':')[0] === g.book);
    } else if (g.type === 'book') {
      anns = anns.filter(a => a.type === 'book' && a.series === g.series && a.volume === g.volume && a.book === g.book && (g.chapter === undefined || a.chapter === g.chapter));
      bigNotes = bigNotes.filter(n => n.type === 'book' && +n.key.split(':')[0] === g.volume && +n.key.split(':')[1] === g.book && (g.chapter === undefined || +n.key.split(':')[2] === g.chapter));
    } else if (g.type === 'morning') {
      anns = anns.filter(a => a.type === 'morning' && a.period === g.period && (g.chapterId === undefined || a.chapterId === g.chapterId));
      bigNotes = bigNotes.filter(n => n.type === 'morning' && n.key.split(':')[0] === g.period && (g.chapterId === undefined || +n.key.split(':')[1] === g.chapterId));
    }
  }
  if (state.notesColor !== 'all') anns = anns.filter(a => a.colorId === state.notesColor);
  const q = state.notesQuery.trim().toLowerCase();
  if (q) {
    anns = anns.filter(a => (a.text || '').toLowerCase().includes(q) || (a.note || '').toLowerCase().includes(q));
    bigNotes = bigNotes.filter(n => n.text.toLowerCase().includes(q));
  }
  if (state.notesSort === 'time') {
    anns = [...anns].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  }
  return { anns, bigNotes };
}

/* ---- 左栏分类树 ---- */
function renderNotesTree() {
  const nav = $('notesNav');
  nav.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'notes-tree';
  // 笔记管理只收纳「自己做的笔记」：带 note 的标注 + 大段笔记；纯划线（无笔记）不在此列
  // （各阅读器右栏「划线汇总」仍展示全部标记）
  const anns = state.annotations.filter(a => a.note && a.note.trim());
  const bigNotes = collectBigNotes();
  const SOURCES = [
    { id: 'all', label: '全部', types: null },
    { id: 'verse', label: '经文', types: ['verse'] },
    { id: 'lr', label: '生命读经', types: ['lr'] },
    { id: 'book', label: '书报', types: ['book'] },
    { id: 'morning', label: '听抄', types: ['morning'] },
  ];
  const annOf = (types) => types ? anns.filter(a => types.includes(a.type)) : anns;
  const bigOf = (types) => bigNotes.filter(n => !types || types.includes(n.type));

  SOURCES.forEach(src => {
    const total = annOf(src.types).length + bigOf(src.types).length;
    if (src.id !== 'all' && total === 0) return;
    const isAll = src.id === 'all';
    // "全部"是根节点（不可折叠、不展开子节点），避免与"经文/生命读经/书报/听抄"下的子项双索引冗余
    if (isAll) state.notesCollapsed.delete('all');
    const collapsed = isAll ? undefined : state.notesCollapsed.has(src.id);
    const active = state.notesSource === src.id && !state.notesGroup;
    wrap.appendChild(mkTreeNode(src.label, total, active, collapsed, () => {
      if (active && !isAll) { toggleNotesCollapsed(src.id); return; }
      state.notesSource = src.id;
      state.notesGroup = null;
      state.notesSelectedItem = null;
      saveNotesPrefs();
      renderNotesTree();
      renderNotesList();
      renderNotesPanel();
    }));
    if (isAll || collapsed) return;
    const children = buildNotesTreeChildren(src.id, annOf(src.types), bigOf(src.types));
    if (children) wrap.appendChild(children);
  });
  nav.appendChild(wrap);
}

function buildNotesTreeChildren(sourceId, anns, bigNotes) {
  const wrap = document.createElement('div');
  wrap.className = 'notes-tree-children';
  if (!anns.length && !bigNotes.length) return wrap;
  const setGroup = (g) => { state.notesGroup = g; renderNotesTree(); renderNotesList(); };

  if (sourceId === 'all') {
    // 复用 groupHlGlobal 扁平分组做叶子；大段笔记单独按组挂（无标注组时自成节点）
    const bigByGroup = {};
    bigNotes.forEach(n => { (bigByGroup[bigNoteGroupLabel(n)] = bigByGroup[bigNoteGroupLabel(n)] || []).push(n); });
    const groups = groupHlGlobal(anns);
    groups.forEach(g => {
      wrap.appendChild(mkTreeNode(g.label, g.items.length + (bigByGroup[g.label] || []).length,
        isNotesGroupActive({ source: 'all', label: g.label }), undefined,
        () => setGroup({ source: 'all', label: g.label })));
    });
    Object.keys(bigByGroup).forEach(label => {
      if (groups.some(g => g.label === label)) return;
      wrap.appendChild(mkTreeNode(label, bigByGroup[label].length,
        isNotesGroupActive({ source: 'all', label }), undefined,
        () => setGroup({ source: 'all', label })));
    });
    return wrap;
  }

  if (sourceId === 'verse') {
    const byBook = {};
    anns.forEach(a => { (byBook[a.book] = byBook[a.book] || []).push(a); });
    Object.keys(byBook).map(Number).sort((x, y) => x - y).forEach(b => {
      const bAnns = byBook[b];
      const bBig = bigNotes.filter(n => +n.key.split(':')[0] === b);
      const nodeId = `verse:${b}`;
      const collapsed = state.notesCollapsed.has(nodeId);
      wrap.appendChild(mkTreeNode(bookName(b), bAnns.length + bBig.length,
        isNotesGroupActive({ type: 'verse', book: b }), collapsed, () => {
          if (isNotesGroupActive({ type: 'verse', book: b })) { toggleNotesCollapsed(nodeId); return; }
          setGroup({ type: 'verse', book: b });
        }));
      if (collapsed) return;
      const chWrap = document.createElement('div');
      chWrap.className = 'notes-tree-children';
      const byChapter = {};
      bAnns.forEach(a => { (byChapter[a.chapter] = byChapter[a.chapter] || []).push(a); });
      Object.keys(byChapter).map(Number).sort((x, y) => x - y).forEach(ch => {
        const chBig = bBig.filter(n => +n.key.split(':')[1] === ch).length;
        chWrap.appendChild(mkTreeNode(`第${ch}章`, byChapter[ch].length + chBig,
          isNotesGroupActive({ type: 'verse', book: b, chapter: ch }), undefined,
          () => setGroup({ type: 'verse', book: b, chapter: ch })));
      });
      wrap.appendChild(chWrap);
    });
    return wrap;
  }

  if (sourceId === 'lr') {
    const byBook = {};
    anns.forEach(a => { (byBook[a.book] = byBook[a.book] || []).push(a); });
    Object.keys(byBook).map(Number).sort((x, y) => x - y).forEach(b => {
      const bBig = bigNotes.filter(n => +n.key.split(':')[0] === b).length;
      wrap.appendChild(mkTreeNode(`${bookName(b)} · 生命读经`, byBook[b].length + bBig,
        isNotesGroupActive({ type: 'lr', book: b }), undefined,
        () => setGroup({ type: 'lr', book: b })));
    });
    return wrap;
  }

  if (sourceId === 'book') {
    const byKey = {};
    anns.forEach(a => { const k = `${a.series}:${a.volume}:${a.book}`; (byKey[k] = byKey[k] || []).push(a); });
    Object.keys(byKey).sort().forEach(k => {
      const kAnns = byKey[k];
      const [series, volume, book] = k.split(':');
      const metaVol = (series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[+volume - 1] : null;
      const metaBook = metaVol && metaVol.books[+book];
      const label = metaBook ? metaBook.title : `${series} 卷${volume}书${+book + 1}`;
      const nodeId = `book:${k}`;
      const collapsed = state.notesCollapsed.has(nodeId);
      const bBig = bigNotes.filter(n => +n.key.split(':')[0] === +volume && +n.key.split(':')[1] === +book);
      wrap.appendChild(mkTreeNode(label, kAnns.length + bBig.length,
        isNotesGroupActive({ type: 'book', series, volume: +volume, book: +book }), collapsed, () => {
          if (isNotesGroupActive({ type: 'book', series, volume: +volume, book: +book })) { toggleNotesCollapsed(nodeId); return; }
          setGroup({ type: 'book', series, volume: +volume, book: +book });
        }));
      if (collapsed) return;
      const chWrap = document.createElement('div');
      chWrap.className = 'notes-tree-children';
      const byChapter = {};
      kAnns.forEach(a => { (byChapter[a.chapter] = byChapter[a.chapter] || []).push(a); });
      Object.keys(byChapter).map(Number).sort((x, y) => x - y).forEach(ch => {
        const chBig = bBig.filter(n => +n.key.split(':')[2] === ch).length;
        chWrap.appendChild(mkTreeNode(`第${ch + 1}章`, byChapter[ch].length + chBig,
          isNotesGroupActive({ type: 'book', series, volume: +volume, book: +book, chapter: ch }), undefined,
          () => setGroup({ type: 'book', series, volume: +volume, book: +book, chapter: ch })));
      });
      wrap.appendChild(chWrap);
    });
    return wrap;
  }

  if (sourceId === 'morning') {
    const byPeriod = {};
    anns.forEach(a => { (byPeriod[a.period] = byPeriod[a.period] || []).push(a); });
    Object.keys(byPeriod).sort().forEach(pid => {
      const pAnns = byPeriod[pid];
      const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === pid);
      const pBig = bigNotes.filter(n => n.key.split(':')[0] === pid);
      const nodeId = `morning:${pid}`;
      const collapsed = state.notesCollapsed.has(nodeId);
      wrap.appendChild(mkTreeNode((t && (t.title || t.season)) || pid, pAnns.length + pBig.length,
        isNotesGroupActive({ type: 'morning', period: pid }), collapsed, () => {
          if (isNotesGroupActive({ type: 'morning', period: pid })) { toggleNotesCollapsed(nodeId); return; }
          setGroup({ type: 'morning', period: pid });
        }));
      if (collapsed) return;
      const chWrap = document.createElement('div');
      chWrap.className = 'notes-tree-children';
      const byChapter = {};
      pAnns.forEach(a => { (byChapter[a.chapterId] = byChapter[a.chapterId] || []).push(a); });
      Object.keys(byChapter).map(Number).sort((x, y) => x - y).forEach(cid => {
        const chBig = pBig.filter(n => +n.key.split(':')[1] === cid).length;
        chWrap.appendChild(mkTreeNode(`第${cid}篇`, byChapter[cid].length + chBig,
          isNotesGroupActive({ type: 'morning', period: pid, chapterId: cid }), undefined,
          () => setGroup({ type: 'morning', period: pid, chapterId: cid })));
      });
      wrap.appendChild(chWrap);
    });
    return wrap;
  }
  return wrap;
}

function isNotesGroupActive(g) {
  const cur = state.notesGroup;
  if (!cur) return false;
  return Object.keys(g).every(k => cur[k] === g[k]);
}

/* ---- 主区：工具条 + 分组列表 + 批量 ---- */
function renderNotesList() {
  const main = $('notesMain');
  main.innerHTML = '';
  main.appendChild(buildNotesToolbar());
  const listWrap = document.createElement('div');
  listWrap.className = 'notes-list';
  main.appendChild(listWrap);
  renderNotesListBody(listWrap);
}

function buildNotesToolbar() {
  const bar = document.createElement('div');
  bar.className = 'notes-toolbar';
  [['all', '全部'], ['verse', '经文'], ['lr', '生命读经'], ['book', '书报'], ['morning', '听抄']].forEach(([v, label]) => {
    const t = document.createElement('button');
    t.className = 'notes-tab' + (state.notesSource === v ? ' active' : '');
    t.textContent = label;
    t.addEventListener('click', () => {
      state.notesSource = v;
      state.notesGroup = null;
      state.notesSelectedItem = null;
      saveNotesPrefs();
      renderNotesTree();
      renderNotesList();
      renderNotesPanel();
    });
    bar.appendChild(t);
  });
  const colorBtn = document.createElement('button');
  colorBtn.className = 'notes-color' + (state.notesColor === 'all' ? ' active' : '');
  colorBtn.textContent = '全';
  colorBtn.title = '全部颜色';
  colorBtn.addEventListener('click', () => {
    state.notesColor = 'all';
    saveNotesPrefs();
    renderNotesList();
  });
  bar.appendChild(colorBtn);
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'notes-color' + (state.notesColor === c.id ? ' active' : '');
    b.style.background = c.hex;
    b.title = c.name + '：' + c.desc;
    b.addEventListener('click', () => {
      state.notesColor = c.id;
      saveNotesPrefs();
      renderNotesList();
    });
    bar.appendChild(b);
  });
  const search = document.createElement('input');
  search.className = 'notes-search';
  search.placeholder = '搜索划文本 / 笔记…';
  search.value = state.notesQuery;
  // 只刷新列表主体（保留输入框焦点，连续输入不被重建打断）
  search.addEventListener('input', () => {
    state.notesQuery = search.value;
    const listWrap = document.querySelector('#notesMain .notes-list');
    if (listWrap) renderNotesListBody(listWrap);
  });
  bar.appendChild(search);
  [['book', '书卷序'], ['time', '时间倒序']].forEach(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'notes-sort' + (state.notesSort === v ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      state.notesSort = v;
      saveNotesPrefs();
      renderNotesList();
    });
    bar.appendChild(b);
  });
  const selBtn = document.createElement('button');
  selBtn.className = 'notes-sort' + (state.notesSelectMode ? ' active' : '');
  selBtn.textContent = '多选';
  selBtn.addEventListener('click', () => {
    state.notesSelectMode = !state.notesSelectMode;
    state.notesSelected = new Set();
    state.notesSelectedItem = null;
    renderNotesList();
    renderNotesPanel();
  });
  bar.appendChild(selBtn);
  return bar;
}

function renderNotesListBody(listWrap) {
  listWrap.innerHTML = '';
  const { anns, bigNotes } = notesFiltered();
  if (state.notesSelectMode && (anns.length || bigNotes.length)) {
    listWrap.appendChild(renderNotesBatchBar());
  }
  if (!anns.length && !bigNotes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = state.annotations.length ? '当前筛选下没有笔记' : '还没有任何标注或笔记';
    listWrap.appendChild(empty);
    return;
  }
  if (state.notesSort === 'time') {
    anns.forEach(a => listWrap.appendChild(renderNotesItem(a)));
    if (bigNotes.length) {
      const gl = document.createElement('div');
      gl.className = 'notes-group';
      gl.textContent = '大段笔记';
      listWrap.appendChild(gl);
      bigNotes.forEach(n => listWrap.appendChild(renderNotesBigItem(n)));
    }
  } else {
    const bigByGroup = {};
    bigNotes.forEach(n => { (bigByGroup[bigNoteGroupLabel(n)] = bigByGroup[bigNoteGroupLabel(n)] || []).push(n); });
    const groups = groupHlGlobal(anns);
    groups.forEach(g => {
      const gl = document.createElement('div');
      gl.className = 'notes-group';
      gl.textContent = g.label;
      if (state.notesSelectMode && g.items.length) {
        const allBtn = document.createElement('span');
        allBtn.className = 'notes-group-check';
        allBtn.textContent = '全选';
        allBtn.addEventListener('click', () => {
          g.items.forEach(a => state.notesSelected.add(a.id));
          renderNotesList();
        });
        gl.appendChild(allBtn);
      }
      listWrap.appendChild(gl);
      (bigByGroup[g.label] || []).forEach(n => listWrap.appendChild(renderNotesBigItem(n)));
      const locs = g.items.map(a => hlLocText(a));
      const locSame = locs.length > 1 && locs.every(l => l === locs[0]);
      // 笔记条目强制显示定位（反馈 #13 同 renderHighlights：出处是笔记的留存依据）
      g.items.forEach((a, i) => listWrap.appendChild(renderNotesItem(a,
        a.note && a.note.trim() ? false : (locSame && i > 0))));
    });
    Object.keys(bigByGroup).forEach(label => {
      if (groups.some(g => g.label === label)) return;
      const gl = document.createElement('div');
      gl.className = 'notes-group';
      gl.textContent = label;
      listWrap.appendChild(gl);
      bigByGroup[label].forEach(n => listWrap.appendChild(renderNotesBigItem(n)));
    });
  }
}

function renderNotesBatchBar() {
  const bar = document.createElement('div');
  bar.className = 'notes-batch-bar';
  const label = document.createElement('span');
  label.textContent = `已选 ${state.notesSelected.size} 条`;
  const del = document.createElement('button');
  del.className = 'popup-btn danger';
  del.textContent = '删除所选';
  del.addEventListener('click', () => {
    const n = state.notesSelected.size;
    if (!n) return;
    confirmDialog('批量删除', `删除选中的 ${n} 条标注？此操作不可撤销。`, () => {
      state.annotations = state.annotations.filter(a => !state.notesSelected.has(a.id));
      save(LS_ANNOTATIONS, state.annotations);
      state.notesSelected = new Set();
      state.notesSelectMode = false;
      state.notesSelectedItem = null;
      renderNotesTree();
      renderNotesList();
      renderNotesPanel();
    });
  });
  const cancel = document.createElement('button');
  cancel.className = 'popup-btn';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    state.notesSelectMode = false;
    state.notesSelected = new Set();
    renderNotesList();
  });
  bar.appendChild(label);
  bar.appendChild(del);
  bar.appendChild(cancel);
  return bar;
}

function renderNotesItem(a, hideLoc) {
  const div = buildHlItemBody(a, 'notes-item', hideLoc);
  div.classList.toggle('selected',
    state.notesSelectedItem && state.notesSelectedItem.kind === 'ann' && state.notesSelectedItem.id === a.id);
  if (state.notesSelectMode) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'notes-item-check';
    cb.checked = state.notesSelected.has(a.id);
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cb.checked) state.notesSelected.add(a.id);
      else state.notesSelected.delete(a.id);
      const bar = document.querySelector('.notes-batch-bar span');
      if (bar) bar.textContent = `已选 ${state.notesSelected.size} 条`;
    });
    div.insertBefore(cb, div.firstChild);
  }
  if (a.createdAt) {
    const time = document.createElement('span');
    time.className = 'notes-item-time';
    time.textContent = fmtTime(a.createdAt);
    div.appendChild(time);
  }
  div.addEventListener('click', () => selectNotesItem({ kind: 'ann', id: a.id }));
  return div;
}

function renderNotesBigItem(n) {
  const div = document.createElement('div');
  div.className = 'notes-item' + (
    state.notesSelectedItem && state.notesSelectedItem.kind === 'note' &&
    state.notesSelectedItem.dict === n.dict && state.notesSelectedItem.key === n.key ? ' selected' : '');
  const kind = document.createElement('span');
  kind.className = 'notes-item-kind';
  kind.textContent = '📝';
  const loc = document.createElement('span');
  loc.className = 'hl-loc';
  loc.textContent = n.loc;
  const text = document.createElement('span');
  text.className = 'hl-text';
  text.textContent = n.text;
  div.appendChild(kind);
  div.appendChild(loc);
  div.appendChild(text);
  div.addEventListener('click', () => selectNotesItem({ kind: 'note', dict: n.dict, key: n.key }));
  return div;
}

/* ---- 右栏编辑面板 ---- */
function renderNotesPanel() {
  const side = $('notesSide');
  side.innerHTML = '';
  const item = state.notesSelectedItem;
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'notes-panel-empty';
    empty.innerHTML = `
      <svg viewBox="0 0 48 48" width="42" height="42" fill="none" stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 6h14l8 8v28H14z"/>
        <path d="M28 6v8h8"/>
        <path d="M18 26h12M18 31h12M18 21h5"/>
      </svg>
      <div class="notes-panel-empty-title">未选中条目</div>
      <div class="notes-panel-empty-desc">点击左侧条目在此查看与编辑<br>编辑笔记 / 改色 / 下划线 / 删除</div>`;
    side.appendChild(empty);
    return;
  }
  if (item.kind === 'ann') {
    const a = state.annotations.find(x => x.id === item.id);
    if (!a) { state.notesSelectedItem = null; renderNotesPanel(); return; }
    const title = document.createElement('div');
    title.className = 'notes-panel-title';
    title.textContent = a.type === 'verse' ? '经文标注' : a.type === 'lr' ? '生命读经标注' : a.type === 'book' ? '书报标注' : '听抄标注';
    side.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'notes-panel-meta';
    meta.textContent = `${annGroupLabel(a)}${a.createdAt ? ' · ' + fmtTime(a.createdAt) : ''}`;
    side.appendChild(meta);
    const text = document.createElement('div');
    text.className = 'notes-panel-text';
    text.textContent = annotationText(a) || '（内容已失效）';
    side.appendChild(text);
    const ta = document.createElement('textarea');
    ta.className = 'lr-note-ta';
    ta.placeholder = '写点笔记…';
    ta.value = a.note || '';
    ta.addEventListener('input', () => {
      a.note = ta.value;
      save(LS_ANNOTATIONS, state.annotations);
    });
    ta.addEventListener('blur', () => {
      // 笔记清空后：无颜色/无下划线 → 等同删除该条（与 saveNote 行为一致）；
      // 仍有颜色/下划线 → 降级为纯划线，退出笔记管理（阅读器右栏划线汇总仍可见），清空选中
      const hasNote = (a.note || '').trim();
      if (!hasNote && !a.colorId && !a.underline) { deleteAnn(a.id); return; }
      renderNotesList();
      if (!hasNote) { state.notesSelectedItem = null; renderNotesPanel(); }
    });
    side.appendChild(ta);
    const row = document.createElement('div');
    row.className = 'notes-panel-row';
    COLORS.forEach(c => {
      const sw = document.createElement('button');
      sw.className = 'notes-color';
      sw.style.background = c.hex;
      sw.title = c.name + '：' + c.desc;
      sw.classList.toggle('active', a.colorId === c.id && !a.underline);
      sw.addEventListener('click', () => changeAnnColor(a.id, c.id));
      row.appendChild(sw);
    });
    const ul = document.createElement('button');
    ul.className = 'notes-sort' + (a.underline ? ' active' : '');
    ul.textContent = '下划线';
    ul.addEventListener('click', () => toggleAnnUnderline(a.id));
    row.appendChild(ul);
    side.appendChild(row);
    const actions = document.createElement('div');
    actions.className = 'notes-panel-row';
    const del = document.createElement('button');
    del.className = 'popup-btn danger';
    del.textContent = '删除';
    del.addEventListener('click', () => confirmDialog('删除标注', '删除这条标注？此操作不可撤销。', () => deleteAnn(a.id)));
    actions.appendChild(del);
    side.appendChild(actions);
    return;
  }
  if (item.kind === 'note') {
    const entry = NOTES_DICTS.find(x => x.dict === item.dict);
    const store = state[item.dict];
    if (!store || !(item.key in store)) { state.notesSelectedItem = null; renderNotesPanel(); return; }
    const title = document.createElement('div');
    title.className = 'notes-panel-title';
    title.textContent = '大段笔记';
    side.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'notes-panel-meta';
    meta.textContent = bigNoteLoc(item.type || (entry && entry.type), item.key);
    side.appendChild(meta);
    const ta = document.createElement('textarea');
    ta.className = 'lr-note-ta';
    ta.placeholder = '写点笔记…';
    ta.value = store[item.key] || '';
    ta.addEventListener('input', () => {
      store[item.key] = ta.value;
      save(entry.lsKey, store);
    });
    ta.addEventListener('blur', () => {
      if (!(store[item.key] || '').trim()) { deleteBigNote(item.dict, item.key); renderNotesTree(); renderNotesList(); renderNotesPanel(); }
    });
    side.appendChild(ta);
    const actions = document.createElement('div');
    actions.className = 'notes-panel-row';
    const del = document.createElement('button');
    del.className = 'popup-btn danger';
    del.textContent = '删除';
    del.addEventListener('click', () => confirmDialog('删除笔记', '删除这条笔记？此操作不可撤销。', () => {
      deleteBigNote(item.dict, item.key);
      renderNotesTree();
      renderNotesList();
      renderNotesPanel();
    }));
    actions.appendChild(del);
    side.appendChild(actions);
  }
}

function renderHighlights(anns, groupFn, opts) {
  const section = document.createElement('div');
  section.className = 'hl-section';
  const header = document.createElement('div');
  header.className = 'hl-header';
  // 计数区分「划线」与「笔记」：带 note 的条目单独计数（切来源 tab 时同步刷新）
  const setHeader = (list) => {
    const noted = list.filter(a => a.note && a.note.trim()).length;
    header.textContent = `划线汇总 ${list.length}${noted ? ` · 笔记 ${noted}` : ''}`;
  };
  section.appendChild(header);
  if (!anns.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '划线的经文或生命读经会汇总在这里，点击可跳回原文';
    section.appendChild(hint);
    return section;
  }
  const verseItems = anns.filter(a => a.type === 'verse');
  const lrItems = anns.filter(a => a.type === 'lr');
  const bookItems = anns.filter(a => a.type === 'book');
  const morningItems = anns.filter(a => a.type === 'morning');
  const doGroup = groupFn || groupHl;
  const hideGroupHeader = !!(opts && opts.hideGroupHeader);
  const hideItemLoc = !!(opts && opts.hideItemLoc);
  const box = document.createElement('div');
  const renderList = (list) => {
    box.innerHTML = '';
    const groups = doGroup(list);
    if (!groups.length) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = '此分类暂无划线';
      box.appendChild(hint);
      return;
    }
    groups.forEach(g => {
      // 右栏（书报/生命读经/听抄）的 anns 已按 chapter/article 过滤，
      // 组标签 = 当前模块元数据、单条 loc = 当前章，都是冗余信息
      if (!hideGroupHeader) {
        const gl = document.createElement('div');
        gl.className = 'hl-group';
        gl.textContent = g.label;
        box.appendChild(gl);
      }
      // 同组多条划线的定位标签全相同时（如书报右栏固定一章）只首条显示
      const locs = g.items.map(a => hlLocText(a));
      const locSame = locs.length > 1 && locs.every(l => l === locs[0]);
      // 带笔记的条目置顶（笔记=自己做的内容，划线=阅读标记）
      const noted = g.items.filter(a => a.note && a.note.trim());
      const plain = g.items.filter(a => !(a.note && a.note.trim()));
      // 笔记条目强制显示定位（反馈 #13：右栏单章上下文里纯划线隐藏出处可以，
      // 笔记是留存内容，需知道写在哪节/哪篇）
      [...noted, ...plain].forEach((a, i) => box.appendChild(renderHlItem(a,
        a.note && a.note.trim() ? false : (hideItemLoc || (locSame && i > 0)))));
    });
  };
  // 单一来源（书报/生命读经/听抄右栏天然如此）跳过来源 tab：避免"全部(N)=经文/书报(N)"的冗余
  // 读经研读列（anns 混合 verse+lr）保留 tab 用于切换
  const typeSet = new Set(anns.map(a => a.type));
  const showTabs = typeSet.size > 1;
  if (showTabs) {
    // 来源 tab：全部 / 经文 / 生命读经 / 书报 / 晨兴
    const tabs = document.createElement('div');
    tabs.className = 'hl-tabs';
    const mkTab = (label, list) => {
      const t = document.createElement('button');
      t.className = 'hl-tab';
      t.textContent = `${label}（${list.length}）`;
      t.addEventListener('click', () => {
        tabs.querySelectorAll('.hl-tab').forEach(x => x.classList.toggle('active', x === t));
        setHeader(list);
        renderList(list);
      });
      return t;
    };
    const tabAll = mkTab('全部', anns);
    const tabsArr = [tabAll, mkTab('经文', verseItems), mkTab('生命读经', lrItems)];
    if (bookItems.length) tabsArr.push(mkTab('书报', bookItems));
    if (morningItems.length) tabsArr.push(mkTab('听抄', morningItems));
    tabs.append(...tabsArr);
    tabAll.classList.add('active');
    section.appendChild(tabs);
  }
  section.appendChild(box);
  setHeader(anns);
  renderList(anns);
  return section;
}

function renderHlItem(a, hideLoc) {
  const div = buildHlItemBody(a, undefined, hideLoc);
  div.addEventListener('click', () => { navigateToAnnotation(a); });
  return div;
}

// 条目主体：左侧色条 + 定位 + 划文本 + 笔记摘要（研读列/模块右栏与笔记管理模块共用）
// 视觉：4px 色条 + 整行 8% 同色背景，文字深色；underline 类型保留白底+橙下划线
function buildHlItemBody(a, cls, hideLoc) {
  const div = document.createElement('div');
  div.className = cls || 'hl-item';
  if (a.underline) {
    // 下划线型无颜色分类，用统一橙色底表达"有标注但无分类"，与有色标注底色模式对齐
    div.style.backgroundColor = 'rgba(235,108,5,.08)';
  } else {
    div.style.backgroundColor = colorBgSoft(a.colorId);   // 8% 同色背景
  }
  const text = document.createElement('span');
  text.className = 'hl-text';
  text.textContent = annotationText(a) || '（内容已失效）';
  // 同一组内定位标签全相同时（如书报右栏固定一章）只首条显示，避免视觉上像内容重复
  if (!hideLoc) {
    const loc = document.createElement('span');
    loc.className = 'hl-loc';
    loc.textContent = hlLocText(a);
    div.appendChild(loc);
  }
  div.appendChild(text);
  if (a.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'hl-note';
    noteEl.textContent = '📝 ' + a.note;
    div.appendChild(noteEl);
  }
  return div;
}

// 定位文案（研读列条目与笔记管理模块共用）
function hlLocText(a) {
  if (a.type === 'verse') return `${a.chapter}:${a.verse}${a.half}`;
  if (a.type === 'lr') {
    const nm = (state.books && state.books.find(b => b.index === a.book)) || {};
    return `${nm.name || '生命读经'} 第${a.articleId}篇`;
  }
  if (a.type === 'book') {
    const metaVol = (a.series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[a.volume - 1] : null;
    const metaBook = metaVol && metaVol.books[a.book];
    return metaBook ? `${metaBook.title} · 第${a.chapter + 1}章` : `书报 卷${a.volume}书${a.book + 1} 第${a.chapter + 1}章`;
  }
  if (a.type === 'morning') {
    const t = state.morningIndex && state.morningIndex.trainings.find(x => x.id === a.period);
    return `${(t && (t.title || t.season)) || a.period} · 第${a.chapterId}篇`;
  }
  return '';
}

function annotationText(a) {
  let slice = '';
  if (a.type === 'verse') {
    // 用标注自己的书卷取缩写（全局模式下当前书卷可能与标注书卷不同）
    const acr = (state.books.find(b => b.index === a.book) || state.currentBook).acronym;
    const key = `${acr}${a.chapter}:${a.verse}${a.half || ''}`;
    const marked = (state.bibleText || {})[key];
    if (!marked) return a.text || '';
    slice = parseMarkedText(marked).plain.slice(a.start, a.end);
  } else if (a.type === 'lr') {
    // 当前卷无该篇（跨书卷）时查 lrVolumes 缓存
    const art = ((state.lifereading && state.lifereading.articles) || []).find(x => x.id === a.articleId)
      || ((state.lrVolumes[a.book] || { articles: [] }).articles || []).find(x => x.id === a.articleId);
    if (!art) return a.text || '';
    slice = (art.content || '').slice(a.start, a.end);
  } else if (a.type === 'book') {
    // 书报：按系列+辑内容缓存
    const vols = state.bookVolumes[a.series] || {};
    const vol = vols[a.volume];
    const book = vol && vol.books[a.book];
    const ch = book && book.chapters[a.chapter];
    if (!ch) return a.text || '';
    slice = (ch.content || '').slice(a.start, a.end);
  } else if (a.type === 'morning') {
    const data = state.morningData[a.period];
    const ch = data && data.chapters.find(c => c.number === a.chapterId);
    if (!ch) return a.text || '';
    slice = (ch.content || '').slice(a.start, a.end);
  }
  // 偏移失效时退回保存的文本快照（自愈前的兜底）
  return (a.text && slice !== a.text) ? a.text : slice;
}

/* ============ 移动端单视图切换（读经 / 研读） ============ */
function isMobile() { return window.innerWidth <= 900; }

// 移动端同一时刻只显示一个视图：读经（经文）或研读（注解/生命读经/我的笔记）
// 模式切换在顶栏 crumb 右侧的「读经|研读」pill；桌面端调用为 no-op（pill 隐藏，body 类无 CSS 效果）
function setMobileView(view) {
  if (!isMobile() || state.screen === 'home') return;   // 首页是第三种态，不切读/研
  document.body.classList.toggle('mobile-study', view === 'study');
  document.querySelectorAll('#modePill .mode-pill-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  updateMobileNav();
}

// 当前章匹配的生命读经篇目（与 renderLifereading 同一套匹配：lrMap 手动覆盖 + autoMatch 自动）
function matchedLrArticles() {
  const articles = (state.lifereading && state.lifereading.articles) || [];
  const acr = state.currentBook.acronym, ch = state.currentChapter;
  const manual = state.lrMap[`${acr}${ch}`];
  const ids = manual !== undefined ? manual : autoMatchLrIds(articles, ch);
  return ids.map(id => articles.find(a => a.id === id)).filter(Boolean);
}

// 底部导航状态：读经模式专用（研读模式底部导航隐藏），按钮文字 + 边界禁用
function updateMobileNav() {
  if (!isMobile()) return;
  const prev = $('mPrevBtn'), next = $('mNextBtn');
  prev.textContent = '‹ 上一章';
  next.textContent = '下一章 ›';
  prev.disabled = state.currentChapter <= 1;
  next.disabled = state.currentChapter >= state.currentBook.chapters;
}

// 底部翻页：仅读经模式翻章（研读模式无底部导航，翻章/翻篇走 crumb 选章 / ☰ 篇目导航）
function mobileNavGo(dir) {
  const ch = state.currentChapter + dir;
  if (ch < 1 || ch > state.currentBook.chapters) return;
  selectChapter(ch);
}

// 轻提示（底部弹出，自动消失；供同步状态、空状态等轻量提醒）
function showToast(text, cls) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.className = `toast show ${cls || ''}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// 移动端 crumb 点击 → 章节选择弹窗（章网格 + 顶部书卷横向切换）
// 章节选择弹窗（首页读经块 / 移动端 crumb 共用）：initBook 指定初始书卷，默认当前书卷
function openChapterPicker(initBook) {
  let cur = (initBook && state.books.some(b => b.index === initBook)) ? initBook : state.currentBook.index;
  const books = state.books;
  const renderGrid = () => {
    const book = books.find(b => b.index === cur);
    let html = `<div class="chp-title">${escapeHtml(book.name)}</div><div class="chp-grid">`;
    for (let i = 1; i <= book.chapters; i++) {
      const act = (cur === state.currentBook.index && i === state.currentChapter) ? ' active' : '';
      html += `<button class="chp-cell${act}" data-b="${cur}" data-c="${i}">${i}</button>`;
    }
    html += '</div>';
    $('chpGrid').innerHTML = html;
  };
  openPopup('选择章节', `
    <div class="chp-books" id="chpBooks">
      ${books.map(b => `<button class="chp-book${b.index === cur ? ' active' : ''}" data-b="${b.index}">${escapeHtml(b.name)}</button>`).join('')}
    </div>
    <div id="chpGrid"></div>
  `);
  renderGrid();
  const activeBook = document.querySelector('#chpBooks .chp-book.active');
  if (activeBook) activeBook.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('chpBooks').addEventListener('click', (e) => {
    const b = e.target.closest('.chp-book');
    if (!b) return;
    cur = +b.dataset.b;
    document.querySelectorAll('#chpBooks .chp-book').forEach(x => x.classList.toggle('active', +x.dataset.b === cur));
    renderGrid();
  });
  $('chpGrid').addEventListener('click', (e) => {
    const c = e.target.closest('.chp-cell');
    if (!c) return;
    const b = +c.dataset.b, ch = +c.dataset.c;
    closePopupAll();
    enterWork();   // 从首页进入即切工作区（工作区内调用为幂等）
    if (b !== state.currentBook.index || ch !== state.currentChapter) selectBook(b, ch);
    setMobileView('read');
  });
}

// 移动端研读+生命读经 tab 时 ☰ → 篇目 + 纲目导航（点击滚动定位）
function openLrNavSheet() {
  const matched = matchedLrArticles();
  if (!matched.length) {
    showToast('本章暂无相关生命读经');
    return;
  }
  let html = '<div class="lrn-list">';
  matched.forEach(a => {
    const headings = extractLrHeadings(a.content || '');
    html += `<div class="lrn-group" data-article="${a.id}">`;
    html += `<div class="lrn-group-title" data-jump="${a.id}">${escapeHtml(a.title)}</div>`;
    headings.forEach((h, i) => {
      html += `<div class="lr-toc-item lr-toc-l${Math.min(h.level, 10)}" data-target="lrh-${a.id}-${i}">${escapeHtml(h.text)}</div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  openPopup('生命读经导航', html);
  const list = document.querySelector('#popupBody .lrn-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const toc = e.target.closest('.lr-toc-item');
    if (toc) {
      const el = document.getElementById(toc.dataset.target);
      if (!el) return;
      closePopupAll();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
      return;
    }
    const g = e.target.closest('.lrn-group-title');
    if (g) {
      closePopupAll();
      const content = document.querySelector(`.lr-content[data-article="${g.dataset.jump}"]`);
      if (content) content.closest('.lr-item').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function jumpToVerse(chapter, verse, half) {
  setMobileView('read');
  if (chapter !== state.currentChapter) {
    selectChapter(chapter).then(() => scrollToVerse(verse, half));
  } else {
    scrollToVerse(verse, half);
  }
}

function scrollToVerse(verse, half) {
  const vtext = document.querySelector(`.vtext[data-verse="${verse}${half}"]`);
  if (!vtext) return;
  const verseEl = vtext.closest('.verse');
  verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  verseEl.classList.add('flash');
  setTimeout(() => verseEl.classList.remove('flash'), 1600);
}

function jumpToLr(articleId) {
  setMobileView('study');
  state.activeTab = 'lifereading';
  document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'lifereading'));
  renderStudy();
  requestAnimationFrame(() => {
    const content = document.querySelector(`.lr-content[data-article="${articleId}"]`);
    if (!content) return;
    const item = content.closest('.lr-item');
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.classList.add('flash');
    setTimeout(() => item.classList.remove('flash'), 1600);
  });
}

// 全局笔记点击跳转：跨书卷先选书再定位（同书卷行为与现状一致）
// 模块感知：生命读经/书报模块内点击 → 就地切篇/章并滚动；否则回读经模块走原文定位
async function navigateToAnnotation(a) {
  if (a.type === 'lr' && state.activeModule === 'lifereading') {
    if (a.book !== state.lrBookIndex || a.articleId !== state.lrArticleId) {
      await selectLrVolume(a.book);
      await selectLrArticle(a.articleId);
    }
    // 已在本篇：滚动到标注位置
    const mark = document.querySelector(`#lrMain mark[data-ann-id="${a.id}"]`);
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (a.type === 'book' && state.activeModule === 'books') {
    if (a.volume !== state.bookVolume || a.book !== state.bookBook || a.chapter !== state.bookChapter) {
      await selectBookChapter(a.volume, a.book, a.chapter);
    }
    const mark = document.querySelector(`#bookMain mark[data-ann-id="${a.id}"]`);
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  await enterModule('bible');
  if (a.type === 'verse') {
    if (a.book !== state.currentBook.index) await selectBook(a.book, a.chapter);
    else if (a.chapter !== state.currentChapter) await selectChapter(a.chapter);
    jumpToVerse(a.chapter, a.verse, a.half);
  } else if (a.type === 'lr') {
    if (a.book !== state.currentBook.index) await selectBook(a.book, 1);
    const art = ((state.lifereading && state.lifereading.articles) || []).find(x => x.id === a.articleId)
      || ((state.lrVolumes[a.book] || { articles: [] }).articles || []).find(x => x.id === a.articleId);
    const ch = art && art.verses && art.verses.length ? (parseInt(String(art.verses[0])) || 1) : 1;
    if (ch !== state.currentChapter) await selectChapter(ch);
    jumpToLr(a.articleId);
  } else if (a.type === 'book') {
    await enterModule('books', { series: a.series, volume: a.volume, book: a.book, chapter: a.chapter });
    const mark = document.querySelector(`#bookMain mark[data-ann-id="${a.id}"]`);
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (a.type === 'morning') {
    await enterModule('morning', { period: a.period, chapterId: a.chapterId });
    const mark = document.querySelector(`#morningMain mark[data-ann-id="${a.id}"]`);
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ============ 生命读经（篇目弹窗 / 卷缓存） ============ */
// 篇目列表弹窗（crumb 点击 / 全局笔记入口），点击 → 统一入口 openLrArticle
// 篇目选择弹窗（crumb 点击 / 移动端 ☰ 共用）：顶部 66 卷 Tab + 下方当前卷篇目列表，两级快速跨卷切换
async function openLrArticleList(bookIndex) {
  let cur = bookIndex;
  openPopup('生命读经 · 选择篇目', `
    <div class="chp-books" id="lrpVols">
      ${state.books.map(b => `<button class="chp-book${b.index === cur ? ' active' : ''}" data-b="${b.index}">${escapeHtml(b.acronym)}</button>`).join('')}
    </div>
    <div class="lr-art-list" id="lrpArts"></div>`);
  const tabs = $('lrpVols');
  const listEl = $('lrpArts');
  const renderArts = async () => {
    const vol = await ensureLrVolume(cur);
    if (!vol) { listEl.innerHTML = '<div class="empty-hint">该卷生命读经数据缺失</div>'; return; }
    listEl.innerHTML = (vol.articles || []).map(a =>
      `<button class="lr-art-cell${cur === state.lrBookIndex && a.id === state.lrArticleId ? ' active' : ''}" data-id="${a.id}">${escapeHtml(a.title)}</button>`).join('');
    const act = listEl.querySelector('.lr-art-cell.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  };
  await renderArts();
  polishVolStrip(tabs);
  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('.chp-book');
    if (!b || +b.dataset.b === cur) return;
    cur = +b.dataset.b;
    tabs.querySelectorAll('.chp-book').forEach(x => x.classList.toggle('active', +x.dataset.b === cur));
    b.scrollIntoView({ block: 'nearest', inline: 'center' });
    await renderArts();
  });
  listEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.lr-art-cell');
    if (!cell) return;
    const vol = state.lrVolumes[cur];
    const art = vol && (vol.articles || []).find(a => a.id === +cell.dataset.id);
    if (!art) return;
    closePopupAll();
    openLrArticle(cur, art);
  });
}

// 加载并缓存某卷生命读经（selectBook 懒加载后也写入同一缓存，见 selectBook）
async function ensureLrVolume(bookIndex) {
  if (state.lrVolumes[bookIndex]) return state.lrVolumes[bookIndex];
  const b = state.books.find(x => x.index === bookIndex);
  if (!b) return null;
  showLoadingHint($('lrMain'), '生命读经加载中…');
  try {
    const data = await fetchJSON(`data/lifereading/${b.acronym}.json`);
    data.bookIndex = bookIndex;
    data.name = b.name;
    state.lrVolumes[bookIndex] = data;
    return data;
  } catch (e) {
    // 重试：加载成功后若仍在模块内，重渲染主区（替换错误提示）
    showLoadingError($('lrMain'), '生命读经加载失败', () => {
      ensureLrVolume(bookIndex).then(() => {
        if (state.activeModule === 'lifereading') READER_MODULES.lifereading.renderMain();
      });
    });
    return null;
  }
}

/* ============ 生命读经阅读器模块 ============ */
let _lrSpy = null;   // 模块右栏纲目滚动高亮句柄（切篇/切 tab 前解绑防堆积）

// 卷条/辑条/期条通用体验：滚轮纵向转横向滚动（原生横向滚动条已隐藏，见 style.css）+ 当前项滚入可视区居中。
// 横向 Tab 行通用体验（弹窗书卷/辑/期 Tab 复用）：滚轮纵向转横向滚动 + 当前项滚入可视区居中。
// 原生横向滚动条已隐藏（style.css .chp-books）。
function polishVolStrip(strip) {
  if (!strip) return;
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // 已是横向滚动的交给默认行为
    if (strip.scrollWidth <= strip.clientWidth) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  const act = strip.querySelector('.active');
  if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// 生命读经全卷篇目标题索引（data/lr-titles.json，export.py 导出，~200KB）
// 避免模块级搜索拉全量 28MB 正文；按 acronym 关联 books.json 取卷名/bookIndex
async function ensureLrTitleIndex() {
  if (state.lrTitleIndex) return state.lrTitleIndex;
  try {
    const list = await fetchJSON('data/lr-titles.json');
    const bookOf = {};
    state.books.forEach(b => { bookOf[b.acronym] = b; });
    state.lrTitleIndex = {
      flat: (list || []).map(t => {
        const b = bookOf[t.acronym];
        return { book: b ? b.index : -1, volName: b ? b.name : t.acronym, id: t.id, title: t.title || '' };
      }).filter(t => t.book >= 0),
    };
    return state.lrTitleIndex;
  } catch (e) {
    state.lrTitleIndex = null;
    return null;
  }
}

// 左栏篇目列表 + 模块级搜索：空查询=当前卷列表；非空=全 66 卷篇目标题检索，
// 结果带卷名前缀，点击 openLrArticle 跨卷跳转（selectLrVolume 会重渲染左栏保持搜索视图）
async function renderLrArticleList(bookIndex, vol) {
  const nav = $('lrNav');
  let list = nav.querySelector('.lr-nav-articles');
  if (!list) { list = document.createElement('div'); list.className = 'lr-nav-articles'; nav.appendChild(list); }
  const arts = (vol && vol.articles) || [];
  const listHtml = () => arts.map(a =>
    `<button class="lr-nav-art${a.id === state.lrArticleId ? ' active' : ''}" data-id="${a.id}">${escapeHtml(a.title)}</button>`).join('')
    || '<div class="empty-hint">无匹配篇目</div>';
  list.innerHTML = `
    <div class="nav-search"><input type="text" placeholder="搜索全部篇目…" autocomplete="off" value="${escapeHtml(state.lrArtFilter || '')}"></div>
    <div class="lr-art-items"></div>`;
  const inp = list.querySelector('input');
  const items = list.querySelector('.lr-art-items');
  const bindList = () => {
    items.querySelectorAll('.lr-nav-art').forEach(btn => {
      btn.addEventListener('click', () => selectLrArticle(+btn.dataset.id));
    });
    const act = items.querySelector('.lr-nav-art.active');
    if (act) act.scrollIntoView({ block: 'center' });
  };
  const bindResults = () => {
    items.querySelectorAll('.lr-nav-art').forEach(btn => {
      btn.addEventListener('click', () => openLrArticle(+btn.dataset.bk, { id: +btn.dataset.id }));
    });
  };
  let seq = 0;
  const renderBody = async () => {
    const my = ++seq;
    const q = (state.lrArtFilter || '').trim();
    if (!q) { items.innerHTML = listHtml(); bindList(); return; }
    items.innerHTML = '<div class="empty-hint">搜索中…</div>';
    const idx = await ensureLrTitleIndex();
    if (my !== seq) return;   // 输入已变化，丢弃过期结果
    if (!idx) { items.innerHTML = '<div class="empty-hint">搜索索引加载失败</div>'; return; }
    const res = idx.flat.filter(t => t.title.includes(q) || String(t.id).includes(q)).slice(0, 50);
    items.innerHTML = res.length ? res.map(t =>
      `<button class="lr-nav-art${t.book === state.lrBookIndex && t.id === state.lrArticleId ? ' active' : ''}" data-bk="${t.book}" data-id="${t.id}">
        <span class="nav-result-loc">${escapeHtml(t.volName)}</span>${escapeHtml(t.title)}</button>`).join('')
      : '<div class="empty-hint">无匹配篇目</div>';
    bindResults();
  };
  inp.addEventListener('input', () => { state.lrArtFilter = inp.value; renderBody(); });
  await renderBody();
}

// 右栏：纲目 | 笔记（state.lrSideTab）
function renderLrSide() {
  const side = $('lrSide');
  side.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'lr-side-tabs';
  [['outline', '纲目'], ['notes', '笔记']].forEach(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'lr-side-tab' + (state.lrSideTab === v ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { state.lrSideTab = v; renderLrSide(); });
    tabs.appendChild(b);
  });
  const body = document.createElement('div');
  body.className = 'lr-side-body';
  if (state.lrSideTab === 'outline') renderLrOutline(body);
  else renderLrNotes(body);
  side.appendChild(tabs);
  side.appendChild(body);
}

// 右栏纲目：extractLrHeadings 生成 toc，点击滚动定位 + 正文滚动高亮
function renderLrOutline(body) {
  if (_lrSpy) { $('textCol').removeEventListener('scroll', _lrSpy); _lrSpy = null; }
  const vol = state.lrVolumes[state.lrBookIndex];
  const art = vol && vol.articles.find(a => a.id === state.lrArticleId);
  if (!art) { body.innerHTML = '<div class="empty-hint">本篇无纲目</div>'; return; }
  const headings = extractLrHeadings(art.content || '');
  if (!headings.length) { body.innerHTML = '<div class="empty-hint">本篇无纲目</div>'; return; }
  const outline = document.createElement('div');
  outline.className = 'lr-outline';
  const group = document.createElement('div');
  group.className = 'lr-outline-group';
  headings.forEach((h, i) => {
    const item = document.createElement('div');
    item.className = `lr-toc-item lr-toc-l${h.level}`;
    item.dataset.target = `lrh-${art.id}-${i}`;
    item.textContent = h.text;
    item.addEventListener('click', () => {
      const el = document.getElementById(item.dataset.target);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setLrOutlineActive(outline, item.dataset.target);
    });
    group.appendChild(item);
  });
  outline.appendChild(group);
  body.appendChild(outline);
  _lrSpy = bindLrOutlineSpy($('textCol'), outline);
}

// 右栏笔记：篇级笔记 textarea + 本篇标注汇总
function renderLrNotes(body) {
  const key = `${state.lrBookIndex}:${state.lrArticleId}`;
  const ta = document.createElement('textarea');
  ta.className = 'lr-note-ta';
  ta.placeholder = '写点本篇的领受…';
  ta.value = state.lrNotes[key] || '';
  ta.addEventListener('input', () => {
    state.lrNotes[key] = ta.value;
    save(LS_LR_NOTES, state.lrNotes);
  });
  body.appendChild(ta);
  const anns = state.annotations.filter(a =>
    a.type === 'lr' && a.book === state.lrBookIndex && a.articleId === state.lrArticleId);
  body.appendChild(renderHighlights(anns, undefined, { hideGroupHeader: true, hideItemLoc: true }));
}

// 同卷切篇：重渲染主区 + 右栏 + crumb + 左栏 active，正文滚顶
async function selectLrArticle(articleId) {
  state.lrArticleId = articleId;
  save(LS_LR_LAST, { book: state.lrBookIndex, articleId });
  document.querySelectorAll('.lr-nav-art').forEach(x => x.classList.toggle('active', +x.dataset.id === articleId));
  const actArt = document.querySelector('.lr-nav-art.active');
  if (actArt) actArt.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const mod = READER_MODULES.lifereading;
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 切卷 → 该卷第一篇
async function selectLrVolume(bookIndex) {
  state.lrBookIndex = bookIndex;
  const vol = await ensureLrVolume(bookIndex);
  if (!vol) { showToast('该卷生命读经数据缺失'); return; }
  state.lrArticleId = (vol.articles[0] || {}).id;
  save(LS_LR_LAST, { book: bookIndex, articleId: state.lrArticleId });
  const mod = READER_MODULES.lifereading;
  await mod.renderNav();
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 统一入口（首页搜索 / crumb 篇目 / 全局笔记 / 合集块）：模块内切篇，模块外进模块
async function openLrArticle(bookIndex, art) {
  if (state.activeModule === 'lifereading' && state.screen === 'work') {
    if (bookIndex !== state.lrBookIndex) await selectLrVolume(bookIndex);
    if (state.lrArticleId !== art.id) await selectLrArticle(art.id);
  } else {
    // 模块外进入，含「同模块但停在首页」：enterModule 同模块幂等不重渲染，需补切到目标篇目，
    // 否则内容在隐藏层更新、界面停在首页（无可见反应）
    const sameModule = state.activeModule === 'lifereading';
    await enterModule('lifereading', { bookIndex, articleId: art.id });
    if (sameModule) {
      if (bookIndex !== state.lrBookIndex) await selectLrVolume(bookIndex);
      if (state.lrArticleId !== art.id) await selectLrArticle(art.id);
    }
  }
}

/* ============ 书报阅读器模块（多系列：倪柝声文集，后续系列同构扩展） ============ */
async function ensureBookSeriesIndex() {
  if (state.bookSeriesIndex) return state.bookSeriesIndex;
  try { state.bookSeriesIndex = await fetchJSON('data/books/index.json'); return state.bookSeriesIndex; }
  catch (e) { state.bookSeriesIndex = { series: [] }; return state.bookSeriesIndex; }
}
async function ensureBookMeta() {
  if (state.bookMeta) return state.bookMeta;
  try { state.bookMeta = await fetchJSON(`data/books/${state.bookSeries}.json`); return state.bookMeta; }
  catch (e) { return null; }
}
async function ensureBookVolume(volume) {
  const key = state.bookSeries;
  const vols = (state.bookVolumes[key] = state.bookVolumes[key] || {});
  if (vols[volume]) return vols[volume];
  showLoadingHint($('bookMain'), '书报加载中…');
  try { const data = await fetchJSON(`data/books/${key}-${volume}.json`); vols[volume] = data; return data; }
  catch (e) {
    showLoadingError($('bookMain'), '书报加载失败', () => {
      ensureBookVolume(volume).then(() => {
        if (state.activeModule === 'books') READER_MODULES.books.renderMain();
      });
    });
    return null;
  }
}

// 左栏书列表 + 模块级搜索：空查询=当前辑列表；非空=全辑书名+章标题检索
// （bookMeta 已含全部章标题，零额外请求）；结果点击 openBookResult 跨辑跳转
function renderBookNavBooks() {
  const nav = $('bookNav');
  let list = nav.querySelector('.bk-nav-books');
  if (!list) { list = document.createElement('div'); list.className = 'bk-nav-books'; nav.appendChild(list); }
  const metaVol = state.bookMeta && state.bookMeta.volumes[state.bookVolume - 1];
  const books = (metaVol && metaVol.books) || [];
  const listHtml = () => books.map((b, i) =>
    `<button class="bk-nav-book${i === state.bookBook ? ' active' : ''}" data-b="${i}">
       <span class="bkb-title">${escapeHtml(b.title)}</span>
       <span class="bkb-count">${b.chapters.length}章</span>
     </button>`).join('') || '<div class="empty-hint">无匹配书卷</div>';
  const searchAll = (q) => {
    const res = [];
    ((state.bookMeta && state.bookMeta.volumes) || []).forEach((v, vi) => {
      (v.books || []).forEach((b, bi) => {
        if (b.title.includes(q)) res.push({ v: vi + 1, b: bi, c: 0, label: b.title });
        (b.chapters || []).forEach((ct, ci) => {
          if (String(ct).includes(q)) res.push({ v: vi + 1, b: bi, c: ci, label: `${b.title} · 第${ci + 1}章 ${ct}` });
        });
      });
    });
    return res.slice(0, 50);
  };
  list.innerHTML = `
    <div class="nav-search"><input type="text" placeholder="搜索全部书卷/章节…" autocomplete="off" value="${escapeHtml(state.bkBookFilter || '')}"></div>
    <div class="bk-book-items"></div>`;
  const inp = list.querySelector('input');
  const items = list.querySelector('.bk-book-items');
  const bindBookButtons = () => {
    items.querySelectorAll('.bk-nav-book').forEach(btn => {
      btn.addEventListener('click', () => selectBookItem(+btn.dataset.b));
    });
    const act = items.querySelector('.bk-nav-book.active');
    if (act) act.scrollIntoView({ block: 'center' });
  };
  const bindResults = () => {
    items.querySelectorAll('.bk-nav-book').forEach(btn => {
      btn.addEventListener('click', () => openBookResult(+btn.dataset.v, +btn.dataset.b, +btn.dataset.c));
    });
  };
  const renderBody = () => {
    const q = (state.bkBookFilter || '').trim();
    if (!q) { items.innerHTML = listHtml(); bindBookButtons(); return; }
    const res = searchAll(q);
    items.innerHTML = res.length ? res.map(r =>
      `<button class="bk-nav-book${r.v === state.bookVolume && r.b === state.bookBook ? ' active' : ''}" data-v="${r.v}" data-b="${r.b}" data-c="${r.c}">
        <span class="bkb-title">${escapeHtml(r.label)}</span></button>`).join('')
      : '<div class="empty-hint">无匹配书卷</div>';
    bindResults();
  };
  inp.addEventListener('input', () => { state.bkBookFilter = inp.value; renderBody(); });
  renderBody();
}

// 选书弹窗（crumb 点击 / 移动端 ☰ 共用）：辑 Tab + 书列表 + 章网格三级
// （反馈 #14：书报原只有辑/书两级，移动端右栏抽屉延后导致无法选章）
async function openBookPicker() {
  await ensureBookMeta();
  const vols = (state.bookMeta && state.bookMeta.volumes) || [];
  let curV = state.bookVolume;
  let curB = curV === state.bookVolume ? state.bookBook : 0;   // 当前选中书（弹窗内）
  openPopup('书报 · 选书选章', `
    ${vols.length > 1 ? `<div class="chp-books" id="bkpVols">
      ${vols.map((v, i) => `<button class="chp-book${i + 1 === curV ? ' active' : ''}" data-v="${i + 1}">${escapeHtml(v.title)}</button>`).join('')}
    </div>` : ''}
    <div class="bk-picker-list" id="bkpBooks"></div>
    <div class="bk-picker-chapters" id="bkpChapters"></div>`);
  const tabs = $('bkpVols');
  const listEl = $('bkpBooks');
  const gridEl = $('bkpChapters');
  const renderChapters = (v, b) => {
    const metaVol = vols[v];
    const book = metaVol && metaVol.books[b];
    if (!book) { gridEl.innerHTML = ''; return; }
    let html = `<div class="chp-title">${escapeHtml(book.title)} · 选择章</div><div class="chp-grid">`;
    (book.chapters || []).forEach((t, ci) => {
      const act = (v + 1 === state.bookVolume && b === state.bookBook && ci === state.bookChapter) ? ' active' : '';
      html += `<button class="chp-cell${act}" data-v="${v + 1}" data-b="${b}" data-c="${ci}">${ci + 1}</button>`;
    });
    html += '</div>';
    gridEl.innerHTML = html;
  };
  const renderBooks = () => {
    const metaVol = vols[curV - 1];
    listEl.innerHTML = ((metaVol && metaVol.books) || []).map((b, i) =>
      `<button class="bk-nav-book${i === curB ? ' active' : ''}" data-b="${i}">
         <span class="bkb-title">${escapeHtml(b.title)}</span>
         <span class="bkb-count">${b.chapters.length}章</span>
       </button>`).join('');
    const act = listEl.querySelector('.bk-nav-book.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
    renderChapters(curV - 1, curB);
  };
  renderBooks();
  if (tabs) {
    polishVolStrip(tabs);
    tabs.addEventListener('click', async (e) => {
      const b = e.target.closest('.chp-book');
      if (!b || +b.dataset.v === curV) return;
      curV = +b.dataset.v;
      curB = curV === state.bookVolume ? state.bookBook : 0;
      tabs.querySelectorAll('.chp-book').forEach(x => x.classList.toggle('active', +x.dataset.v === curV));
      b.scrollIntoView({ block: 'nearest', inline: 'center' });
      renderBooks();
    });
  }
  // 点书：桌面=直接打开该书（保持原交互，章级切换走右栏章列表/此处网格）；
  // 移动端（反馈 #14，右栏抽屉延后）=选中并展示其章网格，点章才打开
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.bk-nav-book');
    if (!btn) return;
    const book = +btn.dataset.b;
    if (!isMobile()) {
      closePopupAll();
      if (curV !== state.bookVolume) await selectBookVolume(curV);
      if (book !== state.bookBook) await selectBookItem(book);
      return;
    }
    curB = book;
    listEl.querySelectorAll('.bk-nav-book').forEach(x => x.classList.toggle('active', +x.dataset.b === curB));
    renderChapters(curV - 1, curB);
  });
  gridEl.addEventListener('click', (e) => {
    const c = e.target.closest('.chp-cell');
    if (!c) return;
    closePopupAll();
    openBookChapter(+c.dataset.v, +c.dataset.b, +c.dataset.c);
  });
}

// 主区：当前章正文（按行 data-base 渲染，标注坐标系 = chapter.content）
// 正文内容渲染：跳过正文头部与 .bk-title 重复的章标题行、与 crumb 重复的书名行
// （源 md 首部常带「书名 + 章名」两行，章名与 ch.title 相同会与 .bk-title 重复渲染；
// 偏移照常累计，标注坐标系不变）
function renderBookContent(parent, content, annotations, chapterTitle, bookTitle) {
  const lines = (content || '').split('\n');
  const norm = (s) => (s || '').replace(/[\s\u3000]/g, '');
  const skipTitles = new Set([norm(chapterTitle), norm(bookTitle)]);
  let leading = true;
  let offset = 0;
  for (const line of lines) {
    if (line.trim() === '') { offset += line.length + 1; continue; }
    if (leading && skipTitles.has(norm(line))) { offset += line.length + 1; continue; }
    leading = false;
    const div = document.createElement('div');
    const heading = detectLrHeading(line);
    div.className = heading ? `bk-head lr-h${heading.level}` : 'bk-para';
    div.dataset.base = offset;
    renderLrLine(div, line, offset, annotations);   // 复用：ref-link 引用高亮 + 标注叠加
    parent.appendChild(div);
    offset += line.length + 1;
  }
}

async function renderBookMain() {
  const vol = await ensureBookVolume(state.bookVolume);
  const book = vol && vol.books[state.bookBook];
  const ch = book && book.chapters[state.bookChapter];
  if (!ch) return;
  const anns = state.annotations.filter(a =>
    a.type === 'book' && a.series === state.bookSeries && a.volume === state.bookVolume &&
    a.book === state.bookBook && a.chapter === state.bookChapter);
  if (healAnnotations(anns, ch.content || '')) save(LS_ANNOTATIONS, state.annotations);
  const main = $('bookMain');
  main.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'bk-title';
  h.textContent = ch.title;
  main.appendChild(h);
  const content = document.createElement('div');
  content.className = 'book-content';
  content.dataset.series = state.bookSeries;
  content.dataset.volume = state.bookVolume;
  content.dataset.book = state.bookBook;
  content.dataset.chapter = state.bookChapter;
  renderBookContent(content, ch.content || '', anns, ch.title, book.title);
  main.appendChild(content);
}

// 右栏：章列表 | 笔记
function renderBookSide() {
  const side = $('bookSide');
  side.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'lr-side-tabs';
  [['toc', '章列表'], ['notes', '笔记']].forEach(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'lr-side-tab' + (state.bookSideTab === v ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { state.bookSideTab = v; renderBookSide(); });
    tabs.appendChild(b);
  });
  const body = document.createElement('div');
  body.className = 'lr-side-body';
  if (state.bookSideTab === 'toc') renderBookToc(body);
  else renderBookNotes(body);
  side.appendChild(tabs);
  side.appendChild(body);
}

// 右栏章列表：当前书全部章，点击切章
function renderBookToc(body) {
  const vol = state.bookVolumes[state.bookSeries] && state.bookVolumes[state.bookSeries][state.bookVolume];
  const book = vol && vol.books[state.bookBook];
  const chapters = (book && book.chapters) || [];
  if (!chapters.length) { body.innerHTML = '<div class="empty-hint">本书无章节</div>'; return; }
  chapters.forEach((ch, i) => {
    const item = document.createElement('button');
    item.className = 'bk-toc-item' + (i === state.bookChapter ? ' active' : '');
    item.textContent = ch.title;
    item.addEventListener('click', () => selectBookChapter(state.bookVolume, state.bookBook, i));
    body.appendChild(item);
  });
}

// 右栏笔记：章级笔记 + 本章标注汇总
function renderBookNotes(body) {
  const key = `${state.bookVolume}:${state.bookBook}:${state.bookChapter}`;
  const ta = document.createElement('textarea');
  ta.className = 'lr-note-ta';
  ta.placeholder = '写点本章的领受…';
  ta.value = state.bookNotes[key] || '';
  ta.addEventListener('input', () => {
    state.bookNotes[key] = ta.value;
    save(LS_BOOK_NOTES, state.bookNotes);
  });
  body.appendChild(ta);
  const anns = state.annotations.filter(a =>
    a.type === 'book' && a.series === state.bookSeries && a.volume === state.bookVolume &&
    a.book === state.bookBook && a.chapter === state.bookChapter);
  body.appendChild(renderHighlights(anns, undefined, { hideGroupHeader: true, hideItemLoc: true }));
}

// 切系列 → 第 1 辑第 1 本第 1 章（系列条点击）
async function selectBookSeries(series) {
  if (series === state.bookSeries) return;
  state.bookSeries = series;
  state.bookMeta = null;   // 换系列重载元数据
  state.bookVolume = 1;
  state.bookBook = 0;
  state.bookChapter = 0;
  const vol = await ensureBookVolume(1);
  if (!vol) { showToast('该系列数据缺失'); return; }
  save(LS_BOOK_LAST, { series, volume: 1, book: 0, chapter: 0 });
  const mod = READER_MODULES.books;
  await mod.renderNav();
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 选辑 → 第 1 本第 1 章
async function selectBookVolume(volume) {
  state.bookVolume = volume;
  state.bookBook = 0;
  state.bookChapter = 0;
  const vol = await ensureBookVolume(volume);
  if (!vol) { showToast('该辑数据缺失'); return; }
  save(LS_BOOK_LAST, { series: state.bookSeries, volume, book: 0, chapter: 0 });
  const mod = READER_MODULES.books;
  await mod.renderNav();
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 选书 → 第 1 章
async function selectBookItem(book) {
  state.bookBook = book;
  state.bookChapter = 0;
  save(LS_BOOK_LAST, { series: state.bookSeries, volume: state.bookVolume, book, chapter: 0 });
  const mod = READER_MODULES.books;
  document.querySelectorAll('.bk-nav-book').forEach(x => x.classList.toggle('active', +x.dataset.b === book));
  const actBook = document.querySelector('.bk-nav-book.active');
  if (actBook) actBook.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 切章（同书内）
async function selectBookChapter(volume, book, chapter) {
  state.bookVolume = volume; state.bookBook = book; state.bookChapter = chapter;
  save(LS_BOOK_LAST, { series: state.bookSeries, volume, book, chapter });
  document.querySelectorAll('.bk-nav-book').forEach(x => x.classList.toggle('active', +x.dataset.b === book));
  const actBk = document.querySelector('.bk-nav-book.active');
  if (actBk) actBk.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const mod = READER_MODULES.books;
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 搜索结果跨辑跳转：先切辑（selectBookVolume 重渲染左栏），再切书/章
async function openBookResult(v, b, c) {
  if (v !== state.bookVolume) await selectBookVolume(v);
  if (b !== state.bookBook || c !== state.bookChapter) await selectBookChapter(v, b, c);
}

// 统一入口（首页块 / 搜索 / 全局笔记）：模块内切章，模块外进模块
async function openBookChapter(volume, book, chapter, series) {
  if (state.activeModule === 'books' && state.screen === 'work') {
    if (series && series !== state.bookSeries) await selectBookSeries(series);
    if (volume !== state.bookVolume || book !== state.bookBook || chapter !== state.bookChapter) {
      await selectBookChapter(volume, book, chapter);
    }
  } else {
    // 同「同模块但停在首页」场景：enterModule 幂等不重渲染，补切目标章（见 openLrArticle）
    const sameModule = state.activeModule === 'books';
    await enterModule('books', { series, volume, book, chapter });
    if (sameModule) {
      if (series && series !== state.bookSeries) await selectBookSeries(series);
      if (volume !== state.bookVolume || book !== state.bookBook || chapter !== state.bookChapter) {
        await selectBookChapter(volume, book, chapter);
      }
    }
  }
}

/* ============ 晨兴阅读器模块 ============ */
async function ensureMorningIndex() {
  if (state.morningIndex) return state.morningIndex;
  try { state.morningIndex = await fetchJSON('data/morning/index.json'); return state.morningIndex; }
  catch (e) { state.morningIndex = { trainings: [] }; return state.morningIndex; }
}
async function ensureMorningData(periodId) {
  if (state.morningData[periodId]) return state.morningData[periodId];
  showLoadingHint($('morningMain'), '听抄加载中…');
  try { const data = await fetchJSON(`data/morning/${periodId}.json`); state.morningData[periodId] = data; return data; }
  catch (e) {
    showLoadingError($('morningMain'), '听抄加载失败', () => {
      ensureMorningData(periodId).then(() => {
        if (state.activeModule === 'morning') READER_MODULES.morning.renderMain();
      });
    });
    return null;
  }
}

// 左栏篇列表 + 模块级搜索：空查询=当前期列表；非空=全期篇标题检索
// （各期数据 ensureMorningData 懒加载后缓存，期数少体量小）；结果点击 openMorningArticle 跨期跳转
async function renderMorningChapterList() {
  const nav = $('morningNav');
  let list = nav.querySelector('.morning-nav-chapters');
  if (!list) { list = document.createElement('div'); list.className = 'morning-nav-chapters'; nav.appendChild(list); }
  const data = state.morningData[state.morningPeriod];
  const chapters = (data && data.chapters) || [];
  const listHtml = () => chapters.map(c =>
    `<button class="morning-nav-art${c.number === state.morningChapterId ? ' active' : ''}" data-n="${c.number}">${escapeHtml(c.title)}</button>`).join('')
    || '<div class="empty-hint">无匹配篇目</div>';
  const searchAll = async (q) => {
    const res = [];
    const trainings = (state.morningIndex && state.morningIndex.trainings) || [];
    for (const t of trainings) {
      const d = await ensureMorningData(t.id);
      if (!d) continue;
      (d.chapters || []).forEach(c => {
        if (c.title.includes(q) || String(c.number).includes(q)) {
          res.push({ period: t.id, periodTitle: d.title || t.title || t.id, n: c.number, title: c.title });
        }
      });
    }
    return res.slice(0, 50);
  };
  list.innerHTML = `
    <div class="nav-search"><input type="text" placeholder="搜索全部篇目…" autocomplete="off" value="${escapeHtml(state.mrFilter || '')}"></div>
    <div class="mr-art-items"></div>`;
  const inp = list.querySelector('input');
  const items = list.querySelector('.mr-art-items');
  const bindArtButtons = () => {
    items.querySelectorAll('.morning-nav-art').forEach(btn => {
      btn.addEventListener('click', () => selectMorningChapter(+btn.dataset.n));
    });
    const act = items.querySelector('.morning-nav-art.active');
    if (act) act.scrollIntoView({ block: 'center' });
  };
  const bindResults = () => {
    items.querySelectorAll('.morning-nav-art').forEach(btn => {
      btn.addEventListener('click', () => openMorningArticle(btn.dataset.p, +btn.dataset.n));
    });
  };
  let seq = 0;
  const renderBody = async () => {
    const my = ++seq;
    const q = (state.mrFilter || '').trim();
    if (!q) { items.innerHTML = listHtml(); bindArtButtons(); return; }
    items.innerHTML = '<div class="empty-hint">搜索中…</div>';
    const res = await searchAll(q);
    if (my !== seq) return;   // 输入已变化，丢弃过期结果
    items.innerHTML = res.length ? res.map(r =>
      `<button class="morning-nav-art${r.period === state.morningPeriod && r.n === state.morningChapterId ? ' active' : ''}" data-p="${r.period}" data-n="${r.n}">
        <span class="nav-result-loc">${escapeHtml(r.periodTitle)}</span>${escapeHtml(r.title)}</button>`).join('')
      : '<div class="empty-hint">无匹配篇目</div>';
    bindResults();
  };
  inp.addEventListener('input', () => { state.mrFilter = inp.value; renderBody(); });
  await renderBody();
}

// 主区：当前篇听抄（信息正文层级标题 + 段落），content 逐行 data-base 渲染供标注
function renderMorningMain() {
  const data = state.morningData[state.morningPeriod];
  const ch = data && data.chapters.find(c => c.number === state.morningChapterId);
  if (!ch) return;
  const anns = state.annotations.filter(a =>
    a.type === 'morning' && a.period === state.morningPeriod && a.chapterId === ch.number);
  if (healAnnotations(anns, ch.content || '')) save(LS_ANNOTATIONS, state.annotations);
  const main = $('morningMain');
  main.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'morning-title';
  title.textContent = ch.title;
  main.appendChild(title);
  if (ch.scripture) {
    const sc = document.createElement('div');
    sc.className = 'morning-scripture';
    sc.textContent = '经文：' + ch.scripture;
    main.appendChild(sc);
  }
  const content = document.createElement('div');
  content.className = 'morning-content';
  content.dataset.period = state.morningPeriod;
  content.dataset.chapter = ch.number;
  // 逐行渲染：听抄层级标题（壹/一/1/（一）等，detectLrHeading 识别）加粗，段落普通
  const lines = (ch.content || '').split('\n');
  let offset = 0;
  for (const line of lines) {
    if (line.trim() === '') { offset += line.length + 1; continue; }
    const div = document.createElement('div');
    const heading = detectLrHeading(line);
    if (heading) {
      div.className = `morning-head lr-h${heading.level}`;
    } else {
      div.className = 'morning-para';
    }
    div.dataset.base = offset;
    renderLrLine(div, line, offset, anns);
    content.appendChild(div);
    offset += line.length + 1;
  }
  main.appendChild(content);
}

// 右栏：篇级笔记 + 标注汇总
function renderMorningSide() {
  const side = $('morningSide');
  side.innerHTML = '';
  const body = document.createElement('div');
  body.className = 'lr-side-body';
  const key = `${state.morningPeriod}:${state.morningChapterId}`;
  const ta = document.createElement('textarea');
  ta.className = 'lr-note-ta';
  ta.placeholder = '写点本篇的领受…';
  ta.value = state.morningNotes[key] || '';
  ta.addEventListener('input', () => {
    state.morningNotes[key] = ta.value;
    save(LS_MORNING_NOTES, state.morningNotes);
  });
  body.appendChild(ta);
  const anns = state.annotations.filter(a =>
    a.type === 'morning' && a.period === state.morningPeriod && a.chapterId === state.morningChapterId);
  body.appendChild(renderHighlights(anns, undefined, { hideGroupHeader: true, hideItemLoc: true }));
  side.appendChild(body);
}

// 同期切篇
async function selectMorningChapter(chapterId) {
  state.morningChapterId = chapterId;
  save(LS_MORNING_LAST, { period: state.morningPeriod, chapterId });
  document.querySelectorAll('.morning-nav-art').forEach(x => x.classList.toggle('active', +x.dataset.n === chapterId));
  const actArt = document.querySelector('.morning-nav-art.active');
  if (actArt) actArt.scrollIntoView({ block: 'center', behavior: 'smooth' });
  READER_MODULES.morning.renderMain();
  renderMorningSide();
  READER_MODULES.morning.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 切期 → 该期第 1 篇
async function selectMorningPeriod(periodId) {
  state.morningPeriod = periodId;
  state.morningChapterId = 1;
  const data = await ensureMorningData(periodId);
  if (!data) { showToast('该期数据缺失'); return; }
  save(LS_MORNING_LAST, { period: periodId, chapterId: 1 });
  const mod = READER_MODULES.morning;
  await mod.renderNav();
  mod.renderMain();
  renderMorningSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 统一入口（首页块 / 搜索 / 全局笔记）：模块内切篇，模块外进模块
async function openMorningArticle(periodId, chapterId) {
  if (state.activeModule === 'morning' && state.screen === 'work') {
    if (periodId !== state.morningPeriod) await selectMorningPeriod(periodId);
    if (state.morningChapterId !== chapterId) await selectMorningChapter(chapterId);
  } else {
    // 同「同模块但停在首页」场景：enterModule 幂等不重渲染，补切目标篇（见 openLrArticle）
    const sameModule = state.activeModule === 'morning';
    await enterModule('morning', { period: periodId, chapterId });
    if (sameModule) {
      if (periodId !== state.morningPeriod) await selectMorningPeriod(periodId);
      if (state.morningChapterId !== chapterId) await selectMorningChapter(chapterId);
    }
  }
}

// 篇目选择弹窗（crumb 点击 / 移动端 ☰ 共用）：顶部期 Tab + 下方当前期篇列表，两级快速跨期切换
async function openMorningArticleList() {
  const trainings = (state.morningIndex && state.morningIndex.trainings) || [];
  let cur = state.morningPeriod;
  openPopup('听抄 · 选择篇目', `
    <div class="chp-books" id="mrpPeriods">
      ${trainings.map(t => `<button class="chp-book${t.id === cur ? ' active' : ''}" data-p="${t.id}">${escapeHtml(t.title || t.season || t.id)}</button>`).join('')}
    </div>
    <div class="lr-art-list" id="mrpArts"></div>`);
  const tabs = $('mrpPeriods');
  const listEl = $('mrpArts');
  const renderArts = async () => {
    const data = await ensureMorningData(cur);
    if (!data) { listEl.innerHTML = '<div class="empty-hint">该期数据缺失</div>'; return; }
    listEl.innerHTML = data.chapters.map(c =>
      `<button class="lr-art-cell${cur === state.morningPeriod && c.number === state.morningChapterId ? ' active' : ''}" data-n="${c.number}">${escapeHtml(c.title)}</button>`).join('');
    const act = listEl.querySelector('.lr-art-cell.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  };
  await renderArts();
  polishVolStrip(tabs);
  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('.chp-book');
    if (!b || b.dataset.p === cur) return;
    cur = b.dataset.p;
    tabs.querySelectorAll('.chp-book').forEach(x => x.classList.toggle('active', x.dataset.p === cur));
    b.scrollIntoView({ block: 'nearest', inline: 'center' });
    await renderArts();
  });
  listEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.lr-art-cell');
    if (!cell) return;
    closePopupAll();
    openMorningArticle(cur, +cell.dataset.n);
  });
}

/* ============ 标注 ============ */
let pendingRange = null;
let editingAnnId = null;

function bindEvents() {  // 首页：合集块点击 + 顶部搜索 + ⌂ 回首页
  bindHomeEvents();
  bindReadingProgress();
  // 隐藏/显示注号
  $('hideMarksBtn').addEventListener('click', () => {
    state.hideMarks = !state.hideMarks;
    applyHideMarks();
    save(LS_HIDE_MARKS, state.hideMarks);
  });
  // 菜单：桌面=折叠当前模块左栏；移动端上下文导航（读经=书卷抽屉 / 研读+生命读经=篇目纲目）
  $('menuBtn').addEventListener('click', () => {
    if (state.screen === 'home') return;   // 首页隐藏 ☰（CSS 双保险）
    if (window.innerWidth > 900) {
      const mod = READER_MODULES[state.activeModule];
      if (mod && mod.onMenu) mod.onMenu();
      return;
    }
    // 移动端按模块分发：阅读器模块 ☰ → 层级选择弹窗（卷/辑/期 Tab + 篇目）
    if (state.activeModule === 'lifereading') { openLrArticleList(state.lrBookIndex); return; }
    if (state.activeModule === 'books') { openBookPicker(); return; }
    if (state.activeModule === 'morning') { openMorningArticleList(); return; }
    if (state.activeModule === 'notes') return;
    if (document.body.classList.contains('mobile-study')) {
      // 研读视图：只有生命读经 tab 提供导航，注解/我的笔记 tab 不动作
      if (state.activeTab === 'lifereading') openLrNavSheet();
      return;
    }
    $('navCol').classList.toggle('open');
  });
  // crumb 标题点击：按模块分发导航（读经=章节选择 / 生命读经=篇目列表）
  document.querySelector('.crumb').addEventListener('click', (e) => {
    if (state.screen === 'home') return;
    if (e.target.closest('button')) return;   // 不拦截 crumb 内按钮（翻页按钮）
    const mod = READER_MODULES[state.activeModule];
    if (mod && mod.onCrumbClick) mod.onCrumbClick();
  });
  // 视图模式：双页 → 上下 → 全屏 循环
  $('viewModeBtn').addEventListener('click', () => {
    state.studyFull = false;
    const order = ['default', 'stacked', 'full'];
    const i = order.indexOf(state.viewMode);
    state.viewMode = order[(i + 1) % order.length];
    applyLayout();
    save(LS_VIEW_MODE, state.viewMode);
  });
  // 研读面板全屏
  $('studyFullBtn').addEventListener('click', () => {
    state.studyFull = !state.studyFull;
    applyLayout();
    renderStudy(); // 重新渲染，让纲目索引出现/消失
  });
  // 反馈弹窗
  $('feedbackBtn').addEventListener('click', openFeedbackModal);
  // 移动端模式切换 pill（读经/研读，替代原底部导航按钮）
  document.querySelectorAll('#modePill .mode-pill-btn').forEach(b => {
    b.addEventListener('click', () => setMobileView(b.dataset.view));
  });
  // 移动端底部导航：纯翻页（读经翻章 / 生命读经翻篇）
  $('mPrevBtn').addEventListener('click', () => mobileNavGo(-1));
  $('mNextBtn').addEventListener('click', () => mobileNavGo(1));
  // 设置菜单（⚙️）——行点击走委托，弹窗栈返回后依然有效
  $('settingsBtn').addEventListener('click', openSettingsModal);
  document.addEventListener('click', onSettingsRow);
  // 检查更新弹窗
  $('updateCancel').addEventListener('click', closeUpdateModal);
  $('updateAction').addEventListener('click', startUpdateDownload);
  // 研读面板拖拽调宽
  bindResize();
  // 书卷搜索
  $('bookSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    document.querySelectorAll('#bookList .book-item').forEach(el => {
      el.style.display = el.textContent.includes(q) ? '' : 'none';
    });
    document.querySelectorAll('#bookList .group-label').forEach(el => {
      el.style.display = q ? 'none' : '';
    });
  });
  // 研读 tab（常规点击我的笔记 → 当前章聚合模式）
  document.querySelectorAll('.study-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t === tab));
      renderStudy();
    });
  });
  // 选区标注：桌面 mouseup + 移动端 touchend + selectionchange 兜底（防抖）
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('touchend', handleSelection);
  let _selTimer = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    clearTimeout(_selTimer);
    _selTimer = setTimeout(handleSelection, 180);
  });
  document.addEventListener('mousedown', (e) => {
    const tool = $('floatTool');
    if (!tool.hidden && !tool.contains(e.target)) hideFloatTool();
    const mk = $('markTool');
    if (!mk.hidden && !mk.contains(e.target)) hideMarkTool();
  });
  document.addEventListener('touchstart', (e) => {
    const tool = $('floatTool');
    if (!tool.hidden && !tool.contains(e.target)) hideFloatTool();
    const mk = $('markTool');
    if (!mk.hidden && !mk.contains(e.target)) hideMarkTool();
  }, { passive: true });
  // 滚动/键盘关闭菜单（移植晨读 §9）
  window.addEventListener('scroll', () => { hideFloatTool(); hideMarkTool(); }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideFloatTool(); hideMarkTool(); cancelNoteEditor(); }
  });
  // 笔记编辑器
  $('noteSave').addEventListener('click', saveNoteEditor);
  $('noteCancel').addEventListener('click', cancelNoteEditor);
  $('noteModal').addEventListener('mousedown', (e) => { if (e.target === $('noteModal')) cancelNoteEditor(); });
  // 弹窗关闭
  $('popupBack').addEventListener('click', closePopup);
  $('popupClose').addEventListener('click', closePopup);
  $('overlay').addEventListener('click', closePopupAll);
  // 注脚/串珠点击（事件委托）
  document.addEventListener('click', onContentClick);
}

// 从注号上标定位其所在节的 key（经文区域内上标无 data-key，需自行反推）
function verseKeyFromSup(sup) {
  const vtext = sup.closest('.vtext');
  if (!vtext) return null;
  const verseNum = vtext.dataset.verse.replace(/[上中下]/g, '');
  const half = vtext.dataset.verse.match(/[上中下]/)?.[0] || '';
  return `${state.currentBook.acronym}${state.currentChapter}:${verseNum}${half}`;
}

function onContentClick(e) {
  const fn = e.target.closest('sup.fn-ref');
  if (fn) {
    e.stopPropagation();
    showFootnotePopup(fn.dataset.fn, fn.dataset.key || verseKeyFromSup(fn));
    return;
  }
  const xr = e.target.closest('sup.xref-ref');
  if (xr) {
    e.stopPropagation();
    showXrefPopup(xr.dataset.xref, xr.dataset.key || verseKeyFromSup(xr));
    return;
  }
  const ref = e.target.closest('span.ref-link');
  if (ref) {
    e.stopPropagation();
    showRefsPopup('引用经文', ref.dataset.refs);
    return;
  }
  const mark = e.target.closest('mark[data-ann-id]');
  if (mark) {
    e.stopPropagation();
    showMarkTool(mark, mark.dataset.annId);
    return;
  }
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { hideFloatTool(); return; }
  const range = sel.getRangeAt(0);
  const ctx = findAnnotatable(range.startContainer);
  if (!ctx || !findAnnotatable(range.endContainer) || findAnnotatable(range.endContainer).el !== ctx.el) {
    hideFloatTool(); return;
  }
  const start = plainOffset(ctx.el, range.startContainer, range.startOffset);
  const end = plainOffset(ctx.el, range.endContainer, range.endOffset);
  if (end <= start) { hideFloatTool(); return; }
  // plain 必须与渲染端偏移坐标系一致：
  // 经文用 vtext.dataset.plain（已去除 {N}/[a] 标记），生命读经用源 content（含换行）
  let plain;
  if (ctx.context.type === 'verse') {
    plain = ctx.el.dataset.plain;
  } else if (ctx.context.type === 'lr') {
    // 模块感知：优先按标注所属卷（data-book）查缓存，独立阅读器模块与研读列都能取到源文本
    const bookIdx = ctx.context.book !== undefined ? ctx.context.book : state.currentBook.index;
    const vol = state.lrVolumes[bookIdx] || state.lifereading;
    const art = ((vol || {}).articles || []).find(a => a.id === ctx.context.articleId);
    plain = art ? (art.content || '') : ctx.el.textContent;
  } else if (ctx.context.type === 'book') {
    const vols = state.bookVolumes[ctx.context.series] || {};
    const vol = vols[ctx.context.volume];
    const book = vol && vol.books[ctx.context.book];
    const ch = book && book.chapters[ctx.context.chapter];
    plain = ch ? (ch.content || '') : ctx.el.textContent;
  } else if (ctx.context.type === 'morning') {
    const data = state.morningData[ctx.context.period];
    const ch = data && data.chapters.find(c => c.number === ctx.context.chapterId);
    plain = ch ? (ch.content || '') : ctx.el.textContent;
  }
  // 文本快照 + 上下文（TextQuoteSelector 自愈锚点）：快照取自 plain 而非 range.toString()，
  // 保证与渲染切片坐标系严格一致（跨注脚上标的选区也不会混入标记字符）
  const ctxText = extractContext(plain, start, end);
  pendingRange = {
    start, end, plain,
    text: plain.slice(start, end),
    prefix: ctxText.prefix,
    suffix: ctxText.suffix,
    ...ctx.context,
  };
  showFloatTool(range.getBoundingClientRect());
}

function findAnnotatable(node) {
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el) {
    if (el.classList) {
      if (el.classList.contains('vtext')) {
        return {
          el,
          context: {
            type: 'verse',
            verse: +el.dataset.verse.replace(/[上中下]/g, ''),
            half: el.dataset.verse.match(/[上中下]/)?.[0] || '',
          },
        };
      }
      if (el.classList.contains('lr-content')) {
        // data-article 守卫：排除注解容器（renderFootnotes 误用同 class，无 data-article → 不可标注）
        if (el.dataset.article === undefined) { el = el.parentElement; continue; }
        return {
          el,
          context: {
            type: 'lr',
            articleId: +el.dataset.article,
            book: el.dataset.book !== undefined ? +el.dataset.book : undefined,
          },
        };
      }
      if (el.classList.contains('book-content')) {
        // data-chapter 守卫：无则不可标注（防误识别）
        if (el.dataset.chapter === undefined) { el = el.parentElement; continue; }
        return {
          el,
          context: {
            type: 'book',
            series: el.dataset.series,
            volume: +el.dataset.volume,
            book: +el.dataset.book,
            chapter: +el.dataset.chapter,
          },
        };
      }
      if (el.classList.contains('morning-content')) {
        // data-chapter 守卫：无则不可标注
        if (el.dataset.chapter === undefined) { el = el.parentElement; continue; }
        return {
          el,
          context: { type: 'morning', period: el.dataset.period, chapterId: +el.dataset.chapter },
        };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function plainOffset(root, node, offset) {
  let count = 0, done = false;
  // 行内累加（不含行间换行）
  function walkInner(el) {
    for (const child of el.childNodes) {
      if (done) return;
      if (child === node && child.nodeType === 3) { count += offset; done = true; return; }
      if (child.nodeType === 3) count += child.textContent.length;
      else if (child.nodeType === 1 && child.tagName !== 'SUP') walkInner(child);
    }
  }
  // 生命读经/书报/晨兴：行 div 带 data-base（该行在源 content 的偏移，含空行），
  // 选区偏移 = 行基址 + 行内偏移，与渲染 baseOffset / 自愈 plain 同一坐标系
  if (root.classList.contains('lr-content') || root.classList.contains('book-content') || root.classList.contains('morning-content')) {
    let div = node.nodeType === 3 ? node.parentElement : node;
    while (div && div.parentElement !== root) div = div.parentElement;
    if (div && div.parentElement === root && div.dataset.base !== undefined) {
      const base = +div.dataset.base;
      walkInner(div);
      return done ? base + count : base;
    }
  }
  const isBlock = (el) => el.nodeType === 1 &&
    (el.classList.contains('lr-head') || el.classList.contains('lr-para') ||
     el.classList.contains('bk-para') || el.classList.contains('bk-head') ||
     el.classList.contains('morning-para') || el.classList.contains('morning-head'));
  let first = true;
  for (const child of root.childNodes) {
    if (done) break;
    if (!first && isBlock(child)) count += 1; // 行（div）之间补一个换行，与渲染端 baseOffset 对齐
    first = false;
    if (child === node && child.nodeType === 3) { count += offset; done = true; break; }
    if (child.nodeType === 3) count += child.textContent.length;
    else if (child.nodeType === 1 && child.tagName !== 'SUP') walkInner(child);
  }
  return count;
}

/* ── 标注自愈（TextQuoteSelector，移植自晨读 app highlight.js）──
   保存时记录选中文本快照 + 前后各 25 字上下文；渲染时校验偏移，
   失效则按文本匹配 + 上下文打分重新定位并写回，正文变动后标注不漂移 */
function extractContext(plain, start, end, win) {
  win = win || 25;
  return {
    prefix: plain.slice(Math.max(0, start - win), start),
    suffix: plain.slice(end, Math.min(plain.length, end + win)),
  };
}
// 右对齐比对（prefix：保存的与实际的从右往左比）
function overlapRight(saved, actual) {
  let i = saved.length - 1, j = actual.length - 1, count = 0;
  while (i >= 0 && j >= 0 && saved[i] === actual[j]) { i--; j--; count++; }
  return count;
}
// 左对齐比对（suffix：保存的与实际的从左往右比）
function overlapLeft(saved, actual) {
  let i = 0, count = 0;
  while (i < saved.length && i < actual.length && saved[i] === actual[i]) { i++; count++; }
  return count;
}
// 校验并修复一批标注的偏移（plain 为标注所在内容的纯文本，含换行），返回是否发生修复
function healAnnotations(anns, plain) {
  let changed = false;
  for (const a of anns) {
    if (!a.text) continue; // 旧数据无文本快照，无法自愈
    if (plain.slice(a.start, a.end) === a.text) continue; // 偏移仍正确
    // 偏移失效：收集文本所有出现位置
    const candidates = [];
    let from = 0;
    for (;;) {
      const pos = plain.indexOf(a.text, from);
      if (pos < 0) break;
      candidates.push(pos);
      from = pos + 1;
    }
    if (!candidates.length) continue; // 文本已不存在，放弃
    let bestPos = -1;
    if (a.prefix !== undefined && a.suffix !== undefined) {
      // 优先用 prefix/suffix 打分（TextQuoteSelector）；同分取离原偏移最近
      let bestScore = -1;
      for (const pos of candidates) {
        const ce = pos + a.text.length;
        const actualPrefix = plain.slice(Math.max(0, pos - 25), pos);
        const actualSuffix = plain.slice(ce, Math.min(plain.length, ce + 25));
        const score = overlapRight(a.prefix || '', actualPrefix) + overlapLeft(a.suffix || '', actualSuffix);
        if (score > bestScore ||
            (score === bestScore && Math.abs(pos - a.start) < Math.abs(bestPos - a.start))) {
          bestScore = score; bestPos = pos;
        }
      }
    } else {
      // 无上下文字段：退化为离原偏移最近
      let bestDist = Infinity;
      for (const pos of candidates) {
        const dist = Math.abs(pos - a.start);
        if (dist < bestDist) { bestDist = dist; bestPos = pos; }
      }
    }
    a.start = bestPos;
    a.end = bestPos + a.text.length;
    const ctx = extractContext(plain, a.start, a.end);
    a.prefix = ctx.prefix;
    a.suffix = ctx.suffix;
    changed = true;
  }
  return changed;
}

// 工具栏按钮按下：桌面 mousedown + 移动端 touchstart（都 preventDefault 防选区塌掉）
function bindPress(el, fn) {
  el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
  el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
}

/* 菜单定位（移植晨读 §9.2/9.3/9.4）：
   fixed 定位；先移出视口再显示（防 Android 首帧定位到文档末尾导致页面滚到底）；
   用 visualViewport（软键盘弹出时 innerHeight 不准）；优先放选区下方避开系统复制菜单，
   空间不足放上方并跳过系统菜单区域（GAP_BELOW=88 / GAP_ABOVE=78）；边缘 clamp */
function positionMenuByRect(menu, rect) {
  menu.style.position = 'fixed';
  menu.style.transform = 'none';
  menu.style.top = '-9999px';
  menu.style.left = '-9999px';
  menu.style.display = '';   // 显示由 CSS + hidden 属性控制，不写内联 display（否则会压过 [hidden]）
  menu.style.opacity = '0';
  requestAnimationFrame(() => {
    const vvp = window.visualViewport;
    const vpH = vvp ? vvp.height : window.innerHeight;
    const vpW = vvp ? vvp.width : window.innerWidth;
    const GAP_BELOW = 88, GAP_ABOVE = 78;
    const belowAvail = vpH - rect.bottom - GAP_BELOW;
    const aboveAvail = rect.top - GAP_ABOVE;
    let viewTop;
    if (belowAvail >= menu.offsetHeight || belowAvail >= aboveAvail) {
      viewTop = rect.bottom + GAP_BELOW;
    } else {
      viewTop = rect.top - menu.offsetHeight - GAP_ABOVE;
    }
    viewTop = Math.max(GAP_BELOW, Math.min(viewTop, vpH - menu.offsetHeight - 10));
    const left = rect.left + rect.width / 2 - menu.offsetWidth / 2;
    menu.style.left = Math.max(10, Math.min(left, vpW - menu.offsetWidth - 10)) + 'px';
    menu.style.top = viewTop + 'px';
    menu.style.opacity = '1';
  });
}

// 页面滚动锁（弹框/编辑器打开时防穿透），计数式支持嵌套
let _scrollLockCount = 0;
function lockScroll(on) {
  _scrollLockCount = Math.max(0, _scrollLockCount + (on ? 1 : -1));
  document.body.classList.toggle('scroll-locked', _scrollLockCount > 0);
}

function showFloatTool(rect) {
  const tool = $('floatTool');
  tool.hidden = false;
  tool.innerHTML = '';
  // 5 色
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = `sw ${c.id}`;
    sw.title = `${c.name}：${c.desc}`;
    bindPress(sw, () => applyColor(c.id));
    tool.appendChild(sw);
  });
  const sep = document.createElement('div');
  sep.className = 'tool-sep';
  tool.appendChild(sep);
  // 下划线
  const ul = document.createElement('button');
  ul.className = 'tool-btn';
  ul.textContent = '下划线';
  bindPress(ul, applyUnderline);
  tool.appendChild(ul);
  // 笔记
  const nb = document.createElement('button');
  nb.className = 'tool-btn';
  nb.textContent = '加笔记';
  bindPress(nb, addNote);
  tool.appendChild(nb);
  const sep2 = document.createElement('div');
  sep2.className = 'tool-sep';
  tool.appendChild(sep2);
  // 引用到笔记
  const qt = document.createElement('button');
  qt.className = 'tool-btn';
  qt.textContent = '引用到笔记';
  qt.title = '把选中文字（带出处）追加到本章笔记';
  bindPress(qt, quoteToNotes);
  tool.appendChild(qt);
  // 复制纯文本（自动过滤注号）
  const cp = document.createElement('button');
  cp.className = 'tool-btn';
  cp.textContent = '复制';
  cp.title = '复制纯文本（不含注号）';
  bindPress(cp, copyPlainText);
  tool.appendChild(cp);
  positionMenuByRect(tool, rect);
}

function selectedPlainText() {
  const r = pendingRange;
  if (!r) return '';
  return (r.plain || '').slice(r.start, r.end);
}

function selectedCitation() {
  const r = pendingRange;
  if (!r) return '';
  return r.type === 'verse'
    ? `${state.currentBook.acronym}${state.currentChapter}:${r.verse}${r.half || ''}`
    : `生命读经 第${r.articleId}篇`;
}

function copyPlainText() {
  const text = selectedPlainText();
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
  hideFloatTool();
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}

function quoteToNotes() {
  const text = selectedPlainText();
  if (!text) return;
  const key = `${state.currentBook.index}:${state.currentChapter}`;
  const citation = selectedCitation();
  const line = `「${text}」（${citation}）`;
  const prev = state.chapterNotes[key] || '';
  state.chapterNotes[key] = prev ? prev + '\n' + line : line;
  save(LS_CHAPTER_NOTES, state.chapterNotes);
  // 切到我的笔记并刷新
  state.activeTab = 'mynotes';
  document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
  renderStudy();
  hideFloatTool();
}

function hideFloatTool() {
  const t = $('floatTool');
  t.hidden = true;
  t.style.removeProperty('display');
  t.style.removeProperty('opacity');
  pendingRange = null; editingAnnId = null;
}

// 从选区构造标注记录（不依赖全局 pendingRange，供编辑器在菜单关闭后创建）
function buildAnnotation(r, partial) {
  let loc = {};
  if (r.type === 'verse') {
    loc = { chapter: state.currentChapter, verse: r.verse, half: r.half };
  } else if (r.type === 'lr') {
    loc = { articleId: r.articleId };
  } else if (r.type === 'book') {
    loc = { series: r.series, volume: r.volume, book: r.book, chapter: r.chapter };
  } else if (r.type === 'morning') {
    loc = { period: r.period, chapterId: r.chapterId };
  }
  return {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    // verse：读经模块内书卷恒为当前书卷；lr：必须取选区所属卷（data-book），
    // 生命读经模块浏览的卷 ≠ state.currentBook（读经模块遗留位置），不能用 currentBook.index
    book: r.type === 'verse' ? state.currentBook.index : (r.type === 'lr' ? r.book : (r.volume || 0)),
    type: r.type,
    start: r.start,
    end: r.end,
    createdAt: Date.now(),
    // TextQuoteSelector 自愈锚点：文本快照 + 前后上下文
    text: r.text || '',
    prefix: r.prefix || '',
    suffix: r.suffix || '',
    ...loc,
    ...partial,
  };
}

function addAnnotation(partial) {
  const r = pendingRange;
  if (!r) return;
  const ann = buildAnnotation(r, partial);
  state.annotations.push(ann);
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
  hideFloatTool();
}

function applyColor(colorId) { addAnnotation({ colorId, underline: false }); }
function applyUnderline() { addAnnotation({ underline: true, colorId: null }); }

/* 标注变更后的定向重渲染（保留滚动位置） */
function rerenderAnn(ann) {
  // 笔记管理模块内：刷新模块三视图即可（无需渲染经文主区，防止误 renderChapter）
  if (state.activeModule === 'notes') {
    renderNotesTree();
    renderNotesList();
    renderNotesPanel();
    return;
  }
  if (ann.type === 'verse') {
    withScrollPreserved(['#textCol', '#studyBody', '.lr-full-content'], () => {
      renderChapter();
      if (state.activeTab === 'mynotes') renderStudy();
    });
  } else if (ann.type === 'lr') {
    // 生命读经模块内：重渲染 #lrMain + 右栏（笔记 tab 标注汇总同步刷新）；读经模块研读列：重渲染 studyBody
    withScrollPreserved(['#textCol', '#studyBody', '.lr-full-content'], () => {
      if (state.activeModule === 'lifereading') { READER_MODULES.lifereading.renderMain(); READER_MODULES.lifereading.renderSide(); }
      else renderStudy();
    });
  } else if (ann.type === 'book') {
    // 书报模块内标注：重渲染主区保持高亮 + 右栏标注汇总同步刷新
    withScrollPreserved(['#textCol'], () => {
      if (state.activeModule === 'books') { READER_MODULES.books.renderMain(); READER_MODULES.books.renderSide(); }
    });
  } else if (ann.type === 'morning') {
    withScrollPreserved(['#textCol'], () => {
      if (state.activeModule === 'morning') { READER_MODULES.morning.renderMain(); READER_MODULES.morning.renderSide(); }
    });
  }
}

/* ============ 笔记编辑器（textarea 模态框，移植晨读 §5.3） ============ */
let noteEditorState = null; // {mode:'create', range} | {mode:'edit', annId}

function openNoteEditor(initial, quote) {
  $('noteTextarea').value = initial || '';
  // 原文引用预览（反馈 #13）：写/改笔记时先展示所标注的原文，再在其下写笔记
  const q = $('noteQuote');
  if (q) {
    if (quote) { q.textContent = quote; q.hidden = false; }
    else q.hidden = true;
  }
  $('noteModal').hidden = false;
  lockScroll(true);
  setTimeout(() => $('noteTextarea').focus(), 100);
}
function closeNoteEditor() {
  $('noteModal').hidden = true;
  lockScroll(false);
}
// 选中文字后点「加笔记」：保存选区引用，打开编辑器（保存时才创建标注）
function addNote() {
  const r = pendingRange;
  if (!r) return;
  noteEditorState = { mode: 'create', range: r };
  hideFloatTool();
  openNoteEditor('', r.text || '');   // 原文引用预览 = 选区文本快照
}
// 编辑已有标注的笔记
function editNote(annId) {
  const ann = state.annotations.find(a => a.id === annId);
  noteEditorState = { mode: 'edit', annId };
  hideMarkTool();
  openNoteEditor(ann ? ann.note || '' : '', ann ? (annotationText(ann) || ann.text || '') : '');
}
function saveNoteEditor() {
  const text = $('noteTextarea').value.trim();
  const st = noteEditorState;
  noteEditorState = null;
  closeNoteEditor();
  if (!st) return;
  if (st.mode === 'create') {
    if (!text) return;
    const ann = buildAnnotation(st.range, { note: text, colorId: null, underline: false });
    state.annotations.push(ann);
    save(LS_ANNOTATIONS, state.annotations);
    rerenderAnn(ann);
  } else {
    saveNote(st.annId, text);
  }
}
function cancelNoteEditor() {
  noteEditorState = null;
  closeNoteEditor();
}

/* ============ 标注编辑（改色/笔记/删除，含晨读的分离操作语义） ============ */
function saveNote(annId, text) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  ann.note = text || '';
  // 无背景、无下划线、无笔记内容 → 删除整条（不留不可见空记录）
  if (!ann.note && !ann.colorId && !ann.underline) { deleteAnn(annId); return; }
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
}
function removeNote(annId) { saveNote(annId, ''); }
// 仅删除标记（背景色 + 下划线），保留笔记
function removeMark(annId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  ann.colorId = null;
  ann.underline = false;
  if (!ann.note) { deleteAnn(annId); return; }
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
}
function toggleAnnUnderline(annId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  ann.underline = !ann.underline;
  if (ann.underline) ann.colorId = null; // 与颜色互斥（沿用现状语义）
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
}

/* 标注菜单（点击已有划线，移植晨读 §5.2）：
   笔记预览气泡（4行 clamp + 展开）+ 编辑/删除笔记 + 修改/删除标记 + 颜色面板 */
function showMarkTool(mark, annId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  editingAnnId = annId;
  const tool = $('markTool');
  tool.hidden = false;
  tool.innerHTML = '';
  // 笔记预览气泡
  const bubble = document.createElement('div');
  bubble.className = 'mk-bubble';
  const noteText = document.createElement('div');
  noteText.className = 'mk-note-preview';
  noteText.textContent = ann.note || '';
  const expand = document.createElement('button');
  expand.className = 'mk-expand';
  expand.textContent = '展开 ▾';
  expand.hidden = true;
  expand.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!ann.note) return;
    hideMarkTool();
    openPopup('笔记', `<div class="fn-body">${escapeHtml(ann.note)}</div>`);
  });
  bubble.appendChild(noteText);
  bubble.appendChild(expand);
  bubble.style.display = ann.note ? 'block' : 'none';
  tool.appendChild(bubble);
  // 操作栏
  const mkBtn = (label, fn, danger) => {
    const b = document.createElement('button');
    b.className = 'mk-tool-btn' + (danger ? ' danger' : '');
    b.textContent = label;
    bindPress(b, fn);
    return b;
  };
  const bar = document.createElement('div');
  bar.className = 'mk-bar';
  const hasMark = !!(ann.colorId || ann.underline);
  const btnEdit = mkBtn('✏️ ' + (ann.note ? '编辑' : '笔记'), () => editNote(annId));
  const btnDelNote = mkBtn('🗑 删除笔记', () => { hideMarkTool(); removeNote(annId); }, true);
  btnDelNote.style.display = ann.note ? '' : 'none';
  const btnMark = mkBtn('🎨 ' + (hasMark ? '修改' : '标记'), () => toggleMarkPanel(panel, ann, annId));
  const btnDelMark = mkBtn('✕ 删除标记', () => { hideMarkTool(); removeMark(annId); }, true);
  btnDelMark.style.display = hasMark ? '' : 'none';
  bar.append(btnEdit, btnDelNote, btnMark, btnDelMark);
  tool.appendChild(bar);
  // 颜色面板（点「标记/修改」展开）
  const panel = document.createElement('div');
  panel.className = 'mk-panel';
  panel.hidden = true;
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = `sw ${c.id}` + (ann.colorId === c.id && !ann.underline ? ' active' : '');
    sw.title = `${c.name}：${c.desc}`;
    bindPress(sw, () => changeAnnColor(annId, c.id));
    panel.appendChild(sw);
  });
  const uBtn = document.createElement('button');
  uBtn.className = 'tool-btn' + (ann.underline ? ' active' : '');
  uBtn.textContent = '下划线';
  bindPress(uBtn, () => toggleAnnUnderline(annId));
  panel.appendChild(uBtn);
  tool.appendChild(panel);
  positionMenuByRect(tool, mark.getBoundingClientRect());
  // 溢出检测（rAF 后已布局）：笔记超 4 行才显示「展开」；
  // 长度兜底：超长文本即使 line-clamp 布局检测失效也显示（部分 WebView 行为差异）
  requestAnimationFrame(() => {
    if (ann.note) {
      const overflow = noteText.scrollHeight > noteText.clientHeight;
      expand.hidden = !overflow && ann.note.length <= 60;
    }
  });
}

function toggleMarkPanel(panel, ann, annId) {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    panel.querySelectorAll('.sw').forEach(sw => {
      sw.classList.toggle('active', sw.classList.contains(ann.colorId) && !ann.underline);
    });
    panel.querySelector('.tool-btn').classList.toggle('active', !!ann.underline);
  }
}

function hideMarkTool() {
  const t = $('markTool');
  t.hidden = true;
  t.style.removeProperty('display');
  t.style.removeProperty('opacity');
  editingAnnId = null;
}

function changeAnnColor(annId, colorId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  ann.colorId = colorId;
  ann.underline = false;
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
  hideMarkTool();
}

function deleteAnn(annId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  state.annotations = state.annotations.filter(a => a.id !== annId);
  save(LS_ANNOTATIONS, state.annotations);
  rerenderAnn(ann);
  hideMarkTool();
}

/* ============ 反馈 ============ */
function openFeedbackModal() {
  openPopup('反馈', `
    <div class="fb-hint">遇到问题或有建议？告诉我们。</div>
    <select id="fbType" class="fb-select">
      <option value="bug">Bug 问题</option>
      <option value="suggestion">优化建议</option>
      <option value="other">其他</option>
    </select>
    <textarea id="fbContent" class="fb-textarea" placeholder="描述你遇到的问题或建议…" rows="5"></textarea>
    <div class="fb-actions">
      <span id="fbMsg" class="fb-msg"></span>
      <button class="popup-btn primary" id="fbSubmit">提交</button>
    </div>
  `);
  $('fbSubmit').addEventListener('click', submitFeedback);
}

async function submitFeedback() {
  const btn = $('fbSubmit');
  const content = $('fbContent').value.trim();
  const msg = $('fbMsg');
  if (!content) { msg.textContent = '请填写内容'; return; }
  btn.disabled = true;
  msg.textContent = '提交中…';
  try {
    const res = await fetch(`${FEEDBACK_API}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: $('fbType').value, content }),
    });
    if (res.ok) {
      msg.textContent = '已提交，感谢反馈！';
      $('fbContent').value = '';
    } else {
      const data = await res.json().catch(() => null);
      msg.textContent = data && data.error === 'rate_limited'
        ? '提交太频繁，请稍后再试'
        : '提交失败，请稍后再试';
    }
  } catch {
    msg.textContent = '网络错误，提交失败';
  }
  btn.disabled = false;
}

/* ============ 弹窗 ============ */
const popupStack = [];

function openPopup(title, bodyHtml) {
  if (!$('popup').hidden) {
    popupStack.push({ title: $('popupTitle').textContent, body: $('popupBody').innerHTML });
  } else {
    popupStack.length = 0;
  }
  $('popupTitle').textContent = title;
  $('popupBody').innerHTML = bodyHtml;
  $('popup').hidden = false;
  $('overlay').hidden = false;
  $('popupBack').hidden = popupStack.length === 0;
  lockScroll(true);
}

// 返回上一层（栈空则完全关闭）
function closePopup() {
  if (popupStack.length) {
    const prev = popupStack.pop();
    $('popupTitle').textContent = prev.title;
    $('popupBody').innerHTML = prev.body;
    $('popupBack').hidden = popupStack.length === 0;
    return;
  }
  closePopupAll();
}

// 完全关闭
function closePopupAll() {
  popupStack.length = 0;
  $('popup').hidden = true;
  $('overlay').hidden = true;
  $('popupBack').hidden = true;
  lockScroll(false);
}

function showFootnotePopup(n, key) {
  const notes = key ? (state.bibleNotes || {})[key] : null;
  if (!notes || !notes[+n]) { openPopup(`注${n}`, '<div class="empty-hint">未找到注解</div>'); return; }
  const note = notes[+n];
  // key 形如「创26:24」，取前导书卷缩写作相对引用的默认上下文
  const acr = (key || '').match(/^\D+/);
  openPopup(`${key} 注${n}`, `<div class="fn-body">${linkifyRefs(note, acr ? acr[0] : null)}</div>`);
}

function showXrefPopup(letter, key) {
  const xrefs = key ? (state.bibleXrefs || {})[key] : null;
  const raw = xrefs ? xrefs[letter] : null;
  if (!raw) { openPopup(`串珠 ${letter}`, '<div class="empty-hint">未找到串珠</div>'); return; }
  showRefsPopup(`串珠 ${letter}`, raw);
}

/* ============ 引用解析（简化版） ============ */
const BOOK_ALIASES = {
  '创世记':'创','出埃及记':'出','利未记':'利','民数记':'民','申命记':'申','约书亚记':'书','士师记':'士','路得记':'得',
  '撒母耳记上':'撒上','撒母耳记下':'撒下','列王纪上':'王上','列王纪下':'王下','历代志上':'代上','历代志下':'代下',
  '以斯拉记':'拉','尼希米记':'尼','以斯帖记':'斯','约伯记':'伯','诗篇':'诗','箴言':'箴','传道书':'传','雅歌':'歌',
  '以赛亚书':'赛','耶利米书':'耶','耶利米哀歌':'哀','以西结书':'结','但以理书':'但','何西阿书':'何','约珥书':'珥','阿摩司书':'摩','俄巴底亚书':'俄','约拿书':'拿','弥迦书':'弥','那鸿书':'鸿','哈巴谷书':'哈','西番雅书':'番','哈该书':'该','撒迦利亚书':'亚','玛拉基书':'玛',
  '马太福音':'太','马可福音':'可','路加福音':'路','约翰福音':'约','使徒行传':'徒','罗马书':'罗','哥林多前书':'林前','哥林多后书':'林后','加拉太书':'加','以弗所书':'弗','腓立比书':'腓','歌罗西书':'西','帖撒罗尼迦前书':'帖前','帖撒罗尼迦后书':'帖后','提摩太前书':'提前','提摩太后书':'提后','提多书':'多','腓利门书':'门','希伯来书':'来','雅各书':'雅','彼得前书':'彼前','彼得后书':'彼后','约翰一书':'约壹','约翰二书':'约贰','约翰三书':'约参','犹大书':'犹','启示录':'启',
  // 简称别名（注：路加/马可不可缺——正文常写「路加十七章二十七节」，
  // 若缺失会退化为把「加/可」当加拉太/马可福音，识别成「加17:27」类越界死链）
  '但以理':'但','以西结':'结','以赛亚':'赛','耶利米':'耶','出埃及':'出','腓立比':'腓','以弗所':'弗','歌罗西':'西','加拉太':'加','马太':'太','马可':'可','路加':'路','约翰':'约','罗马':'罗','哀歌':'哀','行传':'徒','雅各':'雅',
  // 注意：本数据源（恢复本串珠/注解）里「约一/约二/约三」= 约翰福音第 1/2/3 章
  // （创1:1 串珠「约一1，2」= 约1:1-2、箴8:35「约三36」= 约3:36），
  // 约翰书信一律写作「约壹/约贰/约参」，故不得把 约一/约二/约三 映射到 约翰一/二/三书
};

// 统一引用别名：全名/简称 → 缩写，加上 books.json 里的缩写 → 缩写
const REF_ALIASES = { ...BOOK_ALIASES };
let _refAliasesSorted = Object.keys(REF_ALIASES).sort((a, b) => b.length - a.length);

const CN_DIGITS = { '零':0,'〇':0,'○':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function cnToInt(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (!/[百十]/.test(s)) {
    let v = 0;
    for (const c of s) {
      if (c in CN_DIGITS) v = v * 10 + CN_DIGITS[c];
      else return null;
    }
    return v;
  }
  let total = 0, rest = s;
  if (rest.includes('百')) { const i = rest.indexOf('百'); total += (CN_DIGITS[rest[i-1]] ?? 1) * 100; rest = rest.slice(i+1); }
  if (rest.includes('十')) { const i = rest.indexOf('十'); total += (i > 0 ? (CN_DIGITS[rest[i-1]] ?? 1) : 1) * 10; rest = rest.slice(i+1); }
  if (rest) total += CN_DIGITS[rest[0]] ?? 0;
  return total;
}

function resolveRefString(raw) {
  // 全角「：」也是分隔符：串珠常见「2～5：代上一5～7」格式，前半是节范围不是引用
  // （半角「:」不能拆，规范 key 形如 创1:2上）
  const tokens = (raw || '').split(/[，,、;；：\s]+/).filter(Boolean);
  const out = [];
  let curAcronym = null, curChapter = null;
  // 单节 key 入列；整节不存在时兼容上下半节 key（如 创25:9 只有 创25:9上/下）；
  // 引用带 上/下 后缀但该节在数据里未拆分（如 太11:29 整节无半节）→ 剥后缀回退整节，
  // 否则弹窗「未收录」（引用的半节是语意的一半，展示整节可接受）
  const pushKey = (key) => {
    const bt = state.bibleText || {};
    if (bt[key]) out.push(key);
    else if (bt[key + '上']) out.push(key + '上');
    else if (bt[key + '下']) out.push(key + '下');
    else {
      const base = key.replace(/[上下]$/, '');
      if (base !== key && bt[base]) out.push(base);
      else out.push(key); // bibleText 未加载时兜底，弹窗会过滤不存在的节
    }
  };
  for (const rawToken of tokens) {
    // 引导词不影响引用本身（串珠常见「参创三五23～26」「见申十二5注1」的 参/见）
    const token = rawToken.replace(/^(?:参看|参阅|参见|参考|参|见)/, '');
    if (!token) continue;
    // 同一 token 可能有多套别名切分（如「约一14」：约壹 第14章 ✗ 越界 → 约 一章14节 ✓），
    // 逐个尝试前缀别名：优先采纳能解析出「真实存在的节」的切分，否则退回只解出章号的切分
    let chosen = null;
    for (const alias of _refAliasesSorted) {
      if (!token.startsWith(alias)) continue;
      const acronym = REF_ALIASES[alias];
      const rest = token.slice(alias.length);
      if (!rest) continue;
      const r = parseRefTail(acronym, rest, null);
      if (!r) continue;
      const maxCh = bookChapterCount(acronym);
      if (r.chapter && maxCh && r.chapter > maxCh) continue;   // 章号越界 → 该切分不成立
      const probe = r.key || (r.range ? `${acronym}${r.chapter}:${r.range[0]}` : '');
      if (probe && verseKeyExists(probe)) { chosen = { acronym, r }; break; }
      if (!chosen) chosen = { acronym, r };   // 仅解出章号的切分兜底
    }
    if (chosen) {
      curAcronym = chosen.acronym;
      const r = chosen.r;
      if (r) {
        // 节范围（如 9～10、19～26、二章六至九节）展开为单节 key
        if (r.range) for (let v = r.range[0]; v <= r.range[1]; v++) pushKey(`${chosen.acronym}${r.chapter}:${v}`);
        else if (r.key) pushKey(r.key);
        if (r.chapter) curChapter = r.chapter;
      }
    } else if (curAcronym) {
      // 相对引用：纯数字节（2）或 中文章+阿拉伯节（三9 / 十七5下，半节后缀保留交由 pushKey 归一）
      const m = token.match(/^(\d+)$/);
      if (m && curChapter) { pushKey(`${curAcronym}${curChapter}:${m[1]}`); continue; }
      const m2 = token.match(/^([一二三四五六七八九十百〇○]+)(\d+)([上下])?$/);
      if (m2) {
        const ch = cnToInt(m2[1]);
        if (ch) { pushKey(`${curAcronym}${ch}:${m2[2]}${m2[3] || ''}`); curChapter = ch; }
      }
    }
  }
  return out;
}

function parseRefTail(acronym, rest, defChapter) {
  rest = (rest || '').trim();
  if (!rest) return null;
  // 上下半节后缀（如 二五9上），剥出后拼回 key
  let half = '';
  if (/[上下]$/.test(rest)) { half = rest.slice(-1); rest = rest.slice(0, -1).trim(); }
  // 章:节（阿拉伯）1:2 / 1:2-3（支持全角波浪号 ～）
  let m = rest.match(/^(\d+):(\d+)(?:[-~～](\d+))?$/);
  if (m) {
    const ch = m[1];
    if (m[3]) return { range: [+m[2], +m[3]], chapter: +ch };
    return { key: `${acronym}${ch}:${m[2]}${half}`, chapter: +ch };
  }
  // 中文章 + 阿拉伯节（十二1 / 十二1-3，支持全角波浪号 ～）
  m = rest.match(/^([一二三四五六七八九十百〇○]+)(\d+)(?:[-~～](\d+))?$/);
  if (m) {
    const ch = cnToInt(m[1]);
    if (ch) {
      if (m[3]) return { range: [+m[2], +m[3]], chapter: ch };
      return { key: `${acronym}${ch}:${m[2]}${half}`, chapter: ch };
    }
  }
  // 中文章节式（三章十九节 / 二章六至九节 / 二章六节至九节）
  m = rest.match(/^第?([一二三四五六七八九十百〇○]+)章([一二三四五六七八九十百〇○]+)节?(?:[-~～至到]([一二三四五六七八九十百〇○]+)节?)?$/);
  if (m) {
    const ch = cnToInt(m[1]), v = cnToInt(m[2]), v2 = m[3] ? cnToInt(m[3]) : null;
    if (ch && v) {
      if (v2 && v2 > v) return { range: [v, v2], chapter: ch };
      return { key: `${acronym}${ch}:${v}${half}`, chapter: ch };
    }
  }
  // 纯章号（约一1 → 约壹 第1章，节由后续 token 提供）
  m = rest.match(/^(\d+)$/);
  if (m) {
    const n = +m[1];
    // 章号越界（如「犹16」，犹大书仅1章）→ 实为第1章第n节，经文存在才采信
    const maxCh = bookChapterCount(acronym);
    if (maxCh && n > maxCh && verseKeyExists(`${acronym}1:${n}`)) return { key: `${acronym}1:${n}`, chapter: 1 };
    return { key: null, chapter: n };
  }
  m = rest.match(/^([一二三四五六七八九十百〇○]+)$/);
  if (m) { const ch = cnToInt(m[1]); if (ch) return { key: null, chapter: ch }; }
  return null;
}

/* ============ 正文经文引用检测与包裹 ============ */
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildRefRegex() {
  const cn = '一二三四五六七八九十百〇○';
  const aliasAlt = _refAliasesSorted.map(escapeRegex).join('|');
  // 只识别带节号/范围/「章…节」的引用；不识别裸「书卷+中文数字」（如 利百、雅各一、
  // 创世记十一、创世记二十五），避免人名/描述性章节范围被误判为经文引用
  const tail = '(?:\\d+:\\d+(?:[-~～]\\d+)?|[' + cn + ']+\\d+(?:[-~～]\\d+)?[上下]?'
    + '|第?[' + cn + ']+章[' + cn + ']+节?(?:[-~～至到][' + cn + ']+节?)?)';
  // 引导词（参/见/参看…）可选前缀，不参与捕获（组 1=书卷别名，组 2=章節尾）
  return new RegExp('(?:参看|参阅|参见|参考|[参见])?(' + aliasAlt + ')(' + tail + ')', 'g');
}

// 相对引用（无书卷前缀，靠前文全书引用或 defaultAcronym 提供上下文）：
// 中文章+阿拉伯节（二五11 / 二六15～22 / 三9上）+ 纯阿拉伯节（33，需已有章上下文）。
// 与 resolveRefString 的相对引用规则一致。
function buildRelativeRefRegex() {
  const cn = '一二三四五六七八九十百〇○';
  return new RegExp('(?:[' + cn + ']+\\d+(?:[-~～]\\d+)?[上下]?|\\d{1,3}(?:[-~～]\\d{1,3})?[上下]?)', 'g');
}

// 纯阿拉伯节相对引用要求右边界为分隔符/句末标点，防误匹配词中/日期数字（如 1920年、25章）
const REL_DIGIT_RIGHT = /[\s，,、;；。！？）)」』》…]/;

// 书卷缩写 → 章数（books.json），用于过滤书卷推断错误的相对引用（如「弗32:28」弗只有6章）
let _bookChaptersMap = null;
function bookChapterCount(acronym) {
  if (!_bookChaptersMap) {
    _bookChaptersMap = {};
    (state.books || []).forEach(b => { _bookChaptersMap[b.acronym] = b.chapters; });
  }
  return _bookChaptersMap[acronym] || 0;
}

// 相对引用解析出的节必须真实存在于经文数据（防书卷/节号推断错误给出错误链接）；
// bibleText 未加载（如 lr/书报/听抄模块直进）时跳过校验，重渲染后生效
function verseKeyExists(key) {
  const bt = state.bibleText;
  if (!bt) return true;
  const base = key.replace(/[上下]$/, '').replace(/～\d+.*$/, '');
  if (bt[base]) return true;
  if (bt[base + '上'] || bt[base + '下']) return true;
  return false;
}

function detectRefs(text, defaultAcronym) {
  text = text || '';
  const fullRe = buildRefRegex();
  const relRe = buildRelativeRefRegex();
  const refs = [];
  let curAcronym = defaultAcronym || null, curChapter = null;
  fullRe.lastIndex = 0;
  let segStart = 0;
  let m;
  for (;;) {
    const nextFull = fullRe.exec(text);
    const segEnd = nextFull ? nextFull.index : text.length;
    // 上一引用之后、下一引用之前：扫描相对引用（无上下文则不识别）
    if (curAcronym && segStart < segEnd) {
      const seg = text.slice(segStart, segEnd);
      relRe.lastIndex = 0;
      let rm;
      while ((rm = relRe.exec(seg)) !== null) {
        const absStart = segStart + rm.index;
        const absEnd = absStart + rm[0].length;
        const body = rm[0];
        // 左边界须为分隔符/标点/文本开头，避免误匹配词中数字；
        // 纯数字形式不接在「:」后（防 25:11 被拆出 11 误判为相对引用）
        const before = text[absStart - 1];
        if (before) {
          const leftOk = /^\d/.test(body)
            ? /[\s，,、;；（(「『"“—–]/.test(before)
            : /[\s，,、;；：:（(「『"“—–]/.test(before);
          if (!leftOk) continue;
        }
        if (/^\d/.test(body) && absEnd < text.length) {
          // 纯阿拉伯节须以分隔符/句末结尾（防 1920年、25章 之类被误判）
          if (!REL_DIGIT_RIGHT.test(text[absEnd])) continue;
        }
        const half = /[上下]$/.test(body) ? body.slice(-1) : '';
        const core = half ? body.slice(0, -1) : body;
        const mm = core.match(/^([一二三四五六七八九十百〇○]+)?(\d+)(?:[-~～](\d+))?$/);
        if (!mm) continue;
        const ch = mm[1] ? cnToInt(mm[1]) : curChapter;
        if (!ch) continue;
        // 章越界 → 书卷推断错误（如 弗 的文章里裸写「一一九66」实为诗篇），不包裹以免给出错误链接
        const maxCh = bookChapterCount(curAcronym);
        if (maxCh && ch > maxCh) continue;
        // data-refs 用完整规范引用（书卷前缀），点击弹窗可直接解析
        const key = `${curAcronym}${ch}:${mm[2]}${half}` + (mm[3] ? `～${mm[3]}` : '');
        if (!verseKeyExists(key)) continue;
        refs.push({ start: absStart, end: absEnd, refText: key });
        if (mm[1]) curChapter = ch;
      }
    }
    if (!nextFull) break;
    const start = nextFull.index, end = nextFull.index + nextFull[0].length;
    const alias = nextFull[1];
    const aliasBook = alias ? REF_ALIASES[alias] : null;
    // 章数越界 → 书卷别名是被后缀误匹配的（如「路加十七章」别名缺失时把「加」当加拉太书，
    // 加仅 6 章却有 17 章）→ 死链：不包裹，也不建立引用上下文（防污染后续相对引用）
    let fullChapter = null;
    if (aliasBook) {
      const fr = parseRefTail(aliasBook, nextFull[2], null);
      if (fr && fr.chapter) fullChapter = fr.chapter;
    }
    const aliasMaxCh = aliasBook ? bookChapterCount(aliasBook) : 0;
    if (fullChapter && aliasMaxCh && fullChapter > aliasMaxCh) { segStart = end; continue; }
    refs.push({ start, end, refText: nextFull[0] });
    // 全书引用建立上下文，供后续相对引用使用
    // 必须用正则实际匹配到的别名（捕获组 1）：正则可能回溯到较短别名
    // （如「约一14」实际是 约 + 一14），用 startsWith 反查会取到最长别名而错判书卷
    if (aliasBook) {
      curAcronym = aliasBook;
      if (fullChapter) curChapter = fullChapter;
    }
    segStart = end;
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
}

// 纯文本 → HTML，把经文引用包成 <span class="ref-link">；defaultAcronym 提供相对引用的默认书卷
function linkifyRefs(text, defaultAcronym) {
  const refs = detectRefs(text || '', defaultAcronym);
  if (!refs.length) return escapeHtml(text || '');
  let html = '', cursor = 0;
  for (const r of refs) {
    if (r.start > cursor) html += escapeHtml(text.slice(cursor, r.start));
    html += `<span class="ref-link" data-refs="${escapeHtml(r.refText)}">${escapeHtml(text.slice(r.start, r.end))}</span>`;
    cursor = r.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

// 渲染生命读经正文：经文引用包 ref-link，同时叠加标注 mark
// 判断生命读经某行是否为标题，返回层级（null=正文）
// 恢复版生命读经大纲编号共 10 级（编号可多位）：
//   0=短行无编号小节  1=壹 2=一 3=１ 4=ａ（裸格式）
//   5=（一）6=（１）7=（ａ）（括号格式）  8=《一》9=《１》10=《ａ》（书名号格式）
function detectLrHeading(line) {
  const t = line.trim();
  if (!t) return null;
  // 分隔线（---、=== 等纯符号行）不是标题
  if (/^[-—─=*_·●○•]+$/.test(t)) return null;
  // 裸格式：壹/一/１/ａ + 空格（level 1-4，编号支持多位如「十一」「１０」；空格兼容全角/半角）
  if (/^[壹贰叁肆伍陆柒捌玖拾]+[\u3000 ]+/.test(t)) return { level: 1 };
  if (/^[一二三四五六七八九十]+[\u3000 ]+/.test(t)) return { level: 2 };
  if (/^[０-９]+[\u3000 ]+/.test(t)) return { level: 3 };
  if (/^[ａ-ｚ][\u3000 ]+/.test(t)) return { level: 4 };
  // 括号格式：（一）（１）（ａ）（level 5-7）
  if (/^（[一二三四五六七八九十百〇○]+）[\u3000 ]+/.test(t)) return { level: 5 };
  if (/^（[０-９]+）[\u3000 ]+/.test(t)) return { level: 6 };
  if (/^（[ａ-ｚ]）[\u3000 ]+/.test(t)) return { level: 7 };
  // 书名号格式：《一》《１》《ａ》（level 8-10）
  if (/^《[一二三四五六七八九十]+》[\u3000 ]+/.test(t)) return { level: 8 };
  if (/^《[０-９]+》[\u3000 ]+/.test(t)) return { level: 9 };
  if (/^《[ａ-ｚ]》[\u3000 ]+/.test(t)) return { level: 10 };
  // 短行小标题：2-12 字、无标点结尾、无括号/书名号
  if (t.length >= 2 && t.length <= 12 && !/[。，；：？！、」』）】]$/.test(t) && !/[（(【[《]/.test(t)) {
    return { level: 0 };
  }
  return null;
}

// 渲染单行：经文引用包 ref-link，叠加标注 mark（baseOffset 为该行在全文中的偏移）
function renderLrLine(parent, text, baseOffset, annotations, defaultAcronym) {
  const refs = detectRefs(text || '', defaultAcronym);
  let cursor = 0;
  const appendText = (t, base) => {
    if (!annotations.length) parent.appendChild(document.createTextNode(t));
    else renderTextWithMarks(parent, t, base, annotations);
  };
  for (const r of refs) {
    if (r.start > cursor) appendText(text.slice(cursor, r.start), baseOffset + cursor);
    const span = document.createElement('span');
    span.className = 'ref-link';
    span.textContent = text.slice(r.start, r.end);
    span.dataset.refs = r.refText;
    parent.appendChild(span);
    cursor = r.end;
  }
  if (cursor < text.length) appendText(text.slice(cursor), baseOffset + cursor);
}

function renderLrContent(parent, content, annotations, idPrefix, defaultAcronym) {
  const lines = (content || '').split('\n');
  let offset = 0;
  let hIdx = 0;
  for (const line of lines) {
    if (line.trim() === '') { offset += line.length + 1; continue; }
    const heading = detectLrHeading(line);
    const div = document.createElement('div');
    div.className = heading ? `lr-head lr-h${heading.level}` : 'lr-para';
    // 记录该行在源 content 中的偏移（含换行），供 plainOffset 做选区偏移换算，
    // 保证选区坐标与渲染 baseOffset / 自愈 plain 同一坐标系（源 content 含空行）
    div.dataset.base = offset;
    if (heading && idPrefix) {
      div.id = `${idPrefix}-${hIdx}`;
      hIdx++;
    }
    renderLrLine(div, line, offset, annotations, defaultAcronym);
    parent.appendChild(div);
    offset += line.length + 1;
  }
}

// 提取生命读经纲目（返回 [{level, text}]）
function extractLrHeadings(content) {
  const headings = [];
  for (const line of (content || '').split('\n')) {
    const h = detectLrHeading(line);
    if (h) headings.push({ level: h.level, text: line.trim() });
  }
  return headings;
}

// 渲染纲目索引（点击滚动到对应标题）
// 把带标记的经文文本转成 HTML（保留 {N}/[a] 为可点击上标，key 供弹窗查注解/串珠）
function markedToHtml(marked, key) {
  const { segments } = parseMarkedText(marked || '');
  let html = '';
  for (const seg of segments) {
    if (seg.type === 'fn') html += `<sup class="fn-ref" data-fn="${seg.n}" data-key="${escapeHtml(key)}">${seg.n}</sup>`;
    else if (seg.type === 'xref') html += `<sup class="xref-ref" data-xref="${seg.letter}" data-key="${escapeHtml(key)}">${seg.letter}</sup>`;
    else html += escapeHtml(seg.text);
  }
  return html;
}

function showRefsPopup(title, refString) {
  const refs = resolveRefString(refString);
  let html = `<div style="color:var(--text-muted);font-size:13px;margin-bottom:8px">${escapeHtml(refString)}</div>`;
  let found = 0;
  for (const ref of refs) {
    const verseText = (state.bibleText || {})[ref];
    if (verseText) {
      html += `<div class="popup-verse"><span class="pv-ref">${escapeHtml(ref)}</span><span class="pv-text">${markedToHtml(verseText, ref)}</span></div>`;
      found++;
    }
  }
  if (!found) html += '<div class="empty-hint">未收录此经文</div>';
  openPopup(title, html);
}

function escapeHtml(s) {
  // 引号必须转义：本函数不仅用于文本上下文，还用于 value="…"/data-refs="…" 等 HTML 属性拼接，
  // 云同步来的数据（a.id/a.title 等）若含引号可属性逃逸 → XSS
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============ 检查更新（update.js） ============ */
let _updateInfo = null; // 最近一次 check 结果：null=未知/失败，{latest, current, hasUpdate}

function updateSettingsBadge() {
  const has = !!(window.BibleStudyUpdate && _updateInfo && _updateInfo.hasUpdate);
  const btn = $('settingsBtn');
  if (btn) btn.classList.toggle('update-dot', has);
}

function closeUpdateModal() {
  $('updateModal').hidden = true;
  document.body.classList.remove('scroll-locked');
}

function openUpdateModal() {
  const modal = $('updateModal');
  const status = $('updateStatus');
  const body = $('updateBody');
  const progress = $('updateProgress');
  const fill = $('updateFill');
  const percent = $('updatePercent');
  const action = $('updateAction');
  modal.hidden = false;
  document.body.classList.add('scroll-locked');
  status.textContent = '检查中…';
  body.innerHTML = '';
  progress.hidden = true;
  fill.style.width = '0%';
  percent.textContent = '0%';
  action.hidden = true;
  action.textContent = '下载并安装';
  action.disabled = false;

  window.BibleStudyUpdate.check().then((res) => {
    _updateInfo = res;
    updateSettingsBadge();
    if (!res) {
      status.textContent = '检查失败';
      body.innerHTML = '无法连接 GitHub Releases，请检查网络后重试。';
      return;
    }
    const { latest, current, hasUpdate } = res;
    if (!hasUpdate) {
      status.textContent = `已是最新版本 v${current}`;
      return;
    }
    status.textContent = `发现新版本 v${latest.version}（当前 v${current}）`;
    body.innerHTML = escapeHtml(latest.body ? latest.body.slice(0, 500) : '');
    if (!window.BibleStudyUpdate.isNative()) {
      body.innerHTML += '\n\n网页版内容会自动更新，刷新页面即可；如需安装 APK 请点下方按钮前往 Releases 下载。';
      action.textContent = '前往 Releases';
    }
    action.hidden = false;
  });
}

function startUpdateDownload() {
  const status = $('updateStatus');
  const body = $('updateBody');
  const progress = $('updateProgress');
  const fill = $('updateFill');
  const percent = $('updatePercent');
  const action = $('updateAction');
  const isNative = window.BibleStudyUpdate.isNative();
  const latest = _updateInfo && _updateInfo.latest;

  // PWA：直接跳转 Releases 页
  if (!isNative || !latest) {
    if (latest && latest.html_url) window.open(latest.html_url, '_blank');
    closeUpdateModal();
    return;
  }

  action.disabled = true;
  progress.hidden = false;
  status.textContent = '正在下载 APK…';
  body.innerHTML = '';

  window.BibleStudyUpdate.download(latest, (frac) => {
    const p = Math.round(frac * 100);
    fill.style.width = p + '%';
    percent.textContent = p + '%';
  }).then((r) => {
    progress.hidden = true;
    if (r.ok) {
      status.textContent = '安装程序已打开，请在系统弹窗中点击安装。';
      action.hidden = true;
    } else {
      status.textContent = '下载/安装失败：' + r.msg;
      body.innerHTML = r.filePath ? 'APK 已保存，可手动安装：' + escapeHtml(r.filePath) : '';
      action.disabled = false;
      action.textContent = '重试';
    }
  });
}

/* ============ 启动 ============ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();

// 启动后静默检查更新：发现新版给 ⚙️ 加红点，设置弹窗行显示状态
setTimeout(() => {
  if (!window.BibleStudyUpdate) return;
  window.BibleStudyUpdate.check().then((res) => {
    _updateInfo = res;
    updateSettingsBadge();
    const uv = $('setUpdateVal');
    if (uv) {
      uv.textContent = !res ? '检查更新' : (res.hasUpdate ? `新版本 v${res.latest.version}` : '已是最新');
    }
  });
}, 3000);
