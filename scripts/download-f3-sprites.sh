#!/bin/bash
# F3 Small Scatter — Batch download from PixelLab
# Reads f3-manifest.json and downloads all sprites via public backblaze URLs.
#
# Usage: bash scripts/download-f3-sprites.sh [--dry-run] [--parallel N]
# Requires: curl, jq (or python3)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
MANIFEST="$SCRIPT_DIR/f3-manifest.json"
USER_ID="0f1031f5-9eee-4df4-996f-0a4114148eba"
BACKBLAZE="https://backblaze.pixellab.ai/file/pixellab-characters/objects"
ASSET_DIR="$PROJECT_DIR/assets/pixelab/landscape_v2/micro/small_scatter"
MAX_PARALLEL="${2:-8}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN] No files will be downloaded."
fi

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: Manifest not found at $MANIFEST"
  echo "Run the manifest builder first (or have Claude enumerate IDs)."
  exit 1
fi

echo "=== F3 Small Scatter Batch Download ==="
echo "Manifest: $MANIFEST"
echo "Output:   $ASSET_DIR"
echo ""

# Parse biome and object name from tag: f3_{biome}_{objectname}
# Handles multi-word biomes: dense_forest, tropical_forest
parse_tag() {
  local tag="$1"
  local rest="${tag#f3_}"

  for biome in dense_forest tropical_forest forest taiga grassland savanna steppe desert beach swamp hills mountains volcanic tundra arctic mystic; do
    if [[ "$rest" == "${biome}_"* ]]; then
      echo "$biome ${rest#${biome}_}"
      return
    fi
  done
  echo ""
}

# Get all tags from manifest
TAGS=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    d = json.load(f)
for tag in sorted(d.keys()):
    ids = d[tag]
    print(f'{tag} {len(ids)}')
")

TOTAL_TAGS=0
TOTAL_OBJECTS=0
TOTAL_DOWNLOADED=0
TOTAL_SKIPPED=0
TOTAL_FAILED=0

# Process each tag
while IFS= read -r line; do
  tag=$(echo "$line" | awk '{print $1}')
  count=$(echo "$line" | awk '{print $2}')
  parsed=$(parse_tag "$tag")

  if [ -z "$parsed" ]; then
    echo "  SKIP: Cannot parse tag '$tag'"
    continue
  fi

  biome=$(echo "$parsed" | awk '{print $1}')
  obj_name=$(echo "$parsed" | awk '{print $2}')
  out_dir="$ASSET_DIR/$biome/$obj_name"

  TOTAL_TAGS=$((TOTAL_TAGS + 1))
  TOTAL_OBJECTS=$((TOTAL_OBJECTS + count))

  echo -n "  $biome/$obj_name ($count sprites): "

  if $DRY_RUN; then
    echo "would download to $out_dir/"
    continue
  fi

  mkdir -p "$out_dir"

  # Get IDs for this tag and download
  downloaded=0
  skipped=0
  failed=0

  # Extract IDs from manifest and download in parallel
  python3 -c "
import json, sys
with open('$MANIFEST') as f:
    d = json.load(f)
ids = d.get('$tag', [])
for i, oid in enumerate(ids):
    print(f'{i} {oid}')
" | while IFS= read -r id_line; do
    variant=$(echo "$id_line" | awk '{print $1}')
    oid=$(echo "$id_line" | awk '{print $2}')
    idx=$(printf "%03d" "$variant")
    dest="$out_dir/ss__${biome}__${obj_name}__v${idx}.png"

    if [ -f "$dest" ]; then
      skipped=$((skipped + 1))
      continue
    fi

    url="$BACKBLAZE/$USER_ID/$oid/rotations/unknown.png"
    if curl -s -f -o "$dest" "$url" 2>/dev/null; then
      downloaded=$((downloaded + 1))
    else
      failed=$((failed + 1))
      rm -f "$dest"  # Clean up partial downloads
    fi
  done

  echo "done"
  TOTAL_DOWNLOADED=$((TOTAL_DOWNLOADED + downloaded))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))

done <<< "$TAGS"

echo ""
echo "=== Summary ==="
echo "Tags processed: $TOTAL_TAGS"
echo "Total objects:  $TOTAL_OBJECTS"
if ! $DRY_RUN; then
  echo "Downloaded:     $TOTAL_DOWNLOADED"
  echo "Already exist:  $TOTAL_SKIPPED"
  echo "Failed:         $TOTAL_FAILED"
fi
echo ""
echo "Sprites saved to: $ASSET_DIR/"
