#!/usr/bin/env bash
# scripts/job.sh <demo-url> <path> [json] — start a job and poll it
set -euo pipefail
URL=$1; P=$2; B=${3:-'{}'}
ID=$(curl -sf -X POST -H 'content-type: application/json' -d "$B" "$URL$P" | jq -r .id)
echo "job $ID"
while :; do
  J=$(curl -sf "$URL/api/jobs/$ID"); S=$(jq -r .status <<<"$J")
  printf '\r\033[K  %-8s %s' "$S" "$(jq -r .progress <<<"$J")"
  case $S in done) echo; exit 0;; error) echo; jq -r .error <<<"$J"; exit 1;; esac
  sleep 3
done
