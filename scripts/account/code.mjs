// scripts/account/code.mjs — 生成云同步授权码（管理员）
// 用法: npm run account:code               生成 1 个新账号码
//       npm run account:code -- --count 3  生成 3 个
//       npm run account:code -- --uid u1   生成 1 个绑定 u1 的码（已有账号）
import { loadEnv, adminToken, API_BASE } from '../feedback/lib.mjs';

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const countIdx = args.indexOf('--count');
  const count = countIdx >= 0 ? Math.min(parseInt(args[countIdx + 1], 10) || 1, 20) : 1;
  const uidIdx = args.indexOf('--uid');
  const uid = uidIdx >= 0 ? args[uidIdx + 1] : undefined;

  const body = { count };
  if (uid) body.uid = uid;
  const res = await fetch(`${API_BASE}/api/account/codes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`生成失败 ${res.status}: ${await res.text()}`);
  const { codes } = await res.json();
  console.log(`已生成 ${codes.length} 个授权码（${uid ? `绑定账号 ${uid}` : '新账号码'}，10 分钟内有效）：`);
  codes.forEach((c) => console.log(`  ${c}`));
  console.log('\n在 APP 中：同步状态点 → 启用同步 → 输入授权码');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
