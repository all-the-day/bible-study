#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""倪柝声文集导出：bible 项目灵粮 → data/books/

输入（只读）：
  ../bible/data/raw/spiritual_food/倪柝声文集/
    倪柝声文集目录索引.json      → volumes → books_list（含每章标题）
    {辑}/                          → {目录}/NNN{标题}.md 章节正文

输出：
  data/books/index.json         → 系列清单 {series: [{id, name, volumes}]}（前端左栏系列条）
  data/books/{id}.json          → 元数据（轻量，不含正文）{name, volumes: [{title, books: [{title, chapters: [标题]}]}]}
  data/books/{id}-{辑号}.json   → 按辑内容 {volume, books: [{title, chapters: [{title, content}]}]}
                                  （1325 章体积大，按辑懒加载）

用法：
  python export-spiritual.py                # 导出倪柝声文集（当前唯一系列）
  后续新系列：脚本扩展 series 清单后同构导出
"""
import json
import os
import re
import sys

SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "bible", "data", "raw", "spiritual_food", "倪柝声文集"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "books")

TITLE_RE = re.compile(r"^\s*#\s+(.*?)\s*$")
VOL_NO = {"第一辑": "1", "第二辑": "2", "第三辑": "3"}


def read_md(path):
    """md 文件 → (标题, 正文)。首行 # 标题；正文去掉标题行，保留段落"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    title = ""
    if lines and TITLE_RE.match(lines[0]):
        title = TITLE_RE.match(lines[0]).group(1).strip()
    body = [ln.strip() for ln in lines[1:] if ln.strip()]
    if not title and body:
        title = body[0]
        body = body[1:]
    return title, "\n".join(body)


def export():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(SRC, "倪柝声文集目录索引.json"), encoding="utf-8") as f:
        idx = json.load(f)

    meta = {"name": idx.get("title", "倪柝声文集"), "volumes": []}
    total_books = total_chapters = 0

    for vol_key, vol in (idx.get("volumes") or {}).items():
        vol_title = vol.get("title") or vol_key
        vol_dir = vol.get("directory")
        vol_no = VOL_NO.get(vol_key, vol_key)
        books = []
        for b in (vol.get("books_list") or []):
            bdir = os.path.join(SRC, vol_dir, b["directory"])
            if not os.path.isdir(bdir):
                print(f"  [WARN] 目录缺失：{bdir}")
                continue
            # 文件按数字前缀排序（001、002…），与索引 chapters_list 按序配对
            files = sorted([fn for fn in os.listdir(bdir) if fn.endswith(".md")])
            expected = b.get("chapters_list") or []
            chapters = []
            for i, fn in enumerate(files):
                title, content = read_md(os.path.join(bdir, fn))
                if not title:
                    title = re.sub(r"^\d+\s*", "", fn[:-3])  # 文件名去数字前缀兜底
                chapters.append({"title": title, "content": content})
            if len(chapters) < len(expected):
                print(f"  [WARN] {b.get('title','')}：文件 {len(chapters)} 章 < 索引 {len(expected)} 章")
            books.append({"title": b.get("title", ""), "chapters": chapters})
            total_books += 1
            total_chapters += len(chapters)

        meta["volumes"].append({"title": vol_title, "books": books})
        with open(os.path.join(OUT, f"ni-{vol_no}.json"), "w", encoding="utf-8") as f:
            json.dump({"volume": vol_title, "books": books}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[OK] {vol_title}：{len(books)} 本 / {sum(len(x['chapters']) for x in books)} 章")

    # 元数据：只留标题（正文在 {id}-{n}.json，避免 24MB 单文件）
    meta_light = {
        "name": meta["name"],
        "volumes": [{"title": v["title"], "books": [{"title": b["title"], "chapters": [c["title"] for c in b["chapters"]]} for b in v["books"]]} for v in meta["volumes"]],
    }
    with open(os.path.join(OUT, "ni.json"), "w", encoding="utf-8") as f:
        json.dump(meta_light, f, ensure_ascii=False, separators=(",", ":"))

    # 系列索引（前端左栏系列条；后续新系列同构追加）
    series_index_path = os.path.join(OUT, "index.json")
    series_index = {"series": []}
    if os.path.exists(series_index_path):
        with open(series_index_path, encoding="utf-8") as f:
            series_index = json.load(f)
    entry = {"id": "ni", "name": meta_light["name"], "volumes": len(meta_light["volumes"])}
    series_index["series"] = [s for s in series_index.get("series", []) if s.get("id") != "ni"]
    series_index["series"].append(entry)
    series_index["series"].sort(key=lambda s: s["id"])
    with open(series_index_path, "w", encoding="utf-8") as f:
        json.dump(series_index, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n完成：{len(meta['volumes'])} 辑 / {total_books} 本 / {total_chapters} 章 -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    sys.exit(export())
