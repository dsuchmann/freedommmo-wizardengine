"""Download and install PixelLab transition tilesets into terrain_v3/transitions/.

Usage: python tools/download_transition_tilesets.py

Reads tileset IDs from data/terrain_v3_transition_jobs.json,
downloads spritesheets, splits into individual wang tiles.
"""

import json
import os
import subprocess
import sys
from PIL import Image

GRID_TO_WANG = {6:0, 5:1, 2:2, 3:3, 10:4, 1:5, 4:6, 13:7,
                7:8, 14:9, 11:10, 0:11, 9:12, 8:13, 15:14, 12:15}

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRANSITIONS_DIR = os.path.join(PROJECT_ROOT, "assets", "catalog", "terrain_v3", "transitions")
JOBS_FILE = os.path.join(PROJECT_ROOT, "data", "terrain_v3_transition_jobs.json")


def download_and_install(tileset_id: str, transition_key: str):
    """Download a transition tileset and split into wang tiles."""
    dest_dir = os.path.join(TRANSITIONS_DIR, transition_key)
    os.makedirs(dest_dir, exist_ok=True)

    url = f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/image"
    tmp = os.path.join(dest_dir, "tileset_dl.png")

    print(f"  Downloading {transition_key}...")
    result = subprocess.run(["curl", "-sL", url, "-o", tmp], capture_output=True)
    if result.returncode != 0:
        print(f"  FAILED: curl error")
        return False

    if not os.path.exists(tmp) or os.path.getsize(tmp) < 100:
        print(f"  FAILED: empty or missing file")
        return False

    sheet = Image.open(tmp)
    tw, th = sheet.width // 4, sheet.height // 4

    for grid_idx in range(16):
        col = grid_idx % 4
        row = grid_idx // 4
        tile = sheet.crop((col*tw, row*th, (col+1)*tw, (row+1)*th))
        wang_idx = GRID_TO_WANG[grid_idx]
        tile.save(os.path.join(dest_dir, f"wang_{wang_idx}.png"))

    # Save tileset.png
    import shutil
    shutil.copy2(tmp, os.path.join(dest_dir, "tileset.png"))
    os.remove(tmp)

    # Clear .import files
    for f in os.listdir(dest_dir):
        if f.endswith(".import"):
            os.remove(os.path.join(dest_dir, f))

    print(f"  {transition_key}: installed 16 wang tiles ({sheet.width}x{sheet.height})")
    return True


def main():
    with open(JOBS_FILE) as f:
        data = json.load(f)

    transitions = data["transitions"]
    print(f"Installing {len(transitions)} transition tilesets...")
    print(f"Destination: {TRANSITIONS_DIR}")
    print()

    success = 0
    for key, tileset_id in transitions.items():
        if download_and_install(tileset_id, key):
            success += 1

    print(f"\nDone: {success}/{len(transitions)} installed")


if __name__ == "__main__":
    main()
