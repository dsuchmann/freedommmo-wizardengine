"""Download PixelLab tilesets and install as wang tiles in terrain_v3/surfaces/.

Usage: python tools/download_pixellab_tilesets.py

Reads tileset IDs from TILESET_JOBS below, downloads spritesheets,
splits into individual wang tiles, and saves to the correct surface directory.
"""

import os
import sys
import json
import urllib.request
from PIL import Image

# PixelLab spritesheet grid index -> our wang index mapping
# (inverse of LayeredTilesetLoader.WANG_TO_GRID)
GRID_TO_WANG = {
    6: 0, 5: 1, 2: 2, 3: 3, 10: 4, 1: 5, 4: 6, 13: 7,
    7: 8, 14: 9, 11: 10, 0: 11, 9: 12, 8: 13, 15: 14, 12: 15
}

SURFACES_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "catalog", "terrain_v3", "surfaces")

# Map tileset_id -> surface_id (fill in after generation completes)
TILESET_JOBS = {
    # snow
    "c241b0ca-5ed2-4206-96db-c1b3306282a1": "snow",
    # glacial_ice
    "6e19b1d4-38a0-4516-838e-e8cebd1d6505": "glacial_ice",
    # frozen_earth
    "d198ce03-a02d-4532-9249-a2298e4a2191": "frozen_earth",
    # lush_grass
    "b1db7c37-3434-4996-b31d-b05c60035aa3": "lush_grass",
    # golden_sand
    "64e8b468-9f49-4729-820c-1cc9e07e03ae": "golden_sand",
    # volcanic_rock
    "935e161f-b340-402d-a820-6a822ddd3f5c": "volcanic_rock",
    # forest_floor
    "1a245ec6-db0c-4662-bdbd-1cd96eacddd2": "forest_floor",
    # grey_rock
    "26a43511-502e-47f1-8c8e-b100da30fc20": "grey_rock",
    # dark_humus
    "45189322-e069-414d-a22e-7b443fbbb666": "dark_humus",
    # swamp_mud
    "772792d1-3a97-46f8-9c4a-a30c606a92ba": "swamp_mud",
}


def download_and_split(tileset_id: str, surface_id: str, api_data: dict):
    """Download spritesheet and split into wang tiles."""
    surface_dir = os.path.join(SURFACES_DIR, surface_id)
    os.makedirs(surface_dir, exist_ok=True)

    # Back up existing tileset.png
    existing = os.path.join(surface_dir, "tileset.png")
    if os.path.exists(existing):
        backup = os.path.join(surface_dir, "tileset_old.png")
        os.rename(existing, backup)
        print(f"  Backed up existing tileset.png -> tileset_old.png")

    # Download spritesheet
    spritesheet_url = api_data.get("spritesheet_url", "")
    if not spritesheet_url:
        print(f"  ERROR: No spritesheet URL for {surface_id}")
        return

    print(f"  Downloading spritesheet...")
    urllib.request.urlretrieve(spritesheet_url, os.path.join(surface_dir, "tileset.png"))

    # Split into wang tiles (4x4 grid)
    sheet = Image.open(os.path.join(surface_dir, "tileset.png"))
    tile_w = sheet.width // 4
    tile_h = sheet.height // 4

    for grid_idx in range(16):
        gx = grid_idx % 4
        gy = grid_idx // 4
        tile = sheet.crop((gx * tile_w, gy * tile_h, (gx + 1) * tile_w, (gy + 1) * tile_h))

        wang_idx = GRID_TO_WANG.get(grid_idx, grid_idx)
        out_path = os.path.join(surface_dir, f"wang_{wang_idx}.png")

        # Back up existing
        if os.path.exists(out_path):
            os.remove(out_path)

        tile.save(out_path)

    print(f"  Saved 16 wang tiles to {surface_dir}")

    # Remove .import files so Godot re-imports
    for f in os.listdir(surface_dir):
        if f.endswith(".import"):
            os.remove(os.path.join(surface_dir, f))
    print(f"  Cleared .import files for re-import")


if __name__ == "__main__":
    print(f"PixelLab Tileset Downloader")
    print(f"Surfaces dir: {SURFACES_DIR}")
    print(f"Jobs: {len(TILESET_JOBS)}")
    print()

    # For now just print instructions — actual API integration TBD
    print("To use: fetch each tileset from PixelLab MCP, get the spritesheet URL,")
    print("then call download_and_split() with the API response data.")
    print()
    for tid, sid in TILESET_JOBS.items():
        print(f"  {sid}: get_topdown_tileset('{tid}')")
