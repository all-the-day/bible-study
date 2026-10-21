#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-topics.py — 专题（作业单）数据装配 → data/topics/{id}.json

专题 = 一份「作业单」的**链接聚合页**：每周一条任务，条目分别指向读经模块的原文、
生命读经模块的篇目、书报模块的章节——正文一律不复制，页面只放跳转。

数据只读**已导出的** data/lifereading/{缩写}.json 与 data/books/（与页面看到的是同一份）。
篇目标题、章标题由脚本解析；篇号对不上/不覆盖该章/章号越界都直接报错退出，不静默少内容。

用法：
    python build-topics.py            # 生成全部专题
    python build-topics.py --check    # 只校验不写文件
    TOPICS_DATA=/path/to/data python build-topics.py   # 数据目录覆盖（data/ 不入库的 worktree 用）

改作业单内容 = 改下面的 REGISTRY 再重跑（**不要手改 data/topics/*.json**）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('TOPICS_DATA') or os.path.join(ROOT, 'data')
OUT_DIR = os.path.join(ROOT, 'data', 'topics')   # 产物总写回本仓库（数据可指向别处的只读副本）

# 作业单只收这两卷（腓立比书 / 歌罗西书）；书卷名与章数以 data/books.json 为准
ALLOWED_BOOKS = (50, 51)

# 作业单：一周一条。字段——
#   n        周次（页面显示「第 n 周」；与章号无绑定，按活动作业单编）
#   book     书卷序号（1-66，见 data/books.json）
#   chapter  该周所学的章
#   articles 生命读经篇号（按顺序；id 见 data/lifereading/{缩写}.json），页面按顺序列链接
#   bookRead 指定书报 {series, volume, book, chapter}（volume 1 基、book/chapter 0 基，与书报路由一致）
#            或 None → 页面该行显示「指定书报待填」
#   memory   背经经节（如 '腓1:21'）或 None → 该行显示「背经经节待填」
#
# ⚠️ 下面的篇号是**默认值**（按「经文整段落在该章内、按篇号取前三篇」选出来的），
#    活动作业单到手后逐周替换即可；西 4 章源数据只有 2 篇整段落在本章（31/65），故只挂 2 篇。
REGISTRY = {
    'vitality8': {
        'title': '活力八',
        'blurb': '腓立比书与歌罗西书：按作业单逐周读原文、生命读经与注解。',
        'weeks': [
            {'n': 1, 'book': 50, 'chapter': 1, 'articles': [3, 4, 5], 'bookRead': None, 'memory': None},
            {'n': 2, 'book': 50, 'chapter': 2, 'articles': [9, 10, 11], 'bookRead': None, 'memory': None},
            {'n': 3, 'book': 50, 'chapter': 3, 'articles': [17, 18, 19], 'bookRead': None, 'memory': None},
            {'n': 4, 'book': 50, 'chapter': 4, 'articles': [26, 27, 28], 'bookRead': None, 'memory': None},
            {'n': 5, 'book': 51, 'chapter': 1, 'articles': [2, 3, 4], 'bookRead': None, 'memory': None},
            {'n': 6, 'book': 51, 'chapter': 2, 'articles': [18, 19, 20], 'bookRead': None, 'memory': None},
            {'n': 7, 'book': 51, 'chapter': 3, 'articles': [27, 28, 29], 'bookRead': None, 'memory': None},
            {'n': 8, 'book': 51, 'chapter': 4, 'articles': [31, 65], 'bookRead': None, 'memory': None},
        ],
    },
}


def _load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _books_meta():
    """data/books.json → {index: {name, acronym, chapters}}（只取作业单允许的书卷）。"""
    return {b['index']: b for b in _load(os.path.join(DATA, 'books.json')) if b['index'] in ALLOWED_BOOKS}


def _lr_articles(acronym):
    """data/lifereading/{缩写}.json → articles（构建期只读，正文不进产物）。"""
    path = os.path.join(DATA, 'lifereading', f'{acronym}.json')
    if not os.path.exists(path):
        raise SystemExit(f'缺少 {path}：先跑 scripts/export.py')
    return _load(path).get('articles') or []


def _clean_lr_title(title):
    """生命读经篇名：去掉「005第五篇、」这类编号前缀（页面自己排顺序）。"""
    return re.sub(r'^\d*第[^、]*、', '', str(title or '')).strip()


def _cover_chapter(art, chapter):
    """篇目 verses 的首段章号是否覆盖该章（与前端 autoMatch 同口径）。"""
    for v in (art.get('verses') or []):
        m = re.match(r'^(\d+)', str(v))
        if m and int(m.group(1)) == chapter:
            return True
    return False


def _book_read_ref(ref, errors):
    """指定书报：校验章节存在并取章标题（与书报路由同基数：volume 1 基、book/chapter 0 基）。"""
    series = str(ref.get('series') or '')
    v, b, c = ref.get('volume'), ref.get('book'), ref.get('chapter')
    meta_path = os.path.join(DATA, 'books', f'{series}.json')
    vol_path = os.path.join(DATA, 'books', f'{series}-{v}.json')
    if not series or not os.path.exists(meta_path) or not os.path.exists(vol_path):
        errors.append(f'书报 {series} 缺数据（先跑 scripts/export-spiritual.py）')
        return None
    try:
        title = _load(meta_path)['volumes'][v - 1]['books'][b]['chapters'][c]
    except (KeyError, IndexError, TypeError):
        errors.append(f'书报 {series} 卷{v} 书{b} 章{c} 超出范围')
        return None
    return {'series': series, 'volume': v, 'book': b, 'chapter': c, 'title': str(title)}


def _week(w, meta, lr_cache, errors):
    n, book, chapter = w.get('n'), w.get('book'), w.get('chapter')
    if not isinstance(n, int) or n < 1:
        errors.append(f'周次非法：{n!r}')
        return None
    if book not in meta:
        errors.append(f'第{n}周：书卷 {book} 不在作业单允许范围（{ALLOWED_BOOKS}）')
        return None
    m = meta[book]
    if not isinstance(chapter, int) or not (1 <= chapter <= m['chapters']):
        errors.append(f'第{n}周：{m["name"]} 章号越界 {chapter!r}')
        return None
    if book not in lr_cache:
        lr_cache[book] = _lr_articles(m['acronym'])
    arts = lr_cache[book]
    by_id = {a.get('id'): a for a in arts}
    out_arts, ids = [], w.get('articles') or []
    if not ids:
        errors.append(f'第{n}周：没有生命读经篇目')
    for aid in ids:
        a = by_id.get(aid)
        if not a:
            errors.append(f'第{n}周：{m["name"]} 第{aid}篇不存在')
            continue
        if not _cover_chapter(a, chapter):
            errors.append(f'第{n}周：第{aid}篇「{_clean_lr_title(a.get("title"))}」不覆盖第{chapter}章')
            continue
        out_arts.append({'id': aid, 'title': _clean_lr_title(a.get('title'))})
    return {
        'n': n,
        'book': book,
        'bookName': m['name'],
        'acronym': m['acronym'],
        'chapter': chapter,
        'articles': out_arts,
        'bookRead': _book_read_ref(w['bookRead'], errors) if w.get('bookRead') else None,
        'memory': (str(w.get('memory')).strip() or None) if w.get('memory') else None,
    }


def build(topic_id, entry):
    meta = _books_meta()
    errors, lr_cache, weeks = [], {}, []
    for w in entry.get('weeks') or []:
        out = _week(w, meta, lr_cache, errors)
        if out:
            weeks.append(out)
    # 自检：空作业单 / 周次重复都不算合法产物
    if not weeks:
        errors.append('作业单没有任何有效周次')
    ns = [w['n'] for w in weeks]
    if len(set(ns)) != len(ns):
        errors.append(f'周次重复：{ns}')
    if errors:
        for e in errors:
            print('ERROR:', e, file=sys.stderr)
        raise SystemExit(1)
    weeks.sort(key=lambda w: w['n'])
    out = {'id': topic_id, 'title': entry['title'], 'blurb': entry['blurb'], 'weeks': weeks}
    n_arts = sum(len(w['articles']) for w in weeks)
    n_book = sum(1 for w in weeks if w['bookRead'])
    n_mem = sum(1 for w in weeks if w['memory'])
    print(f'{topic_id}: {len(weeks)} 周 / {n_arts} 篇生命读经 / 书报 {n_book} 条 / 背经 {n_mem} 条')
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
