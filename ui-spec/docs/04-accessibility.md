# 04 · 无障碍（Accessibility）

> 目标线：**WCAG 2.2 AA**（同时满足 EU EN 301 549 / US ADA 引用的 WCAG 2.1 AA 法律底线）。
> 本文所有对比度为脚本实测（`ui-spec/.tmp-shots/contrast.py`，WCAG 2.x 相对亮度公式），非估算。

## 1. 对比度审计（2026-11-03 实测）

门槛：正文/小字 **4.5:1**；大字（≥18pt 常规 ≈24px，或 ≥14pt bold ≈18.5px）**3:1**；非文字 UI 组件 **3:1**。阈值含边界，不四舍五入。

### 1.1 通过项

| 主题 | 配对 | 比值 | 结果 |
|---|---|---|---|
| classic | 正文 #1f2937 on surface | **14.20** | PASS |
| classic | 次级 #4b5563 | 7.31 | PASS |
| classic | 弱化 #6b7280 | 4.68 | PASS |
| indigo / minimal | 正文 14.92 / 15.09；次级 9.57 / 9.09；弱化 4.67 / 5.07 | — | 全 PASS |
| paper | 正文 12.94；次级 9.20；弱化 4.74 | — | 全 PASS |
| indigo / minimal | 顶栏白字 on #5662CE | **5.21** | PASS |
| classic | 顶栏白字 on 渐变深端 #5b67d4 | 4.84 | PASS |
| classic | pill 激活字 #5b67d4 on #fff | 4.84 | PASS |
| classic | person 青绿 #0f7b6c | 4.99 | PASS |
| classic | **五色标注 50% 底上的正文**：c1 黄 12.89 / c2 绿 8.84 / c3 紫 6.00 / c4 蓝 8.23 / c5 红 7.26 | — | **全 PASS** |

> 五色标注虽视觉饱和，50% 透明合成底对 #1f2937 正文全部达标——**标注语义与色值维持不变的纪律与无障碍不冲突**。

### 1.2 未达标项与整改（2026-11-04 已在 feat/ui-refactor 分支落地 5 项）

| 位置 | 实测（改前→改后） | 状态 | 落点 |
|---|---|---|---|
| 顶栏渐变浅端 #667EEA | 3.66 → **4.84/6.71**（#5B67D4→#4651B8） | ✅ 已改 | style.css `--topbar-bg/-solid` |
| vnum / 链接 brand 文字 | 3.54 → **4.84**（#5B67D4） | ✅ 已改 | `--vnum-color`、`.ref-link` |
| `.popup-btn.danger` 白字 | 3.96 → **6.47**（#b91c1c） | ✅ 已改 | `.popup-btn.danger` |
| `.sync-st-on` 文字 | 3.19 → **7.13**（--success-deep #166534） | ✅ 已改 | `.sync-row b.sync-st-on` |
| 注脚上标 #c07818 | 3.42 | ⬜ 待改 | 建议加深至 #a36112 一档 |

澄清（CR 核实）：`--danger`/`--success` 的 hover 图标与边框用法均过 3:1 图形档 ✓；`.settings-badge.on` 已用 `--success-deep` ✓；音频错误文字已用 `--danger-deep` ✓——这两色的**文字场景欠账只有上表两处**。

> 优先级：vnum/链接（每屏高频）> `.popup-btn.danger`（删除确认主按钮）> 顶栏 > fn-ref > sync 文字。整改属 UI 变更，须与「经典主题零回归」纪律权衡：可只在非 classic 主题先行，或作为 v1.1 一次性修。

## 2. 焦点可见

- 键盘焦点必须用 `:focus-visible`；**禁止 `outline:none` 而无替代**（同时违反 1.4.11 / 2.4.7 / 2.4.13）。
- 焦点指示对相邻状态对比 ≥3:1；建议 2px 品牌色 outline + 2px offset。
- 弹窗/抽屉关闭后焦点返回触发按钮；弹窗内 Tab 循环（焦点圈闭合法：modal 捕获焦点直到 Esc/关闭，属正确行为，不算键盘陷阱）。

## 3. 触摸目标（Target Size）

AA 法定线 **24×24 CSS px**（WCAG 2.5.8）；44×44 是 AAA/苹果 HIG（常见引用错误）。例外：Spacing（24px 排除圈）、Inline（句内链接）等五项。

| 控件 | 实际命中区（Chrome 实测，测量页 `.tmp-shots/measure.html`） | 判定 |
|---|---|---|
| `.icon-btn`（☰/⚙️） | **34×34.4** | ✓ |
| `.aa-btn`（Aa） | 34.2×25.6 | ✓ |
| `.switch` | 40×24 | ✓（正好压线） |
| `.ch-item` 章格 | 38×34 | ✓ |
| `.top-btn`（反馈/重试） | **47.6×28.8** | ✓（行高继承 normal，实际高于视觉估算） |
| `.mode-pill` 单枚 | 33.9×26.4 | ✓ |
| 标注工具条色点 | 视觉 Ø20 | 命中区需确认 ≥24 或依赖 Spacing 例外 |
| `fn-ref` 注脚上标 | ~11px 字形 | Inline 例外适用（句内）✓ |

## 4. 键盘与语义

- 所有交互元素键盘可达（2.1.1）；**禁止 `tabindex>0`**；Tab 序即 DOM 序。
- 原生优先：动作用 `<button>`，导航用 `<a href>`；裸 `<a>` 加 onclick 不是链接。自定义控件按 ARIA APG 原样实现，**不发明 ARIA**（WebAIM 2026：ARIA 页面平均错误 59.1 > 非 ARIA 42）。
- 弹窗 `role="dialog"` + `aria-label`；Segment/Tab 用 `role="tablist"/"tab"` + `aria-selected`；开关 `role="switch"` + `aria-checked`；Toast `role="status"`。
- 图标按钮必须有 `aria-label`（☰=目录、Aa=排版、⚙=设置）；重要操作不靠图标单独传达。
- `<html lang="zh-CN">`；标题层级不跳级；landmark（header/nav/main/aside）优先于 div。
- 键盘速查：Esc=关弹窗/关浮层抽屉（已实现）；抽屉/列表方向键导航=**待确认项**（进 05 的状态核对）。

## 5. 表单

- 每个输入有可见 label；placeholder 不是 label（消失于输入，违反 1.3.1/3.3.2）。
- 错误接线：`aria-describedby` 指向提示与错误，`aria-invalid="true"`，错误消息 `role="alert"` 并聚焦首个错误字段。
- 笔记 textarea 等：提交失败不清空用户输入。

## 6. 动效

- 尊重 `prefers-reduced-motion`：spinner/上浮/平移在减动效偏好下降级为淡入或直接呈现。
- WCAG 2.3.1：每秒闪烁 >3 次不合规（splash spinner、进度条动画均远低于，合规）。
- spinner 必须有超时出口（见 05 §加载阈值），禁止无限转。

## 7. 已有优势（保持）

- `--reading-scale` 0.85–2.0 全正文缩放 = 内建低视力支持，优于多数同类应用。
- 断点 900/1200 有真实的可读性依据（非拍脑袋），移动端为重排而非缩放桌面版。
- 音频重试保留失败位置、复制附出处——错误恢复与可溯源是超出 AA 的体验细节。
