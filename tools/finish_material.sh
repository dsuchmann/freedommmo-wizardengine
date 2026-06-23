#!/usr/bin/env bash
# tools/finish_material.sh <material>
# Per-tile post-process for a grassland building material, then VALIDATE (qa-tiles + qa-frames).
#   plain/window/door : solidify (force opacity) -> trim-outline lr (textured material reaches the L/R edges
#                       -> seamless mirror-tiling, no black seam).
#   corners           : solidify -> FILL the INNER (wall-side) outline with texture (clean join) -> surgically
#                       ALPHA only the pure-black OUTER outline, so the world's terrain shows past the building
#                       edge (not a black border) while the base wall is inset and never bleeds through.
#                       WEST is finished; EAST = horizontal mirror (generate-one-flip-other).
set -e
M="$1"
[ -z "$M" ] && { echo "usage: finish_material.sh <material>"; exit 1; }
D="assets/pixelab/buildings/tiles/grassland/$M"
R="tools/_round2"
mkdir -p "$D"
fin()        { node scripts/solidify.mjs "$1" "$2" >/dev/null; node scripts/trim-outline.mjs "$2" "$2" lr 50 15 >/dev/null; }
corner_fin() { node scripts/solidify.mjs "$1" "$2" >/dev/null; \
               node scripts/dealpha-edge.mjs "$2" "$2" right fill 12 50 >/dev/null; \
               node scripts/dealpha-edge.mjs "$2" "$2" left alpha 6 30 >/dev/null; }
fin "$R/${M}__base_raw.png" "$D/ground_plain__v0.png"
for s in ground_window ground_door upper_plain upper_window; do
  [ -f "$R/${M}__${s}_raw.png" ] && fin "$R/${M}__${s}_raw.png" "$D/${s}__v0.png" || echo "WARN missing $R/${M}__${s}_raw.png"
done
for s in ground_left_corner upper_left_corner; do
  [ -f "$R/${M}__${s}_raw.png" ] && corner_fin "$R/${M}__${s}_raw.png" "$D/${s}__v0.png" || echo "WARN missing $R/${M}__${s}_raw.png"
done
# EAST corners = horizontal mirror of the finished WEST
node scripts/flip-h.mjs "$D/ground_left_corner__v0.png" "$D/ground_right_corner__v0.png" >/dev/null
node scripts/flip-h.mjs "$D/upper_left_corner__v0.png" "$D/upper_right_corner__v0.png" >/dev/null
cp "$D/ground_left_corner__v0.png" "$D/left_corner__v0.png"
cp "$D/ground_right_corner__v0.png" "$D/right_corner__v0.png"
echo "finished $M — validating…"
node scripts/qa-tiles.mjs "$D" || true
node scripts/qa-frames.mjs "$D" || true
