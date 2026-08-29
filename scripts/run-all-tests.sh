#!/usr/bin/env bash
# 全量测试运行器：确保 8765 服务器 → 顺序跑全部测试 → 按输出解析判定结果。
# 判定不依赖退出码（测试断言失败只打 ✗/FAIL，异常才非零退出）：
#   失败 = 非零退出 或 输出含 ✗ / "FAIL " / "JS 错误: ["
# 用途：pre-push hook、手动全量回归。跳过单个测试：SKIP="home-test" ./run-all-tests.sh
cd "$(dirname "$0")/.." || exit 1

STARTED=0
if ! curl -s -o /dev/null --max-time 2 http://localhost:8765/; then
  echo "[run-all-tests] 启动临时服务器 :8765"
  python -m http.server 8765 >/dev/null 2>&1 &
  SERVER_PID=$!
  STARTED=1
  trap 'kill $SERVER_PID 2>/dev/null' EXIT
  for _ in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://localhost:8765/ && break
    sleep 0.5
  done
fi

cd scripts || exit 1
TESTS="e2e-test annotation-test lr-annotation-test lr-module-annotation-test \
ref-link-test notes-module-test home-test home-test-mobile lr-reader-test \
book-reader-test morning-reader-test lr-heading-test update-logic-test sync-merge-test"

FAIL=0
for t in $TESTS; do
  [[ " $SKIP " == *" $t "* ]] && { echo "— $t (跳过)"; continue; }
  log="/tmp/bs-test-$t.log"
  node "$t.js" >"$log" 2>&1
  if [ $? -ne 0 ] || grep -qE "✗|FAIL |JS 错误: \[" "$log"; then
    echo "✗ $t"
    tail -10 "$log"
    FAIL=1
  else
    echo "✓ $t"
  fi
done

echo
if [ $FAIL -eq 0 ]; then echo "全部通过 ✓"; else echo "存在失败 ✗"; fi
exit $FAIL
