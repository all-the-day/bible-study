#!/usr/bin/env bash
# 安装 git hooks 到 .git/hooks/（本地 git 配置，不入库）。
# 用法：bash scripts/install-hooks.sh
cd "$(dirname "$0")/.." || exit 1
for f in pre-commit pre-push; do
  cp "scripts/git-hooks/$f" ".git/hooks/$f"
  chmod +x ".git/hooks/$f"
  echo "已安装 .git/hooks/$f"
done
