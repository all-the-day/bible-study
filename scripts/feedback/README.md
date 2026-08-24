# 反馈闭环工作流

真实用户（bible-study 在线版/离线 APK）提交的反馈 → 本地拉取开发 → 部署后标记完成。

## 使用

```bash
npm run feedback:pull            # 拉取未处理反馈，写入 scripts/feedback/inbox.md
npm run feedback:pull -- --all   # 包含已处理
npm run feedback:close 12        # 标记 #12 为已处理
```

## 凭据

`BIBLE_ADMIN_TOKEN` 写在项目根 `.env.local`（不入库），与服务器端 `FEEDBACK_ADMIN_TOKEN` 一致。
可选 `BIBLE_API_BASE` 覆盖线上地址（默认 `https://duoban.xyz/bible-api`）。

## 闭环流程

```
用户提交反馈(open)
  → npm run feedback:pull → inbox.md     ← Agent 按清单开发/修复
  → 开发 → 部署
  → npm run feedback:close <id>          ← 用户端可见 resolved
```

依赖服务端：`/var/www/bible-reader/server.py` 的 `POST/GET/PATCH /api/feedback`（bible-kv，Caddy `/bible-api/` 反代）。部署与令牌注入见 server-ops README。
