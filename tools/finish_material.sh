#!/usr/bin/env bash
# tools/finish_material.sh <material>
# Per-tile post-process: solidify (force opacity) → trim-outline (crop the near-black edge outline so the
# textured material reaches the edge → seamless mirror tiling + no black border). Corners: the clean WEST
# is mirror-flipped to the EAST (generate-one-flip-other).
set -e
M="$1"
[ -z "$M" ] && { echo "usage: finish_material.sh <material>"; exit 1; }
D="assets/pixelab/buildings/tiles/grassland/$M"
R="tools/_round2"
mkdir -p "$D"
fin() { node scripts/solidify.mjs "$1" "$2" >/dev/null; node scripts/trim-outline.mjs "$2" "$2" lr 50 15 >/dev/null; }
fin "$R/${M}__base_raw.png" "$D/ground_plain__v0.png"
for s in ground_window ground_door ground_left_corner upper_plain upper_window upper_left_corner; do
  [ -f "$R/${M}__${s}_raw.png" ] && fin "$R/${M}__${s}_raw.png" "$D/${s}__v0.png" || echo "WARN missing $R/${M}__${s}_raw.png"
done
# EAST corners = mirror of the clean trimmed WEST
node scripts/flip-h.mjs "$D/ground_left_corner__v0.png" "$D/ground_right_corner__v0.png" >/dev/null
node scripts/flip-h.mjs "$D/upper_left_corner__v0.png" "$D/upper_right_corner__v0.png" >/dev/null
cp "$D/ground_left_corner__v0.png" "$D/left_corner__v0.png"
cp "$D/ground_right_corner__v0.png" "$D/right_corner__v0.png"
echo "finished $M"
