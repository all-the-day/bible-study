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
  {number, title, hymn_number, scripture,
   outline:  [{level, title}] 扁平纲目,
   detail:   [{level, title, paragraphs}] 信息正文,
   morning_revivals: [{day, outline: [{level,title}], morning_feeding, message_reading, ref_reading}],
   content:  纯文本（标题+纲目+正文+六天晨兴），供标注坐标系与阅读渲染}
"""
import argparse
import datetime
import json
import os
import sys

PUBLIC = r"d:/迅雷下载/晨读appRes/resources/assets/public"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "morning")


def flatten_outline(nodes, out):
    """纲目树 → 扁平 [{level, title}]（保留层级顺序）"""
    for n in nodes or []:
        out.append({"level": n.get("level", ""), "title": n.get("title", "")})
        flatten_outline(n.get("children") or [], out)


def flatten_detail(nodes, out):
    """detail_sections 树 → 扁平 [{level, title, paragraphs}]"""
    for n in nodes or []:
        paragraphs = [p for p in (n.get("content") or []) if isinstance(p, str) and p.strip()]
        out.append({"level": n.get("level", ""), "title": n.get("title", ""), "paragraphs": paragraphs})
        flatten_detail(n.get("children") or [], out)


def build_content(ch):
    """整篇拼纯文本（供标注坐标系，与 lifereading 的 content 同模式）"""
    lines = []
    lines.append(ch.get("title", ""))
    if ch.get("scripture"):
        lines.append("经文：" + ch["scripture"])
    for o in ch.get("_outline", []):
        if o["title"].strip():
            lines.append(o["title"].strip())
    for d in ch.get("_detail", []):
        if d["title"].strip():
            lines.append(d["title"].strip())
        lines.extend(p.strip() for p in d["paragraphs"] if p.strip())
    for m in ch.get("_mr", []):
        lines.append(m["_header"])
        for field, label in (("morning_feeding", "晨兴喂养"), ("message_reading", "信息选读"), ("ref_reading", "参考阅读")):
            text = m.get(field)
            if text and str(text).strip():
                lines.append(label + "：" + str(text).strip())
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
            outline = []
            flatten_outline(ch.get("outline_sections") or [], outline)
            detail = []
            flatten_detail(ch.get("detail_sections") or [], detail)
            mrs = []
            for mr in ch.get("morning_revivals") or []:
                m_outline = []
                flatten_outline(mr.get("outline") or [], m_outline)
                mrs.append({
                    "day": mr.get("day", ""),
                    "outline": m_outline,
                    "feeding_scriptures": mr.get("feeding_scriptures") or [],
                    "morning_feeding": mr.get("morning_feeding") or "",
                    "message_reading": mr.get("message_reading") or "",
                    "ref_reading": mr.get("ref_reading") or "",
                })
            ch_out = {
                "number": ch.get("number"),
                "title": ch.get("title", ""),
                "hymn_number": ch.get("hymn_number", ""),
                "scripture": ch.get("scripture", ""),
                "outline": outline,
                "detail": detail,
                "morning_revivals": mrs,
            }
            ch_out["_outline"] = outline
            ch_out["_detail"] = detail
            ch_out["_mr"] = [{"_header": m["day"], **m} for m in mrs]
            ch_out["content"] = build_content(ch_out)
            del ch_out["_outline"], ch_out["_detail"], ch_out["_mr"]
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