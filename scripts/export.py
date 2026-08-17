#!/usr/bin/env python3
"""从 ../bible 导出静态 JSON 到 data/（供 bible-study PWA 使用，只读数据源）。"""
import json
import re
import sqlite3
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent  # bible-study/
BIBLE_DIR = ROOT.parent / 'bible'
BIBLE_DB = BIBLE_DIR / 'data' / 'raw' / 'bible_root' / 'bible.db'
LIFEREADING_MD_DIR = BIBLE_DIR / 'data' / 'raw' / 'life_study' / '生命读经' / '新旧约生命读经'
LIFEREADING_MAPPING = BIBLE_DIR / 'data' / 'raw' / 'life_study' / '生命读经章节映射.json'
LIFEREADING_INDEX = BIBLE_DIR / 'data' / 'raw' / 'life_study' / '生命读经索引.json'
DATA_DIR = ROOT / 'data'

HALF = {0: '', 1: '上', 2: '下'}  # content.flag → 半节后缀


def load_book_names(conn):
    """返回 index→full_name, name→acronym（仅取中文名，忽略英文行）。"""
    cur = conn.cursor()
    cur.execute("SELECT book_index, name, acronym_name FROM book_name ORDER BY book_index")
    index_to_name = {}
    name_to_acronym = {}
    for bi, name, acronym in cur.fetchall():
        if bi > 66:
            continue
        # 只取含汉字的中文名（book_name 表混有英文行）
        if not any('\u4e00' <= c <= '\u9fff' for c in name):
            continue
        if bi not in index_to_name or len(name) > len(index_to_name[bi]):
            index_to_name[bi] = name
        if acronym:
            name_to_acronym[name] = acronym
    return index_to_name, name_to_acronym


def verse_key(acronym, chapter, section, flag):
    return f"{acronym}{chapter}:{section}{HALF.get(flag, '')}"


def insert_markers(content, footnotes, beads):
    """在 content 中按 location（1 基插入点）插入 {N} 注脚号与 [a] 串珠号。"""
    at = defaultdict(list)
    for location, seq, _note in footnotes:
        at[location - 1].append(f'{{{seq}}}')
    for location, letter, _bead in beads:
        at[location - 1].append(f'[{letter}]')
    out = []
    for i, ch in enumerate(content):
        out.extend(at.get(i, []))
        out.append(ch)
    out.extend(at.get(len(content), []))
    return ''.join(out)


def export_bible(conn, index_to_name, name_to_acronym):
    cur = conn.cursor()
    cur.execute("SELECT book_index, MAX(chapter) FROM content WHERE book_index <= 66 GROUP BY book_index ORDER BY book_index")
    chapters_by_book = {bi: mx for bi, mx in cur.fetchall()}

    books = []
    for bi in range(1, 67):
        full = index_to_name.get(bi, str(bi))
        books.append({
            'index': bi,
            'name': full,
            'acronym': name_to_acronym.get(full, full[:1]),
            'chapters': chapters_by_book.get(bi, 0),
        })
    acronym_by_index = {b['index']: b['acronym'] for b in books}

    bible_text = {}
    bible_notes = {}
    bible_xrefs = {}

    cur.execute("SELECT book_index, chapter, section, flag, content FROM content WHERE book_index <= 66 ORDER BY book_index, chapter, section, flag")
    content_rows = cur.fetchall()
    verses = defaultdict(list)
    for bi, ch, sec, flag, text in content_rows:
        verses[(bi, ch, sec)].append((flag, text))

    cur.execute("SELECT book_index, chapter, section, flag, location, seq, note FROM footnote WHERE book_index <= 66 ORDER BY book_index, chapter, section, flag, seq")
    foot_notes = defaultdict(list)
    for bi, ch, sec, flag, location, seq, note in cur.fetchall():
        foot_notes[(bi, ch, sec, flag)].append((location, seq, note))

    cur.execute("SELECT book_index, chapter, section, flag, location, seq, bead FROM bead WHERE book_index <= 66 ORDER BY book_index, chapter, section, flag, location, seq")
    bead_rows = defaultdict(list)
    for bi, ch, sec, flag, location, seq, bead in cur.fetchall():
        bead_rows[(bi, ch, sec, flag)].append((location, str(seq), bead))

    for (bi, ch, sec), parts in verses.items():
        acronym = acronym_by_index.get(bi, str(bi))
        for flag, text in parts:
            key = verse_key(acronym, ch, sec, flag)
            fns = sorted(foot_notes.get((bi, ch, sec, flag), []), key=lambda x: x[0])
            beads = sorted(bead_rows.get((bi, ch, sec, flag), []), key=lambda x: x[0])
            bible_text[key] = insert_markers(text, fns, beads)
            if fns:
                # seq 可被多个注号位置复用（同 seq 仅一条有文本，其余 note 为 NULL）；
                # 按 seq 去重保留非空文本，输出 {seq: note}，前端按真实 seq 查找（seq 跨半节连续、可有空洞）。
                notes_by_seq = {}
                for _l, s, n in sorted(fns, key=lambda x: (x[1], x[0])):
                    if s not in notes_by_seq and n:
                        notes_by_seq[s] = n
                bible_notes[key] = notes_by_seq
            if beads:
                bible_xrefs[key] = {letter: (bead or '').lstrip('参见参') for _l, letter, bead in beads}

    # 纲目：每章 theme（level 1-2 跨章游走）+ items（level 1-6 带 section/flag 锚点）
    cur.execute("SELECT book_index, chapter, section, flag, level, outline FROM outline WHERE language='gb' AND book_index <= 66 ORDER BY book_index, chapter, section, flag, level")
    outlines_by_book = defaultdict(lambda: defaultdict(list))
    for bi, ch, sec, flag, level, text in cur.fetchall():
        outlines_by_book[bi][ch].append({'section': sec, 'flag': flag, 'level': level, 'text': text})

    bible_outlines = {}
    for bi in range(1, 67):
        acronym = acronym_by_index.get(bi, str(bi))
        open_level = {}  # level -> text，跨章游走
        for ch in sorted(outlines_by_book[bi]):
            outlines = sorted(outlines_by_book[bi][ch], key=lambda o: (o['section'], o['flag'], o['level']))
            # theme = 本章处理前的 level 1-2 上游状态（跨章继承，不重复本章自己的条目）
            theme = [{'level': lv, 'text': open_level[lv]} for lv in (1, 2) if lv in open_level]
            items = [{'level': o['level'], 'text': o['text'], 'section': o['section'], 'flag': o['flag']} for o in outlines]
            for o in outlines:
                open_level[o['level']] = o['text']
                for lv in range(o['level'] + 1, 7):
                    open_level.pop(lv, None)
            bible_outlines[f'{acronym}{ch}'] = {'theme': theme, 'items': items}

    return books, bible_text, bible_notes, bible_xrefs, bible_outlines


# 合并卷：生命读经卷名对应多个圣经书卷（读经行用全名标记上下卷）
GROUP_BOOK_PAIRS = {
    '撒母耳记': [('撒母耳记上', '撒上'), ('撒母耳记下', '撒下')],
    '列王纪': [('列王纪上', '王上'), ('列王纪下', '王下')],
    '历代志': [('历代志上', '代上'), ('历代志下', '代下')],
}


def parse_lr_book(content, book_name):
    """从正文「读经：」行下一行解析主书卷简称（撒上/撒下等），普通卷或无标记返回 None。"""
    pairs = GROUP_BOOK_PAIRS.get(book_name)
    if not pairs:
        return None
    lines = [l.strip() for l in (content or '').split('\n')]
    for i, l in enumerate(lines):
        if l == '读经：' or l.startswith('读经：'):
            reading = lines[i + 1] if i + 1 < len(lines) else ''
            best, best_pos = None, len(reading) + 1
            for full, short in pairs:
                pos = reading.find(full)
                if 0 <= pos < best_pos:
                    best, best_pos = short, pos
            return best
    return None


_CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}


def _cn_to_int(s):
    if not s:
        return None
    if s == '十':
        return 10
    if '十' in s:
        p = s.split('十')
        tens = _CN_NUM.get(p[0], 1) if p[0] else 1
        ones = _CN_NUM.get(p[1], 0) if len(p) > 1 and p[1] else 0
        return tens * 10 + ones
    return _CN_NUM.get(s)


def parse_lr_reading(content, book_name, book_names):
    """解析正文「读经：」行，返回 {书卷简称: 章节号列表}。

    映射.json 的 verses 字段与读经行常有出入（章节混用/错误），
    这里以读经行为准重新生成准确的章节范围。用书卷名列表识别边界，
    避免把其他书卷（如以弗所书/马太福音）的章节误并入合并卷。普通卷返回 None。
    """
    pairs = GROUP_BOOK_PAIRS.get(book_name)
    if not pairs:
        return None
    lines = [l.strip() for l in (content or '').split('\n')]
    reading = ''
    for i, l in enumerate(lines):
        if l == '读经：' or l.startswith('读经：'):
            reading = lines[i + 1] if i + 1 < len(lines) else ''
            break
    if not reading:
        return None
    # 读经行中所有书卷名出现的位置（作为段落边界）
    positions = []
    for name in book_names:
        for m in re.finditer(re.escape(name), reading):
            positions.append((m.start(), name))
    positions.sort()
    pair_map = dict(pairs)
    result = {}
    for i, (pos, name) in enumerate(positions):
        short = pair_map.get(name)
        if not short:
            continue
        end = positions[i + 1][0] if i + 1 < len(positions) else len(reading)
        seg = reading[pos + len(name):end]
        chs = set()
        for m in re.finditer(r'([一二三四五六七八九十]+)(?:至([一二三四五六七八九十]+))?章', seg):
            s = _cn_to_int(m.group(1))
            e = _cn_to_int(m.group(2)) if m.group(2) else s
            if s and e:
                chs.update(range(s, e + 1))
        if chs:
            result.setdefault(short, set()).update(chs)
    return {k: sorted(v) for k, v in result.items()}


def export_lifereading(name_to_acronym):
    """每卷一个 lifereading/{缩写}.json：篇目 + 经文映射 + 正文。

    章节映射.json 提供 verses（经文映射），索引.json 提供 local_rel（md 文件路径），
    按 article id 合并。

    合并卷（撒母耳记/列王纪/历代志）按每篇「读经：」行拆分为上下卷文件
    （撒上/撒下、王上/王下、代上/代下），避免章节号混用；无明确标记的篇目复制到各子卷。
    """
    mapping = json.loads(LIFEREADING_MAPPING.read_text(encoding='utf-8'))
    index = json.loads(LIFEREADING_INDEX.read_text(encoding='utf-8'))
    # 按 (书卷, id) 建 local_rel 映射（article id 各书卷内从 1 起，跨书卷会冲突）
    rel_by_book = {
        book_name: {a.get('id'): a.get('local_rel', '') for a in book_entry.get('articles', [])}
        for book_name, book_entry in index.get('books', {}).items()
    }
    out_dir = DATA_DIR / 'lifereading'
    # 清空旧文件（合并卷已拆分为子卷，避免残留撒/列/历.json）
    if out_dir.exists():
        for f in out_dir.glob('*.json'):
            f.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)
    for book_name, entry in mapping.get('books', {}).items():
        base_acronym = name_to_acronym.get(book_name, book_name[:1])
        rel_map = rel_by_book.get(book_name, {})
        groups = {}  # acronym -> {name, acronym, articles}
        for a in entry.get('articles', []):
            content = ''
            rel = rel_map.get(a.get('id'), '')
            md_path = LIFEREADING_MD_DIR / rel if rel else None
            if md_path and md_path.exists():
                text = md_path.read_text(encoding='utf-8')
                lines = text.split('\n')
                if lines and lines[0].startswith('#'):
                    lines = lines[1:]
                # 过滤末尾元数据行（来源/URL/获取时间，不应作为正文显示）
                lines = [l for l in lines if not l.strip().startswith(('**来源**', '**URL**', '**获取时间**'))]
                content = '\n'.join(lines).strip()
            article = {
                'id': a.get('id'),
                'title': a.get('title', ''),
                'verses': a.get('verses', []),
                'content': content,
            }
            if book_name in GROUP_BOOK_PAIRS:
                # 合并卷：以读经行为准重新生成 verses（映射.json 的 verses 章节混用不可靠），
                # 并按主书卷拆分到子卷文件。
                reading_map = parse_lr_reading(content, book_name, list(name_to_acronym.keys()))
                main = parse_lr_book(content, book_name)
                if reading_map:
                    if main and main in reading_map:
                        article['verses'] = [str(c) for c in reading_map[main]]
                    else:
                        article['verses'] = [str(c) for c in sorted(set().union(*reading_map.values()))]
                targets = [main] if main else [p[1] for p in GROUP_BOOK_PAIRS[book_name]]
            else:
                targets = [base_acronym]
            for acronym in targets:
                groups.setdefault(acronym, {'name': book_name, 'acronym': acronym, 'articles': []})
                groups[acronym]['articles'].append(article)
        for acronym, payload in groups.items():
            (out_dir / f'{acronym}.json').write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding='utf-8',
            )
    print(f'生命读经导出：{len(mapping.get("books", {}))} 卷')


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(BIBLE_DB))
    try:
        index_to_name, name_to_acronym = load_book_names(conn)
        books, bible_text, bible_notes, bible_xrefs, bible_outlines = export_bible(conn, index_to_name, name_to_acronym)
    finally:
        conn.close()

    (DATA_DIR / 'books.json').write_text(json.dumps(books, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-text.json').write_text(json.dumps(bible_text, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-notes.json').write_text(json.dumps(bible_notes, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-xrefs.json').write_text(json.dumps(bible_xrefs, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-outlines.json').write_text(json.dumps(bible_outlines, ensure_ascii=False), encoding='utf-8')
    export_lifereading(name_to_acronym)

    print(f'books: {len(books)} 卷')
    print(f'bible-text: {len(bible_text)} 节')
    print(f'bible-notes: {len(bible_notes)} 节有注解')
    print(f'bible-xrefs: {len(bible_xrefs)} 节有串珠')
    print(f'bible-outlines: {len(bible_outlines)} 章有纲目')


if __name__ == '__main__':
    main()
