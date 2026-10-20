#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""书报系列导出：bible 项目灵粮 → data/books/（多系列）

通用输出契约（前端零改动 discovers）：
  data/books/index.json         → 系列清单 {series: [{id, name, volumes}]}
  data/books/{id}.json          → 元数据（轻量，不含正文）{name, volumes: [{title, books: [{title, chapters: [标题]}]}]}
  data/books/{id}-{辑号}.json   → 按辑内容 {volume, books: [{title, chapters: [{title, content}]}]}

结构约定：volumes = 辑；books = 书级分组——无书级系列（如十二篮，辑→篇两级）
每辑折成一个 books 条目（title=辑名、chapters=篇标题列表），前端渲染与标注分组无需感知差异。

系列注册表 SERIES：每项声明源目录、id、导出器（ni=目录索引+books_list 三级；slat=辑目录+编号 md 两级）。

用法：
  python export-spiritual.py                # 导出全部注册系列
  python export-spiritual.py ni slat        # 只导指定系列
"""
import functools
import hashlib
import json
import os
import re
import sys
from difflib import SequenceMatcher

BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "bible", "data", "raw", "spiritual_food"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "books")

TITLE_RE = re.compile(r"^\s*#\s+(.*?)\s*$")
VOL_NO = {"第一辑": "1", "第二辑": "2", "第三辑": "3"}
CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
          "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15, "十六": 16, "十七": 17, "十八": 18,
          "十九": 19, "二十": 20}

# ezoe 书报合辑分类注册表（bible 项目 2026-10-12 入库，源 ezoe.work）：每个分类 =
# 独立系列平级进书报合集层（同十二篮/传记与文集各占一块）。id 取分类英文短名，
# name 即分类名（系列名=辑名=分类名，单 volume 多 books，同 bio 形态）。
# EZOE_FIRST 为首批接入的四类（单文件均在 CF 25MB 限内）；edification 与 church
# 源 md 各 40/19MB（产物更大）、单辑超限，待拆分方案确定后移出该集合即可补入；
# writings 传记、文集类已按用户定稿（2026-10-14 同类别整合）并入 bio，不单列
EZOE_CATS = [
    ("gospel", "福音类"),
    ("edification", "造就类"),
    ("church", "教会与事奉类"),
    ("reading", "读经类"),
    ("writings", "传记、文集类"),
    ("periodicals", "代售与期刊类"),
    ("misc", "其他"),
]
EZOE_FIRST = {"gospel", "reading", "periodicals", "misc"}

# bio 合并 ezoe 传记、文集类时跳过的重复书（保留 bio 旧版——可能已带标注；
# ezoe 版《今时代神圣启示的先见》16 万字/33 章与 bio 版 5 万字/16 章同书异录）
BIO_DEDUP_KEYWORDS = ["先见"]


def read_md(path, extra_skip=()):
    """md 文件 → (标题, 正文)。首行 # 标题；正文去掉标题行，保留段落。
    extra_skip：开头连续出现的额外剥离行正则（如十二篮的目录名残留「十二篮(第一辑)」）"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    title = ""
    if lines and TITLE_RE.match(lines[0]):
        title = TITLE_RE.match(lines[0]).group(1).strip()
    body = [ln.strip() for ln in lines[1:] if ln.strip()]
    # 剥开头连续的「标题重复行/目录名残留行」：两类交替出现（标题→目录名→标题），
    # 循环剥到第一个既非标题也命中 extra_skip 的行为止
    norm = lambda s: re.sub(r"\s+", "", s or "")
    while body and title and (norm(body[0]) == norm(title) or any(re.match(p, body[0]) for p in extra_skip)):
        body.pop(0)
    # 剥离尾部爬取元数据：`---` 分隔线 + `**来源**/**URL**/**获取时间**` 行（不属正文）
    META_RE = re.compile(r"^\*\*(来源|URL|获取时间)\*\*")
    while body and (body[-1] == "---" or META_RE.match(body[-1])):
        body.pop()
    if body and body[-1] == "---":
        body.pop()
    if not title and body:
        title = body[0]
        body = body[1:]
    return title, "\n".join(body)


def cn_vol_no(vol_key):
    """「第一辑/第十二辑/十二篮(第一辑)」→「1/12/1」；已是数字直接返回"""
    if vol_key.isdigit():
        return vol_key
    m = re.search(r"第(.+?)辑", vol_key)
    if m and m.group(1) in CN_NUM:
        return str(CN_NUM[m.group(1)])
    return vol_key


EZOE_MD_HEAD = re.compile(r"^(#{1,6})\s+(.*)$")
EZOE_META_RE = re.compile(r"^\*\*(来源|URL|获取时间|说明)\*\*")
EZOE_INLINE_BOLD = re.compile(r"\*\*(.+?)\*\*")


def read_ezoe_md(path):
    """ezoe 篇目 md → 正文。源格式规整（实测 7394/7394 篇）：首行 # 书名、次行 ## 篇名。
    书名/篇名信息由 chunk 标题与 crumb 承载，剥掉防正文头部重复渲染；
    正文行首 markdown 标题记号（##/###/####）与行内 **加粗** 无对应渲染通道，剥记号保留文本。"""
    with open(path, encoding="utf-8") as f:
        body = [ln.strip() for ln in f.read().split("\n") if ln.strip()]
    # 剥尾部爬取元数据：`---` 分隔线 + `**来源**/**URL**/**获取时间**` 行（手工补全篇另有 `**说明**`）
    while body and (body[-1] == "---" or EZOE_META_RE.match(body[-1])):
        body.pop()
    # 剥开头二行：书名行 + 篇名行（任一行不是标题形态时保留，防非规整源文件）
    if body and body[0].startswith("#"):
        body.pop(0)
    if body and EZOE_MD_HEAD.match(body[0]):
        body.pop(0)
    out = []
    for ln in body:
        m = EZOE_MD_HEAD.match(ln)
        text = m.group(2).strip() if m else ln
        out.append(EZOE_INLINE_BOLD.sub(r"\1", text))
    return "\n".join(out)


# 篇级重复判定阈值（difflib 全文相似度）。ezoe 源站把同一篇既收进合集又拆出单本
# （福音讲台总集四部 vs 25 个单篇独立书，实测 ratio 1.000），书内也有同篇两录
EZOE_DUP_RATIO = 0.98

# 墓碑正文统一开头：源侧状态标记（absorbed/duplicate/merged_elsewhere）与 ezoe_dedup
# 产出的墓碑正文均以此开头，ezoe_dedup 据此跳过已墓碑篇目，防墓碑互判重复被二次覆盖
EZOE_TOMB_PREFIX = "（本文"


def _ezoe_similar(a, b):
    """全文相似度（quick_ratio 预筛砍掉明显不同的对）"""
    if SequenceMatcher(None, a, b).quick_ratio() < EZOE_DUP_RATIO:
        return False
    return SequenceMatcher(None, a, b).ratio() >= EZOE_DUP_RATIO


def ezoe_dedup(books):
    """重复篇**墓碑化**去重（用户 2026-10-14 定稿「整理整理」：同一篇在多处出现、
    出处混乱）。保留 books/chapters 条目与顺序不变——旧标注按 (volume,book,chapter)
    索引定位，删条目会让后续索引前移、标注错位丢失；墓碑只把正文换成一句指引，
    索引稳定、笔记不丢、用户点进去知道去哪读真内容。

    两类处理：
    - 整书被另一书完全覆盖（福音讲台总集拆出的单篇独立书；互覆时保留 part 折叠
      合集书）→ 该书每篇正文换指引
    - 书内重复篇（同篇两录）→ 保留每组首篇，其余换指引
    跨书部分重叠（节选与原文的关系，如初信喂养365题摘编《生命的意义》）属正常
    编排，不动。返回 (墓碑篇数, 墓碑书数)。
    """
    n = lambda s: re.sub(r"\s+", "", s or "")
    # 各篇归一化正文 + 书名/篇名归一化。已墓碑篇目（源侧状态标记产出的指引正文）
    # 换唯一占位串：墓碑之间、墓碑与正文都不判重，防墓碑被二次覆盖成错乱指引
    texts = [[f"\x00tomb{i}-{ci}" if c["content"].startswith(EZOE_TOMB_PREFIX) else n(c["content"])
              for ci, c in enumerate(b["chapters"])] for i, b in enumerate(books)]
    btitles = [n(b["title"]) for b in books]
    ctitles = [[n(c["title"]) for c in b["chapters"]] for b in books]

    tomb_ch = {}   # (book_idx, ch_idx) -> 覆盖方（书名, 篇名）指引文案
    covered_books = set()

    # 1) 跨书：候选书对 = 书名↔对方篇名相同（福音讲台总集拆书场景），或任两篇标题相同
    cand = set()
    for i in range(len(books)):
        for j in range(len(books)):
            if i == j:
                continue
            if btitles[i] and btitles[i] in ctitles[j]:
                cand.add((i, j))
            elif set(t for t in ctitles[i] if t) & set(t for t in ctitles[j] if t):
                cand.add((i, j))
    for i, j in cand:
        bi, bj = books[i], books[j]
        if not bi["chapters"] or not bj["chapters"]:
            continue
        # i 被 j 完全覆盖？j 被 i 完全覆盖？还是互覆
        i_in_j = all(any(_ezoe_similar(texts[i][ci], tj) for tj in texts[j]) for ci in range(len(texts[i])))
        j_in_i = all(any(_ezoe_similar(texts[j][cj], ti) for ti in texts[i]) for cj in range(len(texts[j])))
        if not (i_in_j or j_in_i):
            continue
        # 保留方：互覆时保留 part 折叠书（书名含 ·，合集语境），否则保留篇数多/索引小的
        if i_in_j and j_in_i:
            keep, drop = (i, j) if ("·" in books[i]["title"], -i) >= ("·" in books[j]["title"], -j) else (j, i)
        elif i_in_j:
            keep, drop = j, i
        else:
            keep, drop = i, j
        if drop in covered_books:
            continue
        covered_books.add(drop)
        for ci in range(len(books[drop]["chapters"])):
            # 找覆盖方中对应的篇名（指引文案用）
            cov_title = ""
            for cj in range(len(books[keep]["chapters"])):
                if _ezoe_similar(texts[drop][ci], texts[keep][cj]):
                    cov_title = books[keep]["chapters"][cj]["title"]
                    break
            tomb_ch[(drop, ci)] = (books[keep]["title"], cov_title)

    # 2) 书内重复篇：同书标题相同的篇，保留首篇
    for i, b in enumerate(books):
        if i in covered_books:
            continue
        seen = {}
        for ci, t in enumerate(ctitles[i]):
            if not t:
                continue
            if t in seen and _ezoe_similar(texts[i][ci], texts[i][seen[t]]):
                tomb_ch[(i, ci)] = (b["title"], b["chapters"][seen[t]]["title"])
            elif t not in seen:
                seen[t] = ci

    # 3) 执行墓碑化：正文换指引（条目与顺序不动）
    for (bi, ci), (cov_book, cov_ch) in sorted(tomb_ch.items()):
        if cov_book == books[bi]["title"]:   # 书内重复：指引省略书名（本文即该书）
            books[bi]["chapters"][ci]["content"] = (
                f"（本文与「{cov_ch}」相同，为免重复不再载入，请阅读该篇。）")
        else:
            books[bi]["chapters"][ci]["content"] = (
                f"（本文与《{cov_book}》{cov_ch}相同，为免重复不再载入，请阅读该处。）")
    return len(tomb_ch), len(covered_books)


def write_volume_files(series_id, meta_light, volumes_content):
    """写 {id}.json 元数据 + {id}-{n}.json 按辑内容；返回 (辑数, 本数, 章数)"""
    with open(os.path.join(OUT, f"{series_id}.json"), "w", encoding="utf-8") as f:
        json.dump(meta_light, f, ensure_ascii=False, separators=(",", ":"))
    total_books = total_chapters = 0
    for i, vol in enumerate(volumes_content, 1):
        with open(os.path.join(OUT, f"{series_id}-{i}.json"), "w", encoding="utf-8") as f:
            json.dump({"volume": vol["volume"], "books": vol["books"]}, f, ensure_ascii=False, separators=(",", ":"))
        total_books += len(vol["books"])
        total_chapters += sum(len(b["chapters"]) for b in vol["books"])
        print(f"[OK] {series_id} {vol['volume']}：{len(vol['books'])} 本 / {sum(len(b['chapters']) for b in vol['books'])} 章")
    return len(volumes_content), total_books, total_chapters


def export_ni():
    """倪柝声文集：目录索引.json（volumes → books_list 含每章标题）+ {辑}/{书目录}/NNN{标题}.md"""
    src_dir = os.path.join(BASE, "倪柝声文集")
    with open(os.path.join(src_dir, "倪柝声文集目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)

    meta = {"name": idx.get("title", "倪柝声文集"), "volumes": []}
    volumes_content = []
    for vol_key, vol in (idx.get("volumes") or {}).items():
        vol_title = vol.get("title") or vol_key
        vol_dir = vol.get("directory")
        books = []
        for b in (vol.get("books_list") or []):
            bdir = os.path.join(src_dir, vol_dir, b["directory"])
            if not os.path.isdir(bdir):
                print(f"  [WARN] 目录缺失：{bdir}")
                continue
            files = sorted([fn for fn in os.listdir(bdir) if fn.endswith(".md")])
            expected = b.get("chapters_list") or []
            chapters = []
            for fn in files:
                title, content = read_md(os.path.join(bdir, fn))
                if not title:
                    title = re.sub(r"^\d+\s*", "", fn[:-3])  # 文件名去数字前缀兜底
                chapters.append({"title": title, "content": content})
            if len(chapters) < len(expected):
                print(f"  [WARN] {b.get('title','')}：文件 {len(chapters)} 章 < 索引 {len(expected)} 章")
            books.append(_emit_book(b.get("title", ""), chapters,
                                    _pos_int(b.get("book_number"))))
        meta["volumes"].append({"title": vol_title, "books": books})
        volumes_content.append({"volume": vol_title, "books": books})
    return meta, volumes_content


def export_slat():
    """十二篮等两级系列：{系列}目录索引.json（items 扁平，local_rel 含辑目录）+ {辑}/NNN{标题}.md

    无书级分组：每辑折成一个 books 条目（title=辑名、chapters=篇列表），复用通用输出契约。
    """
    src_dir = os.path.join(BASE, "十二篮")
    with open(os.path.join(src_dir, "十二篮目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)

    by_vol = {}
    for it in (idx.get("items") or []):
        rel = it.get("local_rel") or ""
        parts = rel.split("/")
        if len(parts) < 2:
            print(f"  [WARN] local_rel 异常：{rel}")
            continue
        vol_dir, fn = parts[0], parts[-1]
        path = os.path.join(src_dir, vol_dir, fn)
        if not os.path.isfile(path):
            print(f"  [WARN] 文件缺失：{path}")
            continue
        title, content = read_md(path, extra_skip=(r"^十二篮\(", r"^名人传记$"))
        if not title:
            title = it.get("title") or re.sub(r"^\d+\s*", "", fn[:-3])
        # 剥开头标题重复行（正文首行与标题相同，渲染时与 .bk-title 重复）
        clines = content.split("\n")
        norm = lambda s: re.sub(r"\s+", "", s or "")
        while clines and norm(clines[0]) == norm(title):
            clines.pop(0)
        content = "\n".join(clines)
        by_vol.setdefault(vol_dir, []).append({"title": title, "content": content})

    name = idx.get("series", "十二篮")
    meta = {"name": name, "volumes": []}
    volumes_content = []
    for vol_dir in sorted(by_vol, key=lambda d: int(cn_vol_no(d))):
        vol_no = cn_vol_no(vol_dir)
        vol_title = f"第{next((k for k, v in CN_NUM.items() if v == int(vol_no)), vol_no)}辑"
        chapters = sorted(by_vol[vol_dir], key=lambda c: 0)  # 保留索引顺序（items 已按编号）
        meta["volumes"].append({"title": vol_title, "books": [{"title": vol_title, "chapters": chapters}]})
        volumes_content.append({"volume": vol_title, "books": [{"title": vol_title, "chapters": chapters}]})
    return meta, volumes_content


def export_bio():
    """名人传记 → 「传记与文集」：{系列}目录索引.json（items 扁平，local_rel=「子集[/册目录]/NNN标题.md」）
    + 子集目录/NNN标题.md。子集 = books 条目（title=子集名、chapters=篇列表）；
    王明道文库精选的「册」目录折叠为册级 books 条目（「王明道文库精选·第一册」）。

    合并 ezoe「传记、文集类」（用户 2026-10-14 定稿：同类别整合，与 bio 并成合集层一块，
    系列名随之改「传记与文集」）。**追加在既有子集之后**——bio 原有 books 索引不动，
    旧标注按 (volume,book,chapter) 定位才不错位；与 bio 重复的书（BIO_DEDUP_KEYWORDS）
    保留 bio 版不上传 ezoe 版（旧数据可能已带标注，且 ezoe 版章目拆分更细、索引不一致）。
    """
    src_dir = os.path.join(BASE, "名人传记")
    with open(os.path.join(src_dir, "名人传记目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)

    by_group = {}
    for it in (idx.get("items") or []):
        rel = it.get("local_rel") or ""
        parts = [p for p in rel.split("/") if p]
        if len(parts) < 2:
            print(f"  [WARN] local_rel 异常：{rel}")
            continue
        path = os.path.join(src_dir, *parts)
        if not os.path.isfile(path):
            print(f"  [WARN] 文件缺失：{path}")
            continue
        title, content = read_md(path, extra_skip=(r"^名人传记$",))
        if not title:
            title = it.get("title") or re.sub(r"^\d+\s*", "", parts[-1][:-3])
        # 分组键：一级「子集/文件」→子集；「王明道文库精选/第N册…/文件」→册级
        if parts[0] == "王明道文库精选" and len(parts) >= 3:
            m_vol = re.search(r"第([一二三四五六七八九十]+)册", parts[1])
            group = "王明道文库精选·" + (m_vol.group(0) if m_vol else parts[1].replace("　", " ").strip())
        else:
            group = parts[0]
        by_group.setdefault(group, []).append({"title": title, "content": content})

    # 单一 volume（无辑级），所有子集作为 books 条目
    books = [{"title": g, "chapters": by_group[g]} for g in by_group]
    # 合并 ezoe 传记、文集类（追加在后保索引稳定；重复书保留 bio 版）
    skipped = []
    for b in ezoe_category_books("传记、文集类"):
        if any(k in b["title"] for k in BIO_DEDUP_KEYWORDS):
            skipped.append(b["title"])
            continue
        books.append(b)
    if skipped:
        print(f"  [WARN] bio 合并跳过重复书（保留 bio 版）：{skipped}")

    name = "传记与文集"   # 合并后含传记与文集（神圣启示的高峰等），系列名随之调整
    meta = {"name": name, "volumes": [{"title": name, "books": books}]}
    volumes_content = [{"volume": name, "books": books}]
    return meta, volumes_content


def _ezoe_flag_tombstone(ch, rel_map, book_title=""):
    """源侧标记为非 saved 的篇目 → 墓碑正文（保留条目与顺序，(volume,book,chapter)
    索引稳定，旧标注不错位）。

    源侧 2026-10-15 起（bible P0 去重 + 吸收合并）对重复/被吸收篇目翻 status 并删除
    对应 md 文件，但索引条目保位不删：
    - absorbed：正文已并入「既有灵粮」（福音天地/属灵书报/高峰真理），absorbed_by 记去向
    - duplicate：与 duplicate_of 指向的篇目重复；指向的本身已被吸收时跟随其吸收去向
    - merged_elsewhere：源站空壳页，内容已由同书其他篇目收录
    rel_map: local_rel → (书名, 篇目条目)，同分类内解析 duplicate_of 用；
    book_title：本篇所属书名（同书重复时指引省略书名，同 ezoe_dedup 风格）。
    """
    st = ch.get("status")
    if st == "absorbed":
        loc = (ch.get("absorbed_by") or "").replace("/", " · ").strip(" ·")
        return f"（本文已并入《{loc}》，为免重复不再载入。）" if loc else \
               "（本文已并入他处，为免重复不再载入。）"
    if st == "duplicate":
        tgt = rel_map.get(ch.get("duplicate_of") or "")
        if tgt:
            tbook, tch = tgt
            ttitle = tch.get("title") or ""
            if tch.get("status") == "absorbed":
                loc = (tch.get("absorbed_by") or "").replace("/", " · ").strip(" ·")
                if loc:
                    return f"（本文与《{loc}》{ttitle}相同，为免重复不再载入。）"
            if tbook == book_title:   # 书内重复：指引省略书名（本文即该书）
                return f"（本文与「{ttitle}」相同，为免重复不再载入，请阅读该篇。）"
            if tbook:
                return f"（本文与《{tbook}》{ttitle}相同，为免重复不再载入，请阅读该处。）"
            return f"（本文与「{ttitle}」相同，为免重复不再载入，请阅读该篇。）"
        return "（本文与他处重复，为免重复不再载入。）"
    if st == "merged_elsewhere":
        return "（本文内容已由同书其他篇目收录，为免重复不再载入。）"
    return "（本文暂缺，不再载入。）"


def ezoe_category_books(cat_name):
    """ezoe 单个分类 → books 条目列表（供独立系列导出与合并进 bio 共用）。

    源：`../bible/data/raw/spiritual_food/ezoe书报合辑/` 的 目录索引.json
    （categories → books → chapters 含 part/num/title/local_rel/status）
    + {分类}/{书目录}/NN{篇名}.md。

    书 = books 条目；篇 = chapter。多「部」书（源站 part 分组，如《正常的基督徒信仰》
    分四部）按 part 折叠成多个 books 条目「书名·部」；单部书的 part 是「目录/前言」
    式源站分组名，忽略。

    篇目 md 是规整的二行式开头（首行 # 书名、次行 ## 篇名），正文带 markdown 标题
    层级（##/###/####）与行内 **加粗**，尾部 --- + **来源/URL/获取时间/说明** 元数据。
    书名/篇名由 chunk 标题与 crumb 承载故剥掉；markdown 记号本项目无对应渲染通道，
    剥记号保留文本（detectLrHeading 按裸编号/短行兜底识别层级）。

    篇目状态（2026-10-15 起源侧标记）：saved 正常载入；absorbed/duplicate/
    merged_elsewhere 的 md 已被源侧删除，**墓碑化保留条目**（正文换指引）而非
    过滤丢弃——旧标注按 (volume,book,chapter) 索引定位，删条目会让后续索引
    前移、标注错位丢失（v1.0.50 实测：按 saved 过滤重导会丢 30 本书）。
    """
    src_dir = os.path.join(BASE, "ezoe书报合辑")
    with open(os.path.join(src_dir, "目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)
    cat = next((c for c in (idx.get("categories") or []) if c.get("name") == cat_name), None)
    if not cat:
        print(f"  [WARN] ezoe 分类不存在：{cat_name}")
        return []

    # local_rel → (书名, 篇目条目)：解析 duplicate_of 的覆盖方与吸收去向用
    rel_map = {}
    for b in (cat.get("books") or []):
        for ch in (b.get("chapters") or []):
            if ch.get("local_rel"):
                rel_map[ch["local_rel"]] = (b.get("title") or "", ch)

    books = []
    for b in (cat.get("books") or []):
        chs = [ch for ch in (b.get("chapters") or []) if ch.get("local_rel")]
        parts = []
        for ch in chs:
            p = ch.get("part") or ""
            if p and p not in parts:
                parts.append(p)
        multi = len(parts) > 1  # 仅多部书按 part 折叠
        groups = {}
        for ch in chs:
            key = (ch.get("part") or "") if multi else ""
            groups.setdefault(key, []).append(ch)
        for key, gchs in groups.items():
            title = f"{b.get('title', '')}·{key}" if key else b.get("title", "")
            chapters = []
            for ch in gchs:
                ctitle = ch.get("title") or re.sub(r"^\d+\s*", "", os.path.basename(ch["local_rel"])[:-3])
                path = os.path.join(src_dir, ch["local_rel"])
                if ch.get("status") != "saved":
                    content = _ezoe_flag_tombstone(ch, rel_map, title)
                elif os.path.isfile(path):
                    content = read_ezoe_md(path)
                else:
                    # saved 但文件缺失：保留墓碑条目防索引前移（正常不应发生）
                    print(f"  [WARN] saved 篇目文件缺失（保留墓碑条目保索引稳定）：{path}")
                    content = "（本文暂缺。）"
                chapters.append({"title": ctitle, "content": content})
            if chapters:
                books.append(_emit_book(title, chapters, _pos_int(b.get("id"))))
    n_tomb, n_tbook = ezoe_dedup(books)
    if n_tomb:
        print(f"  [DEDUP] {cat_name}：{n_tomb} 篇重复内容墓碑化（涉及 {n_tbook} 本），索引保留稳定")
    return books


def export_ezoe_cat(cat_id, cat_name):
    """ezoe 单个分类 → 独立系列（name=分类名，单 volume 多 books，同 bio 形态）。
    书/篇构建见 ezoe_category_books。"""
    books = ezoe_category_books(cat_name)
    meta = {"name": cat_name, "volumes": [{"title": cat_name, "books": books}]}
    volumes_content = [{"volume": cat_name, "books": books}]
    return meta, volumes_content


def read_gospelfood_md(path, book_title):
    """福音天地篇目 md → (标题, 正文)。源是早年网页版抓取，头部有两类噪声：

    - 网页版原文件：`# 篇名` 之后是「篇名重复 + 书名碎片（可拆行，如「书中之书—」
      +「圣经」、「恩」+「言」）+ 篇名重复」的页眉块，然后才是正文
    - ezoe 吸收合并入库的篇目（页脚带 **书报号**/**说明**）：页眉较干净，仅篇名重复行

    页眉块整段剥掉；尾部爬取元数据（**来源/URL/获取时间/书报号/说明**）剥掉。
    书名碎片与篇名裹行都短，故第三条规则带长度上限，防误吃正文短行（如「读经：」）。
    """
    with open(path, encoding="utf-8") as f:
        lines = [ln.strip() for ln in f.read().split("\n") if ln.strip()]
    title = ""
    if lines and TITLE_RE.match(lines[0]):
        title = TITLE_RE.match(lines[0]).group(1).strip()
    body = lines[1:] if title else lines
    n = lambda s: re.sub(r"[\s\u3000\u00a0]+", "", s or "")
    nt, nb = n(title), n(book_title)
    # 1) 开头连续的篇名重复行（偶有三连）
    while body and nt and n(body[0]) == nt:
        body.pop(0)
    # 2) 书名碎片行：以前 6 行内第二次出现篇名为界整体剥掉
    for i in range(min(6, len(body))):
        if nt and n(body[i]) == nt:
            body = body[i + 1:]
            break
    else:
        # 3) 无第二次篇名（篇名被裹行）：按 title/dir 子串剥短行
        while body and nt and nb and len(n(body[0])) <= 15 and (
                n(body[0]) == nt or n(body[0]) in nt + nb or nb in n(body[0])):
            body.pop(0)
    # 4) 尾部爬取元数据：`---` 分隔线 + **来源/URL/获取时间/书报号/说明** 行
    GF_META_RE = re.compile(r"^\*\*(来源|URL|获取时间|书报号|说明)\*\*")
    while body and (body[-1] == "---" or GF_META_RE.match(body[-1])):
        body.pop()
    if body and body[-1] == "---":
        body.pop()
    return title, "\n".join(body)


def export_gospelfood():
    """福音天地（2026-10-15 新增系列）：早年网页版抓取的福音主题文集；bible 侧 ezoe
    吸收合并后也是那 6 本被合并 gospel 书的正版所在地。源：福音天地/福音天地目录索引.json
    （扁平 items：title/url/local_rel/书报号）+ {书目录}/NN{篇名}.md。按顶级目录分书
    （22 本，新旧约福音题纲 4 个子目录不拆、295 篇一书），单 volume 多 books，同 bio 形态。"""
    src_dir = os.path.join(BASE, "福音天地")
    with open(os.path.join(src_dir, "福音天地目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)
    by_dir = {}
    for it in (idx.get("items") or []):
        rel = it.get("local_rel")
        if rel:
            by_dir.setdefault(rel.split("/")[0], []).append(it)
    books = []
    for dir_name, items in by_dir.items():
        # 吸收合并进来的 6 本 ezoe 书在 items 上带「书报号」——取该书目录下任一非空值
        bnum = next((_pos_int(it.get("书报号")) for it in items if it.get("书报号")), None)
        chapters = []
        for it in items:
            path = os.path.join(src_dir, it["local_rel"])
            if not os.path.isfile(path):
                print(f"  [WARN] 文件缺失：{path}")
                continue
            title, content = read_gospelfood_md(path, dir_name)
            ctitle = title or re.sub(r"^\d+\s*", "", it.get("title") or "")
            chapters.append({"title": ctitle, "content": content})
        if chapters:
            books.append(_emit_book(dir_name, chapters, bnum))
    name = "福音天地"
    meta = {"name": name, "volumes": [{"title": name, "books": books}]}
    volumes_content = [{"volume": name, "books": books}]
    return meta, volumes_content


# ═══════════════════════════════════════════════════════════════════════
# 灵粮 legacy 源（bible data/raw/spiritual_food 其余来源，2026-10-19 全量导入）
#
# 这些源是早年网页抓取（pages.uoregon.edu/fyin/灵粮），三种形态：
#   1) 根级散篇（真理专题/荒漠甘泉等）→ 合成一个书条目
#   2) 一级目录 = 书（属灵书报/特会信息/结晶读经），目录名带 001 编号
#   3) 编号目录 = 册/卷（新约总论/圣经之旅/真理课程/生命课程/圣经要道/召会历史），
#      每册作为一个 book 条目（单 volume 多 books，抽屉左栏即册列表）
#
# 清洗一律在导出层完成（bible 源数据不动）：
#   - 页眉块剥离：早年网页版在正文前重复章标题 + `书名：X` + 训练期行，逐段剥掉
#   - 拆行重排：源站按屏幕宽度硬折行（圣经要道 72% 的正文行 ≤10 字），按模式合回
#   - 网页残留：`阅读更多＞`、行尾 `×`（经节全文拼接痕迹）
# 重排按**文件**判断（碎片行 >25% 才处理），本来规整的篇目不动。
# ═══════════════════════════════════════════════════════════════════════

_CN = CN_NUM
_CN_DIGITS = "〇零一二三四五六七八九十"


def _key(s):
    """比对键：去空白、归一破折号（源站同一行在不同篇目里 —/─/－ 混用）"""
    return re.sub(r"[\s\u3000\u00a0\-—─－–_]", "", s or "")


def _cjk_len(s):
    return len(re.findall(r"[\u4e00-\u9fff]", s or ""))


def _num_prefix(name):
    m = re.match(r"^0*(\d+)", name or "")
    return int(m.group(1)) if m else 10 ** 6


def _pos_int(v):
    """源侧编号 → 正整数或 None（书报号/目录序号/book_number 共用的宽松解析）"""
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _strip_num(name):
    return re.sub(r"^\d+\s*", "", name or "").strip()


def _cn_sort(s):
    """卷/册/期排序键：「卷一」「第一册」「第N级 卷M」「一期」→ 数值
    两级课程用 级×100+卷，保证第一级卷一 < 第一级卷二 < 第二级卷一"""
    lvl = 0
    m = re.search(r"第([一二三四五六七八九十]+)级", s or "")
    if m and m.group(1) in _CN:
        lvl = _CN[m.group(1)]
    vol = 0
    m = re.search(r"[卷册期]\s*第?([一二三四五六七八九十]+)", s or "")
    if not m:
        m = re.search(r"第?([一二三四五六七八九十]+)[卷册期]", s or "")
    if m and m.group(1) in _CN:
        vol = _CN[m.group(1)]
    return lvl * 100 + vol if (lvl or vol) else 0


def _stem(fn):
    return fn[:-3] if fn.lower().endswith(".md") else fn


def _read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f.read().split("\n") if ln.strip()]


def _md_title(lines):
    """H1 标题；新约总论等源的文件名是 001001 双编号，H1 会带 001 前缀，剥掉"""
    if lines and lines[0].startswith("#"):
        return re.sub(r"^\d{3,}", "", lines[0].lstrip("#").strip()).strip()
    return ""


# 训练/特会页眉行（如「二○○○年秋季全时间训练」「二OO一年夏季训练」
# 「二ΟΟ一年秋季全时间训练」——源站混用 ○/〇/Ｏ/O 与希腊字母 Ο）
_TRAIN_HEAD_RE = re.compile(
    r"^[一二三四五六七八九十○〇零ＯOΟ0-9]{1,4}年?.*(训练|特会|聚会|大会|秋季|夏季|冬季|春季)")
_YEAR_ONLY_RE = re.compile(r"^[一二三四五六七八九十○〇零ＯOΟ0-9]{1,4}年$")
_TRAIN_ONLY_RE = re.compile(r"^(春季|夏季|秋季|冬季)(全时间)?训练$")
# 正文里的独立标签行（拆行重排时不当成碎片并入上一段）
_LABEL_RE = re.compile(r"^(纲目|目录|读经|祷告|信息|经文|诗歌|前言|序言|介言|引言|结语|附注|说明)$")
_OPEN_END = "‘“「『（(【《"
_CONT_START = "，。；：、）】》”’」』,.;:)]}"
_STRUCT_RES = [
    re.compile(r"^[壹贰叁肆伍陆柒捌玖拾]+[\u3000 ]+"),
    re.compile(r"^[一二三四五六七八九十]+[\u3000 ]+"),
    re.compile(r"^[ａ-ｚ][\u3000 ]+"),
    re.compile(r"^（[一二三四五六七八九十百〇○]+）(?:[\u3000 ]+|$)"),
    re.compile(r"^（[０-９]+）(?:[\u3000 ]+|$)"),
    re.compile(r"^《[一二三四五六七八九十]+》[\u3000 ]+"),
]
_NUM_STRUCT_RE = re.compile(r"^[０-９0-9]+[\u3000 ]+")
_MARKER_ONLY_RES = [
    re.compile(r"^[壹贰叁肆伍陆柒捌玖拾]{1,2}$"),
    re.compile(r"^[一二三四五六七八九十]{1,3}$"),
    re.compile(r"^（[一二三四五六七八九十百〇○]+）$"),
    re.compile(r"^（[０-９]+）$"),
]


def _is_struct(line):
    """纲目结构行（壹/一/１/ａ/（一）…）：拆行重排时保持独立段落"""
    for rx in _STRUCT_RES:
        if rx.match(line):
            return True
    # 「10　12，启十九7。」这类数字开头的经节续行不算结构行
    if _NUM_STRUCT_RE.match(line) and _cjk_len(line) >= 7:
        return True
    return False


def _marker_only(line):
    return any(rx.fullmatch(line) for rx in _MARKER_ONLY_RES)


def _ends_terminal(s):
    return bool(s) and s[-1] in "。！？；…："


def _is_year_train(kl, l):
    """「年份 + 训练/特会」页眉行：必须短、且不含句末标点——
    「六十年代…福音聚会中我受浸得救了。」这类正文段落不能被当成页眉"""
    return (bool(_TRAIN_HEAD_RE.match(kl))
            and not re.search(r"[。！？；]", l)
            and len(kl) <= 32)


def _headerish(l, kl, kt, kb, lines, i, prev_year=False):
    """页眉行判定（只用于从前往后**连续**消费的页眉区，不做全文跳转匹配）"""
    if not kl:
        return True
    if (re.match(r"^书\s*$|^书\s*名\s*$|^名\s*[:：]|^书\s*名\s*[:：]", l)
            or _is_year_train(kl, l)
            or _YEAR_ONLY_RE.match(kl)
            or _TRAIN_ONLY_RE.match(kl)
            or re.fullmatch(r"第[一二三四五六七八九十百]+[篇课章]", l)
            or re.fullmatch(r"[—\-－–─~～·]+", l)):
        return True
    # 会期名（国殇节特会 / 春季国际长老…训练）只在紧邻年份行之后才当页眉；
    # 否则章首小节标题「训练规则说明」「聚会中基本的功用」会被误删
    if prev_year and len(kl) <= 24 and not re.search(r"[。！？；]", l) \
            and re.match(r"^(国殇节|感恩节|新春|华语|国际长老|长老|负责弟兄|同工|特会|训练|聚会|大会|春季|夏季|秋季|冬季)", kl):
        return True
    # 「秋季…训」+「练」：训练一词被硬折成两行
    if (i + 1 < len(lines) and re.search(r"(训|特)$", kl)
            and _key(lines[i + 1]) in ("练", "会")):
        return True
    if kl in ("练", "会") and i > 0 and re.search(r"(训|特)$", _key(lines[i - 1])):
        return True
    # 年份被拆成「二」「OO」「04」「2007」「年」多行的页眉；必须看后几行有「年/训练」
    if (re.fullmatch(r"[一二三四五六七八九十○〇零ＯOΟ0-9]{1,4}", kl)
            and any(("年" in _key(x) or "训练" in _key(x)) for x in lines[i + 1:i + 4])):
        return True
    if kl.startswith("年") and not re.search(r"[。！？]", l) and (
            len(kl) <= 8 or re.search(r"(训练|特会|聚会|大会|春季|夏季|秋季|冬季)", kl)):
        return True
    # 书名拆行留下的卷次碎片：名：生命课程—（卷 / 一）
    if re.fullmatch(r"[一二三四五六七八九十0-9]+[）)]", kl) and i > 0 \
            and re.search(r"(书\s*名|^名\s*[:：])", lines[i - 1]):
        return True
    # 孤立的后括号（上一行有未闭合的左括号）
    if kl in ("）", ")") and i > 0 and ("（" in lines[i - 1] or "(" in lines[i - 1]):
        return True
    # 章标题被拆成两个单字（标 / 语 → 标语）
    if len(kl) == 1 and i + 1 < len(lines):
        k2 = _key(lines[i + 1])
        if len(k2) == 1 and kt and (kl + k2) in kt:
            return True
    # 书名/章标题行：必须是**无句读**的短行——正文段落即使含书名也不动
    if re.search(r"[。！？；]", l):
        return False
    kl2 = re.sub(r"[（(][一二三四五六七八九十0-9]+[）)]", "", kl)
    if kb and len(kl) <= len(kb) + 12 and (
            kl == kb or kl in kb or kb in kl or (kl2 and (kl2 == kb or kl2 in kb))):
        return True
    if kt and len(kl) <= max(24, len(kt)) and (kl in kt or kt.startswith(kl)):
        return True
    if kt and len(kl) >= 8 and SequenceMatcher(None, kl, kt).ratio() >= 0.85:
        return True
    return False


def _strip_header(lines, title, book_title=""):
    """从正文开头**连续**剥页眉：重复章标题 / `书名：X`（可能拆行）/ 训练期年份 /
    书名碎片。遇到第一条正文即停。

    不做「前 N 行找最后一次标题出现」的跳转匹配——正文里再次出现标题词时，
    那样会把中间整段正文砍掉（2026-10-19 评审实测丢了正文段落）。"""
    kt, kb = _key(title), _key(book_title)
    i = 0
    prev_year = False
    while i < min(12, len(lines)):
        l = lines[i]
        kl = _key(l).lstrip("'’‘\"")
        if not kl:
            i += 1
            continue
        if i == 0:
            # 首行只接受明确的页眉标志，防无页眉文件被误删首段
            explicit = (kl == kt or kl == kb
                        or re.match(r"^书\s*$|^书\s*名\s*$|^名\s*[:：]|^书\s*名\s*[:：]", l)
                        or _is_year_train(kl, l) or _YEAR_ONLY_RE.match(kl)
                        or _TRAIN_ONLY_RE.match(kl)
                        or re.fullmatch(r"[—\-－–─~～·]+", l)
                        or (kt and len(kl) >= 6
                            and (kl in kt or kt.startswith(kl)
                                 or SequenceMatcher(None, kl, kt).ratio() >= 0.85)))
            if not explicit:
                break
        elif not _headerish(l, kl, kt, kb, lines, i, prev_year):
            break
        yearish = (bool(_is_year_train(kl, l)) or bool(_YEAR_ONLY_RE.match(kl))
                   or bool(re.fullmatch(r"[一二三四五六七八九十○〇零ＯOΟ0-9]{1,4}", kl))
                   or kl.startswith("年"))
        prev_year = yearish
        i += 1
    return lines[i:]


def _strip_web_noise(text):
    """网页抓取残留：`阅读更多＞`、行尾 `×`、`Back` 导航行、控制字符；
    成对 `**粗体**` 去记号；**行内单个 `**` 是源站脱敏占位符，必须保留**
    （如「除**以外，再没有别的神」——删掉会变成语义残缺的「除以外」）。"""
    text = text.replace("阅读更多＞", "").replace("阅读更多>", "").replace("阅读更多", "")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"\*\*([^*\n]+?)\*\*", r"\1", text)   # 成对粗体 → 去记号
    out = []
    for ln in text.split("\n"):
        ln = re.sub(r"×\s*$", "", ln.rstrip())
        t = ln.strip()
        if not t or t == "---":
            continue
        if not re.search(r"[\w\u4e00-\u9fff]", t):
            continue
        if re.match(r"^Back", t):   # 网页版「Back xxx」返回导航行
            continue
        if re.fullmatch(r"\*+", t):  # 单独一行的脚注记号
            continue
        # 行首单个 ** 是源站脚注/注释记号（如 `**本文新约经节全引自…`），去记号留文字
        ln = re.sub(r"^\*\*", "", ln)
        out.append(ln)
    return "\n".join(out)


def _join_ok(cur, line):
    """当前累积行与下一行是否应合并（拆行重排规则）"""
    if not cur or not line:
        return False
    if cur[-1] in _OPEN_END:                       # 行尾是开引号/开括号
        return True
    if line[0] in _CONT_START:                     # 行首是标点 → 续行
        return True
    if len(line) <= 4 and not re.search(r"[\w\u4e00-\u9fff]", line):
        return True                                # 纯引号/纯标点
    if re.fullmatch(r"[0-9０-９]{1,3}", line):      # 裸节号
        return True
    if (re.fullmatch(r"[0-9０-９]{1,3}[~～\-－至][0-9０-９]{1,3}", line)
            and re.search(r"[一二三四五六七八九十百0-9０-９]$", cur)):
        return True                                # 节范围接在「书卷简称+章」后
    if re.match(r"^\d+首$", cur):                  # 诗歌编号行不并入
        return False
    if _ends_terminal(cur):
        return False
    if len(line) <= 12 and not _is_struct(line) and not _LABEL_RE.match(line) and not line.endswith("："):
        return True                                # 短碎片补句
    return False


def _reflow(lines):
    """按碎片规则把硬折行合回段落；结构行始终独立成段"""
    out = []
    cur = ""
    for line in lines:
        if not line.strip():
            continue
        if _is_struct(line) or _marker_only(line):
            if cur:
                out.append(cur)
            cur = line
            continue
        if cur and _marker_only(cur):
            # 标记单独成行（壹 / 一 / （一））→ 与紧随的正文合并，不按长度判断
            cur += ("" if cur.startswith("（") else "\u3000") + line
            continue
        if cur and _join_ok(cur, line):
            cur += line
            continue
        if cur:
            out.append(cur)
        cur = line
    if cur:
        out.append(cur)
    return out


def _strip_footer(lines):
    """剥尾部爬取元数据：`---` 分隔线 + `**来源/URL/获取时间/书报号/说明**` 行"""
    while lines and (lines[-1] == "---"
                     or re.match(r"^\*\*(来源|URL|获取时间|书报号|说明)\*\*", lines[-1])):
        lines.pop()
    if lines and lines[-1] == "---":
        lines.pop()
    return lines


def _clean_lines(lines, title, book_title, opts):
    """页脚剥离 → 页眉剥离 → 网页残留 → 按文件判断是否重排 → 去空行"""
    lines = _strip_footer(lines)
    lines = _strip_header(lines, title, book_title)
    if opts.get("strip_web"):
        lines = _strip_web_noise("\n".join(lines)).split("\n")
        lines = [l.strip() for l in lines if l.strip()]
    # 项目符号独占行（拾零的 Ø、网页列表的 ●• 等）：无文本，直接丢
    lines = [l for l in lines if not re.fullmatch(r"[Øø○●•·※▪◦]+", l.strip())]
    frag = sum(1 for l in lines if len(l) <= 10 and not _is_struct(l))
    if lines and frag / len(lines) > 0.25:
        lines = _reflow(lines)
    return [l for l in lines if l.strip()]


# 书名修订：源目录名的错字/截断/繁体（只改展示名，目录不动）
BOOK_TITLE_FIX = {
    "116当前的角我们当前的需要": "当前的角声与当前的需要",   # 源目录漏「声」
    "026生命的話": "生命的话",
    "070福音的託付": "福音的托付",
    "071主今日恢復之主要项目的重点": "主今日恢复之主要项目的重点",
    "072主恢復的简说": "主恢复的简说",
    "173神新约经纶中的奥祕": "神新约经纶中的奥祕",  # 与下一行同源的繁体字形，保留原字防歧义
    "210实行主当前恢復之路": "实行主当前恢复之路",
}


def _book_title_from_dir(dirname, opts):
    mode = opts.get("dir_title")
    if mode == "vol":
        m = re.match(r"^\d*\s*第([一二三四五六七八九十]+)[册卷](?:[—\-－–\s]*(.*))?$", dirname.strip())
        if m:
            unit = "册" if "册" in dirname else "卷"
            rest = (m.group(2) or "").strip(" —－–-")
            return f"第{m.group(1)}{unit} {rest}".strip()
        # (第一册)
        m = re.search(r"[（(]\s*第([一二三四五六七八九十]+)\s*([卷册])\s*[）)]\s*$", dirname)
        if m:
            return "第" + m.group(1) + m.group(2)
        # (卷一) / （ 卷一 ）
        m = re.search(r"[（(]\s*([卷册])\s*([一二三四五六七八九十]+)\s*[）)]\s*$", dirname)
        if m:
            return m.group(1) + m.group(2)
        # 卷一 / 第一册
        m = re.fullmatch(r"(第)?([一二三四五六七八九十]+)?\s*([卷册])\s*([一二三四五六七八九十]+)?", dirname.strip())
        if m and (m.group(2) or m.group(4)):
            if m.group(2):
                return ("第" if m.group(1) else "") + m.group(2) + m.group(3)
            return m.group(3) + m.group(4)
        return _strip_num(dirname)
    if mode == "level_vol":
        m = re.search(r"第([一二三四五六七八九十]+)级.*?卷\s*([一二三四五六七八九十]+)", dirname)
        if m:
            return f"第{m.group(1)}级 卷{m.group(2)}"
        return _strip_num(dirname)
    title = _strip_num(dirname)
    return BOOK_TITLE_FIX.get(dirname) or BOOK_TITLE_FIX.get(title) or title


def _emit_book(title, chapters, num=None):
    """books 条目。num = 源侧真实编号（可空）：
    ezoe 书报号 / 灵粮目录序号 / 倪文集册内 book_number——只作检索与展示用，
    不参与 (volume,book,chapter) 索引定位，缺号的书不写该字段。"""
    book = {"title": title, "chapters": chapters}
    if num is not None:
        book["num"] = num
    return book


def _read_dir_chapters(dirpath, opts, book_title, only=None, root_order=None):
    """读一个书目录 → [{title, content}]：剥页眉、清残留、重排、同书内精确去重

    同书内重复篇按**墓碑化**处理（保留条目与顺序，正文换指引）——与 ezoe 同一纪律：
    删除条目会让后续章索引前移，旧标注错位。"""
    files = only if only is not None else [
        f for f in os.listdir(dirpath) if f.lower().endswith(".md")]
    if root_order:
        def order(fn):
            stem = _stem(fn)
            for i, k in enumerate(root_order):
                if k in stem:
                    return (i, stem)
            return (len(root_order), stem)
        files = sorted(files, key=order)
    else:
        files = sorted(files, key=lambda fn: (_num_prefix(fn), fn))
    out = []
    seen = {}   # 归一正文 hash → 首篇标题（墓碑指引用）
    for fn in files:
        if _stem(fn) in opts.get("skip_files", []):
            continue
        lines = _read_lines(os.path.join(dirpath, fn))
        if not lines:
            continue
        raw = "\n".join(lines)
        if any(m in raw for m in opts.get("skip_content", [])):
            continue
        title = _md_title(lines) or _strip_num(_stem(fn))
        body = lines[1:] if lines[0].startswith("#") else lines
        content = "\n".join(_clean_lines(body, title, book_title, opts))
        if not content:
            continue
        if any(m in content for m in opts.get("skip_content", [])):
            continue
        key = _key(content)
        h = hashlib.md5(key.encode()).hexdigest() if len(key) >= 80 else None
        if h and h in seen:
            content = f"（本文与「{seen[h]}」相同，为免重复不再载入，请阅读该篇。）"
        elif h:
            seen[h] = title
        out.append({"title": title, "content": content})
    return out


def export_devotional(opts):
    """荒漠甘泉：36 个文件各含 10-11 天，按《荒漠甘泉》M月D日 切成 365 篇"""
    src_dir = os.path.join(BASE, opts["src"])
    chapters = []
    for fn in sorted(os.listdir(src_dir), key=lambda f: (_num_prefix(f), f)):
        if not fn.lower().endswith(".md"):
            continue
        cur_title, buf = "", []
        for ln in _read_lines(os.path.join(src_dir, fn)):
            # 文件级爬取页脚不归入当天正文（每个文件末篇会撞上）
            if re.match(r"^\*\*(来源|URL|获取时间|书报号|说明)\*\*", ln) or ln == "---":
                continue
            m = re.match(r"^《荒漠甘泉》\s*(\d+)月(\d+)日$", ln)
            if m:
                if cur_title:
                    chapters.append({"title": cur_title,
                                     "content": _strip_web_noise("\n".join(buf))})
                cur_title = f"{m.group(1)}月{m.group(2)}日"
                buf = []
            elif cur_title:
                buf.append(ln)
        if cur_title:
            chapters.append({"title": cur_title,
                             "content": _strip_web_noise("\n".join(buf))})
    chapters = [c for c in chapters if c["content"].strip()]
    book = _emit_book("每日灵修", chapters)
    meta = {"name": opts["name"], "volumes": [{"title": opts["name"], "books": [book]}]}
    return meta, [{"volume": opts["name"], "books": [book]}]


def export_legacy(series_id):
    """灵粮 legacy 源通用导出（形态见本节顶部注释）"""
    opts = dict(LEGACY_SERIES[series_id])
    opts.setdefault("strip_web", True)   # 网页残留清理对所有 legacy 源默认开启
    if opts.get("mode") == "devotional":
        return export_devotional(opts)
    src_dir = os.path.join(BASE, opts["src"])
    entries = []   # (目录编号, book)；根级散篇编号 -1

    root_files = [f for f in os.listdir(src_dir)
                  if f.lower().endswith(".md") and _stem(f) not in opts.get("skip_files", [])]
    if root_files:
        bt = opts.get("root_book_title") or opts["name"]
        chs = _read_dir_chapters(src_dir, opts, bt, only=root_files,
                                 root_order=opts.get("root_order"))
        if chs:
            entries.append((-1, _emit_book(bt, chs)))

    dirs = [d for d in os.listdir(src_dir) if os.path.isdir(os.path.join(src_dir, d))]
    dirs = [d for d in dirs
            if d not in opts.get("skip_dirs", []) and _num_prefix(d) not in opts.get("skip_nums", [])]
    dirs.sort(key=lambda d: (_num_prefix(d), _cn_sort(d), d))
    for d in dirs:
        p = os.path.join(src_dir, d)
        num = _num_prefix(d)
        bnum = num if num != 10 ** 6 else None   # 无数字前缀的目录不写编号
        subdirs = [x for x in os.listdir(p) if os.path.isdir(os.path.join(p, x))]
        has_md = any(f.lower().endswith(".md") for f in os.listdir(p)
                     if os.path.isfile(os.path.join(p, f)))
        if opts.get("two_level"):
            # 卷/期 两层（肯定与否定）：每期一个 book 条目，避免同名篇目跨期冲突
            for sd in sorted(subdirs, key=lambda x: (_cn_sort(x), x)):
                bt = f"{_strip_num(d)}·{_strip_num(sd)}"
                chs = _read_dir_chapters(os.path.join(p, sd), opts, bt)
                if chs:
                    entries.append((num, _emit_book(bt, chs, bnum)))
        elif subdirs and not has_md:
            # 目录下只有子目录（属灵书报的 086/098/110）：子目录提升为 book
            for sd in sorted(subdirs, key=lambda x: (_num_prefix(x), _cn_sort(x), x)):
                bt = f"{_book_title_from_dir(d, opts)}·{_strip_num(sd)}"
                chs = _read_dir_chapters(os.path.join(p, sd), opts, bt)
                if chs:
                    entries.append((num, _emit_book(bt, chs, bnum)))
        else:
            bt = _book_title_from_dir(d, opts)
            chs = _read_dir_chapters(p, opts, bt)
            if chs:
                entries.append((num, _emit_book(bt, chs, bnum)))

    entries.sort(key=lambda x: x[0])
    if opts.get("volumes"):
        # 固定编号区间分卷（写死区间，不按体积计算——重复导出时索引稳定）
        vols = []
        for a, b, vtitle in opts["volumes"]:
            vols.append({"volume": vtitle, "books": [bd for n, bd in entries if a <= n <= b]})
    else:
        vols = [{"volume": opts["name"], "books": [bd for _, bd in entries]}]
    vols = [v for v in vols if v["books"]]
    meta = {"name": opts["name"],
            "volumes": [{"title": v["volume"], "books": v["books"]} for v in vols]}
    return meta, vols


def export_ezoe_split(cat_name, parts, vol_titles=None, cuts=None):
    """ezoe 待接入分类：复用 ezoe_category_books（含墓碑去重），
    清网页残留后切卷。**分卷边界写死**（cuts）而非按体积/书数动态计算——上线后
    书目数量变化不得让 (volume,book,chapter) 索引漂移。"""
    books = ezoe_category_books(cat_name)
    for b in books:
        for c in b["chapters"]:
            c["content"] = _strip_web_noise(c["content"])
    n = len(books)
    titles = vol_titles or ([f"第{i + 1}部分" for i in range(parts)] if parts > 1 else [cat_name])
    if parts <= 1:
        segs = [books]
    elif cuts:
        bounds = [0] + [c for c in cuts if 0 < c < n] + [n]
        segs = [books[bounds[i]:bounds[i + 1]] for i in range(len(bounds) - 1)]
    else:
        step = (n + parts - 1) // parts
        segs = [books[i * step:(i + 1) * step] for i in range(parts)]
    vols = []
    for i, seg in enumerate(segs):
        if seg:
            vols.append({"volume": titles[i] if i < len(titles) else f"第{i + 1}部分",
                         "books": seg})
    meta = {"name": cat_name,
            "volumes": [{"title": v["volume"], "books": v["books"]} for v in vols]}
    return meta, vols


# 灵粮 legacy 源注册表（id = 路由/数据文件名；skip_nums 为源目录编号前缀）
LEGACY_SERIES = {
    "sg": dict(src="属灵书报", name="属灵书报", dir_title="book",
               skip_nums=[3, 6, 7, 59, 119, 142, 150, 178], strip_web=True,
               volumes=[(1, 47, "第一辑"), (48, 97, "第二辑"),
                        (98, 148, "第三辑"), (149, 217, "第四辑")]),
    "th": dict(src="特会信息", name="特会信息", dir_title="book",
               # 与结晶读经逐字重复的 14 本（保留篇目更全的结晶读经版）
               skip_nums=[4, 7, 11, 14, 18, 21, 25, 28, 33, 36, 41, 44, 50, 53]),
    "jd": dict(src="结晶读经", name="结晶读经", dir_title="book"),
    "sjzl": dict(src="圣经之旅", name="圣经之旅", dir_title="vol"),
    "xyzl": dict(src="新约总论", name="新约总论", dir_title="vol",
                 skip_content=["此处为节选"]),   # 源站多出的节选残篇
    "zlyd": dict(src="圣经要道", name="圣经要道", dir_title="vol"),
    "zlkc": dict(src="真理课程", name="真理课程", dir_title="level_vol"),
    "smkc": dict(src="生命课程", name="生命课程", dir_title="vol"),
    "sjyn": dict(src="圣经疑难", name="圣经疑难", dir_title="book"),
    "jkhy": dict(src="健康话语的规范", name="健康话语的规范", dir_title="book",
                 root_book_title="总论与说明",
                 root_order=["内容简介", "前言", "教学注意事项", "短期训练手册"]),
    "zlzt": dict(src="真理专题", name="真理专题", dir_title="book"),
    "zlpz": dict(src="真理的辨正", name="真理的辨正", dir_title="book"),
    "kdyf": dict(src="肯定与否定", name="肯定与否定", dir_title="book", two_level=True),
    "jpl": dict(src="解剖毒瘤", name="解剖毒瘤", dir_title="book"),
    "hhls": dict(src="召会历史", name="召会历史", dir_title="vol",
                 root_book_title="卷首与纲目",
                 root_order=["编者的话", "作者", "纲目"],
                 skip_dirs=["两千年教会历史"]),   # 与根级《教会历史纲目》重复
    "tllc": dict(src="天路历程", name="天路历程", dir_title="book"),
    "xblm": dict(src="希伯来民族简史", name="希伯来民族简史", dir_title="book"),
    "hmgq": dict(src="荒漠甘泉", name="荒漠甘泉", mode="devotional"),
    "zjgs": dict(src="造就故事", name="造就故事", dir_title="book"),
    "sl": dict(src="拾零", name="拾零", dir_title="book",
               skip_dirs=["在召会生活中父母的职任"],   # 与属灵书报 214 重复
               skip_files=["无限的体谅，不死的爱。", "走出迷梦人生", "逾格恩典"]),  # 与福音天地重复
    "zsxx": dict(src="职事信息", name="职事信息", dir_title="book"),
    "cqxl": dict(src="成全训练信息", name="成全训练信息", dir_title="book"),
}


SERIES = {
    "ni": export_ni,
    "slat": export_slat,   # 十二篮（slat = 十二篮英译通称 Twelve Baskets 的篮）
    "bio": export_bio,     # 传记与文集（bio 原子集 + ezoe 传记、文集类合并，单一 volume）
    "fuyintiandi": export_gospelfood,   # 福音天地（网页版灵粮文集 + ezoe 吸收合并正版）
}
# ezoe 书报合辑（bible 项目 2026-10-12 入库）：每个分类 = 独立系列，平级进书报合集层
# （用户 2026-10-13 定稿：类别即系列，不再裹成「ezoe书报合辑」大系列切辑）。
# EZOE_FIRST 为首批接入；edification/church 单辑产物超 CF 25MB 限，待拆分方案后补入
for _cid, _cname in EZOE_CATS:
    if _cid in EZOE_FIRST:
        SERIES[_cid] = functools.partial(export_ezoe_cat, _cid, _cname)

# ezoe 剩余两类（2026-10-19 全量导入）：造就类 38MB 切 2 卷、教会与事奉类单卷，
# 均在 CF Pages 25MB 单文件限内；墓碑篇目（absorbed/duplicate）保留原位指向既有灵粮
SERIES["zj"] = functools.partial(export_ezoe_split, "造就类", 2, ["上卷", "下卷"], cuts=[116])
SERIES["jh"] = functools.partial(export_ezoe_split, "教会与事奉类", 1)

# 灵粮 legacy 源（23 个来源 → 22 个系列；图表与地图为空壳、诗歌待专用排版，均不接）
for _sid in LEGACY_SERIES:
    SERIES[_sid] = functools.partial(export_legacy, _sid)

# 合集层次序（index.json 输出顺序 = 合集块与抽屉里的展示顺序，前端不排序）
SERIES_ORDER = [
    "ni", "slat", "bio", "fuyintiandi",
    # 圣经研究
    "xyzl", "jd", "sjzl", "zlkc", "smkc", "zlyd",
    # 职事与训练
    "th", "zsxx", "cqxl",
    # 属灵书报
    "sg",
    # 福音与布道
    "gospel", "jh",
    # 真理专题
    "zlzt", "kdyf", "zlpz", "jpl",
    # 历史与传记
    "hhls", "tllc", "xblm",
    # 生命造就
    "jkhy", "zjgs", "hmgq", "sl", "zj",
    # 工具与参考
    "sjyn",
    # 期刊与其他
    "periodicals", "misc", "reading",
]


def export(only=None, numbers_only=False):
    os.makedirs(OUT, exist_ok=True)
    ids = only or list(SERIES)
    if numbers_only:
        # --numbers：只跑各系列构建器、只写编号表，**不碰任何内容文件**
        # （gospel 等冻结系列重导会让索引位移，编号表必须能单独产出）。
        out = {}
        for sid in ids:
            if sid not in SERIES:
                print(f"[SKIP] 未知系列 id：{sid}")
                continue
            meta, _ = SERIES[sid]()
            rows = [[vi, bi, b["num"]]
                    for vi, v in enumerate(meta["volumes"], 1)
                    for bi, b in enumerate(v["books"]) if b.get("num")]
            if rows:
                out[sid] = rows
        _order = {sid: i for i, sid in enumerate(SERIES_ORDER)}
        out = {k: out[k] for k in sorted(out, key=lambda s: (_order.get(s, len(_order)), s))}
        path = os.path.join(OUT, "numbers.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[NUM] {len(out)} 个系列 / {sum(len(v) for v in out.values())} 本带编号 -> {path}")
        return 0
    with open(os.path.join(OUT, "index.json"), encoding="utf-8") as f:
        series_index = json.load(f)
    for sid in ids:
        if sid not in SERIES:
            print(f"[SKIP] 未知系列 id：{sid}")
            continue
        meta, volumes_content = SERIES[sid]()
        meta_light = {
            "name": meta["name"],
            "volumes": [{"title": v["title"], "books": [
                dict({"title": b["title"],
                      "chapters": [c["title"] for c in b["chapters"]]},
                     **({"num": b["num"]} if b.get("num") else {}))
                for b in v["books"]]} for v in meta["volumes"]],
        }
        n_vol, n_book, n_ch = write_volume_files(sid, meta_light, volumes_content)
        entry = {"id": sid, "name": meta_light["name"], "volumes": n_vol}
        series_index["series"] = [s for s in series_index.get("series", []) if s.get("id") != sid]
        series_index["series"].append(entry)
        print(f"[DONE] {sid}：{n_vol} 辑 / {n_book} 本 / {n_ch} 章")
    # 按 SERIES_ORDER 输出（合集块展示顺序）；未登记的系列排在末尾
    _order = {sid: i for i, sid in enumerate(SERIES_ORDER)}
    series_index["series"].sort(key=lambda s: (_order.get(s.get("id"), len(_order)), s.get("id", "")))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(series_index, f, ensure_ascii=False, separators=(",", ":"))
    print("")
    print(f"系列清单 -> {os.path.join(OUT, 'index.json')}（{len(series_index['series'])} 个系列）")


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--numbers" in argv:
        rest = [a for a in argv if a != "--numbers"]
        sys.exit(export(rest or None, numbers_only=True))
    sys.exit(export(argv or None))
