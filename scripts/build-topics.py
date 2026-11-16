#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-topics.py — 专题（活力八 · 记录块）范围定义 → data/topics/{id}.json

专题 = **阅读记录按块归拢的快速查找页**：每个块 = 一个范围（某卷的原文 / 某卷的生命读经 /
某本书报），页面运行时从本机阅读历史（localStorage `bible-study.history`）里筛出落在该范围内的
记录并逐条给出跳转。**不复制正文、不预生成篇目清单**——数据只描述「哪些范围算这一专题」。

数据只读**已导出的** data/books.json（书卷名/章数）与 data/books/（书报章节），
范围写错（书卷不在允许范围、书报不存在、章数为 0）直接报错退出，不静默少内容。

用法：
    python build-topics.py            # 生成全部专题
    python build-topics.py --check    # 只校验不写文件
    TOPICS_DATA=/path/to/data python build-topics.py   # 数据目录覆盖（data/ 不入库的 worktree 用）

改专题范围 = 改下面的 REGISTRY 再重跑（**不要手改 data/topics/*.json**）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('TOPICS_DATA') or os.path.join(ROOT, 'data')
OUT_DIR = os.path.join(ROOT, 'data', 'topics')   # 产物总写回本仓库（数据可指向别处的只读副本）

# 活力八只收这两卷（腓立比书 / 歌罗西书）；书卷名与章数以 data/books.json 为准
ALLOWED_BOOKS = (50, 51)

# 专题：blocks = 记录块的**范围定义**（顺序即页面顺序）。字段——
#   kind     'bible'（原文按章）/ 'lifereading'（该卷生命读经按篇）/ 'books'（书报按章）
#   book     书卷序号（1-66，见 data/books.json），bible / lifereading 用
#   bookRead 书报定位 {series, volume, book[, label]}（volume 1 基、book 0 基，与书报路由一致）；
#            books 块用，label 可选（覆盖块标题里的书名显示）
#
# ⚠️ 页面只显示**读过的记录**：块内没有记录时显示「还没有阅读记录」，不列篇目清单——
#    要按章节/篇目主动浏览仍走各阅读器的抽屉。
# 指定书报《福音的托付》（属灵书报第二辑第 20 本，7 章）：2026-11-04 书报定稿清理后
# sg 卷2 删掉一本重复书，本书由 book 21 前移到 book 20（章序与内容不变）。
REGISTRY = {
    'vitality8': {
        'title': '活力八',
        'blocks': [
            {'kind': 'bible', 'book': 50},
            {'kind': 'lifereading', 'book': 50},
            {'kind': 'bible', 'book': 51},
            {'kind': 'lifereading', 'book': 51},
            {'kind': 'books', 'bookRead': {'series': 'sg', 'volume': 2, 'book': 20}},
        ],
    },
}


def _load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _books_meta():
    """data/books.json → {index: {name, acronym, chapters}}（只取专题允许的书卷）。"""
    return {b['index']: b for b in _load(os.path.join(DATA, 'books.json')) if b['index'] in ALLOWED_BOOKS}


def _lr_article_count(acronym):
    """data/lifereading/{缩写}.json → 篇目数（校验数据在、且非空）。"""
    path = os.path.join(DATA, 'lifereading', f'{acronym}.json')
    if not os.path.exists(path):
        raise SystemExit(f'缺少 {path}：先跑 scripts/export.py')
    return len(_load(path).get('articles') or [])


def _book_read_ref(ref, errors):
    """指定书报：校验存在并取书名与章数（与书报路由同基数：volume 1 基、book 0 基）。"""
    series = str(ref.get('series') or '')
    v, b = ref.get('volume'), ref.get('book')
    meta_path = os.path.join(DATA, 'books', f'{series}.json')
    vol_path = os.path.join(DATA, 'books', f'{series}-{v}.json')
    if not series or not os.path.exists(meta_path) or not os.path.exists(vol_path):
        errors.append(f'书报 {series} 缺数据（先跑 scripts/export-spiritual.py）')
        return None
    try:
        book = _load(meta_path)['volumes'][v - 1]['books'][b]
    except (KeyError, IndexError, TypeError):
        errors.append(f'书报 {series} 卷{v} 书{b} 超出范围')
        return None
    out = {'series': series, 'volume': v, 'book': b,
           'name': str(book.get('title') or ''), 'chapters': len(book.get('chapters') or [])}
    label = str(ref.get('label') or '').strip()
    if label:
        out['label'] = label
    return out


def _block(blk, meta, errors):
    kind = blk.get('kind')
    if kind in ('bible', 'lifereading'):
        book = blk.get('book')
        if book not in meta:
            errors.append(f'块 {kind}：书卷 {book} 不在专题允许范围（{ALLOWED_BOOKS}）')
            return None
        m = meta[book]
        out = {'kind': kind, 'book': book, 'name': m['name'], 'chapters': m['chapters']}
        if kind == 'bible':
            out['label'] = m['name']
        else:
            n = _lr_article_count(m['acronym'])
            if not n:
                errors.append(f'块 lifereading：{m["name"]} 没有生命读经篇目')
                return None
            out['articles'] = n
            out['label'] = f'{m["name"]} · 生命读经'
        return out
    if kind == 'books':
        ref = _book_read_ref(blk.get('bookRead') or {}, errors)
        if not ref:
            return None
        if not ref['chapters']:
            errors.append(f'块 books：书报「{ref["name"]}」没有章节')
            return None
        return {'kind': 'books', 'series': ref['series'], 'volume': ref['volume'],
                'book': ref['book'], 'name': ref['name'], 'chapters': ref['chapters'],
                'label': ref.get('label') or ref['name']}
    errors.append(f'未知块类型：{kind!r}')
    return None


def build(topic_id, entry):
    meta = _books_meta()
    errors, blocks = [], []
    for blk in entry.get('blocks') or []:
        out = _block(blk, meta, errors)
        if out:
            blocks.append(out)
    if not blocks:
        errors.append('专题没有任何有效块')
    if errors:
        for e in errors:
            print('ERROR:', e, file=sys.stderr)
        raise SystemExit(1)
    out = {'id': topic_id, 'title': entry['title'], 'blocks': blocks}
    print(f'{topic_id}: {len(blocks)} 块 — ' + ' / '.join(b['label'] for b in blocks))
    return out


def main():
    check = '--check' in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)
    for topic_id, entry in REGISTRY.items():
        out = build(topic_id, entry)
        if check:
            continue
        path = os.path.join(OUT_DIR, f'{topic_id}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        print('  →', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    main()
