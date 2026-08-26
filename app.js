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
const LS_MORNING_LAST = 'bible-study.morningLast';   // {period, chapterId} 晨兴阅读器上次位置（数据到位后启用）
const LS_MORNING_NOTES = 'bible-study.morningNotes'; // {"period:chapterId": text}

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
  activeModule: 'bible', // 当前阅读器模块：'bible' | 'lifereading'（晨兴/书报后续）
  notesScope: 'chapter', // 'chapter' | 'global' —— 我的笔记聚合范围（研读列内）
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
};

/* 合集注册表（数据驱动）：首页块列表，点击 = 直接进入对应阅读器模块。
   晨兴/书报数据导出后各加一行即可上块，UI 零改动 */
const COLLECTIONS = [
  { id: 'bible', title: '读经', icon: '📖', entry: () => enterModule('bible') },
  { id: 'lifereading', title: '生命读经', icon: '📗', entry: () => enterModule('lifereading') },
  { id: 'notes', title: '我的笔记', icon: '📝', entry: () => { enterModule('bible'); enterNotesGlobal(); } },
  { id: 'books', title: '书报', icon: '📚', entry: () => enterModule('books') },
  // 阶段 2：{ id: 'morning', title: '晨兴', icon: '🌅', entry: openMorningList }
];

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
// 云同步客户端（sync.js 加载失败时静默降级为纯本地）
const Sync = window.BibleStudySync || null;
// 运行时门控：未启用同步（无 account）时即使 sync.js 存在也不参与云同步
function syncActive() { return !!(Sync && state.account); }
const SYNC_KEYS = [LS_ANNOTATIONS, LS_CHAPTER_NOTES, LS_LR_NOTES, LS_BOOK_NOTES];

function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  if (syncActive() && SYNC_KEYS.includes(key)) {
    Sync.putRemote(key, val);
  }
}

// 启动时后台同步：服务器为主，成功后覆盖本地；再重试离线未推送的改动
async function syncFromRemote() {
  if (!syncActive()) return;
  await Sync.pullAll(SYNC_KEYS);
  state.annotations = load(LS_ANNOTATIONS, []);
  state.chapterNotes = load(LS_CHAPTER_NOTES, {});
  state.lrNotes = load(LS_LR_NOTES, {});
  state.bookNotes = load(LS_BOOK_NOTES, {});
  Sync.flushPending((key) => {
    if (key === LS_ANNOTATIONS) return state.annotations;
    if (key === LS_CHAPTER_NOTES) return state.chapterNotes;
    if (key === LS_LR_NOTES) return state.lrNotes;
    if (key === LS_BOOK_NOTES) return state.bookNotes;
    return undefined;
  });
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
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载失败 ${url}: ${r.status}`);
  return r.json();
}

async function init() {
  state.books = await fetchJSON('data/books.json');
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
  // 后台预渲染工作区：DOM 就绪，点合集块秒开（LS_LAST 保留用于「继续上次」）
  const last = load(LS_LAST, null);
  if (last && state.books.some(b => b.index === last.book)) {
    await selectBook(last.book, last.chapter);
  } else {
    await selectBook(1, 1);
  }
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
      renderLrVolStrip(state.lrBookIndex);
      const vol = await ensureLrVolume(state.lrBookIndex);
      renderLrArticleList(state.lrBookIndex, vol);
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
      renderBookSeriesStrip();
      await ensureBookMeta();
      renderBookVolStrip();
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
    onCrumbClick() { state.bookSideTab = 'toc'; renderBookSide(); },
  },
};

// body-mod-{id} 类控制三列容器归属（bible 容器默认显示，lr/books 容器由 CSS 切换）
function applyModuleBodyClass(id) {
  document.body.classList.remove('body-mod-bible', 'body-mod-lifereading', 'body-mod-books');
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
    text.innerHTML = linkifyRefs(it.text);
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
  renderLrContent(content, a.content || '', lrAnns, `lrh-${a.id}`);
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
  // 范围切换：本章（当前章聚合）/ 全部（跨书卷按模块分类）
  const scopeBar = document.createElement('div');
  scopeBar.className = 'note-scope';
  [['chapter', '本章'], ['global', '全部']].forEach(([s, label]) => {
    const btn = document.createElement('button');
    btn.className = 'note-scope-btn' + (state.notesScope === s ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.notesScope = s;
      renderStudy();
    });
    scopeBar.appendChild(btn);
  });
  body.appendChild(scopeBar);
  if (state.notesScope === 'global') {
    body.appendChild(renderMyNotesGlobal());
    return;
  }
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

// 全局笔记：全部标注按 type 分 tab，跨书卷分组（groupHlGlobal）
function renderMyNotesGlobal() {
  return renderHighlights(state.annotations, groupHlGlobal);
}

// 全局分组：经文按 书卷→章 两级；生命读经按书卷（label：创世记 · 第24章 / 创世记 · 生命读经）
function groupHlGlobal(list) {
  const groups = [];
  const verseByBook = {};
  const lrByBook = {};
  const bookByKey = {};   // book 标注按 series:volume:book 分组
  list.forEach(a => {
    if (a.type === 'verse') {
      const m = (verseByBook[a.book] = verseByBook[a.book] || {});
      (m[a.chapter] = m[a.chapter] || []).push(a);
    } else if (a.type === 'lr') {
      (lrByBook[a.book] = lrByBook[a.book] || []).push(a);
    } else if (a.type === 'book') {
      const k = `${a.series}:${a.volume}:${a.book}`;
      (bookByKey[k] = bookByKey[k] || []).push(a);
    }
  });
  const books = [...new Set([...Object.keys(verseByBook), ...Object.keys(lrByBook)])].map(Number).sort((a, b) => a - b);
  books.forEach(b => {
    const name = bookName(b);
    Object.keys(verseByBook[b] || {}).map(Number).sort((x, y) => x - y).forEach(ch => {
      groups.push({
        label: `${name} · 第${ch}章`,
        items: verseByBook[b][ch].sort((x, y) => (x.verse - y.verse) || (x.start - y.start)),
      });
    });
    if ((lrByBook[b] || []).length) {
      groups.push({
        label: `${name} · 生命读经`,
        items: lrByBook[b].sort((x, y) => (x.articleId - y.articleId) || (x.start - y.start)),
      });
    }
  });
  // 书报分组：倪柝声文集 · 第{辑}辑 · {书名}
  Object.keys(bookByKey).sort().forEach(k => {
    const [series, volume, book] = k.split(':');
    const metaVol = (series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[+volume - 1] : null;
    const metaBook = metaVol && metaVol.books[+book];
    const label = metaBook ? `${(state.bookMeta && state.bookMeta.name) || series} · ${metaVol.title} · ${metaBook.title}` : `${series} · 卷${volume} · 书${+book + 1}`;
    groups.push({
      label,
      items: bookByKey[k].sort((x, y) => (x.chapter - y.chapter) || (x.start - y.start)),
    });
  });
  return groups;
}

function groupHl(list) {
  const groups = [];
  const vs = list.filter(a => a.type === 'verse');
  const lr = list.filter(a => a.type === 'lr');
  const verseByChapter = {};
  vs.forEach(a => { (verseByChapter[a.chapter] = verseByChapter[a.chapter] || []).push(a); });
  Object.keys(verseByChapter).map(Number).sort((a, b) => a - b).forEach(ch => {
    groups.push({ label: `第 ${ch} 章`, items: verseByChapter[ch].sort((x, y) => (x.verse - y.verse) || (x.start - y.start)) });
  });
  if (lr.length) {
    groups.push({ label: '生命读经', items: lr.sort((x, y) => (x.articleId - y.articleId) || (x.start - y.start)) });
  }
  return groups;
}

function renderHighlights(anns, groupFn) {
  const section = document.createElement('div');
  section.className = 'hl-section';
  const header = document.createElement('div');
  header.className = 'hl-header';
  header.textContent = '划线汇总';
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
  const doGroup = groupFn || groupHl;
  // 来源 tab：全部 / 经文 / 生命读经 / 书报
  const tabs = document.createElement('div');
  tabs.className = 'hl-tabs';
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
      const gl = document.createElement('div');
      gl.className = 'hl-group';
      gl.textContent = g.label;
      box.appendChild(gl);
      g.items.forEach(a => box.appendChild(renderHlItem(a)));
    });
  };
  const mkTab = (label, list) => {
    const t = document.createElement('button');
    t.className = 'hl-tab';
    t.textContent = `${label}（${list.length}）`;
    t.addEventListener('click', () => {
      tabs.querySelectorAll('.hl-tab').forEach(x => x.classList.toggle('active', x === t));
      renderList(list);
    });
    return t;
  };
  const tabAll = mkTab('全部', anns);
  const tabsArr = [tabAll, mkTab('经文', verseItems), mkTab('生命读经', lrItems)];
  if (bookItems.length) tabsArr.push(mkTab('书报', bookItems));
  tabs.append(...tabsArr);
  tabAll.classList.add('active');
  section.appendChild(tabs);
  section.appendChild(box);
  renderList(anns);
  return section;
}

function renderHlItem(a) {
  const div = document.createElement('div');
  div.className = 'hl-item';
  const dot = document.createElement('span');
  dot.className = 'hl-dot';
  if (a.underline) {
    dot.style.background = 'transparent';
    dot.style.borderBottom = '2px solid #eb6c05';
  } else {
    dot.style.background = colorBg(a.colorId);
  }
  const text = document.createElement('span');
  text.className = 'hl-text';
  text.textContent = annotationText(a) || '（内容已失效）';
  const loc = document.createElement('span');
  loc.className = 'hl-loc';
  if (a.type === 'verse') loc.textContent = `${a.chapter}:${a.verse}${a.half}`;
  else if (a.type === 'lr') loc.textContent = `生命读经 ${a.articleId}`;
  else if (a.type === 'book') {
    const metaVol = (a.series === 'ni' && state.bookMeta) ? state.bookMeta.volumes[a.volume - 1] : null;
    const metaBook = metaVol && metaVol.books[a.book];
    loc.textContent = metaBook ? `${metaBook.title} · 第${a.chapter + 1}章` : `书报 卷${a.volume}书${a.book + 1} 第${a.chapter + 1}章`;
  }
  div.appendChild(dot);
  div.appendChild(loc);
  div.appendChild(text);
  if (a.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'hl-note';
    noteEl.textContent = '📝 ' + a.note;
    div.appendChild(noteEl);
  }
  div.addEventListener('click', () => { navigateToAnnotation(a); });
  return div;
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
  }
}

// 首页「我的笔记」块：进读经模块研读列，我的笔记 tab 全局模式
async function enterNotesGlobal() {
  await enterModule('bible');
  state.activeTab = 'mynotes';
  state.notesScope = 'global';
  document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
  renderStudy();
  setMobileView('study');
}

/* ============ 生命读经（篇目弹窗 / 卷缓存） ============ */
// 篇目列表弹窗（crumb 点击 / 全局笔记入口），点击 → 统一入口 openLrArticle
async function openLrArticleList(bookIndex) {
  const vol = await ensureLrVolume(bookIndex);
  if (!vol) { showToast('该卷生命读经数据缺失'); return; }
  openPopup(`${vol.name} · 生命读经`, `
    <div class="lr-art-list">
      ${(vol.articles || []).map(a => `
        <button class="lr-art-cell" data-id="${a.id}">${escapeHtml(a.title)}</button>`).join('')}
    </div>`);
  $('popupBody').querySelector('.lr-art-list').addEventListener('click', (e) => {
    const cell = e.target.closest('.lr-art-cell');
    if (!cell) return;
    const art = (vol.articles || []).find(a => a.id === +cell.dataset.id);
    if (!art) return;
    closePopupAll();
    openLrArticle(bookIndex, art);
  });
}

// 加载并缓存某卷生命读经（selectBook 懒加载后也写入同一缓存，见 selectBook）
async function ensureLrVolume(bookIndex) {
  if (state.lrVolumes[bookIndex]) return state.lrVolumes[bookIndex];
  const b = state.books.find(x => x.index === bookIndex);
  if (!b) return null;
  try {
    const data = await fetchJSON(`data/lifereading/${b.acronym}.json`);
    data.bookIndex = bookIndex;
    data.name = b.name;
    state.lrVolumes[bookIndex] = data;
    return data;
  } catch (e) { return null; }
}

/* ============ 生命读经阅读器模块 ============ */
let _lrSpy = null;   // 模块右栏纲目滚动高亮句柄（切篇/切 tab 前解绑防堆积）

// 左栏卷条（66 卷横向紧凑，当前卷 active）
function renderLrVolStrip(curBookIndex) {
  const nav = $('lrNav');
  let strip = nav.querySelector('.lr-vol-strip');
  if (!strip) { strip = document.createElement('div'); strip.className = 'lr-vol-strip'; nav.prepend(strip); }
  strip.innerHTML = state.books.map(b =>
    `<button class="lr-vol-strip-btn${b.index === curBookIndex ? ' active' : ''}" data-b="${b.index}">${escapeHtml(b.acronym)}</button>`).join('');
  strip.querySelectorAll('.lr-vol-strip-btn').forEach(btn => {
    btn.addEventListener('click', () => selectLrVolume(+btn.dataset.b));
  });
}

// 左栏篇目列表（当前卷全部篇，当前篇 active）
function renderLrArticleList(bookIndex, vol) {
  const nav = $('lrNav');
  let list = nav.querySelector('.lr-nav-articles');
  if (!list) { list = document.createElement('div'); list.className = 'lr-nav-articles'; nav.appendChild(list); }
  list.innerHTML = ((vol && vol.articles) || []).map(a =>
    `<button class="lr-nav-art${a.id === state.lrArticleId ? ' active' : ''}" data-id="${a.id}">${escapeHtml(a.title)}</button>`).join('');
  list.querySelectorAll('.lr-nav-art').forEach(btn => {
    btn.addEventListener('click', () => selectLrArticle(+btn.dataset.id));
  });
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
  body.appendChild(renderHighlights(anns));
}

// 同卷切篇：重渲染主区 + 右栏 + crumb + 左栏 active，正文滚顶
async function selectLrArticle(articleId) {
  state.lrArticleId = articleId;
  save(LS_LR_LAST, { book: state.lrBookIndex, articleId });
  document.querySelectorAll('.lr-nav-art').forEach(x => x.classList.toggle('active', +x.dataset.id === articleId));
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
  if (state.activeModule === 'lifereading') {
    if (bookIndex !== state.lrBookIndex) await selectLrVolume(bookIndex);
    if (state.lrArticleId !== art.id) await selectLrArticle(art.id);
  } else {
    await enterModule('lifereading', { bookIndex, articleId: art.id });
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
  try { const data = await fetchJSON(`data/books/${key}-${volume}.json`); vols[volume] = data; return data; }
  catch (e) { return null; }
}

// 左栏系列条（多系列切换，当前系列 active）
function renderBookSeriesStrip() {
  const nav = $('bookNav');
  let strip = nav.querySelector('.bk-series-strip');
  if (!strip) { strip = document.createElement('div'); strip.className = 'bk-series-strip'; nav.prepend(strip); }
  const list = (state.bookSeriesIndex && state.bookSeriesIndex.series) || [];
  if (list.length <= 1) { strip.style.display = 'none'; return; }
  strip.style.display = '';
  strip.innerHTML = list.map(s =>
    `<button class="bk-series-btn${s.id === state.bookSeries ? ' active' : ''}" data-s="${s.id}">${escapeHtml(s.name)}</button>`).join('');
  strip.querySelectorAll('.bk-series-btn').forEach(btn => {
    btn.addEventListener('click', () => selectBookSeries(btn.dataset.s));
  });
}

// 左栏辑条（meta.volumes，当前辑 active）
function renderBookVolStrip() {
  const nav = $('bookNav');
  let strip = nav.querySelector('.bk-vol-strip');
  if (!strip) { strip = document.createElement('div'); strip.className = 'bk-vol-strip'; nav.prepend(strip); }
  strip.innerHTML = (state.bookMeta && state.bookMeta.volumes || []).map((v, i) =>
    `<button class="bk-vol-strip-btn${i + 1 === state.bookVolume ? ' active' : ''}" data-v="${i + 1}">${escapeHtml(v.title)}</button>`).join('');
  strip.querySelectorAll('.bk-vol-strip-btn').forEach(btn => {
    btn.addEventListener('click', () => selectBookVolume(+btn.dataset.v));
  });
}

// 左栏书列表（当前辑全部书，当前书 active）
function renderBookNavBooks() {
  const nav = $('bookNav');
  let list = nav.querySelector('.bk-nav-books');
  if (!list) { list = document.createElement('div'); list.className = 'bk-nav-books'; nav.appendChild(list); }
  const metaVol = state.bookMeta && state.bookMeta.volumes[state.bookVolume - 1];
  list.innerHTML = (metaVol && metaVol.books || []).map((b, i) =>
    `<button class="bk-nav-book${i === state.bookBook ? ' active' : ''}" data-b="${i}">
       <span class="bkb-title">${escapeHtml(b.title)}</span>
       <span class="bkb-count">${b.chapters.length}章</span>
     </button>`).join('');
  list.querySelectorAll('.bk-nav-book').forEach(btn => {
    btn.addEventListener('click', () => selectBookItem(+btn.dataset.b));
  });
}

// 主区：当前章正文（按行 data-base 渲染，标注坐标系 = chapter.content）
function renderBookContent(parent, content, annotations) {
  const lines = (content || '').split('\n');
  let offset = 0;
  for (const line of lines) {
    if (line.trim() === '') { offset += line.length + 1; continue; }
    const div = document.createElement('div');
    div.className = 'bk-para';
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
  renderBookContent(content, ch.content || '', anns);
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
  body.appendChild(renderHighlights(anns));
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
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 切章（同书内）
async function selectBookChapter(volume, book, chapter) {
  state.bookVolume = volume; state.bookBook = book; state.bookChapter = chapter;
  save(LS_BOOK_LAST, { series: state.bookSeries, volume, book, chapter });
  document.querySelectorAll('.bk-vol-strip-btn').forEach(x => x.classList.toggle('active', +x.dataset.v === volume));
  document.querySelectorAll('.bk-nav-book').forEach(x => x.classList.toggle('active', +x.dataset.b === book));
  const mod = READER_MODULES.books;
  await mod.renderMain();
  mod.renderSide();
  mod.renderCrumb();
  $('textCol').scrollTop = 0;
}

// 统一入口（首页块 / 搜索 / 全局笔记）：模块内切章，模块外进模块
async function openBookChapter(volume, book, chapter, series) {
  if (state.activeModule === 'books') {
    if (series && series !== state.bookSeries) await selectBookSeries(series);
    if (volume !== state.bookVolume || book !== state.bookBook || chapter !== state.bookChapter) {
      await selectBookChapter(volume, book, chapter);
    }
  } else {
    await enterModule('books', { series, volume, book, chapter });
  }
}

/* ============ 标注 ============ */
let pendingRange = null;
let editingAnnId = null;

function bindEvents() {
  // 首页：合集块点击 + 顶部搜索 + ⌂ 回首页
  bindHomeEvents();
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
  $('notesBtn').addEventListener('click', () => {
    if (state.screen === 'home') enterWork();   // 桌面端从首页点 ✎ → 先进工作区
    $('studyCol').classList.toggle('open');
    if (state.viewMode === 'full') {
      state.viewMode = 'default';
      applyLayout();
      save(LS_VIEW_MODE, state.viewMode);
    }
    state.activeTab = 'mynotes';
    state.notesScope = 'chapter';
    document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
    renderStudy();
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
      if (tab.dataset.tab === 'mynotes') state.notesScope = 'chapter';
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
  // 生命读经/书报：行 div 带 data-base（该行在源 content 的偏移，含空行），
  // 选区偏移 = 行基址 + 行内偏移，与渲染 baseOffset / 自愈 plain 同一坐标系
  if (root.classList.contains('lr-content') || root.classList.contains('book-content')) {
    let div = node.nodeType === 3 ? node.parentElement : node;
    while (div && div.parentElement !== root) div = div.parentElement;
    if (div && div.parentElement === root && div.dataset.base !== undefined) {
      const base = +div.dataset.base;
      walkInner(div);
      return done ? base + count : base;
    }
  }
  const isBlock = (el) => el.nodeType === 1 &&
    (el.classList.contains('lr-head') || el.classList.contains('lr-para') || el.classList.contains('bk-para'));
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
  }
  return {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    book: r.type === 'verse' || r.type === 'lr' ? state.currentBook.index : (r.volume || 0),
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
  if (ann.type === 'verse') {
    withScrollPreserved(['#textCol', '#studyBody', '.lr-full-content'], () => {
      renderChapter();
      if (state.activeTab === 'mynotes') renderStudy();
    });
  } else if (ann.type === 'lr') {
    withScrollPreserved(['#studyBody', '#textCol', '.lr-full-content'], renderStudy);
  } else if (ann.type === 'book') {
    // 书报模块内标注：重渲染主区保持高亮
    withScrollPreserved(['#textCol'], () => {
      if (state.activeModule === 'books') READER_MODULES.books.renderMain();
    });
  }
}

/* ============ 笔记编辑器（textarea 模态框，移植晨读 §5.3） ============ */
let noteEditorState = null; // {mode:'create', range} | {mode:'edit', annId}

function openNoteEditor(initial) {
  $('noteTextarea').value = initial || '';
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
  openNoteEditor('');
}
// 编辑已有标注的笔记
function editNote(annId) {
  const ann = state.annotations.find(a => a.id === annId);
  noteEditorState = { mode: 'edit', annId };
  hideMarkTool();
  openNoteEditor(ann ? ann.note || '' : '');
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
  openPopup(`${key} 注${n}`, `<div class="fn-body">${linkifyRefs(note)}</div>`);
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
  // 简称别名
  '但以理':'但','以西结':'结','以赛亚':'赛','耶利米':'耶','出埃及':'出','腓立比':'腓','以弗所':'弗','歌罗西':'西','加拉太':'加','马太':'太','约翰':'约','罗马':'罗','哀歌':'哀','行传':'徒','雅各':'雅',
  '约一':'约壹','约二':'约贰','约三':'约参',
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
  const tokens = (raw || '').split(/[，,、;；\s]+/).filter(Boolean);
  const out = [];
  let curAcronym = null, curChapter = null;
  // 单节 key 入列；整节不存在时兼容上下半节 key（如 创25:9 只有 创25:9上/下）
  const pushKey = (key) => {
    const bt = state.bibleText || {};
    if (bt[key]) out.push(key);
    else if (bt[key + '上']) out.push(key + '上');
    else if (bt[key + '下']) out.push(key + '下');
    else out.push(key); // bibleText 未加载时兜底，弹窗会过滤不存在的节
  };
  for (const token of tokens) {
    let matched = null;
    for (const alias of _refAliasesSorted) {
      if (token.startsWith(alias)) { matched = { acronym: REF_ALIASES[alias], rest: token.slice(alias.length) }; break; }
    }
    if (matched) {
      curAcronym = matched.acronym;
      const r = parseRefTail(matched.acronym, matched.rest, null);
      if (r) {
        // 节范围（如 9～10、19～26）展开为单节 key
        if (r.range) for (let v = r.range[0]; v <= r.range[1]; v++) pushKey(`${matched.acronym}${r.chapter}:${v}`);
        else if (r.key) pushKey(r.key);
        if (r.chapter) curChapter = r.chapter;
      }
    } else if (curAcronym) {
      // 相对引用：纯数字节（2）或 中文章+阿拉伯节（三9）
      const m = token.match(/^(\d+)$/);
      if (m && curChapter) { pushKey(`${curAcronym}${curChapter}:${m[1]}`); continue; }
      const m2 = token.match(/^([一二三四五六七八九十百〇○]+)(\d+)$/);
      if (m2) {
        const ch = cnToInt(m2[1]);
        if (ch) { pushKey(`${curAcronym}${ch}:${m2[2]}`); curChapter = ch; }
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
  // 中文章节式（三章十九节）
  m = rest.match(/^第?([一二三四五六七八九十百〇○]+)章([一二三四五六七八九十百〇○]+)节$/);
  if (m) {
    const ch = cnToInt(m[1]), v = cnToInt(m[2]);
    if (ch && v) return { key: `${acronym}${ch}:${v}${half}`, chapter: ch };
  }
  // 纯章号（约一1 → 约壹 第1章，节由后续 token 提供）
  m = rest.match(/^(\d+)$/);
  if (m) return { key: null, chapter: +m[1] };
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
  const tail = '(?:\\d+:\\d+(?:[-~～]\\d+)?|[' + cn + ']+\\d+(?:[-~～]\\d+)?[上下]?|第?[' + cn + ']+章[' + cn + ']+节)';
  return new RegExp('(' + aliasAlt + ')' + tail, 'g');
}

function detectRefs(text) {
  const re = buildRefRegex();
  const refs = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    refs.push({ start: m.index, end: m.index + m[0].length, refText: m[0] });
  }
  return refs;
}

// 纯文本 → HTML，把经文引用包成 <span class="ref-link">
function linkifyRefs(text) {
  const refs = detectRefs(text || '');
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
function renderLrLine(parent, text, baseOffset, annotations) {
  const refs = detectRefs(text || '');
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

function renderLrContent(parent, content, annotations, idPrefix) {
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
    renderLrLine(div, line, offset, annotations);
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
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
