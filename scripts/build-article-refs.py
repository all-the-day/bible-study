#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为「研读（听抄）」篇目生成「经文原文 + 注释」单文件 HTML。

用法：
    python scripts/build-article-refs.py [--out <路径>]

数据源（均为 scripts/export*.py 产物，不入库）：
    data/bible-text.json    经文原文（带 {N} 注脚标记 / [a] 串珠标记）
    data/bible-notes.json   注释（键 = 经文键，值为 {序号: 注释文本}）
    data/bible-xrefs.json   串珠（键 = 经文键，值为 {字母: 引用串}）
    data/books.json         书卷表（书名/缩写/序号）
    data/morning/{期}.json  研读（听抄）正文，用于附录对照

输出：单文件 HTML（内联样式与数据，无外部依赖），放 generated-images/。
"""
import argparse
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- 文章与经文清单
# 研读出处
ARTICLE = {
    "period": "2026-04",
    "number": 5,
    "title": "活石和羊",
    "scripture": "彼前二4～5，亚三9，亚四10，约十11～16，结三四11～31",
}

# 每组经文：书卷缩写、章、起止节、标题、要点提示、研读正文里的引用写法
PASSAGES = [
    {
        "acronym": "彼前", "chapter": 2, "from": 4, "to": 5,
        "title": "活石——基督是活石，信徒变化成为活石，同被建造成为属灵的殿",
        "hint": "「活石」的本体是基督这被人所弃绝、却为神所拣选所宝贵的石头；信徒由祂变化也成为活石。",
        "cite": ["彼前二4～5"],
    },
    {
        "acronym": "亚", "chapter": 3, "from": 9, "to": 9,
        "title": "约书亚面前的石头，有七眼",
        "hint": "基督是神所安置、亲自雕刻的石头，石头上的七眼即羔羊基督的七眼。",
        "cite": ["亚三9"],
    },
    {
        "acronym": "亚", "chapter": 4, "from": 10, "to": 10,
        "title": "七眼就是神的七灵、七倍加强的灵",
        "hint": "承接 3:9 的七眼：七眼表征神的七灵，就是七倍加强的灵。",
        "cite": ["亚四10", "四10"],
    },
    {
        "acronym": "约", "chapter": 10, "from": 11, "to": 16,
        "title": "好牧人——为羊舍命，羊也属祂",
        "hint": "羊的比喻：羊进圈、从圈出来、按名呼叫、羊听牧人的声音——牧人认出祂自己的羊。",
        "cite": ["约十11～16", "约十11、16"],
    },
    {
        "acronym": "结", "chapter": 34, "from": 11, "to": 31,
        "title": "主亲自作牧人，寻找、寻见、牧养祂的羊",
        "hint": "主亲自来作牧人：寻见羊、带回自己的地、带到溪水、带到佳美草场；缠裹受伤的、加强软弱的、施行公义的判断，只有一群羊。",
        "cite": ["结三四11～31", "结三四11", "结三四13", "结三四14", "结三四16上"],
    },
]

CN = "零一二三四五六七八九十"


def cn_num(n):
    """小数字转中文（用于 1-99 足够）。"""
    if n < 10:
        return CN[n]
    if n < 20:
        return "十" + (CN[n % 10] if n % 10 else "")
    if n < 100:
        return CN[n // 10] + "十" + (CN[n % 10] if n % 10 else "")
    return str(n)


def verse_ref(book_name, chapter, verse, half=""):
    return "%s %d:%d%s" % (book_name, chapter, verse, ("上" if half == "上" else "下") if half else "")


def load_json(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        sys.exit("缺少数据文件：%s（先跑 scripts/export.py 生成）" % rel)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- 标记解析
MARK_RE = re.compile(r"(\{\d+\}|\[[a-z]+\])")


def split_marks(marked):
    """把带 {N}/[a] 标记的经文切成 [(类型, 内容)]，类型：text/fn/xref。"""
    out = []
    for part in MARK_RE.split(marked or ""):
        if not part:
            continue
        if part.startswith("{"):
            out.append(("fn", part[1:-1]))
        elif part.startswith("["):
            out.append(("xref", part[1:-1]))
        else:
            out.append(("text", part))
    return out


def render_marked(marked, key, xrefs, cls_note="fn", cls_xref="xr"):
    """渲染经文文本：注脚 → 上标数字（可点开对应注释），串珠 → 上标字母。"""
    html_out = []
    for kind, val in split_marks(marked):
        if kind == "text":
            html_out.append(html.escape(val))
        elif kind == "fn":
            html_out.append(
                '<sup class="%s" data-note="%s" title="点击查看注释 %s">%s</sup>'
                % (cls_note, html.escape(key), html.escape(val), html.escape(val))
            )
        else:
            ref = (xrefs.get(key) or {}).get(val, "")
            tip = "串珠：%s" % ref if ref else "串珠"
            html_out.append(
                '<sup class="%s" title="%s">%s</sup>'
                % (cls_xref, html.escape(tip), html.escape(val))
            )
    return "".join(html_out)


def render_note_text(text):
    """注释正文一般无标记，仍按标记解析器渲染以防万一。"""
    return render_marked(text, "", {}, cls_note="fn-in", cls_xref="xr-in")


# ---------------------------------------------------------------- 组装页面
CSS = """
:root{
  --bg:#f7f6f2; --card:#fffdf9; --ink:#23201c; --ink-soft:#5b5349; --ink-faint:#8a8073;
  --line:#e3ded2; --line-soft:#efe9dd; --accent:#8a5a2b; --accent-soft:#f3e7d6;
  --fn:#7a4f16; --fn-bg:#f6efe2; --xr:#4a5f8a; --xr-bg:#eef1f7;
  --mark:#ffe58a;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#16151a; --card:#1e1d23; --ink:#e8e4dd; --ink-soft:#b3aca1; --ink-faint:#837c72;
    --line:#322f38; --line-soft:#26242c; --accent:#d7a86a; --accent-soft:#2a2318;
    --fn:#e0b475; --fn-bg:#2a2318; --xr:#9fb4dd; --xr-bg:#1c2230;
    --mark:#5a4a17;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth; scroll-padding-top:96px}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif;
  font-size:16px; line-height:1.75; -webkit-text-size-adjust:100%;
}
.wrap{max-width:860px; margin:0 auto; padding:0 20px 120px}
header.top{padding:44px 0 22px; border-bottom:1px solid var(--line)}
.eyebrow{font-size:13px; letter-spacing:.16em; color:var(--ink-faint); text-transform:uppercase}
h1{font-size:30px; line-height:1.3; margin:10px 0 8px; font-weight:700; letter-spacing:.02em}
.sub{color:var(--ink-soft); font-size:15px; margin:0}
.sub b{color:var(--accent); font-weight:600}
.tags{margin-top:16px; display:flex; flex-wrap:wrap; gap:8px}
.tag{font-size:13px; padding:3px 11px; border:1px solid var(--line); border-radius:999px;
     background:var(--card); color:var(--ink-soft); text-decoration:none}
.tag:hover{border-color:var(--accent); color:var(--accent)}
nav.toc{margin:26px 0 6px; padding:16px 18px; background:var(--card); border:1px solid var(--line); border-radius:12px}
nav.toc h2{margin:0 0 10px; font-size:13px; letter-spacing:.12em; color:var(--ink-faint); font-weight:600}
nav.toc ol{margin:0; padding-left:20px}
nav.toc li{margin:3px 0}
nav.toc a{color:var(--ink); text-decoration:none; border-bottom:1px solid transparent}
nav.toc a:hover{color:var(--accent); border-bottom-color:var(--accent)}
section.passage{margin:38px 0 0}
section.passage > h2{
  font-size:20px; margin:0 0 6px; font-weight:700; letter-spacing:.01em;
  display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;
}
section.passage > h2 .ref{
  font-size:13px; font-weight:600; color:var(--accent); background:var(--accent-soft);
  padding:2px 9px; border-radius:6px; letter-spacing:.02em;
}
section.passage > h2 .app{font-size:12px; font-weight:500; color:var(--ink-faint); margin-left:auto; text-decoration:none}
section.passage > h2 .app:hover{color:var(--accent)}
.hint{margin:0 0 16px; color:var(--ink-soft); font-size:14px; border-left:3px solid var(--accent-soft);
      padding:2px 0 2px 12px}
.verse{background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:12px 0}
.verse p{margin:0; font-size:18.5px; line-height:2.0; letter-spacing:.01em}
.vnum{color:var(--accent); font-size:13px; font-weight:700; margin-right:8px; vertical-align:.35em;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
sup.fn{
  font-size:11px; font-weight:700; color:var(--fn); background:var(--fn-bg);
  padding:0 4px; border-radius:4px; margin-left:2px; cursor:pointer; vertical-align:super; line-height:1.5;
}
sup.fn:hover{outline:1px solid var(--fn)}
sup.xr{font-size:11px; font-weight:700; color:var(--xr); background:var(--xr-bg); padding:0 4px;
       border-radius:4px; margin-left:2px; cursor:help; vertical-align:super; line-height:1.5}
.notes{margin:12px 0 0; padding:12px 0 0; border-top:1px dashed var(--line)}
.note{display:flex; gap:10px; margin:0 0 10px; align-items:flex-start}
.note:last-child{margin-bottom:0}
.note .n{
  flex:0 0 auto; font-size:11px; font-weight:700; color:var(--fn); background:var(--fn-bg);
  border-radius:5px; padding:1px 6px; margin-top:4px; line-height:1.6;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
}
.note .t{font-size:15px; line-height:1.85; color:var(--ink-soft)}
.note .t.none{color:var(--ink-faint); font-style:italic}
.xrefs{margin-top:10px; font-size:13px; color:var(--ink-faint)}
.xrefs b{color:var(--xr)}
.xrefs .xr-list{margin:4px 0 0; padding-left:18px}
.xrefs .xr-list li{margin:2px 0}
summary{cursor:pointer; list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ "; color:var(--ink-faint)}
details[open] > summary::before{content:"▾ "}
details.notes-wrap > summary{
  font-size:13px; color:var(--ink-faint); margin-top:10px; user-select:none;
}
details.notes-wrap > summary:hover{color:var(--accent)}
.bar{
  position:sticky; top:0; z-index:20; background:color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter:saturate(1.4) blur(8px); border-bottom:1px solid var(--line);
}
.bar .inner{max-width:860px; margin:0 auto; padding:10px 20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap}
.bar input[type=search]{
  flex:1 1 200px; min-width:160px; padding:7px 12px; font-size:14px; font-family:inherit;
  color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:8px; outline:none;
}
.bar input[type=search]:focus{border-color:var(--accent)}
.bar button{
  font-family:inherit; font-size:13px; color:var(--ink-soft); background:var(--card);
  border:1px solid var(--line); border-radius:8px; padding:7px 12px; cursor:pointer;
}
.bar button:hover{color:var(--accent); border-color:var(--accent)}
.bar .stat{font-size:12px; color:var(--ink-faint); margin-left:auto}
mark{background:var(--mark); color:inherit; border-radius:3px; padding:0 1px}
.appendix{margin-top:52px; border-top:1px solid var(--line); padding-top:22px}
.appendix h2{font-size:18px; margin:0 0 6px}
.appendix .meta{font-size:13px; color:var(--ink-faint); margin:0 0 14px}
.article p{margin:0 0 12px; text-indent:2em; color:var(--ink-soft)}
.article h4{margin:22px 0 8px; font-size:16px; color:var(--ink); font-weight:700}
.article h4 + p{text-indent:0}
.article a{color:var(--accent); text-decoration:none; border-bottom:1px solid var(--accent-soft)}
.article a:hover{border-bottom-color:var(--accent)}
footer{margin-top:46px; padding-top:18px; border-top:1px solid var(--line);
       font-size:12.5px; color:var(--ink-faint); line-height:1.9}
@media print{
  .bar, nav.toc{display:none}
  body{background:#fff}
  .verse{break-inside:avoid; border-color:#ccc}
}
@media (max-width:640px){
  h1{font-size:24px}
  .verse p{font-size:17px}
  .wrap{padding:0 14px 80px}
  .bar .inner{padding:8px 14px}
  .section.passage > h2 .app{margin-left:0; width:100%}
}
"""

JS = """
(function(){
  var bar = document.getElementById('bar');
  var input = document.getElementById('q');
  var stat = document.getElementById('stat');
  var details = Array.prototype.slice.call(document.querySelectorAll('details.notes-wrap'));

  function clearMarks(){
    var ms = document.querySelectorAll('mark');
    for (var i=0;i<ms.length;i++){
      var p = ms[i].parentNode;
      p.replaceChild(document.createTextNode(ms[i].textContent), ms[i]);
      p.normalize();
    }
  }
  function highlight(term){
    clearMarks();
    if (!term) { stat.textContent = ''; return; }
    var re = new RegExp(term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'g');
    var count = 0;
    var nodes = document.querySelectorAll('.note .t, .verse p, .article p');
    for (var i=0;i<nodes.length;i++){
      var walker = document.createTreeWalker(nodes[i], NodeFilter.SHOW_TEXT, null);
      var textNodes = [], n;
      while ((n = walker.nextNode())) { textNodes.push(n); }
      for (var j=0;j<textNodes.length;j++){
        var node = textNodes[j], s = node.nodeValue, m, last = null, out = '', idx = 0;
        re.lastIndex = 0;
        while ((m = re.exec(s)) !== null){
          if (m[0] === '') { re.lastIndex++; continue; }
          out += s.slice(idx, m.index);
          out += '<mark>' + m[0] + '</mark>';
          idx = m.index + m[0].length; count++;
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        if (idx === 0) continue;
        out += s.slice(idx);
        last = document.createElement('span');
        last.innerHTML = out;
        while (last.firstChild) node.parentNode.insertBefore(last.firstChild, node);
        node.parentNode.removeChild(node);
      }
    }
    stat.textContent = count ? ('命中 ' + count + ' 处') : '无命中';
  }
  var timer = null;
  input.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(function(){ highlight(input.value.trim()); }, 180);
  });
  document.getElementById('expand').addEventListener('click', function(){
    details.forEach(function(d){ d.open = true; });
  });
  document.getElementById('collapse').addEventListener('click', function(){
    details.forEach(function(d){ d.open = false; });
  });
  // 点注释上标 → 展开对应注释并高亮
  document.addEventListener('click', function(e){
    var sup = e.target.closest('sup.fn');
    if (!sup) return;
    var wrap = sup.closest('.verse').querySelector('details.notes-wrap');
    if (wrap) wrap.open = true;
    var target = document.querySelector('.note[data-n="' + sup.getAttribute('data-note') + '"]');
    if (target) {
      target.scrollIntoView({block:'center'});
      target.animate([{background:'var(--accent-soft)'},{background:'transparent'}], {duration:1400});
    }
  });
})();
"""


def build_article_html(article, book_names, cite_to_id):
    """研读正文：短句若被下一行复述（标题+详解两行）则是小标题；短句独立引领长段落也是小标题。"""
    lines = [l.strip() for l in article["content"].split("\n") if l.strip()]
    out = []
    i = 0
    while i < len(lines):
        cur = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        is_head = False
        if nxt:
            if len(cur) <= 55 and (nxt.startswith(cur) or cur.startswith(nxt) or cur[:6] == nxt[:6]):
                is_head = True            # 标题行，下一行是详解（措辞可能略变）
            elif len(cur) <= 18 and len(nxt) >= 60:
                is_head = True            # 独立小标题，下一行是正文
        out.append(("h" if is_head else "p", cur))
        i += 1

    html_out = []
    cites = []
    for kind, text in out:
        esc = html.escape(text)
        for c in cite_to_id:
            for form in (c, c.replace("～", "〜")):
                if form in text:
                    cites.append(form)
                    esc = esc.replace(html.escape(form), '<a href="#%s">%s</a>' % (cite_to_id[c], html.escape(form)))
        if kind == "h":
            html_out.append("<h4>%s</h4>" % esc)
        else:
            html_out.append("<p>%s</p>" % esc)
    return "\n".join(html_out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    text = load_json("data/bible-text.json")
    notes = load_json("data/bible-notes.json")
    xrefs = load_json("data/bible-xrefs.json")
    books = load_json("data/books.json")
    book_by_acr = {b["acronym"]: b for b in books}
    morning = load_json("data/morning/%s.json" % ARTICLE["period"])

    article = None
    for c in morning["chapters"]:
        if c["title"] == ARTICLE["title"]:
            article = c
    if not article:
        sys.exit("在 %s 里找不到篇目：%s" % (ARTICLE["period"], ARTICLE["title"]))

    cite_to_id = {}
    blocks = []
    for idx, p in enumerate(PASSAGES, 1):
        b = book_by_acr[p["acronym"]]
        bname = b["name"]
        sec_id = "p%d" % idx
        for c in p["cite"]:
            cite_to_id[c] = sec_id

        verses_html = []
        note_count = 0
        for v in range(p["from"], p["to"] + 1):
            key = "%s%d:%d" % (p["acronym"], p["chapter"], v)
            marked = text.get(key)
            if marked is None:  # 半节拆分的情况
                halves = [k for k in text if k.startswith(key + "上") or k.startswith(key + "下")]
                marked = "".join(text[k] for k in sorted(halves))
                if not marked:
                    continue
            body = render_marked(marked, key, xrefs)
            nmap = notes.get(key) or {}
            nkeys = sorted(nmap.keys(), key=lambda x: int(x))
            note_count += len(nkeys)
            xr = xrefs.get(key) or {}

            notes_html = []
            for n in nkeys:
                notes_html.append(
                    '<div class="note" data-n="%s"><span class="n">%s</span><span class="t">%s</span></div>'
                    % (html.escape(n), html.escape(n), render_note_text(nmap[n]))
                )

            xr_html = ""
            if xr:
                items = "".join(
                    "<li><b>%s</b> %s</li>" % (html.escape(k), html.escape(v2)) for k, v2 in sorted(xr.items())
                )
                xr_html = (
                    '<div class="xrefs">串珠：<details><summary>展开 %d 条</summary>'
                    '<ul class="xr-list">%s</ul></details></div>' % (len(xr), items)
                )

            if notes_html:
                inner = (
                    '<details class="notes-wrap" open><summary>注释 %d 条（点击上标数字可定位）</summary>'
                    '<div class="notes">%s</div></details>' % (len(nkeys), "".join(notes_html))
                )
            else:
                inner = '<div class="notes"><div class="note"><span class="t none">（本节无注释）</span></div></div>'

            verses_html.append(
                '<div class="verse"><p><span class="vnum">%d</span>%s</p>%s%s</div>'
                % (v, body, inner, xr_html)
            )

        ref_label = "%s %d:%d" % (bname, p["chapter"], p["from"])
        if p["to"] != p["from"]:
            ref_label += "-%d" % p["to"]
        app_url = "https://study.duoban.xyz/#/bible/%d/%d" % (b["index"], p["chapter"])

        blocks.append(
            """<section class="passage" id="%s">
<h2><span class="ref">%s</span><span>%s</span><a class="app" href="%s" target="_blank" rel="noopener">在 App 中打开 ↗</a></h2>
<p class="hint">%s</p>
%s
</section>""" % (sec_id, html.escape(ref_label), html.escape(p["title"]), app_url, html.escape(p["hint"]), "\n".join(verses_html))
        )

    toc = "\n".join(
        '<li><a href="#p%d">%s — %s</a></li>' % (i, html.escape(
            "%s %d:%d%s" % (book_by_acr[p["acronym"]]["name"], p["chapter"], p["from"],
                            ("-%d" % p["to"]) if p["to"] != p["from"] else "")),
            html.escape(p["title"]))
        for i, p in enumerate(PASSAGES, 1)
    )

    article_html = build_article_html(article, book_by_acr, cite_to_id)

    total_notes = sum(
        len(notes.get("%s%d:%d" % (p["acronym"], p["chapter"], v)) or {})
        for p in PASSAGES for v in range(p["from"], p["to"] + 1)
    )
    total_verses = sum(p["to"] - p["from"] + 1 for p in PASSAGES)

    tags = "\n".join(
        '<a class="tag" href="#p%d">%s %d:%d%s</a>' % (
            i, html.escape(book_by_acr[p["acronym"]]["name"]), p["chapter"], p["from"],
            ("-%d" % p["to"]) if p["to"] != p["from"] else "")
        for i, p in enumerate(PASSAGES, 1)
    )

    page = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>活石和羊 · 经文与注释</title>
<meta name="description" content="研读「活石和羊」关联经文的原文与注释（听抄 2026-04 第 5 篇）">
<style>%s</style>
</head>
<body>
<div class="bar" id="bar">
  <div class="inner">
    <input type="search" id="q" placeholder="在经文与注释中查找关键词…" autocomplete="off">
    <button type="button" id="expand">展开全部注释</button>
    <button type="button" id="collapse">折叠全部</button>
    <span class="stat" id="stat"></span>
  </div>
</div>
<div class="wrap">
<header class="top">
  <div class="eyebrow">研读 · 经文与注释</div>
  <h1>活石和羊</h1>
  <p class="sub">关联经文 <b>%s</b> ｜ 共 <b>%d</b> 节经文、<b>%d</b> 条注释 ｜ 出自听抄 %s 第 %d 篇</p>
  <div class="tags">%s</div>
</header>
<nav class="toc">
  <h2>目录</h2>
  <ol>%s</ol>
</nav>
%s
<section class="appendix">
  <h2>附录：研读原文（听抄 %s 第 %d 篇）</h2>
  <p class="meta">点击正文里的经文标记可跳回上方对应经文；正文为听抄内容摘录，仅供对照阅读。</p>
  <div class="article">%s</div>
</section>
<footer>
  数据来源：data/bible-text.json、data/bible-notes.json、data/bible-xrefs.json、data/books.json、data/morning/%s.json（均为本仓库 scripts/export*.py 产物）<br>
  生成脚本：scripts/build-article-refs.py ｜ 生成时间：%s
</footer>
</div>
<script>%s</script>
</body>
</html>
""" % (
        CSS,
        html.escape(ARTICLE["scripture"]),
        total_verses, total_notes,
        html.escape(ARTICLE["period"]), ARTICLE["number"],
        tags, toc,
        "\n".join(blocks),
        html.escape(ARTICLE["period"]), ARTICLE["number"], article_html,
        html.escape(ARTICLE["period"]),
        __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        JS,
    )

    out = args.out or os.path.join(ROOT, "generated-images", "huoshi-yang-verse-notes.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print("已生成：%s" % out)
    print("经文 %d 节 / 注释 %d 条" % (total_verses, total_notes))


if __name__ == "__main__":
    main()
