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
| `scripts/patch-android.mjs` | CI 帮手：注入原生插件 + AndroidManifest 权限/FileProvider（幂等） |
| `scripts/*-test.js` | puppeteer 端到端测试（e2e / 标注 / 生命读经标注）；`download-sim-test.js` 验证 WebView fetch 下载被 CORS 拦截（根因留档），`update-logic-test.js` mock 原生插件验证 download() fallback/进度/监听清理 |
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

**移动端（≤900px）单视图模型**：同一时刻只显示一个内容——读经（经文）或研读（注解/生命读经/我的笔记），模式切换在顶栏右侧「读经|研读」pill（`#modePill`，`setMobileView` 维护 body.mobile-study）；桌面三列布局不变。移动端顶栏为 ☰ + 居中标题（`创世记 25章`，**点击弹章节选择** `openChapterPicker`：书卷横向切换 + 章网格）+ `#settingsBtn`（⚙️ 统一设置弹窗 `openSettingsModal`：同步/阅读/其他分组卡片 + Switch 开关，底部版本号）。**☰ 上下文导航**：读经视图开书卷抽屉；研读+生命读经 tab 开篇目/纲目导航 sheet（`openLrNavSheet`，点击滚动定位）；研读+注解/我的笔记 tab 为 no-op。**底部导航 `#mobileNav` 仅读经模式显示**（`mobileNavGo`/`updateMobileNav` 只翻章，边界禁用）；研读模式沉浸化：nav 隐藏、`.study-col` 延伸到底（`body.mobile-study` 规则），翻章/翻篇改走 crumb 选章 / ☰ 篇目导航。隐藏桌面专属元素（视图模式/研读全屏/笔记按钮/顶栏翻页/拖拽调宽/纲目侧栏），`jumpToVerse`/`jumpToLr` 自动切回对应视图。**同步状态指示**：顶栏圆点已移除，收进设置弹窗「同步」组的「同步状态」行（`syncStatusInfo` 文字+颜色），冷启动（新会话首次）启用同步时 toast 提示一次（`showStartupSyncToast`，sessionStorage 去重）。移动端样式全部限定在 `@media (max-width: 900px)`，桌面 CSS 不受影响。

## 云同步

标注/笔记通过 **duoban.xyz 通用 KV API** 跨端同步（与 bible-reader 共用同一服务，服务器为主 + 本地缓存）：

| 项 | 值 |
|----|-----|
| API | `https://duoban.xyz/bible-api/api/kv/{key}`（GET/PUT/DELETE） |
| 服务器 key | `u{uid}:bible-study:annotations`、`u{uid}:bible-study:chapterNotes`（uid 来自账号） |
| 客户端 | `sync.js`（`window.BibleStudySync`） |
| 策略 | 服务器为主：启动 `pullAll` 覆盖本地；写时 `putRemote` 防抖；失败标 pending，启动 `flushPending` 重试 |
| 同步范围 | **只同步用户数据**（annotations / chapterNotes）；布局偏好（viewMode / hideMarks / studyWidth 等）保持设备本地 |

**账号与授权（RFC 8628 简化版）**：
- 同步是**运行时可选功能**：localStorage `bible-study.account`（`{uid, token}`，null=未启用纯本地）；`syncActive()`（app.js）门控；⚙️ 设置弹窗「云同步」行打开启用/管理弹窗
- 启用流程 = 输入授权码 → `POST /api/account/claim` 兑换 `{uid, token}`；管理员用 `npm run account:code`（`--uid u1` 绑定已有账号 / 缺省新账号码）生成，码 10 分钟有效、一次性、每 IP claim 限流
- **KV 权限**：`u{n}:bible-study:*` 命名空间读写必须带设备令牌（`Authorization: Bearer`），`sync.js` 自动附加；跨账号隔离（u2 token 访问 u1 → 401）；bible-reader 命名空间暂未纳入（`SECURED_PROJECTS` 可扩展）
- owner 账号 `u1` 预置，既有数据命名空间不变；新账号从 u2 起

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

- **触发**：启动后 ~3s 静默 `check()`（10s 超时，失败静默）→ 发现新版给 `#settingsBtn` 加 `.update-dot` 红点角标 + 设置弹窗「检查更新」行显示状态；设置行点击开 `#updateModal`（独立 modal，非弹窗栈，下载过程不被关闭打断）
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

- workflow `.github/workflows/build-apk.yml`：单一 job → **自动递增版本**（release 版本与 package.json 相同时 patch+1，构建成功后 `[skip ci]` 提交推送回 main）→ 版本一致性守卫（package/manifest 版本对齐）→ 准备 web 资源（`www/manifest.json` 版本重写为 package.json）+ 从 Vercel 下载 data（books/text/notes/xrefs/**outlines** + lifereading）→ `npm install` → `cap add android` → `cap sync` → `capacitor-assets generate`（图标）→ `scripts/patch-android.mjs`（注入原生更新插件 + **强制改写 signingConfigs.debug 指向固定 keystore**）→ 注入固定 keystore 到 `$HOME/.android/` → gradle 构建 debug APK → 上传 artifact
  - **注意**：APK 数据只来自 Vercel 部署产物，不在 git 里；改 `data/` 后务必先 `vercel` 部署再让 APK 构建拉取，否则 APK 拿不到新数据。
  - **注意**：workflow 的 `run:` 块不要用 heredoc（`<<EOF`）——GitHub 解析会失败导致 push 静默不触发，用 `printf`/`--notes-file` 等替代
- 触发：push 到 **main** 且改动前端文件（`app.js`/`style.css`/`index.html`/`update.js` 等）或 `package.json`/`capacitor.config.json`/`resources/**`/`config/**`/`scripts/patch-android.mjs`；`workflow_dispatch` 手动触发
- `scripts/export.py` 改动**不触发** APK 构建（数据走「重跑导出 → Vercel 部署 → APK 下次构建拉新数据」）
- 产出单一 APK（appId `com.allday.biblestudy`，云同步为运行时可选功能）
- **发版流程（版本号自动升级）**：push 触发构建时若 release 版本与 package.json 相同则**自动 patch+1**（构建成功后 `[skip ci]` 提交推送，不二次触发），手动改版本号优先；跨 minor 发版仍可用 `.github/workflows/release-bump.yml`（workflow_dispatch 填 `x.y.z`）显式指定；release 标题「读经 v{version} · 云同步版」，notes 自动取最近 8 条提交
- **签名**：固定 debug keystore 提交在 `config/android/debug.keystore`（JKS，alias `androiddebugkey`，密码 `android`），`patch-android.mjs` 强制改写 `signingConfigs.debug` 指向它（绝对路径+密码），保证**每次构建签名一致**——覆盖安装/App 内更新不丢本地数据；**无上架需求，不配 release 签名**——产物仅限自装/小范围安装测试
- JS 质量门槛：`.github/workflows/check-js.yml` 在改动 JS/JSON 时 `node --check` 全量检查（几秒），语法错误先于 APK 构建拦截

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
