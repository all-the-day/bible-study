# bible-study — 读经研读笔记 PWA

## 项目定位

**读经研读/预习草稿工具**：选一章（如 创 24）→ 聚合查看原文、注解、相关生命读经 → 在材料上划线、标记、写笔记 → 笔记按章累积。

与兄弟项目的边界：
- **bible**（`../bible`）— 数据源，通过 `query_api.py` 提供经文/注解/串珠/生命读经。本项目的 `scripts/export.py` 从它导出静态 JSON，**不直接读 bible.db**。
- **bible-reader** — 纯划线阅读器，定位「干净、无注解」。本项目的**颜色概念体系沿用它的 5 色语义**，但功能上不复用其代码。
- **晨读 app（特会信息合集）** — UI 与标注交互机制的参考样板。

## 技术栈

纯静态 PWA（无构建步骤，参照晨读 app / bible-reader 模式）：
`index.html` + `style.css` + `app.js` + `sync.js` + `manifest.json` + `sw.js`。

离线 APK：Capacitor 6（`capacitor.config.json` + `package.json`），GitHub Actions 云构建（`.github/workflows/build-apk.yml`）。

## 分支

- `main` — 云同步版：标注/笔记走 duoban.xyz 同步，部署 Vercel + 打包 APK（appId `com.allday.biblestudy`）
- `offline` — 完全离线版：无 `sync.js`，标注纯 localStorage，appId `com.allday.biblestudy.offline`（可与云同步版共存）

两个分支的 `app.js`/`export.py` 保持一致（同步逻辑靠 sync.js 有无自动切换），改动通过 cherry-pick 同步。

## 文件结构

| 文件 | 职责 |
|------|------|
| `index.html` / `style.css` / `app.js` | 单页应用全部逻辑 |
| `sync.js` | 标注/笔记云同步客户端（duoban.xyz 通用 KV API），仅 main 分支 |
| `manifest.json` / `sw.js` | PWA 安装与离线缓存 |
| `capacitor.config.json` / `package.json` | 离线 APK 打包配置（`resources/icon.png` 为图标源） |
| `scripts/export.py` | 从 `../bible` 导出静态 JSON → `data/` |
| `scripts/*-test.js` | puppeteer 端到端测试（e2e / 标注 / 生命读经标注） |
| `data/books.json` | 66 卷目录 + 每卷章数 + 缩写 |
| `data/bible-text.json` | 原文，键 `创1:1` / `创1:2上`，值含 `{N}`（注脚）/`[a]`（串珠）标记 |
| `data/bible-notes.json` | 注解，键 → `{seq: 注脚文本}`（seq 为节内连续编号，可复用同一文本、跨半节连续） |
| `data/bible-xrefs.json` | 串珠，键 → `{字母: 引用串}` |
| `data/bible-outlines.json` | 纲目，键 `创1` → `{theme: [{level,text}], items: [{level,text,section,flag}]}` |
| `data/lifereading/{缩写}.json` | 每卷生命读经：篇目 + 经文映射（verses）+ 正文。合并卷（撒母耳记/列王纪/历代志）拆分为子卷文件（撒上/撒下、王上/王下、代上/代下） |

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
- 「我的笔记」的划线汇总**跟随当前章篇目对应**：只列本章经文标注 + 当前章对应生命读经篇目（自动匹配或手动 `lrMap`）上的标注；按来源分 tab（全部/经文/生命读经），点击跳回原文

**纲目**（`data/bible-outlines.json`）：每章 `theme`（level 1-2 上级纲目，跨章游走，渲染章首）+ `items`（level 1-6 分段标题，按 `section`/`flag` 锚点穿插在经文卡片之间）。

**生命读经匹配**：自动按每篇 `verses` 的章节号（`X:Y` 开头的 `X`）匹配当前章；用户可手动指定（localStorage 键 `bible-study.lrMap`，`{键(如"创24"): [篇目id]}`，覆盖自动匹配，纯本地不参与云同步）。

## 云同步

标注/笔记通过 **duoban.xyz 通用 KV API** 跨端同步（与 bible-reader 共用同一服务，服务器为主 + 本地缓存）：

| 项 | 值 |
|----|-----|
| API | `https://duoban.xyz/bible-api/api/kv/{key}`（GET/PUT/DELETE） |
| 服务器 key | `u1:bible-study:annotations`、`u1:bible-study:chapterNotes` |
| 客户端 | `sync.js`（`window.BibleStudySync`） |
| 策略 | 服务器为主：启动 `pullAll` 覆盖本地；写时 `putRemote` 防抖；失败标 pending，启动 `flushPending` 重试 |
| 同步范围 | **只同步用户数据**（annotations / chapterNotes）；布局偏好（viewMode / hideMarks / studyWidth 等）保持设备本地 |

- 同步失败静默降级为纯本地，不阻塞应用；`window.BIBLE_OFFLINE=true` 可跳过远程（测试用）
- 服务器 CORS 白名单在 `/var/www/bible-reader/server.py` 的 `ALLOWED_ORIGINS`，新增域名用 server-ops 操作并重启 `bible-kv`
- 同步状态指示：顶栏 `#syncStatus`（绿=已同步 / 橙=待同步 / 红=离线）

## 数据导出

```bash
cd scripts && python export.py
```
- 数据源路径 `../bible/data/raw/bible_root/bible.db`（只读）与 `../bible/data/raw/life_study/`（只读）
- 导出到 `data/`，改动数据源后需重跑导出
- 生命读经 `verses` 来自 `../bible` 的 `生命读经章节映射.json`（ezoe.work 目录页精确标注）；合并卷按「读经：」行拆分到子卷，verses 优先用精确标注，为空或章节号与主书卷不对应时用读经行补齐

## 部署

```bash
vercel --prod --yes --archive=tgz
```
- 生产地址：**https://bible-study-teal-seven.vercel.app**
- 账号 all-the-day；沿用 lingliang-search 的 `--archive=tgz` 约定
- **关键**：`data/` 大文件在 `.gitignore` 里被忽略，但 `.vercelignore` 覆盖了它（只排除 `.vercel/` `.git/` `scripts/`），保证部署时数据能上传。改动数据后先重跑导出再部署。

## APK 打包（GitHub Actions）

- workflow `.github/workflows/build-apk.yml`：checkout → 准备 web 资源 + 从 Vercel 下载 data（books/text/notes/xrefs/**outlines** + lifereading）→ `npm install` → `cap add android` → `cap sync` → `capacitor-assets generate`（图标）→ gradle 构建 debug APK → 上传 artifact
  - **注意**：APK 数据只来自 Vercel 部署产物，不在 git 里；改 `data/` 后务必先 `vercel` 部署再让 APK 构建拉取，否则 APK 拿不到新数据。
- 触发：push 到 main/offline 分支且改动前端文件（`app.js`/`style.css`/`index.html` 等）或 `package.json`/`capacitor.config.json`/`resources/**`；`workflow_dispatch` 手动触发
- `scripts/export.py` 改动**不触发** APK 构建（数据走「重跑导出 → Vercel 部署 → APK 下次构建拉新数据」）
- 两个分支两个 APK：main（云同步版，appId `com.allday.biblestudy`）、offline（离线版，appId `com.allday.biblestudy.offline`，无 sync.js）
- 产物为 debug 签名，可安装测试，不能上架商店；正式发布需配 release 签名

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
