#!/usr/bin/env python3
"""从 ../bible 导出静态 JSON 到 data/（供 bible-study PWA 使用，只读数据源）。"""
import json
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

    return books, bible_text, bible_notes, bible_xrefs


def export_lifereading(name_to_acronym):
    """每卷一个 lifereading/{缩写}.json：篇目 + 经文映射 + 正文。

    章节映射.json 提供 verses（经文映射），索引.json 提供 local_rel（md 文件路径），
    按 article id 合并。
    """
    mapping = json.loads(LIFEREADING_MAPPING.read_text(encoding='utf-8'))
    index = json.loads(LIFEREADING_INDEX.read_text(encoding='utf-8'))
    # 按 (书卷, id) 建 local_rel 映射（article id 各书卷内从 1 起，跨书卷会冲突）
    rel_by_book = {
        book_name: {a.get('id'): a.get('local_rel', '') for a in book_entry.get('articles', [])}
        for book_name, book_entry in index.get('books', {}).items()
    }
    out_dir = DATA_DIR / 'lifereading'
    out_dir.mkdir(parents=True, exist_ok=True)
    for book_name, entry in mapping.get('books', {}).items():
        acronym = name_to_acronym.get(book_name, book_name[:1])
        rel_map = rel_by_book.get(book_name, {})
        articles = []
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
            articles.append({
                'id': a.get('id'),
                'title': a.get('title', ''),
                'verses': a.get('verses', []),
                'content': content,
            })
        (out_dir / f'{acronym}.json').write_text(
            json.dumps({'name': book_name, 'acronym': acronym, 'articles': articles}, ensure_ascii=False),
            encoding='utf-8',
        )
    print(f'生命读经导出：{len(mapping.get("books", {}))} 卷')


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(BIBLE_DB))
    try:
        index_to_name, name_to_acronym = load_book_names(conn)
        books, bible_text, bible_notes, bible_xrefs = export_bible(conn, index_to_name, name_to_acronym)
    finally:
        conn.close()

    (DATA_DIR / 'books.json').write_text(json.dumps(books, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-text.json').write_text(json.dumps(bible_text, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-notes.json').write_text(json.dumps(bible_notes, ensure_ascii=False), encoding='utf-8')
    (DATA_DIR / 'bible-xrefs.json').write_text(json.dumps(bible_xrefs, ensure_ascii=False), encoding='utf-8')
    export_lifereading(name_to_acronym)

    print(f'books: {len(books)} 卷')
    print(f'bible-text: {len(bible_text)} 节')
    print(f'bible-notes: {len(bible_notes)} 节有注解')
    print(f'bible-xrefs: {len(bible_xrefs)} 节有串珠')


if __name__ == '__main__':
    main()
