# 02 · 布局系统（Layout）

## 1. 视口与高度

- 应用高度用 `--app-h`（JS 实时维护的真实 WebView 高度），不用 `100vh`——Android WebView 缩放时 `100vh` 不跟随。
- 内容区高度 = `calc(var(--app-h, 100vh) - 52px)`（减顶栏）。
- 移动端底部留 `env(safe-area-inset-bottom)`。

## 2. 断点

| 断点 | 行为 |
|---|---|
| ≥1400px | 导航抽屉**停靠常驻**（340px，☰ 收起/展开，`margin-left .25s`）；三栏 grid 完整。2026-11-04 评审 F4 由 1200 抬到 1400：1280px 档正文原本只剩 460px；取 1400 使 1440 档屏（innerWidth≈1423）仍停靠 |
| 900–1399px | 抽屉退为**浮层**（遮罩 + 平移；☰ / crumb 唤出，Esc / 点遮罩关闭）。原因：停靠 340px + 研读列 480px 会把中档屏正文挤到过窄 |
| ≤900px | 移动断点：研读列收起，靠顶栏「读经 \| 研读」pill 切换；移动规则只放本档媒体查询 |

## 3. 阅读器三栏栅格

```
.layout { display: grid; grid-template-columns: minmax(0,220px) minmax(0,1fr) minmax(0,var(--study-w)); }
```

| 栏 | 宽 | 内容 |
|---|---|---|
| ① 停靠列 | 220px（minmax 下限） | `.nav-list`（书卷/篇目列表，`padding 4px`，项 `7px 12px` radius-sm）+ 底部 `.nav-chapters`（章网格：项 38×34，wrap gap 4px） |
| ② 正文列 | 1fr | `.text-col`：`padding 20px 28px 60px`，`background var(--surface)` |
| ③ 研读列 | `--study-w: 480px` | `.study-col`：`surface-alt` 底 + 左 1px border；② ③ 之间 6px `.resize-handle` 拖拽调宽 |

- 听书模块为**单列**（无研读列）。
- 桌面笔记管理：分类树常驻左栏（无 ☰）；移动端仍靠 ☰ 唤出。

## 4. 顶栏区

- 高 52px，`sticky top 0`，z-30；`padding 0 12px`，flex gap 12px。
- 左→右：`☰ icon-btn`（20px）→ `.crumb` 标题（17px/600，flex:1 收缩，书名 shrink 99 不出半字碎屑）→ 模块控件（segment pill / top-btn）→ `Aa` 排版 → `⚙` 设置。
- `.reading-progress`：2px 白条，绝对定位 top 0，`width %` 跟随阅读位置；首页隐藏。
- 顶栏右侧加按钮时，必须同步调移动端 `.crumb` 的 `right`（既有纪律）。

## 5. 导航抽屉（四阅读模块共用）

- 宽 340px。顶部搜索框 → Segment「浏览 \| 历史」→ **双栏主从**：层级一列表（无序号）/ 层级二列表（章、篇），`cur` 高亮同步任意跳转。
- 底部段切换（读经：旧约/新约；书报：辑；仅非扁平系列）。
- 历史 tab：跨模块 50 条上限、同位置去重置顶、可清空。

## 6. 页面类型与路由

| 屏 | 结构 | ☰ |
|---|---|---|
| 首页 | `home-wrap`：搜索 + `home-grid` 合集块网格 + 最近阅读（最近 5 条，无历史不渲染） | 隐藏 |
| 书报合集层 | 同首页结构的二级网格 | 隐藏 |
| 读经/生命读经/书报/听抄 | 三栏阅读器 | 有 |
| 听书 | 单列：标题 + 播放卡 + 分段列表 + 目录抽屉 | 有 |
| 笔记管理 | 三列：分类树 / 条目列表 / 编辑面板（移动端编辑全屏 push） | 桌面隐藏 |
| 专题（活力八） | 任务卡列表，条目全为跳转 | 有 |

新顶层导航入口必须在尾部调用 `syncRoute()`，不另写 `location.hash` / `history`（既有纪律）。

## 7. 首屏 Splash

全屏覆盖 z-100，`linear-gradient(160deg, brand-dark, brand)`：40px 白字 logo → 经文句（17px/2 行距）→ 出处 → spinner（34px）→ 启动进度条（240px/4px，白色 fill）→ 失败时错误文案 + 白底重试按钮（radius 8px）。关键样式在 `index.html` 内联与 `style.css` 双份同步。
