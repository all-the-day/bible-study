#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-topics.py — 专题数据装配 → data/topics/{id}.json

专题（如「活力八」）= 把散在各模块的**已有内容**按主题清单编成一条阅读动线：
经文走读经模块（不复制），生命读经/书报正文在这里拼成一份按书的读经单。

数据只读**已导出的** data/lifereading/{缩写}.json 与 data/books/，与页面看到的是
同一份数据（先跑 export.py / export-spiritual.py 再跑本脚本）。

用法：
    python build-topics.py            # 生成全部专题
    python build-topics.py --check    # 只校验（清单里的名字对不上就非零退出），不写文件
    TOPICS_DATA=/path/to/data python build-topics.py   # 数据目录覆盖（Delta worktree 里数据不在库、指向主工作区时用）

改专题内容 = 改下面的 REGISTRY，再重跑本脚本（**不要手改 data/topics/*.json**）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('TOPICS_DATA') or os.path.join(ROOT, 'data')
OUT_DIR = os.path.join(ROOT, 'data', 'topics')   # 产物总写回本仓库（数据可指向别处的只读副本）

# 书卷（序号须与 data/books.json 一致：腓立比书 50 / 歌罗西书 51）
BOOKS = {
    50: {'acronym': '腓', 'name': '腓立比书', 'chapters': 4},
    51: {'acronym': '西', 'name': '歌罗西书', 'chapters': 4},
}

# 读经单条目：src='lr' → data/lifereading/{缩写}.json 的篇目（按篇名**包含**匹配）；
#             src='book' → data/books 的指定章（按章标题匹配）
# 名字对不上会在构建时报错——专题内容是人工条目，宁可构建失败也不要静默少一篇。
REGISTRY = {
    'vitality8': {
        'title': '活力八',
        'blurb': '腓立比书与歌罗西书里的八条线：全备的供应、活基督、基督是一切、祈求与代求、'
                 '不住的祷告、同心合意、生机的联结与新生。',
        'payload': {
            'books': [
                {
                    'book': 50,
                    'chapters': [
                        {'n': 1, 'reads': [
                            {'src': 'lr', 'match': '耶稣基督之灵全备的供应'},
                            {'src': 'lr', 'match': '藉着活基督显大基督'},
                        ]},
                        {'n': 2, 'reads': [
                            {'src': 'lr', 'match': '同魂与不顾我们的魂'},
                        ]},
                        {'n': 4, 'reads': [
                            {'src': 'lr', 'match': '使徒在基督里知足的秘诀'},
                            {'src': 'book', 'series': 'sg', 'volume': 1, 'book': 25, 'chapter': 2},
                        ]},
                    ],
                },
                {
                    'book': 51,
                    'chapters': [
                        {'n': 1, 'reads': [
                            {'src': 'lr', 'match': '基督—居首位并包罗万有者'},
                            {'src': 'lr', 'match': '基督在你们里面成了荣耀的盼望'},
                        ]},
                        {'n': 3, 'reads': [
                            {'src': 'lr', 'match': '基督—我们的生命'},
                        ]},
                    ],
                },
            ],
        },
    },
}

# 篇内唯一 id（同缩写篇号可能因两辑重号，加缩写前缀）
def _ref_id(acronym, num, title):
    m = re.match(r'^(\d+)', str(title))
    return f'{acronym}{num or (m.group(1) if m else "?")}'


def _load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _lr_volume(acronym):
    """data/lifereading/{缩写}.json → {articles, source}（含全文，构建期才读）。"""
    path = os.path.join(DATA, 'lifereading', f'{acronym}.json')
    if not os.path.exists(path):
        raise SystemExit(f'缺少 {path}：先跑 scripts/export.py')
    return _load(path)


def _strip_lr_header(text):
    """去掉篇尾来源页脚与篇首「读经：…」引文块（导出时已剥掉标题行）。

    只动首尾的展示噪音：正文（含标题行与空行）不被重排列，标注偏移与 lr 模块一致。
    """
    lines = str(text or '').split('\n')
    while lines and re.match(r'^\*\*(来源|URL|获取时间)\*\*', lines[-1].strip()):
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[-1].strip() == '---':
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].strip().rstrip('：:') == '读经':
        i += 1
        # 引文块 = 连续的、以「书卷名…节。」/「。」结尾的行（续行以「。」结尾）
        while i < len(lines) and re.match(
                r'^[\u4e00-\u9fff○〇一二三四五六七八九十百\-~～、，,：:（）()上中下\s]*[节。]\s*$', lines[i].strip()):
            i += 1
    return '\n'.join(lines[i:])


def _strip_book_header(text, title):
    """书报章正文头部去重：容器自己渲染标题，正文开头重复的书名/章名行去掉。

    `markdown` 类的行保留（其后的正文与解析出的 title 不完全一致时也不直删）。
    偏移仍在行尾之后重新拼接（调用方传入的 text 就是后续渲染的源文本，前端按它算偏移）。
    """
    lines = str(text or '').split('\n')
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    # 三行式头部：「# 书名」→「## 篇名」→「篇名」（含前一行 md 标题）
    for k in range(3):
        if i >= len(lines):
            break
        t = lines[i].strip().lstrip('#').strip()
        if not t:
            break
        if k < 2 or t == str(title).strip() or t.endswith(str(title).strip()):
            i += 1
            continue
        break
    # 紧跟的「书名副题」行（如「…中对基督主观的经历」）：短行且与下一个标题行相像时删掉
    if i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(('读经', '#', '壹', '一　')):
        head = lines[i].strip()
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ''
        if nxt.rstrip('：:') == '读经' and len(head) <= 40:
            i += 1
    return '\n'.join(lines[i:])


def build(topic_id, entry):
    payload = entry['payload']
    out_books = []
    errors = []
    for b in payload['books']:
        meta = BOOKS.get(b['book'])
        if not meta:
            errors.append(f"未知书卷 {b['book']}")
            continue
        acr = meta['acronym']
        vol = _lr_volume(acr)
        arts = vol.get('articles') or []
        out_chapters = []
        for ch in b['chapters']:
            if not (1 <= ch['n'] <= meta['chapters']):
                errors.append(f"{meta['name']} 章号越界 {ch['n']}")
                continue
            reads, refs = [], []
            for item in ch['reads']:
                if item['src'] == 'lr':
                    hits = _find_lr(arts, item['match'], ch['n'])
                    if not hits:
                        errors.append(f"{meta['name']} 第{ch['n']}章：生命读经里找不到「{item['match']}」（且篇目覆盖本章）")
                        continue
                    for a in hits:
                        rid = _ref_id(acr, a.get('id'), a.get('title'))
                        refs.append({'tw': a.get('id'), 'id': rid})
                        reads.append({
                            'title': re.sub(r'^\d*第[^、]*、', '', str(a.get('title') or '')).strip(),
                            'src': 'lr',
                            'book': b['book'],
                            'id': rid,
                            'tw': a.get('id'),
                            'text': _strip_lr_header(a.get('content')),
                        })
                elif item['src'] == 'book':
                    cases = _load_book_chapter(item, errors)
                    if cases:
                        reads.extend(cases)
                else:
                    errors.append(f"未知来源 {item['src']}")
            out_chapters.append({'n': ch['n'], 'refs': refs, 'reads': reads})
        out_books.append({'book': b['book'], 'name': meta['name'], 'acronym': acr, 'chapters': out_chapters})

    if errors:
        for e in errors:
            print('ERROR:', e, file=sys.stderr)
        raise SystemExit(1)
    # 产物自检：空正文/空屏/空 refs 都是装配出错，不能静静上线
    for bk in out_books:
        for ch in bk['chapters']:
            if not ch['refs']:
                errors.append(f"{bk['name']} 第{ch['n']}章：没有可跳转的读经单条目")
            for r in ch['reads']:
                if len(r['text']) < 200:
                    errors.append(f"{bk['name']} 第{ch['n']}章「{r['title']}」正文为空/过敏（{len(r['text'])} 字）")
    if errors:
        for e in errors:
            print('ERROR:', e, file=sys.stderr)
        raise SystemExit(1)
    sizes = sum(len(r['text']) for bk in out_books for ch in bk['chapters'] for r in ch['reads'])
    out = {'id': topic_id, 'title': entry['title'], 'blurb': entry['blurb'], 'books': out_books}
    pages = sum(len(bk['chapters']) for bk in out_books)
    print(f"{topic_id}: {len(out_books)} 卷 / {pages} 屏 / {sum(len(ch['reads']) for bk in out_books for ch in bk['chapters'])} 篇 / {sizes / 1024:.0f} KB")
    return out


def _find_lr(arts, match, chapter):
    """在卷篇目里找清单条目：篇名包含 match，且**篇目覆盖本章**（verses 首段章号）——
    配套辑的篇名常互相包含（「X」⊂「X 为着显大基督」），以章号约束选出本章那一本篇。"""
    hits = []
    for a in arts:
        if match not in str(a.get('title') or ''):
            continue
        chs = []
        for v in (a.get('verses') or []):
            m = re.match(r'^(\d+)', str(v))
            if m:
                chs.append(int(m.group(1)))
        if chapter in chs:
            hits.append(a)
    return hits


def _load_book_chapter(item, errors):
    """书报某一章 → 一条 reads（按 metadata 取章标题，内容文件按辑加载）。"""
    series = item['series']
    v, b, c = item['volume'], item['book'], item['chapter']
    meta_path = os.path.join(DATA, 'books', f'{series}.json')
    vol_path = os.path.join(DATA, 'books', f'{series}-{v}.json')
    if not os.path.exists(meta_path) or not os.path.exists(vol_path):
        errors.append(f'缺少 {series} 书报数据（先跑 scripts/export-spiritual.py）')
        return []
    meta = _load(meta_path)
    content = _load(vol_path)
    try:
        title = meta['volumes'][v - 1]['books'][b]['chapters'][c]
        chapter = content['books'][b]['chapters'][c]
    except (KeyError, IndexError):
        errors.append(f'{series} 卷{v} 书{b} 章{c} 超出范围')
        return []
    return [{
        'title': str(title),
        'src': 'book',
        'book': None,
        'bookRef': {'series': series, 'volume': v, 'book': b, 'chapter': c},
        'text': _strip_book_header(chapter.get('content'), title),
    }]


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
