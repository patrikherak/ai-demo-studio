#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Extract frames for visual QA and build one contact sheet.

  bash scripts/qa-frames.sh <video.mp4> <out-dir> [count=12] [--at 2,5.5,9]

Writes <out-dir>/frame-XX.jpg (evenly spaced, or at the given seconds) and
<out-dir>/sheet.jpg (4 columns, timestamps burned in). Open the sheet and check
every frame before you call a clip done.
TXT
}
[[ $# -lt 2 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; [[ $# -ge 1 ]] && exit 0 || exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.tools/env.sh" ] && . "$ROOT/.tools/env.sh"
FF="${FFMPEG:-ffmpeg}"
VIDEO="$1"; OUT="$2"; shift 2
COUNT=12; AT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="$2"; shift 2;;
    *) COUNT="$1"; shift;;
  esac
done
mkdir -p "$OUT"
rm -f "$OUT"/frame-*.jpg "$OUT/sheet.jpg"

DURATION="$(node -e 'import("'"$ROOT"'/scripts/lib/media.mjs").then(m => console.log(m.mediaDuration(process.argv[1]) ?? 0))' "$VIDEO")"
if [ -n "$AT" ]; then
  IFS=',' read -r -a TIMES <<< "$AT"
else
  TIMES=()
  for i in $(seq 0 $((COUNT - 1))); do
    TIMES+=("$(python3 -c "print(round(($i + 0.5) * $DURATION / $COUNT, 3))")")
  done
fi

n=0
for t in "${TIMES[@]}"; do
  n=$((n + 1))
  label="$(python3 -c "t=float('$t'); print(f'{int(t//60):02d}\\\\:{t%60:05.2f}')")"
  "$FF" -hide_banner -loglevel error -y -ss "$t" -i "$VIDEO" -frames:v 1 \
    -vf "scale=640:-2,drawtext=text='${label}':x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6" \
    "$OUT/$(printf 'frame-%02d.jpg' "$n")" 2>/dev/null \
  || "$FF" -hide_banner -loglevel error -y -ss "$t" -i "$VIDEO" -frames:v 1 -vf "scale=640:-2" "$OUT/$(printf 'frame-%02d.jpg' "$n")"
done

cols=4
rows=$(( (n + cols - 1) / cols ))
"$FF" -hide_banner -loglevel error -y -pattern_type glob -i "$OUT/frame-*.jpg" \
  -vf "scale=640:-2,tile=${cols}x${rows}:padding=6:margin=6:color=white" -frames:v 1 "$OUT/sheet.jpg"
echo "frames=$n duration=${DURATION}s sheet=$OUT/sheet.jpg"
