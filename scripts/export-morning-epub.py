#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export-morning-epub.py — 从特会信息 epub 导出完整听抄 → data/morning/{期}.json

数据源：Notion 下载的特会信息 epub（权威完整转写稿，如 2026-3-MDC.epub）。
背景：反编译晨读 App 资源的 detail_sections 听抄被截断（每篇缺 18-27%），
自此期起听抄以 epub 为准（2026-08 决定）。

用法：
  python export-morning-epub.py <epub 路径> --period 2026-03
  可选：--title / --subtitle / --season / --year（缺省从已有 data/morning/{period}.json
        读取，保证重跑幂等；subtitle 也可从 epub index 的「总题：」自动推导）

epub 结构（OPS/*.htm）：
  {n}_ts.htm   听抄全文（<p> 段落，含纲目标题行「壹/一/1/a」等）
  {n}_cv.htm   晨兴（含「读经：」经文行，作为 chapter.scripture）
  {n}_dg.htm   纲目；{n}_ce.htm 中英对照（本脚本不导出）
输出与反编译导出同 schema：{id,title,subtitle,year,season,mottos,
  chapters:[{number,title,scripture,content}]}，并更新 data/morning/index.json 该期条目
（其他期不动）。
"""
import argparse
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'morning')


def extract_ps(html):
    """提取 <p> 段落文本（去标签、去空）"""
    return [re.sub(r'<[^>]+>', '', p).strip()
            for p in re.findall(r'<p[^>]*>(.*?)</p>', html, re.S)
            if re.sub(r'<[^>]+>', '', p).strip()]


def chapter_title(ps):
    """「第二篇　达到神圣启示的最高峰」→ 「达到神圣启示的最高峰」"""
    for p in ps:
        m = re.match(r'^第[一二三四五六七八九十百]+篇[\u3000 ]*(.*)$', p)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return ''


def scripture_from_cv(cv_html):
    for p in extract_ps(cv_html):
        if p.startswith('读经：'):
            return p[len('读经：'):].strip()
    return ''


HEADER_RE = re.compile(r'^(总题：|第[一二三四五六七八九十百]+篇[\u3000 ]|未经讲者审阅|标语|@page)')


def export():
    parser = argparse.ArgumentParser(description='从特会信息 epub 导出完整听抄')
    parser.add_argument('epub', help='epub 文件路径')
    parser.add_argument('--period', required=True, help='期 id（如 2026-03）')
    parser.add_argument('--title', help='期标题（缺省读已有数据）')
    parser.add_argument('--subtitle', help='总题（缺省从 epub index 推导）')
    parser.add_argument('--season', help='季节（如 03 国殇节特会）')
    parser.add_argument('--year', type=int, help='年份')
    args = parser.parse_args()

    os.makedirs(OUT, exist_ok=True)
    old_path = os.path.join(OUT, args.period + '.json')
    old = {}
    if os.path.exists(old_path):
        with open(old_path, encoding='utf-8') as f:
            old = json.load(f)

    try:
        z = zipfile.ZipFile(args.epub)
    except Exception as e:
        print(f'打不开 epub：{e}', file=sys.stderr)
        return 1
    names = set(z.namelist())

    # subtitle：优先参数，其次 epub index「总题：」，再退已有数据
    subtitle = args.subtitle
    if not subtitle and 'OPS/index.html' in names:
        for p in extract_ps(z.read('OPS/index.html').decode('utf-8')):
            if p.startswith('总题：'):
                subtitle = p[len('总题：'):].strip()
                break
    if not subtitle:
        subtitle = old.get('subtitle', '')

    chapters = []
    n = 1
    while f'OPS/{n}_ts.htm' in names:
        ts_ps = extract_ps(z.read(f'OPS/{n}_ts.htm').decode('utf-8'))
        title = chapter_title(ts_ps)
        if not title and old.get('chapters') and n <= len(old['chapters']):
            title = old['chapters'][n - 1].get('title', '')
        scripture = ''
        cv_name = f'OPS/{n}_cv.htm'
        if cv_name in names:
            scripture = scripture_from_cv(z.read(cv_name).decode('utf-8'))
        body = [p for p in ts_ps if not HEADER_RE.match(p)]
        chapters.append({
            'number': n,
            'title': title,
            'scripture': scripture,
            'content': '\n'.join(body),
        })
        n += 1

    if not chapters:
        print(f'epub 内未找到 OPS/*_ts.htm，期 id 或文件不对？', file=sys.stderr)
        return 1

    period = {
        'id': args.period,
        'title': args.title or old.get('title', ''),
        'subtitle': subtitle,
        'year': args.year or old.get('year'),
        'season': args.season or old.get('season', ''),
        'mottos': old.get('mottos', []),
        'chapters': chapters,
    }
    with open(old_path, 'w', encoding='utf-8') as f:
        json.dump(period, f, ensure_ascii=False, separators=(',', ':'))

    # 更新 index.json 该期条目（其他期不动）
    idx_path = os.path.join(OUT, 'index.json')
    if os.path.exists(idx_path):
        with open(idx_path, encoding='utf-8') as f:
            idx = json.load(f)
        entry = {'id': args.period, 'title': period['title'], 'subtitle': period['subtitle'],
                 'season': period['season'], 'year': period['year'], 'chapters': len(chapters)}
        for i, t in enumerate(idx['trainings']):
            if t.get('id') == args.period:
                idx['trainings'][i] = entry
                break
        else:
            idx['trainings'].append(entry)
        with open(idx_path, 'w', encoding='utf-8') as f:
            json.dump(idx, f, ensure_ascii=False, separators=(',', ':'))

    print(f'[OK] {args.period} {period["title"]}（{len(chapters)} 篇，epub 完整听抄）-> {os.path.normpath(old_path)}')
    return 0


if __name__ == '__main__':
    sys.exit(export())
