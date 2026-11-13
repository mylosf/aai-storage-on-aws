#!/bin/bash
# Copy the video set from S3 onto every mounted backend. Idempotent (aws s3 sync).
set -uo pipefail
source /etc/demo.env

if ! aws s3api head-object --bucket "$BUCKET" --key video/master.m3u8 --region "$REGION" >/dev/null 2>&1; then
  echo "no content in s3://$BUCKET/video yet (run: make content)"
  exit 0
fi

rc=0
for b in nvme ebs efs; do
  if mountpoint -q "/mnt/$b"; then
    echo "== syncing s3://$BUCKET/video -> /mnt/$b/video"
    start=$(date +%s)
    if aws s3 sync "s3://$BUCKET/video" "/mnt/$b/video" --delete --only-show-errors --region "$REGION"; then
      echo "   done in $(( $(date +%s) - start ))s: $(find /mnt/$b/video -type f | wc -l) files, $(du -sh /mnt/$b/video | cut -f1)"
    else
      echo "   FAILED"; rc=1
    fi
  else
    echo "== /mnt/$b not mounted, skipping"
  fi
done
exit $rc
