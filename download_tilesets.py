#!/usr/bin/env python3
"""Download and split all completed canonical tilesets from PixelLab."""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

BASE_DIR = "C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/assets/pixelab/landscape_v2/transitions"

# Canonical base tile ID prefixes -> biome name
LOWER_IDS = {
    "2c8a9b01": "arctic",
    "1e408a41": "beach",
    "09e824f3": "deep_ocean",
    "7a43bd9f": "dense_forest",
    "f51c6f4a": "desert",
    "87973039": "forest",
    "3d09d189": "grassland",
    "7296ae72": "hills",
    "b3c7768c": "lake",
    "1439e310": "mountains",
    "4bb937fe": "mystic",
    "cb04ad78": "ocean",
    "818260d3": "river",
    "7fd08ff7": "savanna",
    "b76c4461": "shallow_water",
    "fe211bb1": "steppe",
    "ebad6623": "swamp",
    "aadf3e49": "taiga",
    "130e304b": "tropical_forest",
    "4d46ed0d": "tundra",
    "2958e295": "volcanic",
}

UPPER_IDS = {
    "b6b93226": "arctic",
    "9119dfca": "beach",
    "14ee3566": "deep_ocean",
    "1f8e1133": "dense_forest",
    "93dc0f1e": "desert",
    "04e519e2": "forest",
    "949429fa": "grassland",
    "b9919459": "hills",
    "ec6cc367": "lake",
    "714d2999": "mountains",
    "8f7e34e1": "mystic",
    "49f34c08": "ocean",
    "0627c024": "river",
    "5e728d11": "savanna",
    "7ef8b363": "shallow_water",
    "a8aede8f": "steppe",
    "b65f815c": "swamp",
    "f69fd602": "taiga",
    "8b0f1193": "tropical_forest",
    "625ca67b": "tundra",
    "e14095c3": "volcanic",
}

API_BASE = "https://api.pixellab.ai/mcp/tilesets"


def get_biome_from_id(tile_id, id_map):
    """Match a tile ID prefix against the canonical ID map."""
    prefix = tile_id[:8]
    return id_map.get(prefix)


def fetch_json(url, retries=3):
    """Fetch JSON from URL with retries."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1 * (attempt + 1))
            else:
                print(f"  FAILED to fetch {url}: {e}")
                return None


def download_file(url, path, retries=3):
    """Download a file with curl (follows redirects for auth tokens)."""
    for attempt in range(retries):
        try:
            result = subprocess.run(
                ["curl", "-sL", "-o", path, url],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 100:
                return True
            if attempt < retries - 1:
                time.sleep(1 * (attempt + 1))
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1 * (attempt + 1))
            else:
                print(f"  FAILED to download {url}: {e}")
                return False
    print(f"  FAILED to download {url}: empty or error after {retries} attempts")
    return False


def split_spritesheet(input_path, output_dir, dir_name, tile_count):
    """Split spritesheet into individual 32x32 tiles using magick."""
    cols = 4
    # Normalize paths to forward slashes for magick compatibility
    input_path = input_path.replace("\\", "/")
    for i in range(tile_count):
        col = i % cols
        row = i // cols
        x = col * 32
        y = row * 32
        output_file = os.path.join(output_dir, f"{dir_name}__wang_{i}__v000.png").replace("\\", "/")
        cmd = [
            "magick", input_path,
            "-crop", f"32x32+{x}+{y}",
            "+repage", output_file
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  magick error for tile {i}: {result.stderr}")
            return False
    return True


def list_all_chainable_ids():
    """List all chainable tileset IDs by scraping the list API."""
    ids = []
    offset = 0
    limit = 50
    total = None

    while True:
        url = f"{API_BASE}?limit={limit}&offset={offset}"
        # The list endpoint isn't directly accessible via the same URL pattern
        # We'll use the metadata endpoint for each known ID instead
        # Actually, let's read from a pre-collected file
        break

    return ids


def process_tileset(tileset_id, stats):
    """Process a single tileset: fetch metadata, determine biome pair, download and split."""
    meta_url = f"{API_BASE}/{tileset_id}/metadata"
    meta = fetch_json(meta_url)
    if not meta:
        stats["fetch_failed"] += 1
        return False

    # Check format
    fmt = meta.get("format", "")
    tile_count = meta.get("layout", {}).get("tile_count", 0)
    if tile_count not in (16, 25):
        stats["wrong_format"] += 1
        return False

    # Get base tile IDs
    base_ids = meta.get("base_tile_ids", {})
    lower_id = base_ids.get("lower", "")
    upper_id = base_ids.get("upper", "")

    lower_biome = get_biome_from_id(lower_id, LOWER_IDS)
    upper_biome = get_biome_from_id(upper_id, UPPER_IDS)

    if not lower_biome or not upper_biome:
        stats["no_biome_match"] += 1
        return False

    if lower_biome == upper_biome:
        stats["same_biome"] += 1
        return False

    # Determine size variant
    transition_size = meta.get("transition_size", 0.0)

    if tile_count == 25:
        size_dir = "wang_100"
        dir_name = f"{lower_biome}_to_{upper_biome}"
    elif transition_size == 0.0:
        size_dir = "wang"
        # s0.0 uses alphabetical order for directory
        biomes_sorted = sorted([lower_biome, upper_biome])
        dir_name = f"{biomes_sorted[0]}_to_{biomes_sorted[1]}"
    elif transition_size == 0.25:
        size_dir = "wang_25"
        dir_name = f"{lower_biome}_to_{upper_biome}"
    elif transition_size == 0.5:
        size_dir = "wang_50"
        dir_name = f"{lower_biome}_to_{upper_biome}"
    else:
        # transition_size == 1.0 with 16 tiles: standard wang with directional naming
        size_dir = "wang"
        dir_name = f"{lower_biome}_to_{upper_biome}"

    # Create output directory
    output_dir = os.path.join(BASE_DIR, dir_name, size_dir)

    # Check if already populated
    if os.path.exists(output_dir):
        existing_tiles = [f for f in os.listdir(output_dir) if f.endswith(".png") and "__wang_" in f]
        if len(existing_tiles) >= tile_count:
            stats["already_exists"] += 1
            return True

    os.makedirs(output_dir, exist_ok=True)

    # Use the image endpoint (follows redirect with auth token)
    spritesheet_url = f"{API_BASE}/{tileset_id}/image"

    # Download spritesheet
    temp_file = os.path.join(output_dir, "_temp_spritesheet.png").replace("\\", "/")
    if not download_file(spritesheet_url, temp_file):
        stats["download_failed"] += 1
        return False

    # Split into tiles
    if not split_spritesheet(temp_file, output_dir, dir_name, tile_count):
        stats["split_failed"] += 1
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False

    # Clean up temp file
    if os.path.exists(temp_file):
        os.remove(temp_file)

    stats["downloaded"] += 1
    return True


def main():
    # Read tileset IDs from file
    ids_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tileset_ids.txt")
    if not os.path.exists(ids_file):
        print(f"ERROR: {ids_file} not found. Create it first with one tileset ID per line.")
        sys.exit(1)

    with open(ids_file) as f:
        all_ids = [line.strip() for line in f if line.strip() and not line.startswith("#")]

    print(f"Total tileset IDs to process: {len(all_ids)}", flush=True)

    stats = {
        "downloaded": 0,
        "already_exists": 0,
        "fetch_failed": 0,
        "no_biome_match": 0,
        "same_biome": 0,
        "wrong_format": 0,
        "download_failed": 0,
        "split_failed": 0,
    }

    for i, tid in enumerate(all_ids):
        if (i + 1) % 50 == 0 or i == 0:
            print(f"\n--- Progress: {i+1}/{len(all_ids)} ---", flush=True)
            print(f"  Downloaded: {stats['downloaded']}, Existing: {stats['already_exists']}, "
                  f"No match: {stats['no_biome_match']}, Failed: {stats['fetch_failed']}", flush=True)

        process_tileset(tid, stats)

    print(f"\n=== FINAL RESULTS ===")
    print(f"  Total processed: {len(all_ids)}")
    print(f"  Downloaded: {stats['downloaded']}")
    print(f"  Already existed: {stats['already_exists']}")
    print(f"  No biome match: {stats['no_biome_match']}")
    print(f"  Same biome: {stats['same_biome']}")
    print(f"  Wrong format: {stats['wrong_format']}")
    print(f"  Fetch failed: {stats['fetch_failed']}")
    print(f"  Download failed: {stats['download_failed']}")
    print(f"  Split failed: {stats['split_failed']}")


if __name__ == "__main__":
    main()
