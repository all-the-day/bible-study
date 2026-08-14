# bible-study — 读经研读笔记 PWA

## 项目定位

**读经研读/预习草稿工具**：选一章（如 创 24）→ 聚合查看原文、注解、相关生命读经 → 在材料上划线、标记、写笔记 → 笔记按章累积。

与兄弟项目的边界：
- **bible**（`../bible`）— 数据源，通过 `query_api.py` 提供经文/注解/串珠/生命读经。本项目的 `scripts/export.py` 从它导出静态 JSON，**不直接读 bible.db**。
- **bible-reader** — 纯划线阅读器，定位「干净、无注解」。本项目的**颜色概念体系沿用它的 5 色语义**，但功能上不复用其代码。
- **晨读 app（特会信息合集）** — UI 与标注交互机制的参考样板。

## 技术栈

纯静态 PWA（无构建步骤，参照晨读 app / bible-reader 模式）：
`index.html` + `style.css` + `app.js` + `manifest.json` + `sw.js`。

## 文件结构

| 文件 | 职责 |
|------|------|
| `index.html` / `style.css` / `app.js` | 单页应用全部逻辑 |
| `manifest.json` / `sw.js` | PWA 安装与离线缓存 |
| `scripts/export.py` | 从 `../bible` 导出静态 JSON → `data/` |
| `data/books.json` | 66 卷目录 + 每卷章数 + 缩写 |
| `data/bible-text.json` | 原文，键 `创1:1` / `创1:2上`，值含 `{N}`（注脚）/`[a]`（串珠）标记 |
| `data/bible-notes.json` | 注解，键 → 注脚文本列表（按 seq 序） |
| `data/bible-xrefs.json` | 串珠，键 → `{字母: 引用串}` |
| `data/lifereading/{缩写}.json` | 每卷生命读经：篇目 + 经文映射 + 正文 |

## 数据模型（核心）

**键格式**：`书卷缩写 + 章 + ":" + 节 + 半节后缀`，如 `创1:1`、`创1:2上`、`创1:2下`（`flag` 1=上 2=下 0=无，与 bible.db 的 content.flag 对齐）。

**标注**（localStorage）：
```json
{"id":"uuid","book":1,"chapter":24,"verse":5,"start":0,"end":10,"colorId":"c1","underline":false,"note":"..."}
```
- 颜色沿用 bible-reader 5 色语义：c1黄=重要句子 / c2绿=「耶和华我的神」等 / c3紫=「我是耶和华」 / c4蓝=神所喜愛讚賞的 / c5红=神所恨惡審判禁止的
- 标注 + 笔记 + 下划线 三种形态：高亮（背景色）、下划线、笔记（附加文字）

## 数据导出

```bash
cd scripts && python export.py
```
- 数据源路径 `../bible/data/raw/bible_root/bible.db`（只读）与 `../bible/data/raw/life_study/`（只读）
- 导出到 `data/`，改动数据源后需重跑导出

## 部署

```bash
vercel --prod --yes --archive=tgz
```
- 账号 all-the-day；沿用 lingliang-search 的 `--archive=tgz` 约定

## 修改守则

- 数据源只在 `scripts/export.py`，不得在 app.js 里硬编码圣经数据
- 标注/笔记存储结构改前先看 `app.js` 的 localStorage 键定义
- 颜色语义（c1-c5）是产品约定，改色不改义
