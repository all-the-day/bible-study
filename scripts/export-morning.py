#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""晨兴数据导出：反编译晨读 APK 资源 → data/morning/

输入（只读）：
  d:/迅雷下载/晨读appRes/resources/assets/public/
    trainings.json              → 训练计划总览（期索引）
    {期}/training.json          → 每期：title/subtitle/chapters

输出：
  data/morning/index.json       → {trainings: [{id, title, subtitle, season, year, chapters}]}
  data/morning/{期}.json        → {id, title, subtitle, year, season, chapters: [...]}

用法：
  python export-morning.py                        # 默认导出当年（今年）所有期
  python export-morning.py --exclude 2026-01 2026-02   # 排除已过去的期
  python export-morning.py --all                  # 导出全部期（含往年）

每 chapter（一篇信息）：
  {number, title, scripture,
   content: 纯文本（信息正文「听抄」：detail_sections 树形层级标题 + 段落，
            供标注坐标系与阅读渲染）}
（只保留听抄数据；纲目 outline_sections / 六天晨兴 morning_revivals 不导出）
"""
import argparse
import datetime
import json
import os
import sys

PUBLIC = r"d:/迅雷下载/晨读appRes/resources/assets/public"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "morning")


def flatten_detail(nodes, out):
    """detail_sections 树 → 扁平 [{level, title, paragraphs}]（听抄层级）"""
    for n in nodes or []:
        paragraphs = [p for p in (n.get("content") or []) if isinstance(p, str) and p.strip()]
        out.append({"level": n.get("level", ""), "title": n.get("title", ""), "paragraphs": paragraphs})
        flatten_detail(n.get("children") or [], out)


def build_content(detail):
    """听抄纯文本：层级标题行 + 段落（标题前缀如「壹」「一」「1」（一）《一》等）"""
    lines = []
    for d in detail:
        if d["title"].strip():
            lines.append(d["title"].strip())
        lines.extend(p.strip() for p in d["paragraphs"] if p.strip())
    return "\n".join(l for l in lines if l)


def export():
    parser = argparse.ArgumentParser(description="晨兴数据导出")
    parser.add_argument("--exclude", nargs="*", default=[], help="排除的期（如 2026-01 2026-02）")
    parser.add_argument("--all", action="store_true", help="导出全部期（含往年，默认只导当年）")
    args = parser.parse_args()

    this_year = datetime.date.today().year
    exclude = set(args.exclude)
    os.makedirs(OUT, exist_ok=True)
    index = {"trainings": []}
    total_chapters = 0
    selected = []   # 本次导出的期 id（用于清理旧期文件）

    with open(os.path.join(PUBLIC, "trainings.json"), encoding="utf-8") as f:
        trainings = json.load(f)["trainings"]

    for t in trainings:
        path = t.get("path")
        year = t.get("year")
        # 期范围过滤：默认只导当年；--all 全量；--exclude 排除指定期
        if not args.all and year != this_year:
            continue
        if path in exclude:
            continue
        tjson = os.path.join(PUBLIC, path, "training.json")
        if not os.path.exists(tjson):
            print(f"  skip {path}（目录不在包内）")
            continue
        selected.append(path)
        with open(tjson, encoding="utf-8") as f:
            data = json.load(f)
        chapters = []
        for ch in data.get("chapters") or []:
            detail = []
            flatten_detail(ch.get("detail_sections") or [], detail)
            ch_out = {
                "number": ch.get("number"),
                "title": ch.get("title", ""),
                "scripture": ch.get("scripture", ""),
                "content": build_content(detail),
            }
            chapters.append(ch_out)

        period = {
            "id": path,
            "title": data.get("title", ""),
            "subtitle": data.get("subtitle", ""),
            "year": data.get("year"),
            "season": data.get("season", ""),
            "mottos": data.get("mottos") or [],
            "chapters": chapters,
        }
        with open(os.path.join(OUT, path + ".json"), "w", encoding="utf-8") as f:
            json.dump(period, f, ensure_ascii=False, separators=(",", ":"))
        index["trainings"].append({
            "id": path,
            "title": t.get("title", ""),
            "subtitle": t.get("subtitle", ""),
            "season": t.get("season", ""),
            "year": t.get("year"),
            "chapters": len(chapters),
        })
        total_chapters += len(chapters)
        print(f"  [OK] {path} {data.get('title','')}（{len(chapters)} 篇）")

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    # 清理旧期文件（不在本次导出范围则删除，避免 index 与实际文件不一致）
    for fn in os.listdir(OUT):
        if fn.endswith(".json") and fn != "index.json":
            period_id = fn[:-5]
            if period_id not in selected:
                os.remove(os.path.join(OUT, fn))
                print(f"  [del] {fn}（不在导出范围）")
    print(f"\n完成：{len(index['trainings'])} 期 / {total_chapters} 篇 -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    sys.exit(export())