#!/usr/bin/env bash
# Quick joint progress monitor: GPU temp/util on Razer + enrichment script progress.
# Usage: bash scripts/monitor-enrichment.sh

GPU=$(ssh -o ConnectTimeout=3 -o BatchMode=yes aloysjehwin@100.82.208.8 \
  'nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits' 2>/dev/null)

if [ -z "$GPU" ]; then
  echo "GPU: unreachable"
else
  IFS=',' read -r TEMP UTIL VRAM POWER <<< "$GPU"
  TEMP=$(echo "$TEMP" | xargs)
  UTIL=$(echo "$UTIL" | xargs)
  VRAM=$(echo "$VRAM" | xargs)
  POWER=$(echo "$POWER" | xargs)
  echo "GPU:        ${TEMP}°C   ${UTIL}% util   ${VRAM} MiB VRAM   ${POWER} W"
fi

if [ -f /tmp/enrich-full.log ]; then
  TOTAL=$(grep -E "candidates: " /tmp/enrich-full.log | awk '{print $2}' | head -1)
  DONE=$(grep -cE "^  \+ " /tmp/enrich-full.log)
  ERR=$(grep -cE "^  ! " /tmp/enrich-full.log)
  LAST=$(grep -E "^  \+ " /tmp/enrich-full.log | tail -1 | sed 's/^  + //')
  if grep -q "^done:" /tmp/enrich-full.log; then
    echo "Enrich:     COMPLETED   ${DONE}/${TOTAL}   errors=${ERR}"
    grep "^done:" /tmp/enrich-full.log
  else
    if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
      PCT=$((DONE * 100 / TOTAL))
      echo "Enrich:     ${DONE}/${TOTAL} (${PCT}%)   errors=${ERR}   last: ${LAST}"
    else
      echo "Enrich:     starting up..."
    fi
  fi
else
  echo "Enrich:     no log at /tmp/enrich-full.log"
fi
