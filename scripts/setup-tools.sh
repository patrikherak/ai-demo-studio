#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Install the recording toolchain without sudo, apt or brew and print the exports.

  bash scripts/setup-tools.sh            # installs into $DEMO_TOOLS_DIR (default ./.tools)
  source .tools/env.sh                   # or: eval "$(bash scripts/setup-tools.sh)"

Installs Playwright + Chromium into the tools dir and finds a runnable ffmpeg:
system ffmpeg, then imageio-ffmpeg in a private venv, then a static Linux build.
Writes the resolved paths to <tools>/env.sh.
TXT
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLDIR="${DEMO_TOOLS_DIR:-$ROOT/.tools}"
[[ "$TOOLDIR" = /* ]] || TOOLDIR="$ROOT/$TOOLDIR"
mkdir -p "$TOOLDIR"
log() { echo "setup: $*" >&2; }

INSTALL_LOG="$TOOLDIR/install.log"
if [ ! -d "$TOOLDIR/node_modules/playwright" ]; then
  log "installing playwright into $TOOLDIR"
  [ -f "$TOOLDIR/package.json" ] || printf '{ "name": "demo-tools", "private": true }\n' > "$TOOLDIR/package.json"
  ( cd "$TOOLDIR" && npm install --no-audit --no-fund playwright@latest ) >"$INSTALL_LOG" 2>&1 \
    || { log "ERROR npm install failed:"; tail -20 "$INSTALL_LOG" >&2; exit 1; }
fi
log "ensuring chromium"
( cd "$TOOLDIR" && ./node_modules/.bin/playwright install chromium ) >>"$INSTALL_LOG" 2>&1 \
  || { log "ERROR chromium install failed:"; tail -20 "$INSTALL_LOG" >&2; exit 1; }

LDPATH=""
if [ "$(uname -s)" = "Linux" ]; then
  SYSLIBS="$TOOLDIR/syslibs"
  LIBDIR="$SYSLIBS/usr/lib/$(uname -m)-linux-gnu"
  if ! ldconfig -p 2>/dev/null | grep -q 'libasound\.so\.2' && [ ! -e "$LIBDIR/libasound.so.2" ] && command -v apt-get >/dev/null 2>&1; then
    log "extracting libasound locally (nothing is installed system-wide)"
    mkdir -p "$SYSLIBS"
    ( cd "$SYSLIBS" && { apt-get download libasound2t64 >/dev/null 2>&1 || apt-get download libasound2 >/dev/null 2>&1 || true; } \
      && for deb in ./*.deb; do [ -f "$deb" ] && dpkg -x "$deb" "$SYSLIBS" && rm -f "$deb"; done ) || true
  fi
  [ -d "$LIBDIR" ] && LDPATH="$LIBDIR"
fi

FFMPEG=""
FFPROBE=""
if command -v ffmpeg >/dev/null 2>&1 && (ffmpeg -hide_banner -version) >/dev/null 2>&1; then
  FFMPEG="$(command -v ffmpeg)"
elif [ -x "$TOOLDIR/ffmpeg-static/ffmpeg" ]; then
  FFMPEG="$TOOLDIR/ffmpeg-static/ffmpeg"
else
  if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ]; then
    log "downloading a static ffmpeg build"
    mkdir -p "$TOOLDIR/ffmpeg-static"
    curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
      | tar -xJ --strip-components=1 -C "$TOOLDIR/ffmpeg-static" >/dev/null 2>&1 || true
    [ -x "$TOOLDIR/ffmpeg-static/ffmpeg" ] && FFMPEG="$TOOLDIR/ffmpeg-static/ffmpeg"
  fi
  if [ -z "$FFMPEG" ]; then
    log "installing imageio-ffmpeg into a private venv"
    VENV="$TOOLDIR/venv"
    if python3 -m venv "$VENV" >/dev/null 2>&1 && "$VENV/bin/pip" install --quiet --disable-pip-version-check imageio-ffmpeg >/dev/null 2>&1; then
      FFMPEG="$("$VENV/bin/python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
    fi
  fi
fi
[ -n "$FFMPEG" ] || { log "ERROR no runnable ffmpeg; install one (e.g. your OS package manager) and rerun"; exit 1; }

runs() { "$1" -hide_banner -version >/dev/null 2>&1; }
for candidate in "$(dirname "$FFMPEG")/ffprobe" "$(command -v ffprobe 2>/dev/null || true)" "$TOOLDIR/ffmpeg-static/ffprobe"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && runs "$candidate"; then FFPROBE="$candidate"; break; fi
done
[ -n "$FFPROBE" ] || log "WARN no runnable ffprobe; durations fall back to decoding with ffmpeg (fine, just slower)"

cat > "$TOOLDIR/env.sh" <<ENV
export DEMO_TOOLS_DIR="$TOOLDIR"
export PLAYWRIGHT_DIR="$TOOLDIR"
export NODE_PATH="$TOOLDIR/node_modules"
export FFMPEG="$FFMPEG"
export FFPROBE="$FFPROBE"
export LD_LIBRARY_PATH="${LDPATH}${LDPATH:+:}\${LD_LIBRARY_PATH:-}"
ENV
log "wrote $TOOLDIR/env.sh"
cat "$TOOLDIR/env.sh"
if [ -z "${NARRATION_PROVIDER:-}" ] && ! grep -qs '^NARRATION_PROVIDER=.' "$ROOT/.env"; then
  log "next: node scripts/configure-voice.mjs   (narration language, provider, model and voice, with samples)"
fi
