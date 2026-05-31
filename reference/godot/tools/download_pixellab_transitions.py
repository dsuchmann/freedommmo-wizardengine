#!/usr/bin/env python3
"""Download PixelLab transition tilesets into terrain_v3 structure.

Downloads spritesheets from backblaze, crops into 16 wang tiles (4x4 grid, 32x32 each).
"""

import urllib.request
from pathlib import Path
from PIL import Image
from io import BytesIO

REPO = Path(__file__).resolve().parent.parent
V3 = REPO / "assets" / "catalog" / "terrain_v3"

# Backblaze base URL pattern - need account ID per tileset
# Format: https://backblaze.pixellab.ai/file/pixellab-tiles/{account_id}/{tileset_id}/spritesheet.png
# The account_id is constant for all tilesets from same account
ACCOUNT_ID = "0f1031f5-9eee-4df4-996f-0a4114148eba"
BB_BASE = f"https://backblaze.pixellab.ai/file/pixellab-tiles/{ACCOUNT_ID}"

TILE_SIZE = 32
GRID = 4  # 4x4 grid of tiles

JOBS = {
    # Transitions
    "90690476-0664-4805-ad7f-93fc05bde013": "transitions/grey_rock__snow",
    "72c2af13-746f-4e9c-aaf6-300352662dea": "transitions/forest_floor__grey_rock",
    "627ba760-6501-4b02-9849-23d7cb7aeb64": "transitions/frozen_earth__snow",
    "0ac92777-dd93-404d-9bb9-fb009052fb4e": "transitions/glacial_ice__snow",
    "50c7a571-f36b-46b9-a28f-a9bd6934e649": "transitions/volcanic_rock__grey_rock",
    "21ffae32-b5ee-4a1d-83b0-dd464517ef45": "transitions/swamp_mud__lush_grass",
    "07a17a8c-d24a-4c42-90f4-26c3882d6203": "transitions/swamp_mud__forest_floor",
    "a2dc5484-52da-4da0-b42e-10db7ca3cbb0": "transitions/lush_grass__frozen_earth",
    "ec6861e4-a946-43e7-87f9-8abe51195143": "transitions/mystic_crystal__grey_rock",
    # Surfaces
    "45535842-8145-4da1-8a88-aff4935887b2": "surfaces/snow",
}


def download_and_split(tileset_id: str, target_dir: Path) -> int:
    target_dir.mkdir(parents=True, exist_ok=True)

    url = f"{BB_BASE}/{tileset_id}/spritesheet.png"
    try:
        with urllib.request.urlopen(url) as resp:
            data = resp.read()
    except Exception as e:
        print(f"FAILED ({e})")
        return 0

    sheet = Image.open(BytesIO(data))
    # Save full spritesheet too
    sheet.save(target_dir / "tileset.png")

    count = 0
    for i in range(16):
        row = i // GRID
        col = i % GRID
        x = col * TILE_SIZE
        y = row * TILE_SIZE
        tile = sheet.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))
        tile.save(target_dir / f"wang_{i}.png")
        count += 1

    return count


def main():
    total = 0
    failed = []

    for tileset_id, rel_path in JOBS.items():
        target = V3 / rel_path
        # Clear existing wang tiles
        if target.exists():
            for f in target.glob("wang_*.png"):
                f.unlink()

        print(f"  {rel_path}...", end=" ")
        n = download_and_split(tileset_id, target)
        if n > 0:
            print(f"{n} tiles")
        else:
            failed.append(rel_path)
        total += n

    print(f"\nTotal: {total} tiles downloaded")
    if failed:
        print(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
