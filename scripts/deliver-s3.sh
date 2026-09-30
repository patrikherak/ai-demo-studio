#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Optional: upload the final video to S3-compatible storage and print a verified,
time-limited download link (works with AWS S3, Cloudflare R2, MinIO, Backblaze B2).

  bash scripts/deliver-s3.sh <final.mp4> [key-prefix]

Needs the aws CLI and, in .env: DELIVERY_S3_BUCKET, AWS_ACCESS_KEY_ID,
AWS_SECRET_ACCESS_KEY, AWS_REGION; optional DELIVERY_S3_ENDPOINT_URL (non-AWS),
DELIVERY_S3_PREFIX, DELIVERY_URL_TTL_SECONDS (default 604800 = 7 days).
The link is range-probed before it is printed; a link that fails the probe is not printed.
TXT
}
[[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; [[ $# -ge 1 ]] && exit 0 || exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
FILE="$1"
PREFIX="${2:-${DELIVERY_S3_PREFIX:-demos}}"
: "${DELIVERY_S3_BUCKET:?set DELIVERY_S3_BUCKET in .env}"
command -v aws >/dev/null 2>&1 || { echo "ERROR aws CLI not found" >&2; exit 1; }
TTL="${DELIVERY_URL_TTL_SECONDS:-604800}"
ENDPOINT=()
[ -n "${DELIVERY_S3_ENDPOINT_URL:-}" ] && ENDPOINT=(--endpoint-url "$DELIVERY_S3_ENDPOINT_URL")
KEY="$PREFIX/$(date -u +%Y%m%d-%H%M%S)-$(basename "$FILE")"

aws "${ENDPOINT[@]}" s3 cp "$FILE" "s3://$DELIVERY_S3_BUCKET/$KEY" --content-type video/mp4 --only-show-errors
URL="$(aws "${ENDPOINT[@]}" s3 presign "s3://$DELIVERY_S3_BUCKET/$KEY" --expires-in "$TTL")"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -r 0-1023 "$URL")"
if [ "$CODE" != "206" ] && [ "$CODE" != "200" ]; then
  echo "ERROR uploaded to s3://$DELIVERY_S3_BUCKET/$KEY but the signed link answered HTTP $CODE; not printing it" >&2
  exit 2
fi
echo "uploaded s3://$DELIVERY_S3_BUCKET/$KEY (link valid ${TTL}s, probe HTTP $CODE)" >&2
echo "$URL"
