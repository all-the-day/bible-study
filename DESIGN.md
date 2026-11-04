# bible-study — 读经研读笔记 · 设计系统（DESIGN.md）

> 单文件蒸馏版：给 AI 工具与协作者的对齐入口。完整规格在 [`ui-spec/`](ui-spec/README.md)（Token/主题矩阵 → 布局断点 → 组件解剖 → 无障碍审计 → 状态与文案）。
> 基于 v1.0.69 · 2026-11-03。零框架原生 JS PWA + Capacitor APK；数据来自兄弟项目 `../bible` 经导出脚本入库。

## 1. 产品身份

- **是什么**：读经研读工具——经文（恢复本）+ 生命读经 + 书报 + 听抄 + 听书 + 笔记管理，PWA 离线可用。
- **使用者**：长时间阅读标注的严肃读者；桌面三栏深读、移动单列通勤。
- **页面唯一职责**：让正文可长时间阅读、让划线笔记零摩擦——界面永远让位于内容。

## 2. 设计原则（不可协商）

1. **阅读优先**：正文 18px×`--reading-scale`(0.85–2.0)、行距 `--reading-lh`(1.5–2.4)；UI 控件永不随阅读缩放。
2. **经典主题 = 零回归基线**：classic 值 1:1 对应原始实现；主题差异只放 `:root[data-theme=…]` 覆盖块。
3. **五色标注语义锁定**：黄=重要 / 绿=神 / 紫=「我是耶和华」/ 蓝=神所喜爱 / 红=审判禁止；50% 透明渲染，永不改值。
4. **token 纪律**：新样式一律用 `:root` token；禁止裸色值/裸字号；语义命名（禁止 hue 命名入库）。
5. **标注坐标神圣**：标注按源文本偏移定位 + `text/prefix/suffix` 自愈；渲染器改动必须保持 `data-base` 一致。

## 3. 核心 Token（全表见 ui-spec/docs/01）

| 类别 | 值 |
|---|---|
| 品牌色 | `--brand` #667eea · `--brand-dark` #5B67D4（渐变 135° 顶栏） |
| 中性 | page `#f0f3f9` · surface `#fafbff` · surface-alt `#f3f6fc` · border `#e6e8f0` |
| 文字 | text `#1f2937` · soft `#4b5563` · muted `#6b7280` · heading `#111827` |
| 功能 | danger `#d9534f`/deep `#b91c1c` · success `#16a34a` · fn-ref `#c07818` · person `#0f7b6c` |
| 五色标注 | c1 #FFEB3B · c2 #4CAF50 · c3 #9C27B0 · c4 #2196F3 · c5 #F44336 |
| 圆角 | sm 6 · md 8 · lg 12 · pill 999 |
| 阴影 | sm `0 1px 4px` · md `0 6px 16px` · overlay `0 8px 24px` · 卡片品牌蓝 `0 1px 5px rgba(102,126,234,.2)` |
| 字号 | `--fs-10…40` 刻度；正文走 `calc(基准×--reading-scale)` 白名单 |
| 层级 | topbar 30 < backdrop 80 < dock 81 < floattool 82 < popup 85 < typo 88 < toast 90 < splash 100 |
| 主题 | classic（默认）/ indigo / paper / minimal —— 差异只覆盖 token |

## 4. 布局与断点

- 阅读器三栏 `grid: minmax(0,220px) / 1fr / minmax(0,480px)`；高度 `calc(--app-h - 52px)`（JS 实测高度，不用 100vh）。
- 断点：**≥1200** 抽屉停靠（340px）｜**900–1199** 抽屉浮层（340+480 会挤死正文）｜**≤900** 移动（研读列收进顶栏「读经|研读」pill）。
- 顶栏 52px sticky；阅读进度 2px；页面类型：home / bookhub / reader×4 / audio(单列) / notes(三列) / topic。
- 新顶层入口必须走 `syncRoute()`，不手写 `location.hash`。

## 5. 组件清单

Topbar · IconBtn · TopBtn · Segment(on-brand/on-surface) · NavDrawer · VerseCard · OutlineItem · Mark(五色) · FnRef · PersonLink · RefLink · StudyPanel · StudyItem · NoteEditor · HomeBlock · RecentList · PlayerCard · SegmentList · Modal · SettingsList · Switch · Badge · AnnotationToolbar · Toast · 三态占位(Loading/Error/Empty) · Splash · ResizeHandle
→ 每个组件的解剖/变体/属性/状态/键盘/Do-Don't 见 `ui-spec/docs/03-components.md`；SVG 稿 `ui-spec/svg/`；JSX 契约 `ui-spec/jsx/`。

## 6. 状态与文案（详见 ui-spec/docs/05）

- **五态必须齐**：Loading（带超时出口）/ Empty（标题+解释+行动）/ Error（三问：什么·原因·怎么办）/ Populated / Edge（书名收缩、>50 截断注明）。
- 错误文案范例：「音频加载失败，请检查网络」+「重试」（保留播放位置）。
- 文案：动词开头、具体、全程同名；数字 tabular-nums；危险操作明示后果与不可撤销。

## 7. 无障碍门槛（详见 ui-spec/docs/04）

- WCAG 2.2 AA 为工作上限：正文 4.5:1、大字/组件 3:1、焦点 3:1、触摸目标 ≥24×24（AA）。
- **已知欠账（classic 主题 5 处）**：顶栏白字 3.66 / brand 文字 3.54 / fn-ref 3.42 / danger 3.83 / success 3.19 —— 整改方案已列 04 §1.2，属 v1.1 候选。
- 焦点 `:focus-visible`；禁裸 `outline:none`；图标按钮必有 `aria-label`；原生元素优先，不发明 ARIA。
- 优势项保持：阅读缩放 0.85–2.0（低视力）、重试保留位置、复制带出处。

## 8. Agent Prompt Guide（AI 生成/修改本应用 UI 时）

1. 只用 §3 的 token；需要新值先在 ui-spec 提案，不许内联十六进制。
2. 文字宽度不估算：改版式前用测量脚本（ui-spec/.tmp-shots/ 下的 measureText/getBBox 工具）取实测值，按 flex 模型（间距统一 12、右簇贴右、垂直居中于栏中心）落坐标。
3. 交互面先补五态再画常态；错误文案过「三问」；spinner 必有超时。
4. 改动后走 CR：Chrome headless 渲染 + getBBox 量宽 + 逐图目检（流程见工作区记忆/ui-spec）。
5. 未经明确许可不 commit / push / deploy / 升版本 / 触发 APK 构建（AGENTS.md 纪律）。
6. 经文与书报正文一律来自导出脚本产物，禁止硬编码；不得绕过导出脚本直接改库。
