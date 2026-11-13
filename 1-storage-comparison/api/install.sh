#!/bin/bash
# Runs after `npm install` on the instance (postinstall) and from `make update-api`:
# installs the nginx config shipped with the API and reloads nginx if it changed.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || exit 0            # local dev: nothing to do
[ -f /etc/nginx/nginx.conf ] || exit 0  # nginx not installed (yet)
mkdir -p /var/lib/demo
if ! cmp -s "$HERE/nginx.conf" /etc/nginx/nginx.conf; then
  cp "$HERE/nginx.conf" /etc/nginx/nginx.conf
  nginx -t
  systemctl reload nginx || systemctl restart nginx
  echo "nginx config updated"
fi
