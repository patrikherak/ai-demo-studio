#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Run the whole pipeline on the bundled sample app to prove this machine is ready.

  bash scripts/selftest.sh            # silent video: record, clip, join, check
  bash scripts/selftest.sh --voice    # also narrate (ElevenLabs, OpenAI or say; ~250 characters)
  bash scripts/selftest.sh --look     # branded film: cards, stage, SFX, music via produce.mjs

Output: work/selftest/final/selftest.mp4, frames in work/selftest/qa/.
TXT
}
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }
VOICE=0
LOOK=0
[[ "${1:-}" == "--voice" ]] && VOICE=1
[[ "${1:-}" == "--look" ]] && LOOK=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
[ -f .tools/env.sh ] || bash scripts/setup-tools.sh >/dev/null
. .tools/env.sh

JOB="$ROOT/work/selftest"
rm -rf "$JOB"
mkdir -p "$JOB"
cp -R examples/sample-job/. "$JOB/"

PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory examples/sample-app >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/index.html" && break; sleep 0.25; done

if [ "$LOOK" = 1 ]; then
  LOOKJOB="$ROOT/work/selftest-look"
  rm -rf "$LOOKJOB"
  mkdir -p "$LOOKJOB"
  cp -R examples/sample-job-look/. "$LOOKJOB/"
  node scripts/produce.mjs "$LOOKJOB" --record all
  echo "selftest ok: $LOOKJOB/final/selftest-look-demo.mp4 (look at $LOOKJOB/qa/final/sheet.jpg)"
  exit 0
fi

MAX_SILENCE=999
if [ "$VOICE" = 1 ]; then
  node scripts/narrate.mjs "$JOB/narration.json"
  node scripts/fit-scenes.mjs "$JOB/audio/manifest.json" "$JOB"/scenes/*.json
  MAX_SILENCE=3
fi

for scene in "$JOB"/scenes/*.json; do
  node scripts/record.mjs "$scene"
  node scripts/build-clip.mjs "$scene"
done

node scripts/concat.mjs "$JOB/final/selftest.mp4" "$JOB"/clips/*.mp4
bash scripts/qa-frames.sh "$JOB/final/selftest.mp4" "$JOB/qa/final" 8
python3 scripts/av_check.py "$JOB/final/selftest.mp4" --expect-audio --max-silence "$MAX_SILENCE"
echo "selftest ok: $JOB/final/selftest.mp4 (look at $JOB/qa/final/sheet.jpg)"
