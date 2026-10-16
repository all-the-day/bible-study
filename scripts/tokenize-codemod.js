/* UI 主题化 codemod（一次性）：style.css 散值 → token
   - 先做 font-size 全局正则（纯 px 值 → var(--fs-N)，calc/em 不受影响）
   - 再按行号自底向上做逐行替换（每行先断言旧片段存在，不匹配即中止报错）
   - 行内替换不改变行数；唯一插入（verse-sep 规则、topbar icon-btn hover）用 \n 写在同一替换里，自底向上保证行号稳定 */
const fs = require('fs');
const FILE = require('path').resolve(__dirname, '..', 'style.css');
let src = fs.readFileSync(FILE, 'utf8');
let lines = src.split(/\r?\n/);

// ── Pass 1: font-size 纯 px → token（不进 calc、不动 em）──
let fsCount = 0;
src = src.replace(/font-size:\s*(10|11|12|13|14|15|16|17|18|20|30|40)px\b/g, (m, n) => { fsCount++; return `font-size: var(--fs-${n})`; });
lines = src.split(/\r?\n/);

// ── Pass 2: 逐行精确替换（自底向上）──
// [行号(1基), 旧片段, 新片段]；同一行多条按顺序执行
const E = [
  [1436, 'background: #fff; color: var(--brand-dark);', 'background: var(--pill-active-bg); color: var(--pill-active-fg);'],
  [1433, 'color: rgba(255,255,255,.85);', 'color: var(--pill-fg);'],
  [1429, 'background: rgba(255,255,255,.16);', 'background: var(--pill-bg);'],
  [1385, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1352, 'background: #d8dce8', 'background: var(--grab-bg)'],
  [1331, 'color: #c3c8d0', 'color: var(--text-faint)'],
  [1316, 'border: 2px solid #fff;', 'border: 2px solid var(--ring);'],
  [1295, 'rgba(102,126,234,.06)', 'rgba(var(--brand-rgb), .06)'],
  [1280, 'color: #fff;', 'color: var(--on-brand);'],
  [1277, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1274, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1268, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [1266, 'color: #fff;', 'color: var(--on-brand);'],
  [1262, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1253, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1247, 'rgba(102,126,234,.1)', 'rgba(var(--brand-rgb), .1)'],
  [1244, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [1185, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [1182, 'color: #fff;', 'color: var(--on-brand);'],
  [1180, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1140, 'color: #fff;', 'color: var(--on-brand);'],
  [1070, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [1031, 'color: #16a34a;', 'color: var(--success);'],
  [1009, 'background: #e5484d; border-color: #e5484d;', 'background: var(--danger); border-color: var(--danger);'],
  [1008, 'color: #fff;', 'color: var(--on-brand);'],
  [991, 'color: #fff;', 'color: var(--on-brand);'],
  [955, 'rgba(102,126,234,.1)', 'rgba(var(--brand-rgb), .1)'],
  [951, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [947, 'color: #d9534f; background: rgba(217,83,79,.08);', 'color: var(--danger); background: var(--danger-soft);'],
  [945, 'border-radius: 12px;', 'border-radius: var(--radius-lg);'],
  [931, 'rgba(102,126,234,.12)', 'rgba(var(--brand-rgb), .12)'],
  [924, 'rgba(102,126,234,.1)', 'rgba(var(--brand-rgb), .1)'],
  [921, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [909, 'color: #fff;', 'color: var(--on-brand);'],
  [907, 'rgba(102,126,234,.35)', 'rgba(var(--brand-rgb), .35)'],
  [906, 'color: #fff;', 'color: var(--on-brand);'],
  [902, 'border-radius: 6px;', 'border-radius: var(--radius-sm);'],
  [895, 'border-radius: 8px', 'border-radius: var(--radius-md)'],
  [875, 'background: #fff;', 'background: var(--surface);'],
  [871, 'border-radius: 8px', 'border-radius: var(--radius-md)'],
  [853, 'z-index: 81;', 'z-index: var(--z-dock);'],
  [846, 'z-index: 80;', 'z-index: var(--z-backdrop);'],
  [816, 'box-shadow: 0 16px 48px rgba(0,0,0,.25);', 'box-shadow: var(--shadow-overlay);'],
  [815, 'background: #fff; border-radius: 12px;', 'background: var(--surface); border-radius: var(--radius-lg);'],
  [812, 'z-index: 85;', 'z-index: var(--z-popup);'],
  [807, 'z-index: 84;', 'z-index: var(--z-overlay);'],
  [779, 'z-index: 90;', 'z-index: var(--z-update);'],
  [776, 'rgba(102,126,234,.14)', 'rgba(var(--brand-rgb), .14)'],
  [767, 'border: 2px solid #fff;', 'border: 2px solid var(--ring);'],
  [763, 'border: 2px solid #fff;', 'border: 2px solid var(--ring);'],
  [759, 'background: #dfe3ee;', 'background: var(--slider-track);'],
  [736, 'z-index: 88;', 'z-index: var(--z-typo);'],
  [716, 'background: #fff; border-radius: 12px;', 'background: var(--surface); border-radius: var(--radius-lg);'],
  [710, 'z-index: 80;', 'z-index: var(--z-backdrop);'],
  [701, 'border-color: #333;', 'border-color: var(--swatch-border);'],
  [691, 'color: #d33; border-color: #d33;', 'color: var(--danger); border-color: var(--danger);'],
  [665, 'box-shadow: 0 8px 24px rgba(0,0,0,.18);', 'box-shadow: var(--shadow-overlay);'],
  [664, 'background: #fff;', 'background: var(--surface);'],
  [647, 'border-color: #333;', 'border-color: var(--swatch-border);'],
  [638, 'box-shadow: 0 8px 24px rgba(0,0,0,.18);', 'box-shadow: var(--shadow-overlay);'],
  [637, 'background: #fff;', 'background: var(--surface);'],
  [636, 'z-index: 82;', 'z-index: var(--z-floattool);'],
  [630, 'rgba(102,126,234,.28)', 'rgba(var(--brand-rgb), .28)'],
  [590, 'border-radius: 999px', 'border-radius: var(--radius-pill)'],
  [566, 'rgba(102,126,234,.1)', 'rgba(var(--brand-rgb), .1)'],
  [459, 'rgba(102,126,234,.25)', 'rgba(var(--brand-rgb), .25)'],
  [409, 'wavy #eb6c05', 'wavy var(--note-wavy)'],
  [406, 'wavy #eb6c05', 'wavy var(--note-wavy)'],
  [391, 'color: var(--brand); font-weight: 700;', 'color: var(--vnum-color); font-weight: 700;'],
  [383, 'box-shadow: 0 1px 5px rgba(102, 126, 234, .20);', 'box-shadow: var(--card-shadow);'],
  [379, 'border: 1px solid var(--border);', 'border: var(--card-border);'],
  [378, 'background: var(--surface);', 'background: var(--card-bg);'],
  [385, '.scripture-card .verse { margin-bottom: 8px; }', '.scripture-card .verse { margin-bottom: 8px; }\n.scripture-card .verse + .verse { border-top: var(--verse-sep); padding-top: var(--verse-sep-gap); }'],
  [360, 'color: var(--brand);', 'color: var(--ol2-color);'],
  [357, 'font-size: calc(17px * var(--reading-scale));', 'font-size: var(--ol1-fs);'],
  [346, 'background: rgba(255,255,255,.18);', 'background: var(--topbar-btn);'],
  [341, 'border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff;', 'border: 1px solid var(--topbar-line-strong); background: transparent; color: var(--topbar-fg);'],
  [327, 'color: #fff;', 'color: var(--on-brand);'],
  [326, 'background: #f0f4ff;', 'background: var(--hover);'],
  [310, 'color: #fff;', 'color: var(--on-brand);'],
  [308, 'background: #f0f4ff;', 'background: var(--hover);'],
  [216, 'z-index: 90;', 'z-index: var(--z-toast);'],
  [175, 'background: #fff;', 'background: var(--ring);'],
  [171, 'border-radius: 12px; background: #cbd5e1;', 'border-radius: var(--radius-lg); background: var(--switch-track);'],
  [165, 'background: #dcfce7; color: #166534;', 'background: var(--success-soft); color: var(--success-deep);'],
  [131, 'border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff;', 'border: 1px solid var(--topbar-line); background: transparent; color: var(--topbar-fg);'],
  [122, '.icon-btn:hover { background: rgba(255,255,255,.15); }', '.icon-btn:hover { background: rgba(255,255,255,.15); }\n.topbar .icon-btn:hover { background: var(--topbar-btn); }'],
  [118, 'color: #fff;', 'color: var(--topbar-fg);'],
  [112, 'background: #fff; opacity: .9; z-index: 35;', 'background: var(--topbar-fg); opacity: .9; z-index: var(--z-progress);'],
  [106, 'box-shadow: var(--shadow-md);', 'box-shadow: var(--topbar-shadow); border-bottom: var(--topbar-border);'],
  [105, 'color: #fff;', 'color: var(--topbar-fg);'],
  [104, 'background: linear-gradient(135deg, #667EEA, #5B67D4);', 'background: var(--topbar-bg);'],
  [101, 'z-index: 30;', 'z-index: var(--z-topbar);'],
  [47, 'z-index: 100;', 'z-index: var(--z-splash);'],
];

const errors = [];
for (const [ln, oldS, newS] of E) {
  const i = ln - 1;
  if (i < 0 || i >= lines.length) { errors.push(`L${ln}: 越界`); continue; }
  if (!lines[i].includes(oldS)) { errors.push(`L${ln}: 未找到 [${oldS}]，实际：${lines[i].trim().slice(0, 90)}`); continue; }
  lines[i] = lines[i].replace(oldS, newS);
}
if (errors.length) { console.error('✗ codemod 中止，' + errors.length + ' 处不匹配：\n' + errors.join('\n')); process.exit(1); }
fs.writeFileSync(FILE, lines.join('\n'));
console.log(`✓ codemod 完成：font-size ${fsCount} 处 → var(--fs-N)，逐行替换 ${E.length} 处`);
