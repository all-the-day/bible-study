#!/usr/bin/env python3
"""机械扫描书报各章「开头」异常（2026-10-20 首版）。

针对 data/books/*.json 的全部 32 系列章节正文开头，检出用户可见的编排/残留问题：

  A 书名拆行页眉   章首是「书 / 名： / 书名」三行（前端只整行匹配书名，前两行会渲染出来）
  B 作者/讲者行    章首泄漏「作者：X」「讲者：X」「X 著」「X 译」
  C 目录页成章     整章内容就是源站目录页（首行 目录/目　录，后跟章节标题清单）
  D 目录页码柱     章首连续 ≥5 行裸数字（源站两栏目录摊平后页码柱前置）
  E 目录清单泄漏   章首 ≥3 行短行命中同书其他章标题（或单章书整章只有目录清单）
  F 运行页眉泄漏   同书 ≥3 章以同一非标签行开头（文库精选的册内子书名等）
  G 读经行碎裂     「读经：」标签后 ≥3 行 ≤6 字碎片（引用被硬折行撕碎）
  H 半句开头       正文以续行标点起头（篇首读经句被截掉前半）
  I 导航残留       任意行是 上一卷/下一页/Back 等站点导航
  J 桩章节         正文极短且只剩重复标题 / (暂无) / 图片文件名
  K 首行重复再现   首行在正文前 40% 原样再现（标题二次渲染）

正常结构行不算问题：章首「读经：」「纲目：」「祷告：」等标签单独成行、
章首 == 章标题/书名（前端 renderBookContent 会整行跳过）、sg 圣经附录式
「加四19加拉太书四19」经文引用块开头。

用法：python scan-book-openings.py [--id ni ...] [--full]
输出：控制台摘要 + ../book-opening-scan.md 明细
"""
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "books"
TOMB = "（本文"
SHORT = 16
CONT_START = "，。；：、）】》」』%,.;:)]}"
TERMINAL = "。！？；…"
# 正常结构标签（单独成行不算问题）
LABELS = {"读经", "读 经", "读　经", "读经:", "读经：", "纲目", "纲 目", "纲目：", "纲　目：",
          "祷告", "祷告：", "祷告：", "诗歌", "诗歌：", "经文", "读经：", "前言", "序言", "引言",
          "介言", "纲目:", "读经；", "读经:", "诵读", "阅读", "说明", "附注", "总结"}
NAV_RE = re.compile(r"^(上一卷|下一卷|上一课|下一课|上一页|下一页|返回|首页|回目录|Back.*|点击看大图)$")
TOC_HEAD_RE = re.compile(r"^目\s*[录錄]$")
AUTHOR_RE = re.compile(r"^(作者|讲者|译者|著者|校者)\s*[:：]")
STRUCT_RE = re.compile(r"^(?:[壹贰叁肆伍陆柒捌玖拾]+|[一二三四五六七八九十]+|（[一二三四五六七八九十百〇○]+）|（[０-９0-9]+）|[０-９0-9]+)[\u3000 ]")
NUM_ONLY = re.compile(r"^\d{1,3}$")


def key(s):
    return re.sub(r"[\s\u3000'’‘\"「」『』（）()【】《》\[\]]", "", s or "")


def sim(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def lines_of(content):
    return [l.strip() for l in (content or "").split("\n") if l.strip()]


def label_of(line):
    """结构标签行 → 归一化标签名；非标签返回 None"""
    t = line.rstrip("：: ；;").strip()
    return t if t in LABELS else None


def scan_chapter(book, ch):
    title = ch.get("title", "")
    content = ch.get("content") or ""
    lines = lines_of(content)
    issues = []
    if not lines:
        return [("J 桩章节", "content 为空")]
    if content.startswith(TOMB):
        return []
    first = lines[0]
    kt, kb = key(title), key(book.get("title", ""))
    head = lines[:6]

    # A 书名拆行页眉
    if first in ("书", "名", "名：", "书名") or (first == "书" and len(lines) > 1 and lines[1].startswith("名")):
        issues.append(("A 书名拆行页眉", f"章首 {lines[:3]}"))

    # B 作者/讲者行
    for i, l in enumerate(head[:3]):
        if AUTHOR_RE.match(l) or (i < 2 and len(l) <= 12 and re.fullmatch(r".{1,8}(著|译)", l)):
            issues.append(("B 作者/讲者行", f"第{i+1}行 {l[:30]!r}"))
            break

    # C 目录页成章
    if TOC_HEAD_RE.match(first.replace("　", " ")):
        issues.append(("C 目录页成章", f"首行 {first!r}，全章 {len(lines)} 行 / {len(content)} 字"))

    # D 目录页码柱
    nums = 0
    for l in lines:
        if NUM_ONLY.match(l):
            nums += 1
        else:
            break
    if nums >= 5:
        issues.append(("D 目录页码柱", f"开头连续 {nums} 行裸数字"))

    # E 目录清单泄漏
    others = [key(book.get("title", ""))] + [key(c.get("title", "")) for c in book.get("chapters", [])
                                            if c.get("title") and c.get("title") != title]
    others = [o for o in others if o]
    if len(lines) >= 4:
        hit = 0
        for l in lines[:10]:
            kl = key(l)
            if len(kl) <= SHORT and kl and not re.search(r"[。！？；]", l) \
                    and any(kl == o or (len(kl) >= 4 and (kl in o or sim(kl, o) >= 0.8)) for o in others):
                hit += 1
            else:
                break
        if hit >= 3:
            issues.append(("E 目录清单泄漏", f"开头连续 {hit} 行是本书其他章节标题"))
        elif len(book.get("chapters", [])) == 1 and hit == 0:
            # 单章书：开头 ≥3 行短行无句读，且首行在后文原样再现 = 整书目录
            short_run = 0
            for l in lines[:12]:
                if len(l) <= 24 and not re.search(r"[。！？；]", l) and not STRUCT_RE.match(l):
                    short_run += 1
                else:
                    break
            if short_run >= 3 and len(first) >= 6:
                limit = max(2, int(len(lines) * 0.6))
                if any(l == first for l in lines[1:limit]):
                    issues.append(("E 目录清单泄漏", f"开头 {short_run} 行短行无句读，首行在后文再现"))

    # F 运行页眉泄漏（同书 ≥3 章同一非标签、非章/书标题的首行）
    #    在 main() 里聚合判定，这里只记录候选

    # G 读经行碎裂（连续 ≥3 行 ≤6 字 = 引用被硬折行撕碎；
    #   引文被引号折行（如 '“' / 经文 / '”'）另记 G2，轻微）
    if label_of(first) in ("读经", "诵读", "阅读") and len(lines) >= 4:
        run = 0
        for l in lines[1:]:
            if len(l) <= 6:
                run += 1
            else:
                break
        if run >= 3:
            issues.append(("G 读经行碎裂", f"标签后连续 {run} 行 ≤6 字：{lines[1:5]}"))
        elif any(l in ("“", "”", "'", "’") for l in lines[1:4]):
            issues.append(("G2 读经引文折行", f"引文被引号折行：{lines[1:4]}"))

    # H 半句开头
    if first and first[0] in CONT_START:
        issues.append(("H 半句开头", f"首行以「{first[0]}」起头：{first[:30]!r}"))

    # I 导航残留
    for i, l in enumerate(lines[:6]):
        if NAV_RE.match(l):
            issues.append(("I 导航残留", f"第{i+1}行 {l!r}"))

    # J 桩章节
    plain = content.replace("\n", "")
    if len(plain) < 60:
        why = "只剩重复标题" if len(set(lines)) < len(lines) else ("含(暂无)/图片名" if ("暂无" in content or ".jpg" in content) else "正文过短")
        issues.append(("J 桩章节", f"{why}，正文 {len(plain)} 字"))

    # K 首行重复再现
    if len(first) >= 8:
        limit = max(2, int(len(lines) * 0.4))
        again = [i for i, l in enumerate(lines[1:limit], 1) if l == first]
        if again:
            issues.append(("K 首行重复再现", f"首行在第 {again[0]+1} 行原样再现"))

    return issues


def scan_running_headers(all_books):
    """F 运行页眉：同书 ≥3 章以同一非标签、非本章/本书标题的行开头"""
    out = []
    for sid, vol_title, book in all_books:
        firsts = defaultdict(list)
        for ch in book.get("chapters", []):
            lines = lines_of(ch.get("content") or "")
            if not lines or ch["content"].startswith(TOMB):
                continue
            f = lines[0]
            if label_of(f):
                continue
            if f == ch.get("title") or f == book.get("title"):
                continue
            if sim(key(f), key(ch.get("title", ""))) >= 0.9:
                continue
            firsts[f].append(ch.get("title", ""))
        for f, chs in firsts.items():
            if len(chs) >= 3:
                out.append((sid, vol_title, book.get("title", ""), f, len(chs), chs[:3]))
    return out


def main():
    args = sys.argv[1:]
    only = []
    if "--id" in args:
        only = args[args.index("--id") + 1:]
    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    series_ids = [s["id"] for s in index["series"] if not only or s["id"] in only]

    report = []          # (系列, 卷, 书, 章, 类, 说明, 开头样例)
    all_books = []       # (系列, 卷, book)
    stats = Counter()
    for sid in series_ids:
        meta = json.loads((DATA / f"{sid}.json").read_text(encoding="utf-8"))
        for vi, vol in enumerate(meta.get("volumes", []), 1):
            f = DATA / f"{sid}-{vi}.json"
            if not f.exists():
                continue
            for book in json.loads(f.read_text(encoding="utf-8")).get("books", []):
                all_books.append((sid, vol.get("title", ""), book))
                for ch in book.get("chapters", []):
                    stats["章"] += 1
                    for typ, desc in scan_chapter(book, ch):
                        report.append((sid, vol.get("title", ""), book.get("title", ""),
                                       ch.get("title", ""), typ, desc,
                                       " ⏎ ".join(l[:22] for l in lines_of(ch.get("content"))[:3])))
    rh = scan_running_headers(all_books)
    for sid, vt, bk, line, n, chs in rh:
        report.append((sid, vt, bk, f"（全书 {n} 章）", "F 运行页眉泄漏",
                       f"首行 {line!r}", f"{line} ⏎ {chs[0]} ⏎ …"))

    # ---- 汇总输出 ----
    cnt = Counter(r[4] for r in report)
    print(f"扫描 {len(series_ids)} 系列 {stats['章']} 章")
    order = sorted(cnt, key=lambda k: -cnt[k])
    for k in order:
        print(f"  {k}: {cnt[k]}")
    if "--full" in args:
        for r in report:
            print(f"[{r[4]}] {r[0]} / {r[2]} / {r[3]} —— {r[5]}")
            print(f"    {r[6]}")

    # ---- 明细 md ----
    md = ["# 书报章开头异常扫描报告（2026-10-20）", "",
          f"扫描范围：{len(series_ids)} 系列 / {stats['章']} 章；规则见 scripts/scan-book-openings.py 文档字符串", "",
          "| 类别 | 数量 |", "|------|------|"]
    for k in order:
        md.append(f"| {k} | {cnt[k]} |")
    md.append("")
    by_class = defaultdict(list)
    for r in report:
        by_class[r[4]].append(r)
    for k in order:
        md += ["", f"## {k}（{cnt[k]}）", ""]
        seen = set()
        shown = 0
        for r in by_class[k]:
            sig = (r[0], r[2])
            if k == "F 运行页眉泄漏":
                md.append(f"- [{r[0]}] {r[2]}：{r[5]}（如 {r[3]}）")
                continue
            if sig in seen:
                continue
            seen.add(sig)
            shown += 1
            if shown > 40:
                md.append(f"- …（同书更多章从略，共 {len(by_class[k])} 处）")
                break
            md.append(f"- [{r[0]}] {r[2]} · {r[3]}｜{r[5]}  ")
            md.append(f"  开头：`{r[6]}`")
    out = Path(__file__).resolve().parent.parent / "book-opening-scan.md"
    out.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"\n明细已写入 {out}")


if __name__ == "__main__":
    main()
