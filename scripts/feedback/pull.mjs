// scripts/feedback/pull.js — 拉取线上反馈，生成收件箱 markdown
// 用法: npm run feedback:pull [--all]   （--all 包含已处理）
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_BASE, loadEnv, fetchFeedback } from './lib.mjs';

const OUT = resolve(process.cwd(), 'scripts/feedback/inbox.md');
const TYPE_LABEL = { bug: 'BUG', suggestion: '建议', other: '其他' };

async function main() {
  loadEnv();
  const onlyOpen = !process.argv.includes('--all');
  const feedback = await fetchFeedback(false); // 先拉全部，本地区分待处理/已处理

  const list = onlyOpen ? feedback.filter((f) => f.status === 'open') : feedback;
  const lines = [];
  lines.push('<!-- 这是本地快照！任何“检查反馈”动作必须先运行 `npm run feedback:pull` 刷新，禁止直接读取本文件作为反馈依据 -->');
  lines.push('# 反馈收件箱');
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')} · 来源：${API_BASE}`);
  lines.push(`> 当前 ${list.length} 条（${onlyOpen ? 'open，全部 ' + feedback.length : '含已处理'} 条）`);
  lines.push('');
  lines.push('## 待处理');
  lines.push('');
  for (const f of feedback) {
    if (onlyOpen && f.status !== 'open') continue;
    lines.push(...formatItem(f));
  }
  if (onlyOpen) {
    const done = feedback.filter((f) => f.status !== 'open');
    lines.push('## 已处理');
    lines.push('');
    for (const f of done) lines.push(...formatItem(f));
  }
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`已写入 ${OUT}（${onlyOpen ? '待处理 ' + list.length : '全部 ' + feedback.length} 条）`);
}

function formatItem(f) {
  const tag = TYPE_LABEL[f.type] ?? '其他';
  return [
    `### #${f.id} [${tag}] — ${new Date(f.createdAt).toLocaleString('zh-CN')}（${f.status}）`,
    '',
    f.content,
    '',
    `> 处理：\`npm run feedback:close ${f.id}\``,
    '',
  ];
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
