#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-book-outlines.py — 书报纲目策展源 → data/books/outline/{系列}-{辑}.json

流水线位置（详见 docs/book-outline-playbook.md）：
  scripts/outline-src/{系列}.json（人工/LLM 逐章策展，入库）
    → 本脚本（对照已导出正文逐条校验：文本必须整行存在且按文档顺序）
    → data/books/outline/{系列}-{辑}.json（生成产物，不入库，随 deploy/APK 分发）

数据契约（与标注 loc 同基数：辑 1 基、书 0 基、章 0 基）：
  策展源 chapters 键 "v:b:c"；产物按辑分文件，键 "{book}:{chapter}"。
  条目两种形态：
    {"t": "整行文本", "l": 1~4}            精确匹配（该行必须整行等于 t）
    {"p": "行首前缀", "l": 1~4, "label": "显示名"}  前缀匹配（「标题+正文」合行）
  章级显式空列表 [] = 已审阅且确无纲目（同时压制该章运行时 detectLrHeading 误报）；
  键缺失 = 未策展（前端回退 detectLrHeading 运行时识别）。

用法：
  python scripts/build-book-outlines.py            # 构建全部已有策展源的系列
  python scripts/build-book-outlines.py ni         # 只构建指定系列
"""
import json
import os
import re
import sys
import collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC_DIR = os.path.join(ROOT, "scripts", "outline-src")
OUT_DIR = os.path.join(ROOT, "data", "books", "outline")
MAX_LEVEL = 4

# 行尾「全名书卷 + 章:节[范围][上中下] + ×」——源侧链式读经块还原删掉的注入尾巴
TAIL_REF_RE = re.compile(
    r"[\u4e00-\u9fa5]{2,8}[一二三四五六七八九十百零〇\d]+[~～\-—]?[一二三四五六七八九十百零〇\d]*[上中下]?×$"
)
# 同类尾巴但不带 ×（`路九60路加福音九60` / `四 灵有污秽（林后七1哥林多后书七1`）：
# 策展源存的是还原前文本，正文已删掉重复展开的全名引用。要求前面紧邻缩写引用
# （书卷简称 + 章:节），确保只剥「引用 + 全名重复」，不碰正常标题里的书名。
TAIL_REF_NOMARK_RE = re.compile(
    r"(?<=[\u4e00-\u9fa5\d上中下~～\-—])"
    r"[\u4e00-\u9fa5]{2,6}书?[一二三四五六七八九十百零〇\d]+"
    r"(?:[~～\-—][一二三四五六七八九十百零〇\d]+)?[上中下]?$"
)


def fail(msg, errors):
    errors.append(msg)


def build_series(series, src):
    """校验并产出单系列。返回 (产物 dict per volume, 错误列表, 统计)。

    errors 按章分组在 errors_by_chapter 里；返回值里的 errors 是扁平列表（兼容旧调用）。
    """
    errors = []
    errors_by_chapter = {}
    meta_path = os.path.join(ROOT, "data", "books", f"{series}.json")
    if not os.path.isfile(meta_path):
        fail(f"[{series}] 元数据缺失：{meta_path}（先跑 export-spiritual.py）", errors)
        return None, errors, {}
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    vol_titles = [v.get("title") or f"第{i+1}辑" for i, v in enumerate(meta.get("volumes") or [])]

    # 载入各辑正文（校验用）
    vols_content = {}
    for v in range(1, len(vol_titles) + 1):
        p = os.path.join(ROOT, "data", "books", f"{series}-{v}.json")
        if not os.path.isfile(p):
            fail(f"[{series}] 第 {v} 辑正文缺失：{p}", errors)
            continue
        with open(p, encoding="utf-8") as f:
            vols_content[v] = json.load(f)

    out = {}
    stats = collections.Counter()
    dropped = []
    for key, entries in sorted((src.get("chapters") or {}).items()):
        ch_errors = []
        parts = key.split(":")
        if len(parts) != 3 or not all(p.lstrip("-").isdigit() for p in parts):
            fail(f"[{series}] 键格式错误：{key!r}（应为 v:b:c）", errors)
            errors_by_chapter[key] = 1
            continue
        v, b, c = (int(x) for x in parts)
        if v not in range(1, len(vol_titles) + 1):
            fail(f"[{series}] {key}: 辑越界（1..{len(vol_titles)}）", errors)
            errors_by_chapter[key] = 1
            continue
        vol = vols_content.get(v)
        if vol is None:
            continue
        books = vol.get("books") or []
        if b not in range(0, len(books)):
            fail(f"[{series}] {key}: 书越界（0..{len(books)-1}）", errors)
            errors_by_chapter[key] = 1
            continue
        chapters = books[b].get("chapters") or []
        if c not in range(0, len(chapters)):
            fail(f"[{series}] {key}: 章越界（0..{len(chapters)-1}）", errors)
            errors_by_chapter[key] = 1
            continue
        content = chapters[c].get("content") or ""
        lines = [ln.strip() for ln in content.split("\n") if ln.strip()]

        bucket = out.setdefault(v, {})
        if not entries:
            bucket[f"{b}:{c}"] = []
            stats["empty"] += 1
            continue

        # 顺序游走校验：每条必须命中「指针处或之后」的整行（精确）/ 行首（前缀）
        result = []
        ptr = 0
        for i, e in enumerate(entries):
            if not isinstance(e, dict) or "l" not in e:
                fail(f"[{series}] {key} 第{i}条：缺字段 l", ch_errors)
                continue
            lv = e["l"]
            if isinstance(lv, bool) or not isinstance(lv, int) or lv not in range(1, MAX_LEVEL + 1):
                fail(f"[{series}] {key} 第{i}条：层级须为 1..{MAX_LEVEL} 的整数，得 {lv!r}", ch_errors)
                continue
            hit = -1
            if "t" in e:
                if not isinstance(e["t"], str) or not e["t"]:
                    fail(f"[{series}] {key} 第{i}条：t 不能为空", ch_errors)
                    continue
                for j in range(ptr, len(lines)):
                    if lines[j] == e["t"]:
                        hit = j
                        break
                item_t = e["t"]
                if hit < 0:
                    # 注入经文尾巴回退（2026-11-04）：源侧「链式读经块还原」删掉了
                    # 正文里重复展开的全名书卷引用（`…─罗一1罗马书一1×` 只留 `…─罗一1`），
                    # 策展源仍存还原前的完整行。剥掉行尾「全名书卷+章:节[上中下]×」
                    # 后再按整行/行首匹配。产物必须写**当前真实行**，否则前端按整行
                    # 精确匹配时仍匹配不到（前端 collectBookHeadings 用 e.t 严格相等）。
                    for rx in (TAIL_REF_RE, TAIL_REF_NOMARK_RE):
                        stripped = rx.sub("", e["t"]).rstrip("─—-（(：: ")
                        if not stripped or stripped == e["t"]:
                            continue
                        for j in range(ptr, len(lines)):
                            if lines[j] == stripped:
                                hit, item_t = j, stripped
                                break
                        if hit >= 0:
                            stats["tail_strip"] += 1
                            break
                if hit < 0:
                    # 前缀兜底：策展行是还原前的长行（正文被截断/改写），
                    # 取正文里以该行**开头**的那一行——显示名仍用策展文本的短标签。
                    probe = e["t"][:24]
                    if len(probe) >= 6:
                        for j in range(ptr, len(lines)):
                            if lines[j].startswith(probe):
                                hit, item_t = j, lines[j]
                                stats["prefix_fix"] += 1
                                break
                if hit < 0:
                    fail(f"[{series}] {key} 第{i}条：正文找不到整行 {e['t'][:40]!r}"
                         f"（章：{(chapters[c].get('title') or '')[:20]}）", ch_errors)
                    continue
                item = {"l": lv, "t": item_t}
            elif "p" in e:
                if not isinstance(e["p"], str) or not e["p"]:
                    fail(f"[{series}] {key} 第{i}条：p 不能为空", ch_errors)
                    continue
                for j in range(ptr, len(lines)):
                    if lines[j].startswith(e["p"]):
                        hit = j
                        break
                if hit < 0:
                    fail(f"[{series}] {key} 第{i}条：正文找不到行首 {e['p'][:40]!r}", ch_errors)
                    continue
                item = {"l": lv, "p": e["p"]}
                if e.get("label"):
                    item["label"] = e["label"]
            else:
                fail(f"[{series}] {key} 第{i}条：须有 t 或 p", ch_errors)
                continue
            ptr = hit + 1
            result.append(item)
            stats["entries"] += 1
        if ch_errors:
            # 该章有失配条目：整章剔除（顺序游走已不可信），回退运行时识别
            errors_by_chapter[key] = len(ch_errors)
            dropped.append(key)
            continue
        bucket[f"{b}:{c}"] = result
        stats["chapters"] += 1

    docs = {}
    for v, chapters in sorted(out.items()):
        docs[v] = {"volume": vol_titles[v - 1], "chapters": dict(sorted(chapters.items()))}
    if dropped:
        stats["dropped"] = dropped
    return docs, errors, stats


def build_series_tolerant(series, src):
    """单次加载、逐章判定：失配的章整体剔除（键缺失 = 前端回退 detectLrHeading）。

    为什么按章而不是按条剔除：顺序游走一旦某条失配，后续指针不前进会级联误报，
    保留下来的条目可能已错位；按章丢弃可保证产物里每章纲目都是完整校验过的。
    用于源侧大改正文（如 2026-11-04 链式读经块还原）后策展源无法一次性重对齐的过渡期。
    """
    docs, errors, stats = build_series(series, src)
    return docs, errors, stats


def main():
    wanted = sys.argv[1:] or None
    if wanted:
        known = {fn[:-5] for fn in os.listdir(SRC_DIR) if fn.endswith(".json")}
        unknown = [w for w in wanted if w not in known]
        if unknown:
            print(f"✗ 未知系列（scripts/outline-src/ 下没有对应策展源）：{', '.join(unknown)}")
            print(f"  已有：{', '.join(sorted(known)) or '（无）'}")
            sys.exit(1)
    os.makedirs(OUT_DIR, exist_ok=True)
    total_err = 0
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith(".json"):
            continue
        series = fn[:-5]
        if wanted and series not in wanted:
            continue
        with open(os.path.join(SRC_DIR, fn), encoding="utf-8") as f:
            src = json.load(f)
        if src.get("series") and src["series"] != series:
            print(f"[WARN] {fn}: series 字段 {src['series']!r} 与文件名不一致，按文件名处理")
        docs, errors, stats = build_series(series, src)
        if errors:
            total_err += len(errors)
            print(f"✗ {series}：{len(errors)} 处硬错误（键格式/元数据缺失）")
            for e in errors[:40]:
                print("   ", e)
            if len(errors) > 40:
                print(f"    …另 {len(errors)-40} 处")
            # 校验失败不许留旧产物：deploy.mjs 同步整个 data/，残留的上一次产物会被静默发出去（CR 2026-11-02）
            stale = [f for f in os.listdir(OUT_DIR) if re.match(rf"^{re.escape(series)}-\d+\.json$", f)]
            for f in stale:
                os.remove(os.path.join(OUT_DIR, f))
            if stale:
                print(f"   已删除该系列旧的生成产物 {len(stale)} 个：{', '.join(stale)}")
            continue
        if stats.get("dropped"):
            # 失配章整体剔除（键缺失 → 前端回退 detectLrHeading），不阻断其余章
            names = sorted(stats["dropped"])
            print(f"[DROP] {series}：{len(names)} 章策展纲目与正文失配，已回退运行时识别："
                  f"{', '.join(names[:8])}{' …' if len(names) > 8 else ''}")
        for v, doc in docs.items():
            dst = os.path.join(OUT_DIR, f"{series}-{v}.json")
            tmp = dst + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, dst)   # 原子替换：并发跑的测试不会读到写了一半的 JSON
        # 清理该系列已不存在的辑文件（系列辑数变化时的残留）
        keep = {f"{series}-{v}.json" for v in docs}
        for f in os.listdir(OUT_DIR):
            if re.match(rf"^{re.escape(series)}-\d+\.json$", f) and f not in keep:
                os.remove(os.path.join(OUT_DIR, f))
                print(f"   ! 删除过期产物：{f}")
        n_ch = sum(len(d["chapters"]) for d in docs.values())
        n_empty = sum(1 for d in docs.values() for v in d["chapters"].values() if not v)
        extra = f"，尾巴剥离 {stats['tail_strip']} 条" if stats.get("tail_strip") else ""
        print(f"[OK] {series}：{len(docs)} 个辑文件，{n_ch} 章入册"
              f"（{n_ch - n_empty} 章有纲目 / {n_empty} 章显式空），{stats['entries']} 条{extra}")
    if total_err:
        print(f"\n共 {total_err} 处错误，未写出对应产物")
        sys.exit(1)


if __name__ == "__main__":
    main()
