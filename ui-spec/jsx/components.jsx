/**
 * ui-spec/jsx/components.jsx — 组件声明（设计文档，非可构建代码）
 * ---------------------------------------------------------------------------
 * 本项目为零框架原生 JS（app.js + style.css）。本文件用 JSX 模板语法表达
 * 「组件的结构契约 + 复用关系」，落地时按 class 映射回 DOM 约定。
 * 规格出处：ui-spec/docs/03-components.md；token 出处：01-foundations.md。
 */

/* ── A. 导航与框架 ─────────────────────────────────────────────── */

/** 顶栏（52px · sticky z-30 · 渐变底白字 / 主题下融合底墨字） */
const Topbar = ({ crumb, showMenu = true, showTypo = true, showSettings = true, children }) => (
  <header className="topbar">
    {showMenu && <IconBtn icon="menu" label="目录" />}
    <div className="crumb">{crumb}</div>
    {children /* 模块控件区：Segment / TopBtn，插入位置在 crumb 之后 */}
    {showTypo && <IconBtn icon="typo" label="排版" />}
    {showSettings && <IconBtn icon="gear" label="设置" />}
    <div className="reading-progress" style={{ width: "38%" }} />
  </header>
);

/** 图标按钮（20px · padding 4 8 · radius-sm 6 · hover=--topbar-btn） */
const IconBtn = ({ icon, label }) => (
  <button className="icon-btn" aria-label={label}><Icon name={icon} size={20} /></button>
);

/** 描边小按钮（13px · 1px --topbar-line · padding 4 10）—「反馈」「上一章/下一章」 */
const TopBtn = ({ children, active = false }) => (
  <button className={`top-btn${active ? " active" : ""}`}>{children}</button>
);

/** 分段器 · skin=brand（顶栏「读经|研读」）：激活白底 + --brand-dark 字 */
/** 分段器 · skin=surface（抽屉「浏览|历史」「旧约|新约」）：激活 --brand 底白字 */
const Segment = ({ options, value, skin = "surface" }) => (
  <div className={`segment segment--${skin}`} role="tablist">
    {options.map((o) => (
      <button key={o.value} role="tab" aria-selected={o.value === value}
              className={o.value === value ? "seg-item cur" : "seg-item"}>
        {o.label}
      </button>
    ))}
  </div>
);

/** 导航抽屉（340px · 四阅读模块共用 · 双栏主从 + cur 高亮） */
const NavDrawer = ({ docked, level1, level2, segment }) => (
  <>
    {!docked && <div className="backdrop" />}                    {/* z-80 遮罩 */}
    <aside className={`nav-drawer${docked ? " docked" : ""}`}>  {/* z-81 */}
      <SearchInput placeholder="搜索书卷或「创24」…" scope="module" />
      <Segment options={[{value:"browse",label:"浏览"},{value:"history",label:"历史"}]}
               value="browse" skin="surface" />
      <div className="nav-cols">
        <NavList items={level1} />          {/* 层级一：无序号 */}
        <NavList items={level2} />          {/* 层级二：章/篇，剥序号 */}
      </div>
      {segment && <Segment options={segment} value={segment[1]?.value} skin="surface" />}
    </aside>
  </>
);

/** 抽屉列表（项 15px · padding 7 12 · radius-sm · cur=品牌高亮） */
const NavList = ({ items }) => (
  <div className="nav-list">
    {items.map((it) => (
      <div key={it.id} className={`nav-item${it.cur ? " cur" : ""}`}>{it.label}</div>
    ))}
  </div>
);

/* ── B. 阅读正文 ──────────────────────────────────────────────── */

/** 经文卡片（radius-md 8 · padding 8 18 · classic 品牌蓝阴影） */
const VerseCard = ({ verses }) => (
  <div className="verse">
    {verses.map((v) => (
      <p key={v.num} className="vline">
        <span className="vnum">{v.num}</span>
        <span className="vtext">{renderReading(v.rich)}</span>
      </p>
    ))}
  </div>
);

/**
 * 阅读文本渲染内核：把富文本片段（标注/注脚/串珠/人物/引用）织入正文。
 * 红线：标注定位基于源文本偏移 + text/prefix/suffix 自愈，
 *       任何渲染改动必须保持 data-base 坐标一致。
 */
const renderReading = (segments) => segments.map((seg, i) => {
  switch (seg.type) {
    case "mark":  return <mark key={i} className={`c${seg.color}`} data-base={seg.offset}>{seg.text}</mark>;
    case "fn":    return <sup key={i} className="fn-ref" data-base={seg.offset}>{seg.label}</sup>;
    case "string":return <sup key={i} className="str-ref" data-base={seg.offset}>{seg.label}</sup>;
    case "person":return <a key={i} className="person-link" href={`#person/${seg.id}`}>{seg.text}</a>;
    case "ref":   return <RefLink key={i} target={seg.target}>{seg.text}</RefLink>;
    default:      return <span key={i}>{seg.text}</span>;
  }
});

/** 纲目行（10 级 · ol1 17px/600 · ol2 品牌色 · 不逐级缩进） */
const OutlineItem = ({ level, children }) => (
  <div className={`outline-item ol${level}`}>{children}</div>
);

/** 经文引用链接（品牌色可点 → 跳读经模块对应章） */
const RefLink = ({ target, children }) => (
  <a className="ref-link" href={`#/bible/${target}`}>{children}</a>
);

/* ── C. 研读列 ────────────────────────────────────────────────── */

/** 研读面板（480px · surface-alt · 6px resize-handle 拖拽） */
const StudyPanel = ({ tabs, active, children }) => (
  <section className="study-col">
    <div className="resize-handle" role="separator" aria-orientation="vertical" />
    <div className="study-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={t === active}
                className={`study-tab${t === active ? " cur" : ""}`}>{t}</button>
      ))}
    </div>
    <div className="study-body">{children}</div>
  </section>
);

/** 研读条目卡（注解/生命读经/笔记汇总共用） */
const StudyItem = ({ meta, children }) => (
  <div className="study-item fn-item|lr-item|note-item">
    <div className="note-meta">{meta}</div>
    {children}
  </div>
);

/** 笔记编辑（textarea · 14px×scale · min-height 80 · resize vertical） */
const NoteEditor = ({ value, meta }) => (
  <div className="note-item">
    <div className="note-meta">{meta}</div>
    <textarea defaultValue={value} />
  </div>
);

/* ── D. 首页 ──────────────────────────────────────────────────── */

/** 首页合集块（classic=emoji / 其余主题=线性图标） */
const HomeBlock = ({ icon, title, sub, href }) => (
  <a className="home-block" href={href}>
    <span className="home-block-icon">
      <span className="hb-ic-em">{icon.emoji}</span>
      <Icon className="hb-ic-line" name={icon.line} size={34} />
    </span>
    <span className="home-block-title">{title}</span>
    <span className="home-block-sub">{sub}</span>
  </a>
);

/** 最近阅读（最近 5 条 · 无历史整块不渲染） */
const RecentList = ({ items }) => items.length === 0 ? null : (
  <section className="recent-block">
    <h2>最近阅读</h2>
    {items.slice(0, 5).map((r) => (
      <a key={r.id} className="recent-item" href={r.href}>
        <span>{r.title}</span>
        <span className="recent-meta">{r.module} · {r.timeAgo}</span>
      </a>
    ))}
  </section>
);

/* ── E. 听书 ──────────────────────────────────────────────────── */

/** 播放器卡片（进度=当前分段 · 标题时长=整讲） */
const PlayerCard = ({ lecture, segment, state }) => (
  <div className="player-card">
    <div className="player-seg-label">第 {segment.index} 段 · 共 {segment.total} 段</div>
    {state === "buffering" && <LoadingHint text="缓冲中…" />}
    {state === "error" && <ErrorHint text="音频加载失败，请检查网络" retryText="重试" />}
    {state === "ready" && <>
      <div className="player-times">
        <span>{fmtTime(segment.current)}</span>
        <span>{fmtTime(segment.duration)}</span>
      </div>
      <Slider value={segment.ratio} onChange={segment.seek} /> {/* 按下定位·横拖跟随·纵滑滚动 */}
      <div className="player-controls">
        <SkipBtn dir="back" seconds={15} />
        <PlayBtn playing={segment.playing} size={56} />
        <SkipBtn dir="forward" seconds={15} />
        <SpeedPill speeds={[0.75, 1, 1.25, 1.5, 2]} value={segment.speed} />
      </div>
    </>}
  </div>
);

/** 分段列表（当前段白卡高亮 · 单分片讲次不渲染） */
const SegmentList = ({ segments, currentIndex }) => segments.length <= 1 ? null : (
  <div className="segment-list">
    <h3>分段</h3>
    {segments.map((s, i) => (
      <div key={i} className={`seg-row${i === currentIndex ? " cur" : ""}`}>
        <span className="seg-icon">{i === currentIndex ? <Icon name="play" size={16}/> : <i className="dot" />}</span>
        <span className="seg-name">第{CN_NUM[i + 1]}段</span>
        <span className="seg-dur">{fmtTime(s.duration)}</span>
      </div>
    ))}
  </div>
);

/* ── F. 弹层与反馈 ────────────────────────────────────────────── */

/** 弹窗骨架（backdrop z-84 · popup z-85 · radius-lg 12 · 内部由业务填充） */
const Modal = ({ title, onClose, children }) => (
  <>
    <div className="backdrop" onClick={onClose} />
    <div className="popup" role="dialog" aria-label={title}>
      <header className="popup-head">
        <h2>{title}</h2>
        <IconBtn icon="close" label="关闭" onClick={onClose} />
      </header>
      <div className="popup-body">{children}</div>
    </div>
  </>
);

/** 设置分组卡（surface-alt · radius-md · 行间 1px border） */
const SettingsList = ({ groups }) => groups.map((g) => (
  <section key={g.label} className="settings-card">
    <div className="settings-group">{g.label}</div>
    {g.rows.map((r) => (
      <div key={r.label} className="settings-row">
        <span className="settings-label">{r.label}</span>
        {r.control /* Switch | Badge | value+箭头 */}
      </div>
    ))}
  </section>
));

/** 开关（40×24 · 滑块 20 · transition .2s） */
const Switch = ({ checked }) => (
  <span className={`switch${checked ? " on" : ""}`} role="switch" aria-checked={checked} />
);

/** 状态徽标（11px · radius 10 · on=success） */
const Badge = ({ on, children }) => (
  <span className={`settings-badge${on ? " on" : ""}`}>{children}</span>
);

/** 标注工具条（z-82 · 五色圆点 + 笔记/复制 · 点色即存） */
const AnnotationToolbar = ({ onColor, onNote, onCopy }) => (
  <div className="floattool" role="toolbar" aria-label="标注">
    {[1, 2, 3, 4, 5].map((c) => (
      <button key={c} className={`dot c${c}`} aria-label={COLOR_SEMANTIC[c]} onClick={() => onColor(c)} />
    ))}
    <span className="floattool-sep" />
    <button className="ft-btn" onClick={onNote}><Icon name="pen" size={16} />笔记</button>
    <button className="ft-btn" onClick={onCopy}><Icon name="copy" size={16} /></button>
  </div>
);
const COLOR_SEMANTIC = {
  1: "黄·重要的句子", 2: "绿·耶和华我的神等", 3: "紫·我是耶和华",
  4: "蓝·神所喜爱、赞赏的", 5: "红·神所恨恶、审判、禁止的",
};

/** Toast（底部居中 pill · 上浮 10px 淡入 · z-90） */
const Toast = ({ text }) => <div className="toast" role="status">{text}</div>;

/** 状态占位三件套 */
const LoadingHint = ({ text }) => (
  <div className="loading-hint"><span className="loading-spin" />{text}</div>
);
const ErrorHint = ({ text, retryText, onRetry }) => (
  <div className="loading-error">{text}<TopBtn onClick={onRetry}>{retryText}</TopBtn></div>
);
const EmptyHint = ({ text, action }) => (
  <div className="empty-hint">{text}{action && <a className="empty-action" href={action.href}>{action.label}</a>}</div>
);

/* ── G. 启动 ──────────────────────────────────────────────────── */

/** 首屏 Splash（z-100 · 关键样式 index.html 内联与 style.css 双份同步） */
const Splash = ({ progress, error }) => (
  <div id="splash">
    <div className="splash-logo">读经研读笔记</div>
    <p className="splash-verse">你的话是我脚前的灯，是我路上的光。</p>
    <div className="splash-source">诗篇 119:105</div>
    {error
      ? <div className="splash-error">{error}<button className="splash-retry-btn">重试</button></div>
      : <>
          <span className="splash-spinner" />
          <div className="splash-progress"><div className="splash-progress-fill" style={{ width: `${progress}%` }} /></div>
        </>}
  </div>
);
