#!/usr/bin/env bash
# Runs `php` / `composer` (or any command) for this example: on the host when `php` is on PATH
# (CI), otherwise inside the `toolmark-php:8.4` image built from docker/Dockerfile.
#
#   scripts/php.sh php artisan test
#   PHP_PORTS=8010 scripts/php.sh php artisan serve --host=0.0.0.0 --port=8010
#
# PHP_PORTS (space-separated) publishes each port on host 127.0.0.1 only and names the container
# `toolmark-php-<first port>` (a stale container of that name is removed first).
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/php.sh <php|composer|command> [args...]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

if command -v php >/dev/null 2>&1; then
  exec "$@"
fi

IMAGE=toolmark-php:8.4
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" docker/ >&2
fi

args=(run --rm --init -i -v "$PWD":/app -w /app --user "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/composer)
for var in APP_ENV CACHE_STORE REDIS_HOST PHP_CLI_SERVER_WORKERS TOOLMARK_E2E_BUILD; do
  if [ -n "${!var:-}" ]; then
    args+=(-e "$var=${!var}")
  fi
done
# The app container reaches the Reverb container through the host; the browser keeps using the
# VITE_REVERB_* values.
args+=(--add-host=host.docker.internal:host-gateway -e REVERB_HOST=host.docker.internal)

if [ -n "${PHP_PORTS:-}" ]; then
  first=""
  for port in $PHP_PORTS; do
    [ -z "$first" ] && first="$port"
    args+=(-p "127.0.0.1:$port:$port")
  done
  name="toolmark-php-$first"
  docker rm -f "$name" >/dev/null 2>&1 || true
  args+=(--name "$name")
fi

exec docker "${args[@]}" "$IMAGE" "$@"
