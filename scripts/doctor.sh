#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat <<'TXT'
Check that this machine can run the whole pipeline.

  bash scripts/doctor.sh

Reports tools, versions and which .env keys are set (never their values).
Exit code 0 = ready, 1 = a required piece is missing.
TXT
}
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLDIR="${DEMO_TOOLS_DIR:-$ROOT/.tools}"
[[ "$TOOLDIR" = /* ]] || TOOLDIR="$ROOT/$TOOLDIR"
[ -f "$TOOLDIR/env.sh" ] && . "$TOOLDIR/env.sh"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

missing=0
row() { printf '  %-6s %-22s %s\n' "$1" "$2" "$3"; }
need() {
  local name="$1" cmd="$2" version="$3" out
  if command -v "$cmd" >/dev/null 2>&1 && out="$($version 2>&1)"; then row ok "$name" "$(echo "$out" | head -1)"; else row MISS "$name" "required (missing or does not run)"; missing=1; fi
}
want() {
  local name="$1" cmd="$2" version="$3" why="$4" out
  if command -v "$cmd" >/dev/null 2>&1 && out="$($version 2>&1)"; then row ok "$name" "$(echo "$out" | head -1)"; else row warn "$name" "$why"; fi
}

echo "tools"
need node node "node --version"
need npm npm "npm --version"
need git git "git --version"
need python3 python3 "python3 --version"
want docker docker "docker --version" "needed when the project runs its services in containers"
want "docker compose" docker "docker compose version" "needed for compose-based projects"
if [ -n "${FFMPEG:-}" ] && "$FFMPEG" -hide_banner -version >/dev/null 2>&1; then row ok ffmpeg "$FFMPEG"; else need ffmpeg ffmpeg "ffmpeg -hide_banner -version"; fi
if [ -n "${FFPROBE:-}" ] && "$FFPROBE" -version >/dev/null 2>&1; then row ok ffprobe "$FFPROBE"; else want ffprobe ffprobe "ffprobe -version" "optional; stream info falls back to ffmpeg"; fi
if [ -d "$TOOLDIR/node_modules/playwright" ]; then row ok playwright "$TOOLDIR/node_modules/playwright"; else row MISS playwright "run: bash scripts/setup-tools.sh"; missing=1; fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 18 ]; then row MISS "node >= 18" "found $node_major"; missing=1; fi

echo "env (.env)"
for key in ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID ELEVENLABS_MODEL_ID DEMO_WORKDIR PROJECT_PATH PROJECT_REPO_URL GIT_TOKEN DELIVERY_S3_BUCKET; do
  if [ -n "${!key:-}" ]; then row set "$key" ""; else row unset "$key" ""; fi
done
[ -n "${ELEVENLABS_API_KEY:-}" ] || echo "  note: without ELEVENLABS_API_KEY the pipeline can still record silent videos"

exit "$missing"
