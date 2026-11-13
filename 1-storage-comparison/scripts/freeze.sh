#!/usr/bin/env bash
# Snapshot the latest results from the live API into the web app's static data,
# so the page keeps showing them after the instances are gone (make freeze).
#   scripts/freeze.sh <demo-url>
set -euo pipefail
URL=${1:?demo url}
OUT=web/public/data/snapshot.json
mkdir -p "$(dirname "$OUT")"
get() { curl -sf --max-time 20 "$URL$1" || echo null; }
INFO=$(curl -sf --max-time 20 "$URL/api/info") || { echo "API not reachable at $URL (already frozen?)"; exit 1; }
jq -n --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson info "$INFO" \
  --argjson bench "$(get /api/bench/latest)" \
  --argjson loadtest "$(get /api/loadtest/latest)" \
  --argjson sim "$(get /api/sim/latest)" \
  '{frozenAt: $at, info: $info, bench: $bench, loadtest: $loadtest, sim: $sim}' > "$OUT"
echo "snapshot written to $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
jq -r '"  bench: \(.bench.result.generatedAt // "none")\n  loadtest: \(.loadtest.result.generatedAt // "none")\n  paths: \(.sim.paths.result.generatedAt // "none")\n  storm: \(.sim.storm.result.generatedAt // "none")"' "$OUT"
