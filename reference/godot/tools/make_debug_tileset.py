#!/usr/bin/env python3
from PIL import Image
from pathlib import Path

print('[HB] make_debug_tileset.py ready')
out_dir = Path('assets/tilesets')
out_dir.mkdir(parents=True, exist_ok=True)

tile_size = 16
colors = [
    (30, 80, 160, 255),   # ocean
    (240, 220, 120, 255), # beach
    (80, 160, 80, 255),   # grass
    (220, 200, 120, 255), # desert
    (40, 110, 50, 255),   # forest
    (140, 140, 140, 255), # rock
    (200, 220, 230, 255), # tundra
]

img = Image.new('RGBA', (tile_size * len(colors), tile_size), (0, 0, 0, 0))
for i, c in enumerate(colors):
    for y in range(tile_size):
        for x in range(tile_size):
            img.putpixel((i*tile_size + x, y), c)

png_path = out_dir / 'DebugTiles.png'
img.save(png_path)

tres = f"""
[gd_resource type="TileSet" format=3]

[resource]
tile_size = Vector2i({tile_size}, {tile_size})
source_0 = SubResource("1")

[sub_resource type="TileSetAtlasSource" id="1"]
texture = preload("res://assets/tilesets/DebugTiles.png")
texture_region_size = Vector2i({tile_size}, {tile_size})
"""

tres_path = out_dir / 'DebugTileSet.tres'
tres_path.write_text(tres)
print('[HB] wrote', png_path)
print('[HB] wrote', tres_path)


