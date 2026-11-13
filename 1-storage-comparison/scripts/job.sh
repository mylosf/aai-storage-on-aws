#!/usr/bin/env bash
# Start an API job and poll it until it finishes.
#   scripts/job.sh <demo-url> <path> [json-body]
#   scripts/job.sh https://xxx.cloudfront.net /api/admin/sync
#   scripts/job.sh https://xxx.cloudfront.net /api/bench/run '{"runs":1}'
set -euo pipefail
URL=${1:?demo url}; PATH_=${2:?api path}; BODY=${3:-{\}}

JOB=$(curl -sf -X POST -H 'Content-Type: application/json' -d "$BODY" "$URL$PATH_" | jq -r .jobId)
[ -n "$JOB" ] && [ "$JOB" != null ] || { echo "no jobId returned"; exit 1; }
echo "job $JOB"

while :; do
  J=$(curl -sf "$URL/api/jobs/$JOB")
  STATUS=$(jq -r .status <<<"$J")
  MSG=$(jq -r '.progress.message // ""' <<<"$J")
  printf '\r\033[K  %-8s %s' "$STATUS" "$MSG"
  case "$STATUS" in
    done)  echo; jq '.result' <<<"$J"; exit 0 ;;
    error) echo; echo "ERROR: $(jq -r .error <<<"$J")"; exit 1 ;;
  esac
  sleep 2
done
