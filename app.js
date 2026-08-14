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

const state = {
  books: [],            // [{index, name, acronym, chapters}]
  bookIndexByIdx: {},   // acronym+index -> book
  currentBook: null,
  currentChapter: null,
  bibleText: null,      // {key: markedText}
  bibleNotes: null,     // {key: [notes]}
  bibleXrefs: null,     // {key: {letter: rawString}}
  lifereading: null,    // {articles: [...]} 当前书卷
  annotations: load(LS_ANNOTATIONS, []),
  chapterNotes: load(LS_CHAPTER_NOTES, {}),
  hideMarks: load(LS_HIDE_MARKS, false),
  activeTab: 'notes',
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function applyHideMarks() {
  document.body.classList.toggle('hide-marks', state.hideMarks);
  $('hideMarksBtn').textContent = state.hideMarks ? '显示注号' : '隐藏注号';
  $('hideMarksBtn').classList.toggle('active', state.hideMarks);
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
  const last = load(LS_LAST, null);
  if (last && state.books.some(b => b.index === last.book)) {
    selectBook(last.book, last.chapter);
  } else {
    selectBook(1, 1);
  }
  bindEvents();
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

async function selectBook(index, chapter) {
  state.currentBook = state.books.find(b => b.index === index);
  state.currentChapter = chapter;
  state.lifereading = null; // 重新加载新书卷生命读经
  renderChapterList();
  highlightNav();
  $('bookName').textContent = state.currentBook.name;
  $('chapterLabel').textContent = `第 ${chapter} 章`;
  save(LS_LAST, { book: index, chapter });
  await ensureBibleData();
  await selectChapter(chapter);
}

async function selectChapter(chapter) {
  state.currentChapter = chapter;
  $('chapterLabel').textContent = `第 ${chapter} 章`;
  highlightNav();
  renderChapter();
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
  const [text, notes, xrefs] = await Promise.all([
    fetchJSON('data/bible-text.json'),
    fetchJSON('data/bible-notes.json'),
    fetchJSON('data/bible-xrefs.json'),
  ]);
  state.bibleText = text;
  state.bibleNotes = notes;
  state.bibleXrefs = xrefs;
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

function renderChapter() {
  const container = $('verseContainer');
  container.innerHTML = '';
  const acr = state.currentBook.acronym;
  const ch = state.currentChapter;
  const anns = state.annotations.filter(a => a.book === state.currentBook.index && a.chapter === ch && a.type === 'verse');
  for (let v = 1; v <= 500; v++) {
    for (const half of ['', '上', '下']) {
      const key = `${acr}${ch}:${v}${half}`;
      const marked = state.bibleText[key];
      if (marked === undefined) continue;
      const verseAnns = anns.filter(a => a.verse === v && a.half === half);
      container.appendChild(renderVerse(v + half, marked, verseAnns));
    }
  }
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
    points.add(Math.max(a.start - baseOffset, 0));
    points.add(Math.min(a.end - baseOffset, text.length));
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
        if (a.underline) { mark.className = 'ul'; }
        else { mark.className = a.colorId; mark.style.background = colorBg(a.colorId); }
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
        notes.forEach((note, i) => {
          items.push({ label: `${ch}:${v}${half} 注${i + 1}`, text: note });
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

function renderLifereading() {
  const body = $('studyBody');
  const articles = (state.lifereading && state.lifereading.articles) || [];
  const ch = state.currentChapter;
  const matched = articles.filter(a => {
    if (!a.verses || !a.verses.length) return false;
    return a.verses.some(v => {
      const m = String(v).match(/^(\d+)/);
      return m && +m[1] === ch;
    });
  });
  if (!matched.length) {
    body.innerHTML = '<div class="empty-hint">本章暂无相关生命读经</div>';
    return;
  }
  matched.forEach(a => {
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
    renderLrContent(content, a.content || '', lrAnns);
    div.appendChild(content);
    body.appendChild(div);
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
  // 划线汇总（当前书卷全部标注，点击跳回原文）
  const highlights = state.annotations.filter(a => a.book === state.currentBook.index);
  body.appendChild(renderHighlights(highlights));
}

function renderHighlights(anns) {
  const section = document.createElement('div');
  section.className = 'hl-section';
  const header = document.createElement('div');
  header.className = 'hl-header';
  header.textContent = `划线汇总（${anns.length}）`;
  section.appendChild(header);
  if (!anns.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '划线的经文或生命读经会汇总在这里，点击可跳回原文';
    section.appendChild(hint);
    return section;
  }
  // 分组：经文按章，生命读经单列
  const groups = [];
  const lrItems = anns.filter(a => a.type === 'lr');
  const verseItems = anns.filter(a => a.type === 'verse');
  const verseByChapter = {};
  verseItems.forEach(a => { (verseByChapter[a.chapter] = verseByChapter[a.chapter] || []).push(a); });
  Object.keys(verseByChapter).map(Number).sort((a, b) => a - b).forEach(ch => {
    groups.push({ label: `第 ${ch} 章`, items: verseByChapter[ch].sort((x, y) => (x.verse - y.verse) || (x.start - y.start)) });
  });
  if (lrItems.length) {
    groups.push({ label: '生命读经', items: lrItems.sort((x, y) => (x.articleId - y.articleId) || (x.start - y.start)) });
  }
  groups.forEach(g => {
    const gl = document.createElement('div');
    gl.className = 'hl-group';
    gl.textContent = g.label;
    section.appendChild(gl);
    g.items.forEach(a => section.appendChild(renderHlItem(a)));
  });
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
  if (a.type === 'verse') {
    const key = `${state.currentBook.acronym}${a.chapter}:${a.verse}${a.half || ''}`;
    const marked = (state.bibleText || {})[key];
    if (!marked) return '';
    return parseMarkedText(marked).plain.slice(a.start, a.end);
  }
  const art = (state.lifereading && state.lifereading.articles.find(x => x.id === a.articleId)) || null;
  if (!art) return '';
  return (art.content || '').slice(a.start, a.end);
}

function jumpToVerse(chapter, verse, half) {
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
  // 菜单（移动端导航）
  $('menuBtn').addEventListener('click', () => $('navCol').classList.toggle('open'));
  $('notesBtn').addEventListener('click', () => {
    $('studyCol').classList.toggle('open');
    state.activeTab = 'mynotes';
    document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
    renderStudy();
  });
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
  // 选区标注
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('mousedown', (e) => {
    const tool = $('floatTool');
    if (tool.hidden) return;
    if (!tool.contains(e.target)) hideFloatTool();
  });
  // 弹窗关闭
  $('popupClose').addEventListener('click', closePopup);
  $('overlay').addEventListener('click', closePopup);
  // 注脚/串珠点击（事件委托）
  document.addEventListener('click', onContentClick);
}

function onContentClick(e) {
  const fn = e.target.closest('sup.fn-ref');
  if (fn) {
    e.stopPropagation();
    showFootnotePopup(fn.dataset.fn);
    return;
  }
  const xr = e.target.closest('sup.xref-ref');
  if (xr) {
    e.stopPropagation();
    showXrefPopup(xr.dataset.xref);
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
  const plain = ctx.context.type === 'verse' ? ctx.el.dataset.plain : ctx.el.textContent;
  pendingRange = { start, end, plain, ...ctx.context };
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

function plainOffset(vtext, node, offset) {
  let count = 0, done = false;
  function walk(el) {
    for (const child of el.childNodes) {
      if (done) return;
      if (child === node && child.nodeType === 3) {
        count += offset;
        done = true;
        return;
      }
      if (child.nodeType === 3) count += child.textContent.length;
      else if (child.nodeType === 1 && child.tagName !== 'SUP') walk(child);
    }
  }
  walk(vtext);
  return count;
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
    sw.addEventListener('mousedown', (e) => { e.preventDefault(); applyColor(c.id); });
    tool.appendChild(sw);
  });
  const sep = document.createElement('div');
  sep.className = 'tool-sep';
  tool.appendChild(sep);
  // 下划线
  const ul = document.createElement('button');
  ul.className = 'tool-btn';
  ul.textContent = '下划线';
  ul.addEventListener('mousedown', (e) => { e.preventDefault(); applyUnderline(); });
  tool.appendChild(ul);
  // 笔记
  const nb = document.createElement('button');
  nb.className = 'tool-btn';
  nb.textContent = '加笔记';
  nb.addEventListener('mousedown', (e) => { e.preventDefault(); addNote(); });
  tool.appendChild(nb);
  const sep2 = document.createElement('div');
  sep2.className = 'tool-sep';
  tool.appendChild(sep2);
  // 引用到笔记
  const qt = document.createElement('button');
  qt.className = 'tool-btn';
  qt.textContent = '引用到笔记';
  qt.title = '把选中文字（带出处）追加到本章笔记';
  qt.addEventListener('mousedown', (e) => { e.preventDefault(); quoteToNotes(); });
  tool.appendChild(qt);
  // 复制纯文本（自动过滤注号）
  const cp = document.createElement('button');
  cp.className = 'tool-btn';
  cp.textContent = '复制';
  cp.title = '复制纯文本（不含注号）';
  cp.addEventListener('mousedown', (e) => { e.preventDefault(); copyPlainText(); });
  tool.appendChild(cp);
  // 定位
  const x = rect.left + rect.width / 2 - tool.offsetWidth / 2;
  const y = rect.top - tool.offsetHeight - 8;
  tool.style.left = Math.max(8, x) + 'px';
  tool.style.top = Math.max(8, y) + 'px';
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

function hideFloatTool() { $('floatTool').hidden = true; pendingRange = null; editingAnnId = null; }

function addAnnotation(partial) {
  const r = pendingRange;
  if (!r) return;
  const ann = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    book: state.currentBook.index,
    type: r.type,
    start: r.start,
    end: r.end,
    createdAt: Date.now(),
    ...(r.type === 'verse'
      ? { chapter: state.currentChapter, verse: r.verse, half: r.half }
      : { articleId: r.articleId }),
    ...partial,
  };
  state.annotations.push(ann);
  save(LS_ANNOTATIONS, state.annotations);
  renderChapter();
  renderStudy();
  hideFloatTool();
}

function applyColor(colorId) { addAnnotation({ colorId, underline: false }); }
function applyUnderline() { addAnnotation({ underline: true, colorId: null }); }
function addNote() {
  const r = pendingRange;
  if (!r) return;
  const note = prompt('输入笔记：');
  if (note) addAnnotation({ note, colorId: null, underline: false });
  else hideFloatTool();
}

/* ============ 标注编辑（改色/删除） ============ */
function showMarkTool(mark, annId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  editingAnnId = annId;
  const tool = $('floatTool');
  tool.hidden = false;
  tool.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = `sw ${c.id}` + (ann.colorId === c.id && !ann.underline ? ' active' : '');
    sw.title = `${c.name}：${c.desc}`;
    sw.addEventListener('mousedown', (e) => { e.preventDefault(); changeAnnColor(annId, c.id); });
    tool.appendChild(sw);
  });
  const sep = document.createElement('div');
  sep.className = 'tool-sep';
  tool.appendChild(sep);
  const del = document.createElement('button');
  del.className = 'tool-btn';
  del.textContent = '删除';
  del.addEventListener('mousedown', (e) => { e.preventDefault(); deleteAnn(annId); });
  tool.appendChild(del);
  const rect = mark.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - tool.offsetWidth / 2;
  const y = rect.top - tool.offsetHeight - 8;
  tool.style.left = Math.max(8, x) + 'px';
  tool.style.top = Math.max(8, y) + 'px';
}

function changeAnnColor(annId, colorId) {
  const ann = state.annotations.find(a => a.id === annId);
  if (!ann) return;
  ann.colorId = colorId;
  ann.underline = false;
  save(LS_ANNOTATIONS, state.annotations);
  renderChapter();
  renderStudy();
  hideFloatTool();
}

function deleteAnn(annId) {
  state.annotations = state.annotations.filter(a => a.id !== annId);
  save(LS_ANNOTATIONS, state.annotations);
  renderChapter();
  renderStudy();
  hideFloatTool();
}

/* ============ 弹窗 ============ */
function openPopup(title, bodyHtml) {
  $('popupTitle').textContent = title;
  $('popupBody').innerHTML = bodyHtml;
  $('popup').hidden = false;
  $('overlay').hidden = false;
}
function closePopup() {
  $('popup').hidden = true;
  $('overlay').hidden = true;
}

function showFootnotePopup(n) {
  // 定位点击所在节
  const sup = document.querySelector(`sup.fn-ref[data-fn="${n}"]`);
  let key = null;
  if (sup) {
    const vtext = sup.closest('.vtext');
    const verseNum = vtext.dataset.verse.replace(/[上中下]/g, '');
    const half = vtext.dataset.verse.match(/[上中下]/)?.[0] || '';
    key = `${state.currentBook.acronym}${state.currentChapter}:${verseNum}${half}`;
  }
  const notes = key ? (state.bibleNotes || {})[key] : null;
  if (!notes || !notes[+n - 1]) { openPopup(`注${n}`, '<div class="empty-hint">未找到注解</div>'); return; }
  const note = notes[+n - 1];
  openPopup(`${state.currentBook.name} ${state.currentChapter} 注${n}`, `<div class="fn-body">${linkifyRefs(note)}</div>`);
}

function showXrefPopup(letter) {
  const sup = document.querySelector(`sup.xref-ref[data-xref="${letter}"]`);
  let key = null;
  if (sup) {
    const vtext = sup.closest('.vtext');
    const verseNum = vtext.dataset.verse.replace(/[上中下]/g, '');
    const half = vtext.dataset.verse.match(/[上中下]/)?.[0] || '';
    key = `${state.currentBook.acronym}${state.currentChapter}:${verseNum}${half}`;
  }
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
  for (const token of tokens) {
    let matched = null;
    for (const alias of _refAliasesSorted) {
      if (token.startsWith(alias)) { matched = { acronym: REF_ALIASES[alias], rest: token.slice(alias.length) }; break; }
    }
    if (matched) {
      curAcronym = matched.acronym;
      const r = parseRefTail(matched.acronym, matched.rest, null);
      if (r) {
        if (r.key) out.push(r.key);
        if (r.chapter) curChapter = r.chapter;
      }
    } else if (curAcronym) {
      // 相对引用：纯数字节（2）或 中文章+阿拉伯节（三9）
      const m = token.match(/^(\d+)$/);
      if (m && curChapter) { out.push(`${curAcronym}${curChapter}:${m[1]}`); continue; }
      const m2 = token.match(/^([一二三四五六七八九十百〇○]+)(\d+)$/);
      if (m2) {
        const ch = cnToInt(m2[1]);
        if (ch) { out.push(`${curAcronym}${ch}:${m2[2]}`); curChapter = ch; }
      }
    }
  }
  return out;
}

function parseRefTail(acronym, rest, defChapter) {
  rest = (rest || '').trim();
  if (!rest) return null;
  // 章:节（阿拉伯）1:2 / 1:2-3
  let m = rest.match(/^(\d+):(\d+)(?:[-~](\d+))?$/);
  if (m) {
    const ch = m[1];
    const key = m[3] ? `${acronym}${ch}:${m[2]}-${m[3]}` : `${acronym}${ch}:${m[2]}`;
    return { key, chapter: +ch };
  }
  // 中文章 + 阿拉伯节（十二1 / 十二1-3）
  m = rest.match(/^([一二三四五六七八九十百〇○]+)(\d+)(?:[-~](\d+))?$/);
  if (m) {
    const ch = cnToInt(m[1]);
    if (ch) {
      const key = m[3] ? `${acronym}${ch}:${m[2]}-${m[3]}` : `${acronym}${ch}:${m[2]}`;
      return { key, chapter: ch };
    }
  }
  // 中文章节式（三章十九节）
  m = rest.match(/^第?([一二三四五六七八九十百〇○]+)章([一二三四五六七八九十百〇○]+)节$/);
  if (m) {
    const ch = cnToInt(m[1]), v = cnToInt(m[2]);
    if (ch && v) return { key: `${acronym}${ch}:${v}`, chapter: ch };
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
  const tail = '(?:\\d+:\\d+(?:[-~～]\\d+)?|[' + cn + ']+\\d+(?:[-~～]\\d+)?[上下]?|第?[' + cn + ']+章[' + cn + ']+节|[' + cn + ']+)';
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
function renderLrContent(parent, content, annotations) {
  const refs = detectRefs(content || '');
  let cursor = 0;
  const appendText = (text, base) => {
    if (!annotations.length) parent.appendChild(document.createTextNode(text));
    else renderTextWithMarks(parent, text, base, annotations);
  };
  for (const r of refs) {
    if (r.start > cursor) appendText(content.slice(cursor, r.start), cursor);
    const span = document.createElement('span');
    span.className = 'ref-link';
    span.textContent = content.slice(r.start, r.end);
    span.dataset.refs = r.refText;
    parent.appendChild(span);
    cursor = r.end;
  }
  if (cursor < content.length) appendText(content.slice(cursor), cursor);
}

function showRefsPopup(title, refString) {
  const refs = resolveRefString(refString);
  let html = `<div style="color:var(--text-muted);font-size:13px;margin-bottom:8px">${escapeHtml(refString)}</div>`;
  let found = 0;
  for (const ref of refs) {
    const verseText = state.bibleText[ref];
    if (verseText) {
      const { plain } = parseMarkedText(verseText);
      html += `<div class="popup-verse"><span class="pv-ref">${escapeHtml(ref)}</span><span class="pv-text">${escapeHtml(plain)}</span></div>`;
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
