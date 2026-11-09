# v1.0.70 发布交接单（2026-11-04 起）

> 状态：代码已推送 `main`（`adb90fb`），**数据待重导、版本待发布**。
> 本单是自包含的操作手册——照着从头跑一遍即可发版，不需要回读之前的会话记录。

## 0. 交接时的事实快照

| 项 | 值 |
|---|---|
| 代码 | `adb90fb` 已推 origin/main（含护栏修复 + 文档基线刷新） |
| `data/books/` | 停在 **2026-11-03 12:56** 的导出，**已落后于源** |
| bible 源 | 11-04 又进了 43 个提交（乱码修复批次，最新内容提交 04:09；工作区已干净） |
| 版本号 | 1.0.69（`package.json` / `manifest.json` 一致） |
| CHANGELOG | 顶部仍是 1.0.69，未写 1.0.70 |
| 测试 | `books-data-test` **3 个源对照失败**（sg/th/jd，源侧乱码修复造成） |
| 56–61 标注核查 | 未做（需真实设备） |

**为什么必须先重导再发版**：books-data-test 的源对照只覆盖 22 个 legacy 系列。
11-04 的乱码修复还改了 **ni / bio / 福音天地 / 个别 ezoe 篇**——这些没有测试能
发现漂移。不重导就发，网页/APK 会带着过期正文上线。

---

## 1. 确认源侧收口

```bash
cd D:/AIWorkSpace/project/bible && git status --short && git log -3 --oneline -- data/raw/spiritual_food
```

- 工作区必须干净；确认没有「还在修」的批次。
- 若还有未提交/进行中的整理，**等它收口再往下走**，否则重导要重来。

## 2. 全量重导（32 系列全跑，别挑系列）

```bash
cd D:/AIWorkSpace/project/bible-study
python scripts/export-spiritual.py            # 内容
python scripts/export-spiritual.py --numbers  # 书号表
```

- 追加感知机制保证：老书按旧（卷,位置）原位、新书追加卷末、源库丢书从旧导出
  splice 回原位——**未变系列逐字节不变，索引不漂移**。全量跑是安全的，也是唯一
  能覆盖 ni/bio/福音天地/ezoe（无源对照）的办法。
- **退出码判定**（2026-11-04 起两级）：
  - `0`：正常。留意 stdout 的 `[APPEND]`（新增书，预期为 0 或与源侧新增一致）
  - `2`：软失败（丢书 splice / 卷数收缩 / 结构异常）——看 `[WARN]/[ERR]` 行，
    确认无碍后 `--allow-loss` 重跑放行
  - `3`：**硬中止**（旧导出 `{id}.json` 读取失败）——本系列文件未写出、损坏文件
    保留原样；从备份恢复该文件后重跑，**`--allow-loss` 不可放行**
- 跑完做计数核对（源侧若没新增书，应与下表一致）：

| 指标 | 期望 |
|---|---|
| 系列数 | 32 |
| 书总数 | 1041（源侧新增则按 `[APPEND]` 累加） |
| 章总数 | 17054 |
| numbers.json | 9 系列 / 620 本 |
| 最大单文件 | zj-2.json ≈ 24.4MiB（**CF 上限 25MiB，余量 2%**） |

## 3. 重跑纲目校验（**不要跳过**）

乱码修复动了部分章标题与正文，策展纲目按「文本行必须存在」逐条校验：

```bash
python scripts/build-book-outlines.py
```

- 任何校验失败会**删除该系列旧产物**（防静默发错纲目）——必须逐条看失败原因：
  - 标题行被修字（如 `008第八篇` 标题修正）→ 改 `scripts/outline-src/{系列}.json`
    对应条目后重跑
  - 整章墓碑化/位移 → 参照 `8e87f2f` 的做法（显式置空 / 按正文哈希重映射）
- 预期基线：48 个辑文件 / 15344 章 / 12271 有纲目 / 3073 显式空（有变动属正常，
  但每个变动都要能解释）。

## 4. 测试门

```bash
cd scripts && node books-data-test.js; echo "EXIT=$?"     # 必须 0，且输出无 ✗
cd .. && bash scripts/run-all-tests.sh                   # 27 项全量，4 泳道约 4 分钟
```

- **别用 `| tail` 看结果**：管道会让 `$?` 变成 tail 的退出码，`✗` 行还会被截掉
  （2026-11-03 两路 CR 代理都栽在这上面）。要判失败看输出里的 `✗` / `FAIL ` 字样。
- 浏览器测试依赖本地服务器：脚本会在 127.0.0.1:8765 起服务；确认 8765 上没有
  遗留的旧服务器（否则会在旧代码上假通过）。`SKIP="home-test …"` 可跳项。
- `audio-test` 的真实播放项需要访问 OSS，离线失败属环境依赖。

## 5. 真实设备核查旧标注（要人做）

发布前必须确认《生命的意义》旧索引 **56–61** 上没有用户标注（这 6 章是唯一位移）：

1. 在手机上用正式域名打开 App（数据更新前/后都行，读的是 localStorage）
2. 浏览器控制台（或 APK 调试模式）粘贴 `generated-images/check-life-meaning-shift.js`
   全部内容执行（**该文件未入库**，只在本地工作区；丢了可按下面逻辑重写：
   遍历 `bible-study.annotations`，筛 `series==='gospel' && book===67 &&
   chapter ∈ [56..61]`，打印条数与文本快照）
3. 有命中 → 做章级迁移（旧 56–60 → 新 58/62/75/103/107，旧 61 → 新 109），
   不能靠文本自愈兜底；无命中 → 放行

另注：30 本 absorbed 书的 131 章正文已换成墓碑指引，这些章上的旧标注只会显示
「（原文缺失）」（正版在福音天地，需重新划线）。属已知可接受项，发布说明里可提。

## 6. 升版 + CHANGELOG

1. `package.json` 与 `manifest.json` 的 `version` **同步**改 `1.0.70`
2. `app.js` 顶部 `CHANGELOG` 数组最前面加一条，用户语气、面向行为而非实现，参考：

```
{ v: '1.0.70', date: '2026-11-04', items: [
  '书报新增 69 本书（补抓入库），部分重复篇目合并到专门的文集，点开会告诉你该去哪读',
  '书报纲目更准了：章节小标题按层级列出，点一下跳到那一节',
  '书号搜索统一为出版物原编号，更稳定',
] },
```

3. 跑一次 `node --check app.js` 与 `bash scripts/run-all-tests.sh`（`help-test`
   会校验 CHANGELOG 展示）

## 7. 部署 → push → APK（**顺序不能反**）

```bash
node scripts/deploy.mjs --check     # 干跑：看差异清单，确认没有 staging 残留
node scripts/deploy.mjs             # 部署到 Cloudflare Pages（约 4 分钟）
git push origin main                # 触发 build-apk.yml 云构建 APK
```

- **先部署再 push**：APK 构建时从 CF Pages 拉 `data/`，顺序反了 APK 会打进旧数据。
- push 前 pre-push 会跑全量测试（4 泳道约 4 分钟），第 4 步应已绿；红的不要
  `--no-verify`（这次跳过只是因为有已确认的源漂移）。
- APK 由 `build-apk.yml` 云构建，滚动发布到 release tag `bible-study-main`；
  也可 GitHub Actions 手动 `workflow_dispatch`。
- 部署后抽查（换 `?nocache` 或新端口，防 SW/HTTP 缓存回旧文件）：
  `https://study.duoban.xyz/data/books/index.json` 与任一 `{系列}-{辑}.json` 的
  书数、以及新抓书的正文能读到。

## 8. 已知遗留（不阻断发布，别顺手改）

| 项 | 说明 |
|---|---|
| `--numbers` 子集覆写 | `python export-spiritual.py sg --numbers` 会用单系列冲掉整张 numbers.json；「只想动四系列」的自然调用会产出空表。要么加合并/拒绝逻辑，要么全量跑 |
| zj-2.json 拆卷 | 24.4MiB，余量 2%。造就类再追加大书即部署失败；拆卷须与写死分卷边界+追加感知协同设计，**不能按体积动态切** |
| 旧导出残留 num 守卫 | 异机/备份恢复场景下 legacy 系列旧文件若还带 num，身份匹配会错位（当前磁盘已验证干净） |
| 源对照覆盖缺口 | books-data-test 只比对 22 个 legacy 系列；ni/slat/bio/fuyintiandi/ezoe 无源对照，漂移只能靠全量重导兜底 |
| 灵粮序号已移除 | sg/th/jd/xyzl 的目录序号不再进书号表、搜索不再命中——这是正确性修复，已随本批生效 |

## 9. 审批口径

`deploy`、`push`、`升版本`、`触发 APK` 四个动作仍需用户明确许可后执行；
本单只描述步骤，不构成授权。
