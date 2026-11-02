# -*- coding: utf-8 -*-
"""_draft_books.py — 批次 2 起的草案生成器（机械规则 + 人工标记复核），按系列泛化。

规则全部蒸馏自第一批手工策展（docs/book-outline-playbook.md §3/§4）：
  保留：编号标题（壹/参/一/１/（一），层级按实际嵌套）、裸短行标题、带「─」语义标签的小标题
  剔除：经文引用行（引文+卷章，无标签）、页码残片（N02xx/纯数字/裸数字字）、
        日期署名、作者落款、全文完、与章名/书名重复的行、诗歌块元数据（编号/节拍/调号/类目）
  合行：「标题　正文」同行的长编号行 → 前缀匹配（p + label）
  零识别章 → 显式空（已审阅）；正文漂移由 build-book-outlines.py 校验兜底

用法：
  python scripts/outline-src/_draft_books.py gospel 1 0-69          # 福音类 70 本
  python scripts/outline-src/_draft_books.py ni 1 2-19 --force      # 规则改进后重跑覆盖
  python scripts/outline-src/_draft_books.py <系列> <辑> --all       # 该辑全部书
已有策展的章默认跳过；手工策展过的书（SERIES_HAND）永不覆盖。
生成的草案写回 scripts/outline-src/{系列}.json，
**标记项必须人工复核**（报告里 FLAG 开头的行）。
"""
import json
import os
import re
import sys
import collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")

# 手工策展过的书（系列 → {(辑, 本)}）：草案器永不覆盖，只补后续的书
SERIES_HAND = {"ni": {(1, 0), (1, 1)}}

# 系列级校准（playbook §5.2）：哪些系列要认 13–20 字的长标题裸行。
# 十二篮（slat）的节标题普遍超 detectLrHeading 的 12 字上限（「抹大拉的马利亚对于主的认识」），
# 靠「纯中文短语 + 下一行是长段落」补收；其他系列该形态混杂正文句子（如圣经疑难的问答句），
# 不开这个口子。
SERIES_LONG_TITLE = {"slat"}

# ---- 识别（与 app.js detectLrHeading 一致，另补「参」——壹/贰/叁的俗写，app 侧同类 bug） ----
CN1 = "壹贰叁肆伍陆柒捌玖拾参"


def detect(line):
    t = line.strip()
    if not t:
        return None
    if re.fullmatch(r"[-—─=*_·●○•]+", t):
        return None
    if re.match(rf"^[{CN1}]+[\u3000 ]+", t):
        return 1
    if re.match(r"^[一二三四五六七八九十]+[\u3000 ]+", t):
        return 2
    if re.match(r"^[０-９]+[\u3000 ]+", t):
        return 3
    if re.match(r"^[ａ-ｚ][\u3000 ]+", t):
        return 4
    if re.match(r"^（[一二三四五六七八九十百零〇○]+）[\u3000 ]+", t):
        return 5
    if re.match(r"^（[０-９]+）[\u3000 ]+", t):
        return 6
    if re.match(r"^（[ａ-ｚ]）[\u3000 ]+", t):
        return 7
    if re.match(r"^《[一二三四五六七八九十]+》[\u3000 ]+", t):
        return 8
    if re.match(r"^《[０-９]+》[\u3000 ]+", t):
        return 9
    if re.match(r"^《[ａ-ｚ]》[\u3000 ]+", t):
        return 10
    if 2 <= len(t) <= 12 and not re.search(r"[。，；：？！、」』）】]$", t) and not re.search(r"[（(【[《]", t):
        return 0
    return None


# 经文引用行：卷名（简称）紧跟章/节数字。带「─」语义标签的（阔─/地方─/时期─）不算
REF = re.compile(
    r"(约壹|约贰|约参|帖前|帖后|提前|提后|彼前|彼后|林前|林后|撒上|撒下|王上|王下|代上|代下|"
    r"约|罗|加|弗|腓|西|多|门|来|雅|犹|启|创|出|利|民|申|书|士|得|拉|尼|斯|诗|箴|传|歌|赛|耶|哀|结|但|何|珥|摩|俄|拿|弥|鸿|哈|番|该|亚|玛)"
    r"[一二三四五六七八九十百零〇○０-９0-9]")
ARTIFACT = re.compile(r"^(N\d{4}(\s*-\s*\d+\s*-)?|\d+|[一二三四五六七八九十]+)$")
# 日期/署名：阿拉伯数字年 + 中文数字年月日（一九二五年十一月二十六日…）+ 常见落款尾字
DATEISH = re.compile(r"(\d{3,4}年|^[一二三四五六七八九十〇零]+年[一二三四五六七八九十]+月|客中$|脱稿$|谨识$|敬上$|谨启$|旅次$)")
SIGNISH = re.compile(r"倪柝声|柝声")   # 落款里出现作者名且够短 → 署名行
# 诗歌块元数据（gospel 等译诗合集）：节拍/编号行、调号、诗歌类目
HYMN_META = re.compile(r"(^[\d\s．.、副（(英\d+)）]+$|大调|小调|^福音─)")
# 印刷残片：ASCII/框线表格行、同一字符重复（「第第第第第」）
BOXART = re.compile(r"^[─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬\-\s]+$")
SENT_END = re.compile(r"[。，；：？！、」』）】]$")
# 版块标签 / 目录标记（2026-11-02 全量批次新增）：这些行是结构标记不是标题
LABEL_LINE = re.compile(r"^(纲\s*目[:：]?|目\s*录[:：]?|一 重点经节：|二 你喜欢的经节：、、。|三 真理要点：|阅读更多＞?|(读经|祷告|见证)[:：])$")
# 裸「祷告/见证」既可能是版块标记（后面跟祈祷文）也可能是真小节标题（如「信心/祷告/奉献」并列），
# 只在下一行是祈祷文/署名时才算标记（CR 2026-11-03：原先无条件剔，误删了真标题）
PRAYER_NEXT = re.compile(r"^(主阿|主啊|主，|主,|主！|哦主|哦，主|求你|我们求你|我们祷告|感谢主|赞美主|阿们|弟兄|姊妹|父阿|父啊)")
PUA_LINE = re.compile(r"[-\s]+")
# 纯西文行（荒漠甘泉等英文署名/残字）
ASCII_LINE = re.compile(r"[A-Za-z0-9][A-Za-z0-9\s\.,'’()（）\-–—:;!?”\"…%]*")
MAX_ENTRY = 60   # 超过此长度的命中行转前缀匹配 + 截断显示名（纲目列会撑爆）


def classify(text, prev_level, prev_flat, in_hymn=False, long_title=False, next_len=0, next_text=""):
    """返回 (条目 dict 或 None, 新 prev_level, 新 prev_flat, 剔除原因或 None)"""
    t = text.strip()
    lv = detect(t)
    if lv is None:
        # 长标题裸行（仅开的系列）：13–20 字纯中文短语、无句读收尾、下一行是长段落
        if (long_title and 13 <= len(t) <= 20 and next_len >= 30
                and not SENT_END.search(t) and not re.search(r"[（(【[《]", t)
                and not re.search(r"[A-Za-z0-9]", t)):
            level = min(prev_level + 1, 3) if (prev_level and not prev_flat) else (prev_level or 1)
            return {"t": t, "l": level}, level, True, None
        # 诗歌编译栏：「标题（全角空格填补）+ 译」——标题被译者署名撑爆漏识别，按前缀收
        m = re.match(r"^(.{2,12}?)[\u3000\s]+译$", t)
        if m:
            name = m.group(1).rstrip("\u3000 ")
            if name:
                return {"p": name, "l": 1, "label": name}, 1, True, None
        return None, prev_level, prev_flat, None
    if ARTIFACT.match(t):
        return None, prev_level, prev_flat, "页码/纯数字"
    if DATEISH.search(t):
        return None, prev_level, prev_flat, "日期署名"
    if len(t) <= 20 and SIGNISH.search(t):
        return None, prev_level, prev_flat, "作者落款"
    if t in ("全文完", "读经：", "读经", "诗歌"):
        return None, prev_level, prev_flat, "标签行"
    if LABEL_LINE.match(t):
        return None, prev_level, prev_flat, "版块/目录标签"
    if t in ("祷告", "见证") and PRAYER_NEXT.match(next_text or ""):
        return None, prev_level, prev_flat, "祈祷文抬头"
    if len(t) <= 40 and ASCII_LINE.fullmatch(t) and not re.search(r"[一-鿿]", t):
        return None, prev_level, prev_flat, "纯西文行"
    # 纯私有区字符行（网页抓取的装饰图标残留，浏览器渲染成空白）——福音天地/传记有几处，
    # 不滤会在纲目里出现空白条目（2026-11-02 全量批次实测）
    if re.fullmatch(r"[-\s]+", t):
        return None, prev_level, prev_flat, "私有区字符行"
    if BOXART.match(t) or (len(t) >= 3 and len(set(t)) == 1):
        return None, prev_level, prev_flat, "表格/重复字符残片"
    if HYMN_META.search(t):
        return None, prev_level, prev_flat, "诗歌块元数据"
    # 诗歌块内的长编号行是诗节（「一 基督已经穿上人性，…」），不是标题
    if in_hymn and lv in (1, 2, 3) and len(t) > 24:
        return None, prev_level, prev_flat, "诗歌节次行"
    # 编号行且句读收尾且非「标题　正文」合行 → 诗句/引文条目（见证夹诗、纲目式章节的编号引文）。
    # 「─」引出正文的列表式小节（「一　个人生活方面─要学…。」）是标题，免剔；
    # 逗号收尾不受长度/空格 guard 保护——标题不会以逗号收尾（诗句折行、目录残行）
    if lv in (1, 2, 3, 5, 6, 7) and "─" not in t:
        if t.endswith("，"):
            return None, prev_level, prev_flat, "诗句/引文条目"
        if len(t) > 20 and t.count("\u3000") <= 1 and re.search(r"[，；！。、：？]$", t):
            return None, prev_level, prev_flat, "诗句/引文条目"
    if lv == 0 and "─" not in t and REF.search(t):
        return None, prev_level, prev_flat, "经文引用行"
    # 层级：编号类按格式；裸短行/（一）类跟随前一标题（封顶 3）；
    # 连续裸短行保持平级（不逐级递增），遇到编号标题重新计数
    if lv in (1, 8):
        level, prev_level, prev_flat = 1, 1, False
    elif lv in (2, 3, 4, 9, 10):
        level, prev_level, prev_flat = 2, 2, False
    elif lv in (5, 6, 7):
        level = min(prev_level + 1, 3)
        prev_level, prev_flat = level, False
    else:  # lv == 0 裸短行
        if prev_flat or not prev_level:
            level = prev_level or 1
        else:
            level = min(prev_level + 1, 3)
        prev_level, prev_flat = level, True
    # 长编号行（>24 字）按「标题　正文」合行处理：前缀匹配 + 显示名
    if len(t) > 24:
        parts = t.split("\u3000")
        if len(parts) >= 3 and parts[0] and parts[1]:
            return {"p": parts[0] + "\u3000" + parts[1], "l": level, "label": parts[1]}, prev_level, prev_flat, None
    # 仍然超长的条目（>60 字，如整段正文被 numbered 成一条）：前缀匹配 + 截断显示名
    if len(t) > MAX_ENTRY:
        label = t[:MAX_ENTRY - 1] + "…"
        return {"p": t[:MAX_ENTRY], "l": level, "label": label}, prev_level, prev_flat, None
    return {"t": t, "l": level}, prev_level, prev_flat, None


def draft_chapter(vol, bi, ci, series=""):
    """返回 (条目列表, 标记列表, 剔除统计, 识别数)"""
    ch = vol["books"][bi]["chapters"][ci]
    content = ch.get("content") or ""
    lines = [ln.strip() for ln in content.split("\n") if ln.strip()]
    title = (ch.get("title") or "").strip()
    norm = lambda s: re.sub(r"[\s\u3000]", "", s or "")
    ntitle = norm(title)
    nbook = norm(vol["books"][bi].get("title") or "")

    # 诗歌合集章（倪文集《歌中的歌》「分类N：…」等）：整章是诗集，节次行不是标题，
    # 章内少量「第N首」号也不成导航（与天路历程同理，用户已定调）→ 显式空
    hymn_nums = sum(1 for ln in lines if re.match(r"^[第笫][一二三四五六七八九十百零〇○]+首", ln))
    if re.match(r"^分类[一二三四五六七八九十]", title) or hymn_nums >= 5:
        return [], [f"诗歌合集章（{hymn_nums} 个第N首行）→ 显式空"], {"诗歌合集": hymn_nums}, \
            sum(1 for ln in lines if detect(ln) is not None)

    entries, flags, drops = [], [], collections.Counter()
    long_title = series in SERIES_LONG_TITLE
    prev_level = 0
    prev_flat = False
    in_hymn = False   # 「诗歌」标签起的诗歌块（gospel 等译本合集），块内长编号行是诗节
    for idx_ln, ln in enumerate(lines):
        if ntitle and norm(ln) == ntitle:
            drops["章名重复"] += 1
            continue
        if nbook and norm(ln) == nbook:
            drops["书名重复"] += 1
            continue
        if ln == "读经":
            in_hymn = False
            continue                      # 两个块标签不入纲目（只是版块标记）
        if ln == "诗歌":
            in_hymn = True
            continue
        next_text = lines[idx_ln + 1] if idx_ln + 1 < len(lines) else ""
        e, prev_level, prev_flat, why = classify(ln, prev_level, prev_flat, in_hymn, long_title,
                                                 len(next_text), next_text)
        if e:
            entries.append(e)
            if detect(ln) == 0:
                in_hymn = False           # 出现裸短行标题 → 诗歌块结束，回到正文结构
        elif why:
            drops[why] += 1
    n_det = sum(1 for ln in lines if detect(ln) is not None)
    # ---- 标记项 ----
    if not entries:
        suspect = [ln for ln in lines if 2 <= len(ln) <= 20 and not SENT_END.search(ln) and detect(ln) is None]
        if suspect:
            flags.append(f"零识别但有 {len(suspect)} 个可疑短行（可能漏标题）：{suspect[:4]}")
    if n_det > 30:
        flags.append(f"识别 {n_det} 处 >30，疑似目录/表格章（考虑显式空）")
    if any("─" in e.get("t", "") + e.get("p", "") for e in entries):
        flags.append("含「─」标签行（层级为推测，需抽查）")
    if drops.get("章名重复"):
        flags.append("章名在正文重复（已剔）")
    if any(e.get("p") for e in entries):
        flags.append(f"含 {sum(1 for e in entries if e.get('p'))} 条合行/译名（前缀匹配）")
    return entries, flags, drops, n_det


def parse_range(spec, total):
    if spec == "--all":
        return list(range(total))
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return [b for b in out if 0 <= b < total]


def main():
    force = "--force" in sys.argv
    argv = [a for a in sys.argv[1:] if a != "--force"]
    if len(argv) < 3:
        print(__doc__)
        sys.exit(1)
    series = argv[0]
    try:
        vol_no = int(argv[1])
    except ValueError:
        print(f"✗ 辑号须为整数，得 {argv[1]!r}（用法见下）")
        print(__doc__)
        sys.exit(1)
    unknown = [a for a in sys.argv[1:] if a.startswith("--") and a not in ("--force", "--all")]
    if unknown:
        print(f"✗ 未知选项：{', '.join(unknown)}（只支持 --force / --all）")
        sys.exit(1)
    meta_path = os.path.join(ROOT, "data", "books", f"{series}.json")
    content_path = os.path.join(ROOT, "data", "books", f"{series}-{vol_no}.json")
    for p in (meta_path, content_path):
        if not os.path.isfile(p):
            print(f"✗ 缺文件：{p}（先跑 export-spiritual.py）")
            sys.exit(1)
    with open(content_path, encoding="utf-8") as f:
        vol = json.load(f)
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    vol_title = (meta["volumes"][vol_no - 1].get("title") if vol_no <= len(meta["volumes"]) else None) \
        or vol.get("volume") or f"第{vol_no}辑"

    books = parse_range(argv[2], len(vol["books"]))
    hand = SERIES_HAND.get(series, set())

    src_path = os.path.join(ROOT, "scripts", "outline-src", f"{series}.json")
    if os.path.isfile(src_path):
        with open(src_path, encoding="utf-8") as f:
            src = json.load(f)
    else:
        src = {"series": series, "chapters": {}}
    chapters = src["chapters"]

    print(f"== {series}（{vol_title}）草案：{len(books)} 本 ==")
    n_book_flag = 0
    for bi in books:
        if (vol_no, bi) in hand:
            print(f"  [{bi:2d}] {vol['books'][bi]['title'][:20]:22s} 跳过（手工策展）")
            continue
        book = vol["books"][bi]
        n_new = n_empty = n_flag = 0
        for ci in range(len(book["chapters"])):
            key = f"{vol_no}:{bi}:{ci}"
            if key in chapters and not force:
                continue
            entries, flags, drops, n_det = draft_chapter(vol, bi, ci, series)
            chapters[key] = entries
            if entries:
                n_new += 1
            else:
                n_empty += 1
            if flags:
                n_flag += 1
                for fl in flags:
                    print(f"  FLAG {key} 《{book['chapters'][ci]['title'][:24]}》: {fl}")
        n_book_flag += n_flag
        print(f"  [{bi:2d}] {book['title'][:20]:22s} {n_new:3d} 章有条目 / {n_empty:3d} 章显式空 / 标记 {n_flag} 章")
    src["note"] = src.get("note") or f"{series} 纲目策展（草案+人工复核）"
    with open(src_path, "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=1)
    print(f"\n[OK] 写回 {src_path}（共 {len(chapters)} 章入册，本批标记 {n_book_flag} 章）")
    print("下一步：python scripts/build-book-outlines.py " + series + "（校验+产出），然后人工过一遍 FLAG 章")


if __name__ == "__main__":
    main()
