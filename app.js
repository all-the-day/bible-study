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
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
// 云同步客户端（sync.js 加载失败时静默降级为纯本地）
const Sync = window.BibleStudySync || null;
const SYNC_KEYS = [LS_ANNOTATIONS, LS_CHAPTER_NOTES];

function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  if (Sync && SYNC_KEYS.includes(key)) {
    Sync.putRemote(key, val);
  }
}

// 启动时后台同步：服务器为主，成功后覆盖本地；再重试离线未推送的改动
async function syncFromRemote() {
  if (!Sync) return;
  await Sync.pullAll(SYNC_KEYS);
  state.annotations = load(LS_ANNOTATIONS, []);
  state.chapterNotes = load(LS_CHAPTER_NOTES, {});
  Sync.flushPending((key) => {
    if (key === LS_ANNOTATIONS) return state.annotations;
    if (key === LS_CHAPTER_NOTES) return state.chapterNotes;
    return undefined;
  });
  renderChapter();
  renderStudy();
}

function updateSyncStatus() {
  const el = $('syncStatus');
  if (!el) return;
  if (!Sync) { el.className = 'sync-status'; el.title = '云同步不可用'; return; }
  if (Sync.hasPending()) { el.className = 'sync-status pending'; el.title = '有改动待同步'; }
  else if (Sync.isRemoteOk()) { el.className = 'sync-status ok'; el.title = '已同步到云端'; }
  else { el.className = 'sync-status offline'; el.title = '离线（本地保存）'; }
}

function applyHideMarks() {
  document.body.classList.toggle('hide-marks', state.hideMarks);
  const label = state.hideMarks ? '显示注号' : '隐藏注号';
  $('hideMarksBtn').textContent = label;
  $('hideMarksBtn').classList.toggle('active', state.hideMarks);
  $('moreHideMarks').textContent = label;
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
  const last = load(LS_LAST, null);
  if (last && state.books.some(b => b.index === last.book)) {
    selectBook(last.book, last.chapter);
  } else {
    selectBook(1, 1);
  }
  bindEvents();
  // 云同步：状态指示 + 后台拉取服务器数据
  if (Sync) Sync.onStatus(updateSyncStatus);
  updateSyncStatus();
  syncFromRemote();
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
  save(LS_LAST, { book: state.currentBook.index, chapter });
  // 生命读经懒加载
  if (!state.lifereading) {
    const acr = state.currentBook.acronym;
    try {
      state.lifereading = await fetchJSON(`data/lifereading/${acr}.json`);
    } catch (e) { state.lifereading = { articles: [] }; }
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
function renderLrArticle(a) {
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
  const lrAnns = state.annotations.filter(x =>
    x.type === 'lr' && x.book === state.currentBook.index && x.articleId === a.id);
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
function bindLrOutlineSpy(contentArea, outline) {
  contentArea.addEventListener('scroll', () => {
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
  });
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

function renderHighlights(anns) {
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
  // 来源 tab：全部 / 经文 / 生命读经
  const tabs = document.createElement('div');
  tabs.className = 'hl-tabs';
  const box = document.createElement('div');
  const renderList = (list) => {
    box.innerHTML = '';
    const groups = groupHl(list);
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
  loc.textContent = a.type === 'verse' ? `${a.chapter}:${a.verse}${a.half}` : `生命读经 ${a.articleId}`;
  div.appendChild(dot);
  div.appendChild(loc);
  div.appendChild(text);
  if (a.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'hl-note';
    noteEl.textContent = '📝 ' + a.note;
    div.appendChild(noteEl);
  }
  div.addEventListener('click', () => {
    if (a.type === 'verse') jumpToVerse(a.chapter, a.verse, a.half);
    else jumpToLr(a.articleId);
  });
  return div;
}

function annotationText(a) {
  let slice = '';
  if (a.type === 'verse') {
    const key = `${state.currentBook.acronym}${a.chapter}:${a.verse}${a.half || ''}`;
    const marked = (state.bibleText || {})[key];
    if (!marked) return a.text || '';
    slice = parseMarkedText(marked).plain.slice(a.start, a.end);
  } else {
    const art = (state.lifereading && state.lifereading.articles.find(x => x.id === a.articleId)) || null;
    if (!art) return a.text || '';
    slice = (art.content || '').slice(a.start, a.end);
  }
  // 偏移失效时退回保存的文本快照（自愈前的兜底）
  return (a.text && slice !== a.text) ? a.text : slice;
}

/* ============ 移动端单视图切换（读经 / 研读） ============ */
function isMobile() { return window.innerWidth <= 900; }

// 移动端同一时刻只显示一个视图：读经（经文）或研读（注解/生命读经/我的笔记）
// 桌面端调用为 no-op（body 类无 CSS 效果，按钮也被媒体查询隐藏）
function setMobileView(view) {
  if (!isMobile()) return;
  document.body.classList.toggle('mobile-study', view === 'study');
  document.querySelectorAll('#mobileNav .mnav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
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

/* ============ 标注 ============ */
let pendingRange = null;
let editingAnnId = null;

function bindEvents() {
  // 隐藏/显示注号
  $('hideMarksBtn').addEventListener('click', () => {
    state.hideMarks = !state.hideMarks;
    applyHideMarks();
    save(LS_HIDE_MARKS, state.hideMarks);
  });
  // 菜单：移动端开抽屉，桌面端折叠左栏
  $('menuBtn').addEventListener('click', () => {
    if (window.innerWidth <= 900) {
      $('navCol').classList.toggle('open');
    } else {
      state.navCollapsed = !state.navCollapsed;
      applyLayout();
      save(LS_NAV_COLLAPSED, state.navCollapsed);
    }
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
    $('studyCol').classList.toggle('open');
    if (state.viewMode === 'full') {
      state.viewMode = 'default';
      applyLayout();
      save(LS_VIEW_MODE, state.viewMode);
    }
    state.activeTab = 'mynotes';
    document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
    renderStudy();
  });
  // 反馈弹窗
  $('feedbackBtn').addEventListener('click', openFeedbackModal);
  // 移动端底部导航：读经 / 研读 + 章节翻页
  document.querySelectorAll('#mobileNav .mnav-btn[data-view]').forEach(b => {
    b.addEventListener('click', () => setMobileView(b.dataset.view));
  });
  $('mPrevBtn').addEventListener('click', () => {
    if (state.currentChapter > 1) selectChapter(state.currentChapter - 1);
  });
  $('mNextBtn').addEventListener('click', () => {
    if (state.currentChapter < state.currentBook.chapters) selectChapter(state.currentChapter + 1);
  });
  // 移动端「更多」菜单：隐藏注号 / 反馈
  $('moreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('moreMenu').hidden = !$('moreMenu').hidden;
  });
  $('moreHideMarks').addEventListener('click', () => {
    state.hideMarks = !state.hideMarks;
    applyHideMarks();
    save(LS_HIDE_MARKS, state.hideMarks);
    $('moreMenu').hidden = true;
  });
  $('moreFeedback').addEventListener('click', () => {
    $('moreMenu').hidden = true;
    openFeedbackModal();
  });
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
  // 研读 tab
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
    const more = $('moreMenu');
    if (!more.hidden && !more.contains(e.target) && !$('moreBtn').contains(e.target)) more.hidden = true;
  });
  document.addEventListener('touchstart', (e) => {
    const tool = $('floatTool');
    if (!tool.hidden && !tool.contains(e.target)) hideFloatTool();
    const mk = $('markTool');
    if (!mk.hidden && !mk.contains(e.target)) hideMarkTool();
    const more = $('moreMenu');
    if (!more.hidden && !more.contains(e.target) && !$('moreBtn').contains(e.target)) more.hidden = true;
  }, { passive: true });
  // 滚动/键盘关闭菜单（移植晨读 §9）
  window.addEventListener('scroll', () => { hideFloatTool(); hideMarkTool(); $('moreMenu').hidden = true; }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideFloatTool(); hideMarkTool(); $('moreMenu').hidden = true; cancelNoteEditor(); }
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
  } else {
    const art = ((state.lifereading || {}).articles || []).find(a => a.id === ctx.context.articleId);
    plain = art ? (art.content || '') : ctx.el.textContent;
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
        return { el, context: { type: 'lr', articleId: +el.dataset.article } };
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
  // 生命读经：行 div 带 data-base（该行在源 content 的偏移，含空行），
  // 选区偏移 = 行基址 + 行内偏移，与渲染 baseOffset / 自愈 plain 同一坐标系
  if (root.classList.contains('lr-content')) {
    let div = node.nodeType === 3 ? node.parentElement : node;
    while (div && div.parentElement !== root) div = div.parentElement;
    if (div && div.parentElement === root && div.dataset.base !== undefined) {
      const base = +div.dataset.base;
      walkInner(div);
      return done ? base + count : base;
    }
  }
  const isBlock = (el) => el.nodeType === 1 &&
    (el.classList.contains('lr-head') || el.classList.contains('lr-para'));
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
  return {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    book: state.currentBook.index,
    type: r.type,
    start: r.start,
    end: r.end,
    createdAt: Date.now(),
    // TextQuoteSelector 自愈锚点：文本快照 + 前后上下文
    text: r.text || '',
    prefix: r.prefix || '',
    suffix: r.suffix || '',
    ...(r.type === 'verse'
      ? { chapter: state.currentChapter, verse: r.verse, half: r.half }
      : { articleId: r.articleId }),
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
  } else {
    withScrollPreserved(['#studyBody', '#textCol', '.lr-full-content'], renderStudy);
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

/* ============ 启动 ============ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
