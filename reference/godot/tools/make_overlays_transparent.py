#!/usr/bin/env python3
"""Post-process L2-L5 overlay tilesets to extract content with transparent backgrounds.

PixelLab generates opaque Wang tilesets. For overlay layers (L2-L5), we need
transparent backgrounds so they can stack on top of L1 base terrain.

Strategy: For each biome's L2-L5 layers, the wang_0 tile (all-lower variant)
represents the "background" of that tileset. We compute the median color of wang_0
as the background reference, then for every tile in that layer, make pixels
that are close to the background color transparent.

Usage:
  python tools/make_overlays_transparent.py [--threshold 30] [--preview biome]
"""

import sys
import os
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("ERROR: Requires Pillow and numpy. Install: pip install Pillow numpy")
    sys.exit(1)

CATALOG_ROOT = Path(__file__).parent.parent / "assets" / "catalog" / "terrain_v2"
OVERLAY_LAYERS = ["L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"]
THRESHOLD = 30  # Color distance threshold — pixels within this distance of bg become transparent


def get_background_color(layer_dir: Path) -> np.ndarray:
    """Extract the dominant background color from wang_0.png (all-lower variant)."""
    wang0 = layer_dir / "wang_0.png"
    if not wang0.exists():
        # Try wang_15 as fallback
        wang0 = layer_dir / "wang_15.png"
    if not wang0.exists():
        return None

    img = Image.open(wang0).convert("RGB")
    pixels = np.array(img).reshape(-1, 3)
    # Use median color as background reference (robust to small content elements)
    bg_color = np.median(pixels, axis=0).astype(np.float64)
    return bg_color


def make_transparent(img_path: Path, bg_color: np.ndarray, threshold: int) -> bool:
    """Make pixels close to bg_color transparent. Returns True if modified."""
    img = Image.open(img_path).convert("RGBA")
    pixels = np.array(img, dtype=np.float64)

    # Compute color distance from background (Euclidean in RGB space)
    rgb = pixels[:, :, :3]
    diff = np.sqrt(np.sum((rgb - bg_color) ** 2, axis=2))

    # Create alpha mask: transparent where close to background
    alpha = pixels[:, :, 3].copy()
    alpha[diff < threshold] = 0

    # Smooth transition at edges (anti-aliasing)
    edge_zone = (diff >= threshold) & (diff < threshold + 15)
    edge_alpha = ((diff[edge_zone] - threshold) / 15.0 * 255).clip(0, 255)
    alpha[edge_zone] = edge_alpha

    pixels[:, :, 3] = alpha

    # Check if we actually made anything transparent
    transparent_ratio = np.sum(alpha == 0) / alpha.size
    if transparent_ratio < 0.05:
        # Less than 5% transparent — background detection probably failed
        return False

    result = Image.fromarray(pixels.astype(np.uint8), "RGBA")
    result.save(img_path)
    return True


def process_biome(biome_dir: Path, threshold: int, verbose: bool = False) -> dict:
    """Process all overlay layers for one biome."""
    biome_name = biome_dir.name
    stats = {"processed": 0, "skipped": 0, "failed": 0}

    for layer_name in OVERLAY_LAYERS:
        layer_dir = biome_dir / layer_name
        if not layer_dir.exists():
            continue

        bg_color = get_background_color(layer_dir)
        if bg_color is None:
            if verbose:
                print(f"  {biome_name}/{layer_name}: no wang_0.png, skipping")
            stats["skipped"] += 1
            continue

        if verbose:
            print(f"  {biome_name}/{layer_name}: bg=({bg_color[0]:.0f},{bg_color[1]:.0f},{bg_color[2]:.0f})")

        for wang_idx in range(16):
            wang_path = layer_dir / f"wang_{wang_idx}.png"
            if not wang_path.exists():
                continue

            success = make_transparent(wang_path, bg_color, threshold)
            if success:
                stats["processed"] += 1
            else:
                stats["failed"] += 1

    return stats


def main():
    threshold = THRESHOLD
    preview_biome = None
    verbose = True

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--threshold" and i + 1 < len(args):
            threshold = int(args[i + 1])
            i += 2
        elif args[i] == "--preview" and i + 1 < len(args):
            preview_biome = args[i + 1]
            i += 2
        else:
            i += 1

    print(f"Processing L2-L5 overlays with threshold={threshold}")
    print(f"Catalog: {CATALOG_ROOT}")
    print()

    total = {"processed": 0, "skipped": 0, "failed": 0}

    biomes = sorted([d for d in CATALOG_ROOT.iterdir() if d.is_dir()])
    for biome_dir in biomes:
        if preview_biome and biome_dir.name != preview_biome:
            continue

        has_overlays = any((biome_dir / ln).exists() for ln in OVERLAY_LAYERS)
        if not has_overlays:
            continue

        print(f"Processing {biome_dir.name}...")
        stats = process_biome(biome_dir, threshold, verbose)
        for k in total:
            total[k] += stats[k]

    print()
    print(f"Done: {total['processed']} tiles processed, {total['skipped']} skipped, {total['failed']} failed")


if __name__ == "__main__":
    main()
