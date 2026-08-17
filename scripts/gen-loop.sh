#!/usr/bin/env bash
# 反复跑 gen-parts.py 直到 15 件齐（或跑满 12 轮）。
# 为什么要循环：Gemini 侧的配额窗口是**断续放行**的——一轮里大半超时、
# 但总能捡回一两件。已落盘的自动跳过，所以重跑只补缺的，不烧已有配额。
# 轮间歇 10 分钟：比连着捶温和，也给窗口恢复的时间。
cd "$(dirname "$0")/.."
for i in $(seq 1 12); do
  n=$(ls public/chars/*/*.png 2>/dev/null | wc -l)
  # 代理会自己死（本项目已经栽过两次：死了之后循环空转，
  # 表现成"某某角色连续 N 轮 0 命中"，很容易误判成配额或提示词问题）。
  # 每轮开头探一次活，死了就地拉起来。
  if ! curl -s --max-time 4 http://localhost:3456/health | grep -q endpoints; then
    echo "!! 代理不通，重启"
    ( cd ~/.claude/skills/ai-image-gen/scripts && nohup node cdp-proxy.mjs >/dev/null 2>&1 & )
    sleep 5
  fi
  echo "=== 第 $i 轮开始，当前 $n 张 ==="
  [ "$n" -ge 23 ] && { echo "已齐，收工"; break; }
  python scripts/gen-parts.py 2>&1 | grep -E "^(OK|TIMEOUT|ERR|EMPTY|完成)"
  sleep 600
done
echo "=== 循环结束，最终 $(ls public/chars/*/*.png 2>/dev/null | wc -l) 张 ==="
