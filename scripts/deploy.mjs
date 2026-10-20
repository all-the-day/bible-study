#!/usr/bin/env node
/* ============================================================
 * deploy.mjs — 部署 Cloudflare Pages 前自动同步 staging
 *
 * 背景：staging 目录在仓库外（默认 D:/AIWorkSpace/.cf-bible-study，
 * 2026-10-20 新机迁移从 D:/coder/aiWorkSpace/.cf-bible-study 改来），
 * 不受 git 管理，过去靠手工把改动文件覆盖过去再 deploy——漏同步就会把
 * 旧文件部署上去（AGENTS.md 部署节为此写过警告）。本脚本按白名单同步
 * 运行时文件到 staging（逐文件 md5 校验，仅拷贝有差异的），并检测
 * staging 侧仓库外残留文件，最后调 wrangler 完成部署。
 *
 * 用法：
 *   node scripts/deploy.mjs             # 同步 + 部署（常规发版最后一步）
 *   node scripts/deploy.mjs --check     # 只看同步差异，不拷贝不部署（干跑）
 *   STAGING=... node scripts/deploy.mjs # 覆盖默认 staging 路径
 * ============================================================ */
import { cpSync, mkdirSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = resolve(process.env.STAGING || "D:/AIWorkSpace/.cf-bible-study");
const PROJECT = "bible-study";
const DRY = process.argv.includes("--check");

/* 部署白名单：与 AGENTS.md「部署（Cloudflare Pages）」节一致
   （= 运行时文件，排除 scripts/ node_modules .git .github/ config/ resources/ docs/） */
const FILES = ["index.html", "style.css", "app.js", "sync.js", "update.js", "sw.js", "manifest.json"];
const DIRS = ["icons", "data"];

const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");

/* 目录 → 相对路径文件清单（正斜杠） */
const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [p.slice(base.length + 1).replace(/\\/g, "/")];
  });

/* 列 staging 侧白名单内的现存文件（file 与 dir 两种形态都处理） */
const listStaging = () => [...FILES, ...DIRS].flatMap((name) => {
  const p = join(STAGING, name);
  if (!existsSync(p)) return [];
  return statSync(p).isDirectory() ? walk(p).map((r) => `${name}/${r}`) : [name];
});

async function main() {
  if (!existsSync(STAGING)) {
    console.error(`staging 目录不存在：${STAGING}\n（首次部署请先手工创建并放入 data/，或用 STAGING 环境变量指定路径）`);
    process.exit(1);
  }

  const changed = [];
  console.log(`同步 ${ROOT} → ${STAGING}`);

  for (const f of FILES) {
    const src = join(ROOT, f), dst = join(STAGING, f);
    if (!existsSync(src)) { console.error(`✗ 源文件缺失：${f}`); process.exit(1); }
    const same = existsSync(dst) && md5(src) === md5(dst);
    console.log(`  ${same ? "=" : "≠"} ${f}`);
    if (!same && !DRY) cpSync(src, dst);
    if (!same) changed.push(f);
  }

  for (const d of DIRS) {
    const src = join(ROOT, d);
    if (!existsSync(src)) { console.log(`  ! ${d}/ 仓库侧不存在，跳过`); continue; }
    let diff = 0;
    for (const rel of walk(src)) {
      const s = join(src, rel), t = join(STAGING, d, rel);
      if (existsSync(t) && md5(s) === md5(t)) continue;
      changed.push(`${d}/${rel}`);
      if (!DRY) { mkdirSync(dirname(t), { recursive: true }); cpSync(s, t); }
      diff++;
    }
    console.log(`  ${d}/ ${walk(src).length} 个文件，${diff} 个有差异${DRY ? "（干跑未拷贝）" : ""}`);
  }

  /* staging 侧残留检测：白名单里仓库已没有的文件（历史误放/已删文件 → 部署脏数据） */
  const repoSet = new Set([...FILES, ...DIRS.flatMap((d) => walk(join(ROOT, d)).map((r) => `${d}/${r}`))]);
  const extra = listStaging().filter((r) => !repoSet.has(r));
  if (extra.length) {
    console.log(`\n⚠ staging 有 ${extra.length} 个仓库外残留文件（不自动删，请人工确认）：`);
    extra.slice(0, 10).forEach((r) => console.log(`    + ${r}`));
    if (extra.length > 10) console.log(`    … 及其余 ${extra.length - 10} 个`);
  }

  if (DRY) { console.log(`\n[干跑] 共 ${changed.length} 个文件待同步，未拷贝未部署。`); return; }
  if (!changed.length) { console.log("\nstaging 与仓库一致，无可部署变更，跳过部署。"); return; }

  console.log(`\n已同步 ${changed.length} 个文件，部署到 Cloudflare Pages…`);
  const r = spawnSync("npx", ["wrangler", "pages", "deploy", STAGING, "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], { stdio: "inherit", shell: true });
  process.exit(r.status ?? 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
