#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cleanup-books.py — 书报定稿清理（导出流水线的固定一步，幂等可重跑）

输入：本仓库 data/books/（export-spiritual.py 的产物）
输出：原地清理后的 data/books/ + data/books/cleanup-map.json（旧位置→新位置）

在流水线里的位置：
  export-spiritual.py → export-spiritual.py --numbers → **cleanup-books.py**
    → build-book-outlines.py → build-topics.py

为什么必须是固定一步、而不是一次性手工操作：两台开发机的 data/ 不入库，
只有把清理规则写进脚本，两边跑同一串命令才能得到逐字节一致的结果。

幂等性：已清理过的目录再跑一次，验证阶段会发现「要删的书已经不存在」而跳过，
不会二次删除，也不会改变结果。

设计纪律：
  1. 每条删除/合并都先**验证**再执行；验证不过直接 abort，绝不静默删数据。
  2. 墓碑（正文以「（本文」开头的去重指引）按规则整体清除，不再保留占位。
  3. 倪柝声文集 ni 完全独立：不参与任何去重、不改任何条目。
  4. 输出 bookMap / chapterMap，供纲目、书号表、专题、笔记迁移使用。
  5. 不改正文内容（唯一例外：xyzl 一处 &nbsp; 标题脏数据按正文首行修正）。

用法：
  python scripts/cleanup-books.py            # 执行清理（原地）
  python scripts/cleanup-books.py --check    # 只验证不写盘
  CLEANUP_BASELINE=/path/books python scripts/cleanup-books.py   # 指定输入目录
"""
import json
import os
import re
import sys
import hashlib
import collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "books")
# 默认就地清理 data/books；CLEANUP_BASELINE 可指向别处（迁移/对照用）
BASELINE = os.environ.get("CLEANUP_BASELINE") or OUT

TOMB_PREFIX = "（本文"
PROTECTED_SERIES = {"ni"}          # 独立保留，绝不处理

# ── 需要人工复核、本轮不动的问题书（缺正文 / 跨卷同章归属不明）────────────
# sg 1[5]：第五、六章正文缺失，两条墓碑是唯一记录，删了就看不出缺章
REVIEW_BOOKS = {("sg", 1, 5)}

# ── 整本重复：删左侧，保留右侧（主版本）────────────────────────────────
# (series, v, b) -> (dest_series, dest_v, dest_b, 说明)
DELETE_BOOKS = {
    # A 类：一方是另一方超集 / 内容等价，主版本更完整或文字更干净
    ("sg", 3, 48): ("zj", 1, 121, "《圣经的核仁》：zj 20 章为 sg 8 章超集"),
    ("sg", 2, 23): ("zj", 1, 79, "《主恢复的简说》：zj 3 篇含 sg 单章全部"),
    ("sg", 4, 15): ("zj", 1, 120, "《如何享受灵粮》：zj 6 篇 = sg 单章拆分"),
    ("sg", 4, 37): ("zj", 1, 117, "《交通的秘诀》：zj 多「引言」一篇"),
    ("zj", 2, 116): ("sg", 3, 41, "《一个在灵里之人的自传》：sg 多「前言」"),
    ("reading", 1, 29): ("sg", 3, 50, "《读经之路》：sg 13 篇细分"),
    ("jh", 1, 104): ("sg", 3, 28, "《在神行动中…》：sg 8 节细分，jh 为单章合订"),
    ("sg", 1, 28): ("jh", 1, 96, "《一的真正立场》：jh 版无繁体残留（sg 有 116 字）"),
    ("sg", 2, 8): ("jh", 1, 97, "《基督身体的建造》：jh 版无繁体残留（sg 有 55 字）"),
    # B 类：内容等价、按完整性/干净度取主版本
    ("zj", 1, 122): ("sg", 4, 18, "《神的得胜者》：sg 6 章为原书结构（zj 把附录拆成独立篇）"),
    ("zj", 1, 116): ("sg", 3, 47, "《认识神的途径》：sg 章题完整（zj 只有「第一篇」）"),
    ("zj", 2, 118): ("sg", 4, 39, "《帐幕的属灵应用》：sg 章题带编号"),
    ("zj", 2, 120): ("sg", 2, 6, "《国度之于信徒》：sg 篇题完整、字数略多"),
    ("sg", 2, 22): ("zj", 1, 88, "《主今日恢复之主要项目的重点》：zj 内联经文更完整"),
    ("jd", 1, 16): ("sg", 4, 19, "《神完整救恩的结晶读经》≡《罗马书中神完整的救恩结晶读经》（7 章 6 章逐字相同），sg 书名更准确"),
    # 占位条目：98 字书目简介，不是作品本体
    # （单独处理：覆盖率校验对它不适用，见 PLACEHOLDER_BOOKS）
}

# ── 占位条目：不是作品本体（书目简介/目录页），直接删，不做重复校验 ────────
PLACEHOLDER_BOOKS = {
    ("zj", 2, 117): ("sg", 4, 64, "《正确的姊妹(全集)》仅 98 字书目简介，正文在 sg 36 篇"),
}

# ── 整章重复：删左侧（同书内或跨书逐字相同）──────────────────────────────
# (series, v, b, c) -> (dest_series, dest_v, dest_b, dest_c, 说明)
DELETE_CHAPTERS = {
    ("fuyintiandi", 1, 13, 7): ("fuyintiandi", 1, 12, 56, "《福音单张》与《福音信息》逐字重复：论到基督"),
    ("fuyintiandi", 1, 13, 8): ("fuyintiandi", 1, 12, 58, "同上：自信、迷信、信心"),
    ("fuyintiandi", 1, 13, 9): ("fuyintiandi", 1, 12, 57, "同上：时间不多，不要推辞"),
    ("fuyintiandi", 1, 13, 84): ("fuyintiandi", 1, 13, 43, "《福音单张》书内同篇两录：愚昧和骄傲"),
    ("fuyintiandi", 1, 17, 20): ("fuyintiandi", 1, 17, 19, "《福音问答》标题与正文错配（正文是「传福音听福音」）"),
}

# ── 整本书搬移：reading 的《新约总论》14 部并入独立 xyzl 系列 ──────────────
# reading books[30..43]；前 8 部(30-37)与 xyzl books[0..7] 同内容 → 删除；
# 后 6 部(38-43)是 xyzl 没有的 172 篇 → 追加为 xyzl books[8..13]。
ABSORB = {
    "src_series": "reading",
    "dst_series": "xyzl",
    "dup_src_books": list(range(30, 38)),    # 与 xyzl 0..7 重复
    "new_src_books": list(range(38, 44)),    # 追加到 xyzl 末尾
    "src_vol": 1,
    "dst_vol": 1,
}

# ── 标题脏数据修正（按正文首行）───────────────────────────────────────
TITLE_FIX = {
    ("xyzl", 1, 2, 0): "正文首行",
}


def ntext(s):
    return re.sub(r"[\s\u3000]+", "", s or "")


def h(s):
    return hashlib.sha1(ntext(s).encode("utf-8")).hexdigest()


def shingles(s, k=5):
    t = re.sub(r"[^\u4e00-\u9fa5]", "", s or "")
    return set(t[i:i + k] for i in range(max(0, len(t) - k + 1)))


def load_series(bdir, sid):
    meta = json.load(open(os.path.join(bdir, f"{sid}.json"), encoding="utf-8"))
    vols = {}
    for vi in range(1, len(meta.get("volumes") or []) + 1):
        p = os.path.join(bdir, f"{sid}-{vi}.json")
        vols[vi] = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {"books": []}
    return meta, vols


def is_tomb(ch):
    return (ch.get("content") or "").startswith(TOMB_PREFIX)


class Fail(Exception):
    pass


def verify_book_delete(series, vols, key, dest):
    """删除前验证：被删书正文能在目标书里找到（5-gram 覆盖率 ≥ 0.5）。"""
    v, b = key[1], key[2]
    books = vols[v]["books"]
    if b >= len(books):
        raise Fail(f"{series} 卷{v} 书{b} 越界（{len(books)} 本）")
    src_text = "\n".join(c.get("content") or "" for c in books[b]["chapters"])
    if src_text.startswith(TOMB_PREFIX) or all(is_tomb(c) for c in books[b]["chapters"]):
        return "墓碑书（无需比对）"
    ds, dv, db = dest[0], dest[1], dest[2]
    dmeta, dvols = load_series(BASELINE, ds)
    dbooks = dvols[dv]["books"]
    if db >= len(dbooks):
        raise Fail(f"目标 {ds} 卷{dv} 书{db} 越界")
    dst_text = "\n".join(c.get("content") or "" for c in dbooks[db]["chapters"])
    a, bb = shingles(src_text), shingles(dst_text)
    if not a:
        return "空书"
    cov = len(a & bb) / len(a)
    if cov < 0.5:
        raise Fail(f"{series}:{v}:{b}《{books[b]['title']}》与目标 "
                   f"{ds}:{dv}:{db}《{dbooks[db]['title']}》覆盖率仅 {cov:.2f}，疑似不是同一作品")
    return f"覆盖率 {cov:.2f}"


def verify_chapter_delete(series, vols, key, dest):
    """删除前验证：被删章与目标章归一化哈希逐字相同。"""
    v, b, c = key[1], key[2], key[3]
    ch = vols[v]["books"][b]["chapters"][c]
    ds, dv, db, dc = dest[:4]
    dmeta, dvols = load_series(BASELINE, ds)
    dch = dvols[dv]["books"][db]["chapters"][dc]
    if h(ch.get("content")) != h(dch.get("content")):
        raise Fail(f"{series}:{v}:{b}:{c} 与目标 {ds}:{dv}:{db}:{dc} 正文不一致，拒绝删除")
    return "哈希一致"


def main():
    check_only = "--check" in sys.argv
    if not os.path.isdir(BASELINE):
        print(f"[FATAL] 输入目录不存在：{BASELINE}")
        return 3

    idx = json.load(open(os.path.join(BASELINE, "index.json"), encoding="utf-8"))
    series_ids = [s["id"] for s in idx["series"]]
    data = {}
    for sid in series_ids:
        data[sid] = load_series(BASELINE, sid)

    # 幂等守卫：已清理过的目录再跑一次，要删的书已不存在 → 直接判定「无需清理」。
    # 判据用总数：清理后应有 968 本 / 2 个墓碑（只剩复核书），若已满足即跳过。
    _books = sum(len(bk_list) for sid in series_ids
                 for bk_list in (data[sid][1][vi]["books"] for vi in data[sid][1]))
    _tombs = sum(1 for sid in series_ids
                 for vi in data[sid][1]
                 for bk in data[sid][1][vi]["books"]
                 for ch in bk["chapters"] if is_tomb(ch))
    if _tombs <= 2 and _books < 1000:
        print(f"[SKIP] 已是清理后状态（{_books} 本 / {_tombs} 个墓碑），无需重复清理")
        return 0

    errors, notes = [], []
    book_del, chap_del = {}, {}

    # 1) 墓碑清理（ni 保护 + 复核书跳过）
    for sid in series_ids:
        if sid in PROTECTED_SERIES:
            continue
        meta, vols = data[sid]
        for vi, vol in vols.items():
            for bi, bk in enumerate(vol["books"]):
                if (sid, vi, bi) in REVIEW_BOOKS:
                    notes.append(f"[KEEP] {sid} 卷{vi} 书{bi}《{bk['title']}》列入人工复核，本轮不动")
                    continue
                tombs = [ci for ci, ch in enumerate(bk["chapters"]) if is_tomb(ch)]
                if not tombs:
                    continue
                if len(tombs) == len(bk["chapters"]):
                    book_del[(sid, vi, bi)] = ("TOMB", f"整本墓碑（{len(tombs)} 章），内容已在别处")
                else:
                    for ci in tombs:
                        chap_del[(sid, vi, bi, ci)] = ("TOMB", f"墓碑章，同书其余篇目保留")

    # 2) 整本重复
    for key, dest in DELETE_BOOKS.items():
        if key in book_del:
            continue
        sid, v, b = key
        try:
            ev = verify_book_delete(sid, data[sid][1], key, dest)
        except Fail as e:
            errors.append(str(e))
            continue
        book_del[key] = (f"{dest[0]}:{dest[1]}:{dest[2]}", f"{dest[3]}（{ev}）")

    # 3) 占位条目（书目简介/目录页，非作品本体）
    for key, dest in PLACEHOLDER_BOOKS.items():
        sid, v, b = key
        bk = data[sid][1][v]["books"][b]
        total = sum(len(c.get("content") or "") for c in bk["chapters"])
        if total > 400:
            errors.append(f"{sid}:{v}:{b}《{bk['title']}》正文 {total} 字，不像占位条目，拒绝删除")
            continue
        book_del[key] = (f"{dest[0]}:{dest[1]}:{dest[2]}", f"{dest[3]}（正文仅 {total} 字）")

    # 4) 整章重复
    for key, dest in DELETE_CHAPTERS.items():
        if key in chap_del:
            continue
        sid, v, b, c = key
        try:
            ev = verify_chapter_delete(sid, data[sid][1], key, dest)
        except Fail as e:
            errors.append(str(e))
            continue
        chap_del[key] = (f"{dest[0]}:{dest[1]}:{dest[2]}:{dest[3]}", f"{dest[4]}（{ev}）")

    # 5) 新约总论：验证前 8 部逐册章数对齐后删除
    ab = ABSORB
    smeta, svols = data[ab["src_series"]]
    dmeta, dvols = data[ab["dst_series"]]
    sbooks = svols[ab["src_vol"]]["books"]
    dbooks = dvols[ab["dst_vol"]]["books"]
    for k, sbi in enumerate(ab["dup_src_books"]):
        if sbi >= len(sbooks) or k >= len(dbooks):
            errors.append(f"新约总论对齐越界：reading 书{sbi} / xyzl 书{k}")
            continue
        sc, dc = len(sbooks[sbi]["chapters"]), len(dbooks[k]["chapters"])
        if sc != dc:
            errors.append(f"新约总论 reading 书{sbi}({sc}章) 与 xyzl 书{k}({dc}章) 章数不一致")
            continue
        book_del[(ab["src_series"], ab["src_vol"], sbi)] = (
            f"{ab['dst_series']}:{ab['dst_vol']}:{k}", f"新约总论前 8 部重复，主版本在 xyzl 第{k+1}册")
    for k, sbi in enumerate(ab["new_src_books"]):
        if sbi >= len(sbooks):
            errors.append(f"新约总论追加越界：reading 书{sbi}")
            continue
        book_del[(ab["src_series"], ab["src_vol"], sbi)] = (
            f"{ab['dst_series']}:{ab['dst_vol']}:{len(dbooks)+k}", "新约总论后 6 部，追加进 xyzl")

    if errors:
        print("[ABORT] 验证失败，未写任何文件：")
        for e in errors:
            print("   ", e)
        return 2

    # ── 构建新结构 ────────────────────────────────────────────────
    new = {}       # sid -> {"meta":..., "vols": {vi: [book...]}}
    book_map = {}  # sid -> {"v:b": "v:b"|None}
    chap_map = {}  # sid -> {"v:b:c": "v:b:c"|None}

    for sid in series_ids:
        meta, vols = data[sid]
        nb = {}
        bm, cm = {}, {}
        for vi, vol in vols.items():
            out_books = []
            for bi, bk in enumerate(vol["books"]):
                key = (sid, vi, bi)
                if key in book_del:
                    bm[f"{vi}:{bi}"] = None
                    for ci in range(len(bk["chapters"])):
                        cm[f"{vi}:{bi}:{ci}"] = None
                    continue
                out_ch = []
                kept = []          # [(旧章号, 新章号)]
                for ci, ch in enumerate(bk["chapters"]):
                    if (sid, vi, bi, ci) in chap_del:
                        cm[f"{vi}:{bi}:{ci}"] = None
                        continue
                    kept.append((ci, len(out_ch)))
                    out_ch.append(dict(ch))
                if not out_ch:
                    bm[f"{vi}:{bi}"] = None
                    continue
                nbi = len(out_books)
                bm[f"{vi}:{bi}"] = f"{vi}:{nbi}"
                for oci, nci in kept:
                    cm[f"{vi}:{bi}:{oci}"] = f"{vi}:{nbi}:{nci}"
                out_books.append({"title": bk["title"], "chapters": out_ch})
            nb[vi] = out_books
        new[sid] = {"meta": meta, "vols": nb}
        if sid in PROTECTED_SERIES:
            # 保护系列不参与任何清理：映射必须恒等（否则下游会误以为书被搬动）
            bm = {f"{vi}:{bi}": f"{vi}:{bi}"
                  for vi, vol in vols.items() for bi in range(len(vol["books"]))}
            cm = {f"{vi}:{bi}:{ci}": f"{vi}:{bi}:{ci}"
                  for vi, vol in vols.items()
                  for bi, bk in enumerate(vol["books"])
                  for ci in range(len(bk["chapters"]))}
        book_map[sid] = bm
        chap_map[sid] = cm

    # 新约总论：reading 后 6 部追加进 xyzl（正文搬移，不是删除）
    sbooks = data[ab["src_series"]][1][ab["src_vol"]]["books"]
    dbooks = data[ab["dst_series"]][1][ab["dst_vol"]]["books"]
    xyzl_vol = new[ab["dst_series"]]["vols"][ab["dst_vol"]]
    base_n = len(dbooks)
    for k, sbi in enumerate(ab["new_src_books"]):
        bk = sbooks[sbi]
        src_title = bk["title"].replace("新约总论·", "")
        xyzl_vol.append({"title": src_title, "chapters": [dict(c) for c in bk["chapters"]]})
        for ci in range(len(bk["chapters"])):
            chap_map[ab["src_series"]][f"{ab['src_vol']}:{sbi}:{ci}"] = f"{ab['dst_vol']}:{base_n + k}:{ci}"

    # ── 标题修正 ─────────────────────────────────────────────────
    for (sid, v, b, c), how in TITLE_FIX.items():
        bk = new[sid]["vols"][v][b]
        ch = bk["chapters"][c]
        # 正文首行可能是被切碎的编号残片（「第五十」），取第一条「第N篇 …」完整行
        cand = [ln.strip() for ln in (ch.get("content") or "").split("\n") if ln.strip()]
        first = next((ln for ln in cand if re.match(r"^第[一二三四五六七八九十百零〇\d]+篇", ln)), None)
        if not first:
            errors.append(f"{sid} 卷{v} 书{b} 章{c} 找不到「第N篇」标题行，标题未修")
            continue
        old = ch.get("title")
        ch["title"] = first
        notes.append(f"[FIX] {sid} 卷{v} 书{b} 章{c} 标题 {old!r} → {first!r}")

    # ── 写盘 ─────────────────────────────────────────────────────
    if check_only:
        print("[CHECK] 验证通过，未写盘。")
        for n in notes:
            print("  ", n)
        return 0

    os.makedirs(OUT, exist_ok=True)
    new_index = {"series": []}
    for s in idx["series"]:
        sid = s["id"]
        if sid in PROTECTED_SERIES:
            # ni 保持原样。就地清理（BASELINE == OUT）时文件已经在位，绝不能「复制到自身」——
            # `open(dst,'wb')` 会先把目标清空再读源，同一文件即被写成 0 字节
            # （2026-11-05 实测踩坑：ni 四个文件全变 0 字节，从备份才恢复）。
            if os.path.abspath(BASELINE) != os.path.abspath(OUT):
                for f in os.listdir(BASELINE):
                    if f == f"{sid}.json" or re.fullmatch(rf"{sid}-\d+\.json", f):
                        with open(os.path.join(BASELINE, f), "rb") as r, open(os.path.join(OUT, f), "wb") as w:
                            w.write(r.read())
            new_index["series"].append(s)
            continue
        meta = new[sid]["meta"]
        vols = new[sid]["vols"]
        # 元数据
        mvols = []
        for vi in range(1, len(meta.get("volumes") or []) + 1):
            books = vols.get(vi, [])
            mvols.append({
                "title": meta["volumes"][vi - 1]["title"],
                "books": [dict({"title": bk["title"],
                                "chapters": [c["title"] for c in bk["chapters"]]},
                               **({"num": bk["num"]} if bk.get("num") else {}))
                          for bk in books],
            })
        m = {"name": meta["name"], "volumes": mvols}
        with open(os.path.join(OUT, f"{sid}.json"), "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, separators=(",", ":"))
        # 正文
        for vi in range(1, len(mvols) + 1):
            with open(os.path.join(OUT, f"{sid}-{vi}.json"), "w", encoding="utf-8") as f:
                json.dump({"volume": vi, "books": vols.get(vi, [])}, f,
                          ensure_ascii=False, separators=(",", ":"))
        new_index["series"].append({"id": sid, "name": meta["name"],
                                    "volumes": len(mvols)})

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(new_index, f, ensure_ascii=False, separators=(",", ":"))

    # 映射
    mapping = {
        "note": "旧位置→新位置；null=已删除。坐标为 series/v(1基)/b(0基)/c(0基)。",
        "bookMap": {k: v for k, v in book_map.items()},
        "chapterMap": {k: v for k, v in chap_map.items()},
        # title 供源对照测试识别「已合并书」（源目录还在，产物里不再独立成书）
        "deletedBooks": {f"{k[0]}:{k[1]}:{k[2]}": {
            "dest": v[0], "why": v[1],
            "title": data[k[0]][1][k[1]]["books"][k[2]]["title"],
        } for k, v in book_del.items()},
        "deletedChapters": {f"{k[0]}:{k[1]}:{k[2]}:{k[3]}": {
            "dest": v[0], "why": v[1],
            "title": data[k[0]][1][k[1]]["books"][k[2]]["chapters"][k[3]]["title"],
        } for k, v in chap_del.items()},
    }
    with open(os.path.join(OUT, "cleanup-map.json"), "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[OK] 删除整本 {len(book_del)} 本 / 单章 {len(chap_del)} 章")
    for n in notes:
        print("  ", n)
    print(f"映射 → {os.path.join(OUT, 'cleanup-map.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
