# 01 · 设计基础（Foundations）

> 所有数值取自 `style.css` `:root`（classic 主题 = 原始值 1:1）。

## 1. 色彩

### 1.1 品牌与中性

| Token | 值 | 用途 |
|---|---|---|
| `--brand` | `#667eea` | 主强调色：激活态、进度、播放按钮、链接性文字 |
| `--brand-dark` | `#5B67D4` | 渐变深端、pill 激活文字 |
| `--brand-rgb` | `102, 126, 234` | rgba 组装用 |
| `--page-bg` | `#f0f3f9` | 页面底色 |
| `--surface` | `#fafbff` | 卡片 / 栏底色 |
| `--surface-alt` | `#f3f6fc` | 次级面：设置分组、摘录块 |
| `--border` | `#e6e8f0` | 1px 分隔线、卡片描边 |
| `--text` | `#1f2937` | 正文 |
| `--text-soft` | `#4b5563` | 次级文字 |
| `--text-muted` | `#6b7280` | 弱文字：meta、空态 |
| `--heading` | `#111827` | 标题 |
| `--scripture-bg` | `#f6f7fa` | 经文区底 |
| `--hover` | `#f0f4ff` | 列表 hover |
| `--ring` | `#fff` | 开关滑块圆色 |

### 1.2 顶栏（on-brand）

| Token | classic 值 |
|---|---|
| `--topbar-bg` | `linear-gradient(135deg, #667EEA, #5B67D4)` |
| `--topbar-solid` | `#667eea`（iOS 26 Safari 顶部取色专用，渐变不参与） |
| `--topbar-fg` | `#fff` |
| `--topbar-shadow` | `var(--shadow-md)` |
| `--topbar-line` / `-strong` | `rgba(255,255,255,.4)` / `.5` |
| `--topbar-btn` / `-on` | `rgba(255,255,255,.15)` / `.25` |

白字对 `#667eea` 对比度约 3.7:1（大字号档）；顶栏文字均为 17px/600 或图标，不放置小号正文。

### 1.3 功能色

| Token | 值 | 用途 |
|---|---|---|
| `--danger` / `-soft` / `-deep` | `#d9534f` / `rgba(217,83,79,.08)` / `#b91c1c` | 删除、危险操作 |
| `--success` / `-soft` / `-deep` | `#16a34a` / （soft/deep 同构） | 云同步已连接徽标 |
| `--fn-ref` / `-hover` | `#c07818` / `#e08000` | 注脚上标（数字偏橙） |
| `--person` / `-dark` | `#0f7b6c` / `#0a5c51` | 人物链接（正文人名） |
| `--note-wavy` / `--note-soft` | `#eb6c05` / `rgba(235,108,5,.08)` | 笔记波浪线 |

### 1.4 五色标注（语义锁定，不可改）

| Token | 值 | 语义 |
|---|---|---|
| `--c1` | `#FFEB3B` 黄 | 重要的句子 |
| `--c2` | `#4CAF50` 绿 | 耶和华我的神等 |
| `--c3` | `#9C27B0` 紫 | 「我是耶和华」 |
| `--c4` | `#2196F3` 蓝 | 神所喜爱、赞赏的 |
| `--c5` | `#F44336` 红 | 神所恨恶、审判、禁止的 |

划线渲染为 50% 透明底（如 `mark.c1 { background: rgba(255,235,59,.5) }`），保证黑字可读。

## 2. 字体

**栈**：`-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`；正文行高 1.9。

### 2.1 UI 字号刻度（`--fs-*`，不随阅读缩放）

| Token | 值 | 典型用途 |
|---|---|---|
| `--fs-10/11` | 10/11px | 微标（settings-badge 11px） |
| `--fs-12` | 12px | 分组标签、meta、时间 |
| `--fs-13` | 13px | 顶栏按钮、pill、value |
| `--fs-14` | 14px | tab、toast、条目正文 |
| `--fs-15` | 15px | 抽屉列表项 |
| `--fs-16` | 16px | body 基准 |
| `--fs-17` | 17px | crumb 标题 |
| `--fs-18/20` | 18/20px | 图标字号、箭头 |
| `--fs-30/40` | 30/40px | splash logo |

### 2.2 阅读字号白名单（随 `--reading-scale` 0.85–2.0 缩放，行距 `--reading-lh` 1.5–2.4）

| 场景 | 基准 | 公式 |
|---|---|---|
| 经文正文 | 18px | `calc(18px * var(--reading-scale))` |
| 生命读经正文 | 17px | 同上 |
| 书报正文 | 15px | 同上 |
| 章纲目 / 主题行 | 14–15px | 同上 |
| 注脚上标 | 11px | 同上 |
| 字体 | 黑体（默认）/ 宋体 | 评审 F9：`--reading-font` 由 Aa 面板驱动，宋体栈 Noto Serif SC → Songti SC → SimSun；仅作用于阅读正文（.verse/.lr-content/.lr-para/.bk-para/.morning-para/纲目行），节号与 UI 保持无衬线 |

UI 控件一律不进白名单。

## 3. 圆角

| Token | 值 | 典型用途 |
|---|---|---|
| `--radius-sm` | 6px | 图标按钮、列表项、top-btn |
| `--radius-md` | 8px | 卡片（经文/条目/播放器）、设置分组 |
| `--radius-lg` | 12px | 开关轨道、popup |
| `--radius-pill` | 999px | segment pill、toast、倍速按钮 |

## 4. 阴影

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,.06)` | 条目卡片 |
| `--shadow-md` | `0 6px 16px rgba(0,0,0,.08)` | 顶栏 |
| `--shadow-overlay` | `0 8px 24px rgba(0,0,0,.18)` | 浮层 / 弹窗 |
| `--card-shadow`（classic） | `0 1px 5px rgba(102,126,234,.20)` | 经文卡片的品牌色蓝阴影（主题差异项） |

## 5. 层级（z-index）

```
splash 100 › toast 90 ≈ update 90 › typo 88 › popup 85 › overlay 84
› floattool 82 › dock 81 › backdrop 80 › progress 35 › topbar 30
```

浮层从下往上：抽屉（backdrop/dock）→ 标注工具条 → 弹窗 → 排版面板 → 更新/Toast → Splash。

## 6. 动效

| 项 | 值 |
|---|---|
| 开关背景 / 滑块 | `transition .2s` |
| Toast | `opacity .25s, transform .25s`（上浮 10px 入场） |
| 抽屉停靠 | `margin-left .25s ease` |
| 阅读进度条 | `width .08s linear` |
| 旋转 | `spin .8s–.9s linear infinite` |

## 7. 四主题矩阵

主题切换挂 `:root[data-theme=…]`，只覆盖差异 token；classic 为默认（无 data-theme）。

| Token | classic | indigo | paper（暖纸） | minimal（素灰） |
|---|---|---|---|---|
| `--brand` | `#667eea` | `#5662CE` | `#8a6a2f` | `#5662CE` |
| `--page-bg` | `#f0f3f9` | `#f4f5f8` | `#faf7f1` | `#f6f6f8` |
| `--surface` | `#fafbff` | `#ffffff` | `#fffdf8` | `#ffffff` |
| `--border` | `#e6e8f0` | `#e7e8ec` | `#eae3d5` | `#e6e6ea` |
| `--topbar-bg` | 渐变 | `#5662CE` 纯色 | 纸色同页面 | 同页面灰 |
| `--topbar-fg` | `#fff` | `#fff` | `#33302a` 墨字 | `#1c1c1e` |
| `--card-bg` | `var(--surface)` | 同 | `transparent` | 同 |
| `--card-shadow` | 品牌蓝阴影 | 浅阴影 | `none` | `none` |
| 经文分隔 | 无（卡片化） | 无 | `1px solid #f0eadd` | 卡片保留 |
| 首页块图标 | emoji | 线性图标 | 线性图标 | 线性（灰） |

主题选型备注（来自代码注释）：paper 明度 ≥96%，避免挤压 c1 黄标注；minimal 走 iOS 灰阶 + 单一靛蓝 accent。**五色标注、字号、圆角、层级在各主题下不变。**

### 暗夜 dark（2026-11-04 评审 F1 新增）

- 底色 #111318 / 面 #191b22 / 次面 #20232c / 边 rgba(255,255,255,.09)；正文 #e7e9f0，避开纯黑纯白。
- 品牌色提亮 #8b96ff（暗底对比 6.55）；顶栏 #15161d 融合底；splash 同步转暗。
- 语义色提亮：danger #e07a76 / success #4ade80 / fn-ref #e0a458 / person #3fc9ba（文字全部 ≥4.5）。
- 五色标注透明度 50% → 25–35%（暗底正文对比 6.9–10.9，见 04 §1.1）。
- 语义修正：--danger-deep 在暗色下兼任文字色（亮），弹窗按钮底单独回 #b91c1c。

## 8. 排版细则（craft）

- **三字重制**：400 正文 / 600 强调与 UI 标签 / 700 稀用（大标题、激活 pill）。全应用不出现 500/800。
- **字距**：中文界面默认 0；小号（≤13px）可 +0.01em；若引入英文全大写标签必须 +0.06em 起。
- **行宽**：正文列建议 ≤38em（900–1200px 区间约 30–45em，靠研读列 480px 兑底）；长文段落禁 `justify`（书报标题行除外）。
- **数字**：时间/计数用 tabular-nums（播放器时间已遵守，抽屉计数建议跟进）。
- **标题层级**：视觉字号与语义层级独立；一屏一个 h1，不跳级。

## 9. 色彩使用纪律（craft）

- **accent 限额**：一屏品牌色可见使用 ≤2 处（文字/链接/激活态计入）；读经正文页 vnum+ref-link 已达 2，新增前先削减。
- **链接与 CTA 同屏**：链接降级为文字色+下划线，不与主 CTA 抢 accent。
- **语义命名**：新增色一律语义 token（如 `--danger-deep` 式），禁止 hue 名（`--blue-500`）入库。
- **深色主题（未来）**：底 #0f0f0f 系、字 #f0f0f0 系，禁纯黑纯白；边框用半透明白而非实色深边。
- **对比度门槛**：正文 4.5:1 / 大字与组件 3:1；四主题实测审计与 classic 5 处整改案见 [04-accessibility.md](04-accessibility.md)。
