#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Put the target project into an isolated working copy, never touching the original.

  bash scripts/prepare-project.sh <path-or-git-url> [slug] [--ref <branch|tag|sha>] [--as <name>] [--copy]

  local path  -> git worktree (clean checkout of HEAD or --ref) when it is a git repo,
                 otherwise an rsync copy without node_modules, build output and .env files
  git url     -> shallow clone (uses GIT_TOKEN for private https repos, never printed)

Result: $DEMO_WORKDIR/<slug>/source (default DEMO_WORKDIR=./work). Prints the path.
A product split over several repositories (for example an API and a web client)
gets one call per repository with --as: $DEMO_WORKDIR/<slug>/source/<name>.
Uncommitted changes in a local repo are NOT carried over; pass --copy to copy the
working tree as it is instead.
TXT
}
[[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; [[ $# -ge 1 ]] && exit 0 || exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
SOURCE="$1"; shift
SLUG=""; REF="${PROJECT_REF:-}"; COPY=0; AS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2;;
    --copy) COPY=1; shift;;
    --as) AS="$2"; shift 2;;
    *) SLUG="$1"; shift;;
  esac
done
if [ -z "$SLUG" ]; then
  SLUG="$(basename "${SOURCE%.git}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '-' | sed 's/--*/-/g; s/^-//; s/-$//')"
fi
WORKDIR="${DEMO_WORKDIR:-$ROOT/work}"
[[ "$WORKDIR" = /* ]] || WORKDIR="$ROOT/$WORKDIR"
DEST="$WORKDIR/$SLUG/source${AS:+/$AS}"
mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ]; then echo "exists: $DEST (delete it to start over)" >&2; echo "$DEST"; exit 0; fi

if [[ "$SOURCE" =~ ^(https?://|git@|ssh://) ]]; then
  URL="$SOURCE"
  if [ -n "${GIT_TOKEN:-}" ] && [[ "$URL" == https://* ]]; then
    ASKPASS="$(mktemp)"; trap 'rm -f "$ASKPASS"' EXIT
    printf '#!/bin/sh\ncase "$1" in *Username*) echo x-access-token;; *) echo "$GIT_TOKEN";; esac\n' > "$ASKPASS"; chmod 700 "$ASKPASS"
    export GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0
  fi
  if [ -n "$REF" ]; then
    git clone --quiet --depth 1 --branch "$REF" "$URL" "$DEST" 2>/dev/null || { git clone --quiet "$URL" "$DEST" && git -C "$DEST" checkout --quiet "$REF"; }
  else
    git clone --quiet --depth 1 "$URL" "$DEST"
  fi
  echo "cloned $(git -C "$DEST" rev-parse --short HEAD) into $DEST" >&2
else
  SRC="$(cd "$SOURCE" && pwd)"
  if [ "$COPY" = 0 ] && git -C "$SRC" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    TOP="$(git -C "$SRC" rev-parse --show-toplevel)"
    if [ -n "$(git -C "$TOP" status --porcelain 2>/dev/null)" ]; then echo "note: $TOP has uncommitted changes; they are not in the worktree (use --copy to include them)" >&2; fi
    git -C "$TOP" worktree add --quiet --detach "$DEST" "${REF:-HEAD}"
    echo "worktree of $TOP at $(git -C "$DEST" rev-parse --short HEAD) in $DEST (remove later: git -C \"$TOP\" worktree remove \"$DEST\")" >&2
  else
    rsync -a --exclude node_modules --exclude .next --exclude dist --exclude build --exclude .turbo --exclude .venv \
      --exclude '__pycache__' --exclude '.env' --exclude '.env.*' --include '.env.example' "$SRC/" "$DEST/"
    echo "copied $SRC into $DEST (without dependencies, build output and .env files)" >&2
  fi
fi
echo "$DEST"
