#!/bin/bash
# Download a PixelLab Wang tileset spritesheet and split into individual 32x32 tiles.
# Usage: ./scripts/download-wang-tileset.sh <download_url> <transition_dir_name>
# Example: ./scripts/download-wang-tileset.sh "https://api.pixellab.ai/mcp/tilesets/UUID/image" "grassland_to_forest"

set -e

URL="$1"
DIR_NAME="$2"
TILE_SIZE=32
BASE_DIR="assets/pixelab/landscape_v2/transitions"
TARGET_DIR="${BASE_DIR}/${DIR_NAME}/wang"

if [ -z "$URL" ] || [ -z "$DIR_NAME" ]; then
  echo "Usage: $0 <download_url> <transition_dir_name>"
  exit 1
fi

# Create target directory
mkdir -p "$TARGET_DIR"

# Download spritesheet to temp file
TEMP_FILE=$(mktemp /tmp/wang_sheet_XXXXXX.png)
curl -sL "$URL" -o "$TEMP_FILE"

# Get spritesheet dimensions
DIMS=$(magick identify -format "%w %h" "$TEMP_FILE")
WIDTH=$(echo $DIMS | cut -d' ' -f1)
HEIGHT=$(echo $DIMS | cut -d' ' -f2)
COLS=$((WIDTH / TILE_SIZE))
ROWS=$((HEIGHT / TILE_SIZE))
TOTAL=$((COLS * ROWS))

echo "Spritesheet: ${WIDTH}x${HEIGHT}, ${COLS}x${ROWS} tiles = ${TOTAL} total"

# Split into individual tiles (wang_0 through wang_15)
for i in $(seq 0 $((TOTAL > 16 ? 15 : TOTAL - 1))); do
  COL=$((i % COLS))
  ROW=$((i / COLS))
  X=$((COL * TILE_SIZE))
  Y=$((ROW * TILE_SIZE))
  OUT_FILE="${TARGET_DIR}/${DIR_NAME}__wang_${i}__v000.png"
  magick "$TEMP_FILE" -crop "${TILE_SIZE}x${TILE_SIZE}+${X}+${Y}" +repage "$OUT_FILE"
done

rm -f "$TEMP_FILE"
echo "Done: ${TOTAL} tiles -> ${TARGET_DIR}/"
