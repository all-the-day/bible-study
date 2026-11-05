#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""migrate-outlines.py — 按 cleanup-map 把纲目策展源迁到新坐标

旧键 "v:b:c" → 新键 "v:b:c"（或删除）。因为正文没变，条目文本仍逐行可校验；
迁移后由 build-book-outlines.py 重跑一遍确认零失配。

用法：
  python scripts/migrate-outlines.py --check   # 只报告
  python scripts/migrate-outlines.py           # 写回 scripts/outline-src/
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "scripts", "outline-src")
MAP = os.path.join(ROOT, "data", "books", "cleanup-map.json")


def main():
    check = "--check" in sys.argv
    m = json.load(open(MAP, encoding="utf-8"))
    book_map, chap_map = m["bookMap"], m["chapterMap"]
    total_moved = total_dropped = 0
    report = []
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".json"):
            continue
        sid = fn[:-5]
        if sid not in book_map:
            continue
        path = os.path.join(SRC, fn)
        doc = json.load(open(path, encoding="utf-8"))
        chapters = doc.get("chapters") or {}
        bm, cm = book_map[sid], chap_map[sid]
        new_ch, moved, dropped = {}, 0, 0
        for key, entries in chapters.items():
            v, b, c = key.split(":")
            bk = f"{v}:{b}"
            if bk in bm and bm[bk] is None:
                dropped += 1
                continue
            ck = f"{v}:{b}:{c}"
            if ck in cm:
                nk = cm[ck]
                if nk is None:
                    dropped += 1
                    continue
                if nk != ck:
                    moved += 1
                new_ch[nk] = entries
                continue
            new_ch[ck] = entries
        total_moved += moved
        total_dropped += dropped
        if moved or dropped:
            report.append(f"{sid}: 迁移 {moved} 章 / 删除 {dropped} 章")
            if not check:
                doc["chapters"] = dict(sorted(new_ch.items(),
                                              key=lambda kv: tuple(int(x) for x in kv[0].split(":"))))
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    for r in report:
        print("  ", r)
    print(f"[{'CHECK' if check else 'OK'}] 共迁移 {total_moved} 章 / 删除 {total_dropped} 章")
    return 0


if __name__ == "__main__":
    sys.exit(main())
