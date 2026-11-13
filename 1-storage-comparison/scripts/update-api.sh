#!/usr/bin/env bash
# Pull the latest api/ files from the bucket onto the origin instance and restart the service.
#   scripts/update-api.sh <region> <origin-instance-id>
set -euo pipefail
REGION=${1:?region}; INSTANCE=${2:?origin instance id}

CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --parameters 'commands=["/opt/demo/update.sh","/opt/demo/api/install.sh"]' \
  --query 'Command.CommandId' --output text)
echo "ssm command $CMD"
aws ssm wait command-executed --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text | grep -v '^\s*$' | tail -15
