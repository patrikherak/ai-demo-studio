#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Cut a short, palette-optimised GIF from a video (for READMEs, docs, social posts).

  bash scripts/to-gif.sh <in.mp4> <out.gif> [start=0] [duration=6] [width=720] [fps=12]
TXT
}
[[ $# -lt 2 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; [[ $# -ge 1 ]] && exit 0 || exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.tools/env.sh" ] && . "$ROOT/.tools/env.sh"
FF="${FFMPEG:-ffmpeg}"
IN="$1"; OUT="$2"; SS="${3:-0}"; T="${4:-6}"; W="${5:-720}"; FPS="${6:-12}"
PALETTE="$(mktemp -t palette.XXXXXX).png"
trap 'rm -f "$PALETTE"' EXIT
"$FF" -hide_banner -loglevel error -y -ss "$SS" -t "$T" -i "$IN" -vf "fps=$FPS,scale=$W:-2:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" "$PALETTE"
"$FF" -hide_banner -loglevel error -y -ss "$SS" -t "$T" -i "$IN" -i "$PALETTE" -lavfi "fps=$FPS,scale=$W:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" "$OUT"
echo "GIF $OUT ($(du -h "$OUT" | cut -f1))"
