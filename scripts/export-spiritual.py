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


def read_md(path):
    """md 文件 → (标题, 正文)。首行 # 标题；正文去掉标题行，保留段落"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    title = ""
    if lines and TITLE_RE.match(lines[0]):
        title = TITLE_RE.match(lines[0]).group(1).strip()
    body = [ln.strip() for ln in lines[1:] if ln.strip()]
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
        title, content = read_md(path)
        if not title:
            title = it.get("title") or re.sub(r"^\d+\s*", "", fn[:-3])
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
    """名人传记：{系列}目录索引.json（items 扁平，local_rel=「子集[/册目录]/NNN标题.md」）
    + 子集目录/NNN标题.md。子集 = books 条目（title=子集名、chapters=篇列表）；
    王明道文库精选的「册」目录折叠为册级 books 条目（「王明道文库精选·第一册」）。
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
        title, content = read_md(path)
        if not title:
            title = it.get("title") or re.sub(r"^\d+\s*", "", parts[-1][:-3])
        # 分组键：一级「子集/文件」→子集；「王明道文库精选/第N册…/文件」→册级
        if parts[0] == "王明道文库精选" and len(parts) >= 3:
            m_vol = re.search(r"第([一二三四五六七八九十]+)册", parts[1])
            group = "王明道文库精选·" + (m_vol.group(0) if m_vol else parts[1].replace("　", " ").strip())
        else:
            group = parts[0]
        by_group.setdefault(group, []).append({"title": title, "content": content})

    name = idx.get("series", "名人传记")
    meta = {"name": name, "volumes": []}
    volumes_content = []
    # 单一 volume（名人传记无辑级），所有子集作为 books 条目
    books = [{"title": g, "chapters": by_group[g]} for g in by_group]
    meta["volumes"].append({"title": name, "books": books})
    volumes_content.append({"volume": name, "books": books})
    return meta, volumes_content


SERIES = {
    "ni": export_ni,
    "slat": export_slat,   # 十二篮（slat = 十二篮英译通称 Twelve Baskets 的篮）
    "bio": export_bio,     # 名人传记（16 个子集各成 books 条目，单一 volume）
}


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
if __name__ == "__main__":
    sys.exit(export())
