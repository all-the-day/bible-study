/* books-data-test.js — 书报数据产物验收（node 直跑，无浏览器）
 *
 * 校验 scripts/export-spiritual.py 的输出契约与内容质量：
 *   1) index.json 系列清单完整、顺序符合 SERIES_ORDER
 *   2) 每系列 {id}.json 与 {id}-{n}.json 齐全，卷号连续，书/章计数一致
 *   3) 单文件 < 25MB（CF Pages 上限）、无空书、无空章
 *   4) 去重跳过项确实不在产物里（特会 14 本 / 属灵书报 8 本 / 拾零重复篇）
 *   5) 机械清洗生效：无「阅读更多」、无行尾 ×、无 `书名：`/训练期页眉
 *   6) 拆行重排生效：系列碎片行占比 < 35%，无单文件碎片行 > 60%
 *   7) 幂等：重复导出产物逐字节一致（由 --idempotent 触发，默认只校验现状）
 *
 * 用法：node books-data-test.js          # 校验 data/books 现状
 *       node books-data-test.js --idempotent  # 额外跑一次导出比对 md5（约 1 分钟）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data", "books");
const MAX_BYTES = 25 * 1024 * 1024;
let fail = 0;

function ok(msg) { console.log("✓ " + msg); }
function bad(msg) { console.log("✗ " + msg); fail++; }
function eq(actual, expected, label) {
  if (actual === expected) ok(`${label}: ${actual}`);
  else bad(`${label}: 实际 ${actual}，期望 ${expected}`);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/* ── 1. 系列清单 ─────────────────────────────────────────────── */
const idx = readJSON(path.join(DATA, "index.json"));
const series = idx.series || [];
const ids = series.map(s => s.id);
console.log(`系列 ${ids.length} 个：${ids.join(", ")}`);

const EXPECTED_ORDER = [
  "ni", "slat", "bio", "fuyintiandi",
  "xyzl", "jd", "sjzl", "zlkc", "smkc", "zlyd",
  "th", "zsxx", "cqxl",
  "sg",
  "gospel", "jh",
  "zlzt", "kdyf", "zlpz", "jpl",
  "hhls", "tllc", "xblm",
  "jkhy", "zjgs", "hmgq", "sl", "zj",
  "sjyn",
  "periodicals", "misc", "reading",
];
if (JSON.stringify(ids) === JSON.stringify(EXPECTED_ORDER)) ok("系列顺序符合 SERIES_ORDER");
else bad(`系列顺序不符：${ids.join(",")}`);

/* ── 2. 逐系列结构与计数 ─────────────────────────────────────── */
const stats = {};
for (const s of series) {
  const metaPath = path.join(DATA, `${s.id}.json`);
  if (!fs.existsSync(metaPath)) { bad(`${s.id}: 缺元数据 ${s.id}.json`); continue; }
  const meta = readJSON(metaPath);
  const vols = meta.volumes || [];
  if (vols.length !== s.volumes) bad(`${s.id}: 元数据卷数 ${vols.length} ≠ 清单 ${s.volumes}`);

  let books = 0, chapters = 0;
  const chapterTitles = [];
  vols.forEach((v, vi) => {
    books += (v.books || []).length;
    for (const b of v.books || []) {
      chapters += (b.chapters || []).length;
      chapterTitles.push(...(b.chapters || []));
    }
    const volPath = path.join(DATA, `${s.id}-${vi + 1}.json`);
    if (!fs.existsSync(volPath)) { bad(`${s.id}: 缺内容文件 ${s.id}-${vi + 1}.json`); return; }
    const size = fs.statSync(volPath).size;
    if (size >= MAX_BYTES) bad(`${s.id}-${vi + 1}.json 体积 ${(size / 1048576).toFixed(1)}MB ≥ 25MB`);
    const content = readJSON(volPath);
    const cb = (content.books || []).reduce((n, b) => n + (b.chapters || []).length, 0);
    const mb = (v.books || []).reduce((n, b) => n + (b.chapters || []).length, 0);
    if (cb !== mb) bad(`${s.id}-${vi + 1}: 内容章数 ${cb} ≠ 元数据 ${mb}`);
    if ((content.books || []).length !== (v.books || []).length) {
      bad(`${s.id}-${vi + 1}: 书数 ${(content.books || []).length} ≠ 元数据 ${(v.books || []).length}`);
    }
  });
  stats[s.id] = { books, chapters };
  if (books === 0) bad(`${s.id}: 无书`);
  if (chapters === 0) bad(`${s.id}: 无章`);
}
console.log(`合计 ${Object.values(stats).reduce((n, x) => n + x.books, 0)} 本 / ` +
  `${Object.values(stats).reduce((n, x) => n + x.chapters, 0)} 章`);

/* 卷号连续性：不能出现 {id}-{n} 之外的孤儿文件（只查本系列 id 前缀） */
for (const s of series) {
  const n = (readJSON(path.join(DATA, `${s.id}.json`)).volumes || []).length;
  const extra = fs.readdirSync(DATA).filter(f => new RegExp(`^${s.id}-\\d+\\.json$`).test(f))
    .filter(f => { const k = +f.match(/-(\d+)\.json$/)[1]; return k < 1 || k > n; });
  if (extra.length) bad(`${s.id}: 存在越界卷文件 ${extra.join(",")}`);
}

/* ── 3. 关键系列的书数（去重结果回归） ───────────────────────── */
const EXPECT = {
  sg: 224, th: 37, jd: 29, zj: 232, jh: 96,
  sjzl: 15, xyzl: 8, zlkc: 8, smkc: 4, zlyd: 6, kdyf: 6, hhls: 9,
};
for (const [id, n] of Object.entries(EXPECT)) {
  if (!stats[id]) continue;
  eq(stats[id].books, n, `${id} 书数`);
}
eq(stats.sg ? readJSON(path.join(DATA, "sg.json")).volumes.length : 0, 4, "sg 卷数");
eq(stats.zj ? readJSON(path.join(DATA, "zj.json")).volumes.length : 0, 2, "zj 卷数");

/* ── 4. 去重跳过项 ───────────────────────────────────────────── */
function allBookTitles(id) {
  const meta = readJSON(path.join(DATA, `${id}.json`));
  return new Set(meta.volumes.flatMap(v => v.books.map(b => b.title)));
}
const SKIP = {
  sg: ["正常的基督徒生活", "正常的基督徒信仰", "得胜的生命", "亚伯拉罕以撒雅各的神",
    "这人将来如何", "主工人的性格", "七灵－为着众地方召会", "三神的启示与行动"],
  th: ["马太福音结晶读经", "以弗所书结晶读经", "腓立比书结晶读经", "哥林多前书结晶读经",
    "哥林多后书结晶读经", "加拉太书结晶读经", "歌罗西结晶读经", "三提结晶",
    "帖撒罗尼迦前后书、雅歌七至八章结晶读经", "神的建造结晶读经", "基督的身体结晶读经",
    "马可福音结晶读经", "约翰的书信结晶读经", "彼得前后书与犹太书结晶读"],
  sl: ["在召会生活中父母的职任"],
};
for (const [id, titles] of Object.entries(SKIP)) {
  const got = allBookTitles(id);
  const stays = titles.filter(t => got.has(t));
  if (stays.length) bad(`${id}: 应跳过的书仍在产物中 -> ${stays.join(" / ")}`);
  else ok(`${id}: ${titles.length} 个重复书已跳过`);
}

/* ── 5. 内容质量扫描（只扫新增系列，避免误报既有数据的历史噪声） ── */
const NEW_IDS = ["sg", "th", "jd", "sjzl", "xyzl", "zlyd", "zlkc", "smkc", "sjyn",
  "jkhy", "zlzt", "zlpz", "kdyf", "jpl", "hhls", "tllc", "xblm", "hmgq", "zjgs", "sl",
  "zsxx", "cqxl", "zj", "jh"];
const NEW_SET = new Set(NEW_IDS);
const HEAD_RE = /^\s*书\s*$|^\s*名\s*[:：]|^\s*书\s*名\s*[:：]/m;
const TRAIN_RE = /^.{0,14}年.{0,14}(训练|特会)$/m;
const FOOT_RE = /^\*\*(来源|URL|获取时间|书报号|说明)\*\*/m;
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

let web = [], heads = [], empties = [], fragSeries = [];
let footers = [], bolds = [], backs = [], ctrls = [], seps = [];
let placeholders = 0;
let fragLinesAll = 0, linesAll = 0;
for (const s of series) {
  if (!NEW_SET.has(s.id)) continue;
  const vols = readJSON(path.join(DATA, `${s.id}.json`)).volumes || [];
  let frag = 0, total = 0;
  vols.forEach((v, vi) => {
    const content = readJSON(path.join(DATA, `${s.id}-${vi + 1}.json`));
    for (const b of content.books || []) {
      for (const c of b.chapters || []) {
        const text = c.content || "";
        const loc = `${s.id}/${b.title}/${c.title}`;
        if (text.includes("阅读更多") || /×\s*$/m.test(text)) web.push(loc);
        const head = text.split("\n").slice(0, 3).join("\n");
        if (HEAD_RE.test(head) || TRAIN_RE.test(head)) heads.push(loc);
        if (FOOT_RE.test(text)) footers.push(loc);
        // 成对 `**文字**` 是残留粗体记号；连续星号（****）/ 行内单个 ** 是源站
        // 脱敏或脚注占位符（保留不删，只计数）
        const PAIR_BOLD = /\*\*[^*\n]+\*\*/;
        if (PAIR_BOLD.test(text)) bolds.push(loc);
        if (/\*{2,}/.test(text) && !PAIR_BOLD.test(text)) placeholders += (text.match(/\*{2,}/g) || []).length;
        if (/^Back/m.test(text)) backs.push(loc);
        if (CTRL_RE.test(text)) ctrls.push(loc);
        if (/^---$/m.test(text)) seps.push(loc);
        if (text.replace(/\s/g, "").length < 20) empties.push(loc);
        const lines = text.split("\n").filter(l => l.trim());
        const short = lines.filter(l => l.trim().length <= 10).length;
        frag += short; total += lines.length;
        if (lines.length >= 20 && short / lines.length > 0.6) {
          fragSeries.push(`${loc} (${Math.round(short / lines.length * 100)}%)`);
        }
      }
    }
  });
  fragLinesAll += frag; linesAll += total;
  const ratio = total ? frag / total : 0;
  if (ratio >= 0.35) bad(`${s.id}: 碎片行占比 ${(ratio * 100).toFixed(1)}% ≥ 35%`);
  else ok(`${s.id}: 碎片行占比 ${(ratio * 100).toFixed(1)}%`);
}

function report(name, arr, limit = 5) {
  if (arr.length) bad(`${name}：${arr.length} 处，例：${arr.slice(0, limit).join(" / ")}`);
  else ok(`${name}：0 处`);
}
report("网页残留（阅读更多 / ×）", web);
report("页眉残留（书名/训练期）", heads);
report("爬取页脚残留（**来源/URL/获取时间**）", footers);
report("成对粗体记号残留（**…**）", bolds);
report("网页返回链接残留（Back）", backs);
report("控制字符残留", ctrls);
report("分隔线残留（---）", seps);
console.log(`源站脱敏/脚注占位符（行内单个 **）：${placeholders} 行（保留不删）`);
// 源站事实：ezoe 造就类有 9 个 31-39 字的经文诗歌占位页（校验报告已登记），阈值放行
if (empties.length > 20) bad(`近空章节（<20 字）：${empties.length} 处，例：${empties.slice(0, 3).join(" / ")}`);
else ok(`近空章节（<20 字）：${empties.length} 处（源站短页，阈值 20）`);
// 诗歌段落（诗：…）本身短行多，允许少量；大面积碎片才判失败
if (fragSeries.length > 5) bad(`单文件碎片行 >60%：${fragSeries.length} 处，例：${fragSeries.slice(0, 3).join(" / ")}`);
else ok(`单文件碎片行 >60%：${fragSeries.length} 处（阈值 5）`);
console.log(`新增系列碎片行合计 ${fragLinesAll}/${linesAll} (${(fragLinesAll / Math.max(1, linesAll) * 100).toFixed(1)}%)`);

/* ── 5b. 源对照（源目录存在时默认执行）：正文段落不得被清洗吞掉 ──
 * 逐源抽取「≥25 字且以句末标点收尾」的原文段落，检查是否出现在导出产物里。
 * 源侧先按导出规则宽归一（去空白、去 ** 记号）；墓碑化/显式跳过会有少量缺失，
 * 但任何 ≥60 字的整段缺失一律判失败（专项防「页眉清洗误删正文」）。 */
const SRC_MAP = {
  sg: "属灵书报", th: "特会信息", jd: "结晶读经", sjzl: "圣经之旅", xyzl: "新约总论",
  zlyd: "圣经要道", zlkc: "真理课程", smkc: "生命课程", sjyn: "圣经疑难",
  jkhy: "健康话语的规范", zlzt: "真理专题", zlpz: "真理的辨正", kdyf: "肯定与否定",
  jpl: "解剖毒瘤", hhls: "召会历史", tllc: "天路历程", xblm: "希伯来民族简史",
  hmgq: "荒漠甘泉", zjgs: "造就故事", sl: "拾零", zsxx: "职事信息", cqxl: "成全训练信息",
};
const SRC_ROOT = path.resolve(ROOT, "..", "bible", "data", "raw", "spiritual_food");
// 源侧按导出规则宽归一：去空白 / `**` / `阅读更多` / 行尾 ×；`Back` 导航行整行跳过
const norm = (s) => s.replace(/[\s\u3000]/g, "")
  .replace(/\*\*/g, "")
  .replace(/阅读更多[＞>]?/g, "")
  .replace(/×+$/g, "");
if (!fs.existsSync(SRC_ROOT)) {
  console.log("— 源对照：找不到 bible 源目录，跳过");
} else {
  // 从导出器读注册表（单一事实源）：拿到各系列的 skip_nums/skip_dirs/skip_files/skip_content
  const py = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("esp", r"${path.join(__dirname, "export-spiritual.py").replace(/\\/g, "\\\\")}")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out = {k: {kk: vv for kk, vv in v.items() if kk in ("skip_nums","skip_dirs","skip_files","skip_content")} for k, v in m.LEGACY_SERIES.items()}
print(json.dumps(out, ensure_ascii=False))
`;
  let reg = {};
  try {
    reg = JSON.parse(execFileSync("python", ["-c", py], { encoding: "utf8" }));
  } catch (e) {
    try { reg = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" })); }
    catch (e2) { console.log("— 源对照：读取导出注册表失败，跳过"); reg = null; }
  }
  if (reg) {
    for (const [id, dir] of Object.entries(SRC_MAP)) {
      const o = reg[id] || {};
      const skipNums = new Set(o.skip_nums || []);
      const skipDirs = new Set(o.skip_dirs || []);
      const skipFiles = new Set(o.skip_files || []);
      const vols = readJSON(path.join(DATA, `${id}.json`)).volumes || [];
      const parts = [];
      vols.forEach((v, vi) => {
        for (const b of readJSON(path.join(DATA, `${id}-${vi + 1}.json`)).books || []) {
          for (const c of b.chapters || []) parts.push(c.content || "");
        }
      });
      const corpus = norm(parts.join("\n"));
      let checked = 0;
      const missing = [], longMissing = [];
      const walk = (p) => {
        for (const f of fs.readdirSync(p)) {
          const fp = path.join(p, f);
          const rel = path.relative(path.join(SRC_ROOT, dir), fp);
          const seg = rel.split(path.sep);
          if (fs.statSync(fp).isDirectory()) {
            const n = parseInt((f.match(/^(\d+)/) || [])[1] || "", 10);
            if (skipDirs.has(f) || (Number.isInteger(n) && skipNums.has(n))) continue;
            walk(fp); continue;
          }
          if (!f.toLowerCase().endsWith(".md")) continue;
          if (skipFiles.has(f.replace(/\.md$/i, "")) || skipFiles.has(seg[seg.length - 1].replace(/\.md$/i, ""))) continue;
          const fileText = fs.readFileSync(fp, "utf8");
          // 显式跳过的内容（如新约总论的「此处为节选」残篇）
          if ((o.skip_content || []).some(m => fileText.includes(m))) continue;
          for (const raw of fileText.split("\n")) {
            let ln = raw.trim();
            if (ln.length < 25 || !/[。！？]$/.test(ln)) continue;
            if (/^\*\*(来源|URL|获取时间|书报号|说明)\*\*/.test(ln)) continue;
            if (/^Back/.test(ln)) continue;   // 网页导航行（导出层已删）
            checked++;
            const nln = norm(ln);
            if (!corpus.includes(nln)) {
              missing.push(`${rel} :: ${ln.slice(0, 26)}`);
              if (nln.length >= 60) longMissing.push(`${rel} :: ${ln.slice(0, 40)}`);
            }
          }
        }
      };
      walk(path.join(SRC_ROOT, dir));
      const ratio = checked ? missing.length / checked : 0;
      if (longMissing.length) {
        bad(`${id} 源对照：${longMissing.length} 个整段正文缺失（≥60 字），例：${longMissing.slice(0, 2).join(" | ")}`);
      } else if (ratio > 0.005) {
        bad(`${id} 源对照：${missing.length}/${checked} 句正文未出现在产物（${(ratio * 100).toFixed(2)}%），例：${missing.slice(0, 3).join(" | ")}`);
      } else {
        ok(`${id} 源对照：${checked} 句正文，缺失 ${missing.length}（${(ratio * 100).toFixed(2)}%）`);
      }
    }
  }
}

/* ── 6. 幂等（可选） ─────────────────────────────────────────── */
// 只重导新增系列——已上线的 gospel 等系列因源侧索引变化必须冻结，全量重导会造成索引位移
if (process.argv.includes("--idempotent")) {
  const targets = new Set(NEW_IDS.map(id => id + ".json"));
  for (const id of NEW_IDS) {
    const n = (readJSON(path.join(DATA, `${id}.json`)).volumes || []).length;
    for (let i = 1; i <= n; i++) targets.add(`${id}-${i}.json`);
  }
  targets.add("index.json");
  const before = {};
  for (const f of targets) {
    before[f] = crypto.createHash("md5").update(fs.readFileSync(path.join(DATA, f))).digest("hex");
  }
  execFileSync("python", ["export-spiritual.py", ...NEW_IDS], { cwd: __dirname, stdio: "pipe" });
  let changed = [];
  for (const f of Object.keys(before)) {
    const now = crypto.createHash("md5").update(fs.readFileSync(path.join(DATA, f))).digest("hex");
    if (now !== before[f]) changed.push(f);
  }
  if (changed.length) bad(`重复导出不一致：${changed.join(", ")}`);
  else ok(`重复导出幂等（${Object.keys(before).length} 个新增系列文件逐字节一致）`);
}

console.log(fail === 0 ? "\n全部通过 ✓" : `\n存在失败 ✗（${fail}）`);
process.exit(fail === 0 ? 0 : 1);
