#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export-persons.py — 派生「人物词典」→ data/persons.json

用途：书报正文里出现的人物名可点，弹出该人物小传（原型阶段仅在「十二篮」正文启用）。
数据派生自 export-spiritual.py 的产物（唯一事实源仍是 ../bible 的 spiritual_food 原始 md）：
  - data/books/bio.json   名人传记系列元数据（卷/书/章标题）
  - data/books/bio-1.json 名人传记正文（摘录小传开头做弹窗摘要）
不重新解析原始 md，与 export-verses.py 从 bible-text.json 派生的做法一致。

收录范围（原型：先小范围验证）：
  1) 《基督教历史人物小传》使徒时代之后的人物（第 17 章「坡旅甲」起）
     —— 使徒时代人物（雅各/约翰/彼得/马太/路加/腓力…）名字与圣经书卷简称冲突
     （「约翰福音」「马太福音」「腓立比书」里的「腓力」），且在正文中作圣经人物
     出现的频率极高（十二篮里「保罗」464 次），纳入会大面积误链，故排除。
  2) 有专门传记书的人物（见 BOOK_PERSONS 注册表）——目前只登记了「劳伦斯」。
     想扩人物时改这两处即可，前端零改动。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'persons.json')
BIO = 'bio'
BIO_VOLUME = 1            # data/books/bio-1.json
BIO_HAGIOGRAPHY = 0       # 名人传记 vol0 book0 = 《基督教历史人物小传》
# 章节 index 区间（闭区间）：「十七 坡旅甲」→「四十七 王载」。
# 之前的 0-17 是前言与使徒时代人物（雅各/约翰/彼得/马太/路加/腓力…），
# 之后 49 是慕勒见证（与「三十九 穆勒」重复），一并排除。
PERSON_START, PERSON_END = 18, 48

# 有专门传记书的人物：canonical 名 → (书名, 章 index)
BOOK_PERSONS = {
    '劳伦斯': ('劳伦斯属灵格言', 0),
}

# 别名扩展（canonical 名 → 语料中实际出现的其它写法）
# 「路德马丁」「卫斯理约翰」为十二篮实测写法（德式/中文式姓名顺序），已核对全量语料
ALIAS_EXTRA = {
    '马丁路德': ['路德马丁', '马丁路得'],
    '卫斯理约翰': ['卫斯理', '约翰卫斯理', '卫斯理·约翰'],
    '本仁约翰': ['本仁·约翰', '约翰本仁'],
    '牛顿约翰': ['牛顿·约翰', '约翰牛顿'],
    '克里威廉': ['克里·威廉', '威廉克里'],
    '范妮罗斯比': ['范妮·罗斯比'],
    '穆勒': ['慕勒'],
    '奥古斯丁': ['圣奥古斯丁'],
}

# 复合词保护：命中时若更长的这些词覆盖同一位置，则不链接（防「加尔文主义」链到「加尔文」）
BLOCK_WORDS = ['加尔文主义', '路德会', '卫斯理派', '卫斯理宗', '慕迪会']

NUM = '一二三四五六七八九十'
EXCERPT_LEN = 150


def norm_name(s):
    """规范化人名：去空格与姓名分隔点（本仁 . 约翰 → 本仁约翰）。"""
    return re.sub(r'[\s.·．]+', '', s or '')


def parse_hagiology_title(title):
    """解析《基督教历史人物小传》章节标题 → {name, en, years, desc}；非人物章节返回 None。

    标题形态多样：二十九 本仁 . 约翰 (John Bunyan公元1628-1688年)(世界名著的作者)、
    四十一戴德生(Hudson Taylor公元1832-1905年)、三十八 席胜魔(公元1835-1896年)(兼具秀才…)
    —— 括号内依次可能是 英文名+年份 / 年份 / 中文简介，逐个括号解析。
    """
    s = re.sub(r'^[%s]+\s*[:：]?\s*' % NUM, '', title).strip()
    tails = []
    if '(' in s or '（' in s:
        idx = min([i for i in (s.find('('), s.find('（')) if i >= 0])
        tails = re.findall(r'[（(]([^)）]*)[)）]?', s[idx:])
        s = s[:idx]
    name = re.sub(r'小传$', '', norm_name(s))
    if not name or len(name) > 8 or re.search(r'[，。、—]', name):
        return None
    en, years, desc = '', '', ''
    for t in tails:
        t = t.strip()
        ym = re.search(r'(?:公元)?\s*\d{2,4}\s*[-–~]\s*\d{2,4}\s*(?:/\d+)?\s*年?', t)
        if ym and not years:
            parts = re.findall(r'\d+', ym.group(0))
            years = '—'.join(parts[:2])
        head = t[:ym.start()] if ym else t
        head = re.sub(r'公元\s*$', '', head).strip()
        if re.search(r'[A-Za-z]', head):
            en = en or head
        elif head and not years_only(t, ym):
            desc = desc or head
    return {'name': name, 'en': en, 'years': years, 'desc': desc}


def years_only(t, ym):
    """该括号是否只是年份（无中文简介）。"""
    if not ym:
        return False
    rest = t[:ym.start()] + t[ym.end():]
    rest = re.sub(r'[（(）)公元\s/]', '', rest)
    return not rest


def make_id(name, en, used):
    base = re.sub(r'[^a-z0-9]+', '-', (en or '').lower()).strip('-') or 'person'
    cand, i = base, 2
    while cand in used:
        cand = f'{base}-{i}'
        i += 1
    used.add(cand)
    return cand


def is_titleish(line, chapter_title, book_title):
    """判断某行是否为重复的书名/章标题行（源 md 首部惯例）。"""
    ln = norm_name(line)
    if not ln or len(ln) > 40:
        return False
    for t in (chapter_title, book_title):
        tn = norm_name(t)
        if tn and (ln == tn or tn.startswith(ln)):
            return True
    return False


def excerpt_of(content, chapter_title, book_title=''):
    """弹窗摘要：跳过首部的标题行/括号残片/作者署名，取正文前 EXCERPT_LEN 字。"""
    lines = [l.strip() for l in (content or '').split('\n')]
    out = []
    for l in lines:
        if not l:
            continue
        if not out:
            if is_titleish(l, chapter_title, book_title): continue
            if l.startswith(('(', '（')): continue           # 标题被拆行后的括号残片
            if l == '佚名' or (len(l) <= 8 and '。' not in l): continue
        out.append(l)
        if sum(len(x) for x in out) >= EXCERPT_LEN:
            break
    text = re.sub(r'\s+', '', ''.join(out))
    text = re.sub(r'^佚名', '', text)
    return text[:EXCERPT_LEN] + ('…' if len(text) > EXCERPT_LEN else '')


def main():
    with open(os.path.join(ROOT, 'data', 'books', f'{BIO}.json'), encoding='utf-8') as f:
        meta = json.load(f)
    with open(os.path.join(ROOT, 'data', 'books', f'{BIO}-{BIO_VOLUME}.json'), encoding='utf-8') as f:
        content = json.load(f)

    vol_meta = meta['volumes'][BIO_VOLUME - 1]
    vol_cont = content['books']
    persons, used, seen_names, skipped = [], set(), set(), []

    hagio_meta = vol_meta['books'][BIO_HAGIOGRAPHY]
    hagio_cont = vol_cont[BIO_HAGIOGRAPHY]['chapters']
    for i, title in enumerate(hagio_meta['chapters']):
        if not (PERSON_START <= i <= PERSON_END):
            skipped.append(f'[{i}] {title}')
            continue
        p = parse_hagiology_title(title)
        if not p:
            skipped.append(f'[{i}] {title}（无法解析）')
            continue
        if p['name'] in seen_names:      # 重复人物（如「二十五 奥古斯丁」与「三十 奥古斯丁小传」）
            skipped.append(f'[{i}] {title}（与已有「{p["name"]}」重复）')
            continue
        seen_names.add(p['name'])
        persons.append({
            'id': make_id(p['name'], p['en'], used),
            'name': p['name'],
            'en': p['en'],
            'years': p['years'],
            'desc': p['desc'],
            'aliases': [p['name']] + ALIAS_EXTRA.get(p['name'], []),
            'loc': {'series': BIO, 'volume': BIO_VOLUME, 'book': BIO_HAGIOGRAPHY, 'chapter': i},
            'locLabel': f'{vol_meta["title"]} · {hagio_meta["title"]} · {title}',
            'excerpt': excerpt_of(hagio_cont[i].get('content'), title, hagio_meta['title']),
        })

    for name, (book_title, ch_idx) in BOOK_PERSONS.items():
        titles = [b['title'] for b in vol_meta['books']]
        if book_title not in titles:
            print(f'  警告：{book_title} 不在名人传记系列，跳过 {name}')
            continue
        if name in seen_names:
            continue
        seen_names.add(name)
        b_idx = titles.index(book_title)
        ch_meta = vol_meta['books'][b_idx]['chapters'][ch_idx]
        ch = vol_cont[b_idx]['chapters'][ch_idx]
        persons.append({
            'id': make_id(name, '', used),
            'name': name,
            'en': '',
            'years': '',
            'desc': '',
            'aliases': [name] + ALIAS_EXTRA.get(name, []),
            'loc': {'series': BIO, 'volume': BIO_VOLUME, 'book': b_idx, 'chapter': ch_idx},
            'locLabel': f'{vol_meta["title"]} · {book_title} · {ch_meta}',
            'excerpt': excerpt_of(ch.get('content'), ch_meta, book_title),
        })

    data = {
        'scope': ['slat'],   # 原型阶段：仅这些系列正文启用人物链接，空数组=全模块
        'source': {'series': BIO, 'volume': BIO_VOLUME},
        'blockWords': BLOCK_WORDS,
        'persons': persons,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print(f'人物 {len(persons)} 位 → {OUT}（{os.path.getsize(OUT) / 1024:.1f} KB）')
    print('已排除：', '；'.join(skipped) if skipped else '无')
    no_alias = [p['name'] for p in persons if not p['aliases']]
    if no_alias:
        print('无别名：', ' '.join(no_alias))


if __name__ == '__main__':
    main()
