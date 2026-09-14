#!/bin/sh
# Build and verify the complete root-domain release in one pass.
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [destination]" >&2
  exit 2
fi

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
destination=${1:-"$root/agent_out/release/site"}
case "$destination" in
  /|"$root")
    echo "refusing unsafe destination: $destination" >&2
    exit 2
    ;;
esac

mkdir -p "$(dirname "$destination")"
rm -rf "$destination"

cd "$root"
python3 script/verify-imported-content.py
python3 script/verify-static-app.py
script/build-site.sh "$destination"
# PDF links are opt-in and must be backed by a complete successful render.
# Use only an already installed browser/module; this step never downloads tools.
if [ "${ACADEMIC_PDFS:-0}" = 1 ]; then
  node script/render-publication-pdfs.mjs --site "$destination"
  python3 script/verify-publications.py "$destination" --require-pdfs
else
  python3 script/verify-publications.py "$destination"
fi
# This tree is already rendered. GitHub Pages must publish it verbatim rather
# than running its restricted Jekyll build over it again.
: > "$destination/.nojekyll"

python3 script/verify-site.py "$destination"
python3 script/test-search-redirects.py "$destination"
python3 script/verify-challenge-archive.py "$destination"
python3 script/verify-reader-copy.py "$destination"
python3 script/verify-code-parity.py "$destination"
python3 script/verify-heading-parity.py "$destination"
python3 script/artifact_manifest.py "$destination" > "$destination.manifest.jsonl"

printf 'release: %s\nmanifest: %s\n' "$destination" "$destination.manifest.jsonl"
