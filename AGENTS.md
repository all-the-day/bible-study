# bible-study — 读经研读笔记 PWA

## 项目定位

**读经研读/预习草稿工具**：启动进首页合集块（读经/生命读经/听抄/书报/我的笔记）→ 聚合查看原文、注解、相关生命读经 → 在材料上划线、标记、写笔记 → 笔记按章累积；标注/笔记可选云同步，APK 支持 App 内更新。

与兄弟项目的边界：
- **bible**（`../bible`）— 数据源，通过 `query_api.py` 提供经文/注解/串珠/生命读经。本项目的 `scripts/export.py` 从它导出静态 JSON，**不直接读 bible.db**；书报系列数据也来自 `../bible/data/raw/spiritual_food/`
- **bible-reader** — 纯划线阅读器，定位「干净、无注解」。本项目的**颜色概念体系沿用它的 5 色语义**，但功能上不复用其代码。
- **晨读 app（特会信息合集）** — UI 与标注交互机制的参考样板，且**听抄模块的数据源**（反编译其 APK 资源导出 `data/morning/`，见「数据导出」节）

## 技术栈

纯静态 PWA（无构建步骤，参照晨读 app / bible-reader 模式）：
`index.html` + `style.css` + `app.js` + `sync.js` + `update.js` + `manifest.json` + `sw.js`。

离线 APK：Capacitor 6（`capacitor.config.json` + `package.json`），GitHub Actions 云构建（`.github/workflows/build-apk.yml`）。

## 分支与构建

- **单一 `main` 分支是唯一事实源**，部署 Vercel + 打包**单一 APK**（appId `com.allday.biblestudy`）
- **云同步是运行时可选功能**，不再区分安装包变体：默认纯本地，顶栏 ⚙️ 设置 →「云同步」行输入授权码兑换 `{uid,token}`（localStorage `bible-study.account`，null=未启用）后才参与云同步；`syncActive()`（app.js）运行时门控，未启用时即使 sync.js 存在也完全本地
- 授权码体系已上线（见「云同步」节）；旧 `offline` 分支与离线变体构建已废弃（归档 tag `archive/offline` 保留历史）

## 文件结构

| 文件 | 职责 |
|------|------|
| `index.html` / `style.css` / `app.js` | 单页应用全部逻辑 |
| `sync.js` | 标注/笔记云同步客户端（duoban.xyz 通用 KV API） |
| `update.js` | App 内检查更新客户端（GitHub Releases 查版本 + 原生下载 APK + 安装；下载走 ApkInstallerPlugin 原生 HTTP，不用 WebView fetch——CORS 根因见「App 内更新」节） |
| `manifest.json` / `sw.js` | PWA 安装与离线缓存 |
| `capacitor.config.json` / `package.json` | APK 打包配置（`resources/icon.png` 为图标源） |
| `config/android/` | 原生更新插件源码（ApkInstallerPlugin：download 原生下载 + install 安装；MainActivity/file_paths.xml），CI 注入 android/ 工程，不入本地构建 |
| `scripts/export.py` | 从 `../bible` 导出静态 JSON → `data/` |
| `scripts/export-morning.py` | 从晨读 APK 资源导出听抄 → `data/morning/`（默认只导当年，`--exclude` 排除期，旧期自动清理；`EPUB_PERIODS` 内的期跳过并保留——其听抄由 epub 导出） |
| `scripts/export-morning-epub.py` | 从特会信息 epub（Notion 下载，如 2026-3-MDC.epub）导出**完整听抄** → `data/morning/{期}.json`（反编译 App 资源 detail_sections 听抄被截断，每篇缺 18-27%；**2026-08 起听抄以 epub 为准**）；同时更新 index.json 该期条目 |
| `scripts/export-spiritual.py` | 从 `../bible/data/raw/spiritual_food/` 导出书报 → `data/books/`（系列索引 + 元数据 + 按辑懒加载） |
| `scripts/export-verses.py` | 从 export.py 产物 `data/bible-text.json` 派生精选经节 → `data/verses.json`（首屏 splash 随机经节数据源，~190 节几 KB） |
| `start.bat` / `icons/` | 本地预览服务器（python http.server 8765）/ PWA 图标（icon-192/512，`resources/icon.png` 为 APK 图标源） |
| `scripts/patch-android.mjs` | CI 帮手：注入原生插件 + AndroidManifest 权限/FileProvider（幂等） |
| `scripts/*-test.js` | puppeteer 端到端测试（e2e / 标注 / 生命读经标注 / 生命读经模块内标注）；`download-sim-test.js` 验证 WebView fetch 下载被 CORS 拦截（根因留档），`update-logic-test.js` mock 原生插件验证 download() fallback/进度/监听清理，`lr-heading-test.js` 纲目标题提取，`home-test.js` / `home-test-mobile.js` 首页+合集链路冒烟（含 splash 经节断言），`lr-reader-test.js` 生命读经阅读器专项，`lr-module-annotation-test.js` 生命读经模块内划线回归（rerenderAnn 主区重渲染），`book-reader-test.js` 书报阅读器专项，`morning-reader-test.js` 听抄阅读器专项（直进/切期/切篇/层级标题渲染/笔记/划线/全局笔记跳转/恢复）；`sync-merge-test.js` sync.js flushPending 合并语义 node 单测（无浏览器，防旧快照覆盖回归）；`notes-module-test.js` 笔记管理模块专项（直进/分类树/来源tab/颜色过滤/搜索/排序/选中进面板/编辑笔记/改色/删除单条/大段笔记编辑删除/批量删除/偏好恢复）；`ref-link-test.js` 经文引用识别专项（相对引用/上下文/误判防护/章越界过滤/篇63 DOM 渲染）；`run-all-tests.sh` 全量运行器（确保 8765 服务器 → 顺序跑全部测试 → 按输出解析判定，失败=非零退出或含 ✗/FAIL/JS 错误；`SKIP="home-test …"` 可跳过） |
| `scripts/run-all-tests.sh` | 全量测试运行器（见「测试与 Git 钩子」节） |
| `scripts/install-hooks.sh` | 安装 git hooks 到 `.git/hooks/`（pre-commit 快速质量门 + pre-push 全量测试） |
| `data/books.json` | 66 卷目录 + 每卷章数 + 缩写 |
| `data/bible-text.json` | 原文，键 `创1:1` / `创1:2上`，值含 `{N}`（注脚）/`[a]`（串珠）标记 |
| `data/bible-notes.json` | 注解，键 → `{seq: 注脚文本}`（seq 为节内连续编号，可复用同一文本、跨半节连续） |
| `data/bible-xrefs.json` | 串珠，键 → `{字母: 引用串}` |
| `data/bible-outlines.json` | 纲目，键 `创1` → `{theme: [{level,text}], items: [{level,text,section,flag}]}` |
| `data/lifereading/{缩写}.json` | 每卷生命读经：篇目 + 经文映射（verses）+ 正文。合并卷（撒母耳记/列王纪/历代志）拆分为子卷文件（撒上/撒下、王上/王下、代上/代下） |
| `data/lr-titles.json` | 生命读经全卷篇目标题索引 `[{acronym,id,title}]`（1990 条 ~200KB，export.py 一并导出；模块级搜索用，避免拉全量正文） |
| `data/morning/` | 听抄：index.json（期索引 trainings）+ `{期}.json`（chapters 听抄正文，无六天晨兴/纲目） |
| `data/books/` | 书报：index.json（系列清单）+ `{系列}.json`（元数据 volumes）+ `{系列}-{辑}.json`（按辑懒加载） |
| `data/verses.json` | 精选经节 `[{ref,text}]`（~190 节，`export-verses.py` 派生，首屏 splash 随机经节源） |

## 数据模型（核心）

**键格式**：`书卷缩写 + 章 + ":" + 节 + 半节后缀`，如 `创1:1`、`创1:2上`、`创1:2下`（`flag` 1=上 2=下 0=无，与 bible.db 的 content.flag 对齐）。

**标注**（localStorage，两种目标，经文与生命读经都可划）：
```json
{"id":"uuid","type":"verse","book":1,"chapter":24,"verse":5,"half":"","start":0,"end":10,"text":"选中文本快照","prefix":"前25字","suffix":"后25字","colorId":"c1","underline":false,"note":"..."}
{"id":"uuid","type":"lr","book":1,"articleId":60,"start":0,"end":6,"text":"选中文本快照","prefix":"前25字","suffix":"后25字","colorId":"c2","underline":false,"note":"..."}
```
- `type: verse` 目标为经文（offset 在该节合并文本内）；`type: lr` 目标为生命读经篇目正文（offset 在该篇 content 全文内）
- **位置自愈（TextQuoteSelector，移植自晨读 app highlight.js）**：保存时记录选中文本快照 `text` + 前后各 25 字上下文 `prefix`/`suffix`（快照取自定义 `plain` 切片而非 `range.toString()`，与渲染坐标系严格一致）；渲染时（`renderChapter`/`renderLifereading`）校验偏移，失效则按文本匹配 + 上下文打分重定位并写回。旧数据无 `text` 字段则跳过自愈
- 颜色沿用 bible-reader 5 色语义：c1黄=重要句子 / c2绿=「耶和华我的神」等 / c3紫=「我是耶和华」 / c4蓝=神所喜愛讚賞的 / c5红=神所恨惡審判禁止的
- 标注 + 笔记 + 下划线 三种形态：高亮（背景色）、下划线、笔记（附加文字）
- 「我的笔记」的划线汇总**跟随当前章篇目对应**：只列本章经文标注 + 当前章对应生命读经篇目（自动匹配或手动 `lrMap`）上的标注；按来源分 tab（全部/经文/生命读经），点击跳回原文。**全局聚合已移出研读列**：研读列只保留本章聚合，全量标注/大段笔记的浏览管理在首页「我的笔记」块直进的**笔记管理模块**（见「首页 + 合集块」节）
- **`annotationText` 跨书卷注意**：经文取文本必须用标注自己的 `a.book` 查 books.json 取缩写（全局模式下当前书卷≠标注书卷），生命读经跨书卷查 `state.lrVolumes[a.book]` 缓存兜底，无则回退 `a.text` 快照

**纲目**（`data/bible-outlines.json`）：每章 `theme`（level 1-2 上级纲目，跨章游走，渲染章首）+ `items`（level 1-6 分段标题，按 `section`/`flag` 锚点穿插在经文卡片之间）。

**生命读经匹配**：自动按每篇 `verses` 的章节号（`X:Y` 开头的 `X`）匹配当前章；用户可手动指定（localStorage 键 `bible-study.lrMap`，`{键(如"创24"): [篇目id]}`，覆盖自动匹配，纯本地不参与云同步）。

**移动端（≤900px）单视图模型**：同一时刻只显示一个内容——读经（经文）或研读（注解/生命读经/我的笔记），模式切换在顶栏右侧「读经|研读」pill（`#modePill`，`setMobileView` 维护 body.mobile-study）；桌面三列布局不变。**首页是第三种态（`body.home`）**：启动先进首页（见「首页 + 合集块」节），首页时 pill/☰/底部导航/工作区按钮全部隐藏。**生命读经阅读器（body-mod-lifereading 三列）移动端暂未适配**：保证不崩溃、正文可读（textCol 显示 #lrMain），☰/crumb 走层级选择弹窗可用、左右栏抽屉延后（书报/听抄/笔记管理模块移动端同此策略：主区显示于 textCol，左右栏抽屉延后）。移动端顶栏为 ⌂ + ☰ + 居中标题（`创世记 25章`，**点击弹章节选择** `openChapterPicker`：书卷横向切换 + 章网格）+ `#settingsBtn`（⚙️ 统一设置弹窗 `openSettingsModal`：同步/阅读/其他分组卡片 + Switch 开关，底部版本号）。**☰ 上下文导航**：读经视图开书卷抽屉；阅读器模块（生命读经/书报/听抄）☰ 开层级选择弹窗（`openLrArticleList`/`openBookPicker`/`openMorningArticleList`，与 crumb 点击一致）；读经研读+生命读经 tab 开篇目/纲目导航 sheet（`openLrNavSheet`，点击滚动定位）；读经研读+注解/我的笔记 tab 为 no-op。**底部导航 `#mobileNav` 仅读经模式显示**（`mobileNavGo`/`updateMobileNav` 只翻章，边界禁用）；研读模式沉浸化：nav 隐藏、`.study-col` 延伸到底（`body.mobile-study` 规则），翻章/翻篇改走 crumb 选章 / ☰ 篇目导航。隐藏桌面专属元素（视图模式/研读全屏/笔记按钮/顶栏翻页/拖拽调宽/纲目侧栏），`jumpToVerse`/`jumpToLr` 自动切回对应视图。**同步状态指示**：顶栏圆点已移除，收进设置弹窗「同步」组的「同步状态」行（`syncStatusInfo` 文字+颜色），冷启动（新会话首次）启用同步时 toast 提示一次（`showStartupSyncToast`，sessionStorage 去重）。移动端样式全部限定在 `@media (max-width: 900px)`，桌面 CSS 不受影响。

## 首页 + 合集块（2026-08 阶段 1）

**启动先进首页**（PC/移动端通用，浏览器启动页风格）：顶部通用检索 + 正方形合集块网格。首页是全屏层 `#homeView`，与工作区 `.layout` **正交**（CSS 切换：`body.home .layout{display:none}` + `body:not(.home) #homeView{display:none}`，无 JS 频繁切 hidden）；顶栏新增常驻 `#homeBtn`（⌂）回首页。**搜索分层：全局搜索只在首页**（中央搜索框）；阅读器内各模块左栏为**模块级搜索**（空查询=当前列表，非空=全模块范围检索：生命读经全 66 卷 / 书报全辑 / 听抄全期，结果带卷名/期名前缀，点击跨范围跳转；读经模块只有书卷过滤 `bookSearch`）。**首屏 splash**（`#splash`，纯静态 HTML 先行显示，含 app 名 + 随机经节 `data/verses.json`（拉取失败用 HTML 兜底节）+ spinner）：init 并行拉 books.json 与 verses.json，首页就绪后 `splashHide()`（同步 display:none 不挡交互）。**数据加载指示**（`showLoadingHint`/`showLoadingError`）：读经经文首载（`ensureBibleData`→#verseContainer）、生命读经卷（`ensureLrVolume`→#lrMain）、书报辑（`ensureBookVolume`→#bookMain）、听抄期（`ensureMorningData`→#morningMain）未缓存时显示 spinner+提示，失败显示「加载失败+重试」；`fetchJSON` 带 25s AbortController 超时。

- **状态**：`state.screen`（'home'|'work'，唯一视图正交开关）、`state.activeModule`（当前阅读器模块：'bible'|'lifereading'|'books'|'morning'|'notes'）、`state.lrVolumes`（生命读经卷懒加载缓存，`selectChapter` 懒加载与阅读器共用）、`state.lrBookIndex/lrArticleId/lrSideTab`（生命读经阅读器位置与右栏 tab）
- **切换函数**（顶层声明，e2e 测试 `page.evaluate(() => enterWork())` 直接调用）：`showHome()`（加 body.home + 移除 mobile-study + closePopupAll + 刷新块计数）、`enterWork()`（移除 body.home，幂等）
- **合集注册表 `COLLECTIONS`（app.js 顶部，数据驱动）**：`{id, title, icon, entry}` 数组（**无 sub 副标题**）→ `renderHome()` 遍历生成 `.home-block` tile，点击委托分发。**听抄/书报数据导出后各加一行即可上块，UI 零改动**（注册表已留注释占位）
- **阅读器外壳 + 模块注册表 `READER_MODULES`（app.js，核心抽象）**：每个合集模块 = 一套三列阅读器配置 `{id, title, enter(opts), renderNav(), renderMain(), renderSide(), renderCrumb(), onMenu(), onCrumbClick()}`。`enterModule(id, opts)` 是唯一入口（首页块/搜索/全局笔记都走它）：旧模块 onLeave → activeModule 切换 → `applyModuleBodyClass`（body-mod-{id} 类驱动三列容器归属，CSS 见 style.css「阅读器模块容器切换」节）→ enterWork → 首次进入时 enter + 四渲染（**同模块幂等不重渲染**）。☰ 桌面 = `toggleNavCollapsed()` 折叠当前模块左栏；crumb 点击 = 模块分发（读经=选章弹窗 / 生命读经=篇目弹窗）
- **读经模块（bible）**：entry 直接进上次章节（`LS_LAST`，无则 1,1），不再弹选章；左栏=书卷+章网格、主区=经文、右栏=注解|生命读经|我的笔记、actions=双页/隐藏注号/研读全屏/笔记/反馈/设置（现状）
- **生命读经模块（lifereading，方案 A 三列）**：entry 直接进上次篇目（`LS_LR_LAST`，无则第一卷第一篇）；左栏=模块级搜索框（`.nav-search`：空查询=当前卷列表，非空=全 66 卷篇目标题检索 `ensureLrTitleIndex`（`data/lr-titles.json` 索引），结果带卷名前缀、点击 `openLrArticle` 跨卷跳转）+ 当前卷篇目列表（`.lr-nav-articles`，active 自动居中）；**层级切换上移至 crumb 弹窗 `openLrArticleList`（两级：66 卷 Tab + 篇目列表；`.chp-books` 隐藏横向滚动条，滚轮纵转横 `polishVolStrip`）**，左栏卷条已移除；☰ 折叠与读经一致；主区=篇目正文（`renderLrArticle(art, bookIndex)` 渲染到 `#lrMain`，标注坐标系不变）；右栏=`#lrSide`「纲目|笔记」tab（纲目在前：`extractLrHeadings` + 滚动高亮 `bindLrOutlineSpy` 句柄化监听 `#textCol`；笔记：篇级 textarea `state.lrNotes` + 本篇标注汇总）；crumb=`卷名 · 第{id}篇 {标题}` 点击弹篇目列表；actions 只留 ⚙️（`body-mod-lifereading` CSS 隐藏其余）；切篇/切卷 `selectLrArticle/selectLrVolume` 持久化 LS_LR_LAST + 正文滚顶；统一入口 `openLrArticle(bookIndex, art)`（模块内切篇/模块外进模块）。**ref-link 经文引用**：正文与注解的引用包 `<span class="ref-link">`，`detectRefs(text, defaultAcronym)` 识别**相对引用**（无书卷前缀，如「创二四62，二五11」的 `二五11`=创25:11）——上下文来自前文全书引用或 defaultAcronym（生命读经=篇目所属卷、注解=注解所在书卷），data-refs 用规范键（书卷+章:节）；纯数字相对引用要求左右分隔符/句末标点防护误判（25章、25:11、1920年 不识别），并以章数上限（books.json）与节存在性（bible-text.json）双过滤书卷推断错误的引用
- **书报模块（books，倪柝声文集，后续系列同构扩展）**：entry 直接进上次位置（`LS_BOOK_LAST`{volume,book,chapter}，无则第1辑第1本第1章）；左栏=模块级搜索框（空查询=当前辑列表，非空=全辑书名+章标题检索，bookMeta 即含全部章标题零额外请求；结果点击 `openBookResult` 跨辑跳转）+ 书列表（`.bk-nav-books`，active 自动居中）；**辑层级上移至 crumb 弹窗 `openBookPicker`（辑 Tab + 书列表）**，左栏辑条/系列条已移除；主区=`#bookMain` 当前章正文（`.bk-para`/`.bk-head lr-h{n}` 按行 data-base 渲染：**标题行 `detectLrHeading` 识别独立成 `.bk-head`（左对齐+加粗+字号递进，无缩进），正文段落纯文本样式无卡片（2026-08 用户定稿：去掉卡片）；正文头部与 `.bk-title`/crumb 重复的书名+章名行跳过（`renderBookContent` leading 去重，偏移照常累计标注不变）**；标注 type 'book' 坐标系=chapter.content）；右栏=`#bookSide`「章列表|笔记」（章列表切章，笔记=章级 textarea `state.bookNotes` + 标注汇总）；crumb=`倪柝声文集 · 书名 · 第N章`；数据 `data/books/`：`ni.json` 元数据（46KB，含章标题）+ `ni-{辑}.json` 按辑懒加载（3 辑 62 本 1325 章，共约 24MB）；切辑/切书/切章 `selectBookVolume/selectBookItem/selectBookChapter`（注意：**书报函数已加 Item 前缀避免与读经 selectBook/renderBookList 同名覆盖**）；统一入口 `openBookChapter(volume, book, chapter)`
- **听抄模块（morning）**：entry 直接进上次位置（`LS_MORNING_LAST`{period, chapterId}，无则第 1 期第 1 篇）；左栏=模块级搜索框（空查询=当前期列表，非空=全期篇标题检索，各期数据 ensureMorningData 懒加载后缓存；结果带期名前缀、点击 `openMorningArticle` 跨期跳转）+ 篇列表（`.morning-nav-chapters`，active 自动居中）；**期层级上移至 crumb 弹窗 `openMorningArticleList`（期 Tab + 篇列表）**，左栏期条已移除；主区=`#morningMain` 当前篇**听抄**（信息正文：`detail_sections` 树形层级标题 + 段落，content 逐行 data-base 渲染，标题行经 `detectLrHeading` 识别加 `.morning-head` 类；仅含听抄数据，纲目/六天晨兴不导出）；右栏=`#morningSide` 篇级笔记（`state.morningNotes`）+ 标注汇总；crumb=`期标题 · 第{n}篇 {标题}` 点击弹篇目列表；标注 type 'morning'（`period`/`chapterId` 定位）；数据 `data/morning/`（index.json + `{期}.json`，当前 2026-03/04 两期 18 篇）；`openMorningArticle(periodId, chapterId)` 统一入口
- **笔记管理模块（notes，2026-08 阶段 2）**：首页「我的笔记」块直进（`enterModule('notes')`，不再进读经研读列）；三列=左栏**分类树**（来源（全部/经文/生命读经/书报/听抄，计数）→ 书卷/系列 → 章/篇叶子，可折叠，`state.notesCollapsed`；`renderNotesTree`）/ 主区**条目列表**（工具条：来源 tab + 颜色过滤 + 搜索（只刷新列表主体保输入焦点）+ 排序（书卷序/时间倒序）+ 多选开关；`renderNotesList`/`renderNotesListBody`；分组复用 `groupHlGlobal`（label 由 `annGroupLabel` 统一）+ **大段笔记混排**（chapterNotes/lrNotes/bookNotes/morningNotes 非空项，📝 图标区分，`bigNoteGroupLabel` 挂对应组））/ 右栏**编辑面板**（`renderNotesPanel`：标注=文本/定位/时间 + 笔记 textarea 直写 `save(LS_ANNOTATIONS)`（blur 时空笔记无颜色无下划线 → 等同删除）+ 5 色改色 `changeAnnColor` + 下划线 `toggleAnnUnderline` + 删除 `deleteAnn`；大段笔记=textarea 直写对应 dict + 删除 `deleteBigNote`）。**点击条目=选中进编辑面板（不跳原文）**；多选模式（`.notes-item-check`）→ 批量条（已选 N / 分组全选 / 删除所选（v1 只批量删除）/ 取消）；删除均走 `confirmDialog`（复用 openPopup 的确认弹框）。偏好 `source/color/sort` 持久化 `LS_NOTES_PREFS`（`bible-study.notesPrefs`，纯本地不入云同步）；`rerenderAnn` 顶部 notes 模块早退（刷新树/列表/面板，防误 renderChapter）。移动端同其他阅读器模块：主区显示于 text-col，左/右栏抽屉延后。**搜索的标注分支仍跳原文**（`navigateToAnnotation`，与笔记模块无关）
- **模块感知标注**：`renderLrArticle` 输出 `data-book`；`renderBookMain` 输出 `data-series/volume/book/chapter`；`renderMorningMain` 输出 `data-period/chapter`；`findAnnotatable` 加 `data-article`/`data-chapter` 守卫（**修复 renderFootnotes 注解容器误标 .lr-content 致 articleId=NaN 的隐患**）；`handleSelection` 按 data-book / data-volume / data-period 定位源文本；`navigateToAnnotation` 模块感知（lr/books/morning 模块内就地跳转，跨模块回 bible）；`buildAnnotation` 按 type 存定位字段（verse: chapter/verse/half、lr: articleId、book: series/volume/book/chapter、morning: period/chapterId）
- **顶部搜索 `homeSearch(q)`**（轻量五条过滤，**不做全文**）：① 书卷+章正则走 `REF_ALIASES`/`resolveBookAlias` → `enterModule('bible')` 进工作区选章；② 标注 note/text 包含匹配（截 20 条，`navigateToAnnotation` 跳转）；③ 生命读经篇目标题（仅 `state.lrVolumes` 已缓存卷，不建全量索引）→ `openLrArticle` 直进阅读器；④ 书报章标题（仅 bookMeta 已加载）→ `openBookChapter`；⑤ 听抄篇标题（仅已加载期）→ `openMorningArticle`
- **测试**：e2e 类测试启动后需 `enterWork()` 切回工作区（init 后台预渲染使 DOM 存在但被 body.home 隐藏，直接 page.click 隐藏元素会抛错）；`home-test.js`（直进版冒烟）/ `home-test-mobile.js` / `lr-reader-test.js`（阅读器专项：直进/切卷/切篇/纲目/笔记/折叠/划线/恢复）为首页+阅读器链路测试
- **数据源（已落地）**：听抄 = 反编译晨读 APK 资源 `d:/迅雷下载/晨读appRes/resources/assets/public/`（`trainings.json` + 每月 `{期}/training.json`：chapters → outline_sections/detail_sections/morning_revivals 周一~周六），`scripts/export-morning.py` 导出 `data/morning/`（**默认只导当年，`--exclude` 排除期，旧期自动清理**；当前 2026-03/04 两期 18 篇）。**2026-08 起听抄以特会信息 epub 为准**（`export-morning-epub.py`）：epub 含完整听抄 `{n}_ts.htm` + 读经 `{n}_cv.htm`，反编译资源 detail_sections 每篇缺 18-27% 正文；epub 托管的期列入 `export-morning.py` 的 `EPUB_PERIODS`（2026-03 已迁，后续特会从 Notion 下载 epub 后 `export-morning-epub.py <epub> --period {期}` 迁移并加入集合）；书报 = `../bible/data/raw/spiritual_food/倪柝声文集/`（目录索引 + md），`scripts/export-spiritual.py` 导出 `data/books/`（index.json 系列清单 + {id}.json 元数据 + {id}-{辑}.json 内容，3 辑 62 本 1325 章）。标注 type 扩展 `'book'`/`'morning'` 已落地（向后兼容旧 verse/lr）。其他 30 个书报系列（十二篮/荒漠甘泉/新约总论等）渐进加：导出脚本同构扩展 → 系列条自动多一项，前端零改动

## 云同步

标注/笔记通过 **duoban.xyz 通用 KV API** 跨端同步（与 bible-reader 共用同一服务，服务器为主 + 本地缓存）：

| 项 | 值 |
|----|-----|
| API | `https://duoban.xyz/bible-api/api/kv/{key}`（GET/PUT/DELETE） |
| 服务器 key | `u{uid}:bible-study:annotations`、`u{uid}:bible-study:chapterNotes`、`u{uid}:bible-study:lrNotes`、`u{uid}:bible-study:bookNotes`、`u{uid}:bible-study:morningNotes`（uid 来自账号） |
| 客户端 | `sync.js`（`window.BibleStudySync`） |
| 策略 | 服务器为主：启动 `pullAll` 覆盖本地（pending 的 key 跳过）；写时 `putRemote` 防抖；失败标 pending，启动 `flushPending` 重试——**推送前先 GET 服务器当前值合并**（数组按 id 并集、同 id 本机赢；对象浅合并本机赢；拉取失败则本轮不推保留 pending），防止旧快照整体覆盖其他设备的新数据 |
| 同步范围 | **只同步用户数据**（annotations / chapterNotes / lrNotes / bookNotes / morningNotes）；布局偏好（viewMode / hideMarks / studyWidth 等）保持设备本地 |

**账号与授权（RFC 8628 简化版）**：
- 同步是**运行时可选功能**：localStorage `bible-study.account`（`{uid, token}`，null=未启用纯本地）；`syncActive()`（app.js）门控；⚙️ 设置弹窗「云同步」行打开启用/管理弹窗
- 启用流程 = 输入授权码 → `POST /api/account/claim` 兑换 `{uid, token}`；管理员用 `npm run account:code`（`--uid u1` 绑定已有账号 / 缺省新账号码）生成，码 10 分钟有效、一次性、每 IP claim 限流
- **KV 权限**：`u{n}:bible-study:*` 命名空间读写必须带设备令牌（`Authorization: Bearer`），`sync.js` 自动附加；跨账号隔离（u2 token 访问 u1 → 401）；bible-reader 命名空间暂未纳入（`SECURED_PROJECTS` 可扩展）
- owner 账号 `u1` 预置，既有数据命名空间不变；新账号从 u2 起
- **管理面板**：`https://duoban.xyz/bible-api/admin` — 账号列表/详情（设备吊销、KV 查看/删除、清空账号数据）、授权码撤销、网页生成授权码（可绑定已有 uid，避免「生成码总是新 uid」）。登录用管理员令牌（`BIBLE_ADMIN_TOKEN` = 服务器 `FEEDBACK_ADMIN_TOKEN`）或服务器 `admin_password.txt` 密码（两者存于 server-ops，见 `../server-ops/docs/servers/aliyun-rike.md`）；服务器代码与页面版本化源头在 `../server-ops/files/bible-reader/`，更新走 server-ops upload + `pm2 restart bible-kv`

- 同步失败静默降级为纯本地，不阻塞应用；`window.BIBLE_OFFLINE=true` 可跳过远程（测试用）
- 服务器 CORS 白名单在 `/var/www/bible-reader/server.py` 的 `ALLOWED_ORIGINS`，新增域名用 `../server-ops/server-ops.py -s aliyun-rike exec ...` 操作并重启 `bible-kv`（`pm2 restart bible-kv`，**不要带 `--update-env`** 以免丢 FEEDBACK_ADMIN_TOKEN）。Capacitor 6 WebView origin 是 `https://localhost`（白名单已含）
- 同步状态指示：设置弹窗「同步状态」行（`syncStatusInfo`：绿=已同步 / 橙=待同步 / 红=离线 / 灰=未启用）+ 冷启动 toast（新会话首次，仅启用同步时提示）

## App 内更新

APK 端检查 GitHub Releases 新版本 → 下载 APK → 触发系统安装（移植晨读 app 更新逻辑，见 `update.js` 与 `config/android/`）：

| 项 | 值 |
|----|-----|
| 版本真相源 | `https://api.github.com/repos/all-the-day/bible-study/releases/tags/bible-study-main`（滚动 release，无鉴权 60 次/小时/IP） |
| 本地版本 | `manifest.json` 的 `version`（`update.js` 读取；CI 构建 APK 时用 package.json 值重写 `www/manifest.json`） |
| 远端版本 | Release `name`（CI 固定格式 `读经 v${VERSION} · 云同步版`），正则 `/v(\d+\.\d+\.\d+)/` 解析 |
| 比较 | `compareVersion`：去 v 前缀 → split('.') → parseInt 逐位比较 |
| 下载源 | 直连 GitHub + 公共镜像依次尝试（`github.com` → `gh-proxy.com` → `ghproxy.net`），失败切换下一个；候选源按域名去重（API 的 downloadUrl 即 github.com 直连） |
| 下载方式 | **原生 `HttpURLConnection`**（`ApkInstallerPlugin.download`，不受 WebView CORS 限制）→ cacheDir `downloads/`；进度经插件 `progress` 事件（fraction 0..1，原生节流 500ms）转发 JS 进度条 |
| 安装 | `Capacitor.Plugins.ApkInstaller.install({filePath})`（原生插件）→ FileProvider → 系统 `ACTION_VIEW` 安装器 |
| 清理 | 成功后清理 CACHE/DATA `downloads/` 目录历史 `*.apk` |

- **触发**：启动后 ~3s 静默 `check()`（10s 超时，失败静默）→ 发现新版给 `#settingsBtn` 加 `.update-dot` 红点角标 + 设置弹窗「检查更新」行显示状态；设置行点击开 `#updateModal`（独立 modal，非弹窗栈，下载过程不被关闭打断）。**`window.BIBLE_SKIP_UPDATE=true` 跳过静默检查**（测试/自动化用：避免每次启动消耗 GitHub API 匿名配额 60 次/小时/IP，e2e 测试均已设置）
- **平台分支**：原生（`Capacitor.isNativePlatform()`）→ `download()`（update.js）依次调插件 `download({url})`，失败（超时/HTTP 错误）切下一源 → 成功后 `install`；PWA/浏览器 → 只提示跳转 Releases 页（网页内容走 SW 自动更新）
- **⚠️ 不要退回 WebView fetch 下载**：GitHub release 资产域（`release-assets.githubusercontent.com`）与公共镜像都不带 `Access-Control-Allow-Origin`，Capacitor WebView（origin `https://localhost`）里 fetch 跨域下载被 CORS 拦截，稳定复现 `Failed to fetch`（开 VPN 无效）——2026-08-26 实测根因，已改用原生下载
- **原生插件注入**：仓库不建 `android/`（CI `cap add android` 全新建）；`scripts/patch-android.mjs` 在 cap sync 后拷贝 `config/android/` 的 Java/XML 并幂等改写 AndroidManifest（`REQUEST_INSTALL_PACKAGES` 权限 + `<queries>` VIEW apk + FileProvider authority `com.allday.biblestudy.fileprovider`）
- **版本一致性守卫**：build-apk.yml 构建前校验 `package.json.version == manifest.json.version`，不一致直接失败——App 内更新依赖两处版本对齐，**每次发版两处都要同步升**

## 反馈闭环

用户从 APP（网页/APK 顶栏「反馈」按钮）匿名提交 → 本地拉取开发 → 部署后标记完成：

```bash
npm run feedback:pull            # 拉取未处理反馈 → scripts/feedback/inbox.md
npm run feedback:pull -- --all   # 包含已处理
npm run feedback:close <id>      # 标记已处理
```

- 服务端：duoban.xyz bible-kv（`/var/www/bible-reader/server.py`）的 `POST/GET/PATCH /api/feedback`；匿名提交有每 IP 20 次/小时限流
- 管理员令牌：`BIBLE_ADMIN_TOKEN`（项目根 `.env.local`，不入库）== 服务器 `FEEDBACK_ADMIN_TOKEN`（pm2 env）
- 客户端：顶栏「反馈」按钮 → `openFeedbackModal()`（app.js），提交到 `https://duoban.xyz/bible-api/api/feedback`
- 任何「检查反馈」动作必须先 `npm run feedback:pull` 刷新，禁止直接读 inbox.md 作为反馈依据（它是本地快照）

## 数据导出

```bash
cd scripts && python export.py          # 经文/注解/串珠/纲目/生命读经（含 lr-titles.json 篇目标题索引）
cd scripts && python export-morning.py  # 听抄（默认只导当年，--exclude 排除期；EPUB_PERIODS 内期跳过）
cd scripts && python export-morning-epub.py /path/2026-3-MDC.epub --period 2026-03  # epub 完整听抄（迁移期后加进 export-morning.py 的 EPUB_PERIODS）
cd scripts && python export-spiritual.py # 书报系列（倪柝声文集等）
cd scripts && python export-verses.py    # 精选经节（依赖 export.py 产出的 bible-text.json，需在其后跑）
```
- 数据源路径 `../bible/data/raw/bible_root/bible.db`（只读）与 `../bible/data/raw/life_study/`（只读）；听抄源为晨读 APK 资源 `d:/迅雷下载/晨读appRes/resources/assets/public/`；书报源为 `../bible/data/raw/spiritual_food/`
- 导出到 `data/`，改动数据源后需重跑导出
- 生命读经 `verses` 来自 `../bible` 的 `生命读经章节映射.json`（ezoe.work 目录页精确标注）；合并卷按「读经：」行拆分到子卷，verses 优先用精确标注，为空或章节号与主书卷不对应时用读经行补齐

## 部署

```bash
vercel --prod --yes --archive=tgz
```
- 生产地址：**https://bible-study-teal-seven.vercel.app**
- 账号 all-the-day；沿用 lingliang-search 的 `--archive=tgz` 约定
- **关键**：`data/` 大文件在 `.gitignore` 里被忽略，但 `.vercelignore` 覆盖了它（只排除 `.vercel/` `.git/` `scripts/`），保证部署时数据能上传。改动数据后先重跑导出再部署。
- **版本同步流程（发版必经，两步缺一不可）**：① push 触发 APK 构建 → 构建自动 patch+1 并把 `[skip ci]` 升版提交写回 main（同时改 package.json + manifest.json）；② 本地 `git pull --rebase origin main` 拉取升版提交 → 再 `vercel --prod` 重新部署，让网页版 manifest.json 与 GitHub Release 对齐。否则网页版本号落后、设置弹窗「检查更新」一直提示新版本。**注意**：push 前若本地落后（有远端升版/其他提交），需先 rebase 再 push，且**部署要在 rebase 之后的干净工作区执行**，避免把旧 manifest.json 部署上去。

## APK 打包（GitHub Actions）

- workflow `.github/workflows/build-apk.yml`：单一 job → **自动递增版本**（release 版本与 package.json 相同时 patch+1，构建成功后 `[skip ci]` 提交推送回 main）→ 版本一致性守卫（package/manifest 版本对齐）→ 准备 web 资源（`www/manifest.json` 版本重写为 package.json）+ 从 Vercel 下载 data（books/text/notes/xrefs/**outlines** + lifereading + books/ + morning/，curl 加固：`--retry-all-errors -4 -f` 兜底 Vercel edge 偶发 TLS 重置）→ `npm install` → `cap add android` → `cap sync` → `capacitor-assets generate`（图标）→ `scripts/patch-android.mjs`（注入原生更新插件 + **强制改写 signingConfigs.debug 指向固定 keystore**）→ 注入固定 keystore 到 `$HOME/.android/` → gradle 构建 debug APK → 上传 artifact
  - **注意**：APK 数据只来自 Vercel 部署产物，不在 git 里；改 `data/` 后务必先 `vercel` 部署再让 APK 构建拉取，否则 APK 拿不到新数据。
  - **注意**：workflow 的 `run:` 块不要用 heredoc（`<<EOF`）——GitHub 解析会失败导致 push 静默不触发，用 `printf`/`--notes-file` 等替代
- 触发：push 到 **main** 且改动前端文件（`app.js`/`style.css`/`index.html`/`update.js` 等）或 `package.json`/`capacitor.config.json`/`resources/**`/`config/**`/`scripts/patch-android.mjs`；`workflow_dispatch` 手动触发
- `scripts/export.py` 改动**不触发** APK 构建（数据走「重跑导出 → Vercel 部署 → APK 下次构建拉新数据」）
- 产出单一 APK（appId `com.allday.biblestudy`，云同步为运行时可选功能）
- **发版流程（版本号自动升级）**：push 触发构建时若 release 版本与 package.json 相同则**自动 patch+1**（构建成功后 `[skip ci]` 提交推送，不二次触发），手动改版本号优先；跨 minor 发版仍可用 `.github/workflows/release-bump.yml`（workflow_dispatch 填 `x.y.z`）显式指定；release 标题「读经 v{version} · 云同步版」，notes 自动取最近 8 条提交
- **签名**：固定 debug keystore 提交在 `config/android/debug.keystore`（JKS，alias `androiddebugkey`，密码 `android`），`patch-android.mjs` 强制改写 `signingConfigs.debug` 指向它（绝对路径+密码），保证**每次构建签名一致**——覆盖安装/App 内更新不丢本地数据；**无上架需求，不配 release 签名**——产物仅限自装/小范围安装测试
- JS 质量门槛：`.github/workflows/check-js.yml` 在改动 JS/JSON 时 `node --check` 全量检查（几秒），语法错误先于 APK 构建拦截

## 测试与 Git 钩子

- **理念**：不要求每次小改动手跑测试。`pre-commit` 只做快速质量门（几秒），全量浏览器测试放到 `pre-push`（push 只在部署时发生）
- **pre-commit**（`scripts/git-hooks/pre-commit`）：`node --check` 全量 JS/JSON（镜像 check-js.yml）+ `sync-merge-test.js` 无浏览器单测；失败则阻止 commit（`--no-verify` 可跳过）
- **pre-push**（`scripts/git-hooks/pre-push`）：调 `scripts/run-all-tests.sh` 全量跑 14 个测试（约 10 分钟），失败则阻止 push（部署前置保证）
- **安装**：`bash scripts/install-hooks.sh` 复制到 `.git/hooks/`（本地配置不入库；新 clone 需重装）
- **run-all-tests.sh**：确保 8765 服务器（无则临时启动，退出时清理）→ 顺序跑全部测试 → 输出解析判定（非零退出 或 含 `✗`/`FAIL ` /`JS 错误: [` 判失败，因为测试断言失败不设退出码）；`SKIP="home-test book-reader-test"` 可跳过部分测试

## 修改守则

- 数据源只在 `scripts/export.py`，不得在 app.js 里硬编码圣经数据
- 标注/笔记存储结构改前先看 `app.js` 的 localStorage 键定义
- 颜色语义（c1-c5）是产品约定，改色不改义
- 云同步改动改 `sync.js` + `app.js` 的 `save()`/`syncFromRemote()`；KV key 约定见「云同步」节

## 文档同步协议（强制）

### 每个任务开始前

1. 阅读根目录 `AGENTS.md`。
2. 检查 `git status --short` 和真实代码，不得仅凭文档推断当前状态。
3. 任务清单最后一项必须是：`检查并同步 AGENTS.md`。

### 必须更新 AGENTS.md 的情况

出现以下任一变化时，必须在同一任务和同一变更集中更新：

- 产品主流程、核心交互或不可破坏的产品约束发生变化
- 数据模型、localStorage 键结构、标注/笔记语义发生变化
- 云同步机制、KV key 约定、同步策略、服务器 CORS 约定发生变化
- 数据导出格式、文件结构、技术栈、部署约定发生变化
- 测试体系、质量门槛发生变化
- 已知问题改变了长期产品约束或数据安全规则

普通缺陷修复、测试数量、短期进度、样式微调**不需要**更新 AGENTS.md，除非同时影响长期工作方式或项目约束。

### 通常不需要更新 AGENTS.md 的情况

- 不改变外部行为的局部重构
- 单纯样式、间距、文案调整
- 普通缺陷修复，且不改变架构或数据契约
- 增加测试用例，但测试策略本身没有变化
- 临时调试代码和一次性调查结果

### 任务完成前

1. 查看完整 diff，判断是否触发上述更新条件。
2. 更新「当前状态」时删除过时描述，不要只追加历史记录。
3. 文档与代码冲突时，以代码为准并修正文档，不得静默忽略。
4. 未经用户明确要求，不得自行创建 Git commit。
5. 最终回复必须包含以下二者之一：
   - `AGENTS.md：已更新——<更新内容>`
   - `AGENTS.md：无需更新——<具体原因>`

未完成文档影响检查，不得声明任务完成。
