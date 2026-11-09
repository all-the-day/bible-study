# 03 · 组件规格（Components）

> 核心组件按专业解剖结构编写：**用途 → 解剖 → 变体/属性 → 状态矩阵 → 键盘 → 无障碍 → Token → Do/Don't → 代码映射**。
> 次级组件保持紧凑条目。尺寸红线全部实测自 `style.css`；对比度数值见 `04-accessibility.md`。

---

## 核心组件解剖

### A1 Topbar 顶栏

- **用途**：全模块常驻导航壳；承载位置感（crumb）、模块切换（Segment）、全局动作（Aa/⚙/反馈）。
- **解剖**（见 `svg/component-topbar.svg`，2026-11-05 按 8779 实测重绘，桌面+移动双口径）：DOM 序 `homeBtn(house) → menuBtn(menu) → .crumb(flex:1：bookName+chapterLabel+上一章/下一章) → .topbar-actions(双页/隐藏注号/研读全屏/反馈) → Aa(文字钮) → settingsBtn(settings)`，高 52，sticky，z-30，padding 0 12 · gap 12；图标钮为 Lucide v0.462 内联 SVG 24px（house/menu/cog——settings 花瓣造型小尺寸像花朵故弃，2026-11-05 起，unicode 字形弃用；移动端 #homeBtn margin-right -8 使 house↔menu 成组，免两个 44 热区夹 12 gap 显空），`.reading-progress` 2px 白条覆盖顶部（body.home 隐藏）。
- **变体（实测矩阵）**：读经桌面=⌂ ☰+crumb+上一章/下一章+双页/隐藏注号/研读全屏/反馈+Aa+⚙️；读经移动(<900)=⌂ ☰+标题左贴 ☰（crumb 文档流 flex 子项 flex:1 min-width:0，点击与 ☰ 同为 openNavDrawer，成组暗示同一功能；章号 flex-shrink:0 永不截断、书名单一 ellipsis 点（min-width 3em 保底两字）——绝对定位 left/right 魔法数已退役，二轮补丁起零重叠；右簇 flex-shrink:0 + 控件 nowrap 零形变，空间不足由书名单方承担；≤400px 顶栏轻压缩（gap 8/padding 收）；移动支持下限 360px（320 极端档章尾可能压裁，不入支持矩阵））+读经|研读 pill+Aa+⚙️（双页/隐藏注号/研读全屏/反馈隐藏）；听书=反馈+⚙️（Aa 全局隐藏；移动端反馈也隐藏→仅 ⚙️）；首页/书报合集层=crumb/☰/⌂ 隐藏，桌面右簇 反馈+Aa+⚙️（移动 Aa+⚙️），无品牌标题字；笔记管理=移动端 ☰ 常驻（分类树进统一抽屉，左对齐标题）、桌面 ☰ 隐藏（≥901px），右簇 Aa+⚙️+反馈（桌面）；paper·minimal 主题=融合底+墨字+1px 下边线。反馈按钮全模块常显（桌面）。
- **属性**：`showMenu` `showTypo` `showSettings`；`crumb`（书名 shrink:99 收缩不出半字）；主题继承。
- **状态矩阵**：默认 / hover（icon-btn→`--topbar-btn`）/ active（top-btn→`--topbar-btn-on`）/ 主题变体 ×4。
- **键盘**：☰/Aa/⚙ 均为原生 button，Tab 可达，Esc 关其弹层。
- **无障碍**：图标按钮必须有 `aria-label`；白字对比 3.66:1（classic 已知问题，见 04 §1.2）；crumb 右侧加按钮必须同步移动端 `.crumb` 的 right（红线）。
- **Token**：`--topbar-bg/-fg/-solid/-line/-btn/-shadow`。
- **Do**：控件靠右成簇、间距 12。**Don't**：在 crumb 里塞二级信息；改渐变而不验对比度；换 keystore 类"顺手改"。
- **代码**：`.topbar/.crumb/.icon-btn/.top-btn` @ style.css §顶栏。

### A4 Segment 分段器

- **用途**：互斥的模式/范围切换（读经|研读、浏览|历史、旧约|新约）。
- **解剖**：pill 容器 + 2~3 个等宽项；激活项实底。
- **变体/属性**：`skin=brand`（激活=白底+`--brand-dark` 字）/ `skin=surface`（激活=`--brand` 底白字）；`options[]` `value`。
- **状态**：default / active / hover / focus-visible（补 2px 焦点环）。
- **键盘**：`role="tablist"/tab` + `aria-selected`；←→ 切换（APG tabs 模式）。
- **无障碍**：on-surface 激活白字 on `--brand` = 对比达标；on-brand 激活 brand-dark on #fff = 4.84 ✓。
- **Token**：`--pill-bg/-fg/-active-bg/-active-fg`。
- **Do**：项数 2~3；文案 ≤3 字。**Don't**：一处页面混用两种 skin；用 Segment 做过滤（用筛选弹窗）。
- **代码**：`.mode-pill` / 抽屉 Segment @ style.css。

### A5 NavDrawer 导航抽屉

- **用途**：四阅读模块共用的层级浏览 + 搜索 + 历史。
- **解剖**：搜索框 → Segment(浏览|历史) → 双栏主从（层级一无序号 / 层级二剥序号）→ 底部段切换；宽 340。
- **变体**：停靠（≥1400 常驻，`margin-left .25s`；评审 F4 由 1200 抬到 1400）/ 浮层（<1400，backdrop z-80 + 抽屉 z-81）。
- **状态**：`cur` 高亮（跟随任意跳转）/ hover `--hover` / 浮层遮罩。
- **键盘**：Esc 关浮层（已实现）；Enter 进列表项；方向键导航=待补（见 05）。
- **无障碍**：`role="dialog"`（浮层态）+ `aria-modal`；遮罩点击关闭；焦点关闭后归还 ☰。
- **Token**：`--surface/-border/-hover`、`--z-backdrop/-dock`。
- **Do**：层级一保持无序号；`cur` 与正文位置强同步。**Don't**：901–1199px 用停靠（挤死正文）；扁平系列显示辑切换。
- **代码**：`#navDrawer` @ app.js；`.nav-*` @ style.css。

### B1 VerseCard 经文卡片

- **用途**：经文的容器单元；承载编号、注脚、串珠、五色标注、人物/引用链接。
- **解剖**：`.verse`（card-bg+1px border+radius-md 8+padding 8 18+`--card-shadow`）> `.vnum` + `.vtext`（18px×scale，行距 `--reading-lh`）。
- **变体**：classic 卡片化 / paper 去卡片化（`--verse-sep` 分隔线 + `--vnum-color` 换挡）。
- **状态**：标注 5 色 mark（50% 透明底）/ fn-ref hover 加深 / ref-link 可点。
- **键盘**：fn-ref、ref-link、person 为 Tab 可达的内联控件（Inline 例外，目标尺寸豁免）。
- **无障碍**：标注底对比 c1–c5 = 12.89/8.84/6.00/8.23/7.26 全 PASS（04 §1.1）；vnum/ref-link 已换 brand-dark 4.84 ✓（评审落地）。
- **Token**：`--card-bg/-border/-shadow`、`--vnum-color`、`--c1..c5`、`--fn-ref`、`--person`。
- **Do**：标注定位基于源文本偏移+`text/prefix/suffix` 自愈，`data-base` 坐标神圣。**Don't**：改五色语义；硬编码经文正文；重排（卷,位置）索引。
- **代码**：`.verse/.vtext/mark.c*/sup.fn-ref` @ style.css；渲染器 @ app.js。

### C1 StudyPanel 研读列

- **用途**：右栏研读区（注解/纲目/生命读经/笔记 tab），与正文列联动的第二阅读面。
- **解剖**：`.study-col`（480px `--study-w`，surface-alt 底+左 1px border）→ `.study-tab` ×3（激活 2px 品牌下边线）→ `.study-body`；左缘 6px `.resize-handle`。
- **变体**：读经=注解|生命读经|我的笔记；其余=纲目|笔记；听书无此列。
- **状态**：tab 激活/条目卡 hover/空态 empty-hint/拖拽中（handle 高亮）。
- **键盘**：tab 为 `role="tab"`+方向键；拖拽 handle 提供键盘等价（如 `[` `]` 调宽）=待补。
- **无障碍**：tab 激活下边线 2px 品牌色对 surface-alt ≥3:1 ✓；条目卡 meta 12px muted 4.68 ✓。
- **Token**：`--study-w`、`--surface-alt`、`--grab-bg`。
- **Do**：条目卡统一 `fn-item/lr-item/note-item` 三件套。**Don't**：研读列宽写死（必须可拖拽）；窄屏硬塞三栏（走 pill 切换）。
- **代码**：`.study-col/.study-tab/.resize-handle` @ style.css。

### D1 HomeBlock 合集块

- **用途**：首页与书报合集层的入口磁贴（数据驱动）。
- **解剖**：卡片（radius-md+border+shadow）> 图标（彩色 emoji 直出 40px——2026-11-09 用户品味决策 A 回归：磁贴位色彩身份/暖感优先，emoji 渲染稳定无对齐问题；Lucide 保留在顶栏/控件位）+ 标题 15/600；无副文案（2026-11-05 评审 P1-1 处置：统计型对目标读者冗余、窄卡溢出且块高不齐——磁贴职责=识别+启动，与书报二级层两件套同构）。
- **变体**：全主题彩色 emoji（2026-11-09 决策 A 回归；F5 的全主题线性在磁贴位作废——色板对比留档 ui-spec/icon-style-ab.html）；hover 上浮。
- **状态**：default / hover（上浮+阴影加深）/ focus-visible。
- **无障碍**：整块为单个 `<a href>`；图标装饰性 `alt=""`，标题承载语义；副文案数字真实（不发明指标）。
- **Token**：`--surface/-border/-radius-md`、`--brand`。
- **Do**：书报二级层同构复用。**Don't**：emoji 当线性图标混排（主题规则二选一）；新入口忘 `syncRoute()`。
- **代码**：`.home-block/.home-block-icon` @ style.css；渲染 @ app.js homeGrid。

### E1 PlayerCard 播放器卡片

- **用途**：听书模块的播放控制中枢（单列布局）。
- **解剖**：段标签 → 时间行（tabular-nums）→ 进度条（track 4px+brand 已播+圆点）→ 控制行（±15s 图标、56px 品牌圆钮、SpeedPill）。
- **属性**：`segment{index,total,current,duration,ratio}` `state=buffering|error|ready` `speeds[0.75,1,1.25,1.5,2]`。
- **状态**：缓冲中… / 错误+重试（保留位置 + 退避冷却 0/2/4/8s，连败计数展示）/ 播放中（钮=暂停）/ 拖动中（横拖跟随，纵滑仍滚动）。
- **键盘**：空格播放暂停；←→ ±15s；进度条 `role="slider"` + `aria-valuenow`（补）。
- **无障碍**：时间 tabular-nums ✓；状态变化用 `role="status"` 播报「已切至第 N 段」（建议）。
- **Token**：`--slider-track`、`--brand`、`--radius-md`。
- **Do**：段标签始终可见（口径区分红线）。**Don't**：把整讲时长画进进度条；重试丢失播放位置。
- **代码**：播放器渲染 @ app.js audio 模块。

### F1 Modal 弹窗

- **用途**：模态任务（设置/注脚/人物/指定篇目/更新）。
- **解剖**：backdrop z-84 → popup z-85（radius-lg 12 + `--shadow-overlay`）→ 标题行 + 关闭 + 业务体。
- **状态**：开/关（0.25s 上浮淡入）；打开时焦点圈闭合，Esc/遮罩/✕ 三路关闭。
- **键盘**：打开→焦点入弹窗；关闭→焦点回触发钮；Tab 圈内循环（合法焦点陷阱）。
- **无障碍**：`role="dialog"`+`aria-label`；✕ 有 aria-label；危险操作确认框明示后果（重读范式）。
- **Token**：`--radius-lg`、`--shadow-overlay`、`--z-overlay/-popup`。
- **Do**：骨架不含业务 DOM。**Don't**：多层叠弹窗（typo z-88 除外）；忘焦点归还。
- **代码**：popup 体系 @ app.js；`#popupBody` @ index.html。

---

## 次级组件（紧凑规格）

| 组件 | 关键规格 | 红线 | 稿件 |
|---|---|---|---|
| IconBtn 图标按钮 | 20px 字形 · padding 4 8 · radius-sm · hover `--topbar-btn` | 必带 aria-label | buttons |
| TopBtn 描边按钮 | 13px · 1px 描边 · padding 4 10 · `.active`=btn-on · 实测命中 47.6×28.8 ✓ AA | 反馈/重试语义全程同名 | buttons |
| ChItem 章格 | 38×34 · wrap gap 4 · active 品牌底 | 不与列表项混用 | buttons |
| Switch 开关 | 40×24 · 滑块 20 · `--ring` 白 · transition .2s | `role="switch"` | buttons |
| SpeedPill 倍速 | 40×26 pill · 档位固定 0.75/1/1.25/1.5/2× | 档位不可增删 | player |
| SearchInput 搜索框 | h34 · radius 8 · 13px placeholder | placeholder 非 label；0 结果回显查询词 | navdrawer |
| RecentList 最近阅读 | 5 条上限 · 无历史不渲染 | 不发明条数 | home |
| NoteEditor 笔记 | textarea 14px×scale · min-h 80 · resize vertical | 失败不清空输入 | reading |
| SettingsList 设置分组 | surface-alt 卡 · row 12/14 · 行间 1px | 分组标签 12px muted | modal |
| Badge 状态徽标 | 11px · radius 10 · on=success | 文字用深档（04 §1.2） | modal |
| AnnotationToolbar 标注条 | 深底 pill · 5 色点 r10 · z-82 | 点色即存；改色/改笔记/删除分离 | annotation |
| Toast 轻提示 | 底部居中 · 上浮 10px · z-90 | `role="status"`；悬停暂停已实现（评审 F10） | annotation |
| MiniPlayer 迷你播放条 | fixed 底部 · max-w 720 · z-79 · 34px 播放钮 + 标题/时间/细进度 | 仅「已加载音频且不在听书模块」显示；toast/mode-pill 让位；正文列补底部 padding；标题点击回听书；`body.mini-audio` 驱动 | design-review F7 |
| LoadingHint/ErrorHint/EmptyHint | spinner 18px · 错误三问 · 空态带 CTA | 永不无限转 | annotation |
| RefLink 引用链接 | 品牌色内联 → 跳对应章 | 3.54 ✗ 建议换 brand-dark | reading |
| PersonLink 人物链接 | 青绿 #0f7b6c 4.99 ✓ → 人物小传弹窗 | 弹窗含 meta+摘录 | reading |
| OutlineItem 纲目行 | 10 级 · ol1 17px/600 · ol2 brand · 不逐级缩进 | 纲目结构行不判为碎片 | reading |
| ResizeHandle 拖拽条 | 6px · `--grab-bg` | 提供键盘等价（待补） | reading |
| Splash 首屏 | z-100 · 渐变底 · 进度 240×4 · 失败+重试 | 内联 CSS 与 style.css 双份同步 | modal |

> 全部组件的 JSX 声明见 `jsx/components.jsx`（设计契约，非可构建代码）；渲染底稿在 `svg/`。
