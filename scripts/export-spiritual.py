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
    """
    src_dir = os.path.join(BASE, "ezoe书报合辑")
    with open(os.path.join(src_dir, "目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)
    cat = next((c for c in (idx.get("categories") or []) if c.get("name") == cat_name), None)
    if not cat:
        print(f"  [WARN] ezoe 分类不存在：{cat_name}")
        return []

    books = []
    for b in (cat.get("books") or []):
        chs = [ch for ch in (b.get("chapters") or [])
               if ch.get("status") == "saved" and ch.get("local_rel")]
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
                path = os.path.join(src_dir, ch["local_rel"])
                if not os.path.isfile(path):
                    print(f"  [WARN] 文件缺失：{path}")
                    continue
                content = read_ezoe_md(path)
                ctitle = ch.get("title") or re.sub(r"^\d+\s*", "", os.path.basename(path)[:-3])
                chapters.append({"title": ctitle, "content": content})
            if chapters:
                books.append({"title": title, "chapters": chapters})
    return books


def export_ezoe_cat(cat_id, cat_name):
    """ezoe 单个分类 → 独立系列（name=分类名，单 volume 多 books，同 bio 形态）。
    书/篇构建见 ezoe_category_books。"""
    books = ezoe_category_books(cat_name)
    meta = {"name": cat_name, "volumes": [{"title": cat_name, "books": books}]}
    volumes_content = [{"volume": cat_name, "books": books}]
    return meta, volumes_content


SERIES = {
    "ni": export_ni,
    "slat": export_slat,   # 十二篮（slat = 十二篮英译通称 Twelve Baskets 的篮）
    "bio": export_bio,     # 传记与文集（bio 原子集 + ezoe 传记、文集类合并，单一 volume）
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
