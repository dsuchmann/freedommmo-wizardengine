#!/usr/bin/env python3
"""Download a PixelLab tileset into the layered terrain catalog.

Usage:
  python tools/download_tileset.py <tileset_id> <biome> <layer> [--force]

Example:
  python tools/download_tileset.py 81944792-c6db-4ba9-a526-ceb901463c59 volcanic L1_base
"""

import sys
import os
import json
import urllib.request
import urllib.error

CATALOG_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "catalog", "terrain_v2")
MCP_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".mcp.json")


def _get_api_key():
    """Read PixelLab API key from .mcp.json config."""
    try:
        with open(MCP_CONFIG) as f:
            config = json.load(f)
        auth = config.get("mcpServers", {}).get("pixellab", {}).get("headers", {}).get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:]
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return None


def _authed_request(url):
    """Make an authenticated request to PixelLab API."""
    api_key = _get_api_key()
    req = urllib.request.Request(url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    return urllib.request.urlopen(req)


def download_tileset(tileset_id: str, biome: str, layer: str, force: bool = False):
    target_dir = os.path.join(CATALOG_ROOT, biome, layer)
    manifest_path = os.path.join(target_dir, "manifest.json")

    if os.path.exists(manifest_path) and not force:
        print(f"Already downloaded: {biome}/{layer}. Use --force to overwrite.")
        return

    os.makedirs(target_dir, exist_ok=True)

    # Download metadata
    meta_url = f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/metadata"
    print(f"Fetching metadata from PixelLab...")
    try:
        with _authed_request(meta_url) as resp:
            metadata = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        print(f"ERROR: Failed to fetch metadata: {e}")
        return

    # Download the spritesheet PNG from the actual storage URL
    png_url = metadata.get("tileset_data", {}).get("spritesheet_url", "")
    if not png_url:
        png_url = f"https://api.pixellab.ai/mcp/tilesets/{tileset_id}/image"
    png_path = os.path.join(target_dir, "tileset.png")
    print(f"Downloading spritesheet...")
    try:
        req = urllib.request.Request(png_url)
        req.add_header("User-Agent", "FreedomMMO-AssetPipeline/1.0")
        with urllib.request.urlopen(req) as resp:
            with open(png_path, "wb") as pf:
                pf.write(resp.read())
    except urllib.error.URLError as e:
        print(f"ERROR: Failed to download image: {e}")
        return

    # Split spritesheet into individual wang tiles
    try:
        from PIL import Image
        sheet = Image.open(png_path)
        tile_w = metadata.get("tile_size", {}).get("width", 32)
        tile_h = metadata.get("tile_size", {}).get("height", 32)
        cols = sheet.width // tile_w

        for i in range(16):
            row = i // cols
            col = i % cols
            tile = sheet.crop((col * tile_w, row * tile_h, (col + 1) * tile_w, (row + 1) * tile_h))
            tile.save(os.path.join(target_dir, f"wang_{i}.png"))
        print(f"Split into 16 wang tiles ({tile_w}x{tile_h})")
    except ImportError:
        print("WARNING: PIL not available. Spritesheet saved but not split.")
        print("Install: pip install Pillow")

    # Write per-layer manifest
    manifest = {
        "biome": biome,
        "layer": layer,
        "pixellab_tileset_id": tileset_id,
        "tile_size": metadata.get("tile_size", {"width": 32, "height": 32}),
        "base_tile_ids": metadata.get("base_tile_ids", {}),
        "generation_prompt": {
            "lower_description": metadata.get("lower_description", ""),
            "upper_description": metadata.get("upper_description", "")
        },
        "quality_status": "downloaded",
        "states": {
            "pristine": {"frames": 1, "downloaded": True}
        }
    }

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Done: {biome}/{layer} ({tileset_id})")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    tileset_id = sys.argv[1]
    biome = sys.argv[2]
    layer = sys.argv[3]
    force = "--force" in sys.argv

    download_tileset(tileset_id, biome, layer, force)
