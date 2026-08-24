// scripts/feedback/lib.js — 共享：加载 .env.local + 管理员请求助手
// 管理员令牌：项目根 .env.local 的 BIBLE_ADMIN_TOKEN（不入库，.gitignore 已忽略）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const API_BASE = process.env.BIBLE_API_BASE ?? 'https://duoban.xyz/bible-api';

/** 从项目根 .env.local 加载凭据（不存在则忽略，允许纯环境变量方式） */
export function loadEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/\r$/, ''); // 兼容 CRLF 行尾（Windows）
      const m = trimmed.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch {
    // .env.local 不存在 — 由环境变量提供
  }
}

export function adminToken() {
  const token = process.env.BIBLE_ADMIN_TOKEN;
  if (!token) {
    throw new Error('缺少凭据：请在 .env.local 配置 BIBLE_ADMIN_TOKEN（与服务器 FEEDBACK_ADMIN_TOKEN 一致）');
  }
  return token;
}

/** 管理员 GET /api/feedback[?status=open]，返回条目数组 */
export async function fetchFeedback(onlyOpen = true) {
  const url = `${API_BASE}/api/feedback${onlyOpen ? '?status=open' : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${adminToken()}` } });
  if (!res.ok) throw new Error(`获取反馈失败 ${res.status}: ${await res.text()}`);
  const { feedback } = await res.json();
  return feedback;
}
