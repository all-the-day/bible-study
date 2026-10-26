#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""听书（audio）数据导出 —— 从《聖經鳥瞰》本地源目录生成 data/audio/

数据只含**元数据**（讲次标题、分片路径、时长），音频本体在阿里云 OSS，不入仓库。

来源目录结构（见 D:/document/聖經鳥瞰/AGENTS.md）：
    <NN>_<English-Short-Title>/<NN>_<English-Short-Title>[-<part>].mp3
    41 个讲次文件夹，95 个 mp3，约 2.4 GB

标题从 ID3 TIT2 取（原标签是台湾繁体，如「聖經鳥瞰35 腓立比書(一)(王生台弟兄)」），
经 opencc t2s 转简体 + 异体字补表后剥掉讲次号与讲者，得到「腓立比书」。

    python scripts/export-audio.py            # 生成 data/audio/
    python scripts/export-audio.py --check    # 只打印讲次表，不写盘

依赖：opencc-python-reimplemented（pip install opencc-python-reimplemented）；
ffprobe 可选（缺失时 durationSec 为 null，前端会在加载音频后自行补上时长）。
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'audio')

# 合集注册表（对外契约）：新增合集 = 这里加一条 + 跑一次脚本，前端零改动。
#   dir     本地源目录（讲次文件夹的父目录）
#   prefix  OSS 对象前缀（下游 URL 写死引用，不要改）
#   base    bucket 公网地址
#   speaker 讲者（剥标题用；None = 不剥）
#   rules   标题清洗规则（见 id3_bokan）
SOURCES = [
    {
        'id': 'niaokan',
        'name': '鸟瞰圣经',
        'speaker': '王生台',
        'dir': 'D:/document/聖經鳥瞰',
        'base': 'https://szkjweb.oss-cn-hangzhou.aliyuncs.com/',
        'prefix': 'u8jw85vqqv/',
        'rules': 'id3_bokan',
        # 讲次分组（前端底部切换条）：不填 = 单组平铺
        'groups': [{'id': 'ot', 'name': '旧约', 'to': 23}, {'id': 'nt', 'name': '新约', 'to': 41}],
        'expect': {'lectures': 41, 'tracks': 95},   # 源侧完整性基线（AGENTS.md）
    },
]

CN_NUM = '一二三四五六七八九十'
# opencc 不处理的异体字（台湾用字）：臓→脏、徳→德、啓→启 等按实测补
VARIANT_T2S = {'臓': '脏', '徳': '德'}

try:
    import opencc
    _T2S = opencc.OpenCC('t2s')
except ImportError:   # pragma: no cover
    _T2S = None


def _to_simplified(s):
    if _T2S is None:
        sys.exit('缺少依赖 opencc-python-reimplemented：pip install opencc-python-reimplemented')
    s = _T2S.convert(s)
    for k, v in VARIANT_T2S.items():
        s = s.replace(k, v)
    return s


def read_id3_title(path):
    """读 ID3v2 的 TIT2。只解析标签头，不读音频数据。"""
    with open(path, 'rb') as f:
        head = f.read(10)
        if head[:3] != b'ID3':
            return ''
        size = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F)
        tag = f.read(size)
    i = 0
    while i < len(tag) - 10:
        fid = tag[i:i + 4]
        if fid[0:1] == b'\x00':
            break
        fsize = int.from_bytes(tag[i + 4:i + 8], 'big')
        data = tag[i + 10:i + 10 + fsize]
        if fid == b'TIT2' and data:
            enc = data[0]
            codec = 'utf-16' if enc in (1, 2) else ('utf-8' if enc == 3 else 'latin-1')
            return data[1:].decode(codec, errors='replace').replace('\x00', '').strip()
        i += 10 + fsize
    return ''


def _strip_part(title):
    """去掉标题尾部的分段标记：(一)/(五)完/五(完)/(续)/末尾单个中文数字。"""
    t = title
    for _ in range(4):
        prev = t
        t = re.sub(r'^(.*?)\s*[（(]\s*(?:完|续)\s*[）)]\s*$', r'\1', t)
        t = re.sub(r'^(.*?)\s*[（(]\s*[' + CN_NUM + r']{1,3}\s*[）)]\s*(?:完|续)?\s*$', r'\1', t)
        t = re.sub(r'^(.*?[^\s' + CN_NUM + r'])\s*[' + CN_NUM + r']{1,3}\s*(?:完|续)?\s*$', r'\1', t)
        t = re.sub(r'\s*(?:完|续)\s*$', '', t)
        if t == prev:
            break
    return t.strip()


def rule_id3_bokan(raw, speaker):
    """《鳥瞰》ID3 规则：'聖經鳥瞰35 腓立比書(一)(王生台弟兄)' → (35, '腓立比书(一)')"""
    s = _to_simplified(raw)
    m = re.match(r'^圣经鸟瞰\s*(\d+)\s*[A-Za-z]?', s)
    n = int(m.group(1)) if m else None
    s = s[m.end():] if m else s
    if speaker:
        s = re.sub(r'[（(]\s*' + re.escape(speaker) + r'弟兄\s*[）)]', '', s)
    s = s.replace('－', '-').replace('—', '-')
    return n, re.sub(r'\s+', ' ', s).strip()


def probe_duration(path):
    """ffprobe 取精确时长（秒）。缺失 ffprobe 时返回 None，前端会兜底。"""
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=nw=1:nk=1', path],
            capture_output=True, text=True, timeout=60)
        return int(round(float(out.stdout.strip())))
    except Exception:
        return None


def group_of(groups, n):
    if not groups:
        return None
    for g in groups:
        if n <= g['to']:
            return g['id']
    return groups[-1]['id']


def build_collection(src):
    base_dir = src['dir']
    if not os.path.isdir(base_dir):
        sys.exit(f'源目录不存在：{base_dir}')

    problems = []
    lectures = []
    dirs = sorted(d for d in os.listdir(base_dir)
                  if os.path.isdir(os.path.join(base_dir, d)) and re.match(r'^\d{2}_', d))
    for d in dirs:
        files = sorted(glob.glob(os.path.join(base_dir, d, '*.mp3')))
        if not files:
            continue
        tracks = []
        for f in files:
            n, title = rule_id3_bokan(read_id3_title(f), src.get('speaker'))
            tracks.append({
                'n': n,
                'title': title,
                'path': os.path.relpath(f, base_dir).replace('\\', '/'),
                'bytes': os.path.getsize(f),
                'durationSec': probe_duration(f),
            })
        nums = {t['n'] for t in tracks}
        if len(nums) != 1 or None in nums:
            problems.append(f'{d}：讲次号不一致或缺失 {nums}')
            continue
        bases = {_strip_part(t['title']) for t in tracks}
        if len(bases) != 1:
            problems.append(f'{d}：分片归约标题不一致 {sorted(bases)}')
        n = nums.pop()
        lectures.append({
            'n': n,
            'title': sorted(bases, key=len)[0] if bases else d,
            'group': group_of(src.get('groups'), n),
            'durationSec': sum(t['durationSec'] or 0 for t in tracks) or None,
            'tracks': [{k: t[k] for k in ('title', 'path', 'bytes', 'durationSec')} for t in tracks],
        })

    lectures.sort(key=lambda x: x['n'])

    expect = src.get('expect') or {}
    if expect.get('lectures') and len(lectures) != expect['lectures']:
        problems.append(f"讲次数 {len(lectures)} ≠ 基线 {expect['lectures']}")
    total_tracks = sum(len(l['tracks']) for l in lectures)
    if expect.get('tracks') and total_tracks != expect['tracks']:
        problems.append(f"分片数 {total_tracks} ≠ 基线 {expect['tracks']}")
    if lectures and [l['n'] for l in lectures] != list(range(1, len(lectures) + 1)):
        problems.append('讲次号不连续（1..N）')

    for l in lectures:   # 分片编号即数组顺序（前端按「第一段/第二段」展示）
        for i, t in enumerate(l['tracks'], 1):
            t['i'] = i
    return lectures, problems


def main():
    ap = argparse.ArgumentParser(description='导出听书元数据到 data/audio/')
    ap.add_argument('--check', action='store_true', help='只打印讲次表，不写盘')
    ap.add_argument('--id', action='append', help='只导指定合集 id（可重复）')
    args = ap.parse_args()

    wanted = set(args.id or [])
    if wanted:
        unknown = wanted - {s['id'] for s in SOURCES}
        if unknown:
            sys.exit(f"--id 里的合集不存在：{', '.join(sorted(unknown))}\n"
                     f"可用：{', '.join(s['id'] for s in SOURCES)}")
    all_ok = True
    index = {'collections': []}

    for src in SOURCES:
        if wanted and src['id'] not in wanted:
            continue
        lectures, problems = build_collection(src)
        total_tracks = sum(len(l['tracks']) for l in lectures)
        total_dur = sum(l['durationSec'] or 0 for l in lectures)

        print(f"\n=== {src['id']} · {src['name']}：{len(lectures)} 讲 / {total_tracks} 分片 / {total_dur / 3600:.1f} 小时")
        for l in lectures:
            dur = f"{round((l['durationSec'] or 0) / 60):>3}分" if l['durationSec'] else '  ?  '
            print(f"  {l['n']:>2}  {l['title']:<32} {len(l['tracks'])}段 {dur}")
        if problems:
            all_ok = False
            print('\n  ✗ 自检失败：')
            for p in problems:
                print('    -', p)

        index['collections'].append({
            'id': src['id'],
            'name': src['name'],
            'speaker': src.get('speaker'),
            'lectures': len(lectures),
            'tracks': total_tracks,
            'durationSec': total_dur or None,
            'groups': src.get('groups') or [],
        })

        if not args.check:
            os.makedirs(OUT_DIR, exist_ok=True)
            payload = {
                'id': src['id'],
                'name': src['name'],
                'speaker': src.get('speaker'),
                'baseUrl': src['base'] + src['prefix'],
                'groups': src.get('groups') or [],
                'lectures': lectures,
            }
            path = os.path.join(OUT_DIR, f"{src['id']}.json")
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
            print(f"  -> {os.path.relpath(path, ROOT)}")

    if args.check:
        print('\n（--check：未写盘）')
        return 0 if all_ok else 1

    path = os.path.join(OUT_DIR, 'index.json')
    # --id 只导部分合集时必须与旧索引合并，否则另一个合集会从索引里消失
    # （抽屉左栏 / 首页检索 / APK 数据清单全部丢它）。与 export-spiritual.py 同款做法。
    if args.id:
        prev = {}
        try:
            with open(path, encoding='utf-8') as f:
                prev = {c['id']: c for c in (json.load(f).get('collections') or [])}
        except Exception:
            prev = {}   # 索引不存在/损坏：按全量写（首次导出场景）
        merged = dict(prev)
        for c in index['collections']:
            merged[c['id']] = c
        order = [s['id'] for s in SOURCES]
        index['collections'] = sorted(
            merged.values(), key=lambda c: order.index(c['id']) if c['id'] in order else len(order))
        kept = [c['id'] for c in index['collections'] if c['id'] not in {s['id'] for s in SOURCES if not wanted or s['id'] in wanted}]
        if kept:
            print(f"  （索引保留未参与本次导出的合集：{', '.join(kept)}）")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f"\n-> {os.path.relpath(path, ROOT)}")
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
