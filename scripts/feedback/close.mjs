// scripts/feedback/close.js — 标记反馈为已处理
// 用法: npm run feedback:close <id>
import { loadEnv, adminToken, API_BASE } from './lib.mjs';

async function main() {
  const id = process.argv[2];
  if (!id || !/^\d+$/.test(id)) {
    console.error('用法: npm run feedback:close <id>');
    process.exit(1);
  }
  loadEnv();
  const res = await fetch(`${API_BASE}/api/feedback/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ status: 'resolved' }),
  });
  if (!res.ok) throw new Error(`更新失败 ${res.status}: ${await res.text()}`);
  console.log(`反馈 #${id} 已标记为 resolved`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
