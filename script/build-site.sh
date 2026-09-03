#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [destination]" >&2
  exit 2
fi

destination=${1:-_site}
build_time=${BUILD_TIME:-}
if [ -z "$build_time" ] && command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  build_time=$(git show -s --format=%cI HEAD)
fi
if [ -z "$build_time" ]; then
  echo "BUILD_TIME is required outside a Git checkout" >&2
  exit 2
fi

config=$(mktemp "${TMPDIR:-/tmp}/deuterium-build.XXXXXX.yml")
trap 'rm -f "$config"' EXIT HUP INT TERM
printf 'time: "%s"\n' "$build_time" > "$config"

JEKYLL_ENV=production \
LANG=${LANG:-C.UTF-8} \
LC_ALL=${LC_ALL:-C.UTF-8} \
TZ=${TZ:-Asia/Kolkata} \
bundle exec jekyll build --trace --disable-disk-cache \
  --config _config.yml,"$config" --destination "$destination"
