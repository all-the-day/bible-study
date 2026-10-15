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
            books.append({"title": b.get("title", ""), "chapters": chapters})
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
                books.append({"title": title, "chapters": chapters})
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
            books.append({"title": dir_name, "chapters": chapters})
    name = "福音天地"
    meta = {"name": name, "volumes": [{"title": name, "books": books}]}
    volumes_content = [{"volume": name, "books": books}]
    return meta, volumes_content


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


def export(only=None):
    os.makedirs(OUT, exist_ok=True)
    ids = only or list(SERIES)
    with open(os.path.join(OUT, "index.json"), encoding="utf-8") as f:
        series_index = json.load(f)
    for sid in ids:
        if sid not in SERIES:
            print(f"[SKIP] 未知系列 id：{sid}")
            continue
        meta, volumes_content = SERIES[sid]()
        meta_light = {
            "name": meta["name"],
            "volumes": [{"title": v["title"], "books": [{"title": b["title"], "chapters": [c["title"] for c in b["chapters"]]} for b in v["books"]]} for v in meta["volumes"]],
        }
        n_vol, n_book, n_ch = write_volume_files(sid, meta_light, volumes_content)
        entry = {"id": sid, "name": meta_light["name"], "volumes": n_vol}
        series_index["series"] = [s for s in series_index.get("series", []) if s.get("id") != sid]
        series_index["series"].append(entry)
        print(f"[DONE] {sid}：{n_vol} 辑 / {n_book} 本 / {n_ch} 章")
    series_index["series"].sort(key=lambda s: s["id"])
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(series_index, f, ensure_ascii=False, separators=(",", ":"))
    print("")
    print(f"系列清单 -> {os.path.join(OUT, 'index.json')}（{len(series_index['series'])} 个系列）")


if __name__ == "__main__":
    sys.exit(export(sys.argv[1:] or None))
