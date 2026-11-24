#!/usr/bin/env bash
# Run by Actions over SSH as the user who owns /opt/tradingapp.
set -Eeuo pipefail
incoming=${1:?Incoming directory required}
image=${2:?Versioned image required}
port=${3:-80}
[[ "$incoming" =~ ^/opt/tradingapp/incoming\.[a-zA-Z0-9]+$ ]] || exit 2
[[ "$image" =~ ^tradingapp:[a-f0-9]{40}$ ]] || exit 2
[[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 && port <= 65535 )) || exit 2
cd /opt/tradingapp
# Also serializes manual deployments on the VM.
exec 9>.deploy.lock
flock -w 180 9
trap 'rm -rf -- "$incoming"' EXIT

compose=(docker compose --env-file .env -f compose.yml)
if [[ -f compose.override.yml ]]; then
  compose+=(-f compose.override.yml)
fi

docker load --input "$incoming/image.tar.gz"
# Keep the previous successful deployment for a manual rollback.
if [[ -f .env ]]; then cp .env .env.previous; fi
if [[ -f compose.yml ]]; then cp compose.yml compose.previous.yml; fi
cp "$incoming/compose.yml" compose.yml
printf 'APP_IMAGE=%s\nAPP_PORT=%s\n' "$image" "$port" > .env.next
chmod 600 .env.next
mv .env.next .env
if ! "${compose[@]}" up -d --wait --wait-timeout 90; then
  "${compose[@]}" logs --tail=80 || true
  if [[ -f .env.previous && -f compose.previous.yml ]]; then
    cp .env.previous .env
    cp compose.previous.yml compose.yml
    "${compose[@]}" up -d --wait --wait-timeout 90
    echo 'Deployment failed; restored the previous version.' >&2
  else
    echo 'Initial deployment failed; inspect Docker logs.' >&2
  fi
  exit 1
fi
"${compose[@]}" ps
# Do not prune images: previous versions remain available for rollback.
