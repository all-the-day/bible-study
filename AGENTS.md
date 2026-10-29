# bible-study — 读经研读笔记 PWA

## ZCode 快速指南（先读本节）

后续章节保留详细数据契约、历史事故与平台约束，**不必每次通读**；修改某一敏感区域前，再读对应章节和真实代码。用户可见行为另见 `docs/FEATURES.md`。

### 常用命令

```bash
# 本地预览（仓库根目录）
python -m http.server 8765 --bind 127.0.0.1

# 快速质量门
node --check app.js
node --check sync.js
node --check update.js
node --check sw.js
node scripts/sync2-test.js

# 单个浏览器测试（按需替换测试名）
cd scripts && node ref-link-test.js

# 全量回归 / 安装 Git 钩子
bash scripts/run-all-tests.sh
bash scripts/install-hooks.sh

# 部署干跑，不拷贝、不部署
node scripts/deploy.mjs --check
```

- 这是原生 JavaScript 静态 PWA，**没有前端 build、lint、typecheck 或 `npm test`**；APK 由 GitHub Actions + Capacitor 6 云构建。
- `pre-commit` 检查全部 JS/JSON 并运行 `sync2-test.js`；`pre-push` 并发跑全部测试（4 泳道约 3–4 分钟，见「测试与 Git 钩子」节）。测试输出含 `✗`、`FAIL ` 或 `JS 错误: [` 也算失败，不能只看退出码。
- 数据导出脚本均在 `scripts/` 内运行：`export.py`（经文等）→ `export-verses.py`；`export-spiritual.py`（书报）→ `export-persons.py`；`export-morning-epub.py <epub> --period <期>`（听抄）；`build-topics.py`（专题）；`export-audio.py`（听书元数据）。详见「数据导出」与各脚本表项。

### 架构与数据边界

- 单页运行时为 `index.html` + `style.css` + `app.js` + `sync.js` + `update.js` + `sw.js`；无框架、无打包步骤。`config/android/` 是 CI 注入的原生插件源码，本地不维护 `android/`。
- `data/` 大多是生成产物且不入库。经文/生命读经来自兄弟项目 `../bible`，经 `scripts/export*.py` 导出；**不得在 `app.js` 硬编码圣经或书报正文，也不得绕过导出脚本直接改数据库**。
- 阅读器统一经 `enterModule()` 和 `READER_MODULES` 进入；首页、书报合集层、专题页是独立屏幕。新顶层导航入口必须在尾部调用 `syncRoute()`，不要另写 `location.hash`/`history`。
- 标注按源文本偏移定位，并带 `text`/`prefix`/`suffix` 自愈信息。修改渲染器时必须保持文本与 `data-base` 坐标一致；书报的 `(series,volume,book,chapter)` 索引上线后必须稳定，去重/清洗用墓碑或保留条目，**不得重排、压缩或删除索引项**。
- localStorage 删除采用墓碑，云同步采用 outbox + 增量游标 + 冲突备份。新增同步 kind 必须同步修改 `app.js` 的 `SYNC_KEYS`、`sync.js` 的 `SYNC_KINDS`/`KEY_MAP`、远端 `server.py` 白名单及内存态重载；布局与阅读偏好不入云。
- 听书只有元数据在 `data/audio/`，音频在阿里云 OSS；当前无正文、标注或笔记，新增合集只改 `scripts/export-audio.py` 的 `SOURCES`，不要复制前端模块。

### UI、PWA 与 APK 约束

- 新样式使用 `:root` 设计 token，禁止新增裸色值/裸字号；主题差异只放 `:root[data-theme=…]` 覆盖块。经典主题是零回归基线，五色标注语义不可改。
- 移动断点为 `900px`，移动规则只放对应媒体查询。顶栏右侧增加按钮时同步调整移动端 `.crumb` 的 `right`；正文缩放只作用于白名单，不缩放 UI。
- 首屏 splash 关键样式同时存在于 `index.html` 内联 CSS 与 `style.css`，修改时两处同步。SW 对核心代码网络优先、`/data/*` 使用 stale-while-revalidate，**跨域请求不代理不缓存**。
- APK 下载必须走 `ApkInstallerPlugin` 原生 HTTP，不要退回 WebView fetch（CORS 会失败）。`package.json` 与 `manifest.json` 版本必须一致；固定 debug keystore 不可随意更换，否则覆盖安装会失败。

### 测试与本地环境坑

- 浏览器测试依赖本地静态服务器和 Puppeteer；进入工作区前先 `enterWork()`，测试里设置 `window.BIBLE_SKIP_UPDATE=true`。
- 测试统一使用 `127.0.0.1`，不要用可能解析到 IPv6 的 `localhost`。8765 常被遗留服务器占用；测试前确认它服务的是当前工作区，否则会在旧代码上假通过。`home-test` 8777、`bookhub-test` 8776、`topic-test` 8772、`audio-test` 8778 等独立端口不要改回 8765。
- `audio-test.js` 的真实播放项需要访问 OSS，离线失败属于环境依赖。书报数据可用 `cd scripts && node books-data-test.js` 直接验收。
- 检查用户反馈必须先 `npm run feedback:pull`，`scripts/feedback/inbox.md` 只是可能过期的本地快照。

### 发布与文档纪律

- **未经用户明确许可，不 commit、push、deploy、升版本或触发 APK 构建**；完成修改后汇报并等待确认。
- 唯一生产部署是 Cloudflare Pages：`node scripts/deploy.mjs`；Vercel 已退役。改了 `data/` 必须先部署再 push，因为 APK 从 CF Pages 拉数据。新增顶层 `data/*.json`、专题或听书数据时，同步检查 `.github/workflows/build-apk.yml` 的数据清单。
- 用户可见功能发布时更新 `app.js` 顶部 `CHANGELOG`；版本发布链详见「APK 打包」和「部署（Cloudflare Pages）」。
- 用户可见行为变化同步 `docs/FEATURES.md`；长期架构、数据契约、测试或发布约束变化同步本文件。不要只追加历史，需删除过时描述。agent 生成的图片统一放 `generated-images/`。

---

## 项目定位

**读经研读/预习草稿工具**：启动进首页合集块（读经/生命读经/**专题（活力八）**/我的笔记/听抄/听书/倪文集/书报）→ 聚合查看原文、注解、相关生命读经 → 在材料上划线、标记、写笔记 → 笔记按章累积；标注/笔记可选云同步，APK 支持 App 内更新。

与兄弟项目的边界：
- **bible**（`../bible`）— 数据源，通过 `query_api.py` 提供经文/注解/串珠/生命读经。本项目的 `scripts/export.py` 从它导出静态 JSON，**不直接读 bible.db**；书报系列数据也来自 `../bible/data/raw/spiritual_food/`
- **bible-reader** — 纯划线阅读器，定位「干净、无注解」。本项目的**颜色概念体系沿用它的 5 色语义**，但功能上不复用其代码。
- **晨读 app（特会信息合集）** — UI 与标注交互机制的参考样板

## 技术栈

纯静态 PWA（无构建步骤，参照晨读 app / bible-reader 模式）：
`index.html` + `style.css` + `app.js` + `sync.js` + `update.js` + `manifest.json` + `sw.js`。

离线 APK：Capacitor 6（`capacitor.config.json` + `package.json`），GitHub Actions 云构建（`.github/workflows/build-apk.yml`）。

## 分支与构建

- **单一 `main` 分支是唯一事实源**，部署 Cloudflare Pages + 打包**单一 APK**（appId `com.allday.biblestudy`）
- **云同步是运行时可选功能**，不再区分安装包变体：默认纯本地，顶栏 ⚙️ 设置 →「云同步」行输入授权码兑换 `{uid,token}`（localStorage `bible-study.account`，null=未启用）后才参与云同步；`syncActive()`（app.js）运行时门控，未启用时即使 sync.js 存在也完全本地
- 授权码体系已上线（见「云同步」节）；旧 `offline` 分支与离线变体构建已废弃（归档 tag `archive/offline` 保留历史）

## 文件结构

| 文件 | 职责 |
|------|------|
| `index.html` / `style.css` / `app.js` | 单页应用全部逻辑 |
| `sync.js` | 标注/笔记云同步客户端（**条目级 v2 协议**：outbox + 增量拉取 + 冲突裁决，见「云同步」节） |
| `update.js` | App 内检查更新客户端（GitHub Releases 查版本 + 原生下载 APK + 安装；下载走 ApkInstallerPlugin 原生 HTTP，不用 WebView fetch——CORS 根因见「App 内更新」节） |
| `manifest.json` / `sw.js` | PWA 安装与离线缓存（核心代码文件网络优先保证更新即时生效；`/data/*` 数据文件为 **stale-while-revalidate**——先回缓存秒开、后台静默更新，下次访问生效；**跨域请求不代理不缓存**——防 duoban.xyz 同步数据残留 Cache Storage） |
| `capacitor.config.json` / `package.json` | APK 打包配置（`resources/icon.png` 为图标源；依赖含 `@capacitor/app` 返回键插件，见「路由」节） |
| `config/android/` | 原生更新插件源码（ApkInstallerPlugin：download 原生下载 + install 安装；MainActivity/file_paths.xml），CI 注入 android/ 工程，不入本地构建 |
| `scripts/export.py` | 从 `../bible` 导出静态 JSON → `data/` |
| `scripts/export-morning-epub.py` | 从特会信息 epub（Notion 下载，如 2026-3-MDC.epub）导出**完整听抄** → `data/morning/{期}.json`；同时更新 index.json 该期条目。**听抄唯一来源**（旧反编译晨读 APK 资源 detail_sections 被截断每篇缺 18-27%，已废弃，2026-08 起以 epub 为准） |
| `scripts/export-spiritual.py` | 书报多系列导出 → `data/books/`：系列注册表 SERIES（ni=倪柝声文集三级「辑→书→章」；slat=十二篮两级「辑→篇」；fuyintiandi=福音天地；bio=「传记与文集」= 名人传记原子集 + ezoe 传记、文集类合并；**ezoe 书报合辑其余按分类拆独立系列**——gospel 福音类/reading 读经类/periodicals 代售与期刊类/misc 其他，各为「单 volume 多 books」同 bio 形态，平级进书报合集层，2026-10-13 用户定稿**不裹「ezoe书报合辑」大系列切辑**）→ index.json 系列清单 + {id}.json 元数据 + {id}-{n}.json 按辑懒加载；`python export-spiritual.py [id...]` 可只导指定系列。**ezoe 源格式与其他系列不同**（bible 项目 2026-10-12 入库的 `../bible/data/raw/spiritual_food/ezoe书报合辑/`，7 分类 374 本 7394 章）：篇目 md 是规整二行式开头（首行 `# 书名`、次行 `## 篇名`）+ 正文 markdown 标题层级（##/###/####）+ 尾部 `**来源/URL/获取时间**` 元数据；导出用独立 `read_ezoe_md`——书名/篇名行剥掉（chunk 标题与 crumb 已承载）、markdown 记号剥掉保留文本（本项目无对应渲染通道，`detectLrHeading` 按裸编号/短行兜底层级）、多「部」书按索引 `part` 折叠成「书名·部」books 条目（单部书的 part 是「目录/前言」式源站分组名，忽略）。**`ezoe_dedup` 重复篇墓碑化去重（2026-10-14 用户定稿「整理整理」）**：源站把同一篇既收进合集又拆出单本独立书（福音讲台总集四部 vs 21 个单篇独立书，实测全文相似度 1.000）、书内也有同篇两录（生命的意义 5 篇）——`ezoe_category_books` 末尾跑 `ezoe_dedup`：整书被完全覆盖（阈值 `EZOE_DUP_RATIO`=0.98，difflib 全文相似度）或书内重复的篇**墓碑化**（正文换成「本文与《X》N 相同，为免重复不再载入」指引），**保留 books/chapters 条目与顺序不变**——旧标注按 (volume,book,chapter) 索引定位，删条目会让后续索引前移、标注错位丢失；墓碑只换正文，索引稳定、笔记不丢、点进去知道去哪读。跨书部分重叠（节选与原文，如初信喂养365题摘编《生命的意义》）与有实质差异的两个版本（《变死亡为生命》两版 ratio 0.85-0.99）不判重，属正常编排**源侧状态标记墓碑化（2026-10-15，bible P0 去重+吸收合并之后消费侧适配）**：bible 侧对重复/被吸收篇目翻 `status`（absorbed 220 / duplicate 75 / merged_elsewhere 1）并删除对应 md 文件、索引条目保位不删——`ezoe_category_books` 因此从「只取 saved」改为**保留全部条目**：非 saved 篇目由 `_ezoe_flag_tombstone` 墓碑化（absorbed 指引指向 `absorbed_by` 的吸收去向即福音天地/属灵书报/高峰真理；duplicate 跟随 `duplicate_of`，其指向的本身已被吸收时继续指向吸收去向），saved 但文件缺失也保留墓碑条目；`ezoe_dedup` 对已墓碑篇目用占位串跳过防二次覆盖。旧过滤行为实测重导丢福音类 30 本书（6 本全 absorbed 进福音天地 + 21 个单篇独立书 + 福音故事 + 福音讲台总集四部）、生命的意义 62→57 章，索引前移即标注错位。**P1 记号剥离（bible 2026-10-15，7026 文件）对消费侧零影响**——`read_ezoe_md` 本就剥 markdown 记号，导出产物逐字不变。**福音天地 2026-10-15 已成新系列**（fuyintiandi，22 本 845 章 6.4MB，absorbed 正版所在地）；**gospel 数据仍未随源码重导**——冻结产物（v1.0.50）内容完整（6 本 absorbed 书正文仍在、生命的意义 62 章），重导只剩一个待定项：生命的意义 62→110（源索引 110 条 = 57 saved + 53 duplicate，与冻结的 saved 压缩空间不同）与第十五集 +1 有一次性的小索引位移、可能错位旧标注，任何尊重源标记的重导都不可避免——**确认这两处无旧标注后再重导**，届时 6 本 absorbed 书改墓碑指向福音天地、消除与新系列的重复（属灵书报 55MB 超 CF 25MB 单文件限且属未接入分类，暂不管）**bio 合并纪律（2026-10-14 用户定稿：同类别整合）**：writings 传记、文集类的书**追加在 bio 原子集之后**——旧标注按 (volume,book,chapter) 索引定位，打乱顺序会全部错位；与 bio 重复的书按 `BIO_DEDUP_KEYWORDS` 跳过保留 bio 旧版（《今时代神圣启示的先见》ezoe 16 万字/33 章 vs bio 5 万字/16 章同书异录，旧版可能已带标注）。**edification 造就类（40MB）与 church 教会与事奉类（19MB）未接入**——单辑产物超 CF Pages 25MB 单文件限制，待拆分方案（`EZOE_CATS` 注册表 + `EZOE_FIRST` 首批集合，补入即把 id 移出该集合）。**2026-10-19 灵粮全量接入**：`LEGACY_SERIES` 注册表接入 22 个 legacy 来源系列（属灵书报 4 辑 224 本 2425 章 / 特会信息 37 本 / 结晶读经 29 本 / 新约总论 8 册 / 圣经之旅 15 册 / 真理课程 8 卷 / 生命课程 4 卷 / 圣经要道 6 卷 / 圣经疑难 / 健康话语的规范 / 真理专题 / 真理的辨正 / 肯定与否定 / 解剖毒瘤 / 召会历史 / 天路历程 / 希伯来民族简史 / 荒漠甘泉 365 日 / 造就故事 / 拾零 / 职事信息 / 成全训练信息），ezoe 剩余 edification 造就类（切 2 卷 232 本）与 church 教会与事奉类（96 本）接入。**清洗在导出层**（bible 源数据不动）：`_strip_header` 剥网页页眉（重复章标题 / `书名：` 拆行 / 训练期年份拆行 / 书名碎片）、`_reflow` **按文件**碎片率 >25% 才把硬折行合回（结构行 壹/一/（一） 保持独立）、`_strip_web_noise` 删 `阅读更多＞` 与行尾 `×`、`_strip_footer` 剥爬取页脚。**去重跳过表写死**（`skip_nums`/`skip_dirs`/`skip_files`）：特会信息跳过与结晶读经逐字重复的 14 本、属灵书报跳过与倪文集重复的 6 本 + 048/059 与 133/178 两组内部重复、拾零跳过与福音天地/属灵书报重复的篇目、召会历史跳过重复纲目；同书内按归一化正文哈希精确去重。**分卷写死编号区间**（属灵书报 001–047 / 048–097 / 098–148 / 149–217；ezoe 造就类按书序切上/下卷）——上线后索引必须冻结，分卷禁止改成按体积动态计算。**不接入**：高峰真理（与已导入「传记与文集·神圣启示的高峰」14 册同源）、诗歌（歌词格式需专用排版）、图表与地图（源站只有「点击看大图」空壳）。**特会 054「对真理绝对，并被真理构成」源站全书只有标题与页脚（无正文）、042「牧养神的群羊」的 001 标语页同样只有标题，清理后为空，导入时自动丢弃**，故特会为 37 本 290 章 |
| `scripts/export-verses.py` | 从 export.py 产物 `data/bible-text.json` 派生精选经节 → `data/verses.json`（首屏 splash 随机经节数据源，~190 节几 KB） |
| `scripts/build-topics.py` | 专题（作业单）数据装配：按 `REGISTRY` 的 `weeks[]` 从**已导出的** `data/lifereading/`（篇目标题）与 `data/books/`（书报章标题）解析定位 → `data/topics/{id}.json`（不入库；只含周次与链接定位、**不含正文**）；篇号不存在/不覆盖该章/章号越界直接报错。见「专题」节 |
| `scripts/topic-test.js` | 专题（活力八 · 作业单）专项 e2e（8772）：首页块/作业单页 8 周与五类条目/第 1 周链接（原文 + 三篇按顺序）/待填条虚化不可点/原文跳读经且 crumb 不残留/生命读经跳转/刷新保持/旧分屏深链归一/非法专题 id 回首页/移动端单列无溢出 + pill 隐藏 |
| `scripts/export-persons.py` | 从 export-spiritual.py 产物（`data/books/bio.json` + `bio-1.json`）派生**人物词典** → `data/persons.json`（`{scope,source,blockWords,persons[]}`，每人含 name/en/years/desc/aliases/loc/locLabel/excerpt ~200 字摘录）。**原型阶段**：`scope: ['slat','ni']` 让十二篮与倪文集正文人名可点（ni 于 2026-10-15 随反馈 #26 接入），其余系列/模块不启用。收录《基督教历史人物小传》使徒时代之后的人物（章 18-48）+ `BOOK_PERSONS` 注册表里有专门传记书的人物（劳伦斯）；**排除使徒时代人物**（雅各/约翰/彼得/马太/路加/腓力…）——其名与圣经书卷简称冲突（「腓力」⊂「腓立比书」、「约翰」⊂「约翰福音」）且在正文中作圣经人物高频出现（十二篮里「保罗」464 次），纳入会大面积误链。`ALIAS_EXTRA` 补语料实测写法（**路德马丁**、**卫斯理约翰**=十二篮实际姓名顺序），`BLOCK_WORDS` 为复合词保护（加尔文主义/路德会等，防短名吃进长词） |
| `scripts/export-audio.py` | 听书元数据导出 → `data/audio/index.json` + `{合集}.json`（**只含元数据，音频本体在阿里云 OSS**）。来源 `D:/document/聖經鳥瞰`（41 讲次文件夹 / 95 个 mp3 / 86 小时）。**标题取 ID3 `TIT2`**——原标签是台湾繁体（`聖經鳥瞰35 腓立比書(一)(王生台弟兄)`），经 `opencc t2s` 转简体 + 异体字补表（`臓→脏`、`徳→德`，opencc 不处理）+ 剥讲次号与讲者 → `腓立比书`；分片标题用 `(一)/(五)完/(续)/末尾中文数字` 规则归约成讲次标题（`_strip_part`）。时长用 `ffprobe`（缺失则 `durationSec: null`，前端加载后自行补）。**`SOURCES` 注册表**：新增合集 = 加一条（dir/prefix/base/speaker/rules/groups/expect）+ 跑脚本，前端零改动；`groups` 决定抽屉底部分组条（鸟瞰 = 旧约 1–23 / 新约 24–41），为空则平铺。自检：讲次数/分片数对齐 `expect` 基线、讲次号连续、同讲各分片归约标题一致，不符非零退出。`--check` 只打印讲次表不写盘（发版前人工过目标题）。依赖 `opencc-python-reimplemented`，产物不入库（`.gitignore` 含 `data/audio/`）。**OSS 契约**：bucket `szkjweb`（杭州，public-read）、前缀 `u8jw85vqqv/`（**写死引用，改名即断链**）；实测 `Access-Control-Allow-Origin: *`、`Accept-Ranges: bytes`（206 分片正常）、默认域名的 `Content-Disposition: attachment` **不影响 `<audio>` 播放**。上传工具在源侧 `D:/document/聖經鳥瞰/tools/oss-upload/`（不属本仓库） |
| `start.bat` / `icons/` | 本地预览服务器（python http.server 8765）/ PWA 图标（icon-192/512，`resources/icon.png` 为 APK 图标源） |
| `docs/FEATURES.md` | 功能全景文档（基于代码梳理的用户可见行为，2026-10-10 新增；与 AGENTS.md 分工：本表管工程约定，它管功能全景；同步约束见「文档同步协议」节） |
| **PageSpy 远程调试**（`PAGE_SPY_API = pagespy.duoban.xyz`，SDK 由该服务自托管，无本地文件）。**调试模式默认关闭**：设置弹窗底部版本号 3 秒内连点 5 次切换（`toggleDebugMode`，LS_VCONSOLE 键持久化、重启自动恢复），开启后数据远传 PC 面板（Network/Console/Storage 可复制）。PageSpy 服务端：aliyun-rike `pm2:pagespy`（127.0.0.1:6752，Caddy 反代 pagespy.duoban.xyz，面板 basic_auth、/api/ 与 /page-spy/ 放行供 SDK 连接），凭据存 server-ops。Storage 面板含同步令牌等敏感信息，用完关闭 |
| `scripts/patch-android.mjs` | CI 帮手：注入原生插件 + AndroidManifest 权限/FileProvider（幂等） |
| `scripts/deploy.mjs` | 部署帮手：按白名单同步 staging（md5 比对，只拷差异）+ 检测 staging 残留 + 调 wrangler 部署 CF Pages；`--check` 干跑。见「部署（Cloudflare Pages）」节 |
| `scripts/*-test.js` | puppeteer 端到端测试（e2e / 标注 / 复制出处 / 生命读经标注 / 生命读经模块内标注）；`copy-citation-test.js` 复制出处专项（`selectionCitation` 跨模块出处文案：读经/生命读经/书报/听抄 各自正确 + 半节后缀；「复制」payload = 正文 + 换行 + `—— 出处`；「引用到笔记」括号式同源）；`download-sim-test.js` 验证 WebView fetch 下载被 CORS 拦截（根因留档），`update-logic-test.js` mock 原生插件与 fetch 验证 download() fallback/进度/监听清理/版本化文件名传递/APK 清理与 manifest 失败重试，`lr-heading-test.js` 纲目标题提取，`home-test.js` / `home-test-mobile.js` 首页+合集链路冒烟（含 splash 经节断言；`home-test.js` 末尾含首页「最近阅读」：5 条上限/在合集块下方/点击跳原文并置顶/「全部 ›」首页历史弹窗（就地浏览全量 50 条、不跳工作区，点条目才跳原文）/空历史整块隐藏），`lr-reader-test.js` 生命读经阅读器专项，`lr-module-annotation-test.js` 生命读经模块内划线回归（rerenderAnn 主区重渲染 + 跨卷 book 字段），`reread-test.js` 重读专项（划线汇总头部「重读」按钮：无笔记划线删除+墓碑、带笔记原样保留、跨单元隔离（关联生命读经/邻章不动）、无标注章无按钮、生命读经右栏冒烟、移动端 390px 研读视图——Chrome 切 isMobile 设备模拟会重载页面，先等重载再重新进工作区；另：节号选择按数字匹配，创1:2 等拆半节 vnum 带「上/下」后缀），`book-reader-test.js` 书报阅读器专项（倪文集：直进/抽屉切章切书切辑/划线/笔记模块/在途去重），`slat-reader-test.js` 十二篮专项（系列清单/直进/抽屉扁平双栏：左栏全辑且无序号无篇数副标、无底部辑切换条、右栏篇标题经 `dwChapterLabel` 剥「第N篇/一/壹/（一）」序号、左栏点辑不反弹回当前阅读辑/划线标注/笔记树分组），`ezoe-reader-test.js` ezoe书报合辑专项（2026-10-13/14：分类=独立系列平级进书报合集层，用户定稿不裹大系列切辑；gospel/reading/periodicals/misc 四类各 1 辑，writings 已并入 bio。系列清单/直进福音类/正文 markdown 剥离（无 #/**/元数据残留、书名篇名二行式不重复渲染）与标题行识别（`一 神的意义`式裸编号成 bk-head）/抽屉双栏（单辑系列无底部辑切换条、左=书列表含「书·部」折叠条目 16 个、点左栏刷右栏）/多部书条目直进/划线 series=gospel/LS_BOOK_LAST 恢复/笔记树书名真名无兜底+列表完整 label/bio 合并验证（名=传记与文集、book 0 仍是基督教历史人物小传保旧标注索引、含神圣启示的高峰、重复书只 1 份）；三连跑稳定——enter 与抽屉刷新并发拉元数据的竞态已由 ensureBookMeta 守卫修复），`bookhub-test.js` 书报二级合集层专项（首页 6 块/倪文集直达/书报合集层 6 块 bio·gospel·misc·periodicals·reading·slat 无 ni/十二篮直进/合集层搜索跨系列同列（misc+十二篮）+ 搜索点击直进 misc）；`search-test.js` 统一检索专项（2026-10-20：书报跨系列分组结果/书号 `1001` 精确命中且带 `#1001` 并直进该书/经文全文「起初神创造」命中创1:1 并跳转定位/注解全文命中带「注N」/真实总数与「查看全部」弹窗/命中高亮 `<mark>`/空态/抽屉书报跨系列 + 「共 N 条，显示前 50 条」计数/抽屉「创24」直达第 24 章；8765 同其他 e2e），`morning-reader-test.js` 听抄阅读器专项（直进/切期/切篇/层级标题渲染/笔记/划线/全局笔记跳转/恢复）；`typography-test.js` 排版面板专项（默认 1.0x 与改造前逐项一致/字号与行距滑杆即时生效/正文内部层级与研读列跟随而 UI 不跟随/跨模块基准（经文18·生命读经17·书报15）/上下限与脏数据钳制/刷新持久化/2.0x 无横向溢出/标注数据不受排版影响/移动端底部 sheet）；`sync2-test.js` sync.js 条目级同步（v2 协议）node 单测，mock 与 server.py 同契约的服务端（无浏览器；播种 import-if-absent/outbox 编辑推送/幂等重放/conflict 裁决双向（服务端胜覆盖本地+败者备份、本地胜换 base 重推）/push 不推进拉取游标+flush 后补拉/pull 跳过在途条目/删除墓碑/笔记 dict 同构/forcePush+forcePull/lastError-lastSuccess 状态记录）；`notes-module-test.js` 笔记管理模块专项（直进/分类树/来源tab/颜色过滤/搜索/排序/选中进面板/编辑笔记/改色/删除单条/大段笔记编辑删除/批量删除/偏好恢复）；`drawer-test.js` 统一导航抽屉专项（桌面停靠列常驻/☰ 收起展开/四模块双栏渲染/高亮同步/旧约新约与辑切换/右栏跳转/模块级搜索/阅读历史记录去重跳转清空空态/notes 停靠隐藏/移动端浮层视口）；`ref-link-test.js` 经文引用识别专项（相对引用/上下文/误判防护/章越界过滤/别名切分回退/章…节至…节范围/列举式范围（、和与、节只在末尾、不跨章吞并）/相对章节式与跨章范围/书卷归属回退/简称补漏/串珠前缀格式/听抄正文跨行上下文（carry 段首相对引用，反馈 #20）/篇63 DOM 渲染/正文书卷弱上下文（反馈 #27/#28：裸书名与裸章提及、不跨句、句末+括注不判跨句、章号新鲜度、简称人名不建上下文、全书引用覆盖）；**反馈 #29/#30/#31**：相对节范围列举、分号/引文标点不判跨句、诗篇「N篇」、零含引用检测与解析、跨章范围续节就近取章）；`run-all-tests.sh` 全量运行器（**并发 4 泳道**，见「测试与 Git 钩子」节；确保 8765 服务器（**统一 `--bind 127.0.0.1`、探活同址**——2026-10-14 实测：4 个老测试用 `localhost`，Chrome 偶发解析到 IPv6 `::1`，IPv4-only server 拒连致 `ERR_CONNECTION_REFUSED` 误报失败，已全部统一 127.0.0.1）→ 4 泳道并发跑全部测试 → 按输出解析判定，失败=非零退出或含 ✗/FAIL/JS 错误；`SKIP="home-test …"` 可跳过、`FASTFAIL=0` 关失败早停）；`person-link-test.js` 人物链接专项（scope 门控 slat+ni（ni 于 2026-10-15 反馈 #26 接入，断言「告诉祂」司布真段注入）/匹配规则：最长优先·复合词保护·与经文引用不重叠/正文注入人名链接且偏移坐标与源文本逐行一致/点击弹人物小传（简介+生卒+摘录+出处）/跳完整小传；`SHOT=1` 存图到 generated-images/）；`router-test.js` 路由专项（hash URL 同步/翻章 replace 不堆历史/前后退跨模块就位/刷新保持位置/五模块 + hub 深链/非法 hash 净化/章越界钳制/返回键层级（伪 Capacitor 注入）/移动端返回键关抽屉/合集层 push-back；8769）；`swipe-test.js` 滑动翻页专项（四模块横扫切章/篇 + URL 同步 + 淡入反馈类/卷首边界不动/慢扫与纵偏不触发/有选区走标注流程不切章/弹窗守卫/notes 无副作用；8770）；`theme-test.js` 阅读主题专项（classic 关键计算值零回归/设置→阅读主题选择器 4 项/paper 纸底+去卡片化+图标双渲染/minimal 纲目转灰+纯色差分层/刷新持久化/非法值回退 classic）；`help-test.js` 使用帮助专项（设置行位置/四章节+五色 mark/最近更新来自 CHANGELOG/更新弹窗「本次更新」命中与原始信息回退双分支/过老版本全量/「查看全部更新」跳转）；`books-data-test.js` 书报数据产物验收（node 直跑无浏览器：系列顺序/卷文件齐全/单文件<25MB/去重跳过项/网页与页眉残留/碎片行占比/`--idempotent` 重复导出逐字节一致）；`topic-test.js` 专题专项（8772，见「专题」节）；`audio-test.js` 听书专项（**8778**，见「听书」节：单列播放器/抽屉双栏合集·讲次/分组切换/切讲切段/真实播放推进/深链与刷新保持/首页检索与抽屉搜索/移动端）；**端口纪律（2026-10-21）**：`home-test` 改用 8777、`bookhub-test` 改用 8776、`topic-test` 8772——**别再用 8765**：本机常有遗留服务器占着它，脚本 spawn 静默失败后会跑在旧代码上（`bookhub-test` 断言「首页 6 块」曾因此假失败） |
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
| `data/books/` | 书报：index.json（系列清单，顺序 = `SERIES_ORDER`）+ `{系列}.json`（元数据 volumes）+ `{系列}-{辑}.json`（按辑懒加载）+ **numbers.json（书号表，9.5KB）**。2026-10-19 全量：32 系列 / 972 本 / 15367 章 / 约 223MB；最大单文件 zj-2.json 21.8MB（CF 限 25MB）。**书号表**由 `export-spiritual.py --numbers` 单独产出（`{系列: [[辑,书,编号],…]}`，辑 1 基/书 0 基，与标注 loc 同基数）：13 系列 848 本带号——ezoe 书报号（gospel/reading/periodicals/misc/zj/jh/bio 的 ezoe 部分）、灵粮目录序号（sg/th/jd/xyzl）、倪文集册内 book_number、福音天地吸收篇的 `书报号`；**不重导内容**（gospel 等冻结系列重导会让索引位移），故与 `{系列}.json` 分离；前端 `bookNumOf` 优先读元数据 `b.num`（将来重导自带）、回落本表。APK 数据清单须单独列该文件（build-apk.yml 已加） |
| `data/verses.json` | 精选经节 `[{ref,text}]`（~190 节，`export-verses.py` 派生，首屏 splash 随机经节源） |
| `data/audio/` | 听书：`index.json`（合集清单）+ `{合集}.json`（元数据 ~15KB：`baseUrl` / `groups` / `lectures[{n,title,group,durationSec,tracks[{title,path,bytes,durationSec,i}]}]`）。**音频本体不在仓库**（OSS 直链），SW 的「跨域不缓存」规则已自动跳过，2.4GB 不会进 Cache Storage。`scripts/export-audio.py` 派生，不入库。**APK 数据清单须单独列 `audio/index.json` + 各合集文件**（build-apk.yml 已按 index 自动展开） |
| `data/topics/` | 专题（`vitality8.json` 等，`scripts/build-topics.py` 派生，不入库；结构见「专题」节）。**APK 数据清单须单独列 `topics/{id}.json`**（build-apk.yml 已加 vitality8；新增专题时同步加） |
| `data/persons.json` | 人物词典（~28KB，`export-persons.py` 派生，**原型**）：`scope`（启用系列白名单，现=`['slat','ni']`）+ `blockWords` + `persons[]`（含 aliases/loc 小传定位/excerpt 摘录），正文人名点开人物小传用 |

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
- 「我的笔记」的划线汇总**跟随当前章篇目对应**：只列本章经文标注 + 当前章对应生命读经篇目（自动匹配或手动 `lrMap`）上的标注；按来源分 tab（全部/经文/生命读经），点击跳回原文。**划线汇总（`renderHighlights`，研读列与阅读器右栏共用）展示全部标记不过滤**，但区分笔记：头部计数 `划线汇总 N · 笔记 M`（带 note 计数，切 tab 同步刷新），组内**带笔记条目置顶**；条目 = 定位（同组定位全同/右栏单篇上下文时隐藏）+ 原文 + 📝 笔记，空原文兜底「（原文缺失）」（反馈 #13）；写/改笔记弹窗 `#noteModal` 在输入框上方显示 `#noteQuote` 原文引用预览（新建=选区快照，编辑=解析出的原文）。**「重读」（2026-10-15）**：汇总标题右侧小按钮（`renderHighlights` 的 `opts.reread`，四个阅读器都传；头部改「span 标题 + 按钮」结构，`setHeader` 只写 span、切来源 tab 不丢按钮）——当前阅读单元存在**无笔记划线**时显示（没有标注、或只剩带笔记的都不显示），点击经 `confirmDialog` 明示条数（「将移除<范围>的 N 处划线，保留 M 处带笔记的标注」）后 `rereadUnit()` 移除本单元全部无笔记划线，**带笔记的原样保留**（颜色/下划线/笔记不动）、大段笔记不受影响；范围=单元自己的划线，过滤条件与各模块主区/右栏一致（`rereadUnitScope()`：读经=本章经文——关联生命读经篇目属于别的「篇」不动；生命读经=本篇；书报=当前章；听抄=当前篇）；删除走 `saveDeleted`（本地墓碑 + 云同步 del op，与单条/批量删除同通道）、无撤销。**全局聚合已移出研读列**：研读列只保留本章聚合，全量标注/大段笔记的浏览管理在首页「我的笔记」块直进的**笔记管理模块**（见「首页 + 合集块」节）
- **`annotationText` 跨书卷注意**：经文取文本必须用标注自己的 `a.book` 查 books.json 取缩写（全局模式下当前书卷≠标注书卷），生命读经跨书卷查 `state.lrVolumes[a.book]` 缓存兜底，无则回退 `a.text` 快照
- **选区监听与工具栏按钮的互斥**：`handleSelection` 绑 document `mouseup`/`touchend` + `selectionchange` 防抖（180ms），但工具栏按钮经 `bindPress` 绑 `mousedown`/`touchstart`——按钮按下即隐藏工具栏后，同一次点按的 `mouseup`/`touchend` 仍会冒泡触发 `handleSelection`，此时选区未清会把工具栏**再次拉起**；故 `handleSelection(e)` 开头对 `e.target.closest('#floatTool')` 的事件直接返回（复制后「关了又弹回」的根因）
- **划词工具栏的复制/引用出处（反馈 #21）**：选中正文后浮动工具栏「复制」= 正文 + 换行 + `—— <出处>`（尾注式，业界主流：微信读书/Kindle/Apple Books 复制均附出处尾注）+ toast「已复制，含出处」+ 自动隐藏工具栏，「引用到笔记」= `「<文本>」（<出处>）`（笔记落在本模块内、上下文自明，出处省略模块标签，`selectionCitation(r, false)`）；两处共用 `selectionCitation(r)`，按模块生成完整出处 `<作品> <定位> · <模块>`——读经 `创世记 1:26`、生命读经 `创世记·生命读经 第六十篇 <篇名>`、书报 `倪柝声文集·第一辑·灵修指微 第一篇 <章名>`、听抄 `六月半年度训练 第2篇 <篇名>`（`CITATION_MODULE` 映射模块名）。**原 `selectedCitation` 把非 verse 一律标成「生命读经 第N篇」（书报/听抄会标错，虽因「引用到笔记」仅读经可用而未被触发），已随本改动收敛为跨模块正确的单一实现**

**纲目**（`data/bible-outlines.json`）：每章 `theme`（level 1-2 上级纲目，跨章游走，渲染章首）+ `items`（level 1-6 分段标题，按 `section`/`flag` 锚点穿插在经文卡片之间）。

**生命读经匹配**：自动按每篇 `verses` 的章节号（`X:Y` 开头的 `X`）匹配当前章；用户可手动指定（localStorage 键 `bible-study.lrMap`，`{键(如"创24"): [篇目id]}`，覆盖自动匹配，纯本地不参与云同步）。

**移动端（≤900px）单视图模型**：同一时刻只显示一个内容——读经（经文）或研读（注解/生命读经/我的笔记），模式切换在顶栏右侧「读经|研读」pill（`#modePill`，`setMobileView` 维护 body.mobile-study）；桌面三列布局不变。**滑动翻页（2026-10-16，小说阅读器式）**：正文区（#textCol）快速横扫切章/篇——向左=下一篇、向右=上一篇，四模块各自边界内切换（读经切章、生命读经/听抄切本卷/本期内篇、书报切本书内章，到边界不动），手势判定=快扫（<600ms）且明显横向（|dx|≥60、|dy|<40），**有选区时走标注流程不切章**，弹窗/抽屉/研读视图（mobile-study）/路由就位进行中（_routeApplying/_routeBusy）不响应，反馈=新内容轻淡入（`#textCol.swipe-in-l/r`，style.css 末尾）；`bindSwipeNav`/`swipeTargetChapter`/`swipeFeedback`（app.js「滑动翻页」节），网页与 APK 同一份代码自动生效。**首页是第三种态（`body.home`）**：启动先进首页（见「首页 + 合集块」节），首页时 pill/☰/底部导航/工作区按钮全部隐藏。**生命读经阅读器（body-mod-lifereading 三列）移动端暂未适配**：保证不崩溃、正文可读（textCol 显示 #lrMain），☰/crumb 走统一导航抽屉可用、左右栏抽屉延后（书报/听抄模块移动端同此策略：主区显示于 textCol，左右栏抽屉延后；**笔记管理（2026-09-11 方案 B）**：分类树移入统一导航抽屉——`notesTreeTarget()` 移动端渲染进 `#dwBody`（桌面仍 `#notesNav`），隐藏 `#modePill` 与 `.nav-col`；点条目=全屏 push 编辑面板（`setMobileView('study')`，`#studyCol` fixed 平移进出屏），顶栏下方 `#notesBackBar`「‹ 返回列表」`closeNotesEditor` 切回列表并恢复 scrollTop；工具条两行=「搜索+筛选 ▾」（`openNotesFilter` 弹窗管颜色/排序）/「来源 chips 横滑+多选」；选中分组显示可清除 chip（`buildNotesGroupChip`）；批量条底部固定；多选态点条目=勾选/取消（大段笔记无复选框，点它不进编辑面板），退出多选若残留编辑视图自动切回列表）。移动端顶栏为 ⌂ + ☰ + 居中标题（`创世记 25章`，点击开统一导航抽屉）+ Aa 排版按钮（`#typographyBtn`，见「阅读排版」节）+ `#settingsBtn`（⚙️ 统一设置弹窗 `openSettingsModal`：同步/阅读/其他分组卡片 + Switch 开关，底部版本号）。**☰ 上下文导航**：桌面=`toggleDrawerDock()` 停靠列收起/展开（全模块统一，notes no-op）；移动端阅读器模块（读经/生命读经/书报/听抄/笔记管理）☰ 开**统一导航抽屉浮层**（见下节）；读经研读+生命读经 tab 开篇目/纲目导航 sheet（`openLrNavSheet`，点击滚动定位）；读经研读+注解 tab 为 no-op。研读模式沉浸化：`.study-col` 延伸到屏幕底（`body.mobile-study` 规则），翻章/翻篇走滑动翻页 / crumb / ☰ 统一抽屉（**移动端底部导航 `#mobileNav` 已于 2026-10-16 移除**——滑动翻页取代其唯一职责，`mobileNavGo`/`updateMobileNav` 一并删除，正文底部预留 padding 已回收）。隐藏桌面专属元素（视图模式/研读全屏/笔记按钮/顶栏翻页/拖拽调宽/纲目侧栏），`jumpToVerse`/`jumpToLr` 自动切回对应视图。**同步状态指示**：顶栏圆点已移除，收进设置弹窗「同步」组的「同步状态」行（`syncStatusInfo` 文字+颜色），冷启动（新会话首次）启用同步时 toast 提示一次（`showStartupSyncToast`，sessionStorage 去重）。移动端样式全部限定在 `@media (max-width: 900px)`，桌面 CSS 不受影响。

**统一导航抽屉（2026-09，WeBible 模式，替代原四个层级选择弹窗与三模块左栏）**：`#drawerOverlay` + `#navDrawer`（独立 DOM，不复用 #popup——popup 栈 innerHTML 恢复会丢事件监听，抽屉单向渲染 + `#dwSearchInput`/`#dwSeg`/`#dwFoot`/`#dwBody`/`#dwSearchResults` 事件委托各绑一次）。**双形态**：桌面（>900px）= **停靠列**（`body.drawer-docked`，340px 常驻左侧、`.layout{margin-left:340px}` 占位，`view-full`/`study-full` 时 margin 归零；可经 ☰/crumb 收起展开，`state.drawerDocked` 持久化 `bible-study.drawerDocked`，notes 模块/首页自动隐藏）；移动端 = 浮层（遮罩+平移，跳转/遮罩后关闭，`lockScroll`）。**唤出**：crumb 点击（各阅读器模块 onCrumbClick，桌面=收起时展开/已展开 no-op（notes 桌面 no-op），移动端=浮层）与 ☰（桌面=`toggleDrawerDock` 全模块统一，移动端=浮层）；**不承载抽屉的态隐藏 ☰**（首页、书报二级合集层、桌面笔记管理——CSS 双保险 + 各入口 JS 守卫 `state.screen==='home'|'bookhub'` / `activeModule==='notes'`：notes 桌面分类树已常驻左栏，☰ 是死键；移动端 notes 仍显示 ☰，分类树渲染进抽屉靠它唤出）。**结构**：顶部常驻搜索条（模块级搜索，见下）+ Segment 分段（浏览|历史，bible 浏览段标签「书卷」）+ 双栏主从（左栏=层级一列表【无序号，2026-10-12 用户定稿：目录空间宝贵，分辑书列表/66 卷书卷列表均只留名称】，右栏=层级二列表，`.dw-item.cur` 浅主色底+主色字+左侧主色条高亮 + scrollIntoView 居中；列表项单行截断（`.t` ellipsis + title 悬停全名，生命读经篇目剥「00N」编号前缀））+ 底部固定切换。**各模块映射**：bible=书卷(index+name)→章（中文数字 `cnNum`），底部 旧约/新约；lifereading=66 卷→篇目（`ensureLrVolume` 懒加载）；books=书列表→章名列表，底部 辑切换；morning=期列表→篇列表（`ensureMorningData` 懒加载）；notes（仅移动端）=分类树（`renderDrawerBrowse('notes')` 直调 `renderNotesTree`，搜索条与 Segment 隐藏、无历史段）。**点左栏=刷新右栏（桌面移动一致）；点右栏=关抽屉(仅浮层)→各模块统一入口**（bible=`selectBook`、lr=`openLrArticle`、books=跨辑先 `selectBookVolume` 再 `selectBookChapter`、morning=`openMorningArticle`）。**模块级搜索**（自三模块左栏迁入，2026-10-20 接统一检索内核）：搜索条常驻抽屉顶部，输入即搜（seq 竞态守卫），结果层 `#dwSearchResults` 覆盖抽屉（`.on` 下滑）；lr=`ensureLrTitleIndex` 全 66 卷篇目检索、**books=`searchBookTitles` 跨全部 32 系列**（不再只搜当前系列，书名/章标题/系列/辑/书号同表匹配，点击按 `data-s` 走 `openBookChapter(…, series)`）、morning=逐期懒加载篇标题、**bible=书卷名匹配 + `parseBookChapterQuery` 支持「创24」直达该章**；结果带卷名/辑名前缀（`.nav-result-loc`），**计数用 `slice` 前的真实总数**（超 50 条时注明「显示前 50 条」，旧实现用裁剪后长度、永远显示 50），点击走各模块统一入口并清空搜索词。**阅读历史**（Segment 历史段）：localStorage `bible-study.history`（`[{module, loc, title, t}]`，纯本地不入云同步），记录点=各 `select*` 跳转函数尾部 `pushHistory`（同 module+同 loc 去重置顶，上限 50）；列表带模块名+相对时间，空态「暂无阅读历史」，清空走 `confirmDialog`；点击历史项按 module 分发跳转。**渲染时序注意**：`renderDrawer(sync=true)` 开头把 `dwState.left/vol` 同步到当前模块位置（模块切换时重置回浏览段）；抽屉内左栏浏览直接调 `renderDrawerBrowse` 绕过同步、底部辑/期切换调 `renderDrawer(false)`；懒加载写入前重新查询 `#dwBody` 列引用（防 await 期间被重绘成游离节点）。**已删除**：`openChapterPicker`/`openLrArticleList`/`openBookPicker`/`openMorningArticleList` 四个弹窗函数、`openBookResult`（抽屉改走 `openBookChapter(…, series)`）、三模块左栏（`renderLrArticleList`/`renderBookNavBooks`/`renderMorningChapterList` 及 `.lr-nav-*`/`.bk-nav-*`/`.morning-nav-*` 样式）、读经左栏（`renderBookList`/`renderChapterList`/`highlightNav`/`bookSearch`）、`toggleNavCollapsed`/`navCollapsed`/`LS_NAV_COLLAPSED`（被 drawerDocked 取代）；popup 机制保留（注脚/串珠/设置/confirmDialog；`openPopup(title, html, {replace:true})` 原位替换不把当前层压栈——供「加载占位→填充」场景，默认行为不变），`.overlay`/`.popup` z-index 84/85、`.floattool` 82（高于停靠抽屉 81——划线工具伸进停靠列区域时防点击穿透误触导航）。**布局**：四阅读器模块桌面均两列（正文+研读，`.body-mod-* .layout` 规则组含 view-stacked/view-full/study-full 适配）；`#navCol` 仅剩笔记管理分类树（`body-mod-notes` 显示）。**取舍**：`bookSearch` 书卷过滤不可达（66 卷竖列+旧约/新约+抽屉搜索已覆盖）；停靠列双栏每列约 150px，长篇目标题 ellipsis 截断。

## 首页 + 合集块（2026-08 阶段 1）

**启动先进首页**（PC/移动端通用，浏览器启动页风格）：顶部通用检索 + 正方形合集块网格（首页顶栏只留右上角 反馈+⚙️，⌂ 隐藏）。**合集块 8 个**（2026-10-12 书报重组；2026-10-21 增「活力八」；2026-10-26 增「听书」）：读经/生命读经/我的笔记/听抄/**听书**（`enterModule('audio')`，音频本体在阿里云 OSS，见「听书」节）/**倪文集**（`enterModule('books',{series:'ni'})` 直达）/**书报**（`openBookHub()` 开二级合集层 `#bookHubView`，`body.bookhub` 正交控制同 home；合集块数据驱动自 books 系列清单**排除 ni**，点块 `openBookChapter(1,0,0,series)` 直进——注意 enterModule 同模块幂等跳过 enter，必须走 openBookChapter 显式切换；搜索条跨合集检索篇目，依赖 seriesMeta 预取缓存）。首页是全屏层 `#homeView`，与工作区 `.layout` **正交**（CSS 切换：`body.home .layout{display:none}` + `body:not(.home) #homeView{display:none}`，无 JS 频繁切 hidden）；顶栏新增常驻 `#homeBtn`（⌂）回首页。**搜索分层：全局搜索只在首页**（中央搜索框）；阅读器内各模块左栏为**模块级搜索**（空查询=当前列表，非空=全模块范围检索：生命读经全 66 卷 / 书报全辑 / 听抄全期，结果带卷名/期名前缀，点击跨范围跳转；读经模块只有书卷过滤 `bookSearch`）。**首屏 splash**（`#splash`，纯静态 HTML 先行显示，含 app 名 + 随机经节 `data/verses.json`（拉取失败用 HTML 兜底节）+ spinner + 进度条；**关键样式内联在 index.html `<head>`**——style.css 经跨境链路可能慢数秒，内联保证 HTML 一到 splash 即带动画渲染，字面色值与 style.css 一致、加载后同规则覆盖，改 splash 样式两处都要同步）：init 并行拉 books.json 与 verses.json（小文件，仍走 `fetchJSON` 25s 超时），首页在 splash 之下先渲染好；随后**启动数据首屏可见加载**（2026-10-10 iOS 反馈改造，替代原后台静默预取）：经文四件套 + 上次位置卷生命读经经 `fetchJSONBatchProgress`（流式 `body.getReader()` 逐块计字节，按 Content-Length 聚合成 splash 进度条总进度；**不设总超时——跨境慢网 2.94MB(br) 可能远超旧 25s，改 30s 空闲看门狗**，有字节进来就续命、真断流才 abort；生命读经缺失卷按 `optional` 容忍返回 null）并发下载，**全部就绪才 `splashHide()` 放行首页**——首次访问慢网时用户看得到真实进度，二次访问 SW 缓存秒开不受影响；失败 splash 显示错误+重试（`splashRestoreLoading` 恢复被隐藏的 spinner/进度条）。**数据加载指示**（`showLoadingHint`/`showLoadingError`）：读经经文首载（`ensureBibleData`→#verseContainer）、生命读经卷（`ensureLrVolume`→#lrMain）、书报辑（`ensureBookVolume`→#bookMain）、听抄期（`ensureMorningData`→#morningMain）未缓存时显示 spinner+提示，失败显示「加载失败+重试」。**大数据加载超时三档**（2026-10-10 HAR 实录 ni-1.json 7MB 慢网 46s 被旧 25s 总超时误杀成「加载失败」）：MB 级数据一律走 `fetchJSONStall`（30s 空闲看门狗，流式 `streamBodyJSON` 逐块续命，真断流才 abort）——`ensureBibleData` 四件套 / `ensureLrVolume` / `ensureBookVolume` / `ensureMorningData` / `selectChapter` 兜底生命读经；`fetchJSON`（25s 总超时）只用于小文件（books/verses/索引/元数据）；启动批量走 `fetchJSONBatchProgress`。**三个模块懒加载函数带在途去重**（`state.lrVolPending`/`state.bookVolPending`/`state.morningPending` 存在途 Promise，finally 清除）：下载中重复触发（切章/重进模块）复用同一 Promise 不二次下载——慢网下 7MB 辑文件曾因无去重白烧一份带宽。回归断言在 `book-reader-test.js` 第 8 步（并发双调只发一次请求）。

- **状态**：`state.screen`（'home'|'work'，唯一视图正交开关）、`state.activeModule`（当前阅读器模块：'bible'|'lifereading'|'books'|'morning'|'notes'）、`state.lrVolumes`（生命读经卷懒加载缓存，`selectChapter` 懒加载与阅读器共用）、`state.lrBookIndex/lrArticleId/lrSideTab`（生命读经阅读器位置与右栏 tab）
- **切换函数**（顶层声明，e2e 测试 `page.evaluate(() => enterWork())` 直接调用）：`showHome()`（加 body.home + 移除 mobile-study + closePopupAll + 刷新块计数）、`enterWork()`（移除 body.home，幂等）
- **合集注册表 `COLLECTIONS`（app.js 顶部，数据驱动）**：`{id, title, icon, entry}` 数组（**无 sub 副标题**）→ `renderHome()` 遍历生成 `.home-block` tile，点击委托分发。bookhub 项开书报合集层；ni 项直达倪文集
- **首页「最近阅读」（反馈 #16，2026-09-19）**：合集块**下方**的极简行列表（无卡片底，仅细分隔线），取 `LS_HISTORY` 最近 5 条（`HOME_HIST_MAX`），条目 = 标题（单行截断）+ `模块 · 相对时间`（`HISTORY_LABELS` 与抽屉历史段共用）；点击复用 `jumpHistory` 跳原文，标题行右侧「全部 ›」走 `openHomeHistoryAll()`（**首页历史弹窗**，2026-10-12 用户定稿：点「全部」的意图是浏览历史本身，就地弹窗展示全量 50 条、不跳工作区不开抽屉；点条目关弹窗后 `jumpHistory` 跳原文；`.hist-pop-*` 样式，复用 popup 栈）；**无历史时整块不渲染**（`renderHomeHistory()` 置空 + `.home-hist:empty` 隐藏，不留空态，首页本身不变）。`renderHome()` 末尾调用，故 `showHome()` 刷新块时历史同步刷新
- **阅读器外壳 + 模块注册表 `READER_MODULES`（app.js，核心抽象）**：每个合集模块 = 一套三列阅读器配置 `{id, title, enter(opts), renderNav(), renderMain(), renderSide(), renderCrumb(), onMenu(), onCrumbClick()}`。`enterModule(id, opts)` 是唯一入口（首页块/搜索/全局笔记都走它）：旧模块 onLeave → activeModule 切换 → `applyModuleBodyClass`（body-mod-{id} 类驱动三列容器归属，CSS 见 style.css「阅读器模块容器切换」节）→ enterWork → 首次进入时 enter + 四渲染（**同模块幂等不重渲染**）。☰ 桌面 = `toggleDrawerDock()` 停靠列收起/展开（全模块统一）；crumb 点击 = 各阅读器模块统一开导航抽屉（桌面=收起时展开/已展开 no-op，移动端=浮层；notes no-op）
- **阅读进度条（#readingProgress，反馈 #10）**：顶栏内 2px 细线，随 `#textCol` 滚动实时指示当前阅读进度（`bindReadingProgress` 绑定 textCol scroll + resize，宽 = scrollTop/(scrollHeight-clientHeight)，纯 UI 不存储，`body.home` 隐藏；晨读 app 同款交互）。**DOM 在 `.topbar` 内、`position: absolute; top: 0`（不是贴视口顶边的 fixed）**：iOS 26 Safari Liquid Glass 顶部取色只采样贴近视口边缘的 `fixed`/`sticky` 元素，贴顶 fixed 的白线会把状态栏染白、经典主题下进度线自己消失；absolute 子元素不参与采样，视觉位置不变。`.topbar` 因此显式 `background-color: var(--topbar-solid)`（渐变 `background-image` 不参与采样），四主题 token = #667EEA / #5662CE / #faf7f1 / var(--page-bg)（#f6f6f8）；桌面/Android 像素不变（2026-10-19）
- **读经模块（bible）**：entry 直接进上次章节（`LS_LAST`，无则 1,1），不再弹选章；**无左栏**（2026-09 桌面两列：经文+研读，层级导航整体走停靠导航抽屉，桌面 ☰=收起/展开停靠列、crumb 与移动端 ☰=唤出；`bookSearch` 书卷过滤随左栏移除，抽屉搜索已覆盖）；主区=经文、右栏=注解|生命读经|我的笔记、actions=双页/隐藏注号/研读全屏/笔记/反馈/设置（现状）
- **生命读经模块（lifereading，方案 A 三列）**：entry 直接进上次篇目（`LS_LR_LAST`，无则第一卷第一篇）；**无左栏**（2026-09：模块级搜索迁停靠抽屉顶部搜索条，篇目列表=停靠抽屉双栏）；主区=篇目正文（`renderLrArticle(art, bookIndex)` 渲染到 `#lrMain`，标注坐标系不变）；右栏=`#lrSide`「纲目|笔记」tab（纲目在前：`extractLrHeadings` + 滚动高亮 `bindLrOutlineSpy` 句柄化监听 `#textCol`；笔记：篇级 textarea `state.lrNotes` + 本篇标注汇总）；crumb=`卷名 · 第{id}篇 {标题}` 点击开导航抽屉；actions 留 ⚙️ + 反馈（`body-mod-lifereading` CSS 隐藏其余，**反馈按钮全模块可见**）；切篇/切卷 `selectLrArticle/selectLrVolume` 持久化 LS_LR_LAST + 正文滚顶；统一入口 `openLrArticle(bookIndex, art)`（模块内切篇/模块外进模块）。**ref-link 经文引用**：正文与注解的引用包 `<span class="ref-link">`，`detectRefs(text, defaultAcronym)` 识别**相对引用**（无书卷前缀）两类：① 节级（如「创二四62，二五11」的 `二五11`=创25:11）；② **章节式**（如「在四十九章五、六节」「雅各在二十八章二十、二十一节许愿」，含跨章范围「十章二十八节至十二章二十四节」= 首章起节→章末 + 中间整章 + 末章 1→止节）。上下文来自前文全书引用或 defaultAcronym（生命读经=篇目所属卷、注解=注解所在书卷）；**书卷归属**：先按最近上下文（curAcronym）解，章越界/节不存在时回退 defaultAcronym（正文常先提别的卷再回到本卷），仍不成立才不包裹；章节式还要求左边界（前一字不能是数字/章/第）与右边界（以「节/上/下」或标点/文末收尾，防「第三章第二段」的「二」被当节号）；纯数字相对引用要求左右分隔符/句末标点防护误判（25章、25:11、1920年 不识别），并以章数上限（books.json）与节存在性（bible-text.json）双过滤书卷推断错误的引用；data-refs 用规范键（书卷+章:节）或「书卷+原文引用」。**正文书卷弱上下文（2026-10-15，反馈 #27/#28）**：不带节号的「全名书名」（以 书/记/篇/音/传/录 收尾，如「哥林多后书」）与「书卷+第?X章」（「罗马八章」）mention 不成引用、不包链接，但作**本行内弱上下文**为其后相对引用提供书卷/章号（修复「尤其是哥林多后书…（四10～13）」按最近全书引用错归耶利米书、与「罗马八章所说的万有（28）」错链 耶4:28）。四条约束：① **不跨句**——提及与引用间隔着正文句子即失效（`。！？` 且其后不跟左括号；**分号不算跨句**，反馈 #30「…启示录里所用的辞；乃是祂用了『撒但会堂』这个辞。（二9。）」仍归启示录；引号引用文先剥掉再判，中英引号 “”‘’「」『』 都剥——引文里的句号不是正文句末，反馈 #31），防行文顺带旁及别卷（「彼前三章二十节追溯创世记中洪水…（十三3）」）劫走本卷引用；② 本行内被后续全书引用覆盖、不写回 carry；③ 裸书名**只收全名形态**——先知/使徒简称（约书亚/撒迦利亚/约翰/雅各/马可/路加…）同时是人名，收了会把正文人名讨论当书卷上下文（撒迦利亚书三章满篇「约书亚」→ 引用全被劫到约书亚记）；④ **章号新鲜度**——本行先出现带章号引用后，纯阿拉伯节号沿用其章而非更早的裸章提及（「但以理七章…（二32，39上）」的 39上 = 但2:39）。**相对节范围列举（2026-10-22，反馈 #29/#31）**：逗号分隔的后续裸节范围（「一章七至八节，十二至十四节，十六至十七节」的后者、以及「五至六节」）按当前章展开——`buildRelativeVerseSeqRegex` 只认范围/列举（必须带「节」，**不认单个裸节号**：全量实测单个裸节号会多出 2600+ 行改动、其中不少错链）；章上下文必须**本行同句**建立（`chapEnd`/`chapFromLine` 追踪 + 剥引号后无 `。！？`），跨行（carry）/跨句宁可少链不给错链；且只刷新弱上下文、**不提升为 curAcronym/curChapter**（提升会把后文别卷的相对引用劫走）。裸书名提及（无章）把章上下文标为未知（单章书卷 俄/门/约贰/约参/犹 除外 → 第 1 章）。**诗篇「N篇」**：`诗篇/诗 + N篇` 作章提及，目录式列举里省略前缀的裸「N篇」**仅在诗篇语境**认（其他书卷里「第八篇」是篇目编号，且「但第八篇」的「但」是连词）；`cnToInt`/`parseRefTail`/`resolveRefString` 的中文数字类全部含「零」（「一百零二」=102，**检测与解析必须同步加，否则是「未收录」死链**）。跨章范围之后的续节按**就近边界**归章（离首章起节近取首章、离末章止节近取末章：「一章一节至二章十一节，十八至二十一节」= 2:18～21；「八章二十七节至九章一节…（27）（28）」= 8:27/8:28）；分号本身不判跨句，但分号后还接着成段论述（>20 字）仍判——「…乃是爱情；这里十六章…（22，旧译本）」归十六章。**引用语义以数据源为准（勿改）**：串珠/注解沿用恢复本写法——`约一/约二/约三` = 约翰福音第 1/2/3 章（创1:1 串珠「约一1，2」= 约1:1-2、箴8:35「约三36」= 约3:36），约翰书信一律 `约壹/约贰/约参`，故 `BOOK_ALIASES` **不得**把 约一/约二/约三 映射到 约翰一/二/三书（`resolveRefString` 逐个尝试前缀别名切分，优先采纳能解析出真实存在的节的切分，章号越界即淘汰该切分）；`detectRefs` 取正则捕获组 1 作为书卷别名（正则可能回溯到较短别名，不能用 startsWith 反查）；支持「第?X章Y节〔至Z节〕」范围展开与**列举式**（「X章Y、Z节」「X章Y和Z节」，反馈 #15；延续项用 `、和与` 连接、`节` 可只出现在末尾（三章一、二、三节），延续项前的 `(?!cn+章)` 守卫防吃进下一个「X章」引用；`resolveRefString` 对 `、` 拆出的残段（如「二」「五至七节」）按同章相对节序列补齐）、`参/见` 引导词前缀、全角「：」作分隔符（串珠「2～5：代上一5～7」前半是节范围不是引用）、单章书卷裸节号按第 1 章解（犹16 = 犹1:16）。**别名与后缀兜底（勿回退）**：① 简称别名须齐全（路加→路、马可→可，原只登记「路加福音」→ 缺别名时正则把「加/可」当加拉太/马可福音，产生越界死链）；② 全量引用章号超出该书卷章数即判定为别名后缀误匹配，不按该卷包裹成死链（反馈 #8；**只跳过别名本身**，尾部「X章Y节」交相对引用按上下文书卷归属——多处「但二十三章十二节」的「但」实为连词，据此可正确落到本卷）；④ 书卷简称须覆盖语料写法（2026-09 补：希伯来/撒迦利亚/何西阿/约书亚/玛拉基/哈巴谷/尼希米/约珥/提多/以斯拉/阿摩司/西番雅/以斯帖/弥迦/列王记上·下/彼得前/使徒行——缺失时含缩写字的名字无法整词命中，会漏链或只链到名字中段）；③ 引用带 `上/下` 半节后缀但该节在数据里未拆分时回退整节（如太11:29 整节却有引用「太十一29上」，反馈 #12），相对引用正则同样支持尾部上/下
- **书报模块（books，多系列：倪柝声文集 ni + 十二篮 slat + 传记与文集 bio + 福音天地 fuyintiandi + ezoe 分类系列 gospel/reading/periodicals/misc + 2026-10-19 灵粮 22 个 legacy 系列 + ezoe 造就类 zj / 教会与事奉类 jh，共 32 系列，后续同构扩展）**：入口经首页重组（2026-10-12）——首页「倪文集」块直达 ni，「书报」块开二级合集层（`openBookHub`/`renderBookHub`，见「首页 + 合集块」节）；entry 直接进上次位置（`LS_BOOK_LAST`{series,volume,book,chapter}，无则系列清单第 1 个第 1 辑第 1 本第 1 章——`SERIES_ORDER` 首位是 ni，故首次进入落倪文集）；**无左栏**（2026-09：模块级搜索迁停靠抽屉搜索条，书列表=停靠抽屉双栏，底部辑切换仅非扁平系列）：点书=刷新右栏，点章才打开；**扁平系列**（十二篮等无书级系列：每辑 books 只有 1 个条目）抽屉双栏退化为「左=辑列表（data-vol，dwBody 代理有专属分支）、右=篇列表」，`jumpDrawerBrowse` 对扁平系列按 vol+篇索引跳转（book 恒 0）；**抽屉左栏（层级一）序号与副标已删（2026-10-12 用户定稿，目录空间宝贵）**——分辑书列表不再显示序号（`num`）与「N章」副标，扁平系列辑列表同样只留辑名、**且不渲染底部辑切换条**（左栏已是全辑列表，底部再来一行既冗余、辑多时又挤成一团）；**右栏篇/章标题经 `dwChapterLabel` 剥掉与正文标题重复的开头序号**（「第N篇/章/段/部」「一/壹…」「（一）」，需带分隔符且剥后仍有内容，纯序号标题如「第一篇」与含数字词标题如「一个见证人」原样保留）；**bio 传记与文集**是「单 volume 多 books」形态（无辑级，41 个 books 条目=原子集 24 + ezoe 传记、文集类并入 17，王明道文库 9 册折叠为册级条目），抽屉按普通书级双栏渲染；主区=`#bookMain` 当前章正文（`.bk-para`/`.bk-head lr-h{n}` 按行 data-base 渲染：**标题行 `detectLrHeading` 识别独立成 `.bk-head`（左对齐+加粗+字号递进，无缩进），正文段落纯文本样式无卡片（2026-08 用户定稿：去掉卡片）；正文头部与 `.bk-title`/crumb 重复的书名+章名行跳过（`renderBookContent` leading 去重，偏移照常累计标注不变）**；标注 type 'book' 坐标系=chapter.content，定位字段含 series）；右栏=`#bookSide` 笔记（章级 textarea `state.bookNotes` + 标注汇总；「章列表」tab 已删，切章统一走抽屉）；crumb=`{系列名} · {书名/辑名} · 第N章`；数据 `data/books/`：`{id}.json` 元数据（轻量含章标题）+ `{id}-{辑}.json` 按辑懒加载（ni 3 辑 62 本 1325 章约 24MB；slat 12 辑 144 篇；**bio「传记与文集」41 本 902 章约 12.3MB**——bio 原子集 24 条目 + ezoe 传记、文集类并入 17 本（重复书《今时代神圣启示的先见》跳过），追加在后保旧标注索引稳定；**福音天地 fuyintiandi**（2026-10-15 新增）：早年网页版抓取的福音主题文集， bible 侧 ezoe 吸收合并后也是被合并 gospel 书的正版所在地；独立索引 `福音天地目录索引.json`（扁平 items 845 条）按顶级目录分 22 本（新旧约福音题纲 4 个子目录不拆、295 篇一书），单 volume 单文件 6.4MB；专用 `read_gospelfood_md` 剥网页版「篇名+书名碎片（可拆行）+篇名」页眉块与被吸收书的 `**书报号**`/`**说明**` 页脚。**ezoe 四分类各为独立系列**——gospel 福音类 70 本 509 章 7.4MB / reading 读经类 28 本 433 章 10.1MB / periodicals 代售期刊类 32 本 1654 章 5.4MB / misc 其他 8 本 1001 章 4.8MB，均单辑单文件且在 CF 25MB 限内；**2026-10-19 新增 zj 造就类（2 卷 232 本 2437 章 37.7MB）与 jh 教会与事奉类（96 本 914 章 18.7MB）**；legacy 系列中属灵书报 4 卷 224 本 2425 章 43.6MB、特会信息 37 本 290 章 11.6MB、结晶读经 29 本 461 章 16.6MB、造就等其余 19 系列单卷，全部单文件 <25MB；见文件结构表 export-spiritual.py 行）；切系列/辑/书/章 `selectBookSeries/selectBookVolume/selectBookItem/selectBookChapter`（注意：**书报函数已加 Item/Volume 前缀避免与读经 selectBook 同名覆盖**）；统一入口 `openBookChapter(volume, book, chapter, series)`。**多系列元数据机制（2026-10-11）**：`seriesMeta(series)` 同步读 `state.seriesMetaCache`，`ensureBookSeriesIndex` 加载系列清单后 `prefetchSeriesMeta` 并发预取全部系列元数据（轻量文件），预取完成若正停在笔记视图则补渲染（兜底文案升级真名）；标注分组/笔记树/annLoc 按标注自己的 `a.series` 取元数据（4 处 `series === 'ni'` 硬编码已移除），缓存未命中走「卷N书N」兜底。**`ensureBookMeta` 并发守卫（2026-10-14，ezoe 多系列接入时实测踩坑）**：fetch 前捕获 series、仅当 await 后仍停在本系列才写 `state.bookMeta/bookMetaSeries`——切系列瞬间抽屉刷新（renderDrawerBrowse）与 enter 链会并发各拉一次元数据，无守卫时后完成的别系列数据会顶替当前系列缓存（crumb 显示错系列书名且污染持续，曾致 ezoe 直进显示「倪柝声文集」）。`ensureBookVolume` 同理但无此问题（key 在闭包外先取、内容与系列一一对应）**人物链接（2026-10-12 接入原型，10-15 反馈 #26 扩至倪文集）**：正文人名包 `<span class="person-link" data-person>`（青绿点线，与经文 ref-link 紫色虚线区分），点击 `showPersonPopup` 弹人物小传（简介/英文名·生卒/摘录/出处 + 「查看完整小传 ›」跳书报·传记与文集该章）。**十二篮 + 倪文集启用**：`personScopeOn(state.bookSeries)` 读 `data/persons.json` 的 `scope`（现 `['slat','ni']`，空数组=全模块；ni 于 2026-10-15 随反馈 #26 接入——倪文集正文常提教会史人物如司布真、慕勒，词典 31 人皆有 bio 小传可跳），词典 28KB 在 `renderBookMain` 首次按需加载（`ensurePersonsData`，失败置空表本会话不重试）。**匹配**：`detectPersons` 用 `personMatchEntries`（别名+`blockWords` 合表、**按长度降序→最长优先**，故「路德马丁」「卫斯理约翰」先于短名命中；复合词保护让「加尔文主义」整体跳过不链），与经文引用**同一渲染通道**（`renderLrLine` 第 7 参 persons，两者重叠时**经文引用优先**，不与 ref-link 嵌套）；人名 span 不改变文本节点内容与 `data-base` 偏移，标注坐标系不受影响（`person-link-test.js` 3b 逐行断言）。**定位守卫**：`loc` 的 series/volume/book/chapter 四个字段须齐全才跳转（否则 toast 提示、保留弹窗）——`openBookChapter` 收到 undefined 会被判为「章不同」进而写坏 `LS_BOOK_LAST`（`person-link-test.js` 第 7 步断言 last 未被改动）
- **听抄模块（morning）**：entry 直接进上次位置（`LS_MORNING_LAST`{period, chapterId}，无则第 1 期第 1 篇）；**无左栏**（2026-09：模块级搜索迁停靠抽屉搜索条，期/篇列表=停靠抽屉双栏）；主区=`#morningMain` 当前篇**听抄**（信息正文：`detail_sections` 树形层级标题 + 段落，content 逐行 data-base 渲染，标题行经 `detectLrHeading` 识别加 `.morning-head` 类；仅含听抄数据，纲目/六天晨兴不导出）；篇首经文串 `.morning-scripture` 经 `linkifyRefs` 包 ref-link 可点击（2026-09 反馈 #18：`scripture` 是多书卷串珠链如「约十11、16，二一15～17，彼前二25，五4」，串首全书式引用自建书卷/章上下文，后续相对续节/相对章节式逐一归属，`defaultAcronym` 传 null）；**正文逐行渲染的跨行书卷上下文（2026-10 反馈 #20）**：`detectRefs(text, defaultAcronym, carry)` 新增可选 `carry` 对象——以其 `{acronym,chapter}` 为初始上下文、函数结束写回最新值；`renderMorningMain` 在整篇正文维护 `refCtx` 传给 `renderLrLine`，使段首省略书卷的引用（如「（四24，约壹一5，四8、16）」的 `四24`，书卷来自上一段的「约一12」）继承上段上下文 → `约4:24`。`carry` 仅补初始上下文，不参与行内全书引用的解析与 defaultAcronym 回退，故只会新增此前漏识的段首相对引用，不改变已有解析；**`showRefsPopup` 在 `state.bibleText` 未加载时先弹「经文加载中…」占位、`ensureBibleData` 补载后原位填充**（lr/听抄/书报直进早于经文数据加载时序，此前点引用弹「未收录」；注：init 启动预渲染通常已载好，占位仅在慢网/加载失败重试时可见）；右栏=`#morningSide` 篇级笔记（`state.morningNotes`）+ 标注汇总；crumb=`期标题 · 第{n}篇 {标题}` 点击开导航抽屉；标注 type 'morning'（`period`/`chapterId` 定位）；数据 `data/morning/`（index.json + `{期}.json`，当前 2026-03/04 两期 18 篇）；`openMorningArticle(periodId, chapterId)` 统一入口
- **笔记管理模块（notes，2026-08 阶段 2）**：首页「我的笔记」块直进（`enterModule('notes')`，不再进读经研读列）；**只收纳「自己做的笔记」：带 `note` 的标注 + 大段笔记；纯划线/纯下划线（无笔记）不在此列**（`notesFiltered`/`renderNotesTree` 按 `a.note` 过滤；阅读器右栏「划线汇总」仍展示全部标记；面板清空笔记后降级为纯划线 → 退出模块并清空选中）；三列=左栏**分类树**（来源（全部/经文/生命读经/书报/听抄，计数）→ 书卷/系列 → 章/篇叶子，可折叠，`state.notesCollapsed`；`renderNotesTree`）/ 主区**条目列表**（工具条：来源 tab + 颜色过滤 + 搜索（只刷新列表主体保输入焦点）+ 排序（书卷序/时间倒序）+ 多选开关（勾选框只在标注条目上，大段笔记无）；`renderNotesList`/`renderNotesListBody`；分组复用 `groupHlGlobal`（label 由 `annGroupLabel` 统一）+ **大段笔记混排**（chapterNotes/lrNotes/bookNotes/morningNotes 非空项，📝 图标区分，`bigNoteGroupLabel` 挂对应组））/ 右栏**编辑面板**（`renderNotesPanel`：标注=文本/定位/时间 + 笔记 textarea 直写 `save(LS_ANNOTATIONS)`（blur 时空笔记无颜色无下划线 → 等同删除；仍有颜色/下划线 → 降级为纯划线退出模块）+ 5 色改色 `changeAnnColor` + 下划线 `toggleAnnUnderline` + 删除 `deleteAnn`；大段笔记=textarea 直写对应 dict + 删除 `deleteBigNote`）。**点击条目=选中进编辑面板（不跳原文）**；多选模式（`.notes-item-check`）→ 批量条（已选 N / 分组全选 / 删除所选（v1 只批量删除）/ 取消）；删除均走 `confirmDialog`（复用 openPopup 的确认弹框）。偏好 `source/color/sort` 持久化 `LS_NOTES_PREFS`（`bible-study.notesPrefs`，纯本地不入云同步）；`rerenderAnn` 顶部 notes 模块早退（刷新树/列表/面板，防误 renderChapter）。移动端同其他阅读器模块：主区显示于 text-col，左/右栏抽屉延后。**搜索的标注分支仍跳原文**（`navigateToAnnotation`，与笔记模块无关）
- **模块感知标注**：`renderLrArticle` 输出 `data-book`；`renderBookMain` 输出 `data-series/volume/book/chapter`；`renderMorningMain` 输出 `data-period/chapter`；`findAnnotatable` 加 `data-article`/`data-chapter` 守卫（**修复 renderFootnotes 注解容器误标 .lr-content 致 articleId=NaN 的隐患**）；`handleSelection` 按 data-book / data-volume / data-period 定位源文本；`navigateToAnnotation` 模块感知（lr/books/morning 模块内就地跳转，跨模块回 bible）；`buildAnnotation` 按 type 存定位字段（verse: chapter/verse/half、lr: articleId、book: series/volume/book/chapter、morning: period/chapterId）
- **首页统一检索（2026-10-20，取代原 `homeSearch` 五条轻量过滤）**：`runHomeSearch`/`collectHomeHits`/`searchByKind`，结果按域分组渲染 `#homeSearchResults`（`.sr-group[data-g]` 分组头带真实总数，每组预览 5 条 + 「查看全部 N 条 ›」开 `openPopup` 全量列表；命中词 `mark.sr-hit` 高亮）。**五个数据域**：① 读经—`parseBookChapterQuery` 支持「创24/创世记24」（同步命中，首帧即有结果，`home-test` 依赖）；② 书报—`searchBookTitles` 覆盖全部 32 系列 15367 章（章级索引 `buildBookSearchIndex`，系列名/辑名/书名/章标题/书号进 haystack，**空白分词 AND、ASCII 不区分大小写、纯数字词优先按书号精确匹配**（书号命中排最前，同时也参与书名/章标题的文字匹配，「1988」「365」这类数字标题不会被吃掉）；评分 = 书号 100 > 章标题 50，同分保目录顺序）；③ 生命读经—`ensureLrTitleIndex` 全 66 卷（索引未就绪退回已缓存卷）；④ 经文 + 注解全文—`ensureVerseSearchIndex`/`ensureNoteSearchIndex` 扫 `state.bibleText`/`bibleNotes`（启动即全量在内存，剥 `{N}`/`[a]` 标记，零额外下载；命中跳 `jumpToVerse`，注解命中额外 `showFootnotePopup`）；⑤ 我的标注 + 听抄（`ensureMorningAll` 一次加载全部期，0.7MB）。**时序**：`runHomeSearch` 先同步渲染已缓存部分 → `Promise.all(书报索引 / 生命读经索引 / 听抄全量)` 后 seq 守卫内补渲染（慢网不空白、不串结果）；**书报索引在搜索框 focus 时即预取**（`ensureBookSearchIndex`：`ensureBookSeriesIndex` + `ensureBookNumbers` + 全部 `prefetchSeriesMeta`，632KB / br 约 200KB），合集层 `renderBookHub` 元数据齐后也顺手建好。
- **测试**：e2e 类测试启动后需 `enterWork()` 切回工作区（init 后台预渲染使 DOM 存在但被 body.home 隐藏，直接 page.click 隐藏元素会抛错）；`home-test.js`（直进版冒烟）/ `home-test-mobile.js` / `lr-reader-test.js`（阅读器专项：直进/切卷/切篇/纲目/笔记/折叠/划线/恢复）为首页+阅读器链路测试
- **数据源（已落地）**：听抄 = 特会信息 epub（Notion 下载，`export-morning-epub.py <epub> --period {期}` 迁移，epub 含完整听抄 `{n}_ts.htm` + 读经 `{n}_cv.htm`；旧反编译晨读 APK 资源 detail_sections 每篇缺 18-27% 正文，已废弃不再用；当前 2026-03/04 两期 18 篇均已由 epub 导出。epub 源：mygoodland.notion.site 特会页「资源」子页的 epub&pdb.zip——zip 内文件 URL 需签名无法程序化下载，需手动下载后交给脚本）；书报 = `../bible/data/raw/spiritual_food/`（各系列目录索引 + md），`scripts/export-spiritual.py` 导出 `data/books/`（index.json 系列清单 + {id}.json 元数据 + {id}-{辑}.json 内容）；ni 源 `倪柝声文集/`（3 辑 62 本 1325 章）。**ezoe 书报合辑**（2026-10-12 bible 项目入库，即原「其他 30 个书报系列」的批量来源）：源 `ezoe书报合辑/`（源站 ezoe.work 抓取，7 分类 374 本 7394 章 93MB，已做重复移除 18 本/缺口核查留档/编号断档确认），索引 `目录索引.json`（categories→books→chapters 含 part/status/local_rel）+ `校验报告.json` + `缺口说明.md`。**2026-10-13 接入、10-14 按用户定稿调整结构**：分类平级为独立系列（类别即系列，像十二篮/传记与文集一样各占合集层块，不裹大系列切辑）——gospel 福音类 / reading 读经类 / periodicals 代售与期刊类 / misc 其他；**传记、文集类（writings）与 bio 同类别整合**并入「传记与文集」（重复书保留 bio 旧版）；edification 造就类与 church 教会与事奉类因单文件超限待拆分方案。标注 type 扩展 `'book'`/`'morning'` 已落地（向后兼容旧 verse/lr）。后续书报系列渐进加：导出脚本同构扩展 → 系列条自动多一项，前端零改动

## 专题（topics，活力八 · 作业单，2026-10-21 改版）

**定位**：专题 = 一份**作业单的链接聚合页**。每周一条任务，条目分别深链到读经模块的原文、
生命读经模块的篇目、书报模块的章节——**正文一律不复制、页面只有跳转**（用户 2026-10-21 定稿：
「链接聚合、像 todo list，因为这些都是活动的任务」「用路由跳转，工作量小」）。

- **注册表 `TOPICS`（app.js）**：每个专题 `{id, title, icon, blurb}`（只放展示信息）。
- **作业单 = 脚本里的 `REGISTRY`（唯一事实源）**：`scripts/build-topics.py` 的
  `vitality8.weeks[]`，一周一条 `{n, book, chapter, articles:[篇号], bookRead, memory}`：
  - `articles` 生命读经篇号（按顺序显示；脚本校验篇目存在且 `verses` 覆盖该章，标题由数据解析并剥
    「005第五篇、」前缀）；`bookRead` 指定书报 `{series, volume, book, chapter[, label]}` 或 `None`；
    `memory` 背经经节串或 `None`。后两者为 `None` 时页面渲染虚化的「待填」行（不可点）。
    `label` 可选，覆盖行内显示名——作业单的篇名落在章内、与章标题不同时用（如「传福音的秘诀」是
    《福音的托付》第 1 章内的篇名），跳转仍定位到该章。
  - 脚本自检：周次非法/重复、书卷不在 `ALLOWED_BOOKS`（腓 50 / 西 51）、章号越界、篇号不存在或不覆盖该章
    → 非零退出，不静默少内容。产物 `data/topics/{id}.json`（`{id,title,blurb,weeks[]}`，只含标题与定位，无正文）。
  - **默认篇号**（腓 1/2/3/4 → 3·4·5 / 9·10·11 / 17·18·19 / 26·27·28；西 1/2/3/4 → 2·3·4 / 18·19·20 /
    27·28·29 / 31·65）按「经文整段落在该章内、按篇号取前三篇」选的，**活动作业单到手后逐周替换**；
    西 4 章源数据只有 2 篇整段落在本章（31/65），故只挂 2 篇。
  - **指定书报**（2026-10-29 用户提供）：同一本《福音的托付》（`sg` 第二辑第 21 本，7 章）按章顺序
    对应第 1–7 周，第 8 周无书报（仍待填）；第 1 章的章标题是「福音的托付」，作业单上的篇名
    「传福音的秘诀」是章内一节，故用 `label` 覆盖显示名。
  - **`TOPICS_DATA=…`** 可把数据目录指到别处（`data/` 不入库的 worktree 用）；产物始终写回本仓库 `data/topics/`。
- **屏幕 = `state.screen = 'topic'`**（第三种态，与 `home`/`bookhub` 正交）：`body.topic` + 独立
  `#topicView`（单列 `#topicTextCol > #topicMain`，没有左栏/右栏）。**不碰 `READER_MODULES` /
  `applyModuleBodyClass`**；顶栏动作按钮（双页/隐藏注号/研读全屏/上一章/下一章）在 `body.topic` 下隐藏，
  **移动端「读经|研读」pill 也隐藏**（作业单不是阅读视图）。
- **导航**：首页块 `活力八` → `openTopic('vitality8')`（`#/topic/{id}`）。周卡条目是普通 hash 链接
  （`#/bible/{卷}/{章}`、`#/lr/{卷}/{篇}`、`#/book/{系列}/{辑}/{书}/{章}`），由 popstate/hashchange →
  `applyRoute` 就位。旧版分屏深链 `#/topic/{id}/{卷}/{屏}` 忽略多余段、归一到专题页。
  **同专题再进入保留滚动位置**（从条目跳走再返回，`openTopic` 把旧 `scrollTop` 传给 `renderTopicPage`；
  换专题/首次进入回顶）。阅读历史记 `module:'topic'`（`loc={topic}`），`jumpHistory` 与首页「最近阅读」都能跳回。
- **标注/笔记：无**。作业单页没有正文，**没有专题内划线、没有屏级笔记**（旧实现的下线）。旧数据兼容：
  `type:'topic'` 标注与 `topicNotes` 仍保留在 localStorage/云同步里，笔记管理仍能按「专题」来源查看
  （`navigateToAnnotation` 对 topic 只回专题页，不再定位到屏）；新代码不再产生这类数据。
- **`crumb` 刷新（回归修复，2026-10-21）**：`enterModule` 对**同模块重入**（如作业单「原文」跳回读经模块
  当前章）也会 `renderCrumb()`——否则顶栏会残留上一个屏幕（专题）写进去的标题。`topic-test` 第 5 项锁死这条。
- **测试**：`scripts/topic-test.js`（8772）——首页块/作业单页 8 周与五类条目/第 1 周链接（原文 + 三篇按顺序）/
  待填条虚化不可点/原文跳读经且 crumb 不残留/生命读经跳转/刷新保持/旧分屏深链归一/非法 id 回首页/
  返回保留滚动位置/纵向可达（滚到底能看到第 8 周，**曾因 `#topicView` 改 block 整页不可滚而全绿漏检**）/
  移动端单列无溢出 + pill 隐藏 + 可滚到底。**8765 常被用户的遗留服务器占用**：本测试与 `home-test`(8777)/
  `bookhub-test`(8776) 各用独立端口，避免静默跑在旧代码上。
- **联动（未实施）**：方案见 `generated-images/vitality8-integration-plan.html`——L1 出站链接（背经→logos、
  任务→日课，作业单数据可留外链字段）→ L2 精确落点 → L3 作业单共享数据源 → L4 进度互通（暂缓）。
- **⚠️ 2026-10-21 事故留档（历史）**：旧专题分支开发期间 `app.js` 曾被另一会话整体覆盖成旧版（统一检索
  模块与 `state.bookNumbers/bookSearchIndex` 全丢，`style.css` 同批丢 `.sr-*` 八条）；已逐块恢复。
  **教训**：合并/改写前先 `git diff` 别人未提交的工作，别整体覆盖分支上的 `app.js`。

## 听书（audio，2026-10-26）

**定位**：长音频课程阅读器。音频本体在阿里云 OSS（bucket `szkjweb`，公共读），仓库只放元数据
（`data/audio/`，~15KB/合集）。首个合集《鸟瞰圣经（王生台）》41 讲 / 95 分片 / 86 小时。

- **入口**：首页块「听书」🎧 → `enterModule('audio')`，直接续上次收听位置（`LS_AUDIO_LAST`），
  **没有独立合集层屏幕**——合集作为抽屉左栏承担（见下）。新增合集时前端零改动。
- **抽屉双栏**：左=合集列表、右=该集讲次（按底部分组条过滤），结构与读经（书卷|章）、书报（书|章）、
  听抄（期|篇）同构。点左栏只刷右栏（`data-ac`），点右栏才跳（`data-r` = 讲次号）。
  **底部分组条数据驱动**：合集 JSON 的 `groups` 有 >1 组才渲染（鸟瞰 = 旧约 1–23 / 新约 24–41），
  单组/空则平铺——`旧约/新约` 不是全局常量，别写死。
  **分组跟随当前讲次**（同 bible 的旧约/新约随书卷），否则深链进新约讲次时右栏仍按旧约过滤、
  当前讲次既不高亮也不在列表里；用户手点分组走 `renderDrawer(false)` 不被覆盖。
- **主区单列**（`body-mod-audio` 下 `.layout` 单列、`.study-col` 隐藏）：讲次标题 + 自绘播放器 +
  分段列表。**没有正文 → 没有标注 / 没有笔记 / 没有右栏**，因此也没有 `rerenderAnn`、云同步
  kind、笔记管理来源 tab 需要接（这是它比书报便宜的地方，也是建议不做笔记的原因：
  一接笔记就背上索引稳定性包袱）。
- **播放器**：`state.audioEl` 是**不在 DOM 里的单例 `<audio>`**，自绘控件驱动（进度条点击定位、
  ±15 秒、倍速 1→1.25→1.5→2→0.75）。重渲染主区不重建它，播放不中断。不用原生 `controls`：
  各平台外观不一、跟不了主题、高度吃版面。`ended` 自动连播**同讲内**下一段，讲末停住提示。
  单分片讲次（41 讲里 24 讲是单段）不渲染分段列表，避免只有一行的假列表。
- **断点**：`bible-study.audioLast` = `{collection, lecture, track, time, speed}`，`timeupdate`
  节流 5 秒落盘 + 切讲/切段/离开模块强制落盘；`pagehide` 也存一次。恢复条件严格——
  只在「同一讲同一分片」时跳转 `currentTime`（`loadedmetadata` 里 seek）。
- **媒体会话**：`navigator.mediaSession` 元数据（讲次名/讲者/合集）+ play/pause/±15 动作。
  **不承诺后台播放**：网页版受浏览器策略限制，APK 里也在 WebView 存活时才会继续。
- **检索**：首页统一检索`audio` 域（`searchAudioTitles`，标题/讲次号/合集名进 haystack，
  `ensureAudioAll()` 拉全合集——每集 ~15KB）+ 抽屉模块级搜索共用同一函数。
- **历史**：`pushHistory('audio', {collection, lecture}, '{合集} · 第N讲 {标题}')`，
  `HISTORY_LABELS.audio = '听书'`，`jumpHistory` 分发到 `openAudioLecture`。
- **顶栏**：`body-mod-audio` 隐藏 双页/隐藏注号/研读全屏/上一章/下一章/Aa；
  移动端额外隐藏「读经|研读」pill，且 `.crumb` 的 `right` 从 210px 收到 56px（没 pill/Aa 了，
  不然长讲次名被无谓截断）。
- **缓存**：SW 的「跨域请求不代理不缓存」规则已覆盖 OSS，2.4GB 音频不会进 Cache Storage；
  只有 `data/audio/*.json` 走 `/data/` 的 stale-while-revalidate。
- **测试**：`scripts/audio-test.js`（**8778**，16 项）——首页块/单列播放器/抽屉双栏/分组切换/
  切讲次（腓立比书 5 段）/单段讲次无分段列表/真实播放推进/倍速/切段/阅读历史/深链 + 刷新保持/
  首页检索 + 点击跳转/抽屉搜索/移动端单列无溢出 + 抽屉双栏宽度。**断言不依赖真实出声**，
  只查 `src`/时长可读/`currentTime` 推进；离线环境下第 7 项会失败（预期的环境依赖）。
  `router-test` 补了 `#/audio/niaokan/35` 深链 + 越界讲次钳制到 41。
- **成本**：全程听完一遍约 2.4GB 外网下行，按量计费是唯一持续开销，建议控制台买下行流量包。
  默认域名带 `x-oss-force-download: true`（不影响 `<audio>`，已实测），要更干净的直链体验再绑自定义域名。

## 路由（hash，2026-10-15）

**hash 路由**（URL 形如 `study.duoban.xyz/#/bible/1/24`）：URL 只变 fragment、不发网络请求——sw.js / index.html 相对资源引用 / CF 部署 / APK 全部零改动（path 路由方案需改绝对路径 + SW 导航回退，已否决）；路由串全 ASCII（卷用 1-66 序号）无编码问题。

| 路由 | 视图 |
|------|------|
| （无 hash） | 首页 |
| `#/hub` | 书报二级合集层 |
| `#/bible/{卷1-66}/{章}` | 读经 |
| `#/lr/{卷1-66}/{篇id}` | 生命读经 |
| `#/book/{系列id}/{辑}/{书}/{章}` | 书报（书/章 0 基，与内部索引一致） |
| `#/morning/{期}/{篇}` | 听抄 |
| `#/audio/{合集}/{讲次}` | 听书（讲次号越界钳制到最后一讲） |
| `#/notes` | 笔记管理 |
| `#/topic/{专题id}` | 专题（作业单页；旧分屏深链 `#/topic/{id}/{卷}/{屏}` 归一到此） |

- **写入规则**：容器内位置变化 = replace（翻章/翻篇不堆历史，后退一步回上一级）；容器/屏幕/模块变化 = push（可逐级后退）。容器 = 模块 + 一级定位（读经按卷、生命读经按卷、书报按 系列·辑·书、听抄按期、听书按合集）。写入用 `pushState`/`replaceState`（不触发事件，不会回灌 onUrlChange）；`syncRoute()` 微任务合并（一次事务内多次导航只写一次）、`_routeApplying` 期间跳过（防事件环）、`_routeReady` 前跳过（防 init 的 showHome 冲掉冷启动深链）。
- **同步点**：各导航函数尾部（与 pushHistory 同挂点）：`selectChapter` / `selectLrArticle` / `selectLrVolume` / `selectBookSeries` / `selectBookVolume` / `selectBookItem` / `selectBookChapter` / `selectMorningChapter` / `selectMorningPeriod` / `selectAudioCollection` / `selectAudioLecture` / `enterModule` / `showHome` / `openBookHub` / `openTopic`。**新增顶层导航入口必须在尾部同样调 `syncRoute()`**。
- **就位（URL → 视图）**：popstate + hashchange（浏览器前进后退、系统返回、手动改 hash）→ `parseRoute()` 校验钳制（整数值校验、章按 books.json、书报按元数据、系列白名单；非法 → 首页并净化 URL）→ `applyRoute()` 走既有统一入口（selectChapter / openLrArticle / openBookChapter / openMorningArticle / enterModule）。**竞态守卫**：就位进行中来的 URL 变化置 `_routeRerun` 补跑（不丢）；就位完成后 URL 归一化用 replaceState（钳制后的真实位置与请求不同时修正，不加历史）；就位中途抛错兜底回首页（不留悬空态与未处理 rejection）。`#/book` 精确章号需纠偏——books enter 的「续接上次位置」只认 truthy opts（chapter 0 会被 last 顶替，既有行为），applyRoute 显式补调 selectBookChapter。
- **冷启动深链**：init 数据就绪、splash 放行后 `initRoute()` 就位；**刷新保持位置**（reload 走深链）；非法 hash 净化回首页。
- **Android 返回键**（`@capacitor/app` 的 `backButton` 监听 → `handleNativeBack`，仅原生注册）：层级 = 弹窗栈（设置/注脚/人物/确认框，closePopup 逐层关）→ 划词浮动工具栏 → typo/update/note 模态 → 笔记移动端编辑面板 → 移动端抽屉 → `history.back()`（canGoBack）→ `exitApp()`（首页无历史 = 退出，标准行为）。**注册监听会禁用插件的原生默认行为**（默认=canGoBack 则 webview.goBack），canGoBack 判定与退出都在 JS 侧显式实现；`_nativeBackBound` 防重复绑定（init 重试会二次调用 initNativeBack）。依赖 `@capacitor/app@^6`（在 package.json；CI `npm install` → `cap sync` 自动纳入，patch-android.mjs 与 AndroidManifest 零改动）；浏览器端无 Capacitor 全局，`initNativeBack` 直接 no-op（网页不受影响）。
- **测试**：`scripts/router-test.js`（8769）——URL 同步/翻章 replace 不堆历史/前后退跨模块就位/刷新保持位置/五模块 + hub 深链/非法 hash 净化/章越界钳制/返回键层级（伪 Capacitor 注入）/移动端返回键关抽屉/合集层 push-back。

## 阅读排版（Aa 面板，2026-09）

**顶栏 Aa（`#typographyBtn`）→ 独立 modal `#typoModal`**（桌面居中弹层 / 移动端底部 sheet，复用 `.notemodal` 遮罩 + `.typo-card` 卡片；**不走 popup 栈**——排版要「拖到舒服为止」，不能被弹窗栈返回逻辑打断）。两项设置，滑杆 + `A−`/`A+` 步进（0.05）**即时生效**，底部「恢复默认」：

| 项 | CSS 变量 | 范围 | 默认 | 作用 |
|----|---------|------|------|------|
| 字号 | `--reading-scale` | 0.85 ~ 2.00 | 1 | **倍率**（非绝对值），乘各模块自己的正文基准字号 |
| 行距 | `--reading-lh` | 1.5 ~ 2.4 | 2 | 正文段落 `line-height`（无单位数，随字号自动联动） |

- **机制：逐元素 `calc(基准px * var(--reading-scale))`，不用 html 根字号 / rem / zoom**。理由：① 只放大正文，顶栏/按钮/tab/抽屉/弹窗等 UI 完全不动（业界阅读器共识；WCAG 1.4.4 要求正文可放大到 200%，上限 2.0 即为此）；② `1.0x` 时数学恒等于改造前的 `Npx`，**零视觉回归**（`typography-test.js` 第 1 项逐元素断言）；③ 不引入新的继承基准，无需重算 em 层级。
- **跟随缩放（白名单）**：主区正文——经文 `.vtext`/`.vnum`/`sup.fn-ref`/`sup.xref-ref`/`.chapter-theme`/`.theme-row`/`.outline-item.lv1~lv6`；生命读经 `.lr-content`（内部 `.lr-head`/`.lr-para` 无独立字号，自动继承）；书报 `.bk-title`/`.bk-para`（两处重复定义块都需改）/`.bk-head.lr-h0~h10`；听抄 `.morning-title`/`.morning-scripture`/`.morning-content`（内部 `.morning-head.lr-h*` 本就是 em，自动跟随）。研读列阅读内容——`.lr-content`（注解正文与生命读经正文共用此类，改一处覆盖两处）、`.lr-item .lr-title`、纲目 `.lr-toc-item`/`.lr-toc-l4~l10`/`.lr-outline-group-title`、划线汇总 `.hl-header`/`.hl-text`/`.hl-note`、笔记输入 `.note-item textarea`/`.lr-note-ta`。
- **不跟随**：所有 UI（顶栏、`.crumb`、`.study-tab`、`.top-btn`、抽屉、笔记管理模块、书报章列表 `.bk-toc-item`）与元信息（`.fn-label`/`.hl-loc`/`.note-meta`/`.lr-verses`）；注脚/串珠**弹窗**（`.fn-body`/`.popup-verse`）也不跟随——弹窗宽度固定，放大会溢出。
- **跨模块基准**：经文 18px / 生命读经 17px / 书报 15px / 听抄 15px（与 style.css 一致）；`TYPO_BASE_FS`（app.js）仅用于面板上显示「18px · 1.00×」，`enterModule` 内按 `state.activeModule` 刷新。
- **行距统一**：听抄 `.morning-para` 原硬编码 1.8、划线汇总笔记 `.hl-note` 原 1.8，统一改 `var(--reading-lh)`（默认 2.0，属有意的观感变化）；标题类（`.chapter-theme` 1.7 / `.bk-head` 1.7 / `.morning-head` 1.6 / `.outline-item` 1.8）不参与行距调节。
- **存储**：`bible-study.typography` = `{scale, lh}`，**纯本地偏好、不入云同步**（与 `viewMode`/`studyWidth` 同类，故不在 `SYNC_KEYS`）；`normalizeTypo()` 归一化——越界**钳制到边界**（步进到上限后停在 2.0，不跳回默认），非真正 number 回退默认。**坑**：`Number(null) === 0` 是有限数，判断必须用 `typeof n === 'number'`，否则「无存储」会被钳成最小字号 0.85。
- **关闭**：遮罩点击 / `×` / `Esc`，均解 `lockScroll`。移动端顶栏 Aa 与 ⌂ ☰ 标题 pill ⚙️ 同行不溢出（390px 实测，标题余 92px）。**踩坑**：移动端 `.crumb` 是绝对定位（`left: 44px; right: 210px`），right 值按「pill + Aa + ⚙️」实测宽度反推（`390 - pill左边界`）；**今后往顶栏右侧加按钮必须同步加大该 right**，否则 crumb 会压进 pill 区域把标题遮掉（本次即因此先出 bug：原 174px 只让了 pill+⚙️）。pill 按钮 padding 也从 12px 收到 10px 给标题找回 8px。
- **范围外**（未做）：字距、页边距、字体族。（主题配色原列范围外，2026-10-16 已由「阅读主题」实现，见下节）

## 阅读主题（2026-10-16）

**设置弹窗 →「阅读」组 →「阅读主题 ›」**：经典（classic，默认）/ 靛蓝（indigo）/ 暖纸（paper）/ 素灰（minimal）四主题。选向依据：业界最佳实践调研（Apple HIG Body 17pt / Material 3 surface 分层与 elevation 实值 / W3C clreq 原则）+ 三方向 Case demo（`generated-images/ui-style-case.html`），用户定稿「做成主题让用户切换」。

- **实现 = 设计 token 体系**：`:root` 六类变量（颜色/字号/圆角/间距/阴影/z-index 层级），**classic 值与 token 化前 1:1**（11/12 张基线截图逐字节一致，唯一差异是设置弹窗新增的「阅读主题」行）；三主题 = 文件末尾 `:root[data-theme=…]` 只覆盖差异变量。落地用一次性 codemod（`scripts/tokenize-codemod.js`，逐行断言旧值才替换）：126 处 `font-size: Npx → var(--fs-N)` + 94 处逐行替换（散色/圆角/阴影/z-index/卡片钩子）
- **结构钩子（主题改变「形态」不只变色）**：`--topbar-bg/fg/shadow/border/solid`（classic 渐变+投影 ↔ indigo 实色 ↔ paper/minimal 融入页面背景+hairline；`--topbar-solid` 是 iOS 26 Safari 顶部取色源——渐变主题也要垫同色纯底）、`--card-bg/border/shadow` + `--verse-sep/-gap`（**paper 经文去卡片化**：透明底+节间 hairline 分隔）、`--ol1-fs/--ol2-color/--vnum-color`（纲目与节号层级策略）、`--pill-*`（移动端 读经|研读 pill）、`--topbar-line/-strong/-btn/-btn-on`（顶栏描边与按钮态）、`--panel`（**弹窗/浮层面板底，classic 纯白 #fff**——勿与 `--surface`（蓝味白 #fafbff，卡片表面）混用：popup/notemodal-card/floattool/marktool/抽屉搜索 focus 五处用 --panel，CR 时曾误归 surface 造成弹窗底色回归）
- **存储与防闪变**：`bible-study.theme`（JSON 串，纯本地不入云同步）；`index.html` `<head>` **early script 首绘前落 `<html data-theme>`**（白名单外一律回 classic；classic 也显式落值，供 `:root:not([data-theme="classic"])` 图标切换判定）
- **图标双渲染**：首页 6 块与书报合集层块同时渲染 emoji（`.hb-ic-em`）与线性 SVG（`.hb-ic-line`，`THEME_ICONS` 注册表按块 id 取图，stroke=currentColor），classic 显 emoji、其余主题显线性（minimal 用灰墨、indigo/paper 用品牌色）
- **不变式**：5 色标注语义（`--c1~c5`）与 `--fn-ref`/`--person` 全主题共用；阅读排版（Aa）变量各主题通用；正文基准字号 18/17/15 不动（对齐 iOS Body 17pt）；c1 黄标注在 paper 纸底（明度≥96%）可读性已验证
- **散值合并（有意的极小色差）**：红系 `#d33`/`#e5484d`/`#ef4444` → `--danger`(#d9534f，与原 `#d9534f` 同值)，`#b91c1c` → `--danger-deep`；绿系 `#dcfce7`/`#166534`/`#16a34a` → success 三 token 按原值各就各位零变化；`rgba(255,255,255,.15/.18)` 悬停态统一 `--topbar-btn`
- **约束（修改守则）**：**新增样式一律用 token（`:root` 变量），禁止裸色值/裸字号**；主题差异只进 `:root[data-theme=…]` 覆盖块、不改选择器结构；新主题 = 新增一个覆盖块 + `THEMES`/`THEME_SWATCH` 注册表各一行
- **测试**：`theme-test.js`（classic 关键计算值零回归 / UI 切换 paper·minimal 断言 / 刷新持久化 / 非法值回退 / 图标双渲染）；`scripts/ui-capture.js <tag>` 截图工具（`current`=基线、`after-classic`=token 化后、主题名=该主题成图，8766 独立端口，可与基线逐字节比对）
- **范围外**（未做）：暗色模式（token 分层已为其铺路）、主题自定义色。splash 首绘走 index.html 内联的靛蓝兜底（跨境慢网下 style.css 未到时），style.css 到达后 `#splash` 的 `var(--brand)` 跟随主题着色（paper 启动短暂可见 靛蓝→暖赭 的切换）

## 使用帮助 + 用户语言更新记录（CHANGELOG，2026-10-16）

**设置 →「其他」组 →「使用帮助 ›」**（检查更新上方，`openHelpPopup`，popup 栈）：四段用户语言功能介绍（从这里开始/阅读/划线与笔记/实用技巧，五色语义用真实 `mark.c1~c5` 色块展示）+ 底部「最近更新」（`CHANGELOG.slice(0, 3)`）。

- **`CHANGELOG` 常量（app.js，用户语言单一来源）**：`[{v, date, items}]` 按版本倒序，**两处消费**——① 帮助「最近更新」取前 3 条；② 更新弹窗「本次更新」经 `changelogSince(current)` **数值逐位比较取严格晚于本地版本的全部条目**（不依赖「本地版本在记录里」：记录空隙只展示真更新的；记录比本地旧/漏补时为空 → 回退原始提交信息；本地过老自然全量；调用处已由 `hasUpdate` 把关）
- **更新弹窗联动**（`openUpdateModal` hasUpdate 分支）：命中 CHANGELOG 时渲染「本次更新」条目列表（`.upd-ch-item`），替代原来的原始提交信息（`latest.body.slice(0,500)`，工程语言 + `[skip ci]` 噪音）；新增「查看全部更新」按钮（`#updateHelp`，关更新弹窗开帮助）；网页版提示改写为 `.upd-note` 柔和样式
- **纪律（发版流程补充）**：**用户可见功能发布时在 `CHANGELOG` 顶部补一行**（只记用户可见变化，不记 chore/内部改动）——帮助页与更新弹窗都靠它，漏补则更新弹窗回退原始提交信息（可接受的降级，但不是预期态）
- **测试**：`help-test.js`（入口位置/四章节+五色 mark/最近更新来自 CHANGELOG/更新弹窗命中与回退双分支/过老版本全量/「查看全部更新」跳转，13 断言）

## 云同步

标注/笔记通过 **duoban.xyz 条目级同步 API（v2 协议，2026-09-09 上线）** 跨端同步（与 bible-reader 共用同一服务器，服务器为主 + 本地缓存）：

| 项 | 值 |
|----|-----|
| API | `POST /api/sync/{kind}/ops`（批量推送，逐条裁决）、`GET /api/sync/{kind}/changes?since={rev}`（增量拉取）。kind ∈ annotations / chapterNotes / lrNotes / bookNotes / morningNotes / **topicNotes**（旧版专题屏笔记，2026-10-21 新增、同日随作业单改版停止产生——**通道与旧数据保留**）。**服务端 kind 是硬编码白名单**（`../server-ops/files/bible-reader/server.py` 的 `SYNC_KINDS`，不是按 kind 自动建表）：客户端 `sync.js` 的 `SYNC_KINDS` 加一项必须同步改服务端并重启 bible-kv，否则该项每次拉取 `400 invalid_kind` → 客户端整轮 `pullAll` 判失败（`remoteOk=false`）→ **所有设备的状态行常显「离线」**，而其它 kind 其实已同步（2026-10-21 加 topicNotes 漏改服务端，10-22 实测撞上、已修）。旧 `/api/kv` 端点保留（bible-reader 项目仍在用） |
| 服务端存储 | SQLite `items` 表（每条目一行：payload / client_updated_at / server_rev / deleted / last_op_id / device_id，索引 `(uid,kind,server_rev)`）+ `sync_state` 表（每账号每 kind 单调修订号）。**PUT 请求体上限 1MB**（2026-09-09 从 64KB 放宽——原上限导致平板 49 条划线静默滞留的事故根因；超限返回 `body_too_large`） |
| 客户端 | `sync.js`（`window.BibleStudySync`，v2 重写）：**outbox 模式**——本地改动 diff 成条目级 op（含完整 payload + `base_server_rev` + `op_id`），持久化于 `sync:v2:outbox`；flush 分批 POST，按结果逐条清账 |
| 裁决语义 | 服务端逐条：`op_id` 与行上 `last_op_id` 相同 → **duplicate**（幂等返回已存 rev）；`base_server_rev` == 当前 server_rev → **accepted**（分配新 rev）；不匹配 → **conflict**（附服务端当前版本，不覆盖）。`import=true` → 条目不存在才写入（设备首运行播种）；`force=true` → 跳过 base 检查（强制覆盖按钮）。**冲突自动裁决**（客户端）：按 `(client_updated_at, device_id)` 定序，本地晚→换 base 重推；服务端晚→覆盖本地；**败者全文存入冲突备份** `sync:v2:conflicts`（上限 100 条），绝不静默消失 |
| 拉取语义 | 增量 `changes?since=last_pulled_rev` → 返回 `{from_rev, to_rev, items[]}`，**全量应用成功后**才推进 `last_pulled_rev`（outbox 在途条目跳过不覆盖，交由推送 conflict 流程裁决）；**push 永远不推进拉取游标**（否则并发写入的中间 rev 会被永久漏掉）。首运行播种：本地全部条目以 import-if-absent 推上服务端，再从 0 全量拉取对齐 |
| 删除语义 | 本地删除 → `del` op（同样 LWW 裁决：比服务端晚才生效）+ 本地墓碑桩 `{id,_del:1,_t}`（localStorage 原样保留，`load()` 侧 `stripDeleted` 过滤，UI 无感）；服务端墓碑行**长期保留不做 GC**（清墓碑需要设备水位+reset 机制，此规模不值得；另需防「老客户端增量拉不到删除记录导致复活」） |
| 同步范围 | **只同步用户数据**（annotations / chapterNotes / lrNotes / bookNotes / morningNotes / topicNotes 6 个 kind；前端 `SYNC_KEYS` 与 `sync.js` 的 `SYNC_KINDS`/`KEY_MAP` 必须同步加，漏一处就是「只存本机」）；布局偏好（viewMode / hideMarks / studyWidth 等）保持设备本地 |
| 可见性 | 同步状态行显示 outbox 待推数/最近成功时间/最近错误；「数据对比」逐模块计数（本机 vs 云端，经 getServerStats 走 v2 changes?since=0）；「立即同步」手动触发+toast 报冲突备份数。服务器每日备份在 `/var/www/bible-reader/backups/`（30 天） |

**账号与授权（RFC 8628 简化版 + 账密登录 2026-10-11）**：
- 同步是**运行时可选功能**：localStorage `bible-study.account`（`{uid, token}`，null=未启用纯本地）；`syncActive()`（app.js）门控；⚙️ 设置弹窗「云同步」行打开启用/管理弹窗
- **两种启用入口（客户端弹窗双轨）**：① **账号密码登录**（主）——`POST /api/account/login` `{username, password}` → `{uid, token}`，与 claim 同路径建设备（每次登录生成新设备令牌，可吊销）；`loginAndEnable`（app.js），密码框回车即提交，错误分类提示（`invalid_credentials`/`rate_limited`）。② **授权码兑换**（保留）——`POST /api/account/claim`，弹窗内 `<details>` 折叠为次入口，给发码场景向后兼容
- **服务端账密**（`../server-ops/files/bible-reader/server.py`）：`accounts` 表增 `username`（唯一，`USERNAME_RE` 2-32 位字母数字_-，login 时 lower 归一）/`password_hash`（`scrypt$N$r$p$salthex$hashhex`，`hashlib.scrypt` 标准库，`secrets.compare_digest` 恒时比较）；幂等迁移 ALTER TABLE 补列。`POST /api/admin/accounts/{uid}/password`（管理员）设置/重置凭证，**账号不存在时自动创建**，校验 `username_taken`/`invalid_password`（≥6 位）；u1 初始凭证 `abu`/`duoban` 由启动迁移幂等写入（仅当无密码时，`OWNER_USERNAME`/`OWNER_INITIAL_PASSWORD` 常量——上线后可在面板改强密码）。登录限流 `LOGIN_RATE_LIMIT`（每 IP 每小时 10 次，与 claim 同桶机制）
- 管理员用 `npm run account:code`（`--uid u1` 绑定已有账号 / 缺省新账号码）生成授权码，码 10 分钟有效、一次性、每 IP claim 限流
- **权限**：`/api/sync/*` 与 `u{n}:bible-study:*` 命名空间读写必须带设备令牌（`Authorization: Bearer`），服务端按令牌解析 uid（跨账号隔离）；bible-reader 命名空间暂未纳入（`SECURED_PROJECTS` 可扩展）
- owner 账号 `u1` 预置（登录名 abu）；新账号从 u2 起
- **管理面板**：`https://duoban.xyz/bible-api/admin` — 账号列表/详情（设备吊销、**设备活跃识别：最后活跃时间/空闲天数/僵尸标记（≥60 天，阈值常量 `ZOMBIE_DAYS`）、设备标签（UA 解析，含机型）/KV 查看/删除、清空账号数据**）、授权码撤销、网页生成授权码、**备份管理（2026-10-05 新增：备份列表/下载/立即备份/恢复演练，演练对备份副本跑 integrity_check 并与生产库逐表行数比对，`match:false` 表示备份比当前数据旧，属正常）**。设备活跃由服务端在设备令牌鉴权成功时记录（1 小时节流、旁路失败不影响业务），**领码前的历史设备显示「无记录」、不算僵尸**，下次同步后自动补上；Chrome/WebView ≥110 的 UA 精简会把机型位变占位符，这类设备标签显示「（机型未提供）」。登录用管理员令牌（`BIBLE_ADMIN_TOKEN` = 服务器 `FEEDBACK_ADMIN_TOKEN`）或服务器 `admin_password.txt` 密码（两者存于 server-ops，见 `../server-ops/docs/servers/aliyun-rike.md`）；服务器代码与页面版本化源头在 `../server-ops/files/bible-reader/`，更新走 server-ops upload + `pm2 restart bible-kv`

- 同步失败静默降级为纯本地，不阻塞应用；`window.BIBLE_OFFLINE=true` 可跳过远程（测试用）
- 服务器 CORS 白名单在 `/var/www/bible-reader/server.py` 的 `ALLOWED_ORIGINS`（**当前已含** `https://study.duoban.xyz` 与 `https://bible-study-7rb.pages.dev`，2026-10-05 随 CF Pages 上线补入——新前端域名上线后必须同步，否则浏览器端报 preflight 缺 `Access-Control-Allow-Origin`）。正规改法：改版本化源头 `../server-ops/files/bible-reader/server.py` → `server-ops.py -s aliyun-rike upload` 覆盖 → `python3 -m py_compile` 校验 → `python server-ops.py -s aliyun-rike restart bible-kv`（**不要带 `--update-env`** 以免丢 FEEDBACK_ADMIN_TOKEN），随后 `python server-ops.py drift` 须全绿。Capacitor 6 WebView origin 是 `https://localhost`（白名单已含）
- 同步状态指示：设置弹窗「同步状态」行（`syncStatusInfo`：绿=已同步 / 橙=待同步 / 红=离线或最近失败 / 灰=未启用，含最近成功时间与待推数）+ 冷启动 toast（新会话首次，仅启用同步时提示）
- **v1→v2 切换纪律**（2026-09-09）：升级前所有设备在旧协议下「数据对比」归零（确认无未推数据）→ 部署服务端 v2（旧 /api/kv 不动）→ 逐台升级客户端（v2 首运行播种 import-if-absent + 全量拉取对齐）→ 第一台校验后再下一台。localStorage v2 状态键独立命名空间 `sync:v2:*`，与 v1 遗留数据隔离

## App 内更新

APK 端检查 GitHub Releases 新版本 → 下载 APK → 触发系统安装（移植晨读 app 更新逻辑，见 `update.js` 与 `config/android/`）：

| 项 | 值 |
|----|-----|
| 版本真相源 | `https://api.github.com/repos/all-the-day/bible-study/releases/tags/bible-study-main`（滚动 release，无鉴权 60 次/小时/IP） |
| 本地版本 | `manifest.json` 的 `version`（`update.js` 读取；CI 构建 APK 时用 package.json 值重写 `www/manifest.json`） |
| 远端版本 | Release `name`（CI 固定格式 `读经 v${VERSION} · 云同步版`），正则 `/v(\d+\.\d+\.\d+)/` 解析 |
| 比较 | `compareVersion`：去 v 前缀 → split('.') → parseInt 逐位比较 |
| 下载源 | **阿里云 OSS 版本化主包优先**，其后直连 GitHub + 公共镜像（`OSS` → `github.com` → `gh-proxy.com` → `ghproxy.net`），失败切换下一个。OSS 地址由 Release 版本号直接生成：`https://szkjweb.oss-cn-hangzhou.aliyuncs.com/bible-study-apk/v{VERSION}/bible-study-v{VERSION}.apk`（与音频前缀 `u8jw85vqqv/` 分离，**路径是对外契约，不可改名**）；无 OSS 对象时自动回退 GitHub。GitHub Releases 仍是版本检查真相源与老 APK 兼容通道，不能撤。镜像只替换 GitHub URL 的 host，不代理 OSS；静态 `bible-study.apk` 路径仅作 API 无资产时的兜底 |
| 下载方式 | **原生 `HttpURLConnection`**（`ApkInstallerPlugin.download`，不受 WebView CORS 限制）→ cacheDir `downloads/`；进度经插件 `progress` 事件（fraction 0..1，原生节流 500ms）转发 JS 进度条 |
| 安装 | `Capacitor.Plugins.ApkInstaller.install({filePath})`（原生插件）→ FileProvider → 系统 `ACTION_VIEW` 安装器 |
| 清理 | 成功后清理 CACHE/DATA `downloads/` 目录历史 `*.apk`（保留当前版本化文件与旧版固定名兜底） |
| **下载文件名** | **按目标版本命名 `bible-study-v{version}.apk`**（2026-10-11）：JS 传 `fileName` 给插件，旧版本残留与新文件物理隔离——此前固定名 `bible-study-update.apk` 跨版本复用，清理逻辑又刻意保留当前文件，导致上一版残留包在下次更新失败时被误交给安装器（手机实装到旧版的真实事故） |
| **下载完整性** | 插件下载完成校验 `received == Content-Length`，不符删文件并 reject（镜像截断实测：ghproxy.net 对 31MB 资产曾只回 2.5MB；无校验时截断包会按「成功」交给安装器）；下载失败同步删残留文件 |

- **触发**：启动后 ~3s 静默 `check()`（10s 超时，失败静默）→ 发现新版给 `#settingsBtn` 加 `.update-dot` 红点角标 + 设置弹窗「检查更新」行显示状态；设置行点击开 `#updateModal`（独立 modal，非弹窗栈，下载过程不被关闭打断）。**启动静默检查在本地浏览器上自动跳过**（`update.js` `isLocalDev()`：非原生 + hostname `localhost`/`127.0.0.1`/`[::1]`——Capacitor 原生 WebView origin 也是 `https://localhost`，故先排除 `isNative()`；手动「检查更新」不受影响，`check()` 函数本身不设门）。**`window.BIBLE_SKIP_UPDATE=true` 仍可显式跳过**（e2e 测试均已设置，双保险）：避免消耗 GitHub API 匿名配额 60 次/小时/IP
- **平台分支**：原生（`Capacitor.isNativePlatform()`）→ `download()`（update.js）依次调插件 `download({url})`，失败（超时/HTTP 错误）切下一源 → 成功后 `install`；PWA/浏览器 → 只提示跳转 Releases 页（网页内容走 SW 自动更新）
- **⚠️ 不要退回 WebView fetch 下载**：GitHub release 资产域（`release-assets.githubusercontent.com`）与公共镜像都不带 `Access-Control-Allow-Origin`，Capacitor WebView（origin `https://localhost`）里 fetch 跨域下载被 CORS 拦截，稳定复现 `Failed to fetch`（开 VPN 无效）——2026-08-26 实测根因，已改用原生下载
- **原生插件注入**：仓库不建 `android/`（CI `cap add android` 全新建）；`scripts/patch-android.mjs` 在 cap sync 后拷贝 `config/android/` 的 Java/XML 并幂等改写 AndroidManifest（`REQUEST_INSTALL_PACKAGES` 权限 + `<queries>` VIEW apk + FileProvider authority `com.allday.biblestudy.fileprovider`）
- **OSS 发布与凭据**：CI 在 GitHub Release 发布后，经仓库变量 `OSS_APK_ENABLED=true` 启用 OSS 上传（`continue-on-error`：失败只告警不阻断发版与版本递增，客户端自动回退 GitHub 下载）；Secrets `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` 应使用仅限 `szkjweb/bible-study-apk/*` 读写的 RAM 子账号，**不给删除权限**。CI 用固定版本与 SHA-256 的官方 ossutil 上传；版本对象不可变——已存在（同版本重跑）时不覆盖，此时 debug APK 不可逐字节复现（zip 条目时间戳），只校验对象可下载与 MIME，逐字节 cmp 仅对**本轮实际上传**的包执行。历史版本不自动删除，手动回滚走对应版本 URL，自动更新只升不降
- **本机手工上传/回填**：`D:/document/聖經鳥瞰/tools/oss-upload/` 已通用化（APK MIME + `--manifest`/`--urls`/`--cache-control`）；APK 放独立目录，用 `--root <目录> --prefix bible-study-apk/v{版本}/ --ext apk --manifest <独立清单>`，不要覆盖音频清单
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
- 客户端：**反馈入口桌面全界面可见**——顶栏「反馈」按钮（所有阅读器模块都不隐藏，`body-mod-*` 只藏其他工具按钮；首页顶栏同样保留）→ `openFeedbackModal()`（app.js），提交到 `https://duoban.xyz/bible-api/api/feedback`。**移动端（≤900px）顶栏隐藏该按钮**（`style.css` 移动端媒体查询 `#feedbackBtn { display: none !important }`，属有意设计：次要操作收进设置菜单），入口改为设置弹窗「其他」组的「反馈 ›」行（`openSettingsModal`）——2026-09-10 实测修正文档
- 任何「检查反馈」动作必须先 `npm run feedback:pull` 刷新，禁止直接读 inbox.md 作为反馈依据（它是本地快照）

## 数据导出

```bash
cd scripts && python export.py          # 经文/注解/串珠/纲目/生命读经（含 lr-titles.json 篇目标题索引）
cd scripts && python export-morning-epub.py /path/2026-3-MDC.epub --period 2026-03  # 听抄唯一导出脚本（epub 完整听抄）
cd scripts && python export-spiritual.py # 书报系列（倪柝声文集等）
cd scripts && python export-verses.py    # 精选经节（依赖 export.py 产出的 bible-text.json，需在其后跑）
cd scripts && python export-persons.py   # 人物词典（依赖 export-spiritual.py 产出的 bio.json/bio-1.json，需在其后跑）
cd scripts && python build-topics.py     # 专题（活力八）数据：读已导出的 lifereading/books 拼 data/topics/*.json（在上面几条之后跑）
```
- 数据源路径 `../bible/data/raw/bible_root/bible.db`（只读）与 `../bible/data/raw/life_study/`（只读）；听抄源为 Notion 下载的特会信息 epub；书报源为 `../bible/data/raw/spiritual_food/`
- 导出到 `data/`，改动数据源后需重跑导出
- 生命读经 `verses` 来自 `../bible` 的 `生命读经章节映射.json`（ezoe.work 目录页精确标注）；合并卷按「读经：」行拆分到子卷，verses 优先用精确标注，为空或章节号与主书卷不对应时用读经行补齐

## 部署（Vercel——2026-10-08 起停用，保留项目冷备）

- **不再部署、不再作为任何数据源**：web 入口与 APK 构建数据均已切 CF Pages（见下节）。项目 https://bible-study-teal-seven.vercel.app（账号 all-the-day）保留不删作冷备；`vercel --prod --yes --archive=tgz`、`.vercelignore`（只排除 `.vercel/` `.git/` `scripts/`，保证 gitignore 的 `data/` 能上传）仅作历史记录
- 退役原因：`*.vercel.app` 大陆域名级阻断（TLS RST），对国内用户无回滚价值；CF Pages 实测 25/25 全通，且唯一硬依赖（APK 构建数据下载）已切走
- **版本同步流程（发版必经，两步缺一不可）**：① push 触发 APK 构建 → 构建自动 patch+1 并把 `[skip ci]` 升版提交写回 main（同时改 package.json + manifest.json）；② 本地 `git pull --rebase origin main` 拉取升版提交 → `node scripts/deploy.mjs` 重新部署，让网页版 manifest.json 与 GitHub Release 对齐。否则网页版本号落后、设置弹窗「检查更新」一直提示新版本。**注意**：push 前若本地落后（有远端升版/其他提交），需先 rebase 再 push，且**部署要在 rebase 之后的干净工作区执行**，避免把旧 manifest.json 部署上去。
- **发版后验证 Release 资产：别只信 `gh api` 的 `assets` 字段**（此条与平台无关，Vercel 停用后仍适用）。2026-09-23 实测资产已正常上传且完整可下载，但 `gh release view --json assets` 与 `gh api .../releases/tags/bible-study-main` 仍返回 `assets: []`（误报为空），`gh release view` 文本态也不列资产——据此判断会误以为发版失败。也**不要**只看 `releases/download/<tag>/<file>` 的 302：其 `filename=` 是从请求路径推断的，资产不存在同样 302。可靠做法是**实际跟随重定向取内容**校验 `Content-Length`（应与 workflow artifact `bible-study-debug-apk` 一致）与 ZIP 魔数 `504b0304`；本机直连 `release-assets.githubusercontent.com` 会 TLS 失败（exit 35，H3C 拦截），须走代理 `-x http://127.0.0.1:7897`。

## 部署（Cloudflare Pages，唯一生产入口）

**2026-09-29 起实际生产主入口**：**https://bible-study-7rb.pages.dev**（Cloudflare Pages，大陆直连实测 25/25 请求全通）。起因：`*.vercel.app` 与 `vercel.com` 在大陆被域名级阻断（TLS RST），即便绑自定义域名 `study.duoban.xyz`→Vercel 也只解一半（Vercel 边缘 IP 一个 0/8、一个约 50% 被 RST），故增设 CF Pages 承载国内访问；**2026-10-08 Vercel 退役（APK 数据源已切来，见上节）后成为唯一平台**。

```bash
node scripts/deploy.mjs            # 同步 staging + 部署（内部调 wrangler；--check 为干跑）
```

- **staging 目录在仓库外**：`D:/AIWorkSpace/.cf-bible-study`（**2026-10-20 新机迁移**，旧机为 `D:/coder/aiWorkSpace/.cf-bible-study`；避免污染 git；**不认 `.vercelignore`**，需手工维护）。内容 = 运行时文件（`index.html`/`style.css`/`app.js`/`sync.js`/`update.js`/`sw.js`/`manifest.json`/`icons/`/`data/`），排除 `scripts/`、`node_modules`、`.git`、`.github/`、`config/`、`resources/`、`docs/`。**同步与部署已脚本化（2026-10-12）：`node scripts/deploy.mjs`**——按上述白名单把仓库文件同步进 staging（逐文件 md5 比对、只拷有差异的）+ 检测 staging 侧仓库外残留文件，然后直接调 wrangler 部署；`--check` 干跑只报差异不拷贝不部署；`STAGING=...` 可覆盖路径。**旧的手工覆盖流程已废**（2026-10-12 当天就实测抓到漏同步案例：`fdc216e` 正文剥离修复重导了 ni-1/ni-2 两个 7MB 数据文件，手工同步漏掉、生产与仓库数据不一致两天内无人发现，`deploy.mjs --check` 一跑即出）。**顺序约束**：改 `data/` 后必须先 `node scripts/deploy.mjs` 再 push 触发 APK 构建（build-apk.yml 从 CF Pages 下载数据，push 先于部署会让 APK 打到旧数据）
- 限制：单文件 ≤25MB、单项目 ≤2 万文件（当前 159 文件 / 最大 21.8MB，余量充足）；上传约 4 分钟
- 域名：**`study.duoban.xyz` 已绑定并生效**（2026-09-29：阿里云 CNAME → `bible-study-7rb.pages.dev`，CF 控制台 Custom domains 已认领，实测直连 200/1.4s）。**SW 缓存按域名隔离**——换指向或换域名后首次访问需重建数据缓存（约 8 秒，之后秒开）。`duoban.xyz` 主域与 `www` **必须继续指向阿里云 ECS**（101.132.34.193）保 ICP 备案——官方规则：主域名留在阿里云内地节点 + 有真实访问，子域指向境外不影响备案
- **SPA fallback 坑（2026-10-08 复核发现，实测确认）**：本项目无 404.html，CF Pages 对**所有缺失路径回 200 + text/html（index.html）**——任何「看 http_code 判断文件是否存在」的逻辑在 CF 上全部失效（`curl -f` 也拦不住 200；Vercel 静态项目缺失路径是 404，迁移前守卫有效）。`build-apk.yml` 下载数据因此改为按**内容是否合法 JSON** 校验：大文件/books/morning 硬失败（`check_json` 助手报 `::error::`），lifereading 缺卷沿用宽容语义 rm 跳过（部分书卷本无生命读经）——staging 漏同步某文件时 APK 构建会明确报错而非静默打包坏数据
- **与 Vercel 的关系**：**Vercel 已于 2026-10-08 停用**（见上节），`build-apk.yml` 数据源已切本节 CF Pages。CF 部署即唯一部署动作：push 触发 APK 构建并 `git pull --rebase` 拉升版后，`node scripts/deploy.mjs` 一次即可（同步 staging + 部署）
- push 前置：wrangler 需已 `npx wrangler login`（浏览器 OAuth，长期有效）；push/部署 GitHub 相关操作需代理在线（见「本机环境坑」）
- **⚠️ 「改了但没发上去」的排查三步（2026-10-21 实战）**：多个会话共用同一份 checkout 时，`git log` 只说明**提交**了什么，不说明**线上跑的是哪一版**。落定前依次核对：① `git --no-optional-locks status` 与 `git log origin/main -1`（改动是否已提交、是否已推送）；② `curl -s https://bible-study-7rb.pages.dev/app.js | grep -c <本次改动特有标识符>`（线上 JS 是否含本次改动——`0` 就是没部署）；③ `curl -s .../manifest.json`（线上版本号）。**实测教训**：2026-10-21 线上既有 `data/topics/vitality8.json`（staging 目录残留、随上次部署上传了），页面却没有专题——**「数据在了、代码没在」是最容易误判成「已发布」的组合**。另外 `node scripts/deploy.mjs --check` 只报 staging 差异，**不报「代码在仓库但从未部署」**：改完代码没跑 deploy，`--check` 也会是干净的。

## APK 打包（GitHub Actions）

- workflow `.github/workflows/build-apk.yml`：单一 job → **自动递增版本**（release 版本与 package.json 相同时 patch+1，构建成功后 `[skip ci]` 提交推送回 main）→ 版本一致性守卫（package/manifest 版本对齐）→ 准备 web 资源（`www/manifest.json` 版本重写为 package.json）+ 从 **CF Pages**（`https://bible-study-7rb.pages.dev/data`）下载 data（books/text/notes/xrefs/**outlines/lr-titles/persons** + lifereading + books/ + morning/；curl 加固：`--retry-all-errors -4`；**lifereading 缩写为中文，URL 须百分号编码——CF 对非 ASCII 路径 400，Vercel 当年自动容忍**，编码值只用于 URL、本地文件名仍用原文；**全部下载按 JSON 内容校验**——CF SPA fallback 让缺失路径也回 200 HTML，http_code 守卫与 `-f` 全失效，见「部署（Cloudflare Pages）」节；**顶层清单是硬编码文件名列表——新增 data/*.json 必须同步加进这一行，否则 APK 静默缺该文件**：前端取数失败多为降级不报错，如漏 persons.json 则人名链接在 APK 内整体消失）→ `npm install` → `cap add android` → `cap sync` → `capacitor-assets generate`（图标）→ `scripts/patch-android.mjs`（注入原生更新插件 + **强制改写 signingConfigs.debug 指向固定 keystore**）→ 注入固定 keystore 到 `$HOME/.android/` → gradle 构建 debug APK → 上传 artifact
  - **注意**：APK 数据只来自 CF Pages 部署产物（staging 目录），不在 git 里；改 `data/` 后务必先 `node scripts/deploy.mjs`（同步 staging + 部署），再让 APK 构建拉取，否则 APK 拿不到新数据。
  - **注意**：workflow 的 `run:` 块不要用 heredoc（`<<EOF`）——GitHub 解析会失败导致 push 静默不触发，用 `printf`/`--notes-file` 等替代
- 触发：push 到 **main** 且改动前端文件（`app.js`/`style.css`/`index.html`/`update.js` 等）或 `package.json`/`capacitor.config.json`/`resources/**`/`config/**`/`scripts/patch-android.mjs`；`workflow_dispatch` 手动触发
- `scripts/export.py` 改动**不触发** APK 构建（数据走「重跑导出 → `node scripts/deploy.mjs` → APK 下次构建拉新数据」）
- 产出单一 APK（appId `com.allday.biblestudy`，云同步为运行时可选功能）
- **发版流程（版本号自动升级）**：push 触发构建时若 release 版本与 package.json 相同则**自动 patch+1**（构建成功后 `[skip ci]` 提交推送，不二次触发），手动改版本号优先；跨 minor 发版仍可用 `.github/workflows/release-bump.yml`（workflow_dispatch 填 `x.y.z`）显式指定；release 标题「读经 v{version} · 云同步版」，notes 自动取最近 8 条提交。**用户可见功能发布时须在 app.js `CHANGELOG` 顶部补一行**（帮助页「最近更新」与更新弹窗「本次更新」的唯一来源，见「使用帮助」节）
- **签名**：固定 debug keystore 提交在 `config/android/debug.keystore`（JKS，alias `androiddebugkey`，密码 `android`），`patch-android.mjs` 强制改写 `signingConfigs.debug` 指向它（绝对路径+密码），保证**每次构建签名一致**——覆盖安装/App 内更新不丢本地数据；**无上架需求，不配 release 签名**——产物仅限自装/小范围安装测试
- JS 质量门槛：`.github/workflows/check-js.yml` 在改动 JS/JSON 时 `node --check` 全量检查（几秒），语法错误先于 APK 构建拦截

## 测试与 Git 钩子

- **理念**：不要求每次小改动手跑测试。`pre-commit` 只做快速质量门（几秒），全量浏览器测试放到 `pre-push`（push 只在部署时发生）
- **pre-commit**（`scripts/git-hooks/pre-commit`）：`node --check` 全量 JS/JSON（镜像 check-js.yml）+ `sync2-test.js` 无浏览器同步单测；失败则阻止 commit（`--no-verify` 可跳过）
- **pre-push**（`scripts/git-hooks/pre-push`）：调 `scripts/run-all-tests.sh` 全量跑 30 个测试（并发 4 泳道，约 3–4 分钟），失败则阻止 push（部署前置保证）
- **安装**：`bash scripts/install-hooks.sh` 复制到 `.git/hooks/`（本地配置不入库；新 clone 需重装）
- **run-all-tests.sh（并发版，2026-10-27）**：确保 8765 服务器（无则临时启动，退出时清理）→ **4 泳道并发**（LANE_DATA=books-data-test 纯 node 磁盘扫描独走，不起浏览器不占端口；浏览器测试 LANE_B/C/D 三等分，按 2026-10-27 实测时长静态 LPT 装箱）→ 输出解析判定（非零退出 或 含 `✗`/`FAIL ` /`JS 错误: [` 判失败，因为测试断言失败不设退出码）。**同泳道=串行**：共用专属端口的测试必须同泳道（8766→drawer/ref-link/update-logic 在 B；8768→copy-citation/lr-module 在 C）；8765 为 runner 共享服务器，测试自 spawn 绑定失败后静默复用、退出 kill 已死进程，并发安全。**失败早停**默认开（`FASTFAIL=0` 关闭）：任一测试失败后各泳道跑完手头测试即停，汇总列出未运行数。**新增测试**：挑当时最短的浏览器泳道追加；与现有测试共用端口则必须进那条泳道。`SKIP="home-test …"` 可跳过
- **并发竞态教训（2026-10-27，两层机制）**：① **点击早于 init 收尾**——测试在 reload/goto 后固定 sleep（或不等）就点首页块，而 `waitForSelector('#homeGrid .home-block')` 命中只说明 `renderHome`+`showHome` 已跑，真正的尾部动作是随后的 `selectBook()`（覆写 crumb + renderStudy/renderDrawer 重渲染）与 `initRoute` 路由就位，会把测试刚进入的模块/屏幕态掀掉。修法=点首页块前 `waitForFunction` 等 `#splash.hidden`（router-test 的 `waitSplashGone` 模式），已加固 7 处：notes-module（2 处）/audio/topic/lr-module-annotation/book-reader/morning-reader/bookhub。② **「条目出现」≠「模块 enter 完成」**——notes 的 `enter()` 要拉书报索引/元数据/听抄索引（高负载下可 >10s），期间 `ensureBookSeriesIndex` 的元数据预取补渲染回调（app.js 4759：`activeModule==='notes'` 时直调 `renderNotesTree/renderNotesList`）会先把树和列表渲染出来，`waitForSelector('.notes-item')` 因此提前命中，而 `renderCrumb`/`syncRoute` 还没跑（现场指纹：crumb 停在 init 写的书卷名、hash 为空、事件日志零 crumb 变更）。修法=等复合条件（crumb === '笔记管理' 且条目 >0，30s 超时）。**写新测试的通用原则**：模块就绪要等「状态性信号」（crumb/tab/URL），别只等「内容出现」
- **⚠️ 8765 遗留服务器会让测试静默作废**：各测试脚本自行 spawn 8765（端口被占则 spawn 静默失败、复用现有服务器）——若遗留服务器工作目录不是本项目根（或是旧快照），测试会默默跑在旧代码上、结果全部作废（2026-09-11 实际发生）。跑测试前先抽查：`curl -s localhost:8765/app.js | grep -c <新改动特有标识符>`，不匹配就清掉遗留进程重跑

## 交互式调试（chrome-devtools MCP，可选）

puppeteer 脚本是确定性回归质量门，**不替代**；需要「看画面 / 查 Console / 查 Network / 抓性能 trace」时用 Chrome 官方 `chrome-devtools-mcp`（工具名 `mcp__chrome-devtools__*`：`new_page`/`take_snapshot`/`click`/`take_screenshot`/`list_console_messages`/`list_network_requests`/`performance_start_trace` 等）。

- **安装（本机一次性，user 作用域 `~/.codebuddy/.mcp.json`，不入库）**：`codebuddy mcp add --scope user chrome-devtools -- npx -y chrome-devtools-mcp@latest --workspace=<项目绝对路径>`（本项目已装，参数 `--workspace=D:/coder/aiWorkSpace/bible-study`）
- **`--workspace` 决定截图 `filePath` 可写范围**：不配时仅系统 temp 可写，项目内路径会被拒（`not within any of the configured workspace roots`）；**不传 `filePath` 时图片直接内联返回，agent 可直接看图——推荐用法**
- **MCP 工具列表在会话启动时固定**：安装完 / 改完参数必须**新会话**才生效
- **运行环境限制（2026-09-10 用户实测）**：CodeBuddy CLI（cmd 终端）可用；**Zed 面板不行**——读不了图，MCP 也可能调不起来。**实测没有可靠的环境变量可用于判断当前环境**（cmd 不设标记，Bash 工具里 `env` 基本为空），所以**不要靠环境变量猜，靠能力自检**：`take_screenshot` 不带 `filePath` 能拿到可读图片 = 可用；拿不到就退回 puppeteer 脚本或纯 CLI（`npx -y -p chrome-devtools-mcp@latest chrome-devtools <tool> --output-format=json`，默认 headless + isolated）
- **本地调试无需再注入 `BIBLE_SKIP_UPDATE`**（localhost 浏览器启动静默检查已自动跳过，见「App 内更新」）；写测试断言时仍按原样设 `window.BIBLE_SKIP_UPDATE = true`
- **移动端模拟**：用 `mcp__chrome-devtools__emulate` 的 `viewport`（`<宽>x<高>x<DPR>[,mobile][,touch]`）+ `userAgent`，一次下发即等价完整的设备预设（CDP `Emulation.setDeviceMetricsOverride`，与 DevTools 的 Ctrl+Shift+M 设备工具栏同一机制）。**两者会互相覆盖**：若 DevTools 里手动开了设备工具栏，其预设会把 MCP 下发的尺寸顶掉（2026-09-10 实测：下发 390×844/1280×800 后页面仍读回工具栏的 430×932 iPhone）——**二选一**，或改为「先读 `innerWidth`/UA 实际值再断言」。项目 `isMobile()` 是纯 `innerWidth <= 900`（不嗅探 UA），故宽度到位即进移动模式
- **测量带动画的界面必须先禁用过渡**：MCP 控制的页面不产生帧时 CSS `transition` 不推进，`getBoundingClientRect`/`getComputedStyle` 读到的是**过渡起始值**（2026-09-11 实测：切换编辑形态后等 900ms 仍读回 `translateY(100%)`，连续几轮误判「面板没打开 / 适配没生效」）。测量前先注入 `*{transition:none!important;animation:none!important}` 再读，拿到确定性目标值；同理，`panel`/`drawer` 的 `.open` 类切换后不要靠 sleep 等动画结束
- **清理**：CLI 模式用完 `chrome-devtools stop`，避免遗留 headless Chrome 进程

## 修改守则

- 数据源只在 `scripts/export.py`，不得在 app.js 里硬编码圣经数据
- 标注/笔记存储结构改前先看 `app.js` 的 localStorage 键定义
- 颜色语义（c1-c5）是产品约定，改色不改义
- 云同步改动改 `sync.js` + `app.js` 的 `save()`/`syncFromRemote()`；KV key 约定见「云同步」节
- **路由**：URL ↔ 视图同步统一走「路由」节机制——新增导航入口在函数尾部调 `syncRoute()`；不要在别处直接读写 `location.hash`/`history`（push/replace 语义由容器比较决定）
- **agent 产出的图片（UI 原型图、对比图、截图等）统一放 `generated-images/`**（已 gitignore），不得散落在项目根或其他目录（2026-10-10 清理 case/ 时立的规矩，防杂项再堆积）

## 文档同步协议（强制）

### 每个任务开始前

1. 阅读根目录 `AGENTS.md`。
2. 检查 `git status --short` 和真实代码，不得仅凭文档推断当前状态。
3. 任务清单最后一项必须是：`检查并同步 AGENTS.md`。

本协议同样约束 `docs/FEATURES.md`（功能全景文档，基于代码梳理）：凡用户可见的功能行为变化（模块交互、标注/笔记能力、导航抽屉等）须同步该文档对应小节；纯内部重构不用。

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
