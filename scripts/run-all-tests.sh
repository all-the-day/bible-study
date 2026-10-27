#!/usr/bin/env bash
# 全量测试运行器（并发版，2026-10-27）：确保 8765 服务器 → 4 泳道并发 → 按输出解析判定。
# 判定不依赖退出码（测试断言失败只打 ✗/FAIL，异常才非零退出）：
#   失败 = 非零退出 或 输出含 ✗ / "FAIL " / "JS 错误: ["
#
# 泳道分配（静态；2026-10-27 实测时长做 LPT 装箱，墙钟 665s → ~230s）：
#   LANE_DATA books-data-test —— 纯 node 磁盘扫描（230s 最大单项），不起浏览器不占端口，独立泳道。
#   LANE_B/C/D 浏览器测试三等分（各 ~145s）。同泳道 = 串行，故**共用专属端口的测试必须同泳道**：
#     8766 → drawer/ref-link/update-logic 同在 LANE_B；8768 → copy-citation/lr-module 同在 LANE_C；
#     8765 是 runner 起的共享服务器，测试自 spawn 绑定失败后静默复用、退出 kill 已死进程，并发安全。
#   新增测试时：挑当时最短的浏览器泳道追加；若与现有测试共用端口，必须放进那一条泳道。
#
# 失败早停（默认开，FASTFAIL=0 关闭）：任一测试失败即置旗标，各泳道跑完手头测试后不再领新任务，
#   汇总会列出未运行的数量；需要看全貌时用 FASTFAIL=0 重跑。
# 用途：pre-push hook、手动全量回归。跳过单个测试：SKIP="home-test" ./run-all-tests.sh
cd "$(dirname "$0")/.." || exit 1

SERVER_PID=""
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:8765/; then
  echo "[run-all-tests] 启动临时服务器 :8765"
  python -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://127.0.0.1:8765/ && break
    sleep 0.5
  done
fi

cd scripts || exit 1

LANE_DATA="books-data-test"
LANE_B="drawer-test ref-link-test update-logic-test morning-reader-test reread-test typography-test bookhub-test home-test-mobile sync2-test lr-heading-test annotation-test"
LANE_C="search-test topic-test ezoe-reader-test person-link-test copy-citation-test lr-module-annotation-test slat-reader-test e2e-test lr-annotation-test help-test"
LANE_D="audio-test home-test book-reader-test notes-module-test lr-reader-test router-test swipe-test theme-test"

FASTFAIL="${FASTFAIL:-1}"
ABORT_FLAG="/tmp/bs-abort-$$.flag"
RES_PREFIX="/tmp/bs-lane-$$"
rm -f "$ABORT_FLAG"
LANE_PIDS=()

run_lane() {   # $1=结果文件，$2..=测试名；跑在后台子 shell 里，结果只经结果文件带回
  local res="$1"; shift
  local t log
  for t in "$@"; do
    if [[ " ${SKIP:-} " == *" $t "* ]]; then
      echo "— $t (跳过)"
      echo "SKIP $t" >>"$res"
      continue
    fi
    if [[ "$FASTFAIL" == "1" && -f "$ABORT_FLAG" ]]; then
      echo "— $t (因失败中止)"
      echo "ABORT $t" >>"$res"
      continue
    fi
    log="/tmp/bs-test-$t-$$.log"
    node "$t.js" >"$log" 2>&1
    if [ $? -ne 0 ] || grep -qE "✗|FAIL |JS 错误: \[" "$log"; then
      echo "✗ $t"
      echo "FAIL $t" >>"$res"
      tail -10 "$log"
      [[ "$FASTFAIL" == "1" ]] && touch "$ABORT_FLAG"
    else
      echo "✓ $t"
      echo "PASS $t" >>"$res"
    fi
  done
}

start_lane() {   # $1=泳道名（结果文件后缀），$2=测试列表字符串
  local name="$1" list="$2"
  local res="$RES_PREFIX-$name.res"
  : >"$res"
  run_lane "$res" $list &
  LANE_PIDS+=($!)
}

start_lane data "$LANE_DATA"
start_lane b "$LANE_B"
start_lane c "$LANE_C"
start_lane d "$LANE_D"

cleanup() {
  kill "${LANE_PIDS[@]}" 2>/dev/null
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$ABORT_FLAG" "$RES_PREFIX"-*.res
}
# INT/TERM 也挂 trap：Ctrl-C 或外部 kill 时 EXIT trap 在 Git Bash 上不保证触发，
# 泄漏的 8765 服务器会让下一轮测试静默跑在旧进程上（AGENTS「遗留服务器」脚枪）
trap cleanup EXIT INT TERM

for pid in "${LANE_PIDS[@]}"; do wait "$pid"; done

FAIL=0
FAILED=""
SKIPPED=0
ABORTED=0
for res in "$RES_PREFIX"-*.res; do
  while read -r status t; do
    case "$status" in
      FAIL)  FAIL=1; FAILED="$FAILED $t" ;;
      SKIP)  SKIPPED=$((SKIPPED+1)) ;;
      ABORT) ABORTED=$((ABORTED+1)) ;;
    esac
  done <"$res"
done

echo
if [ $FAIL -eq 0 ]; then
  echo "全部通过 ✓"
  [ $SKIPPED -gt 0 ] && echo "（跳过 $SKIPPED 个）"
else
  echo "存在失败 ✗：$FAILED"
  [ $ABORTED -gt 0 ] && echo "因失败早停，$ABORTED 个测试未运行（FASTFAIL=0 可跑完全量）"
fi
exit $FAIL
