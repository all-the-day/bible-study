/**
 * ui-spec/jsx/screens.jsx — 屏幕组合（设计文档，非可构建代码）
 * ---------------------------------------------------------------------------
 * 用 components.jsx 的组件拼出 6 张核心屏，验证「同组件跨屏复用」。
 * 断点行为标注见 ui-spec/docs/02-layout.md。
 */

/* ── 屏 1 · 首页 ──────────────────────────────────────────────── */
/** ☰ 隐藏 · 搜索 + 合集块网格 + 最近阅读 · 书报二级合集层同构复用 */
const HomeScreen = ({ recent }) => (
  <body className="home">
    <Topbar crumb="读经研读笔记" showMenu={false} showTypo={false}>
      {/* 右侧只留设置，无模块控件 */}
    </Topbar>
    <main className="home-wrap">
      <SearchInput placeholder="搜索全部内容…" scope="global" />
      <div className="home-grid">
        <HomeBlock icon={{ emoji: "📖", line: "book" }}      title="读经"     sub="66 卷 · 恢复本"     href="#/bible" />
        <HomeBlock icon={{ emoji: "Layers", line: "layers" }} title="生命读经" sub="2,000+ 篇"        href="#/lifereading" />
        <HomeBlock icon={{ emoji: "📚", line: "stack" }}      title="书报"     sub="32 系列 · 551 本"  href="#/books" />
        <HomeBlock icon={{ emoji: "✍️", line: "volumes" }}    title="倪文集"   sub="3 辑 62 本"       href="#/books/ni" />
        <HomeBlock icon={{ emoji: "🎧", line: "headphones" }} title="听书"     sub="1 合集 · 41 讲"    href="#/audio" />
        <HomeBlock icon={{ emoji: "📝", line: "notebook" }}   title="我的笔记" sub="五类 + 专题"      href="#/notes" />
        <HomeBlock icon={{ emoji: "🏃", line: "check" }}      title="活力八"   sub="作业单"           href="#/topic/vitality8" />
      </div>
      <RecentList items={recent} />
    </main>
  </body>
);

/* ── 屏 2 · 读经（三栏阅读器，四阅读模块同壳） ──────────────────── */
/** ≥1200：停靠 220 | 1fr | 480 · <1200：抽屉浮层 · ≤900：研读列收起走顶栏 pill */
const BibleReaderScreen = () => (
  <>
    <Topbar crumb={<>创世记 <span className="ch-label">1章</span></>}>
      <Segment skin="brand" value="read"
               options={[{ value: "read", label: "读经" }, { value: "study", label: "研读" }]} />
    </Topbar>
    <NavDrawer docked
      level1={[{ id: "ge", label: "创世记", cur: true }, { id: "ex", label: "出埃及记" }]}
      level2={[{ id: "ge-1", label: "第一章", cur: true }, { id: "ge-2", label: "第二章" }]}
      segment={[{ value: "ot", label: "旧约" }, { value: "nt", label: "新约", cur: true }]} />
    <main className="layout">
      <div className="text-col">
        <OutlineItem level={1}>壹 神的创造 —1～二25</OutlineItem>
        <OutlineItem level={2}>一 神的心愿和目的 —1～二3</OutlineItem>
        <VerseCard verses={[{
          num: 1,
          rich: [
            { type: "text",  text: "" },
            { type: "mark",  color: 2, offset: 3, text: "起初，神" },
            { type: "fn",    label: "注1", offset: 7 },
            { type: "text",  text: "创造" },
            { type: "string", label: "a", offset: 10 },
            { type: "text",  text: "诸天与地，" },
          ],
        }, {
          num: 3,
          rich: [
            { type: "text", text: "神说，要有" },
            { type: "ref",  target: "ge/1/3", text: "光" },
            { type: "mark", color: 1, offset: 14, text: "就有了光。" },
          ],
        }]} />
      </div>
      <StudyPanel tabs={["注解", "生命读经", "我的笔记"]} active="注解">
        <StudyItem meta="创世记 1:1 · 黄">
          <mark className="c2">起初，神创造诸天与地</mark>
        </StudyItem>
        <NoteEditor meta="本章笔记" value="创造的次序预表生命的过程…" />
      </StudyPanel>
    </main>
    <AnnotationToolbar onColor={saveColor} onNote={openNote} onCopy={copyWithSource} />
  </>
);

/* ── 屏 3 · 听书（单列） ──────────────────────────────────────── */
const AudioScreen = ({ lecture }) => (
  <>
    <Topbar crumb={`鸟瞰圣经 第${lecture.no}讲 ${lecture.title}`}>
      <TopBtn>反馈</TopBtn>
    </Topbar>
    <NavDrawer docked={false}
      level1={[{ id: "birds", label: "鸟瞰圣经", cur: true }]}
      level2={lecture.siblings} />
    <main className="audio-col">
      <header className="lecture-head">
        <p className="lecture-eyebrow">第 {lecture.no} 讲 · {lecture.testament}</p>
        <h1>{lecture.title}</h1>
        <p className="lecture-meta">{fmtHours(lecture.total)} · {lecture.segments.length} 段 · {lecture.speaker}</p>
      </header>
      <PlayerCard lecture={lecture} segment={lecture.currentSegment} state="ready" />
      <SegmentList segments={lecture.segments} currentIndex={lecture.currentSegment.index - 1} />
    </main>
  </>
);

/* ── 屏 4 · 笔记管理（三列） ──────────────────────────────────── */
/** 桌面：分类树常驻左栏（☰ 隐藏）· 移动端：编辑全屏 push + 返回条 */
const NotesScreen = ({ filter }) => (
  <>
    <Topbar crumb="我的笔记" showMenu={false}>
      <TopBtn>批量</TopBtn>
    </Topbar>
    <main className="notes-layout">
      <aside className="cat-tree">
        {filter.categories.map((c) => (
          <div key={c.id} className={`cat-item${c.cur ? " cur" : ""}`}>{c.name} {c.count}</div>
        ))}
      </aside>
      <section className="notes-list">
        <SearchInput placeholder="搜索笔记…" scope="notes" />
        <div className="notes-toolbar">
          <Segment skin="surface" value="all"
                   options={[{ value: "all", label: "全部" }, { value: "bible", label: "经文" },
                             { value: "lr", label: "生命读经" }, { value: "books", label: "书报" },
                             { value: "morning", label: "听抄" }]} />
          {/* 颜色点筛选 + 排序 + 手机端收进「筛选 ▾」弹窗 */}
        </div>
        {filter.items.map((n) => (
          <div key={n.id} className={`note-row c${n.color}`}>
            <span className="color-bar" />
            <div>
              <p className="note-excerpt">{n.excerpt}</p>
              <p className="note-meta">{n.source} · {n.timeAgo}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="note-editor-panel">
        <ColorDots value={filter.selected.color} onChange={recolor} />
        <NoteEditor meta={filter.selected.source} value={filter.selected.note} />
        <div className="editor-actions">
          <TopBtn onClick={locateOrigin}>定位跳转</TopBtn>
          <TopBtn className="danger">删除</TopBtn>
        </div>
      </section>
    </main>
  </>
);

/* ── 屏 5 · 活力八作业单 ──────────────────────────────────────── */
const TopicScreen = ({ sheet }) => (
  <>
    <Topbar crumb="活力八 · 作业单" />
    <main className="topic-col">
      <article className="topic-card">
        <header>
          <h2>第 {sheet.week} 周</h2>
          <p className="topic-meta">所学章号：{sheet.chapters}</p>
        </header>
        {sheet.entries.map((e) => e.href
          ? <a key={e.id} className="topic-entry" href={e.href}>{e.icon} {e.label}</a>
          : <div key={e.id} className="topic-entry pending" aria-disabled="true">{e.icon} {e.label} · 待填</div>
        )}
      </article>
    </main>
  </>
);

/* ── 屏 6 · 启动（任何屏的首帧） ──────────────────────────────── */
const BootScreen = ({ progress, error }) => <Splash progress={progress} error={error} />;
