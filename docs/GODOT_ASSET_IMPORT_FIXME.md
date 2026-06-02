# Godot/Pixellab Asset Import Fix

The screenshot showed large vertical stripe/sheet artifacts. Cause: Godot/Pixellab terrain files such as tilesets/Wang sheets were treated as single full-image tile frames and stretched into every map tile.

Immediate fix:

- Terrain painter now only uses Godot/Pixellab terrain images when the loaded frame is tile-sized/safe (`<=64x64` and not suspiciously sheet-shaped).
- Large tilesheets are ignored for base tile painting until a real Wang/autotile slicer maps their cells correctly.

Next required work:

1. Parse Godot `.tres` TileSet metadata or infer sheet grid dimensions.
2. Build atlas defs with actual cell coordinates, not `fullImage`.
3. Classify Wang tile roles: center, edge N/E/S/W, corners, diagonals, transitions.
4. Select Wang tile by neighboring terrain masks.
5. Only then use large Pixellab sheets in terrain rendering.

Until that is implemented, procedural coherent terrain is safer than stretched sheets.
