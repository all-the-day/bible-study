#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""migrate-user-data.py — 把浏览器 localStorage 里的书报标注/笔记迁到清理后的坐标

为什么单独一个工具、且不自动跑：书报的**大段笔记键 `v:b:c` 里没有系列名**
（app.js 的 LS_BOOK_NOTES），而本次清理删除了 79 本书、前移了大量条目。
同一条笔记可能对应多个系列的同坐标，自动猜会写错。所以：
  - 标注（annotations）带 `series`，可以精确迁移；
  - 大段笔记只能按「唯一命中」迁移，多个系列都命中的键**保持原样并报告**。

用法（在浏览器控制台或 Node 里跑，先备份）：
  python scripts/migrate-user-data.py --dump > user-data-backup.json   # 先导出备份
  然后把 dump 出来的 json 传给本脚本做迁移，产出可直接回填的 json。

本脚本只做纯函数变换，不读写浏览器。
"""
import json
import sys

MAP = "data/books/cleanup-map.json"


def migrate(annotations, book_notes, chapter_map, book_map):
    """返回 (新标注, 新笔记, 报告)。删除的目标（None）直接丢弃。"""
    rep = {"ann_moved": 0, "ann_dropped": 0, "note_moved": 0,
           "note_dropped": 0, "note_ambiguous": []}
    out_ann = []
    for a in annotations:
        if a.get("type") != "book":
            out_ann.append(a)
            continue
        sid = a.get("series")
        cm = chapter_map.get(sid) or {}
        key = f"{a.get('volume')}:{a.get('book')}:{a.get('chapter')}"
        nk = cm.get(key)
        if nk is None:
            rep["ann_dropped"] += 1
            continue
        if nk != key:
            v, b, c = (int(x) for x in nk.split(":"))
            a = dict(a, volume=v, book=b, chapter=c)
            rep["ann_moved"] += 1
        out_ann.append(a)

    # 大段笔记：键无系列 → 在所有系列里找唯一命中
    out_notes = {}
    for key, text in (book_notes or {}).items():
        if not isinstance(text, str) or not text.strip():
            continue
        hits = set()
        for sid, cm in chapter_map.items():
            nk = cm.get(key)
            if nk is not None:
                hits.add(nk)
        if not hits:
            rep["note_dropped"] += 1
            continue
        if len(hits) > 1:
            rep["note_ambiguous"].append({"key": key, "candidates": sorted(hits)})
            out_notes[key] = text          # 保留原键，等人工确认
            continue
        nk = hits.pop()
        if nk != key:
            rep["note_moved"] += 1
        out_notes[nk] = text
    return out_ann, out_notes, rep


if __name__ == "__main__":
    with open(MAP, encoding="utf-8") as f:
        m = json.load(f)
    payload = json.load(sys.stdin)
    ann, notes, rep = migrate(payload.get("annotations") or [],
                              payload.get("bookNotes") or {},
                              m["chapterMap"], m["bookMap"])
    json.dump({"annotations": ann, "bookNotes": notes, "report": rep},
              sys.stdout, ensure_ascii=False, indent=1)
